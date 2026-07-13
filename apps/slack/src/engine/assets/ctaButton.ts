/**
 * cta-button — the closing-ask hero button (pill silhouette): accent capsule
 * with a soft radial bloom behind it (intensity is a tweakable param). The
 * payoff is a decisive press acknowledgment — scale down-and-back on a snap
 * spring — because a launch film's CTA should be SEEN being committed to.
 */
import { defineAsset } from "../assetContract.ts";

export const ctaButton = defineAsset({
  version: 1,
  id: "cta-button",
  title: "Hero CTA button",
  purpose: "The closing call-to-action capsule with a brand bloom and a real press",
  family: "pill",
  params: [
    {
      name: "label",
      kind: "text",
      description: "Button copy",
      default: "Start shipping",
      maxChars: 22,
    },
    {
      name: "accent",
      kind: "color",
      description: "Capsule + bloom accent",
      default: "var(--accent)",
      cssVar: "--cb-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Button height in px",
      default: 84,
      min: 56,
      max: 140,
      cssVar: "--cb-size",
      unit: "px",
    },
    {
      name: "glow",
      kind: "number",
      description: "Bloom intensity 0–100",
      default: 50,
      min: 0,
      max: 100,
      cssVar: "--cb-glow",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: pops up with one confident overshoot",
      spring: "pop",
      trigger: "enter",
      tracks: [
        { property: "translateY", from: 18, to: 0 },
        { property: "scale", from: 0.82, to: 1 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "press",
      purpose: "Commitment: a decisive press down and back, never bouncy",
      spring: "snap",
      trigger: "payoff",
      yoyo: true,
      durationSec: 0.24,
      tracks: [{ property: "scale", from: 1, to: 0.955 }],
    },
    {
      name: "bloom",
      purpose: "The brand bloom swells and settles, there and back",
      spring: "settle",
      yoyo: true,
      tracks: [{ property: "--cb-pulse", from: 0, to: 1 }],
    },
  ],
  style: `
@property --cb-pulse { syntax: "<number>"; inherits: true; initial-value: 0; }
.asset-cta-button {
  --cb-pulse: 0;
  position: relative;
  height: var(--cb-size, 84px);
  font-size: calc(var(--cb-size, 84px) / 84 * 16px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 1.75em;
  border-radius: 999px;
  font-weight: 650;
  letter-spacing: -0.005em;
  white-space: nowrap;
  color: var(--accent-text, #0b0d11);
  background: linear-gradient(
    177deg,
    color-mix(in srgb, var(--cb-accent, #6ea8ff) 84%, #ffffff),
    var(--cb-accent, #6ea8ff) 58%
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -0.4em 0.7em color-mix(in srgb, var(--cb-accent, #6ea8ff) 52%, rgba(0, 0, 0, 0.32)),
    0 0.16em 0.4em rgba(0, 0, 0, 0.24),
    0 0.7em 1.7em rgba(0, 0, 0, 0.36),
    0 0 calc((var(--cb-glow, 50) / 100) * (1.25em + var(--cb-pulse, 0) * 1.15em))
      color-mix(in srgb, var(--cb-accent, #6ea8ff) calc(32% + var(--cb-pulse, 0) * 22%), transparent);
}
.asset-cta-button .cb-label { font-size: 1.05em; }
.asset-cta-button .cb-arrow {
  margin-left: 0.5em;
  font-size: 1em;
  transform: translateX(calc(var(--cb-pulse, 0) * 0.12em)) translateY(-0.03em);
  opacity: 0.92;
}
`.trim(),
  render: ({ params, partId, escapeHtml }) =>
    `<span class="cb-label" data-part="${partId}-label">${escapeHtml(String(params.label))}</span>` +
    `<span class="cb-arrow" aria-hidden="true">→</span>`,
});
