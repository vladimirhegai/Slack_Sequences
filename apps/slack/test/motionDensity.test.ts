import { describe, expect, it } from "vitest";
import { analyzeMotionDensity } from "../src/engine/motionDensity.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

const scenes: DirectScene[] = [
  {
    id: "signal",
    title: "Signal",
    purpose: "Open the problem",
    startSec: 0,
    durationSec: 5,
  },
  {
    id: "proof",
    title: "Proof",
    purpose: "Show the product",
    startSec: 5,
    durationSec: 5,
  },
  {
    id: "close",
    title: "Close",
    purpose: "Resolve the promise",
    startSec: 10,
    durationSec: 5,
  },
];

function html(script: string): string {
  return `<!doctype html><html><body>
<main data-composition-id="motion" data-duration="15">
  <section id="signal" data-scene="signal" data-start="0" data-duration="5">
    <h1 id="signal-title">Signal overload</h1><p id="signal-copy">Everything at once</p>
  </section>
  <section id="proof" data-scene="proof" data-start="5" data-duration="5">
    <h1 id="proof-title">One operational view</h1><p id="proof-copy">Live proof</p>
  </section>
  <section id="close" data-scene="close" data-start="10" data-duration="5">
    <h1 id="close-title">Move with confidence</h1><p id="close-copy">CTA</p>
  </section>
</main>
<script>const tl = gsap.timeline({ paused: true });${script}</script>
</body></html>`;
}

describe("motion density", () => {
  it("flags long slide-like stretches in a 15 second three-shot film", () => {
    const report = analyzeMotionDensity(html(`
tl.fromTo("#signal-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, .2);
tl.fromTo("#proof-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 5.2);
tl.fromTo("#close-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 10.2);
`), scenes, 15);
    expect(report.applies).toBe(true);
    // Liveness findings are blocking errors — a slide-like film cannot publish.
    expect(report.errors.join("\n")).toContain("no major cut");
    expect(report.errors.join("\n")).toContain('scene "signal" has 1 authored');
    expect(report.maxQuietGapSec).toBeGreaterThan(3);
  });

  it("accepts staged mid-shot and back-half beats", () => {
    const report = analyzeMotionDensity(html(`
tl.fromTo("#signal-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, .2);
tl.fromTo("#signal-copy", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 2.8);
tl.fromTo("#proof-title", { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: .7 }, 5.2);
tl.fromTo("#proof-copy", { scale: .92, opacity: 0 }, { scale: 1, opacity: 1, duration: .5 }, 7.8);
tl.fromTo("#close-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 10.2);
tl.fromTo("#close-copy", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 12.8);
`), scenes, 15);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.sceneReports.map((scene) => scene.backHalfBeatCount)).toEqual([1, 1, 1]);
  });

  it("assigns exact boundary tweens to the scene beginning at that boundary", () => {
    const report = analyzeMotionDensity(html(`
tl.fromTo("#signal-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 0);
tl.fromTo("#signal-copy", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 1.2);
tl.fromTo("#signal-copy", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 2.8);
tl.fromTo("#proof-title", { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: .7 }, 5);
tl.fromTo("#proof-copy", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 6.2);
tl.fromTo("#proof-copy", { scale: .92, opacity: 0 }, { scale: 1, opacity: 1, duration: .5 }, 7.8);
tl.fromTo("#close-title", { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: .7 }, 10);
tl.fromTo("#close-copy", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 11.2);
tl.fromTo("#close-copy", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 12.8);
`), scenes, 15);
    expect(report.sceneReports.map((scene) => scene.authoredBeatCount)).toEqual([3, 3, 3]);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("places deterministic forEach staggers at their earliest indexed start", () => {
    const report = analyzeMotionDensity(html(`
document.querySelectorAll('.severity-dot').forEach((dot, i) => {
  tl.fromTo(dot, { opacity: .3 }, { opacity: 1, duration: .15 }, 2.45 + i * .08);
});
`), scenes, 15);
    expect(report.warnings.some((warning) => warning.includes("no absolute timeline position")))
      .toBe(false);
    expect(report.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "gsap.fromTo", startSec: 2.45 }),
    ]));
  });

  it("resolves scene-local t(seconds) helpers to absolute film time", () => {
    const report = analyzeMotionDensity(html(`
(() => {
  const sceneStart = 5;
  const t = (s) => sceneStart + s;
  tl.to("#proof-title", { opacity: 1, duration: .4 }, t(.6));
  tl.to("#proof-copy", { opacity: 1, duration: .4 }, t(2.2));
})();
(() => {
  const sceneStart = 10;
  const t = (s) => sceneStart + s;
  tl.to("#close-title", { opacity: 1, duration: .4 }, t(.5));
  tl.to("#close-copy", { opacity: 1, duration: .4 }, t(2.4));
})();
`), scenes, 15);
    expect(report.warnings.some((warning) => warning.includes("no absolute timeline position")))
      .toBe(false);
    expect(report.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "gsap.to", startSec: 5.6 }),
      expect.objectContaining({ source: "gsap.to", startSec: 12.4 }),
    ]));
  });

  it("keeps repeated sceneStart constants scoped to their function IIFEs", () => {
    const report = analyzeMotionDensity(html(`
(function (tl) {
  const sceneStart = 0;
  tl.to("#signal-title", { opacity: 1, duration: .4 }, sceneStart + .4);
  tl.to("#signal-copy", { opacity: 1, duration: .4 }, sceneStart + 2.5);
})(tl);
(function (tl) {
  const sceneStart = 5;
  tl.to("#proof-title", { opacity: 1, duration: .4 }, sceneStart + .4);
  tl.to("#proof-copy", { opacity: 1, duration: .4 }, sceneStart + 2.5);
})(tl);
(function (tl) {
  const sceneStart = 10;
  tl.to("#close-title", { opacity: 1, duration: .4 }, sceneStart + .4);
  tl.to("#close-copy", { opacity: 1, duration: .4 }, sceneStart + 2.5);
})(tl);
`), scenes, 15);
    expect(report.sceneReports.map((entry) => entry.authoredBeatCount)).toEqual([2, 2, 2]);
    expect(report.warnings.some((warning) => warning.includes("motion/density"))).toBe(false);
  });

  it("counts repeated mechanical legs on one interaction target as one authored beat", () => {
    const report = analyzeMotionDensity(html(`
tl.to(cursor, { opacity: 1, duration: .2 }, 2.00);
tl.to(cursor, { scale: .84, duration: .12 }, 2.40);
tl.to(button, { scale: .95, duration: .12 }, 2.42);
tl.to(cursor, { scale: 1, duration: .14 }, 2.55);
tl.to(button, { scale: 1, duration: .14 }, 2.55);
tl.to(buttonLabel, { opacity: 0, duration: .2 }, 2.65);
tl.to(buttonCheck, { opacity: 1, duration: .2 }, 2.65);
tl.to(button, { background: "#54c994", duration: .35 }, 2.65);
tl.to(statValue, { textContent: "Ready", duration: .01 }, 2.70);
tl.to(statValue, { scale: 1.06, duration: .3 }, 2.70);
`), scenes, 15);
    expect(report.warnings.some((warning) => warning.includes("motion/density"))).toBe(false);
  });

  it("still warns when nine independently targeted subjects start inside one second", () => {
    const burst = Array.from({ length: 9 }, (_, index) =>
      `tl.to("#subject-${index}", { opacity: 1, duration: .2 }, ${2 + index * 0.05});`
    ).join("\n");
    const report = analyzeMotionDensity(html(burst), scenes, 15);
    expect(report.warnings.some((warning) =>
      warning.includes("motion/density: 9 authored beats")
    )).toBe(true);
  });

  it("does not let ambient drift or decorative rules impersonate story beats", () => {
    const driftingScenes: DirectScene[] = scenes.map((scene) => ({
      ...scene,
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "drift",
          toRegion: `${scene.id}-region`,
          startSec: scene.startSec,
          durationSec: scene.durationSec,
        }],
      },
    }));
    const report = analyzeMotionDensity(html(`
tl.fromTo("#signal-rule", { scaleX: 0 }, { scaleX: 1, duration: .6 }, 2.4);
tl.fromTo("#proof-divider", { scaleX: 0 }, { scaleX: 1, duration: .6 }, 7.4);
tl.fromTo("#close-glow", { opacity: 0 }, { opacity: 1, duration: .6 }, 12.4);
`), driftingScenes, 15);
    expect(report.activities.filter((activity) =>
      activity.source.startsWith("camera:") || activity.source.startsWith("gsap.")
    ).every((activity) => activity.kind === "small")).toBe(true);
    expect(report.errors.join("\n")).toContain("no major cut");
    expect(report.errors.join("\n")).toContain('scene "signal" has 0 authored');
  });
});
