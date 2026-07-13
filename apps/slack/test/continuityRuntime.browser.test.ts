import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { launchHeadlessBrowser } from "../src/engine/browserLifecycle.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { CAMERA_RUNTIME_FILE, cameraRuntimeSource, resolveCameraPlan } from "../src/engine/cameraContract.ts";
import {
  CONTINUITY_RUNTIME_FILE,
  continuityRuntimeSource,
  resolveContinuityGraph,
} from "../src/engine/continuityGraph.ts";
import { resolveCameraBlockingPlan } from "../src/engine/cameraBlocking.ts";
import {
  CAMERA_PHRASE_TOLERANCES,
  collapseCameraPhrases,
  compileCameraPhrasePlan,
  type CameraPhraseSeedV1,
  type CameraPhraseV1,
} from "../src/engine/cameraPhrase.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function storyboard(): DirectScene[] {
  return [0, 1, 2].map((index): DirectScene => ({
    id: `scene-${index + 1}`,
    title: `Scene ${index + 1}`,
    purpose: "keep the same product world visible",
    startSec: index * 3,
    durationSec: 3,
    components: [{
      version: 1,
      id: `shell-${index + 1}`,
      kind: "app-window",
      role: "hero",
      entityId: "product-shell",
    }],
    beats: [{
      version: 1,
      id: `state-${index + 1}`,
      sceneId: `scene-${index + 1}`,
      component: `shell-${index + 1}`,
      kind: "set-state",
      atSec: index * 3 + 1,
      durationSec: 0.5,
      toState: "ready",
    }],
    moments: [{
      version: 1,
      id: `moment-${index + 1}`,
      sceneId: `scene-${index + 1}`,
      atSec: index * 3 + 1.5,
      title: "Product state",
      visualState: "The product shell is readable",
      change: "State advances",
      motionIntent: "ui-state",
      importance: "primary",
    }],
    spatialIntent: {
      version: 1,
      focalPart: `shell-${index + 1}`,
      composition: "centered product",
      relationships: [],
    },
    camera: {
      version: 1,
      path: [{
        version: 1,
        move: "hold",
        toPart: `shell-${index + 1}`,
        startSec: index * 3,
        durationSec: 3,
      }],
    },
    ...(index < 2 ? { cut: { version: 1, style: "hard" as const } } : {}),
  }));
}

function film(options: { authoredLateSupport?: boolean; dimSecondTarget?: boolean } = {}): string {
  const scenes = storyboard();
  if (options.authoredLateSupport) {
    scenes[0]!.camera = {
      version: 1,
      path: [{
        version: 1,
        move: "hold",
        toPart: "shell-1",
        startSec: 0,
        durationSec: 2,
      }, {
        version: 1,
        move: "pan",
        toPart: "late-support",
        startSec: 2,
        durationSec: 1,
      }],
    };
  }
  const graph = resolveContinuityGraph(scenes);
  const blocking = resolveCameraBlockingPlan(scenes, graph);
  const firstPrimary = blocking.scenes[0]!.phrases.find((phrase) => phrase.importance === "primary")!;
  const augmentedPhrases: CameraPhraseV1[] = [...blocking.scenes[0]!.phrases, {
    ...firstPrimary,
    id: "scene-1:late-support:blocking",
    phraseId: "late-support",
    importance: "supporting",
    routeOwnership: options.authoredLateSupport ? "authored" : "host-derived",
    startSec: 2.1,
    arrivalSec: 2.4,
    endSec: 2.9,
    target: { kind: "part", id: "late-support" },
    framingTarget: undefined,
    framingOccupancy: undefined,
    occupancy: { min: 0.04, preferred: 0.16, max: 0.3 },
    dwell: { startSec: 2.4, endSec: 2.9, readableSec: 0.5 },
    nextHandoff: undefined,
  }, {
    ...firstPrimary,
    id: "scene-1:same-target-read:blocking",
    phraseId: "same-target-read",
    importance: "supporting",
    startSec: 2.05,
    arrivalSec: 2.15,
    endSec: 2.9,
    dwell: { startSec: 2.15, endSec: 2.9, readableSec: 0.75 },
    nextHandoff: undefined,
  }];
  const recollapsed = collapseCameraPhrases(augmentedPhrases);
  blocking.scenes[0]!.phrases = recollapsed.phrases;
  blocking.summary.phraseCount = blocking.scenes.reduce(
    (count, scene) => count + scene.phrases.length,
    0,
  );
  const camera = resolveCameraPlan(scenes);
  const section = scenes.map((scene, index) => `
<section id="${scene.id}" class="scene" data-scene="${scene.id}">
  <div class="world" data-camera-world>
    <div class="station" data-region="station-${index + 1}">
      <div class="shell" data-component="app-window" data-part="shell-${index + 1}" data-continuity-entity="product-shell"${options.dimSecondTarget && index === 1 ? ' style="opacity:.35"' : ""}>Product ${index + 1}</div>
      ${index === 0 ? '<div class="late-support" data-part="late-support">Annotation</div>' : ""}
    </div>
  </div>
</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script><script src="${CONTINUITY_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#07101d}
#root,.scene{position:absolute;inset:0;overflow:hidden}.scene{opacity:0}.world{position:relative;width:1920px;height:1080px}
.station{position:absolute;inset:0}.shell{position:absolute;left:120px;top:230px;width:500px;height:300px;border-radius:24px;background:#13283d;border:3px solid #55f0c5;color:#fff;display:grid;place-items:center;font:700 48px Arial}.late-support{position:absolute;left:1540px;top:780px;width:120px;height:64px;background:#f6c945}</style></head><body>
<main id="root" data-composition-id="continuity-browser" data-width="1920" data-height="1080" data-duration="9">${section}</main>
<script type="application/json" id="sequences-camera">${JSON.stringify(camera)}</script>
<script type="application/json" id="sequences-continuity">${JSON.stringify(graph)}</script>
<script type="application/json" id="sequences-camera-blocking">${JSON.stringify(blocking)}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});
tl.set("#scene-1",{opacity:1},0).set("#scene-1",{opacity:0},3);
tl.set("#scene-2",{opacity:1},3).set("#scene-2",{opacity:0},6);
tl.set("#scene-3",{opacity:1},6).set("#scene-3",{opacity:0},9);
SequencesCamera.compile(tl,document.getElementById("root"));
SequencesContinuity.compile(tl,document.getElementById("root"));
window.__timelines["continuity-browser"]=tl;tl.seek(0,false);</script></body></html>`;
}

function approachFilm(): string {
  const scenes: DirectScene[] = [{
    id: "approach-scene",
    title: "Approach a contextual metric",
    purpose: "browse a broad station, then land a readable metric",
    startSec: 0,
    durationSec: 4,
    components: [{
      version: 1,
      id: "primary-metric",
      kind: "progress-ring",
      region: "overview-station",
      role: "hero",
      entityId: "metric",
    }],
    beats: [{
      version: 1,
      id: "metric-progress",
      sceneId: "approach-scene",
      component: "primary-metric",
      kind: "progress",
      atSec: 2.5,
      durationSec: 0.7,
      value: 92,
    }],
    moments: [{
      version: 1,
      id: "metric-landing",
      sceneId: "approach-scene",
      atSec: 2.6,
      title: "Metric lands",
      visualState: "The metric is readable inside its overview",
      change: "The camera completes its browse",
      motionIntent: "camera-arrival",
      importance: "primary",
    }],
    spatialIntent: {
      version: 1,
      focalPart: "primary-metric",
      composition: "centered metric inside a broad overview",
      relationships: ["the station remains context while the metric owns the eye"],
    },
    camera: {
      version: 1,
      path: [{
        version: 1,
        move: "pan",
        toRegion: "overview-station",
        startSec: 0,
        durationSec: 2.5,
        ease: "seqDrift",
      }, {
        version: 1,
        move: "track-to-anchor",
        toPart: "primary-metric",
        startSec: 2.5,
        durationSec: 1.1,
        ease: "seqSettle",
      }],
    },
  }];
  const graph = resolveContinuityGraph(scenes);
  const blocking = resolveCameraBlockingPlan(scenes, graph);
  const primary = blocking.scenes[0]!.phrases.find((phrase) => phrase.importance === "primary")!;
  // Keep this fixture about the generic route shape, independent of direction
  // score phrase splitting: an authored opening pan has 2.5s to approach one
  // primary part, then an operated hold returns to the exact landing pose.
  primary.startSec = 0;
  primary.arrivalSec = 2.5;
  primary.dwell = { startSec: 2.5, endSec: 3.8, readableSec: 1.3 };
  blocking.scenes[0]!.phrases = [primary];
  const camera = resolveCameraPlan(scenes);
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script><script src="${CONTINUITY_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#fff}
#root,.scene{position:absolute;inset:0;overflow:hidden}.world{position:relative;width:1920px;height:1080px}
.station{position:absolute;left:80px;top:80px;width:1760px;height:920px;border:2px solid #ddd;background:#faf8f5}
.metric{position:absolute;left:160px;top:290px;width:220px;height:180px;border-radius:30px;background:#ff5a5f;color:#fff;display:grid;place-items:center;font:700 48px Arial}
  .context-title{position:absolute;left:110px;top:72px;width:620px;font:700 48px Arial;color:#171717}
  .companion{position:absolute;left:790px;top:180px;width:760px;height:520px;background:#eee;border-radius:40px}</style></head><body>
<main id="root" data-composition-id="approach-browser" data-width="1920" data-height="1080" data-duration="4">
<section class="scene" data-scene="approach-scene"><div class="world" data-camera-world>
  <div class="station" data-region="overview-station">
    <div class="context-title">Confirmed bookings</div>
    <div class="metric" data-component="progress-ring" data-part="primary-metric" data-continuity-entity="metric">92%</div>
    <div class="companion" data-layout-important>Context panel</div>
  </div>
</div></section></main>
<script type="application/json" id="sequences-camera">${JSON.stringify(camera)}</script>
<script type="application/json" id="sequences-continuity">${JSON.stringify(graph)}</script>
<script type="application/json" id="sequences-camera-blocking">${JSON.stringify(blocking)}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});
SequencesCamera.compile(tl,document.getElementById("root"));
SequencesContinuity.compile(tl,document.getElementById("root"));
window.__timelines["approach-browser"]=tl;tl.seek(0,false);</script></body></html>`;
}

/** S6.12 Probe B minimized shape: two overlapping primary continuity routes
 * demand opposite world stations while the typed focal and click both name
 * the Slack surface. The compiler must keep that one route on-frame. */
function competingStationFilm(): string {
  const center = { x: 0.5, y: 0.5, name: "center" as const };
  const camera = {
    version: 1 as const,
    scenes: [{
      sceneId: "brief",
      segments: [{
        move: "hold" as const,
        startSec: 0,
        endSec: 4,
        blend: 0 as const,
        zoom: 1,
        ease: "none",
        toRegion: "slack-station",
      }],
    }],
  };
  const phrase = (
    id: string,
    target: string,
    region: string,
    arrivalSec: number,
    dwellEnd: number,
    entityId: string,
  ): CameraPhraseSeedV1 => ({
    id: `brief:${id}:blocking`,
    sceneId: "brief",
    phraseId: `brief:${id}`,
    role: "payoff",
    importance: "primary",
    startSec: 0.2,
    arrivalSec,
    endSec: 1.5,
    target: { kind: "part", id: target, entityId },
    framingTarget: { kind: "region", id: region },
    occupancy: { min: 0.08, preferred: 0.2, max: 0.5 },
    framingOccupancy: { min: 0.16, preferred: 0.3, max: 0.56 },
    arrivalPose: { target: { kind: "region", id: region }, anchor: center, lens: "fit", zoom: 1 },
    corridor: { from: center, to: center, padding: 0.08 },
    dwell: { startSec: arrivalSec, endSec: dwellEnd, readableSec: dwellEnd - arrivalSec },
    settleUntilSec: arrivalSec + 0.2,
    nextHandoff: { entityId, toScene: "next", toPart: target, atSec: 4 },
  });
  const blocking = compileCameraPhrasePlan({
    cameraPlan: camera,
    solver: {
      curve: "minimum-jerk-quintic",
      measuredDom: true,
      maxNormalizedVelocity: 1.9,
      maxNormalizedAcceleration: 5.8,
      maxNormalizedJerk: 60,
    },
    scenes: [{
      sceneId: "brief",
      preferredTarget: "slack-chat",
      interactionTargets: ["slack-chat"],
      phrases: [
        phrase("context", "context-feed", "context-station", 0.28, 1.28, "trace"),
        phrase("chat", "slack-chat", "slack-station", 0.34, 1.05, "product-shell"),
      ],
    }],
  });
  const continuity = {
    version: 1,
    enabled: true,
    entities: [],
    edges: [],
    summary: {
      entityCount: 0,
      multiShotEntityCount: 0,
      threeShotEntityCount: 0,
      sharedElementHandoffCount: 0,
    },
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script><script src="${CONTINUITY_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#f5f6f8}#root,.scene{position:absolute;inset:0;overflow:hidden}.world{position:relative;width:3520px;height:1080px}.station{position:absolute;top:140px;width:1400px;height:800px;display:grid;place-items:center}.slack{left:260px}.context{left:1860px}.surface{width:680px;height:500px;border-radius:24px;background:#fff;border:2px solid #6840c6;color:#171717;display:grid;place-items:center;font:700 54px Arial}</style></head><body>
<main id="root" data-composition-id="competing-stations" data-width="1920" data-height="1080" data-duration="4"><section class="scene" data-scene="brief"><div class="world" data-camera-world><div class="station slack" data-region="slack-station"><div class="surface" data-part="slack-chat">Release brief</div></div><div class="station context" data-region="context-station"><div class="surface" data-part="context-feed">Retrieved context</div></div></div></section></main>
<script type="application/json" id="sequences-camera">${JSON.stringify(camera)}</script><script type="application/json" id="sequences-continuity">${JSON.stringify(continuity)}</script><script type="application/json" id="sequences-camera-blocking">${JSON.stringify(blocking)}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});SequencesCamera.compile(tl,document.getElementById("root"));SequencesContinuity.compile(tl,document.getElementById("root"));window.__timelines["competing-stations"]=tl;tl.seek(0,false);</script></body></html>`;
}

function singleSubjectContextFilm(svgMetric = false): string {
  const scenes: DirectScene[] = [{
    id: "recovery-metric",
    title: "Recovery metric",
    purpose: "land one recovery statistic inside its named station",
    startSec: 0,
    durationSec: 4,
    components: [{
      version: 1,
      id: "recovery-stat",
      kind: svgMetric ? "progress-ring" : "stat-card",
      region: "metric-wall",
      role: "hero",
      entityId: "metric",
    }],
    beats: [{
      version: 1,
      id: "stat-count",
      sceneId: "recovery-metric",
      component: "recovery-stat",
      kind: "count",
      atSec: 0.5,
      durationSec: 1.5,
      value: 94,
    }],
    moments: [{
      version: 1,
      id: "recovery-stat-lands",
      sceneId: "recovery-metric",
      atSec: 0.8,
      title: "Recovery statistic lands",
      visualState: "The recovery statistic is readable",
      change: "The count resolves",
      motionIntent: "count",
      importance: "primary",
    }],
    spatialIntent: {
      version: 1,
      focalPart: "recovery-stat",
      frameAnchor: "frame:center",
      composition: "centered recovery statistic",
      relationships: [],
    },
    camera: {
      version: 1,
      path: [{
        version: 1,
        move: "pull-back",
        fromRegion: "metric-wall",
        toRegion: "metric-wall",
        startSec: 0,
        durationSec: 2.6,
      }],
    },
  }];
  const graph = resolveContinuityGraph(scenes);
  const blocking = resolveCameraBlockingPlan(scenes, graph);
  const primary = blocking.scenes[0]!.phrases.find((phrase) =>
    phrase.importance === "primary" && phrase.target.id === "recovery-stat"
  );
  if (!primary) throw new Error("single-subject fixture did not resolve its primary metric");
  primary.startSec = 0;
  primary.arrivalSec = 0;
  primary.endSec = 2;
  primary.dwell = { startSec: 0, endSec: 2.5, readableSec: 2.5 };
  blocking.scenes[0]!.phrases = [primary];
  const camera = resolveCameraPlan(scenes);
  const compositionId = svgMetric ? "svg-subject-context" : "single-subject-context";
  const metricCss = svgMetric
    ? `.metric{position:relative;width:360px;height:360px;color:#171717;display:grid;place-items:center;font:900 96px Arial}.metric svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}.metric circle{fill:none;stroke:#5c4a63;stroke-width:5}.metric span{position:relative;z-index:1}`
    : `.metric{width:620px;height:340px;border:2px solid #5c4a63;border-radius:20px;background:#fff;color:#171717;display:grid;place-items:center;font:900 120px Arial}`;
  const metricMarkup = svgMetric
    ? `<div class="metric" data-layout-important data-component="progress-ring" data-part="recovery-stat" data-continuity-entity="metric"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52"/></svg><span>94%</span></div>`
    : `<div class="metric" data-layout-important data-component="stat-card" data-part="recovery-stat" data-continuity-entity="metric">94%</div>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script><script src="${CONTINUITY_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#fff}
#root,.scene{position:absolute;inset:0;overflow:hidden}.world{position:relative;width:3520px;height:1080px}
.station{position:absolute;left:1860px;top:140px;width:1400px;height:800px;display:flex;align-items:center;justify-content:center;background:#fff}
${metricCss}</style></head><body>
<main id="root" data-composition-id="${compositionId}" data-width="1920" data-height="1080" data-duration="4">
<section class="scene" data-scene="recovery-metric"><div class="world" data-camera-world>
<div class="station" data-region="metric-wall">${metricMarkup}</div>
</div></section></main>
<script type="application/json" id="sequences-camera">${JSON.stringify(camera)}</script>
<script type="application/json" id="sequences-continuity">${JSON.stringify(graph)}</script>
<script type="application/json" id="sequences-camera-blocking">${JSON.stringify(blocking)}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});
SequencesCamera.compile(tl,document.getElementById("root"));
SequencesContinuity.compile(tl,document.getElementById("root"));
window.__timelines["${compositionId}"]=tl;tl.seek(0,false);</script></body></html>`;
}

function longTailFilm(): string {
  const scenes: DirectScene[] = [{
    id: "tail-scene",
    title: "Long readable result",
    purpose: "hold a product result without freezing",
    startSec: 0,
    durationSec: 6,
    components: [{
      version: 1,
      id: "result-card",
      kind: "stat-card",
      role: "hero",
      entityId: "result",
    }],
    beats: [{
      version: 1,
      id: "result-count",
      sceneId: "tail-scene",
      component: "result-card",
      kind: "count",
      atSec: 0.7,
      durationSec: 0.5,
      value: 98,
    }],
    moments: [{
      version: 1,
      id: "result-lands",
      sceneId: "tail-scene",
      atSec: 1,
      title: "Result lands",
      visualState: "The result is readable",
      change: "Count resolves",
      motionIntent: "count",
      importance: "primary",
    }],
    spatialIntent: {
      version: 1,
      focalPart: "result-card",
      composition: "centered result",
      relationships: [],
    },
    camera: {
      version: 1,
      path: [{
        version: 1,
        move: "hold",
        toPart: "result-card",
        startSec: 0,
        durationSec: 6,
      }],
    },
  }];
  const graph = resolveContinuityGraph(scenes);
  const blocking = resolveCameraBlockingPlan(scenes, graph);
  const primary = blocking.scenes[0]!.phrases.find((phrase) => phrase.importance === "primary")!;
  primary.startSec = 0;
  primary.arrivalSec = 0.6;
  primary.endSec = 1.8;
  primary.dwell = { startSec: 0.6, endSec: 1.6, readableSec: 1 };
  blocking.scenes[0]!.phrases = [primary];
  const camera = resolveCameraPlan(scenes);
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script><script src="${CONTINUITY_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#fff}
#root,.scene{position:absolute;inset:0;overflow:hidden}.world{position:relative;width:1920px;height:1080px}
.environment{position:absolute;inset:0;pointer-events:none}.ambient{position:absolute;left:80px;top:80px;width:280px;height:180px;border-radius:80px;background:#ffd2c4}
.card{position:absolute;left:660px;top:340px;width:600px;height:360px;border-radius:40px;background:#ff5a5f;color:#fff;display:grid;place-items:center;font:800 84px Arial}</style></head><body>
<main id="root" data-composition-id="tail-browser" data-width="1920" data-height="1080" data-duration="6">
<section class="scene" data-scene="tail-scene"><div class="environment" data-sequences-environment="generated-field" data-layout-ignore><div class="ambient"></div></div><div class="world" data-camera-world>
<div class="card" data-component="stat-card" data-part="result-card" data-continuity-entity="result">98%</div>
</div></section></main>
<script type="application/json" id="sequences-camera">${JSON.stringify(camera)}</script>
<script type="application/json" id="sequences-continuity">${JSON.stringify(graph)}</script>
<script type="application/json" id="sequences-camera-blocking">${JSON.stringify(blocking)}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});
SequencesCamera.compile(tl,document.getElementById("root"));
tl.fromTo(".ambient",{x:0},{x:4,duration:6,ease:"none"},0);
SequencesContinuity.compile(tl,document.getElementById("root"));
window.__timelines["tail-browser"]=tl;tl.seek(0,false);</script></body></html>`;
}

function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dir, "." + pathname.replace(/\/$/, "/index.html"));
      if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file)) {
        response.writeHead(404); response.end(); return;
      }
      response.writeHead(200, {
        "content-type": path.extname(file) === ".js" ? "text/javascript" : "text/html",
      });
      response.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("could not bind"));
      resolve({
        url: `http://127.0.0.1:${address.port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * Exact-shape regression distilled from the LumaFlow paid probe:
 * 1) two dense primary targets share a station, but the opening card must own
 *    its first readable landing instead of being replaced by a button union;
 * 2) a shipped badge opens before its CTA lockup becomes load-bearing, then a
 *    later wide pose must include that newly active context.
 */
function probeBlockingRegressionFilm(): string {
  const camera = {
    version: 1,
    scenes: [{
      sceneId: "dense-entry",
      segments: [{
        move: "hold", startSec: 0, endSec: 4, blend: 0, zoom: 1,
        ease: "none", toPart: "primary-card", fromPart: "primary-card",
      }],
    }, {
      sceneId: "deferred-context",
      segments: [{
        move: "hold", startSec: 4, endSec: 8, blend: 0, zoom: 1,
        ease: "none", toPart: "shipped-badge", fromPart: "shipped-badge",
      }],
    }],
  };
  const center = { x: 0.5, y: 0.5, name: "center" as const };
  const blocking = {
    version: 1,
    enabled: true,
    solver: {
      curve: "minimum-jerk-quintic",
      measuredDom: true,
      maxNormalizedVelocity: 1.9,
      maxNormalizedAcceleration: 5.8,
      maxNormalizedJerk: 60,
    },
    scenes: [{
      sceneId: "dense-entry",
      phrases: [{
        id: "dense-entry:card", sceneId: "dense-entry", phraseId: "card",
        role: "entry", importance: "primary", startSec: 0, arrivalSec: 0,
        endSec: 0.8, target: { kind: "part", id: "primary-card" },
        occupancy: { min: 0.015, preferred: 0.06, max: 0.24 },
        arrivalPose: { anchor: center, lens: "detail", zoom: 1 },
        corridor: { from: center, to: center, padding: 0.08 },
        dwell: { startSec: 0, endSec: 0.72, readableSec: 0.72 },
      }, {
        id: "dense-entry:button", sceneId: "dense-entry", phraseId: "button",
        role: "payoff", importance: "primary", startSec: 0.8, arrivalSec: 1,
        endSec: 1.8, target: { kind: "part", id: "approve-button", entityKind: "cta" },
        framingTarget: { kind: "region", id: "decision-station" },
        occupancy: { min: 0.018, preferred: 0.055, max: 0.14 },
        framingOccupancy: { min: 0.1, preferred: 0.22, max: 0.42 },
        arrivalPose: { anchor: center, lens: "detail", zoom: 1 },
        corridor: { from: center, to: center, padding: 0.08 },
        dwell: { startSec: 1, endSec: 1.7, readableSec: 0.7 },
      }],
    }, {
      sceneId: "deferred-context",
      phrases: [{
        id: "deferred-context:badge", sceneId: "deferred-context", phraseId: "badge",
        role: "payoff", importance: "primary", startSec: 4, arrivalSec: 4,
        endSec: 5, target: { kind: "part", id: "shipped-badge", entityKind: "metric" },
        framingTarget: { kind: "region", id: "resolve-station" },
        occupancy: { min: 0.02, preferred: 0.08, max: 0.22 },
        framingOccupancy: { min: 0.08, preferred: 0.14, max: 0.28 },
        arrivalPose: { anchor: center, lens: "detail", zoom: 1 },
        corridor: { from: center, to: center, padding: 0.08 },
        dwell: { startSec: 4, endSec: 4.8, readableSec: 0.8 },
      }, {
        id: "deferred-context:wide", sceneId: "deferred-context", phraseId: "wide",
        role: "payoff", importance: "primary", startSec: 5.5, arrivalSec: 6,
        endSec: 7.5, target: { kind: "part", id: "shipped-badge", entityKind: "metric" },
        framingTarget: { kind: "region", id: "resolve-station" },
        occupancy: { min: 0.02, preferred: 0.08, max: 0.22 },
        framingOccupancy: { min: 0.08, preferred: 0.14, max: 0.28 },
        arrivalPose: { anchor: center, lens: "wide", zoom: 0.72 },
        corridor: { from: center, to: center, padding: 0.08 },
        dwell: { startSec: 6, endSec: 7.2, readableSec: 1.2 },
      }],
    }],
  };
  const continuity = {
    version: 1,
    enabled: true,
    entities: [],
    edges: [],
    summary: {
      entityCount: 0,
      multiShotEntityCount: 0,
      threeShotEntityCount: 0,
      sharedElementHandoffCount: 0,
    },
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script><script src="${CONTINUITY_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#fff}
#root,.scene{position:absolute;inset:0;overflow:hidden}.scene{opacity:0}.world{position:relative;width:1920px;height:1080px}
.decision{position:absolute;left:260px;top:140px;width:1400px;height:800px}.primary-card{position:absolute;left:360px;top:80px;width:680px;height:300px;background:#181d28;color:#fff;border-radius:28px}.approve{position:absolute;left:610px;top:660px;width:180px;height:64px;background:#ff385c;border-radius:32px}
.resolve{position:absolute;left:260px;top:140px;width:1400px;height:800px}.future-lockup{position:absolute;left:100px;top:70px;width:1200px;height:300px;background:#f6f7fa;border-radius:32px}.badge{position:absolute;left:630px;top:520px;width:140px;height:140px;background:#ff385c;border-radius:50%}</style></head><body>
<main id="root" data-composition-id="probe-blocking" data-width="1920" data-height="1080" data-duration="8">
<section class="scene" data-scene="dense-entry"><div class="world" data-camera-world><div class="decision" data-region="decision-station"><div class="primary-card" data-part="primary-card">Risk card</div><div class="approve" data-part="approve-button">Approve</div></div></div></section>
<section class="scene" data-scene="deferred-context"><div class="world" data-camera-world><div class="resolve" data-region="resolve-station"><div class="future-lockup" data-layout-important data-layout-important-from="5.5" data-part="cta-lockup">Ship with calm</div><div class="badge" data-layout-important data-part="shipped-badge">Shipped</div></div></div></section>
</main>
<script type="application/json" id="sequences-camera">${JSON.stringify(camera)}</script>
<script type="application/json" id="sequences-continuity">${JSON.stringify(continuity)}</script>
<script type="application/json" id="sequences-camera-blocking">${JSON.stringify(blocking)}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});
tl.set('[data-scene="dense-entry"]',{opacity:1},0).set('[data-scene="dense-entry"]',{opacity:0},4);
tl.set('[data-scene="deferred-context"]',{opacity:1},4).set('[data-scene="deferred-context"]',{opacity:0},8);
tl.set('.future-lockup',{opacity:0},0).set('.future-lockup',{opacity:1},5.5);
SequencesCamera.compile(tl,document.getElementById("root"));SequencesContinuity.compile(tl,document.getElementById("root"));
window.__timelines["probe-blocking"]=tl;tl.seek(0,false);</script></body></html>`;
}

/** GatePilot exact-shape: an entry cut and a delayed primary whip share one
 * contextual station. The entry and primary carry different solo occupancy,
 * but the same ensemble fit; without the compact authored opening approach
 * the graph route is pixel-static through the claimed camera moment. */
function cutEntryImpactFilm(): string {
  const center = { x: 0.5, y: 0.5, name: "center" as const };
  const camera = {
    version: 1,
    scenes: [{
      sceneId: "gate",
      segments: [
        { move: "hold", startSec: 1, endSec: 1.35, blend: 0, zoom: 1, ease: "none", toRegion: "gate-station", fromPart: "approve" },
        { move: "drift", startSec: 1.35, endSec: 1.68, blend: 0.24, zoom: 1, ease: "seqDrift", toRegion: "gate-station" },
        { move: "drift", startSec: 1.68, endSec: 1.9, blend: 0.06, zoom: 1, ease: "seqAnticipate", toRegion: "gate-station" },
        { move: "whip", startSec: 1.9, endSec: 2.7, blend: 1, zoom: 1, ease: "seqWhip", toRegion: "gate-station" },
        { move: "drift", startSec: 2.7, endSec: 4, blend: 0, zoom: 1, ease: "seqDrift", toRegion: "gate-station" },
      ],
    }],
  };
  const phrase = {
    sceneId: "gate",
    target: { kind: "part" as const, id: "approve", entityKind: "cta" as const },
    framingTarget: { kind: "region" as const, id: "gate-station" },
    framingOccupancy: { min: 0.1, preferred: 0.22, max: 0.42 },
    arrivalPose: { anchor: center, lens: "detail" as const, zoom: 1 },
    corridor: { from: center, to: center, padding: 0.08 },
  };
  const rawPhrases: CameraPhraseV1[] = [{
    ...phrase,
    id: "gate:entry",
    phraseId: "gate:01",
    role: "entry",
    importance: "supporting",
    routeOwnership: "host-derived",
    evidenceOwner: { kind: "direction-phrase", id: "gate:01" },
    startSec: 1,
    arrivalSec: 1,
    endSec: 1.35,
    occupancy: { min: 0.008, preferred: 0.025, max: 0.08 },
    sourcePose: { target: { kind: "part", id: "approve" }, anchor: center, lens: "detail", zoom: 1 },
    travel: { startSec: 1, endSec: 1 },
    settle: { startSec: 1, endSec: 1.1 },
    dwell: { startSec: 1, endSec: 1.38, readableSec: 0.38 },
    departure: { startSec: 1.38, endSec: 1.38 },
  }, {
    ...phrase,
    id: "gate:whip",
    phraseId: "gate:02",
    role: "payoff",
    importance: "primary",
    routeOwnership: "authored",
    evidenceOwner: { kind: "camera-segment", id: "gate:whip@1.9" },
    startSec: 1.35,
    arrivalSec: 2.35,
    endSec: 2.35,
    occupancy: { min: 0.018, preferred: 0.055, max: 0.14 },
    sourcePose: { target: { kind: "part", id: "approve" }, anchor: center, lens: "detail", zoom: 1 },
    travel: { startSec: 1.9, endSec: 2.35 },
    settle: { startSec: 2.35, endSec: 2.47 },
    dwell: { startSec: 2.35, endSec: 2.97, readableSec: 0.62 },
    departure: { startSec: 2.97, endSec: 2.97 },
  }];
  const phrases = collapseCameraPhrases(rawPhrases).phrases;
  const blocking = {
    version: 1,
    enabled: true,
    solver: {
      curve: "minimum-jerk-quintic",
      measuredDom: true,
      maxNormalizedVelocity: 1.9,
      maxNormalizedAcceleration: 5.8,
      maxNormalizedJerk: 60,
    },
    tolerances: CAMERA_PHRASE_TOLERANCES,
    scenes: [{
      sceneId: "gate",
      phrases,
    }],
  };
  const continuity = {
    version: 1,
    enabled: true,
    entities: [],
    edges: [],
    summary: { entityCount: 0, multiShotEntityCount: 0, threeShotEntityCount: 0, sharedElementHandoffCount: 0 },
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script><script src="${CONTINUITY_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#07101d}#root,.scene{position:absolute;inset:0;overflow:hidden}.scene{opacity:0}.world{position:relative;width:1920px;height:1080px}.station{position:absolute;left:360px;top:170px;width:1200px;height:740px;background:#16263a;border:2px solid #f6b94a}.metric{position:absolute;left:420px;top:110px;width:360px;height:180px;background:#233d58}.approve{position:absolute;left:470px;top:390px;width:260px;height:100px;border-radius:50px;background:#f6b94a;color:#07101d;display:grid;place-items:center;font:700 38px Arial}</style></head><body>
<main id="root" data-composition-id="cut-entry-impact" data-width="1920" data-height="1080" data-duration="4">
<section class="scene" data-scene="before"></section><section class="scene" data-scene="gate"><div class="world" data-camera-world><div class="station" data-region="gate-station"><div class="metric">96%</div><div class="approve" data-part="approve" data-component="button">Approve</div></div></div></section></main>
<script type="application/json" id="sequences-camera">${JSON.stringify(camera)}</script><script type="application/json" id="sequences-continuity">${JSON.stringify(continuity)}</script><script type="application/json" id="sequences-camera-blocking">${JSON.stringify(blocking)}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});tl.set('[data-scene="before"]',{opacity:1},0).set('[data-scene="before"]',{opacity:0},1).set('[data-scene="gate"]',{opacity:1},1);SequencesCamera.compile(tl,document.getElementById('root'));SequencesContinuity.compile(tl,document.getElementById('root'));window.__timelines['cut-entry-impact']=tl;tl.seek(0,false);</script></body></html>`;
}

describe("continuity + camera blocking browser runtime", () => {
  it("keeps the typed focal on-frame when competing continuity routes overlap", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-competing-stations-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), competingStationFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const state = await page.evaluate(() => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["competing-stations"]!;
        timeline.seek(0.97, false);
        const root = document.getElementById("root")!.getBoundingClientRect();
        const chat = document.querySelector<HTMLElement>('[data-part="slack-chat"]')!
          .getBoundingClientRect();
        const plan = JSON.parse(document.getElementById("sequences-camera-blocking")!.textContent!);
        const visibleWidth = Math.max(0, Math.min(root.right, chat.right) - Math.max(root.left, chat.left));
        const visibleHeight = Math.max(0, Math.min(root.bottom, chat.bottom) - Math.max(root.top, chat.top));
        return {
          target: plan.scenes[0].phrases[0].target.id,
          phraseCount: plan.scenes[0].phrases.length,
          collapsed: plan.scenes[0].phrases[0].collapsedPhraseIds,
          visibleFraction: visibleWidth * visibleHeight / (chat.width * chat.height),
        };
      });
      expect(state).toMatchObject({
        target: "slack-chat",
        phraseCount: 1,
        collapsed: ["brief:context"],
      });
      expect(state.visibleFraction).toBeGreaterThanOrEqual(0.85);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("preserves a visible compact whip after a same-pose cut entry settles", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-cut-entry-impact-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), cutEntryImpactFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const transformAt = (time: number) => page.evaluate((at: number) => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["cut-entry-impact"]!;
        timeline.seek(at, false);
        return document.querySelector<HTMLElement>('[data-scene="gate"] [data-camera-world]')!
          .style.transform;
      }, time);
      const before = await transformAt(1.82);
      const during = await transformAt(2.12);
      const landed = await transformAt(2.36);
      expect(new Set([before, during, landed]).size).toBe(3);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it("lands measured product occupancy and carries the entity through hard cuts deterministically", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-continuity-browser-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), film(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.waitForFunction(() => Boolean((window as unknown as { __timelines?: object }).__timelines));
      const stateAt = (time: number) => page.evaluate((at: number) => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["continuity-browser"]!;
        timeline.seek(at, false);
        const shell = document.querySelector<HTMLElement>(at < 3 ? '[data-part="shell-1"]' : '[data-part="shell-2"]')!;
        const rect = shell.getBoundingClientRect();
        const bridges = Array.from(document.querySelectorAll<HTMLElement>("[data-sequences-runtime-continuity]"))
          .map((element) => ({ opacity: Number(getComputedStyle(element).opacity), transform: element.style.transform }))
          // Hidden future bridges do not paint; their live-measured geometry is
          // intentionally refreshed only when their own boundary activates.
          .filter((bridge) => bridge.opacity > 0.001);
        return {
          occupancy: rect.width * rect.height / (1920 * 1080),
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          bridges,
          bindings: (window as unknown as { __sequencesContinuityBindings?: unknown[] }).__sequencesContinuityBindings ?? [],
          world: document.querySelector<HTMLElement>(at < 3 ? "#scene-1 .world" : "#scene-2 .world")!.style.transform,
        };
      }, time);

      const landing = await stateAt(1.5);
      expect(landing.occupancy).toBeGreaterThan(0.35);
      expect(landing.occupancy).toBeLessThan(0.5);
      // A readable landing is operated, not frozen: the camera runtime may
      // float by at most ~0.6% of the short frame edge while remaining inside
      // a tight eight-pixel anchor budget.
      expect(Math.abs(landing.centerX - 960)).toBeLessThanOrEqual(8);
      expect(Math.abs(landing.centerY - 540)).toBeLessThanOrEqual(8);
      expect(landing.bindings).toHaveLength(2);
      // A late supporting annotation remains local motion; after a primary
      // camera block exists it cannot pull the lens into an epilogue reframe.
      const afterLateSupport = await stateAt(2.8);
      expect(afterLateSupport.occupancy).toBeGreaterThan(0.35);
      expect(afterLateSupport.occupancy).toBeLessThan(0.5);
      expect(Math.abs(afterLateSupport.centerX - 960)).toBeLessThanOrEqual(12);
      expect(Math.abs(afterLateSupport.centerY - 540)).toBeLessThanOrEqual(12);
      // A supporting phrase on the SAME owned pose extends the operated hold
      // without reframing to the unrelated annotation.
      const samePoseStart = await stateAt(2.15);
      const samePoseAlive = await stateAt(2.48);
      expect(Math.hypot(
        samePoseAlive.centerX - samePoseStart.centerX,
        samePoseAlive.centerY - samePoseStart.centerY,
      )).toBeGreaterThan(0.25);
      const handoff = await stateAt(3.05);
      expect(handoff.bridges.some((bridge) => bridge.opacity > 0.05)).toBe(true);
      await stateAt(8.5);
      await stateAt(0.2);
      expect(await stateAt(3.05)).toEqual(handoff);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("honors an authored full move to a supporting destination", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-authored-support-browser-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), film({ authoredLateSupport: true }), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const landing = await page.evaluate(() => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["continuity-browser"]!;
        timeline.seek(2.8, false);
        const rect = document.querySelector<HTMLElement>('[data-part="late-support"]')!
          .getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      });
      expect(landing.left).toBeGreaterThanOrEqual(0);
      expect(landing.top).toBeGreaterThanOrEqual(0);
      expect(landing.right).toBeLessThanOrEqual(1920);
      expect(landing.bottom).toBeLessThanOrEqual(1080);
      expect(Math.abs(landing.centerX - 960)).toBeLessThanOrEqual(12);
      expect(Math.abs(landing.centerY - 540)).toBeLessThanOrEqual(12);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("restores a shared-element destination's authored resting opacity", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-dim-handoff-browser-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), film({ dimSecondTarget: true }), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const opacity = await page.evaluate(() => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["continuity-browser"]!;
        timeline.seek(3.8, false);
        return Number(getComputedStyle(
          document.querySelector<HTMLElement>('[data-part="shell-2"]')!,
        ).opacity);
      });
      expect(opacity).toBeCloseTo(0.35, 2);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("spends an authored opener on a macro approach, then holds a contextual primary readably", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-camera-approach-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), approachFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const stateAt = (time: number) => page.evaluate((at: number) => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["approach-browser"]!;
        timeline.seek(at, false);
        const metric = document.querySelector<HTMLElement>('[data-part="primary-metric"]')!;
        const rect = metric.getBoundingClientRect();
        const companion = document.querySelector<HTMLElement>(".companion")!.getBoundingClientRect();
        const contextTitle = document.querySelector<HTMLElement>(".context-title")!.getBoundingClientRect();
        return {
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          occupancy: rect.width * rect.height / (1920 * 1080),
          companion: {
            left: companion.left,
            top: companion.top,
            right: companion.right,
            bottom: companion.bottom,
          },
          contextTitle: {
            left: contextTitle.left,
            top: contextTitle.top,
            right: contextTitle.right,
            bottom: contextTitle.bottom,
          },
          world: document.querySelector<HTMLElement>(".world")!.style.transform,
        };
      }, time);

      const opening = await stateAt(0);
      const middle = await stateAt(1.25);
      const landed = await stateAt(2.5);
      const alive = await stateAt(3.05);
      const returned = await stateAt(3.8);
      const openingContextDistance = Math.hypot(
        (opening.companion.left + opening.companion.right) / 2 -
          (landed.companion.left + landed.companion.right) / 2,
        (opening.companion.top + opening.companion.bottom) / 2 -
          (landed.companion.top + landed.companion.bottom) / 2,
      );
      const middleContextDistance = Math.hypot(
        (middle.companion.left + middle.companion.right) / 2 -
          (landed.companion.left + landed.companion.right) / 2,
        (middle.companion.top + middle.companion.bottom) / 2 -
          (landed.companion.top + landed.companion.bottom) / 2,
      );
      // The surrounding ensemble performs the macro approach while the
      // addressed metric stays comparatively stable: visible travel without
      // making the viewer reacquire the subject.
      expect(openingContextDistance).toBeGreaterThan(75);
      expect(middleContextDistance).toBeGreaterThan(15);
      expect(middleContextDistance).toBeLessThan(130);
      // The metric remains visibly readable while its declared contextual
      // companion owns the ensemble occupancy. A coherent ensemble beats
      // cropping the panel merely to satisfy the child's solo area floor.
      expect(landed.occupancy).toBeGreaterThanOrEqual(0.004);
      expect(landed.companion.left).toBeGreaterThanOrEqual(60);
      expect(landed.companion.top).toBeGreaterThanOrEqual(60);
      expect(landed.companion.right).toBeLessThanOrEqual(1860);
      expect(landed.companion.bottom).toBeLessThanOrEqual(1020);
      expect(landed.contextTitle.left).toBeGreaterThanOrEqual(60);
      expect(landed.contextTitle.top).toBeGreaterThanOrEqual(60);
      expect(landed.contextTitle.right).toBeLessThanOrEqual(1860);
      expect(landed.contextTitle.bottom).toBeLessThanOrEqual(1020);
      expect(landed.centerX).toBeGreaterThanOrEqual(85);
      expect(landed.centerX).toBeLessThanOrEqual(1835);
      expect(landed.centerY).toBeGreaterThanOrEqual(85);
      expect(landed.centerY).toBeLessThanOrEqual(995);
      // A short dwell is the audience's reading window: the lens now RESTS
      // through it (no float, no scale breathe) so glyphs are not in constant
      // subpixel motion — the measured "shaky text" source on the
      // motion-quality-verify-1 render. Long merged holds keep their
      // translate-only drift (proven by the merged-dwell test above).
      const livingDistance = Math.hypot(
        alive.centerX - landed.centerX,
        alive.centerY - landed.centerY,
      );
      expect(livingDistance).toBeLessThan(0.25);
      expect(Math.abs(returned.centerX - landed.centerX)).toBeLessThan(0.25);
      expect(Math.abs(returned.centerY - landed.centerY)).toBeLessThan(0.25);
      expect(new Set([opening.world, middle.world]).size).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("uses subject occupancy when a named context collapses to that same subject", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-camera-single-context-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), singleSubjectContextFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const occupancy = await page.evaluate(() => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["single-subject-context"]!;
        timeline.seek(0.6, false);
        const rect = document.querySelector<HTMLElement>('[data-part="recovery-stat"]')!
          .getBoundingClientRect();
        return rect.width * rect.height / (1920 * 1080);
      });

      // `stat-card` primary contract: 1.5–24%. The enclosing station has no
      // independent painted context, so its 30% ensemble preference must not
      // be applied to the exact same measured rectangle.
      expect(occupancy).toBeGreaterThanOrEqual(0.015 * 0.9);
      expect(occupancy).toBeLessThanOrEqual(0.24 * 1.1);
      expect(Math.abs(occupancy - 0.06)).toBeLessThan(0.005);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("measures SVG media in layout space before solving a collapsed metric station", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-camera-svg-context-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), singleSubjectContextFilm(true), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const occupancy = await page.evaluate(() => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["svg-subject-context"]!;
        timeline.seek(0.6, false);
        const rect = document.querySelector<HTMLElement>('[data-part="recovery-stat"]')!
          .getBoundingClientRect();
        return rect.width * rect.height / (1920 * 1080);
      });

      // The SVG fills the transparent component root. It is real framing
      // content even though SVG does not expose HTMLElement offsetWidth.
      // The named station therefore collapses to the metric and its 2â€“22%
      // subject contract binds; treating the SVG as 1px over-zooms to ~36%.
      expect(occupancy).toBeGreaterThanOrEqual(0.02 * 0.9);
      expect(occupancy).toBeLessThanOrEqual(0.22 * 1.1);
      expect(Math.abs(occupancy - 0.08)).toBeLessThan(0.008);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("protects an opening primary from dense preblocking and frames only context active at each landing", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-camera-probe-regression-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), probeBlockingRegressionFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const stateAt = (time: number) => page.evaluate((at: number) => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["probe-blocking"]!;
        timeline.seek(at, false);
        const read = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)!;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            opacity: Number.parseFloat(getComputedStyle(element).opacity),
          };
        };
        return {
          card: read('[data-part="primary-card"]'),
          badge: read('[data-part="shipped-badge"]'),
          lockup: read('[data-part="cta-lockup"]'),
        };
      }, time);

      const entry = await stateAt(0.2);
      const cardCenter = {
        x: (entry.card.left + entry.card.right) / 2,
        y: (entry.card.top + entry.card.bottom) / 2,
      };
      const cardOccupancy = entry.card.width * entry.card.height / (1920 * 1080);
      expect(Math.abs(cardCenter.x - 960)).toBeLessThan(2);
      expect(Math.abs(cardCenter.y - 540)).toBeLessThan(2);
      expect(cardOccupancy).toBeGreaterThanOrEqual(0.015);
      expect(cardOccupancy).toBeLessThanOrEqual(0.24);

      const badgeLanding = await stateAt(4.2);
      const badgeOccupancy = badgeLanding.badge.width * badgeLanding.badge.height / (1920 * 1080);
      expect(badgeLanding.lockup.opacity).toBe(0);
      expect(badgeOccupancy).toBeGreaterThanOrEqual(0.02 * 0.9);
      expect(badgeOccupancy).toBeLessThanOrEqual(0.22 * 1.1);

      const wide = await stateAt(6.1);
      expect(wide.lockup.opacity).toBe(1);
      expect(wide.lockup.left).toBeGreaterThanOrEqual(60);
      expect(wide.lockup.top).toBeGreaterThanOrEqual(60);
      expect(wide.lockup.right).toBeLessThanOrEqual(1860);
      expect(wide.lockup.bottom).toBeLessThanOrEqual(1020);
      const union = {
        left: Math.min(wide.lockup.left, wide.badge.left),
        top: Math.min(wide.lockup.top, wide.badge.top),
        right: Math.max(wide.lockup.right, wide.badge.right),
        bottom: Math.max(wide.lockup.bottom, wide.badge.bottom),
      };
      const ensembleOccupancy =
        (union.right - union.left) * (union.bottom - union.top) / (1920 * 1080);
      expect(ensembleOccupancy).toBeGreaterThanOrEqual(0.08 * 0.85);
      expect(ensembleOccupancy).toBeLessThanOrEqual(0.28 * 1.1);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("rests the camera through a multi-second tail while the environment stays alive", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-camera-tail-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), longTailFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CONTINUITY_RUNTIME_FILE), continuityRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const stateAt = (time: number) => page.evaluate((at: number) => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines["tail-browser"]!;
        timeline.seek(at, false);
        const rect = document.querySelector<HTMLElement>('[data-part="result-card"]')!
          .getBoundingClientRect();
        return {
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          visible:
            rect.left >= 0 && rect.top >= 0 &&
            rect.right <= 1920 && rect.bottom <= 1080,
          world: document.querySelector<HTMLElement>("[data-camera-world]")!.style.transform,
          ambient: document.querySelector<HTMLElement>(".ambient")!.style.transform,
        };
      }, time);
      const a = await stateAt(4);
      const b = await stateAt(4.2);
      const dt = 0.2;
      const diagonal = Math.hypot(1920, 1080);
      const speed = Math.hypot(
        (b.centerX - a.centerX) / diagonal / dt,
        (b.centerY - a.centerY) / diagonal / dt,
        Math.log(
          Math.sqrt(b.width * b.height) /
            Math.sqrt(a.width * a.height),
        ) * 0.25 / dt,
      );
      expect(speed).toBeLessThan(0.0001);
      expect(a.world).toBe(b.world);
      expect(a.ambient).not.toBe(b.ambient);
      expect(a.visible).toBe(true);
      expect(b.visible).toBe(true);
      await stateAt(5.8);
      await stateAt(0.2);
      expect(await stateAt(4.2)).toEqual(b);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);
});
