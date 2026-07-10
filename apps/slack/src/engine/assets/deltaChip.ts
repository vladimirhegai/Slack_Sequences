/**
 * delta-chip — the trend pill (pill silhouette): an arrow + delta figure in a
 * lit capsule. Direction is an enum attr (`up` rides the brand accent, `down`
 * a tempered warm red mixed toward the text color so it never reads neon).
 * Restraint by design: the pop entrance IS the statement — no auto payoff.
 */
import { defineAsset } from "../assetContract.ts";

export const deltaChip = defineAsset({
  version: 1,
  id: "delta-chip",
  title: "Delta trend chip",
  purpose: "A +38% style trend pill with a directional arrow",
  family: "pill",
  params: [
    {
      name: "value",
      kind: "text",
      description: "Delta copy",
      default: "+38%",
      maxChars: 10,
    },
    {
      name: "direction",
      kind: "enum",
      description: "Trend direction (up = accent, down = tempered red)",
      default: "up",
      options: ["up", "down"],
      attr: "direction",
    },
    {
      name: "accent",
      kind: "color",
      description: "Up-trend accent",
      default: "var(--accent)",
      cssVar: "--dc-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Chip height in px",
      default: 64,
      min: 44,
      max: 120,
      cssVar: "--dc-size",
      unit: "px",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: pops in from below with one crisp overshoot",
      spring: "pop",
      trigger: "enter",
      tracks: [
        { property: "scale", from: 0.72, to: 1 },
        { property: "translateY", from: 14, to: 0 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "pulse",
      purpose: "Soft attention beat, there and back",
      spring: "settle",
      yoyo: true,
      tracks: [{ property: "scale", from: 1, to: 1.06 }],
    },
  ],
  style: `
.asset-delta-chip {
  --dc-tone: var(--dc-accent, #6ea8ff);
  height: var(--dc-size, 64px);
  font-size: calc(var(--dc-size, 64px) / 64 * 16px);
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  padding: 0 1.05em;
  border-radius: 999px;
  color: var(--dc-tone);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.005em;
  background:
    radial-gradient(120% 150% at 30% 0%, rgba(255, 255, 255, 0.07), transparent 55%),
    color-mix(in srgb, var(--dc-tone) 14%, var(--surface, #161b24));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 0 0 1px color-mix(in srgb, var(--dc-tone) 32%, transparent),
    0 0.55em 1.4em rgba(0, 0, 0, 0.32);
}
.asset-delta-chip[data-direction="down"] {
  --dc-tone: color-mix(in srgb, #ff5c7a 72%, var(--text, #edf0f6));
}
.asset-delta-chip .dc-arrow {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 0.34em solid transparent;
  border-right: 0.34em solid transparent;
  border-bottom: 0.5em solid currentColor;
  filter: drop-shadow(0 0 0.35em color-mix(in srgb, var(--dc-tone) 55%, transparent));
}
.asset-delta-chip[data-direction="down"] .dc-arrow {
  border-bottom: none;
  border-top: 0.5em solid currentColor;
}
.asset-delta-chip .dc-value { font-size: 1.05em; }
`.trim(),
  render: ({ params, partId, escapeHtml }) =>
    `<i class="dc-arrow"></i>` +
    `<span class="dc-value" data-part="${partId}-value">${escapeHtml(String(params.value))}</span>`,
});
