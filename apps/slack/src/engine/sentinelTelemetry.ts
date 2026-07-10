/**
 * Sentinel run telemetry — the before/after instrument for the
 * correctness-by-construction rework (SENTINEL_PLAN.md §0/§3 Phase 0).
 *
 * One `planning/sentinel-run.json` per job records the numbers the mission
 * table is measured against: per-stage wall-clock + attempts, model-call count,
 * prompt/completion characters, which Sentinel layer caught each finding, and
 * the run's final disposition. `scripts/sentinelReport.ts` aggregates these
 * (plus the existing `author-run.json`) into the metric table.
 *
 * Collection uses `AsyncLocalStorage` so the deep model-call and repair seams
 * inside `compositionRunner.ts` never grow a `projectDir` parameter: the
 * orchestrator enters a run context once per create and every downstream record
 * lands in the right bucket. This is diagnostic-only — a missing context (any
 * path that never entered a run, e.g. the demo/preset path) makes every record
 * a silent no-op, and a disk fault never disturbs a build.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

/** The four honest end-states of a create (SENTINEL_PLAN.md §0). */
export type SentinelDisposition =
  | "published"
  | "published-degraded"
  | "fallback"
  | "fail-loud";

/** The Sentinel layer model (SENTINEL_PLAN.md §2) — where a finding was caught. */
export type SentinelLayer =
  | "schema" // L0 — invalid output can't parse
  | "scaffold" // L1 — host chassis + bindings present in the shipped document
  | "normalize" // L2 — deterministic repair, zero paid attempts
  | "static" // L3 — linkedom/regex/kitMarkupAudit findings
  | "browser" // L4 — measured browser truth
  | "model-retry"; // L5 — a paid re-author

interface ModelCallRecord {
  /** The call label (frame-design, storyboard, author, concept, critic, …). */
  stage: string;
  promptChars: number;
  completionChars: number;
}

export interface SentinelStageTiming {
  stage: string;
  status: "succeeded" | "failed";
  durationMs: number;
  attempts?: number;
}

interface SentinelRunState {
  projectDir: string;
  startedAt: number;
  modelCalls: ModelCallRecord[];
  /** Failed logical calls by stage — the paid/spent attempts `modelCalls` (successes only) omits. */
  failedModelCalls: Record<string, number>;
  /** Hedge duplicates launched by stage — extra PHYSICAL requests (cost), not logical calls. */
  hedgedModelCalls: Record<string, number>;
  /** Scene-slot subcalls that are hidden inside one outer source-author attempt. */
  slotCalls: Record<SentinelSlotCallKind, { calls: number; scenes: number }>;
  /**
   * Honesty ledger: every degradation the run shipped with (moment demotion,
   * least-bad pick, quarantined interactions, degraded cuts, browser-QA infra
   * bypass). Any entry downgrades a `published` finalize to `published-degraded`.
   */
  degradations: string[];
  layerFindings: Record<SentinelLayer, number>;
  normalizations: Record<string, number>;
  scaffoldCoverage?: { planned: number; present: number };
  scaffoldRestorationEvents: Record<SentinelScaffoldRestorationSource, number>;
  stages: SentinelStageTiming[];
  tier1Ms?: number;
  tier2Ms?: number;
  disposition?: SentinelDisposition;
  skeletonEnabled?: boolean;
  slotsEnabled?: boolean;
}

export type SentinelSlotCallKind =
  | "truncation-continuation"
  | "scaffold-repair"
  | "validation-repair"
  | "storyboard-scene-repair"
  | "critic-scene-repair";
export type SentinelScaffoldRestorationSource = "scene-repair" | "l2-normalize";

const storage = new AsyncLocalStorage<SentinelRunState>();

function active(): SentinelRunState | undefined {
  return storage.getStore();
}

function emptyLayers(): Record<SentinelLayer, number> {
  return {
    schema: 0,
    scaffold: 0,
    normalize: 0,
    static: 0,
    browser: 0,
    "model-retry": 0,
  };
}

/**
 * Establish a telemetry context for the remainder of this create. Uses
 * `enterWith` so the caller need not wrap its whole body in a callback: every
 * following async operation in this createVideo invocation reads the same
 * store. Each create runs in its own async branch, so concurrent jobs do not
 * clobber one another's context.
 */
export function beginSentinelRun(
  projectDir: string,
  flags?: { skeleton?: boolean; slots?: boolean },
): void {
  storage.enterWith({
    projectDir,
    startedAt: Date.now(),
    modelCalls: [],
    failedModelCalls: {},
    hedgedModelCalls: {},
    slotCalls: {
      "truncation-continuation": { calls: 0, scenes: 0 },
      "scaffold-repair": { calls: 0, scenes: 0 },
      "validation-repair": { calls: 0, scenes: 0 },
      "storyboard-scene-repair": { calls: 0, scenes: 0 },
      "critic-scene-repair": { calls: 0, scenes: 0 },
    },
    degradations: [],
    layerFindings: emptyLayers(),
    normalizations: {},
    scaffoldRestorationEvents: {
      "scene-repair": 0,
      "l2-normalize": 0,
    },
    stages: [],
    skeletonEnabled: flags?.skeleton,
    slotsEnabled: flags?.slots,
  });
}

/** Record one logical model call (already de-hedged by the retry wrappers). */
export function recordSentinelModelCall(rec: ModelCallRecord): void {
  active()?.modelCalls.push(rec);
}

/**
 * Record a FAILED logical model call (transport fault, truncation, stall).
 * `modelCalls` counts only successes, so without this the cost ledger hid the
 * most expensive runs — the ones that spent calls and got nothing back.
 */
export function recordSentinelModelCallFailure(stage: string): void {
  const state = active();
  if (!state) return;
  state.failedModelCalls[stage] = (state.failedModelCalls[stage] ?? 0) + 1;
}

/** Record one hedge duplicate launched (an extra physical request = cost). */
export function recordSentinelHedge(stage: string): void {
  const state = active();
  if (!state) return;
  state.hedgedModelCalls[stage] = (state.hedgedModelCalls[stage] ?? 0) + 1;
}

function hedgeReserveForSourceAuthor(): number {
  const raw = Number(process.env.SLACK_SEQUENCES_HEDGE_SOURCE_AUTHOR_RESERVE);
  return Number.isInteger(raw) && raw >= 0 ? raw : 1;
}

function isSourceAuthorHedgeStage(stage: string): boolean {
  return /\bauthor(?:\s|$)|source-author/i.test(stage);
}

/**
 * Atomically claim one hedge from a per-run budget. A small source-author
 * reservation prevents slow planning/storyboard calls from consuming every
 * duplicate before the expensive author path begins. Calls outside a Sentinel
 * context (unit helpers/non-create flows) retain the historical behavior.
 */
export function claimSentinelHedge(stage: string, maxPerRun: number): boolean {
  const state = active();
  if (!state) return true;
  const used = Object.values(state.hedgedModelCalls).reduce((sum, count) => sum + count, 0);
  if (used >= maxPerRun) return false;
  const authorReserve = Math.min(hedgeReserveForSourceAuthor(), maxPerRun);
  if (authorReserve > 0 && !isSourceAuthorHedgeStage(stage)) {
    const authorUsed = Object.entries(state.hedgedModelCalls)
      .filter(([hedgedStage]) => isSourceAuthorHedgeStage(hedgedStage))
      .reduce((sum, [, count]) => sum + count, 0);
    const missingAuthorReserve = Math.max(0, authorReserve - authorUsed);
    if (maxPerRun - used <= missingAuthorReserve) return false;
  }
  recordSentinelHedge(stage);
  return true;
}

/** Record one scene-slot subcall and how many scenes it re-authored. */
export function recordSentinelSlotCall(kind: SentinelSlotCallKind, scenes: number): void {
  const state = active();
  if (!state || !Number.isFinite(scenes) || scenes <= 0) return;
  state.slotCalls[kind].calls += 1;
  state.slotCalls[kind].scenes += Math.floor(scenes);
}

/**
 * Record that the shipping draft carries a degradation (a demoted moment, a
 * least-bad pick with open polish findings, a quarantined interaction, a
 * degraded declared cut, a browser-QA infrastructure bypass). Any entry turns
 * a `published` finalize into `published-degraded` so the disposition ledger
 * never reports a salvaged film as clean.
 */
export function recordSentinelDegradation(reason: string): void {
  const state = active();
  if (!state || !reason || state.degradations.includes(reason)) return;
  state.degradations.push(reason);
}

/** Count a finding caught (or a state made unrepresentable) at a given layer. */
export function recordSentinelLayerFinding(layer: SentinelLayer, count = 1): void {
  const state = active();
  if (!state || count <= 0) return;
  state.layerFindings[layer] += count;
}

/**
 * Count one deterministic normalization (an L2 repair). These are the repairs
 * Phase 1's scaffold moves down to L1 — the metric that should fall to ~0 for
 * the paperwork classes once skeletons emit planes/roots/islands.
 */
export function recordSentinelNormalization(tag: string, count = 1): void {
  const state = active();
  if (!state || count <= 0) return;
  state.normalizations[tag] = (state.normalizations[tag] ?? 0) + count;
  state.layerFindings.normalize += count;
}

/**
 * Record shipped scaffold-contract coverage. `guaranteedBindings` is the
 * number present in the final document; `plannedBindings` is the storyboard
 * obligation count. Restoration provenance is recorded separately so L2- or
 * scene-repaired bindings are never mislabeled as surviving L1 unchanged.
 */
export function recordSentinelScaffold(guaranteedBindings: number, plannedBindings?: number): void {
  const state = active();
  if (!state || guaranteedBindings <= 0) return;
  state.layerFindings.scaffold = Math.max(state.layerFindings.scaffold, guaranteedBindings);
  state.scaffoldCoverage = {
    present: guaranteedBindings,
    planned: Math.max(guaranteedBindings, plannedBindings ?? guaranteedBindings),
  };
}

/** Attribute scaffold-contract restorations without pretending they survived L1 unchanged. */
export function recordSentinelScaffoldRestoration(
  source: SentinelScaffoldRestorationSource,
  count = 1,
): void {
  const state = active();
  if (!state || !Number.isFinite(count) || count <= 0) return;
  state.scaffoldRestorationEvents[source] += Math.floor(count);
}

/** Attach the orchestrator's per-stage timings/attempts to the run. */
export function recordSentinelStages(stages: SentinelStageTiming[]): void {
  const state = active();
  if (state) state.stages = stages;
}

/** Wall-clock to a delivery tier (tier 1 = thumbnails, tier 2 = MP4). */
export function recordSentinelTier(tier: "tier1" | "tier2", ms: number): void {
  const state = active();
  if (!state || !Number.isFinite(ms) || ms < 0) return;
  if (tier === "tier1") state.tier1Ms = ms;
  else state.tier2Ms = ms;
}

/**
 * Record a delivery tier as elapsed-since-run-start, measured where the tier
 * actually completes (inside `buildPreviews`, after the thumbnails/MP4 exist)
 * rather than where the orchestrator happens to be. Tier 1 previously stopped
 * the clock BEFORE preview generation, so the mission metric "wall-clock to
 * thumbnails" quietly excluded the thumbnails.
 */
export function recordSentinelTierFromRunStart(tier: "tier1" | "tier2"): void {
  const state = active();
  if (!state) return;
  recordSentinelTier(tier, Date.now() - state.startedAt);
}

/**
 * Summarize the current run to `planning/sentinel-run.json`. Best-effort; a
 * missing context (never began a run) or a disk error is swallowed.
 */
export function finalizeSentinelRun(disposition: SentinelDisposition): void {
  const state = active();
  if (!state) return;
  // The honesty downgrade: a "published" run that shipped with recorded
  // degradations is published-degraded. Callers keep the simple two-outcome
  // call site; the ledger decides which publish it really was.
  if (disposition === "published" && state.degradations.length) {
    disposition = "published-degraded";
  }
  state.disposition = disposition;
  try {
    const dir = path.join(state.projectDir, "planning");
    fs.mkdirSync(dir, { recursive: true });
    const byStage: Record<string, number> = {};
    let totalPromptChars = 0;
    let totalCompletionChars = 0;
    let maxAuthorPromptChars = 0;
    for (const call of state.modelCalls) {
      byStage[call.stage] = (byStage[call.stage] ?? 0) + 1;
      totalPromptChars += call.promptChars;
      totalCompletionChars += call.completionChars;
      if (/author/i.test(call.stage)) {
        maxAuthorPromptChars = Math.max(maxAuthorPromptChars, call.promptChars);
      }
    }
    const payload = {
      disposition,
      startedAt: new Date(state.startedAt).toISOString(),
      durationMs: Date.now() - state.startedAt,
      skeletonEnabled: state.skeletonEnabled ?? null,
      slotsEnabled: state.slotsEnabled ?? null,
      wallClock: { tier1Ms: state.tier1Ms ?? null, tier2Ms: state.tier2Ms ?? null },
      stages: state.stages,
      modelCalls: {
        // `total` remains as the backwards-compatible successful-logical count.
        total: state.modelCalls.length,
        successfulLogicalTotal: state.modelCalls.length,
        byStage,
        failed: state.failedModelCalls,
        failedTotal: Object.values(state.failedModelCalls).reduce((sum, n) => sum + n, 0),
        hedged: state.hedgedModelCalls,
        hedgedTotal: Object.values(state.hedgedModelCalls).reduce((sum, n) => sum + n, 0),
        physicalRequestTotal:
          state.modelCalls.length +
          Object.values(state.failedModelCalls).reduce((sum, n) => sum + n, 0) +
          Object.values(state.hedgedModelCalls).reduce((sum, n) => sum + n, 0),
      },
      slotCalls: state.slotCalls,
      degradations: state.degradations,
      promptChars: {
        maxAuthor: maxAuthorPromptChars,
        totalPrompt: totalPromptChars,
        totalCompletion: totalCompletionChars,
      },
      layers: state.layerFindings,
      scaffoldCoverage: state.scaffoldCoverage ?? null,
      scaffoldRestorationEvents: state.scaffoldRestorationEvents,
      normalizations: state.normalizations,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(dir, "sentinel-run.json"),
      JSON.stringify(payload, null, 2),
      "utf8",
    );
  } catch {
    // Diagnostics only.
  }
}
