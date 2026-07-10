/**
 * rating-strip — the review score strip (bar silhouette): hero score numeral,
 * five stars, and a caption. Star fill is the two-layer overlay idiom (muted
 * base row + accent row clipped by width), and the clip width rides ONE
 * custom property (`--rs-fill` 0→score) so the payoff sweeps the stars lit
 * left-to-right with a settle.
 */
import { defineAsset } from "../assetContract.ts";

const STAR =
  `<svg viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M12 2.6l2.9 5.9 6.5.94-4.7 4.58 1.1 6.46L12 17.42l-5.8 3.06 1.1-6.46L2.6 9.44l6.5-.94z" fill="currentColor"/>` +
  `</svg>`;

export const ratingStrip = defineAsset({
  version: 1,
  id: "rating-strip",
  title: "Rating stars strip",
  purpose: "Score + five stars + review caption — the social-proof strip",
  family: "bar",
  params: [
    {
      name: "score",
      kind: "number",
      description: "Score 0–5 (drives the star fill)",
      default: 4.9,
      min: 0,
      max: 5,
      cssVar: "--rs-score",
    },
    {
      name: "caption",
      kind: "text",
      description: "Caption under the stars",
      default: "12,480 reviews",
      maxChars: 26,
    },
    {
      name: "accent",
      kind: "color",
      description: "Star fill accent",
      default: "var(--accent)",
      cssVar: "--rs-accent",
    },
    {
      name: "size",
      kind: "number",
      description: "Strip width in px",
      default: 440,
      min: 280,
      max: 680,
      cssVar: "--rs-size",
      unit: "px",
    },
  ],
  animations: [
    {
      name: "enter",
      purpose: "Arrival: rises and settles, no bounce — proof should feel steady",
      spring: "settle",
      trigger: "enter",
      tracks: [
        { property: "translateY", from: 18, to: 0 },
        { property: "opacity", from: 0, to: 1 },
      ],
    },
    {
      name: "fill",
      purpose: "The stars light left-to-right up to the score",
      spring: "settle",
      trigger: "payoff",
      preBeat: "from",
      durationSec: 1.0,
      tracks: [{ property: "--rs-fill", from: 0, to: "$score" }],
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
@property --rs-fill { syntax: "<number>"; inherits: true; initial-value: 5; }
.asset-rating-strip {
  --rs-fill: 5;
  width: var(--rs-size, 440px);
  font-size: calc(var(--rs-size, 440px) / 440 * 16px);
  display: flex;
  align-items: center;
  gap: 1em;
  padding: 0.95em 1.2em;
  border-radius: 999px;
  color: var(--text, #edf0f6);
  background:
    radial-gradient(130% 150% at 22% 0%, rgba(255, 255, 255, 0.06), transparent 55%),
    color-mix(in srgb, var(--surface, #161b24) 94%, var(--rs-accent, #6ea8ff) 6%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.11),
    0 0 0 1px var(--cinema-edge, rgba(255, 255, 255, 0.09)),
    0 0.8em 2em rgba(0, 0, 0, 0.38);
}
.asset-rating-strip .rs-score {
  font-size: 1.7em;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.asset-rating-strip .rs-body { display: grid; gap: 0.28em; }
.asset-rating-strip .rs-stars {
  position: relative;
  display: inline-block;
  line-height: 0;
}
.asset-rating-strip .rs-row { display: inline-flex; gap: 0.18em; }
.asset-rating-strip .rs-row svg { width: 1.15em; height: 1.15em; }
.asset-rating-strip .rs-base { color: color-mix(in srgb, var(--muted, #9aa5b4) 42%, transparent); }
.asset-rating-strip .rs-lit {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: var(--rs-accent, #6ea8ff);
  width: calc(var(--rs-fill, 5) / 5 * 100%);
  filter: drop-shadow(0 0 0.3em color-mix(in srgb, var(--rs-accent, #6ea8ff) 45%, transparent));
}
.asset-rating-strip .rs-lit .rs-row { width: max-content; }
.asset-rating-strip .rs-caption {
  font-size: 0.74em;
  color: var(--muted, #9aa5b4);
  font-variant-numeric: tabular-nums;
}
`.trim(),
  render: ({ params, partId, escapeHtml }) => {
    const stars = `<span class="rs-row">${STAR}${STAR}${STAR}${STAR}${STAR}</span>`;
    const score = Number(params.score);
    return (
      `<div class="rs-score" data-part="${partId}-score">${escapeHtml(score.toFixed(1))}</div>` +
      `<div class="rs-body">` +
      `<span class="rs-stars" data-part="${partId}-stars">` +
      `<span class="rs-base">${stars}</span>` +
      `<span class="rs-lit">${stars}</span>` +
      `</span>` +
      `<div class="rs-caption">${escapeHtml(String(params.caption))}</div>` +
      `</div>`
    );
  },
});
