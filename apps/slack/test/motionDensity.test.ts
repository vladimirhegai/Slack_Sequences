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
    expect(report.warnings.join("\n")).toContain("no major cut");
    expect(report.warnings.join("\n")).toContain('scene "signal" has 1 authored');
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
    expect(report.warnings).toEqual([]);
  });
});
