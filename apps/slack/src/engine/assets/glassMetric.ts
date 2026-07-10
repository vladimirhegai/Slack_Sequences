/**
 * glass-metric — the reference asset (ASSETS.md): a glassmorphic stat
 * medallion — accent conic progress ring around a lit glass disc holding one
 * hero numeral and a small caps label. Exists to prove the contract end to
 * end: typed tweakable params (accent / size / ring / copy / tone), brand
 * tokens with fallbacks (`--surface`, `--text`, `--muted`, so a frame.md
 * palette rethemes it for free), spring-driven invokable animations (a bouncy
 * `expand`, never linear), and a `circle` silhouette that rhymes with
 * stat-card / progress-ring / modal for morph and match cuts.
 *
 * Styling rules the whole library follows:
 * - size rides ONE custom property; every interior length is em against a
 *   font-size derived from it, so scaling never breaks proportions;
 * - params enter CSS only as root custom properties (`--gm-*`);
 * - `@property` registers animatable numeric custom properties so ring fill
 *   interpolates (Chromium — both the film renderer and the Asset Lab).
 */
import { defineAsset } from "../assetContract.ts";

export const glassMetric = defineAsset({
  version: 1,
  id: "glass-metric",
  title: "Glass metric medallion",
  purpose: "One hero stat in a lit glass medallion with an accent progress ring",
  family: "circle",
  params: [
    {
      name: "accent",
      kind: "color",
      description: "Ring + glow accent (brand accent by default)",
      default: "var(--accent)",
      cssVar: "--gm-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Diameter in px",
      default: 260,
      min: 140,
      max: 420,
      cssVar: "--gm-size",
      unit: "px",
    },
    {
      name: "ring",
      kind: "number",
      description: "Ring completion 0–100",
      default: 78,
      min: 0,
      max: 100,
      cssVar: "--gm-ring",
    },
    {
      name: "value",
      kind: "text",
      description: "Hero numeral copy",
      default: "99.98%",
      maxChars: 12,
    },
    {
      name: "label",
      kind: "text",
      description: "Small caps label under the numeral",
      default: "Uptime",
      maxChars: 18,
    },
    {
      name: "tone",
      kind: "enum",
      description: "Surface treatment",
      default: "glass",
      options: ["glass", "solid", "outline"],
      attr: "tone",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: rises and pops to rest with one overshoot",
      spring: "pop",
      trigger: "enter",
      tracks: [
        { property: "scale", from: 0.72, to: 1 },
        { property: "translateY", from: 26, to: 0 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "expand",
      purpose: "Emphasis: grows with a real bounce (never a linear ease-out)",
      spring: "bounce",
      tracks: [{ property: "scale", from: 1, to: 1.14 }],
    },
    {
      name: "pulse",
      purpose: "Soft attention beat, there and back",
      spring: "settle",
      yoyo: true,
      tracks: [{ property: "scale", from: 1, to: 1.05 }],
    },
    {
      name: "ring-fill",
      purpose: "Draws the progress ring to its declared value, settling with ~3% overshoot",
      spring: "settle",
      trigger: "payoff",
      preBeat: "from",
      durationSec: 1.1,
      tracks: [{ property: "--gm-ring", from: 0, to: "$ring" }],
    },
  ],
  style: `
@property --gm-ring { syntax: "<number>"; inherits: true; initial-value: 0; }
.asset-glass-metric {
  --gm-ring: 78;
  position: relative;
  width: var(--gm-size, 260px);
  height: var(--gm-size, 260px);
  display: grid;
  place-items: center;
  color: var(--text, #edf0f6);
  font-size: calc(var(--gm-size, 260px) / 260 * 24px);
  font-variant-numeric: tabular-nums;
}
.asset-glass-metric .gm-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from -90deg,
    var(--gm-accent, #6ea8ff) calc(var(--gm-ring, 0) * 1%),
    color-mix(in srgb, var(--gm-accent, #6ea8ff) 14%, transparent) 0
  );
  -webkit-mask: radial-gradient(closest-side, transparent calc(100% - 0.62em), #000 calc(100% - 0.56em));
  mask: radial-gradient(closest-side, transparent calc(100% - 0.62em), #000 calc(100% - 0.56em));
  filter: drop-shadow(0 0 0.55em color-mix(in srgb, var(--gm-accent, #6ea8ff) 40%, transparent));
}
.asset-glass-metric .gm-disc {
  position: absolute;
  inset: 1em;
  border-radius: 50%;
  display: grid;
  place-content: center;
  text-align: center;
  gap: 0.18em;
  background:
    radial-gradient(120% 120% at 30% 18%, rgba(255, 255, 255, 0.10), transparent 55%),
    color-mix(in srgb, var(--surface, #161b24) 90%, var(--gm-accent, #6ea8ff) 10%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1.1em 2em rgba(0, 0, 0, 0.32),
    0 0.9em 2.2em rgba(0, 0, 0, 0.42);
}
.asset-glass-metric[data-tone="solid"] .gm-disc {
  background: color-mix(in srgb, var(--gm-accent, #6ea8ff) 26%, var(--surface, #161b24));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 0.9em 2.2em rgba(0, 0, 0, 0.42);
}
.asset-glass-metric[data-tone="outline"] .gm-disc {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.12));
}
.asset-glass-metric .gm-value {
  font-size: 1.55em;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.05;
}
.asset-glass-metric .gm-label {
  font-size: 0.6em;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted, #9aa5b4);
}
`.trim(),
  render: ({ params, partId, escapeHtml }) =>
    `<div class="gm-ring"></div>` +
    `<div class="gm-disc" data-part="${partId}-disc">` +
    `<div class="gm-value" data-part="${partId}-value">${escapeHtml(String(params.value))}</div>` +
    `<div class="gm-label">${escapeHtml(String(params.label))}</div>` +
    `</div>`,
});
