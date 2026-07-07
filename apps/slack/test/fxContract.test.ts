import { describe, expect, it } from "vitest";
import {
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
  it("answers a primary payoff moment with one sweep + one glow pulse at settle time", () => {
    const plan = resolveFxPlan([payoffScene("proof", 0)]);
    const sweep = plan.effects.find((effect) => effect.kind === "sweep");
    const glow = plan.effects.find((effect) => effect.kind === "glow-pulse");
    expect(sweep).toMatchObject({ sceneId: "proof", target: "proof-stat" });
    expect(glow).toMatchObject({ sceneId: "proof", target: "proof-stat" });
    // Settle + ε: strictly after the temporal judge's after-frame
    // (evidence.endSec + 0.08), so a sweep can never fake a moment's change.
    expect(sweep!.atSec).toBeGreaterThan(2.5 + 0.08);
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
