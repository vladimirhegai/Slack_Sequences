/**
 * spark-card — the sparkline metric card (card silhouette): small caps label,
 * hero numeral, and an accent sparkline that draws on via the SVG
 * `pathLength="1"` trick — stroke-dashoffset reads ONE custom property
 * (`--sk-draw` 0→1), and the soft area fill fades in on the same property, so
 * the whole payoff is a single spring-eased var.
 */
import { defineAsset } from "../assetContract.ts";

export const sparkCard = defineAsset({
  version: 1,
  id: "spark-card",
  title: "Sparkline metric card",
  purpose: "Metric card with a hero numeral and a sparkline that draws on",
  family: "card",
  params: [
    {
      name: "label",
      kind: "text",
      description: "Small caps label",
      default: "Weekly active",
      maxChars: 18,
    },
    {
      name: "value",
      kind: "text",
      description: "Hero numeral copy",
      default: "48.2k",
      maxChars: 10,
    },
    {
      name: "accent",
      kind: "color",
      description: "Sparkline + glow accent",
      default: "var(--accent)",
      cssVar: "--sk-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Card width in px",
      default: 420,
      min: 280,
      max: 680,
      cssVar: "--sk-size",
      unit: "px",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: rises and settles with a whisper of overshoot",
      spring: "settle",
      trigger: "enter",
      tracks: [
        { property: "translateY", from: 22, to: 0 },
        { property: "scale", from: 0.93, to: 1 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "draw",
      purpose: "The sparkline draws on left-to-right; the area glow follows it",
      spring: "settle",
      trigger: "payoff",
      preBeat: "from",
      durationSec: 1.1,
      tracks: [{ property: "--sk-draw", from: 0, to: 1 }],
    },
    {
      name: "pulse",
      purpose: "Soft attention beat, there and back",
      spring: "settle",
      yoyo: true,
      tracks: [{ property: "scale", from: 1, to: 1.04 }],
    },
  ],
  style: `
@property --sk-draw { syntax: "<number>"; inherits: true; initial-value: 1; }
.asset-spark-card {
  --sk-draw: 1;
  width: var(--sk-size, 420px);
  font-size: calc(var(--sk-size, 420px) / 420 * 16px);
  padding: 1.15em 1.25em 1em;
  border-radius: var(--cinema-radius, 14px);
  color: var(--text, #edf0f6);
  background:
    radial-gradient(130% 120% at 22% 0%, rgba(255, 255, 255, 0.06), transparent 55%),
    color-mix(in srgb, var(--surface, #161b24) 93%, var(--sk-accent, #6ea8ff) 7%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.11),
    0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.09)),
    0 0.9em 2.2em rgba(0, 0, 0, 0.4);
}
.asset-spark-card .sk-label {
  font-size: 0.7em;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted, #9aa5b4);
}
.asset-spark-card .sk-value {
  margin-top: 0.14em;
  font-size: 1.9em;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.asset-spark-card .sk-chart { display: block; width: 100%; margin-top: 0.7em; overflow: visible; }
.asset-spark-card .sk-line {
  fill: none;
  stroke: var(--sk-accent, #6ea8ff);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: calc(1 - var(--sk-draw, 1));
  filter: drop-shadow(0 0 0.35em color-mix(in srgb, var(--sk-accent, #6ea8ff) 50%, transparent));
}
.asset-spark-card .sk-area {
  fill: var(--sk-accent, #6ea8ff);
  opacity: calc(var(--sk-draw, 1) * 0.14);
}
.asset-spark-card .sk-tip {
  fill: var(--sk-accent, #6ea8ff);
  opacity: clamp(0, calc((var(--sk-draw, 1) - 0.85) / 0.15), 1);
  filter: drop-shadow(0 0 0.4em color-mix(in srgb, var(--sk-accent, #6ea8ff) 70%, transparent));
}
`.trim(),
  render: ({ params, partId, escapeHtml }) =>
    `<div class="sk-label">${escapeHtml(String(params.label))}</div>` +
    `<div class="sk-value" data-part="${partId}-value">${escapeHtml(String(params.value))}</div>` +
    `<svg class="sk-chart" viewBox="0 0 400 110" aria-hidden="true" data-part="${partId}-chart">` +
    `<path class="sk-area" d="M0,92 L48,80 L104,84 L168,58 L232,66 L300,34 L400,16 L400,110 L0,110 Z"/>` +
    `<path class="sk-line" pathLength="1" d="M0,92 L48,80 L104,84 L168,58 L232,66 L300,34 L400,16"/>` +
    `<circle class="sk-tip" cx="400" cy="16" r="5"/>` +
    `</svg>`,
});
