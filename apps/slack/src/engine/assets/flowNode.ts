/**
 * flow-node — the pipeline stage card (card silhouette): status dot, stage
 * name, meta line, and in/out ports on the card's edges so a row of nodes
 * reads as a pipeline. Enters ALONG the flow axis (from the left — direction
 * carries meaning), and the payoff lights the node up via a stacked accent
 * ring whose opacity rides `--fn-active` (no color-mix-in-motion tricks).
 */
import { defineAsset } from "../assetContract.ts";

export const flowNode = defineAsset({
  version: 1,
  id: "flow-node",
  title: "Pipeline flow node",
  purpose: "One pipeline/workflow stage card with ports and an activation glow",
  family: "card",
  params: [
    {
      name: "label",
      kind: "text",
      description: "Stage name",
      default: "Build & test",
      maxChars: 16,
    },
    {
      name: "meta",
      kind: "text",
      description: "Meta line under the name",
      default: "12s · main",
      maxChars: 18,
    },
    {
      name: "state",
      kind: "enum",
      description: "Resting status chip",
      default: "done",
      options: ["idle", "running", "done"],
      attr: "state",
    },
    {
      name: "accent",
      kind: "color",
      description: "Status + activation accent",
      default: "var(--accent)",
      cssVar: "--fn-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Node width in px",
      default: 320,
      min: 220,
      max: 500,
      cssVar: "--fn-size",
      unit: "px",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: slides in along the pipeline axis and settles",
      spring: "settle",
      trigger: "enter",
      tracks: [
        { property: "translateX", from: -26, to: 0 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "activate",
      purpose: "The stage lights up: accent ring and dot glow rise together",
      spring: "settle",
      trigger: "payoff",
      preBeat: "from",
      durationSec: 0.7,
      tracks: [{ property: "--fn-active", from: 0, to: 1 }],
    },
    {
      name: "nudge",
      purpose: "Hand-off emphasis: a small push along the flow, there and back",
      spring: "snap",
      yoyo: true,
      tracks: [{ property: "translateX", from: 0, to: 6 }],
    },
  ],
  style: `
@property --fn-active { syntax: "<number>"; inherits: true; initial-value: 1; }
.asset-flow-node {
  --fn-active: 1;
  position: relative;
  width: var(--fn-size, 320px);
  font-size: calc(var(--fn-size, 320px) / 320 * 16px);
  display: flex;
  align-items: center;
  gap: 0.8em;
  padding: 1em 1.15em;
  border-radius: var(--cinema-radius, 14px);
  color: var(--text, #edf0f6);
  background:
    radial-gradient(120% 140% at 20% 0%, rgba(255, 255, 255, 0.05), transparent 55%),
    var(--surface, #161b24);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.09)),
    0 0.8em 2em rgba(0, 0, 0, 0.38);
}
.asset-flow-node .fn-ring {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: var(--fn-active, 1);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--fn-accent, #6ea8ff) 55%, transparent),
    0 0 1.1em color-mix(in srgb, var(--fn-accent, #6ea8ff) 30%, transparent);
}
.asset-flow-node .fn-dot {
  flex: none;
  width: 0.85em;
  height: 0.85em;
  border-radius: 50%;
  background: color-mix(in srgb, var(--muted, #9aa5b4) 60%, transparent);
  box-shadow: none;
}
.asset-flow-node[data-state="running"] .fn-dot,
.asset-flow-node[data-state="done"] .fn-dot {
  background: var(--fn-accent, #6ea8ff);
  box-shadow: 0 0 calc(var(--fn-active, 1) * 0.7em)
    color-mix(in srgb, var(--fn-accent, #6ea8ff) 70%, transparent);
}
.asset-flow-node .fn-copy { display: grid; gap: 0.18em; min-width: 0; }
.asset-flow-node .fn-label {
  font-size: 1.02em;
  font-weight: 700;
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-flow-node .fn-meta {
  font-size: 0.76em;
  color: var(--muted, #9aa5b4);
  font-variant-numeric: tabular-nums;
}
.asset-flow-node .fn-port {
  position: absolute;
  top: 50%;
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
  transform: translateY(-50%);
  background: var(--surface-2, #1d2430);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fn-accent, #6ea8ff) 45%, transparent);
}
.asset-flow-node .fn-in { left: -0.3em; }
.asset-flow-node .fn-out { right: -0.3em; }
`.trim(),
  render: ({ params, partId, escapeHtml }) =>
    `<i class="fn-ring"></i>` +
    `<i class="fn-dot"></i>` +
    `<div class="fn-copy">` +
    `<div class="fn-label" data-part="${partId}-label">${escapeHtml(String(params.label))}</div>` +
    `<div class="fn-meta">${escapeHtml(String(params.meta))}</div>` +
    `</div>` +
    `<i class="fn-port fn-in"></i><i class="fn-port fn-out"></i>`,
});
