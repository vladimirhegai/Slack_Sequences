/**
 * team-medallion — the social-proof medallion (circle silhouette): overlapping
 * initial discs inside a ringed field with a "+N" overflow chip. The payoff is
 * a convergence: discs start stacked at center (`--tm-spread` 0) and fan out
 * to their overlap positions — the team assembling, driven by one property.
 */
import { defineAsset } from "../assetContract.ts";

export const teamMedallion = defineAsset({
  version: 1,
  id: "team-medallion",
  title: "Team medallion",
  purpose: "Overlapping teammate avatars in a medallion with a +N overflow chip",
  family: "circle",
  params: [
    {
      name: "initials",
      kind: "text",
      description: "Space-separated initials, e.g. \"AL KD MR\"",
      default: "AL KD MR",
      maxChars: 15,
    },
    {
      name: "more",
      kind: "number",
      description: "The +N overflow count (0 hides the chip)",
      default: 12,
      min: 0,
      max: 99,
    },
    {
      name: "accent",
      kind: "color",
      description: "Disc field accent",
      default: "var(--accent)",
      cssVar: "--tm-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Medallion diameter in px",
      default: 240,
      min: 150,
      max: 380,
      cssVar: "--tm-size",
      unit: "px",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: the medallion bounces in as one object",
      spring: "bounce",
      trigger: "enter",
      durationSec: 0.9,
      tracks: [
        { property: "scale", from: 0.68, to: 1 },
        { property: "translateY", from: 18, to: 0 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "assemble",
      purpose: "The team fans out from center to their overlap seats",
      spring: "settle",
      trigger: "payoff",
      preBeat: "from",
      durationSec: 0.8,
      tracks: [{ property: "--tm-spread", from: 0, to: 1 }],
    },
    {
      name: "expand",
      purpose: "Emphasis: grows with a real bounce",
      spring: "bounce",
      yoyo: true,
      tracks: [{ property: "scale", from: 1, to: 1.1 }],
    },
  ],
  style: `
@property --tm-spread { syntax: "<number>"; inherits: true; initial-value: 1; }
.asset-team-medallion {
  --tm-spread: 1;
  position: relative;
  width: var(--tm-size, 240px);
  height: var(--tm-size, 240px);
  font-size: calc(var(--tm-size, 240px) / 240 * 16px);
  border-radius: 50%;
  display: grid;
  place-content: center;
  color: var(--text, #edf0f6);
  background:
    radial-gradient(120% 120% at 32% 14%, rgba(255, 255, 255, 0.08), transparent 56%),
    color-mix(in srgb, var(--surface, #161b24) 92%, var(--tm-accent, #6ea8ff) 8%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.09)),
    inset 0 -1em 2em rgba(0, 0, 0, 0.3),
    0 0.28em 0.7em rgba(0, 0, 0, 0.3),
    0 1.1em 2.5em rgba(0, 0, 0, 0.42);
}
.asset-team-medallion .tm-row {
  display: flex;
  align-items: center;
  justify-content: center;
}
.asset-team-medallion .tm-disc {
  width: 3.2em;
  height: 3.2em;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.95em;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--accent-text, #0b0d11);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--tm-accent, #6ea8ff) 85%, #ffffff),
    color-mix(in srgb, var(--tm-accent, #6ea8ff) 88%, var(--surface, #161b24)) 70%
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 0 0 0.14em var(--surface, #161b24),
    0 0.4em 1em rgba(0, 0, 0, 0.35);
}
.asset-team-medallion .tm-disc:nth-child(2) {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--tm-accent, #6ea8ff) 55%, var(--surface-2, #1d2430)),
    color-mix(in srgb, var(--tm-accent, #6ea8ff) 35%, var(--surface-2, #1d2430)) 70%
  );
  color: var(--text, #edf0f6);
}
/* Convergence: spread 0 stacks every disc at center (-3.2em collapses each
 * onto the first); spread 1 is the resting overlap row (-1.05em). Transforms
 * only would break the row's measured width, and the film renderer samples
 * discrete frames, so the per-frame layout recompute is free here. */
.asset-team-medallion .tm-disc + .tm-disc {
  margin-left: calc(-3.2em + var(--tm-spread, 1) * 2.15em);
}
.asset-team-medallion .tm-more {
  margin-top: 0.75em;
  justify-self: center;
  padding: 0.28em 0.85em;
  border-radius: 999px;
  font-size: 0.78em;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--muted, #9aa5b4);
  background: color-mix(in srgb, var(--surface-2, #1d2430) 88%, var(--tm-accent, #6ea8ff) 6%);
  box-shadow: inset 0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.08));
  opacity: var(--tm-spread, 1);
}
`.trim(),
  render: ({ params, partId, escapeHtml }) => {
    const initials = String(params.initials).split(/\s+/).filter(Boolean).slice(0, 4);
    const discs = initials
      .map((mark) => `<span class="tm-disc">${escapeHtml(mark.slice(0, 2).toUpperCase())}</span>`)
      .join("");
    const more = Number(params.more);
    return (
      `<div class="tm-row" data-part="${partId}-row">${discs}</div>` +
      (more > 0 ? `<div class="tm-more">+${Math.round(more)} teammates</div>` : "")
    );
  },
});
