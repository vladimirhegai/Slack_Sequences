import { describe, expect, it } from "vitest";
import {
  normalizeStoryboardMoments,
  plannedMomentFloor,
  publicationMomentFloor,
  resolveMomentContract,
  validatePlannedMoments,
  type StoryboardMomentV1,
} from "../src/engine/storyboardMoments.ts";
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

  it("reports an unbound moment as a blocking error", () => {
    // No beat anywhere near 3.9s: the nearest signal activity ends at 2.85s
    // and the next major (the 5s boundary) starts outside the window.
    const sparse = `
tl.fromTo("#signal-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, .2);
tl.fromTo("#signal-copy", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 2.4);
tl.fromTo("#proof-title", { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: .7 }, 5.2);
tl.fromTo("#close-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 10.2);
`;
    const declared = scenes.map((scene, index) => ({
      ...scene,
      moments: index === 0
        ? [
            moment(scene.id, "signal-m1", 0.3),
            moment(scene.id, "signal-ghost", 3.9),
          ]
        : [moment(scene.id, `${scene.id}-m1`, scene.startSec + 0.3)],
    }));
    const contract = resolveMomentContract(html(sparse), declared, 15);
    expect(contract.errors.join("\n")).toContain('"signal-ghost"');
    expect(contract.errors.join("\n")).toContain("no executable timeline evidence");
  });

  it("synthesizes moments for legacy storyboards without declared ones", () => {
    const contract = resolveMomentContract(html(DENSE_SCRIPT), scenes, 15);
    expect(contract.synthesizedCount).toBeGreaterThanOrEqual(7);
    expect(contract.errors).toEqual([]);
    expect(contract.moments.every((entry) => entry.evidence)).toBe(true);
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
