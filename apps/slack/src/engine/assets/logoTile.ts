/**
 * logo-tile — the app-icon tile (card silhouette): a squircle-radius tile with
 * a monogram, diagonal light field, and a gloss-sweep payoff (shared idiom
 * with laurel-badge, so tiles and seals read as one system). The integration
 * story: park two beside each other and cut object-match between them.
 */
import { defineAsset } from "../assetContract.ts";

export const logoTile = defineAsset({
  version: 1,
  id: "logo-tile",
  title: "Logo monogram tile",
  purpose: "App-icon tile with a monogram — the integration/logo unit",
  family: "card",
  params: [
    {
      name: "monogram",
      kind: "text",
      description: "1–3 character mark",
      default: "AC",
      maxChars: 3,
    },
    {
      name: "name",
      kind: "text",
      description: "Product name under the tile (spaces-only clears it)",
      default: "Acme",
      maxChars: 14,
    },
    {
      name: "accent",
      kind: "color",
      description: "Tile field accent",
      default: "var(--accent)",
      cssVar: "--lt-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Tile edge in px",
      default: 220,
      min: 120,
      max: 360,
      cssVar: "--lt-size",
      unit: "px",
    },
    {
      name: "tone",
      kind: "enum",
      description: "Field treatment",
      default: "glass",
      options: ["glass", "solid"],
      attr: "tone",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: pops in with a straightening tilt — an icon landing on a shelf",
      spring: "pop",
      trigger: "enter",
      tracks: [
        { property: "scale", from: 0.7, to: 1 },
        { property: "rotate", from: -6, to: 0 },
        { property: "translateY", from: 20, to: 0 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "gleam",
      purpose: "A gloss band sweeps the tile face",
      spring: "settle",
      trigger: "payoff",
      durationSec: 0.8,
      tracks: [{ property: "--lt-shine", from: -1, to: 1 }],
    },
    {
      name: "tilt",
      purpose: "Playful lean, there and back",
      spring: "settle",
      yoyo: true,
      tracks: [{ property: "rotate", from: 0, to: 4 }],
    },
  ],
  style: `
@property --lt-shine { syntax: "<number>"; inherits: true; initial-value: -1; }
.asset-logo-tile {
  --lt-shine: -1;
  width: var(--lt-size, 220px);
  font-size: calc(var(--lt-size, 220px) / 220 * 16px);
  display: grid;
  justify-items: center;
  gap: 0.7em;
  color: var(--text, #edf0f6);
}
.asset-logo-tile .lt-face {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 24%;
  display: grid;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(130% 130% at 24% 12%, rgba(255, 255, 255, 0.13), transparent 55%),
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--lt-accent, #6ea8ff) 42%, var(--surface, #161b24)),
      color-mix(in srgb, var(--lt-accent, #6ea8ff) 14%, var(--surface, #161b24)) 70%
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 0 0 1px color-mix(in srgb, var(--lt-accent, #6ea8ff) 26%, transparent),
    0 1em 2.4em rgba(0, 0, 0, 0.42);
}
.asset-logo-tile[data-tone="solid"] .lt-face {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--lt-accent, #6ea8ff) 88%, #ffffff),
    var(--lt-accent, #6ea8ff) 65%
  );
}
.asset-logo-tile .lt-mark {
  font-size: 3.1em;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: color-mix(in srgb, var(--text, #edf0f6) 92%, var(--lt-accent, #6ea8ff));
  text-shadow: 0 0.06em 0.3em rgba(0, 0, 0, 0.35);
}
.asset-logo-tile[data-tone="solid"] .lt-mark { color: var(--accent-text, #0b0d11); text-shadow: none; }
.asset-logo-tile .lt-gloss {
  position: absolute;
  inset: -20%;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 40%, rgba(255, 255, 255, 0.18) 50%, transparent 60%);
  transform: translateX(calc(var(--lt-shine, -1) * 130%));
}
.asset-logo-tile .lt-name {
  font-size: 0.86em;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--muted, #9aa5b4);
}
`.trim(),
  render: ({ params, partId, escapeHtml }) => {
    const name = String(params.name).trim();
    return (
      `<div class="lt-face" data-part="${partId}-face">` +
      `<span class="lt-mark">${escapeHtml(String(params.monogram))}</span>` +
      `<i class="lt-gloss"></i>` +
      `</div>` +
      (name ? `<div class="lt-name">${escapeHtml(name)}</div>` : "")
    );
  },
});
