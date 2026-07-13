/**
 * key-combo — the shortcut chip (pill silhouette): extruded keycaps for each
 * token of the `keys` copy, plus an optional trailing label. The payoff is a
 * tactile press: ONE custom property (`--kc-press` 0→1, yoyo snap) drives cap
 * travel AND the extrusion shadow compressing — a real key strike, not a fade.
 */
import { defineAsset } from "../assetContract.ts";

export const keyCombo = defineAsset({
  version: 1,
  id: "key-combo",
  title: "Keyboard shortcut chip",
  purpose: "Extruded keycaps (e.g. ⌘ K) that visibly press, with an optional label",
  family: "pill",
  params: [
    {
      name: "keys",
      kind: "text",
      description: "Space-separated key tokens, e.g. \"⌘ K\"",
      default: "⌘ K",
      maxChars: 12,
    },
    {
      name: "label",
      kind: "text",
      description: "Trailing action label (spaces-only clears it)",
      default: "Quick actions",
      maxChars: 18,
    },
    {
      name: "accent",
      kind: "color",
      description: "Cap glyph + focus accent",
      default: "var(--accent)",
      cssVar: "--kc-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Chip height in px",
      default: 72,
      min: 48,
      max: 132,
      cssVar: "--kc-size",
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
        { property: "translateY", from: 16, to: 0 },
        { property: "scale", from: 0.82, to: 1 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "press",
      purpose: "The caps strike down and release — travel + shadow compress together",
      spring: "snap",
      trigger: "payoff",
      yoyo: true,
      durationSec: 0.22,
      tracks: [{ property: "--kc-press", from: 0, to: 1 }],
    },
  ],
  style: `
@property --kc-press { syntax: "<number>"; inherits: true; initial-value: 0; }
.asset-key-combo {
  --kc-press: 0;
  height: var(--kc-size, 72px);
  font-size: calc(var(--kc-size, 72px) / 72 * 16px);
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  padding: 0 1em;
  border-radius: 999px;
  color: var(--text, #edf0f6);
  background:
    radial-gradient(130% 180% at 26% -20%, rgba(255, 255, 255, 0.05), transparent 58%),
    color-mix(in srgb, var(--surface, #161b24) 94%, var(--kc-accent, #6ea8ff) 6%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.09)),
    0 0.14em 0.4em rgba(0, 0, 0, 0.28),
    0 0.55em 1.5em rgba(0, 0, 0, 0.32);
}
.asset-key-combo .kc-cap {
  display: inline-grid;
  place-items: center;
  min-width: 1.9em;
  height: 1.9em;
  padding: 0 0.42em;
  border-radius: 0.46em;
  font-size: 0.92em;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: color-mix(in srgb, var(--kc-accent, #6ea8ff) 82%, var(--text, #edf0f6));
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.11), transparent 48%),
    color-mix(in srgb, var(--surface-2, #1d2430) 96%, var(--kc-accent, #6ea8ff) 4%);
  transform: translateY(calc(var(--kc-press, 0) * 0.14em));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.08)),
    0 calc(0.18em * (1 - var(--kc-press, 0))) 0 color-mix(in srgb, var(--canvas, #0a0c10) 82%, var(--kc-accent, #6ea8ff)),
    0 calc(0.26em * (1 - var(--kc-press, 0))) 0.6em rgba(0, 0, 0, 0.42);
}
.asset-key-combo .kc-plus { color: var(--muted, #9aa5b4); font-size: 0.78em; opacity: 0.7; }
.asset-key-combo .kc-label {
  margin-left: 0.28em;
  font-size: 0.82em;
  font-weight: 500;
  color: var(--muted, #9aa5b4);
  letter-spacing: 0.005em;
  white-space: nowrap;
}
`.trim(),
  render: ({ params, partId, escapeHtml }) => {
    const tokens = String(params.keys).split(/\s+/).filter(Boolean).slice(0, 4);
    const caps = tokens
      .map((token) => `<span class="kc-cap">${escapeHtml(token)}</span>`)
      .join(`<span class="kc-plus" aria-hidden="true">+</span>`);
    const label = String(params.label).trim();
    return (
      `<span class="kc-caps" data-part="${partId}-caps">${caps}</span>` +
      (label ? `<span class="kc-label">${escapeHtml(label)}</span>` : "")
    );
  },
});
