/**
 * notify-gem — the notification counter (circle silhouette): a glossy accent
 * sphere holding a count, with a sonar ring payoff. The ring rides ONE custom
 * property (`--ng-ping` 0→1): scale grows with it, opacity fades with it, and
 * its rest value (1) leaves the ring invisible — so the static frame is clean
 * and the ping is a pure timeline function (no pre-beat write needed).
 */
import { defineAsset } from "../assetContract.ts";

export const notifyGem = defineAsset({
  version: 1,
  id: "notify-gem",
  title: "Notification gem",
  purpose: "Glossy notification counter with a sonar ping",
  family: "circle",
  params: [
    {
      name: "count",
      kind: "text",
      description: "Counter copy",
      default: "3",
      maxChars: 4,
    },
    {
      name: "accent",
      kind: "color",
      description: "Gem + ping accent",
      default: "var(--accent)",
      cssVar: "--ng-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Gem diameter in px",
      default: 120,
      min: 72,
      max: 220,
      cssVar: "--ng-size",
      unit: "px",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: bounces in — a notification should feel like an event",
      spring: "bounce",
      trigger: "enter",
      durationSec: 0.85,
      tracks: [
        { property: "scale", from: 0.6, to: 1 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "ping",
      purpose: "A sonar ring expands and dissolves from the gem's edge",
      spring: "settle",
      trigger: "payoff",
      durationSec: 0.9,
      tracks: [{ property: "--ng-ping", from: 0, to: 1 }],
    },
    {
      name: "pulse",
      purpose: "Soft attention beat, there and back",
      spring: "settle",
      yoyo: true,
      tracks: [{ property: "scale", from: 1, to: 1.08 }],
    },
  ],
  style: `
@property --ng-ping { syntax: "<number>"; inherits: true; initial-value: 1; }
.asset-notify-gem {
  --ng-ping: 1;
  position: relative;
  width: var(--ng-size, 120px);
  height: var(--ng-size, 120px);
  font-size: calc(var(--ng-size, 120px) / 120 * 16px);
  display: grid;
  place-items: center;
}
.asset-notify-gem .ng-gem {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background:
    radial-gradient(120% 120% at 30% 22%, rgba(255, 255, 255, 0.32), transparent 48%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--ng-accent, #6ea8ff) 86%, #ffffff),
      var(--ng-accent, #6ea8ff) 58%
    );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    inset 0 -0.4em 0.9em color-mix(in srgb, var(--ng-accent, #6ea8ff) 50%, rgba(0, 0, 0, 0.4)),
    0 0.55em 1.5em rgba(0, 0, 0, 0.4),
    0 0 1.2em color-mix(in srgb, var(--ng-accent, #6ea8ff) 40%, transparent);
}
.asset-notify-gem .ng-count {
  font-size: 2em;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--accent-text, #0b0d11);
}
.asset-notify-gem .ng-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  border: 2px solid color-mix(in srgb, var(--ng-accent, #6ea8ff) 80%, transparent);
  transform: scale(calc(1 + var(--ng-ping, 1) * 0.85));
  opacity: calc((1 - var(--ng-ping, 1)) * 0.9);
}
`.trim(),
  render: ({ params, partId, escapeHtml }) =>
    `<div class="ng-gem" data-part="${partId}-gem">` +
    `<span class="ng-count" data-part="${partId}-count">${escapeHtml(String(params.count))}</span>` +
    `</div>` +
    `<i class="ng-ring"></i>`,
});
