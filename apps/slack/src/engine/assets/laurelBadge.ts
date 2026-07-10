/**
 * laurel-badge — the award seal (circle silhouette): SVG laurel branches
 * flanking a two-line award lockup on a lit disc. The celebratory register:
 * a real bounce on arrival (the one place two visible bounces are earned) and
 * a gloss sweep payoff riding one custom property through an overflow-hidden
 * disc (off-disc at both endpoints, so no opacity choreography needed).
 */
import { defineAsset } from "../assetContract.ts";

export const laurelBadge = defineAsset({
  version: 1,
  id: "laurel-badge",
  title: "Laurel award badge",
  purpose: "Social-proof award seal with laurel branches and a gloss shine",
  family: "circle",
  params: [
    {
      name: "label",
      kind: "text",
      description: "Small caps context line",
      default: "Product Hunt",
      maxChars: 16,
    },
    {
      name: "title",
      kind: "text",
      description: "The award claim",
      default: "#1 of the Day",
      maxChars: 28,
    },
    {
      name: "accent",
      kind: "color",
      description: "Laurel + shine accent",
      default: "var(--accent)",
      cssVar: "--lb-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Badge diameter in px",
      default: 300,
      min: 180,
      max: 460,
      cssVar: "--lb-size",
      unit: "px",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: lands with a real celebratory bounce and a straightening tilt",
      spring: "bounce",
      trigger: "enter",
      tracks: [
        { property: "scale", from: 0.62, to: 1 },
        { property: "rotate", from: -8, to: 0 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "shine",
      purpose: "A gloss band sweeps across the seal — the trophy-case glint",
      spring: "settle",
      trigger: "payoff",
      durationSec: 0.9,
      tracks: [{ property: "--lb-shine", from: -1, to: 1 }],
    },
    {
      name: "pulse",
      purpose: "Soft attention beat, there and back",
      spring: "settle",
      yoyo: true,
      tracks: [{ property: "scale", from: 1, to: 1.05 }],
    },
  ],
  style: `
@property --lb-shine { syntax: "<number>"; inherits: true; initial-value: -1; }
.asset-laurel-badge {
  --lb-shine: -1;
  position: relative;
  width: var(--lb-size, 300px);
  height: var(--lb-size, 300px);
  font-size: calc(var(--lb-size, 300px) / 300 * 16px);
  border-radius: 50%;
  display: grid;
  place-content: center;
  text-align: center;
  gap: 0.3em;
  overflow: hidden;
  color: var(--text, #edf0f6);
  background:
    radial-gradient(120% 120% at 30% 16%, rgba(255, 255, 255, 0.09), transparent 55%),
    color-mix(in srgb, var(--surface, #161b24) 88%, var(--lb-accent, #6ea8ff) 12%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 0 0 1px color-mix(in srgb, var(--lb-accent, #6ea8ff) 30%, transparent),
    inset 0 -1em 2em rgba(0, 0, 0, 0.3),
    0 1em 2.4em rgba(0, 0, 0, 0.42);
}
.asset-laurel-badge .lb-laurel {
  position: absolute;
  top: 50%;
  width: 1.6em;
  height: 5.6em;
  transform: translateY(-52%);
  color: color-mix(in srgb, var(--lb-accent, #6ea8ff) 80%, var(--text, #edf0f6));
  opacity: 0.9;
}
.asset-laurel-badge .lb-left { left: 0.95em; }
.asset-laurel-badge .lb-right { right: 0.95em; transform: translateY(-52%) scaleX(-1); }
.asset-laurel-badge .lb-label {
  font-size: 0.62em;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--muted, #9aa5b4);
}
.asset-laurel-badge .lb-title {
  font-size: 1.15em;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: 0;
  max-width: 9em;
  text-wrap: balance;
}
.asset-laurel-badge .lb-gloss {
  position: absolute;
  inset: -20%;
  pointer-events: none;
  background: linear-gradient(
    115deg,
    transparent 38%,
    rgba(255, 255, 255, 0.16) 50%,
    transparent 62%
  );
  transform: translateX(calc(var(--lb-shine, -1) * 120%));
}
`.trim(),
  render: ({ params, partId, escapeHtml }) => {
    const branch =
      `<svg viewBox="0 0 28 100" fill="none" aria-hidden="true">` +
      `<path d="M22 4 C10 24 6 48 12 72 C14 82 18 90 24 96" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M15 18 C10 16 6 12 5 6 C11 7 15 11 15 18 Z" fill="currentColor"/>` +
      `<path d="M11 36 C6 34 2 29 1 23 C7 24 11 29 11 36 Z" fill="currentColor"/>` +
      `<path d="M10 54 C5 52 1 47 0 41 C6 42 10 47 10 54 Z" fill="currentColor"/>` +
      `<path d="M12 72 C7 71 3 66 2 60 C8 61 12 65 12 72 Z" fill="currentColor"/>` +
      `<path d="M17 88 C12 87 8 83 7 77 C13 78 17 82 17 88 Z" fill="currentColor"/>` +
      `</svg>`;
    return (
      `<i class="lb-laurel lb-left">${branch}</i>` +
      `<i class="lb-laurel lb-right">${branch}</i>` +
      `<div class="lb-label">${escapeHtml(String(params.label))}</div>` +
      `<div class="lb-title" data-part="${partId}-title">${escapeHtml(String(params.title))}</div>` +
      `<i class="lb-gloss"></i>`
    );
  },
});
