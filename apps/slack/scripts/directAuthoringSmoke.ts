/**
 * Key-free end-to-end proof for the direct authoring execution plane:
 * authored HyperFrames source -> MCP validation/checkpoint -> thumbnails ->
 * optional MP4. This is deliberately separate from `/sequences demo`, whose
 * curated Sequences Plan remains the fallback path.
 */
import fs from "node:fs";
import { initializeProject, projectDirFor } from "../src/engine/projectTemplates.ts";
import { McpClient } from "../src/engine/mcpClient.ts";

const dir = projectDirFor("direct-authoring-smoke");
fs.rmSync(dir, { recursive: true, force: true });
initializeProject(dir, { name: "Relay Direct", brandName: "Relay", seedScreenshot: true });

const closeInteraction = {
  version: 1 as const,
  id: "close-cta-click",
  sceneId: "close",
  cursorId: "main-pointer",
  targetPart: "primary-action",
  action: "click" as const,
  startSec: 10.2,
  arriveSec: 10.72,
  pressSec: 10.84,
  releaseSec: 11,
  holdUntilSec: 11.7,
  from: "frame:bottom-right" as const,
  path: "human" as const,
  bend: -0.14,
  ease: "power3.out",
  aimX: 0.9,
  aimY: 0.86,
  offsetX: 0,
  offsetY: -2,
  hitInsetPx: 6,
  feedback: "press-ripple" as const,
  ripplePart: "primary-action-ripple",
  cursorScale: 1,
  targetScale: 1,
};

const storyboard = [
  {
    id: "hook",
    title: "Latency becomes a pulse",
    purpose: "Turn the release claim into a visual hook",
    startSec: 0,
    durationSec: 4,
    blueprint: "kinetic-type-beats",
    rules: ["kinetic-beat-slam"],
    outgoingCut: "The cyan latency line becomes the dashboard frame",
  },
  {
    id: "surface",
    title: "Trace the real surface",
    purpose: "Show the product evidence as the hero",
    startSec: 4,
    durationSec: 5,
    blueprint: "device-surface-showcase",
    rules: ["multi-phase-camera"],
    outgoingCut: "The dashboard status pill becomes the CTA",
  },
  {
    id: "close",
    title: "Rollback with nerve",
    purpose: "Resolve the promise into a direct ask",
    startSec: 9,
    durationSec: 3,
    blueprint: "cta-morph-press",
    rules: ["physics-press-reaction"],
    outgoingCut: "Hold on the Relay lockup",
    spatialIntent: {
      version: 1 as const,
      focalPart: "primary-action",
      composition: "Centered brand resolve with a single tactile action",
      frameAnchor: "frame:center" as const,
      relationships: ["primary action remains centered under the lockup"],
    },
    interactions: [closeInteraction],
  },
];

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <title>Relay Direct</title>
  <script src="gsap.min.js"></script>
  <script src="sequences-interactions.v1.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #06080c; }
    body { color: #f5f7fb; font-family: Inter, Arial, sans-serif; }
    #root { --space-safe: 72px; position: relative; width: 1920px; height: 1080px; overflow: hidden; background: radial-gradient(circle at 76% 18%, #123840 0, #06080c 42%); }
    .scene { position: absolute; inset: 0; padding: 120px 150px; opacity: 0; }
    .eyebrow { color: #59f1d2; font: 700 28px/1 monospace; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 38px 0 0; max-width: 1420px; font-size: 148px; line-height: .88; letter-spacing: -.065em; }
    .rail { width: 820px; height: 7px; margin-top: 62px; background: #59f1d2; transform-origin: left; box-shadow: 0 0 32px #59f1d288; }
    #surface { display: grid; grid-template-columns: 430px 1fr; gap: 70px; align-items: center; }
    .side-copy h2 { margin: 24px 0 0; font-size: 76px; line-height: .95; letter-spacing: -.045em; }
    .window { padding: 22px; border: 1px solid #59f1d255; border-radius: 34px; background: #0d131b; box-shadow: 0 50px 130px #000a; transform-origin: 55% 45%; }
    .window img { display: block; width: 100%; height: 630px; object-fit: contain; border-radius: 19px; background: #080b10; }
    #close { display: grid; place-items: center; text-align: center; }
    .lockup { font-size: 42px; font-weight: 800; letter-spacing: -.03em; }
    .cta { margin-top: 44px; padding: 30px 54px; border-radius: 999px; background: #59f1d2; color: #06100e; font-size: 58px; font-weight: 800; }
    [data-camera-world], [data-camera-overlay] { position: absolute; inset: 0; }
    #close [data-camera-world] { display: grid; place-items: center; }
    #main-pointer { position: absolute; left: 0; top: 0; width: 44px; height: 44px; z-index: 20; pointer-events: none; }
    #cta-ripple { position: absolute; left: 0; top: 0; width: 90px; height: 90px; border: 3px solid #59f1d2; border-radius: 50%; pointer-events: none; opacity: 0; }
  </style>
</head>
<body>
  <main id="root" data-composition-id="relay-direct" data-width="1920" data-height="1080" data-duration="12">
    <section id="hook" class="scene clip" data-scene="hook" data-start="0" data-duration="4" data-track-index="1">
      <div class="eyebrow">Relay v2 / now tracing</div>
      <h1 data-layout-important><span id="latency">Sub-100ms</span><br>or it never happened.</h1>
      <div class="rail" id="hook-rail"></div>
    </section>
    <section id="surface" class="scene clip" data-scene="surface" data-start="4" data-duration="5" data-track-index="1" data-layout-allow-overflow>
      <div class="side-copy" data-layout-important><div class="eyebrow">The evidence</div><h2>See the trace.<br>Keep the nerve.</h2></div>
      <div class="window" id="dashboard-window" data-layout-important><img src="assets/dashboard.svg" alt=""></div>
    </section>
    <section id="close" class="scene clip" data-scene="close" data-start="9" data-duration="3" data-track-index="1">
      <div data-camera-world>
        <div data-layout-important data-layout-anchor="frame:center"><div class="lockup">RELAY</div><div class="cta" id="cta" data-part="primary-action">Rollback in one click</div></div>
      </div>
      <div data-camera-overlay>
        <svg id="main-pointer" data-cursor-id="main-pointer" data-cursor-hotspot-x="0.08" data-cursor-hotspot-y="0.06" viewBox="0 0 24 24"><path d="M2 2L20 10L11 13L7 21Z" fill="#f5fbff" stroke="#06100e" stroke-width="1.2"/></svg>
        <div id="cta-ripple" data-part="primary-action-ripple"></div>
      </div>
    </section>
  </main>
  <script type="application/json" id="sequences-interactions">${
    JSON.stringify({ version: 1, interactions: [closeInteraction] })
  }</script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set("#hook", { opacity: 1 }, 0);
    tl.set("#hook", { opacity: 0 }, 3.99);
    tl.set("#surface", { opacity: 1 }, 4);
    tl.set("#surface", { opacity: 0 }, 8.99);
    tl.set("#close", { opacity: 1 }, 9);
    tl.set("#close", { opacity: 0 }, 12);
    tl.fromTo("#hook .eyebrow", { x: -48, opacity: 0 }, { x: 0, opacity: 1, duration: .45, ease: "power3.out" }, .15);
    tl.fromTo("#hook h1", { y: 110, opacity: 0 }, { y: 0, opacity: 1, duration: .8, ease: "power4.out" }, .42);
    tl.fromTo("#hook-rail", { scaleX: 0 }, { scaleX: 1, duration: 1.5, ease: "power3.inOut" }, 1.25);
    tl.fromTo("#surface .side-copy", { x: -100, opacity: 0 }, { x: 0, opacity: 1, duration: .75, ease: "power3.out" }, 4.15);
    tl.fromTo("#dashboard-window", { x: 160, scale: 1.16, rotation: 3, opacity: 0 }, { x: 0, scale: 1, rotation: 0, opacity: 1, duration: 1.2, ease: "power4.out" }, 4.25);
    tl.to("#dashboard-window", { scale: 1.045, x: -24, duration: 2.4, ease: "sine.inOut" }, 5.65);
    tl.fromTo("#close .lockup", { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: .5, ease: "power3.out" }, 9.2);
    tl.fromTo("#cta", { scale: .68, opacity: 0 }, { scale: 1, opacity: 1, duration: .72, ease: "back.out(1.8)" }, 9.7);
    SequencesInteractions.compile(tl, document.getElementById("root"));
    window.__timelines["relay-direct"] = tl;
    tl.seek(0);
  </script>
</body>
</html>`;

const client = await McpClient.connect(dir);
try {
  console.log("→ submit_composition");
  console.log(await client.callTool("submit_composition", {
    title: "Relay Direct",
    html,
    storyboard,
  }));
  console.log("\n→ render_preview");
  console.log(await client.callTool("render_preview"));
  if (process.env.VERIFY_RENDER === "1") {
    console.log("\n→ render");
    console.log(await client.callTool("render", { quality: "draft" }));
  }
} finally {
  client.close();
}
