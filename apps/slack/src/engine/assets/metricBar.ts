/**
 * metric-bar — the horizontal meter of the metric family (bar silhouette):
 * label left, hero value right, and an accent fill that draws to its declared
 * percentage with a real settle. Fill rides ONE custom property the static
 * stylesheet reads (`--mb-fill` → scaleX), so the byte-stable CSS never
 * changes with params and the payoff is a pure timeline function.
 */
import { defineAsset } from "../assetContract.ts";

export const metricBar = defineAsset({
  version: 1,
  id: "metric-bar",
  title: "Metric meter bar",
  purpose: "One labeled metric with an accent meter that fills to its value",
  family: "bar",
  params: [
    {
      name: "label",
      kind: "text",
      description: "Small caps label",
      default: "Deploy time",
      maxChars: 18,
    },
    {
      name: "value",
      kind: "text",
      description: "Hero value copy",
      default: "1.8s",
      maxChars: 10,
    },
    {
      name: "fill",
      kind: "number",
      description: "Meter completion 0–100",
      default: 72,
      min: 0,
      max: 100,
      cssVar: "--mb-fill",
    },
    {
      name: "accent",
      kind: "color",
      description: "Meter + glow accent",
      default: "var(--accent)",
      cssVar: "--mb-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Bar width in px",
      default: 420,
      min: 260,
      max: 760,
      cssVar: "--mb-size",
      unit: "px",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: pops up from below with one overshoot",
      spring: "pop",
      trigger: "enter",
      tracks: [
        { property: "translateY", from: 18, to: 0 },
        { property: "scale", from: 0.9, to: 1 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "fill",
      purpose: "The meter draws to its declared value with a ~3% settle",
      spring: "settle",
      trigger: "payoff",
      preBeat: "from",
      durationSec: 1.0,
      tracks: [{ property: "--mb-fill", from: 0, to: "$fill" }],
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
@property --mb-fill { syntax: "<number>"; inherits: true; initial-value: 72; }
.asset-metric-bar {
  --mb-fill: 72;
  width: var(--mb-size, 420px);
  font-size: calc(var(--mb-size, 420px) / 420 * 16px);
  display: grid;
  gap: 0.62em;
  color: var(--text, #edf0f6);
}
.asset-metric-bar .mb-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1em;
}
.asset-metric-bar .mb-label {
  font-size: 0.72em;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted, #9aa5b4);
}
.asset-metric-bar .mb-value {
  font-size: 1.5em;
  font-weight: 700;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}
.asset-metric-bar .mb-track {
  height: 0.75em;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-2, #1d2430) 85%, var(--mb-accent, #6ea8ff) 6%);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.35),
    inset 0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.07));
  overflow: hidden;
}
.asset-metric-bar .mb-fill {
  height: 100%;
  border-radius: inherit;
  transform-origin: left center;
  transform: scaleX(calc(var(--mb-fill, 72) / 100));
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--mb-accent, #6ea8ff) 78%, var(--surface, #161b24)),
    var(--mb-accent, #6ea8ff)
  );
  box-shadow: 0 0 0.9em color-mix(in srgb, var(--mb-accent, #6ea8ff) 45%, transparent);
}
`.trim(),
  render: ({ params, partId, escapeHtml }) =>
    `<div class="mb-head">` +
    `<div class="mb-label">${escapeHtml(String(params.label))}</div>` +
    `<div class="mb-value" data-part="${partId}-value">${escapeHtml(String(params.value))}</div>` +
    `</div>` +
    `<div class="mb-track"><div class="mb-fill" data-part="${partId}-fill"></div></div>`,
});
