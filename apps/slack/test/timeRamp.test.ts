import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  MAX_CATCH_UP_SLOPE,
  TIME_RUNTIME_FILE,
  normalizeStoryboardTimeRamp,
  parseTimeRampPlan,
  resolveTimeRampPlan,
  timeRampHoldWindow,
  validateTimeRampContract,
  warpInverseOf,
  warpOf,
} from "../src/engine/timeRamp.ts";
import {
  applyDeterministicSourceRepairs,
  dropUnusableVolunteeredTimeRamps,
  validateStoryboardPlan,
} from "../src/engine/compositionRunner.ts";
import { analyzeMotionDensity } from "../src/engine/motionDensity.ts";

function scenes(withRamp: boolean): DirectScene[] {
  return [
    { id: "s-one", title: "One", purpose: "open", startSec: 0, durationSec: 4 },
    {
      id: "s-two",
      title: "Two",
      purpose: "prove",
      startSec: 4,
      durationSec: 8,
      ...(withRamp
        ? {
            timeRamp: {
              version: 1 as const,
              atSec: 6.6,
              slowTo: 0.2,
              holdSec: 0.9,
              recoverSec: 1.2,
            },
          }
        : {}),
    },
    { id: "s-three", title: "Three", purpose: "close", startSec: 12, durationSec: 4 },
  ];
}

describe("timeRamp solver", () => {
  it("solves a net-zero, strictly monotonic, invertible warp", () => {
    const plan = resolveTimeRampPlan(scenes(true));
    expect(plan.ramps).toHaveLength(1);
    const ramp = plan.ramps[0]!;
    expect(ramp.sceneId).toBe("s-two");
    const knots = ramp.knots;
    // Net-zero: identity at both endpoints, exactly.
    expect(knots[0]![0]).toBe(knots[0]![1]);
    expect(knots[knots.length - 1]![0]).toBe(knots[knots.length - 1]![1]);
    // Strict monotonicity in both bases.
    for (let index = 1; index < knots.length; index += 1) {
      expect(knots[index]![0]).toBeGreaterThan(knots[index - 1]![0]);
      expect(knots[index]![1]).toBeGreaterThan(knots[index - 1]![1]);
    }
    // The dip genuinely bends time inside the window.
    const warp = warpOf(plan);
    const holdMid = ramp.atSec + 0.18 + ramp.holdSec / 2;
    expect(warp(holdMid)).toBeLessThan(holdMid - 0.2);
    // Identity outside the window (cut exit/entry regions stay pure).
    expect(warp(4.0)).toBe(4.0);
    expect(warp(12.0)).toBe(12.0);
    expect(warp(ramp.atSec)).toBe(ramp.atSec);
    // Inverse round-trips across the whole window.
    const inverse = warpInverseOf(plan);
    for (let t = 4; t <= 12.001; t += 0.05) {
      expect(inverse(warp(t))).toBeCloseTo(t, 6);
    }
    // No knot slope exceeds the catch-up cap (monotone + bounded).
    for (let index = 1; index < knots.length; index += 1) {
      const slope = (knots[index]![1] - knots[index - 1]![1]) /
        (knots[index]![0] - knots[index - 1]![0]);
      expect(slope).toBeGreaterThan(0);
      expect(slope).toBeLessThanOrEqual(MAX_CATCH_UP_SLOPE + 1e-6);
    }
  });

  it("never ramps scene 1 and caps ramps at two per film", () => {
    const ramp = { version: 1 as const, atSec: 0.8, slowTo: 0.3 };
    const many: DirectScene[] = [
      { id: "a", title: "A", purpose: "p", startSec: 0, durationSec: 5, timeRamp: { ...ramp, atSec: 1 } },
      { id: "b", title: "B", purpose: "p", startSec: 5, durationSec: 5, timeRamp: { ...ramp, atSec: 6 } },
      { id: "c", title: "C", purpose: "p", startSec: 10, durationSec: 5, timeRamp: { ...ramp, atSec: 11 } },
      { id: "d", title: "D", purpose: "p", startSec: 15, durationSec: 5, timeRamp: { ...ramp, atSec: 16 } },
    ];
    const plan = resolveTimeRampPlan(many);
    expect(plan.ramps.map((entry) => entry.sceneId)).toEqual(["b", "c"]);
  });

  it("drops a ramp whose window cannot fit inside the scene margins", () => {
    const tight: DirectScene[] = [
      { id: "a", title: "A", purpose: "p", startSec: 0, durationSec: 4 },
      {
        id: "b",
        title: "B",
        purpose: "p",
        startSec: 4,
        durationSec: 2,
        // 2s scene: 0.3 + 3*0.18 + 0.3 hold + 0.3 recover + 0.6 margin > 2s.
        timeRamp: { version: 1, atSec: 4.5, slowTo: 0.3, holdSec: 0.9, recoverSec: 1.2 },
      },
    ];
    expect(resolveTimeRampPlan(tight).ramps).toHaveLength(0);
  });

  it("keeps the ramp clear of the scene's cut exit window", () => {
    const withCut: DirectScene[] = [
      { id: "a", title: "A", purpose: "p", startSec: 0, durationSec: 4 },
      {
        id: "b",
        title: "B",
        purpose: "p",
        startSec: 4,
        durationSec: 6,
        cut: { version: 1, style: "zoom-through" },
        timeRamp: { version: 1, atSec: 6, slowTo: 0.4, holdSec: 0.6, recoverSec: 0.9 },
      },
      { id: "c", title: "C", purpose: "p", startSec: 10, durationSec: 4 },
    ];
    const plan = resolveTimeRampPlan(withCut);
    expect(plan.ramps).toHaveLength(1);
    const ramp = plan.ramps[0]!;
    const windowEnd = ramp.knots[ramp.knots.length - 1]![0];
    // zoom-through exit is 0.24s; identity must resume 0.6s before it.
    expect(windowEnd).toBeLessThanOrEqual(10 - 0.24 - 0.6 + 1e-9);
  });

  it("stretches recovery instead of exceeding the catch-up cap, or drops", () => {
    const steep: DirectScene[] = [
      { id: "a", title: "A", purpose: "p", startSec: 0, durationSec: 4 },
      {
        id: "b",
        title: "B",
        purpose: "p",
        startSec: 4,
        durationSec: 10,
        // Deep dip + short declared recovery: naive catch-up would exceed 2.5×.
        timeRamp: { version: 1, atSec: 5, slowTo: 0.2, holdSec: 0.9, recoverSec: 0.3 },
      },
    ];
    const plan = resolveTimeRampPlan(steep);
    expect(plan.ramps).toHaveLength(1);
    const ramp = plan.ramps[0]!;
    expect(ramp.recoverSec).toBeGreaterThan(0.3);
    for (let index = 1; index < ramp.knots.length; index += 1) {
      const slope = (ramp.knots[index]![1] - ramp.knots[index - 1]![1]) /
        (ramp.knots[index]![0] - ramp.knots[index - 1]![0]);
      expect(slope).toBeLessThanOrEqual(MAX_CATCH_UP_SLOPE + 1e-6);
    }
  });

  it("normalizes junk declarations to no ramp and re-bases scene-relative atSec", () => {
    const scene = { startSec: 10, durationSec: 6 };
    expect(normalizeStoryboardTimeRamp(undefined, scene)).toBeUndefined();
    expect(normalizeStoryboardTimeRamp({ version: 1 }, scene)).toBeUndefined();
    expect(normalizeStoryboardTimeRamp({ version: 1, atSec: 12 }, scene)).toBeUndefined();
    expect(
      normalizeStoryboardTimeRamp({ version: 1, atSec: 40, slowTo: 0.4 }, scene),
    ).toBeUndefined();
    // Scene-relative timing (models restart at zero inside scenes) re-bases.
    const relative = normalizeStoryboardTimeRamp({ version: 1, atSec: 2, slowTo: 0.05 }, scene);
    expect(relative?.atSec).toBe(12);
    expect(relative?.slowTo).toBe(0.2); // clamped into the dip band
  });
});

describe("timeRamp contract gate", () => {
  const filmScenes = scenes(true);
  const plan = resolveTimeRampPlan(filmScenes);
  const island = `<script type="application/json" id="sequences-time">${
    JSON.stringify(plan)
  }</script>`;
  const wrapped = `<script src="gsap.min.js"></script>\n<script src="${TIME_RUNTIME_FILE}"></script>\n${island}\n` +
    `<script>var tl = gsap.timeline({paused:true});var __seqWarped = SequencesTime.wrap(tl); ` +
    `window.__timelines["x"] = __seqWarped;</script>`;

  it("accepts a byte-equal island with runtime + wrapped registration", () => {
    expect(validateTimeRampContract(wrapped, filmScenes).errors).toEqual([]);
  });

  it("rejects a missing island, a stale island, and an unwrapped registration", () => {
    expect(
      validateTimeRampContract("<html></html>", filmScenes).errors[0],
    ).toMatch(/no sequences-time JSON island/);
    const stale = wrapped.replace(/"slowTo":0.2/, '"slowTo":0.3');
    expect(
      validateTimeRampContract(stale, filmScenes).errors.join(" "),
    ).toMatch(/differs from the storyboard's resolved time-ramp plan/);
    const unwrapped = wrapped.replace(
      /var __seqWarped = SequencesTime\.wrap\(tl\); window\.__timelines\["x"\] = __seqWarped;/,
      'window.__timelines["x"] = tl;',
    );
    const errors = validateTimeRampContract(unwrapped, filmScenes).errors.join(" ");
    expect(errors).toMatch(/SequencesTime\.wrap/);
  });

  it("parses count-safe (a bad ramp[1] never drops ramp[0])", () => {
    const good = plan.ramps[0]!;
    const doctored = {
      version: 1,
      ramps: [good, { ...good, sceneId: "", knots: [[0, 0]] }],
    };
    const html = `<script type="application/json" id="sequences-time">${
      JSON.stringify(doctored)
    }</script>`;
    const parsed = parseTimeRampPlan(html);
    expect(parsed.plan).toBeUndefined();
    expect(parsed.errors.some((error) => error.includes("ramp[1]"))).toBe(true);
  });
});

describe("timeRamp storyboard plan gates", () => {
  it("rejects a shot-1 ramp and an unmotivated dip; accepts a motivated one", () => {
    const base = scenes(true);
    const ramped = base[1]!;
    const resolved = resolveTimeRampPlan(base).ramps[0]!;
    const hold = timeRampHoldWindow(resolved);
    // Unmotivated: no declared moment inside the hold.
    expect(
      validateStoryboardPlan(base).some((error) => error.includes("must be motivated")),
    ).toBe(true);
    // Motivated: a declared moment inside the content hold window.
    const motivated = base.map((scene) =>
      scene === ramped
        ? {
            ...scene,
            moments: [{
              version: 1 as const,
              id: "dip-payoff",
              sceneId: scene.id,
              atSec: (hold.contentStartSec + hold.contentEndSec) / 2,
              title: "Payoff lands",
              visualState: "metric resolves",
              change: "value lands",
              motionIntent: "resolve",
              importance: "primary" as const,
            }],
          }
        : scene
    );
    expect(
      validateStoryboardPlan(motivated).some((error) => error.includes("must be motivated")),
    ).toBe(false);
    // Shot-1 ramps are always rejected.
    const shotOne = base.map((scene, index) =>
      index === 0
        ? { ...scene, timeRamp: { version: 1 as const, atSec: 1, slowTo: 0.4 } }
        : scene
    );
    expect(
      validateStoryboardPlan(shotOne).some((error) =>
        error.includes("shot 1 must open at native speed")
      ),
    ).toBe(true);
  });
});

describe("volunteered timeRamp degradation (2026-07-04 live incident)", () => {
  // GLM reaches for the ramp vocabulary even when the brief never asks for
  // slow motion; a mis-placed volunteered dip must degrade to no dip instead
  // of vetoing the whole plan through three storyboard attempts.
  it("drops an unsolvable volunteered dip so the plan gate passes", () => {
    const base = scenes(true);
    // Make the declared ramp unsolvable: hold+recovery cannot fit the shot.
    const broken = base.map((scene) =>
      scene.timeRamp
        ? {
            ...scene,
            durationSec: 2.5,
            timeRamp: { ...scene.timeRamp, atSec: scene.startSec + 1.5 },
          }
        : scene
    );
    // Keep the scene graph contiguous after shortening scene two.
    broken[2] = { ...broken[2]!, startSec: broken[1]!.startSec + 2.5 };
    expect(
      validateStoryboardPlan(broken).some((error) => error.includes("timeRamp")),
    ).toBe(true);
    const sanitized = dropUnusableVolunteeredTimeRamps(broken);
    expect(sanitized.some((scene) => scene.timeRamp)).toBe(false);
    expect(
      validateStoryboardPlan(sanitized).some((error) => error.includes("timeRamp")),
    ).toBe(false);
  });

  it("drops an unmotivated dip and a shot-1 dip, keeps a motivated one", () => {
    const base = scenes(true);
    // Unmotivated (no declared moment inside the hold) → dropped.
    expect(
      dropUnusableVolunteeredTimeRamps(base).some((scene) => scene.timeRamp),
    ).toBe(false);
    // Shot-1 dip → dropped.
    const shotOne = scenes(false).map((scene, index) =>
      index === 0
        ? { ...scene, timeRamp: { version: 1 as const, atSec: 1, slowTo: 0.4 } }
        : scene
    );
    expect(
      dropUnusableVolunteeredTimeRamps(shotOne).some((scene) => scene.timeRamp),
    ).toBe(false);
    // Motivated + solvable → kept verbatim.
    const resolved = resolveTimeRampPlan(base).ramps[0]!;
    const hold = timeRampHoldWindow(resolved);
    const motivated = base.map((scene) =>
      scene.timeRamp
        ? {
            ...scene,
            moments: [{
              version: 1 as const,
              id: "dip-payoff",
              sceneId: scene.id,
              atSec: (hold.contentStartSec + hold.contentEndSec) / 2,
              title: "Payoff lands",
              visualState: "metric resolves",
              change: "value lands",
              motionIntent: "resolve",
              importance: "primary" as const,
            }],
          }
        : scene
    );
    const kept = dropUnusableVolunteeredTimeRamps(motivated);
    expect(kept.find((scene) => scene.id === "s-two")?.timeRamp).toBeDefined();
  });
});

describe("motion density in viewer time", () => {
  // The same authored beats leave a 2.56s content gap in scene two; the dip
  // stretches it past the 3s liveness ceiling in viewer time. Without the
  // ramp the identical film is quiet-gap clean.
  const html = (withRamp: boolean): string => `<!doctype html><html><body>
<script src="gsap.min.js"></script>
<script>var tl = gsap.timeline({paused:true});
tl.fromTo("#a .card",{y:20},{y:0,duration:0.4},2.6);
tl.fromTo("#b .lede",{y:20},{y:0,duration:0.3},4.2);
tl.fromTo("#b .metric",{y:20},{y:0,duration:0.4},7.06);
tl.fromTo("#b .footer",{y:20},{y:0,duration:0.4},10.4);
tl.fromTo("#c .lockup",{y:20},{y:0,duration:0.4},14.2);
window.__timelines["x"] = tl;</script>
</body></html>`;

  it("flags a content-quiet dip as viewer dead air", () => {
    const withRamp = analyzeMotionDensity(html(true), scenes(true), 16);
    const gapErrors = withRamp.errors.filter((error) => error.includes("with no major cut"));
    expect(gapErrors.length).toBeGreaterThan(0);
    const without = analyzeMotionDensity(html(false), scenes(false), 16);
    expect(without.errors.filter((error) => error.includes("with no major cut"))).toEqual([]);
  });
});

describe("all-five-contracts injection regression", () => {
  const storyboard: DirectScene[] = [
    {
      id: "alpha",
      title: "Alpha",
      purpose: "open",
      startSec: 0,
      durationSec: 5,
      cut: { version: 1, style: "cut-left" },
      camera: {
        version: 1,
        path: [
          { version: 1, move: "pan", toRegion: "stage", startSec: 1, durationSec: 1.2 },
        ],
      },
      components: [{ version: 1, id: "hero-progress", kind: "progress" }],
      beats: [{
        version: 1,
        id: "fill",
        sceneId: "alpha",
        component: "hero-progress",
        kind: "progress",
        atSec: 2,
      }],
      interactions: [{
        version: 1,
        id: "tap",
        sceneId: "alpha",
        cursorId: "cursor",
        targetPart: "hero-progress",
        action: "click",
        startSec: 1,
        arriveSec: 2,
        pressSec: 2.2,
        from: "frame:center",
        path: "direct",
        aimX: 0.5,
        aimY: 0.5,
        feedback: "press",
      }],
    },
    {
      id: "beta",
      title: "Beta",
      purpose: "close",
      startSec: 5,
      durationSec: 7,
      timeRamp: { version: 1, atSec: 6.2, slowTo: 0.35, holdSec: 0.6, recoverSec: 0.9 },
    },
  ];
  const html = `<!doctype html><html><head><script src="gsap.min.js"></script></head><body>
<main data-composition-id="inject-smoke" data-width="1920" data-height="1080" data-duration="12">
<section id="alpha" data-scene="alpha" data-start="0" data-duration="5">
<div data-camera-world><div data-region="stage"><div class="cmp cmp-progress" data-component="progress" data-part="hero-progress"><i data-cmp-fill></i></div></div></div>
<div data-camera-overlay><div data-cursor-id="cursor"></div></div>
</section>
<section id="beta" data-scene="beta" data-start="5" data-duration="7"></section>
</main>
<script>
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
tl.set("#alpha",{opacity:1},0);
window.__timelines["inject-smoke"] = tl;
</script></body></html>`;

  it("lands all five compile calls with the time rewrite LAST", () => {
    const repaired = applyDeterministicSourceRepairs(
      { storyboard, html },
      path.dirname(fileURLToPath(import.meta.url)),
      storyboard,
    );
    expect(repaired.html).toMatch(/SequencesInteractions\.compile\(/);
    expect(repaired.html).toMatch(/SequencesCuts\.compile\(/);
    expect(repaired.html).toMatch(/SequencesCamera\.compile\(/);
    expect(repaired.html).toMatch(/SequencesComponents\.compile\(/);
    expect(repaired.html).toMatch(
      /var __seqWarped = SequencesTime\.wrap\(tl\); window\.__timelines\["inject-smoke"\] = __seqWarped;/,
    );
    // The wrap rewrite must come after every compile call in the document.
    const wrapIndex = repaired.html.indexOf("SequencesTime.wrap");
    for (const name of [
      "SequencesInteractions.compile(",
      "SequencesCuts.compile(",
      "SequencesCamera.compile(",
      "SequencesComponents.compile(",
    ]) {
      expect(repaired.html.indexOf(name)).toBeGreaterThan(-1);
      expect(repaired.html.indexOf(name)).toBeLessThan(wrapIndex);
    }
    expect(repaired.html).toMatch(/<script src="sequences-time\.v1\.js"><\/script>/);
    expect(repaired.html).toMatch(/id="sequences-time"/);

    // Idempotency: a second pass over an already-wrapped document (critic
    // patches, cut-discovery upgrades) must not double-wrap or lose anchors.
    const again = applyDeterministicSourceRepairs(
      { storyboard, html: repaired.html },
      path.dirname(fileURLToPath(import.meta.url)),
      storyboard,
    );
    expect(again.html.match(/SequencesTime\.wrap\(/g)).toHaveLength(1);
    expect(again.html.match(/SequencesCuts\.compile\(/g)).toHaveLength(1);
  });

  it("re-injects a missing compile call even after the registration is wrapped", () => {
    const repaired = applyDeterministicSourceRepairs(
      { storyboard, html },
      path.dirname(fileURLToPath(import.meta.url)),
      storyboard,
    );
    // Simulate a patch that dropped the cut compile call from a wrapped doc.
    const dropped = {
      storyboard,
      html: repaired.html.replace(
        /SequencesCuts\.compile\([^\n]*\n/,
        "",
      ),
    };
    const recovered = applyDeterministicSourceRepairs(
      dropped,
      path.dirname(fileURLToPath(import.meta.url)),
      storyboard,
    );
    expect(recovered.html).toMatch(/SequencesCuts\.compile\(/);
    expect(recovered.html.match(/SequencesTime\.wrap\(/g)).toHaveLength(1);
  });
});

describe("time runtime source hygiene", () => {
  it("keeps the runtime template deterministic (no clocks, timers, or randomness)", () => {
    const source = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../src/engine/templates",
        TIME_RUNTIME_FILE,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /Date\.now|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/,
    );
    expect(source).toMatch(/paused:\s*true/);
    expect(source).toMatch(/immediateRender:\s*false/);
  });
});
