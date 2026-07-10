/**
 * The pre-built asset library (ASSETS.md). Assets are authored HERE, by
 * humans, in the Asset Lab (`npm run assets`) — never by the planning or
 * authoring models. Add an asset by creating `<name>.ts` beside this file
 * (built with `defineAsset` — definition typos throw at module load) and
 * listing it below; the Asset Lab, the plugin bridge, and the planner
 * vocabulary all derive from this one array.
 *
 * The 2026-07-09 pack, by silhouette family:
 * - window: browser-hero (product frame that populates)
 * - card:   spark-card · logo-tile · flow-node
 * - circle: glass-metric · laurel-badge · notify-gem · team-medallion
 * - bar:    metric-bar · rating-strip
 * - pill:   delta-chip · key-combo · cta-button
 */
import type { AssetDefinitionV1 } from "../assetContract.ts";
import { glassMetric } from "./glassMetric.ts";
import { browserHero } from "./browserHero.ts";
import { metricBar } from "./metricBar.ts";
import { deltaChip } from "./deltaChip.ts";
import { sparkCard } from "./sparkCard.ts";
import { laurelBadge } from "./laurelBadge.ts";
import { keyCombo } from "./keyCombo.ts";
import { ctaButton } from "./ctaButton.ts";
import { logoTile } from "./logoTile.ts";
import { notifyGem } from "./notifyGem.ts";
import { flowNode } from "./flowNode.ts";
import { teamMedallion } from "./teamMedallion.ts";
import { ratingStrip } from "./ratingStrip.ts";

export const ASSET_LIBRARY: AssetDefinitionV1[] = [
  glassMetric,
  browserHero,
  sparkCard,
  metricBar,
  deltaChip,
  ratingStrip,
  laurelBadge,
  logoTile,
  flowNode,
  notifyGem,
  teamMedallion,
  keyCombo,
  ctaButton,
];

const BY_ID = new Map(ASSET_LIBRARY.map((asset) => [asset.id, asset]));

export function getAsset(id: string): AssetDefinitionV1 | undefined {
  return BY_ID.get(id);
}

/* Library integrity: duplicate ids fail at module load, not mid-run. */
if (BY_ID.size !== ASSET_LIBRARY.length) {
  throw new Error("asset library contains duplicate ids");
}
