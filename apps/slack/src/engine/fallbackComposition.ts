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

/** A deliberately small, model-free film that remains valid when authoring fails. */
export function buildFallbackComposition(
  args: FallbackCompositionArgs,
): DirectCompositionDraft {
  const duration = Math.min(60, Math.max(6, Number(args.lengthSec) || 15));
  const first = Math.max(1.5, Math.round(duration * 0.3 * 100) / 100);
  const second = Math.max(1.5, Math.round(duration * 0.42 * 100) / 100);
  const third = Math.round((duration - first - second) * 100) / 100;
  const starts = [0, first, first + second];
  const durations = [first, second, third];
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

  const storyboard: DirectScene[] = [
    {
      id: "fallback-hook",
      title: `${args.product} shipped`,
      purpose: "State the release clearly",
      startSec: starts[0]!,
      durationSec: durations[0]!,
      blueprint: "kinetic-type-beats",
      rules: [],
      spatialIntent: {
        version: 1,
        focalPart: "release-headline",
        composition: "layout-editorial-left",
        relationships: ["release headline leads the supporting product mark"],
      },
    },
    {
      id: "fallback-proof",
      title: "Release proof",
      purpose: "Give the shipped value room to read",
      startSec: starts[1]!,
      durationSec: durations[1]!,
      blueprint: "compose",
      rules: [],
      spatialIntent: {
        version: 1,
        focalPart: "release-proof",
        composition: "layout-split",
        relationships: ["release proof sits beside the audience context"],
      },
    },
    {
      id: "fallback-close",
      title: "Brand resolve",
      purpose: "Close on a confident product action",
      startSec: starts[2]!,
      durationSec: durations[2]!,
      blueprint: "logo-sting-cta",
      rules: [],
      spatialIntent: {
        version: 1,
        focalPart: "release-cta",
        composition: "layout-center-stack",
        frameAnchor: "frame:center",
        relationships: ["product lockup resolves above the action"],
      },
    },
  ];

  const cut = (value: number): string => Math.max(0, value - 0.01).toFixed(2);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<title>${product} launch</title><script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${bg}}
body{color:${foreground};font-family:${body},Arial,sans-serif}
#root{--space-safe:72px;--space-region:64px;--space-element:28px;position:relative;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(circle at 80% 12%,${surface},${bg} 52%)}
.scene{position:absolute;inset:0;padding:96px;display:grid;min-width:0;min-height:0;opacity:0}
.layout-editorial-left{grid-template-columns:minmax(0,7fr) minmax(0,5fr);align-items:end;gap:var(--space-region)}
.layout-split{grid-template-columns:minmax(0,5fr) minmax(0,7fr);align-items:center;gap:var(--space-region)}
.layout-center-stack{align-content:center;justify-items:center;gap:var(--space-region);text-align:center}
.zone{min-width:0;min-height:0}.stack{display:flex;min-width:0;flex-direction:column;gap:var(--space-element)}
.eyebrow{color:${accent};font-size:25px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
h1,h2,p{margin:0}h1,h2{font-family:${display},${body},sans-serif;letter-spacing:-.055em}
h1{max-width:11ch;font-size:150px;line-height:.88}h2{max-width:15ch;font-size:92px;line-height:.96}
.mark{justify-self:end;color:${accent};font-size:230px;font-weight:900;line-height:.8;opacity:.16}
.proof{padding:54px;border:1px solid color-mix(in srgb,${accent} 35%,transparent);border-radius:32px;background:${surface};box-shadow:0 36px 100px #0008}
.audience{max-width:24ch;color:${muted};font-size:38px;line-height:1.2}.lockup{font-size:52px;font-weight:900;letter-spacing:-.04em}
.cta{padding:28px 48px;border-radius:999px;background:${accent};color:${accentText};font-size:48px;font-weight:850}
</style></head><body>
<main id="root" data-composition-id="${compositionId}" data-width="1920" data-height="1080" data-duration="${duration}">
<section id="fallback-hook" class="scene clip layout-editorial-left" data-scene="fallback-hook" data-start="0" data-duration="${first}" data-track-index="1">
<div class="zone stack" data-layout-important><div class="eyebrow">Now shipping</div><h1 data-part="release-headline">${product}</h1></div><div class="mark zone" aria-hidden="true">${product.slice(0, 1)}</div>
</section>
<section id="fallback-proof" class="scene clip layout-split" data-scene="fallback-proof" data-start="${starts[1]}" data-duration="${second}" data-track-index="1">
<div class="zone stack"><div class="eyebrow">What changed</div><p class="audience">Built for ${audience}</p></div>
<div class="zone proof" data-layout-important data-part="release-proof"><h2>${shipped}</h2></div>
</section>
<section id="fallback-close" class="scene clip layout-center-stack" data-scene="fallback-close" data-start="${starts[2]}" data-duration="${third}" data-track-index="1">
<div class="zone stack" data-layout-important data-layout-anchor="frame:center"><div class="lockup">${product}</div><div class="cta" data-part="release-cta">See what shipped</div></div>
</section></main><script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#fallback-hook",{opacity:1},0).set("#fallback-hook",{opacity:0},${cut(starts[1]!)});
tl.set("#fallback-proof",{opacity:1},${starts[1]}).set("#fallback-proof",{opacity:0},${cut(starts[2]!)});
tl.set("#fallback-close",{opacity:1},${starts[2]}).set("#fallback-close",{opacity:0},${duration});
tl.fromTo("#fallback-hook .stack",{y:80,opacity:0},{y:0,opacity:1,duration:.8,ease:"power4.out"},.15);
tl.fromTo("#fallback-proof .proof",{x:120,opacity:0},{x:0,opacity:1,duration:.9,ease:"power4.out"},${(starts[1]! + 0.2).toFixed(2)});
tl.fromTo("#fallback-close .zone",{scale:.84,opacity:0},{scale:1,opacity:1,duration:.75,ease:"back.out(1.5)"},${(starts[2]! + 0.2).toFixed(2)});
window.__timelines["${compositionId}"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}
