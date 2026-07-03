import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAMERA_FULL_MOVES,
  CAMERA_RUNTIME_FILE,
  SEQUENCES_EASES,
  auditCameraEnergy,
  cameraMotionWindows,
  cameraRuntimeSource,
  normalizeStoryboardCameraIntent,
  parseCameraPlan,
  resolveCameraPlan,
  validateCameraContract,
} from "../src/engine/cameraContract.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { analyzeMotionDensity } from "../src/engine/motionDensity.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return {
    title: overrides.id,
    purpose: "test",
    ...overrides,
  };
}

const window = { startSec: 0, durationSec: 8 };

describe("normalizeStoryboardCameraIntent", () => {
  it("keeps known moves, clamps timing into the scene window, and sorts", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "whip", toRegion: "metrics", startSec: 3, durationSec: 0.5 },
        { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 20 },
      ],
    }, window);
    expect(camera?.path.map((move) => move.move)).toEqual(["hold", "whip"]);
    expect(camera?.path[0]).toMatchObject({ startSec: 0, durationSec: 8 });
  });

  it("degrades unusable declarations to no camera plan instead of failing", () => {
    expect(normalizeStoryboardCameraIntent(undefined, window)).toBeUndefined();
    expect(normalizeStoryboardCameraIntent({ version: 1, path: [] }, window)).toBeUndefined();
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "spin", toRegion: "hero", startSec: 0, durationSec: 2 }],
    }, window)).toBeUndefined();
    // A path that never names a region or part cannot bind to the world.
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "hold", startSec: 0, durationSec: 2 }],
    }, window)).toBeUndefined();
    // track-to-anchor without a part is meaningless.
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "track-to-anchor", toRegion: "hero", startSec: 0, durationSec: 2 }],
    }, window)).toBeUndefined();
  });

  it("rejects unknown eases and non-kebab station names", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [{
        version: 1,
        move: "pan",
        toRegion: "hero",
        startSec: 0,
        durationSec: 2,
        ease: "totallyMadeUp",
      }],
    }, window);
    expect(camera?.path[0]?.ease).toBeUndefined();
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "pan", toRegion: "Hero Station!", startSec: 0, durationSec: 2 }],
    }, window)).toBeUndefined();
  });

  it("recovers scene-relative camera times in later shots", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "pan", toRegion: "trace", startSec: 0.4, durationSec: 0.8 },
        { version: 1, move: "push-in", toRegion: "risk", startSec: 2.1, durationSec: 0.7 },
      ],
    }, { startSec: 8, durationSec: 5 });
    expect(camera?.path).toMatchObject([
      { move: "pan", toRegion: "trace", startSec: 8.4, durationSec: 0.8 },
      { move: "push-in", toRegion: "risk", startSec: 10.1, durationSec: 0.7 },
    ]);
  });
});

describe("resolveCameraPlan", () => {
  it("builds a contiguous chain covering the scene and fills gaps with drift", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "journey",
        startSec: 0,
        durationSec: 10,
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 1 },
            { version: 1, move: "whip", toRegion: "metrics", startSec: 3, durationSec: 0.5 },
          ],
        },
      }),
    ]);
    expect(plan.scenes).toHaveLength(1);
    const segments = plan.scenes[0]!.segments;
    // The fill before a whip is split: approach drift, then a short
    // seqAnticipate wind-up that dips the camera backward before the commit.
    expect(segments.map((segment) => segment.move))
      .toEqual(["hold", "drift", "drift", "whip", "drift"]);
    // Contiguous and covering [0, 10].
    expect(segments[0]!.startSec).toBe(0);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]!.startSec).toBe(segments[index - 1]!.endSec);
    }
    expect(segments[segments.length - 1]!.endSec).toBe(10);
    // The gap drift approaches the upcoming framing; the tail drift creeps.
    expect(segments[1]).toMatchObject({ toRegion: "metrics", blend: 0.24 });
    expect(segments[2]).toMatchObject({
      move: "drift",
      ease: "seqAnticipate",
      blend: 0.06,
      toRegion: "metrics",
    });
    expect(segments[2]!.endSec - segments[2]!.startSec).toBeCloseTo(0.22, 5);
    expect(segments[4]).toMatchObject({ toRegion: "metrics", blend: 0 });
  });

  it("applies per-move zoom and ease defaults", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "s",
        startSec: 0,
        durationSec: 6,
        camera: {
          version: 1,
          path: [
            { version: 1, move: "push-in", toRegion: "hero", startSec: 0, durationSec: 2 },
            { version: 1, move: "pull-back", toRegion: "hero", startSec: 2, durationSec: 2 },
            { version: 1, move: "whip", toRegion: "cta", startSec: 4, durationSec: 2 },
          ],
        },
      }),
    ]);
    const segments = plan.scenes[0]!.segments;
    expect(segments[0]).toMatchObject({ move: "push-in", zoom: 1.22, ease: "seqSettle" });
    expect(segments[1]).toMatchObject({ move: "pull-back", zoom: 0.8, ease: "seqSettle" });
    // whip durations are clamped hard — a 2s whip is not a whip.
    const whip = segments.find((segment) => segment.move === "whip")!;
    expect(whip.endSec - whip.startSec).toBeLessThanOrEqual(1.1);
    expect(whip.ease).toBe("seqWhip");
  });

  it("produces no plan for scenes without camera intents", () => {
    expect(resolveCameraPlan([scene({ id: "plain", startSec: 0, durationSec: 5 })]).scenes)
      .toEqual([]);
  });
});

describe("auditCameraEnergy", () => {
  const gentleCamera = (region: string): DirectScene["camera"] => ({
    version: 1,
    path: [{ version: 1, move: "pan", toRegion: region, startSec: 0.5, durationSec: 1.2 }],
  });

  it("flags a 12s+ film with no high-energy camera move or energetic cut", () => {
    const findings = auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 6, camera: gentleCamera("hero") }),
      scene({ id: "b", startSec: 6, durationSec: 6, camera: gentleCamera("metrics") }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/no high-energy peak/);
  });

  it("accepts a whip, a hard push-in, or an energetic cut as the peak", () => {
    const whip: DirectScene["camera"] = {
      version: 1,
      path: [{ version: 1, move: "whip", toRegion: "metrics", startSec: 1, durationSec: 0.5 }],
    };
    expect(auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 6, camera: whip }),
      scene({ id: "b", startSec: 6, durationSec: 6 }),
    ])).toEqual([]);
    const hardPush: DirectScene["camera"] = {
      version: 1,
      path: [{ version: 1, move: "push-in", toRegion: "hero", zoom: 1.35, startSec: 1, durationSec: 1 }],
    };
    expect(auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 6, camera: hardPush }),
      scene({ id: "b", startSec: 6, durationSec: 6 }),
    ])).toEqual([]);
    expect(auditCameraEnergy([
      scene({
        id: "a",
        startSec: 0,
        durationSec: 6,
        cut: { version: 1, style: "zoom-through" },
      }),
      scene({ id: "b", startSec: 6, durationSec: 6 }),
    ])).toEqual([]);
  });

  it("does not require a peak from a short film", () => {
    expect(auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 4, camera: gentleCamera("hero") }),
      scene({ id: "b", startSec: 4, durationSec: 4 }),
    ])).toEqual([]);
  });

  it("flags four or more full moves sharing one verb", () => {
    const pan = (region: string, at: number): NonNullable<DirectScene["camera"]>["path"][number] => ({
      version: 1,
      move: "pan",
      toRegion: region,
      startSec: at,
      durationSec: 1,
    });
    const findings = auditCameraEnergy([
      scene({
        id: "a",
        startSec: 0,
        durationSec: 8,
        camera: { version: 1, path: [pan("one", 0), pan("two", 2), pan("three", 4), pan("four", 6)] },
        cut: { version: 1, style: "zoom-through" },
      }),
      scene({ id: "b", startSec: 8, durationSec: 6 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/same verb "pan"/);
  });
});

describe("validateCameraContract", () => {
  const cameraScene = scene({
    id: "journey",
    startSec: 0,
    durationSec: 8,
    camera: {
      version: 1,
      path: [
        { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 1 },
        { version: 1, move: "pan", toRegion: "metrics", startSec: 4, durationSec: 1 },
      ],
    },
  });

  function html(options: {
    island?: string;
    world?: boolean;
    regions?: string[];
    runtime?: boolean;
    compileCall?: boolean;
    extraScript?: string;
  } = {}): string {
    const island = options.island ??
      JSON.stringify(resolveCameraPlan([cameraScene]));
    return `<!doctype html><html><head>
      <script src="gsap.min.js"></script>
      ${options.runtime === false ? "" : `<script src="${CAMERA_RUNTIME_FILE}"></script>`}
    </head><body>
      <main data-composition-id="c" data-width="1920" data-height="1080" data-duration="8">
        <section id="journey" data-scene="journey" data-start="0" data-duration="8">
          ${options.world === false ? "" : `<div data-camera-world>${
            (options.regions ?? ["hero", "metrics"])
              .map((region) => `<div data-region="${region}"></div>`)
              .join("")
          }</div>`}
        </section>
      </main>
      <script type="application/json" id="sequences-camera">${island}</script>
      <script>${options.extraScript ?? ""}
        const tl = gsap.timeline({ paused: true });
        ${options.compileCall === false ? "" : "SequencesCamera.compile(tl, document.querySelector('[data-composition-id]'));"}
        window.__timelines["c"] = tl;
      </script>
    </body></html>`;
  }

  it("accepts a bound plan", () => {
    const result = validateCameraContract(html(), [cameraScene]);
    expect(result.errors).toEqual([]);
  });

  it("is silent when neither storyboard nor HTML declare a camera", () => {
    const plain = scene({ id: "journey", startSec: 0, durationSec: 8 });
    const result = validateCameraContract(
      "<html><body><section data-scene='journey'></section></body></html>",
      [plain],
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("blocks a storyboard camera plan with no island", () => {
    const result = validateCameraContract(
      "<html><body><section data-scene='journey'><div data-camera-world></div></section></body></html>",
      [cameraScene],
    );
    expect(result.errors.some((error) => error.includes("no sequences-camera JSON island"))).toBe(true);
  });

  it("blocks an island that differs from the resolved storyboard plan", () => {
    const tampered = JSON.stringify({ version: 1, scenes: [] });
    const result = validateCameraContract(html({ island: tampered }), [cameraScene]);
    expect(result.errors.some((error) => error.includes("differs from the storyboard"))).toBe(true);
  });

  it("blocks missing worlds, regions, runtime, and compile call", () => {
    expect(validateCameraContract(html({ world: false }), [cameraScene]).errors
      .some((error) => error.includes("no data-camera-world"))).toBe(true);
    expect(validateCameraContract(html({ regions: ["hero"] }), [cameraScene]).errors
      .some((error) => error.includes('region "metrics"'))).toBe(true);
    expect(validateCameraContract(html({ runtime: false }), [cameraScene]).errors
      .some((error) => error.includes(CAMERA_RUNTIME_FILE))).toBe(true);
    expect(validateCameraContract(html({ compileCall: false }), [cameraScene]).errors
      .some((error) => error.includes("SequencesCamera.compile"))).toBe(true);
  });

  it("ignores data-region strings in trailing scripts after a closed scene", () => {
    const result = validateCameraContract(
      html({
        regions: ["hero"],
        extraScript: 'const template = `<div data-region="metrics"></div>`;',
      }),
      [cameraScene],
    );
    expect(result.errors.some((error) => error.includes('region "metrics"'))).toBe(true);
  });

  it("warns when an authored tween targets the world plane", () => {
    const result = validateCameraContract(
      html({ extraScript: "gsap.timeline({paused:true}).to(\"[data-camera-world]\", { x: 40 }, 1);" }),
      [cameraScene],
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("owns that transform"))).toBe(true);
  });
});

describe("cameraMotionWindows", () => {
  it("covers full moves only — hold and drift stay auditable", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "journey",
        startSec: 0,
        durationSec: 10,
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 1 },
            { version: 1, move: "whip", toRegion: "metrics", startSec: 3, durationSec: 0.5 },
          ],
        },
      }),
    ]);
    const windows = cameraMotionWindows(plan);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start).toBeCloseTo(2.95, 5);
    expect(windows[0]!.end).toBeCloseTo(3.55, 5);
    expect(cameraMotionWindows(undefined)).toEqual([]);
  });
});

describe("parseCameraPlan", () => {
  it("round-trips the resolved plan through the island", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "journey",
        startSec: 0,
        durationSec: 8,
        camera: {
          version: 1,
          path: [{ version: 1, move: "pan", toRegion: "hero", startSec: 0, durationSec: 2 }],
        },
      }),
    ]);
    const parsed = parseCameraPlan(
      `<script type="application/json" id="sequences-camera">${JSON.stringify(plan)}</script>`,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.plan).toEqual(plan);
  });

  it("reports malformed islands", () => {
    expect(parseCameraPlan(
      '<script type="application/json" id="sequences-camera">{nope</script>',
    ).errors[0]).toContain("invalid");
    expect(parseCameraPlan(
      '<script type="application/json" id="sequences-camera">{"version":2,"scenes":[]}</script>',
    ).errors[0]).toContain("version");
  });
});

describe("sequences-camera runtime ease library", () => {
  function loadEases(): Map<string, (t: number) => number> {
    const registered = new Map<string, (t: number) => number>();
    const source = cameraRuntimeSource();
    const fakeWindow = {
      gsap: {
        registerEase: (name: string, fn: (t: number) => number) => registered.set(name, fn),
      },
    };
    // The template is an IIFE over `window`; document is only touched inside
    // compile(), which this test never calls.
    new Function("window", "document", source)(fakeWindow, {});
    return registered;
  }

  it("registers every contract ease with sane endpoints", () => {
    const eases = loadEases();
    for (const name of SEQUENCES_EASES) {
      const ease = eases.get(name);
      expect(ease, `${name} must be registered`).toBeTypeOf("function");
      expect(ease!(0)).toBeCloseTo(0, 5);
      expect(ease!(1)).toBeCloseTo(1, 5);
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const value = ease!(t);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(-0.12); // seqAnticipate dips, bounded
        expect(value).toBeLessThan(1.06); // seqMicrobounce overshoots, bounded
      }
    }
  });

  it("gives seqGlide and seqDrift residual end velocity and keeps seqSwoosh monotonic", () => {
    const eases = loadEases();
    const glide = eases.get("seqGlide")!;
    const drift = eases.get("seqDrift")!;
    expect((glide(1) - glide(0.98)) / 0.02).toBeGreaterThan(0.05);
    expect((drift(1) - drift(0.98)) / 0.02).toBeGreaterThan(0.3);
    const swoosh = eases.get("seqSwoosh")!;
    for (let t = 0.01; t <= 1; t += 0.01) {
      expect(swoosh(t)).toBeGreaterThanOrEqual(swoosh(t - 0.01) - 1e-9);
    }
  });

  it("exposes a frozen SequencesCamera global", () => {
    const registered = new Map<string, (t: number) => number>();
    const fakeWindow: Record<string, unknown> = {
      gsap: { registerEase: (name: string, fn: (t: number) => number) => registered.set(name, fn) },
    };
    new Function("window", "document", cameraRuntimeSource())(fakeWindow, {});
    const rig = fakeWindow.SequencesCamera as { version: number; compile: unknown };
    expect(rig.version).toBe(1);
    expect(rig.compile).toBeTypeOf("function");
  });
});

describe("fallback composition camera integration", () => {
  it("ships a bound camera world that passes the static contract", () => {
    const draft = buildFallbackComposition({
      product: "Relay",
      whatShipped: "Live handoff for support threads",
      audience: "support teams",
      lengthSec: 15,
    });
    expect(draft.html).toContain(`src="${CAMERA_RUNTIME_FILE}"`);
    expect(draft.html).toContain('id="sequences-camera"');
    expect(draft.html).toContain("SequencesCamera.compile");
    expect(draft.html).toContain('data-region="proof-context"');
    const result = validateCameraContract(draft.html, draft.storyboard);
    expect(result.errors).toEqual([]);
    // The authored proof entrance rides a library ease.
    expect(draft.html).toContain('ease:"seqSettle"');
  });
});

describe("motion density camera awareness", () => {
  const worldScene = (path: NonNullable<DirectScene["camera"]>["path"]): DirectScene =>
    scene({
      id: "journey",
      startSec: 0,
      durationSec: 6,
      camera: { version: 1, path },
    });

  it("counts full camera moves as beats and drift as connective motion", () => {
    const scenes = [
      worldScene([
        { version: 1, move: "whip", toRegion: "metrics", startSec: 2.5, durationSec: 0.5 },
      ]),
      scene({ id: "b", startSec: 6, durationSec: 4 }),
      scene({ id: "c", startSec: 10, durationSec: 4 }),
    ];
    const report = analyzeMotionDensity("<html></html>", scenes, 14);
    const cameraBeats = report.activities.filter((activity) =>
      activity.source.startsWith("camera:")
    );
    expect(cameraBeats.some((activity) => activity.source === "camera:whip" && activity.kind === "medium"))
      .toBe(true);
    expect(cameraBeats.some((activity) => activity.source === "camera:drift" && activity.kind === "small"))
      .toBe(true);
  });

  it("flags a long typed hold with nothing happening inside it", () => {
    const scenes = [
      worldScene([
        { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 5.5 },
      ]),
      scene({ id: "b", startSec: 6, durationSec: 4 }),
      scene({ id: "c", startSec: 10, durationSec: 4 }),
    ];
    const report = analyzeMotionDensity("<html></html>", scenes, 14);
    expect(report.warnings.some((warning) => warning.includes("motion/pulse"))).toBe(true);
  });

  it("has CAMERA_FULL_MOVES excluding hold and drift", () => {
    expect(CAMERA_FULL_MOVES.has("pan")).toBe(true);
    expect(CAMERA_FULL_MOVES.has("hold" as never)).toBe(false);
    expect(CAMERA_FULL_MOVES.has("drift" as never)).toBe(false);
  });
});

describe("runtime source hygiene", () => {
  it("keeps the runtime template deterministic (no clocks, timers, or randomness)", () => {
    const source = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../src/engine/templates",
        CAMERA_RUNTIME_FILE,
      ),
      "utf8",
    );
    expect(source).not.toMatch(/Date\.now|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
  });
});
