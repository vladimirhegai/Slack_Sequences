import { describe, expect, it } from "vitest";
import {
  MAX_CONNECTORS_PER_FILM,
  MAX_SWEEPS_PER_FILM,
  resolveFxPlan,
  validateFxContract,
} from "../src/engine/fxContract.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return { title: overrides.id, purpose: "test", ...overrides };
}

/** A payoff scene: stat-card count beat + a primary moment riding it. */
function payoffScene(id: string, startSec: number): DirectScene {
  return scene({
    id,
    startSec,
    durationSec: 5,
    components: [{ version: 1, id: `${id}-stat`, kind: "stat-card", role: "hero" }],
    beats: [{
      version: 1,
      id: `${id}-count`,
      sceneId: id,
      component: `${id}-stat`,
      kind: "count",
      atSec: startSec + 1.5,
      durationSec: 1,
      value: 99,
    }],
    moments: [{
      version: 1,
      id: `${id}-payoff`,
      sceneId: id,
      atSec: startSec + 2.5,
      title: "Metric lands",
      visualState: "The number hits",
      change: "Counted up",
      motionIntent: "ui-state",
      importance: "primary" as const,
    }],
  });
}

describe("resolveFxPlan (the taste ladder)", () => {
  it("answers a primary payoff with one direction-slotted sweep after settle", () => {
    const plan = resolveFxPlan([payoffScene("proof", 0)]);
    const sweep = plan.effects.find((effect) => effect.kind === "sweep");
    const glow = plan.effects.find((effect) => effect.kind === "glow-pulse");
    expect(sweep).toMatchObject({ sceneId: "proof", target: "proof-stat" });
    expect(glow).toBeUndefined();
    // Settle + ε: strictly after the temporal judge's after-frame
    // (evidence.endSec + 0.08), so a sweep can never fake a moment's change.
    expect(sweep!.atSec).toBeGreaterThan(3.05);
  });

  it("suppresses automatic payoff garnish when a grade owns the same phrase", () => {
    const proof = payoffScene("proof", 0);
    proof.gradeShift = { version: 1, atSec: 2.5, toGrade: "warm", fromPart: "proof-stat" };
    proof.moments![0]!.motionIntent = "color temperature turns warm";
    const effects = resolveFxPlan([proof]).effects;
    expect(effects.some((effect) => effect.kind === "grade-shift")).toBe(true);
    expect(effects.some((effect) => effect.kind === "sweep")).toBe(false);
  });

  it("caps sweeps at one per scene and three per film, none in the opening second", () => {
    const scenes = [0, 5, 10, 15, 20].map((start, index) =>
      payoffScene(`s${index}`, start)
    );
    // Make the first scene's payoff land inside the opening exclusion.
    scenes[0]!.beats![0]!.atSec = 0.2;
    scenes[0]!.beats![0]!.durationSec = 0.4;
    scenes[0]!.moments![0]!.atSec = 0.6;
    const plan = resolveFxPlan(scenes);
    const sweeps = plan.effects.filter((effect) => effect.kind === "sweep");
    expect(sweeps.length).toBeLessThanOrEqual(MAX_SWEEPS_PER_FILM);
    expect(sweeps.some((effect) => effect.sceneId === "s0")).toBe(false);
    const perScene = new Map<string, number>();
    for (const sweep of sweeps) {
      perScene.set(sweep.sceneId, (perScene.get(sweep.sceneId) ?? 0) + 1);
    }
    for (const count of perScene.values()) expect(count).toBe(1);
  });

  it("lets a highlight beat opt into a sweep with one style field", () => {
    const plan = resolveFxPlan([scene({
      id: "hero",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1, id: "cta-button", kind: "button" }],
      beats: [{
        version: 1,
        id: "cta-shine",
        sceneId: "hero",
        component: "cta-button",
        kind: "highlight",
        atSec: 3,
        style: "sweep",
      }],
    })]);
    expect(plan.effects.find((effect) => effect.kind === "sweep")).toMatchObject({
      target: "cta-button",
      atSec: 3,
    });
  });

  it("emits a connector draw for every full camera move landing on a region", () => {
    const plan = resolveFxPlan([scene({
      id: "world",
      startSec: 0,
      durationSec: 8,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 2 },
          { version: 1, move: "pan", toRegion: "metrics", startSec: 3, durationSec: 1.2 },
        ],
      },
    })]);
    const connector = plan.effects.find((effect) => effect.kind === "connector");
    expect(connector).toMatchObject({ sceneId: "world", region: "metrics", atSec: 3 });
    expect(connector!.durationSec).toBeCloseTo(1.2);
  });

  it("caps connectors: <=1/scene (the earliest arrival), skips sweep-holding scenes (T3)", () => {
    // 4 scenes, 5 full-move arrivals: s0 has two (a1 earliest, a2 later), the
    // payoff scene s1 has one but also a sweep, s2 and s3 have one each.
    const cameraScene = (
      id: string,
      startSec: number,
      moves: Array<{ region: string; at: number }>,
    ): DirectScene => scene({
      id,
      startSec,
      durationSec: 5,
      camera: {
        version: 1,
        path: moves.map((entry) => ({
          version: 1 as const,
          move: "push-in" as const,
          toRegion: entry.region,
          startSec: entry.at,
          durationSec: 0.8,
          zoom: 1.3,
        })),
      },
    });
    const s0 = cameraScene("s0", 0, [{ region: "a1", at: 0.5 }, { region: "a2", at: 2.5 }]);
    const s1 = { ...payoffScene("s1", 5), camera: cameraScene("s1", 5, [{ region: "b", at: 6 }]).camera };
    const s2 = cameraScene("s2", 10, [{ region: "c", at: 11 }]);
    const s3 = cameraScene("s3", 15, [{ region: "d", at: 16 }]);
    const plan = resolveFxPlan([s0, s1, s2, s3]);
    const connectors = plan.effects.filter((effect) => effect.kind === "connector");
    // <= MAX_CONNECTORS_PER_FILM across the film.
    expect(connectors.length).toBeLessThanOrEqual(MAX_CONNECTORS_PER_FILM);
    // <= 1 per scene, and s0 keeps its EARLIEST arrival (a1, not a2).
    const perScene = new Map<string, string[]>();
    for (const connector of connectors) {
      const regions = perScene.get(connector.sceneId) ?? [];
      regions.push(connector.region!);
      perScene.set(connector.sceneId, regions);
    }
    for (const regions of perScene.values()) expect(regions).toHaveLength(1);
    expect(perScene.get("s0")).toEqual(["a1"]);
    // The sweep-holding scene s1 earns NO connector (one garnish per scene).
    expect(plan.effects.some((effect) => effect.kind === "sweep" && effect.sceneId === "s1")).toBe(true);
    expect(perScene.has("s1")).toBe(false);
  });

  it("caps connectors at MAX_CONNECTORS_PER_FILM across the film", () => {
    const scenes = [0, 5, 10, 15, 20].map((start, index) =>
      scene({
        id: `c${index}`,
        startSec: start,
        durationSec: 5,
        camera: {
          version: 1,
          path: [{ version: 1, move: "push-in", toRegion: `r${index}`, startSec: start + 1, durationSec: 0.8, zoom: 1.3 }],
        },
      })
    );
    const connectors = resolveFxPlan(scenes).effects.filter((effect) => effect.kind === "connector");
    expect(connectors).toHaveLength(MAX_CONNECTORS_PER_FILM);
    // Counted in scene order — the earliest scenes keep their connectors.
    expect(connectors.map((effect) => effect.sceneId)).toEqual(["c0", "c1", "c2"]);
  });

  it("derives nothing from a storyboard with no payoffs, styles, or camera moves", () => {
    expect(resolveFxPlan([
      scene({ id: "a", startSec: 0, durationSec: 4 }),
      scene({ id: "b", startSec: 4, durationSec: 4 }),
    ]).effects).toEqual([]);
  });

  it("emits a grade-shift effect for a scene gradeShift (MD4)", () => {
    const plan = resolveFxPlan([scene({
      id: "turn",
      startSec: 0,
      durationSec: 6,
      gradeShift: { version: 1, atSec: 3, toGrade: "warm", fromPart: "hero-stat" },
    })]);
    const grade = plan.effects.find((effect) => effect.kind === "grade-shift");
    expect(grade).toMatchObject({ sceneId: "turn", toGrade: "warm", target: "hero-stat", atSec: 3 });
    expect(grade!.durationSec).toBeCloseTo(0.9);
  });

  it("emits an underline draw for a highlight beat with style underline (MD3)", () => {
    const plan = resolveFxPlan([scene({
      id: "hero",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1, id: "hero-copy", kind: "headline" }],
      beats: [{
        version: 1,
        id: "underline",
        sceneId: "hero",
        component: "hero-copy",
        kind: "highlight",
        atSec: 2,
        durationSec: 0.8,
        style: "underline",
      }],
    })]);
    const draw = plan.effects.find((effect) => effect.kind === "draw");
    expect(draw).toMatchObject({ sceneId: "hero", target: "hero-copy", atSec: 2 });
    // A style:"ring" highlight emits no draw (the component runtime owns it).
    expect(resolveFxPlan([scene({
      id: "hero",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1, id: "hero-copy", kind: "headline" }],
      beats: [{ version: 1, id: "ring", sceneId: "hero", component: "hero-copy", kind: "highlight", atSec: 2 }],
    })]).effects.some((effect) => effect.kind === "draw")).toBe(false);
  });
});

describe("validateFxContract", () => {
  it("is silent when the resolved plan is empty", () => {
    expect(validateFxContract("<!doctype html><html></html>", [
      scene({ id: "a", startSec: 0, durationSec: 4 }),
    ])).toEqual({ errors: [], warnings: [] });
  });

  it("requires the island, runtime, and compile call when effects resolve", () => {
    const result = validateFxContract(
      "<!doctype html><html></html>",
      [payoffScene("proof", 0)],
    );
    expect(result.errors).toContain(
      "resolved fx plan has effects but index_html has no sequences-fx JSON island",
    );
  });

  it("rejects an island that drifted from the resolved plan", () => {
    const scenes = [payoffScene("proof", 0)];
    const html = `<!doctype html><html><head>
<script src="gsap.min.js"></script>
<script src="sequences-fx.v1.js"></script>
</head><body>
<script type="application/json" id="sequences-fx">{"version":1,"effects":[]}</script>
<script>SequencesFx.compile(tl, root);</script>
</body></html>`;
    expect(validateFxContract(html, scenes).errors).toContain(
      "sequences-fx island differs from the storyboard's resolved fx plan",
    );
  });
});
