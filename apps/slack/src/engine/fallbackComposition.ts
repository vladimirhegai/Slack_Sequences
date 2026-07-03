import { cinemaKitStyleTag } from "./cinemaKit.ts";
import { CAMERA_RUNTIME_FILE, resolveCameraPlan } from "./cameraContract.ts";
import {
  COMPONENT_RUNTIME_FILE,
  componentKitStyleTag,
  resolveComponentPlan,
} from "./componentContract.ts";
import type { StoryboardMomentV1 } from "./storyboardMoments.ts";
import type { DirectCompositionDraft, DirectScene } from "./directComposition.ts";

interface FallbackCompositionArgs {
  product: string;
  whatShipped: string;
  audience?: string;
  lengthSec?: number;
  frameMd?: string;
}

function text(value: string, limit = 180): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "launch";
}

function frameColor(frameMd: string | undefined, role: string, fallback: string): string {
  const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = frameMd?.match(
    new RegExp(`^\\| ${escaped} \\| \`(#[0-9a-f]{6})\` \\|`, "im"),
  )?.[1];
  return value ?? fallback;
}

function frameFont(frameMd: string | undefined, role: "Display / headlines" | "Body / UI"): string {
  const value = frameMd?.match(new RegExp(`^- \\*\\*${role}:\\*\\* (.+)$`, "im"))?.[1]?.trim();
  return value && /^[\w .,'"-]{1,80}$/.test(value) ? value : "Inter";
}

const r2 = (value: number): number => Math.round(value * 100) / 100;

interface FallbackMomentSpec {
  id: string;
  atSec: number;
  title: string;
  visualState: string;
  change: string;
  motionIntent: string;
  importance: "primary" | "supporting";
}

function moment(sceneId: string, spec: FallbackMomentSpec): StoryboardMomentV1 {
  return { version: 1, sceneId, ...spec, atSec: r2(spec.atSec) };
}

/**
 * A deliberately small, model-free film that remains valid when authoring
 * fails. It obeys the same publication contract as model work: three scenes,
 * a camera world with a typed path, an evidence-bound moment roughly every
 * two seconds, and no quiet stretch — a safe fallback, not a slide deck.
 * Duration is clamped to 20s so the deterministic beat grid stays honest.
 */
export function buildFallbackComposition(
  args: FallbackCompositionArgs,
): DirectCompositionDraft {
  const duration = Math.min(20, Math.max(6, Number(args.lengthSec) || 15));
  const first = r2(duration * 0.3);
  const second = r2(duration * 0.42);
  const third = r2(duration - first - second);
  const starts = [0, first, r2(first + second)];
  const compositionId = `${slug(args.product)}-fallback`;
  const product = text(args.product, 72);
  const shipped = text(args.whatShipped);
  const audience = text(args.audience || "the team", 100);
  const bg = frameColor(args.frameMd, "Canvas", "#071018");
  const surface = frameColor(args.frameMd, "Surface", "#101c27");
  const foreground = frameColor(args.frameMd, "Text", "#f5f7fb");
  const muted = frameColor(args.frameMd, "Muted text", "#a9b7c6");
  const accent = frameColor(args.frameMd, "Committed accent", "#59f1d2");
  const accentText = frameColor(args.frameMd, "Text on accent", "#06100e");
  const display = frameFont(args.frameMd, "Display / headlines");
  const body = frameFont(args.frameMd, "Body / UI");

  // ── Beat grid (all times absolute; every declared moment sits on a beat) ──
  // Hook: headline → tools line → ghost mark → accent rule (back half).
  const hookHead = 0.15;
  const hookTools = r2(Math.max(hookHead + 0.6, first * 0.32));
  const hookMark = r2(first * 0.62);
  const hookRule = r2(first * 0.78);
  // Proof: context copy → audience line → camera pan → proof panel → progress.
  const proofContext = r2(starts[1]! + 0.15);
  const proofAudience = r2(starts[1]! + second * 0.3);
  const holdDur = r2(Math.max(0.3, second * 0.25));
  const panStart = r2(starts[1]! + second * 0.5);
  const panDur = r2(Math.min(0.9, Math.max(0.4, second * 0.25)));
  const proofPanel = r2(panStart + panDur * 0.55);
  const proofProgress = r2(starts[1]! + second * 0.8);
  // Close: lockup → rule → CTA → promise.
  const closeLockup = r2(starts[2]! + 0.2);
  const closeRule = r2(starts[2]! + third * 0.45);
  const closeCta = r2(starts[2]! + third * 0.5);
  const closePromise = r2(Math.min(starts[2]! + third * 0.82, duration - 0.7));

  const storyboard: DirectScene[] = [
    {
      id: "fallback-hook",
      title: `${args.product} shipped`,
      purpose: "State the release clearly",
      startSec: starts[0]!,
      durationSec: first,
      blueprint: "kinetic-type-beats",
      rules: [],
      spatialIntent: {
        version: 1,
        focalPart: "release-headline",
        composition: "layout-editorial-left",
        relationships: ["release headline leads the supporting product mark"],
      },
      moments: [
        moment("fallback-hook", {
          id: "hook-headline",
          atSec: hookHead + 0.15,
          title: "Release headline lands",
          visualState: "Editorial-left frame with the product name arriving",
          change: "The release is named",
          motionIntent: "type-on",
          importance: "primary",
        }),
        moment("fallback-hook", {
          id: "hook-tools",
          atSec: hookTools + 0.1,
          title: "Shipping context line",
          visualState: "Eyebrow and context line under the headline",
          change: "The launch is framed as live",
          motionIntent: "reveal",
          importance: "supporting",
        }),
        moment("fallback-hook", {
          id: "hook-mark",
          atSec: hookMark + 0.1,
          title: "Product mark settles",
          visualState: "Ghost product initial balances the headline",
          change: "Brand presence enters the frame",
          motionIntent: "reveal",
          importance: "supporting",
        }),
      ],
    },
    {
      id: "fallback-proof",
      title: "Release proof",
      purpose: "Give the shipped value room to read",
      startSec: starts[1]!,
      durationSec: second,
      blueprint: "compose",
      rules: [],
      camera: {
        version: 1,
        path: [
          {
            version: 1,
            move: "hold",
            toRegion: "proof-context",
            startSec: starts[1]!,
            durationSec: holdDur,
          },
          {
            version: 1,
            move: "pan",
            toRegion: "proof-panel",
            startSec: panStart,
            durationSec: panDur,
          },
        ],
      },
      components: [
        {
          version: 1,
          id: "release-progress",
          kind: "progress",
          region: "proof-panel",
          role: "support",
        },
      ],
      beats: [
        {
          version: 1,
          id: "proof-progress-beat",
          sceneId: "fallback-proof",
          component: "release-progress",
          kind: "progress",
          atSec: proofProgress,
        },
      ],
      spatialIntent: {
        version: 1,
        focalPart: "release-proof",
        composition: "spatial world: context station panning to the proof station",
        relationships: ["release proof sits one camera move right of the audience context"],
      },
      moments: [
        moment("fallback-proof", {
          id: "proof-context",
          atSec: proofContext + 0.15,
          title: "What-changed station",
          visualState: "Camera holds on the context station",
          change: "The change is introduced",
          motionIntent: "camera-arrival",
          importance: "supporting",
        }),
        moment("fallback-proof", {
          id: "proof-audience",
          atSec: proofAudience + 0.1,
          title: "Audience line lands",
          visualState: "Who this ships for, stated plainly",
          change: "The audience is named",
          motionIntent: "reveal",
          importance: "supporting",
        }),
        moment("fallback-proof", {
          id: "proof-arrival",
          atSec: panStart + panDur * 0.6,
          title: "Camera lands on the proof",
          visualState: "The proof panel fills the frame",
          change: "Travel from context to evidence",
          motionIntent: "camera-arrival",
          importance: "primary",
        }),
        moment("fallback-proof", {
          id: "proof-reveal",
          atSec: proofPanel + 0.2,
          title: "Shipped value reads",
          visualState: "The release statement on the lit proof panel",
          change: "The shipped value is shown",
          motionIntent: "reveal",
          importance: "primary",
        }),
        moment("fallback-proof", {
          id: "proof-progress",
          atSec: proofProgress + 0.1,
          title: "Release progress completes",
          visualState: "Progress rule fills under the proof",
          change: "Shipped state confirmed",
          motionIntent: "ui-state",
          importance: "supporting",
        }),
      ],
    },
    {
      id: "fallback-close",
      title: "Brand resolve",
      purpose: "Close on a confident product action",
      startSec: starts[2]!,
      durationSec: third,
      blueprint: "logo-sting-cta",
      rules: [],
      spatialIntent: {
        version: 1,
        focalPart: "release-cta",
        composition: "layout-center-stack",
        frameAnchor: "frame:center",
        relationships: ["product lockup resolves above the action"],
      },
      moments: [
        moment("fallback-close", {
          id: "close-lockup",
          atSec: closeLockup + 0.15,
          title: "Lockup resolves",
          visualState: "Centered product lockup",
          change: "The film resolves to the brand",
          motionIntent: "resolve",
          importance: "primary",
        }),
        moment("fallback-close", {
          id: "close-cta",
          atSec: closeCta + 0.1,
          title: "Call to action lands",
          visualState: "Accent CTA pill under the lockup",
          change: "The viewer gets the next step",
          motionIntent: "ui-state",
          importance: "primary",
        }),
        moment("fallback-close", {
          id: "close-promise",
          atSec: closePromise + 0.1,
          title: "Promise line settles",
          visualState: "One quiet supporting line; the frame rests",
          change: "Final resolve begins",
          motionIntent: "resolve",
          importance: "supporting",
        }),
      ],
    },
  ];

  const cut = (value: number): string => Math.max(0, value - 0.01).toFixed(2);
  const cameraIsland = JSON.stringify(resolveCameraPlan(storyboard));
  const componentIsland = JSON.stringify(resolveComponentPlan(storyboard));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<title>${product} launch</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>${componentKitStyleTag()}${cinemaKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${bg}}
body{color:${foreground};font-family:${body},Arial,sans-serif}
#root{--space-safe:72px;--space-region:64px;--space-element:28px;--surface:${surface};--accent:${accent};--accent-text:${accentText};--text:${foreground};--muted:${muted};position:relative;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(circle at 80% 12%,${surface},${bg} 52%)}
.scene{position:absolute;inset:0;padding:96px;display:grid;min-width:0;min-height:0;opacity:0}
.layout-editorial-left{grid-template-columns:minmax(0,7fr) minmax(0,5fr);align-items:end;gap:var(--space-region)}
.layout-center-stack{align-content:center;justify-items:center;gap:var(--space-element);text-align:center}
.zone{min-width:0;min-height:0}.stack{display:flex;min-width:0;flex-direction:column;gap:var(--space-element)}
.world{position:absolute;left:0;top:0;width:3200px;height:1080px;transform-origin:0 0}
.region{position:absolute;top:0;height:1080px;display:grid;align-content:center;padding:96px;min-width:0;min-height:0}
.eyebrow{color:${accent};font-size:25px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
h1,h2,p{margin:0}h1,h2{font-family:${display},${body},sans-serif;letter-spacing:-.055em}
h1{max-width:11ch;font-size:150px;line-height:.88}h2{max-width:15ch;font-size:92px;line-height:.96}
.mark{justify-self:end;color:${accent};font-size:230px;font-weight:900;line-height:.8;opacity:.16}
.tools{color:${muted};font-size:30px;letter-spacing:.06em}
.rule{width:280px;height:5px;border-radius:3px;background:${accent};transform:scaleX(0);transform-origin:left}
.proof{padding:54px;border-radius:32px;display:flex;flex-direction:column;gap:34px}
.progress-cap{color:${muted};font-size:24px;letter-spacing:.08em;text-transform:uppercase}
.audience{max-width:24ch;color:${muted};font-size:38px;line-height:1.2}.lockup{font-size:52px;font-weight:900;letter-spacing:-.04em}
.divider{width:220px;height:3px;background:rgba(255,255,255,.22);transform:scaleX(0)}
.cta{padding:28px 48px;border-radius:999px;background:${accent};color:${accentText};font-size:48px;font-weight:850}
.promise{color:${muted};font-size:28px}
</style></head><body>
<main id="root" data-composition-id="${compositionId}" data-width="1920" data-height="1080" data-duration="${duration}">
<section id="fallback-hook" class="scene clip layout-editorial-left" data-scene="fallback-hook" data-start="0" data-duration="${first}" data-track-index="1">
<div class="keylight keylight-tl" data-layout-ignore></div>
<div class="zone stack" data-layout-important><div class="eyebrow">Now shipping</div><h1 data-part="release-headline">${product}</h1><div class="tools" id="hook-tools">Live in your workspace today</div><div class="rule" id="hook-rule"></div></div><div class="mark zone" aria-hidden="true" id="hook-mark">${product.slice(0, 1)}</div>
</section>
<section id="fallback-proof" class="scene clip" style="padding:0" data-scene="fallback-proof" data-start="${starts[1]}" data-duration="${second}" data-track-index="1">
<div class="keylight keylight-c" data-layout-ignore></div>
<div class="world" data-camera-world>
<div class="region" data-region="proof-context" style="left:0;width:1800px">
<div class="zone stack"><div class="eyebrow">What changed</div><p class="audience" id="proof-audience">Built for ${audience}</p></div>
</div>
<div class="region" data-region="proof-panel" style="left:1800px;width:1400px">
<div class="zone proof material-hero" data-layout-important data-part="release-proof"><h2>${shipped}</h2><div class="cmp cmp-progress" data-component="progress" data-part="release-progress"><i data-cmp-fill></i></div><div class="progress-cap" id="proof-cap">Shipped &middot; verified &middot; in the channel</div></div>
</div>
</div>
</section>
<section id="fallback-close" class="scene clip layout-center-stack" data-scene="fallback-close" data-start="${starts[2]}" data-duration="${third}" data-track-index="1">
<span class="bloom" style="width:900px;height:900px;left:50%;top:40%;transform:translate(-50%,-50%)" data-layout-ignore></span>
<div class="zone stack" data-layout-important data-layout-anchor="frame:center" style="align-items:center"><div class="lockup">${product}</div><div class="divider" id="close-rule"></div><div class="cta" data-part="release-cta">See what shipped</div><div class="promise" id="close-promise">From shipped to shown</div></div>
</section></main>
<script type="application/json" id="sequences-camera">${cameraIsland}</script>
<script type="application/json" id="sequences-components">${componentIsland}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#fallback-hook",{opacity:1},0).set("#fallback-hook",{opacity:0},${cut(starts[1]!)});
tl.set("#fallback-proof",{opacity:1},${starts[1]}).set("#fallback-proof",{opacity:0},${cut(starts[2]!)});
tl.set("#fallback-close",{opacity:1},${starts[2]}).set("#fallback-close",{opacity:0},${duration});
tl.fromTo("#fallback-hook h1",{y:80,opacity:0},{y:0,opacity:1,duration:.8,ease:"power4.out"},${hookHead});
tl.fromTo("#fallback-hook .eyebrow",{y:-18,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${r2(hookHead + 0.08)});
tl.fromTo("#hook-tools",{y:26,opacity:0},{y:0,opacity:1,duration:.55,ease:"power3.out"},${hookTools});
tl.fromTo("#hook-mark",{x:70,opacity:0},{x:0,opacity:.16,duration:.7,ease:"seqSettle"},${hookMark});
tl.fromTo("#hook-rule",{scaleX:0},{scaleX:1,duration:.6,ease:"power2.inOut"},${hookRule});
tl.fromTo("#fallback-proof .region[data-region=proof-context] .stack",{y:60,opacity:0},{y:0,opacity:1,duration:.7,ease:"power3.out"},${proofContext});
tl.fromTo("#proof-audience",{y:26,opacity:0},{y:0,opacity:1,duration:.55,ease:"power3.out",immediateRender:false},${proofAudience});
tl.fromTo("#fallback-proof .proof",{x:80,opacity:0},{x:0,opacity:1,duration:.8,ease:"seqSettle"},${proofPanel});
tl.fromTo("#proof-cap",{opacity:0},{opacity:1,duration:.4,ease:"none"},${r2(proofProgress + 0.35)});
tl.fromTo("#fallback-close .zone",{scale:.9,opacity:0},{scale:1,opacity:1,duration:.75,ease:"power4.out"},${closeLockup});
tl.fromTo("#close-rule",{scaleX:0},{scaleX:1,duration:.5,ease:"power2.inOut"},${closeRule});
tl.fromTo("#fallback-close .cta",{y:44,opacity:0},{y:0,opacity:1,duration:.6,ease:"seqMicrobounce"},${closeCta});
tl.fromTo("#close-promise",{y:18,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},${closePromise});
SequencesCamera.compile(tl,document.querySelector("[data-composition-id]"));
SequencesComponents.compile(tl,document.querySelector("[data-composition-id]"));
window.__timelines["${compositionId}"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}
