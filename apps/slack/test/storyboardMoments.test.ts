import { describe, expect, it } from "vitest";
import {
  normalizeStoryboardMoments,
  plannedMomentFloor,
  publicationMomentFloor,
  resolveMomentContract,
  topUpStoryboardMoments,
  validatePlannedMoments,
  type StoryboardMomentV1,
} from "../src/engine/storyboardMoments.ts";
import { CAMERA_FULL_MOVES } from "../src/engine/cameraContract.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

const scenes: DirectScene[] = [
  { id: "signal", title: "Signal", purpose: "Open the problem", startSec: 0, durationSec: 5 },
  { id: "proof", title: "Proof", purpose: "Show the product", startSec: 5, durationSec: 5 },
  { id: "close", title: "Close", purpose: "Resolve the promise", startSec: 10, durationSec: 5 },
];

function html(script: string): string {
  return `<!doctype html><html><body>
<main data-composition-id="moments" data-duration="15">
  <section id="signal" data-scene="signal" data-start="0" data-duration="5"><h1 id="signal-title">A</h1><p id="signal-copy">B</p></section>
  <section id="proof" data-scene="proof" data-start="5" data-duration="5"><h1 id="proof-title">C</h1><p id="proof-copy">D</p></section>
  <section id="close" data-scene="close" data-start="10" data-duration="5"><h1 id="close-title">E</h1><p id="close-copy">F</p></section>
</main>
<script>const tl = gsap.timeline({ paused: true });${script}</script>
</body></html>`;
}

const DENSE_SCRIPT = `
tl.fromTo("#signal-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, .2);
tl.fromTo("#signal-copy", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 2.4);
tl.fromTo("#signal-copy", { x: 20 }, { x: 0, duration: .4 }, 4.1);
tl.fromTo("#proof-title", { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: .7 }, 5.2);
tl.fromTo("#proof-copy", { scale: .92, opacity: 0 }, { scale: 1, opacity: 1, duration: .5 }, 7.2);
tl.fromTo("#proof-copy", { y: 12 }, { y: 0, duration: .4 }, 9.1);
tl.fromTo("#close-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 10.2);
tl.fromTo("#close-copy", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 12.4);
`;

function moment(
  sceneId: string,
  id: string,
  atSec: number,
  extra: Partial<StoryboardMomentV1> = {},
): StoryboardMomentV1 {
  return {
    version: 1,
    id,
    sceneId,
    atSec,
    title: `Moment ${id}`,
    visualState: `state ${id}`,
    change: `change ${id}`,
    motionIntent: "reveal",
    importance: "supporting",
    ...extra,
  };
}

describe("moment floors", () => {
  it("requires at least 7 moments for 12-18 second films", () => {
    expect(plannedMomentFloor(15)).toBe(7);
    expect(publicationMomentFloor(15)).toBe(7);
    expect(plannedMomentFloor(12)).toBe(7);
    expect(publicationMomentFloor(12)).toBe(7);
  });

  it("scales with duration", () => {
    expect(plannedMomentFloor(24)).toBeGreaterThanOrEqual(10);
    expect(publicationMomentFloor(24)).toBeGreaterThanOrEqual(8);
    expect(publicationMomentFloor(8)).toBe(0);
  });
});

describe("validatePlannedMoments", () => {
  it("recovers scene-relative moment times in later shots", () => {
    const normalized = normalizeStoryboardMoments([
      {
        id: "relative-proof",
        atSec: 2.3,
        title: "Proof resolves",
        visualState: "trace is resolved",
        change: "the trace waterfall settles",
      },
    ], { sceneId: "proof", startSec: 5, durationSec: 5 });
    expect(normalized[0]!.atSec).toBe(7.3);
  });

  it("rejects a 15s plan with too few moments", () => {
    const planned = scenes.map((scene) => ({
      ...scene,
      moments: [moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.3)],
    }));
    const errors = validatePlannedMoments(planned, 15);
    expect(errors.join("\n")).toContain("at least 7");
  });

  it("rejects entrance-clustered scenes and dead intervals", () => {
    const planned = scenes.map((scene) => ({
      ...scene,
      moments: [
        moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.2),
        moment(scene.id, `${scene.id}-m2`, scene.startSec + 0.5),
        moment(scene.id, `${scene.id}-m3`, scene.startSec + 0.9),
      ],
    }));
    const errors = validatePlannedMoments(planned, 15);
    expect(errors.join("\n")).toContain("clusters all its moments at the entrance");
    expect(errors.join("\n")).toContain("no planned moment between");
  });

  it("never vetoes a marginal interval overage (live probes died on 2.8-3.0s gaps)", () => {
    const grid = (secondAt: number) => [
      { scene: "signal", times: [0.3, secondAt] },
      { scene: "proof", times: [5.3, 7.4, 9.5] },
      { scene: "close", times: [11.6, 13.4] },
    ].flatMap(({ scene: sceneId, times }, index) =>
      times.map((atSec, m) => ({ sceneId, atSec, id: `${sceneId}-m${m + 1}`, index }))
    );
    const planned = (secondAt: number) => scenes.map((scene) => ({
      ...scene,
      moments: grid(secondAt)
        .filter((entry) => entry.sceneId === scene.id)
        .map((entry) => moment(scene.id, entry.id, entry.atSec)),
    }));
    // 0.3 → 3.2 is a 2.9s gap: 0.3s over the 2.6s cap — inside the grace.
    expect(validatePlannedMoments(planned(3.2), 15)
      .filter((error) => error.includes("no planned moment"))).toEqual([]);
    // 0.3 → 3.5 is a 3.2s gap: past the grace — still blocking.
    expect(validatePlannedMoments(planned(3.5), 15)
      .filter((error) => error.includes("no planned moment"))).toHaveLength(1);
  });

  it("accepts a well-spread 15s plan", () => {
    const planned = scenes.map((scene) => ({
      ...scene,
      moments: [
        moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.3),
        moment(scene.id, `${scene.id}-m2`, scene.startSec + 2.3),
        moment(scene.id, `${scene.id}-m3`, scene.startSec + 4.2),
      ],
    }));
    expect(validatePlannedMoments(planned, 15)).toEqual([]);
  });
});

describe("resolveMomentContract", () => {
  it("binds declared moments to authored evidence and rejects unbound ones", () => {
    const declared = scenes.map((scene, index) => ({
      ...scene,
      moments: index === 2
        ? [
            // The close scene's beats sit at 10.2 and 12.4; the final 2.6s is
            // the allowed short resolve.
            moment(scene.id, "close-m1", 10.3),
            moment(scene.id, "close-m2", 12.4),
          ]
        : [
            moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.3),
            moment(scene.id, `${scene.id}-m2`, scene.startSec + 2.4),
            moment(scene.id, `${scene.id}-m3`, scene.startSec + 4.1),
          ],
    }));
    const contract = resolveMomentContract(html(DENSE_SCRIPT), declared, 15);
    expect(contract.applies).toBe(true);
    const bound = contract.moments.filter((entry) => entry.evidence);
    expect(bound.length).toBeGreaterThanOrEqual(7);
    expect(contract.errors).toEqual([]);
  });

  // No beat anywhere near 3.5-4.0s: the nearest signal activity ends at 2.85s
  // and the next major (the 5s boundary) starts outside the window.
  const SPARSE_SCRIPT = `
tl.fromTo("#signal-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, .2);
tl.fromTo("#signal-copy", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 2.4);
tl.fromTo("#proof-title", { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: .7 }, 5.2);
tl.fromTo("#close-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 10.2);
`;
  const sparseDeclared = (ghost: StoryboardMomentV1) => scenes.map((scene, index) => ({
    ...scene,
    moments: index === 0
      ? [moment(scene.id, "signal-m1", 0.3), ghost]
      : [moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.3)],
  }));

  it("reports an unbound PRIMARY moment as a blocking error", () => {
    const contract = resolveMomentContract(
      html(SPARSE_SCRIPT),
      sparseDeclared(moment("signal", "signal-ghost", 3.9, { importance: "primary" })),
      15,
    );
    expect(contract.errors.join("\n")).toContain('"signal-ghost"');
    expect(contract.errors.join("\n")).toContain("no executable timeline evidence");
  });

  it("re-anchors an unbound supporting moment onto nearby authored evidence", () => {
    // 3.5s is outside the bind window of the 2.4s beat but within the
    // re-anchor reach — the paperwork degrades instead of costing an attempt.
    const contract = resolveMomentContract(
      html(SPARSE_SCRIPT),
      sparseDeclared(moment("signal", "signal-ghost", 3.5)),
      15,
    );
    expect(contract.errors.join("\n")).not.toContain('"signal-ghost"');
    expect(contract.warnings.join("\n")).toContain('supporting moment "signal-ghost" re-anchored');
    const ghost = contract.moments.find((entry) => entry.id === "signal-ghost")!;
    expect(ghost.atSec).toBeCloseTo(2.4, 2);
    expect(ghost.evidence).toBeDefined();
  });

  it("drops an unbound supporting moment when its scene offers nothing near it", () => {
    // A long opening scene whose only activity sits at its entrance (plus the
    // boundary cut at its far end): 4.0s is a genuine evidence desert — more
    // than the re-anchor reach from everything.
    const longScenes: DirectScene[] = [
      { id: "signal", title: "Signal", purpose: "Open", startSec: 0, durationSec: 8 },
      { id: "proof", title: "Proof", purpose: "Show", startSec: 8, durationSec: 4 },
      { id: "close", title: "Close", purpose: "Resolve", startSec: 12, durationSec: 3 },
    ];
    const longHtml = `<!doctype html><html><body>
<main data-composition-id="moments" data-duration="15">
  <section id="signal" data-scene="signal" data-start="0" data-duration="8"><h1 id="signal-title">A</h1></section>
  <section id="proof" data-scene="proof" data-start="8" data-duration="4"><h1 id="proof-title">C</h1></section>
  <section id="close" data-scene="close" data-start="12" data-duration="3"><h1 id="close-title">E</h1></section>
</main>
<script>const tl = gsap.timeline({ paused: true });
tl.fromTo("#signal-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, .2);
tl.fromTo("#proof-title", { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: .7 }, 8.2);
tl.fromTo("#close-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 12.2);
</script>
</body></html>`;
    const declared = longScenes.map((scene, index) => ({
      ...scene,
      moments: index === 0
        ? [moment(scene.id, "signal-m1", 0.3), moment(scene.id, "signal-ghost", 4.0)]
        : [moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.3)],
    }));
    const contract = resolveMomentContract(longHtml, declared, 15);
    expect(contract.errors.join("\n")).not.toContain('"signal-ghost"');
    expect(contract.warnings.join("\n")).toContain('supporting moment "signal-ghost"');
    expect(contract.warnings.join("\n")).toContain("dropped");
    expect(contract.moments.some((entry) => entry.id === "signal-ghost")).toBe(false);
  });

  it("synthesizes moments for legacy storyboards without declared ones", () => {
    const contract = resolveMomentContract(html(DENSE_SCRIPT), scenes, 15);
    expect(contract.synthesizedCount).toBeGreaterThanOrEqual(7);
    expect(contract.errors).toEqual([]);
    expect(contract.moments.every((entry) => entry.evidence)).toBe(true);
  });
});

describe("topUpStoryboardMoments", () => {
  it("fills the live-incident dead intervals from typed beats and camera arrivals", () => {
    // The 2026-07-04 Railway failure shape: rich typed evidence, but marginal
    // ~3s windows with no declared moment killed all three GLM attempts.
    const planned: DirectScene[] = [
      {
        ...scenes[0]!,
        components: [{ version: 1, id: "sig-stat", kind: "stat-card" }],
        beats: [{
          version: 1,
          id: "sig-count",
          sceneId: "signal",
          component: "sig-stat",
          kind: "count",
          atSec: 4,
        }],
        moments: [
          moment("signal", "signal-m1", 0.3),
          moment("signal", "signal-m2", 2.0),
        ],
      },
      {
        ...scenes[1]!,
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "pan",
            toRegion: "metric-wall",
            startSec: 7.8,
            durationSec: 1.2,
          }],
        },
        moments: [
          moment("proof", "proof-m1", 5.3),
          moment("proof", "proof-m2", 7.0),
        ],
      },
      {
        ...scenes[2]!,
        moments: [
          moment("close", "close-m1", 10.3),
          moment("close", "close-m2", 12.0),
        ],
      },
    ];
    expect(validatePlannedMoments(planned, 15).join("\n")).toContain("no planned moment between");
    const topped = topUpStoryboardMoments(planned, CAMERA_FULL_MOVES);
    expect(topped.added.map((entry) => [entry.sceneId, entry.atSec])).toEqual([
      ["signal", 4],
      ["proof", 9],
    ]);
    expect(topped.added.every((entry) => entry.importance === "supporting")).toBe(true);
    expect(validatePlannedMoments(topped.storyboard, 15)).toEqual([]);
    // The originals are never moved or rewritten.
    expect(
      topped.storyboard[0]!.moments!.filter((entry) => !entry.id.includes("-auto-")),
    ).toEqual(planned[0]!.moments);
  });

  it("leaves a compliant plan untouched", () => {
    const planned = scenes.map((scene) => ({
      ...scene,
      camera: {
        version: 1 as const,
        path: [{
          version: 1 as const,
          move: "pan" as const,
          toRegion: "hero",
          startSec: scene.startSec + 1,
          durationSec: 1,
        }],
      },
      moments: [
        moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.3),
        moment(scene.id, `${scene.id}-m2`, scene.startSec + 2.3),
        moment(scene.id, `${scene.id}-m3`, scene.startSec + 4.2),
      ],
    }));
    const topped = topUpStoryboardMoments(planned, CAMERA_FULL_MOVES);
    expect(topped.added).toEqual([]);
    expect(topped.storyboard).toBe(planned);
  });

  it("leaves genuine dead air for the findings retry", () => {
    // No typed evidence anywhere near the dead windows: the host must not
    // paper over a real hole in the film.
    const planned = scenes.map((scene) => ({
      ...scene,
      moments: [
        moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.3),
        moment(scene.id, `${scene.id}-m2`, scene.startSec + 2.0),
      ],
    }));
    const topped = topUpStoryboardMoments(planned, CAMERA_FULL_MOVES);
    expect(validatePlannedMoments(topped.storyboard, 15).join("\n")).toContain(
      "no planned moment between",
    );
  });

  it("tops up a missed moment floor from unclaimed typed evidence", () => {
    const beat = (sceneId: string, id: string, atSec: number) => ({
      version: 1 as const,
      id,
      sceneId,
      component: `${sceneId}-cmp`,
      kind: "count" as const,
      atSec,
    });
    const planned: DirectScene[] = [
      {
        id: "one", title: "One", purpose: "Open", startSec: 0, durationSec: 4,
        beats: [beat("one", "one-b1", 1.8)],
        moments: [moment("one", "one-m1", 0.5), moment("one", "one-m2", 3.0)],
      },
      {
        id: "two", title: "Two", purpose: "Build", startSec: 4, durationSec: 4,
        beats: [beat("two", "two-b1", 6.7)],
        moments: [moment("two", "two-m1", 5.5), moment("two", "two-m2", 7.9)],
      },
      {
        id: "three", title: "Three", purpose: "Close", startSec: 8, durationSec: 4,
        beats: [beat("three", "three-b1", 9.3)],
        moments: [moment("three", "three-m1", 10.4)],
      },
    ];
    expect(validatePlannedMoments(planned, 12).join("\n")).toContain("at least 7");
    const topped = topUpStoryboardMoments(planned, CAMERA_FULL_MOVES);
    expect(topped.added.length).toBe(2);
    expect(validatePlannedMoments(topped.storyboard, 12)).toEqual([]);
  });

  it("never manufactures a contract for short films that declared no moments", () => {
    const short: DirectScene[] = [
      {
        id: "a", title: "A", purpose: "Open", startSec: 0, durationSec: 3,
        beats: [{
          version: 1, id: "a-b1", sceneId: "a", component: "a-cmp", kind: "count", atSec: 1.5,
        }],
      },
      { id: "b", title: "B", purpose: "Mid", startSec: 3, durationSec: 3 },
      { id: "c", title: "C", purpose: "End", startSec: 6, durationSec: 3 },
    ];
    const topped = topUpStoryboardMoments(short, CAMERA_FULL_MOVES);
    expect(topped.added).toEqual([]);
    expect(topped.storyboard).toBe(short);
  });
});

describe("normalizeStoryboardMoments", () => {
  it("clamps times into the scene window and drops malformed entries", () => {
    const normalized = normalizeStoryboardMoments(
      [
        { version: 1, id: "ok-one", atSec: 99, title: "T", visualState: "V", change: "C", motionIntent: "reveal", importance: "primary" },
        { version: 1, id: "Bad Id!", atSec: 1, title: "T", visualState: "V", change: "C", motionIntent: "reveal", importance: "primary" },
        { version: 1, id: "no-title", atSec: 1, title: "", visualState: "V", change: "C", motionIntent: "reveal", importance: "primary" },
      ],
      { sceneId: "signal", startSec: 0, durationSec: 5 },
    );
    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.atSec).toBe(5);
    expect(normalized[0]!.sceneId).toBe("signal");
  });
});

describe("fallback composition moment contract", () => {
  it("declares an evidence-bound 7+ moment storyboard for a 15s film", () => {
    const draft = buildFallbackComposition({
      product: "RADAR",
      whatShipped: "Live operational view",
      audience: "PMs",
      lengthSec: 15,
    });
    const moments = draft.storyboard.flatMap((scene) => scene.moments ?? []);
    expect(moments.length).toBeGreaterThanOrEqual(7);
    const contract = resolveMomentContract(draft.html, draft.storyboard, 15);
    expect(contract.errors).toEqual([]);
    expect(validatePlannedMoments(draft.storyboard, 15)).toEqual([]);
  });
});
