/**
 * browser-hero — the product-frame hero (window family): a lit glass browser
 * chrome holding an abstract product skeleton (hero band + content rows), so a
 * film can show "the product" without the author drawing a fake app. The
 * interior populates via ONE animatable custom property (`--bh-rise` 0→3)
 * that each row reads with its own clamp() window — shader-style staggering
 * that stays a pure function of timeline time (seek-safe by construction).
 */
import { defineAsset } from "../assetContract.ts";

export const browserHero = defineAsset({
  version: 1,
  id: "browser-hero",
  title: "Browser hero frame",
  purpose: "Product-in-a-browser hero: glass chrome, URL pill, skeleton page that populates",
  family: "window",
  params: [
    {
      name: "url",
      kind: "text",
      description: "Address-bar copy",
      default: "acme.app/launch",
      maxChars: 36,
    },
    {
      name: "accent",
      kind: "color",
      description: "Hero band + focus accents",
      default: "var(--accent)",
      cssVar: "--bh-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Frame width in px",
      default: 880,
      min: 520,
      max: 1240,
      cssVar: "--bh-size",
      unit: "px",
    },
    {
      name: "tone",
      kind: "enum",
      description: "Chrome treatment",
      default: "glass",
      options: ["glass", "solid"],
      attr: "tone",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: the frame rises and settles like a set piece, no bounce",
      spring: "gentle",
      trigger: "enter",
      durationSec: 0.9,
      tracks: [
        { property: "scale", from: 0.93, to: 1 },
        { property: "translateY", from: 36, to: 0 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "populate",
      purpose: "The page loads: hero band then content rows rise in one cascade",
      spring: "settle",
      trigger: "payoff",
      preBeat: "from",
      durationSec: 1.2,
      tracks: [{ property: "--bh-rise", from: 0, to: 3 }],
    },
    {
      name: "lift",
      purpose: "Emphasis: the whole frame leans toward the viewer and settles back",
      spring: "settle",
      yoyo: true,
      tracks: [{ property: "scale", from: 1, to: 1.03 }],
    },
  ],
  style: `
@property --bh-rise { syntax: "<number>"; inherits: true; initial-value: 3; }
.asset-browser-hero {
  --bh-rise: 3;
  width: var(--bh-size, 880px);
  font-size: calc(var(--bh-size, 880px) / 880 * 16px);
  border-radius: calc(var(--cinema-radius, 14px) * 1.1);
  overflow: hidden;
  color: var(--text, #edf0f6);
  background: color-mix(in srgb, var(--surface, #161b24) 92%, var(--bh-accent, #6ea8ff) 8%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.10)),
    0 1.6em 3.4em rgba(0, 0, 0, 0.44);
}
.asset-browser-hero[data-tone="glass"] {
  background:
    radial-gradient(140% 90% at 18% 0%, rgba(255, 255, 255, 0.07), transparent 55%),
    color-mix(in srgb, var(--surface, #161b24) 88%, var(--bh-accent, #6ea8ff) 12%);
}
.asset-browser-hero .bh-chrome {
  display: flex;
  align-items: center;
  gap: 0.55em;
  padding: 0.7em 0.9em;
  border-bottom: 1px solid var(--cinema-edge, rgba(255, 255, 255, 0.10));
}
.asset-browser-hero .bh-dot {
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
  background: color-mix(in srgb, var(--muted, #9aa5b4) 55%, transparent);
}
.asset-browser-hero .bh-url {
  flex: 1;
  margin-left: 0.4em;
  padding: 0.34em 0.9em;
  font-size: 0.78em;
  color: var(--muted, #9aa5b4);
  border-radius: 999px;
  background: color-mix(in srgb, var(--canvas, #0a0c10) 72%, transparent);
  box-shadow: inset 0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.08));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-browser-hero .bh-page { padding: 1.1em 1.2em 1.3em; display: grid; gap: 0.85em; }
.asset-browser-hero .bh-band,
.asset-browser-hero .bh-row {
  border-radius: 0.55em;
  opacity: clamp(0, calc(var(--bh-rise, 3) - var(--bh-i, 0)), 1);
  transform: translateY(calc((1 - clamp(0, calc(var(--bh-rise, 3) - var(--bh-i, 0)), 1)) * 1.1em));
}
.asset-browser-hero .bh-band {
  --bh-i: 0;
  height: 6.2em;
  background:
    radial-gradient(120% 160% at 12% 0%, color-mix(in srgb, var(--bh-accent, #6ea8ff) 34%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in srgb, var(--bh-accent, #6ea8ff) 22%, var(--surface-2, #1d2430)), var(--surface-2, #1d2430));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
}
.asset-browser-hero .bh-row {
  height: 2.1em;
  background: color-mix(in srgb, var(--surface-2, #1d2430) 82%, var(--bh-accent, #6ea8ff) 6%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.asset-browser-hero .bh-row-a { --bh-i: 1; }
.asset-browser-hero .bh-row-b { --bh-i: 2; width: 72%; }
`.trim(),
  render: ({ params, partId, escapeHtml }) =>
    `<div class="bh-chrome">` +
    `<i class="bh-dot"></i><i class="bh-dot"></i><i class="bh-dot"></i>` +
    `<div class="bh-url">${escapeHtml(String(params.url))}</div>` +
    `</div>` +
    `<div class="bh-page" data-part="${partId}-page">` +
    `<div class="bh-band" data-part="${partId}-band"></div>` +
    `<div class="bh-row bh-row-a"></div>` +
    `<div class="bh-row bh-row-b"></div>` +
    `</div>`,
});
