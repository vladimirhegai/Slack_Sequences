/**
 * Sentinel run telemetry — context plumbing over the attempt ledger.
 *
 * Since S1.1 every count lives in ONE place: the append-only
 * `AttemptLedger` (`runner/attemptLedger.ts`). This module only owns the
 * `AsyncLocalStorage` context (so the deep model-call and repair seams inside
 * the runner never grow a `projectDir` parameter) and the thin `recordSentinel*`
 * emitters the call sites already use — each one appends a typed event and
 * keeps nothing. `finalizeSentinelRun` folds the events into the unchanged
 * `planning/sentinel-run.json` view and persists the raw events to
 * `planning/attempt-ledger.json`.
 *
 * This is diagnostic-only — a missing context (any path that never entered a
 * run, e.g. the demo/preset path) makes every record a silent no-op, and a
 * disk fault never disturbs a build.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { slackSequencesEnvRawValue } from "./featureFlags.ts";
import {
  AttemptLedger,
  countHedgeLaunches,
  deriveLedgerStatus,
  deriveLedgerStageReceipts,
  deriveSentinelRunView,
  type AttemptLedgerEvent,
  type AttemptLedgerEventBody,
  type SentinelDisposition,
  type SentinelLayer,
  type LedgerStatus,
  type LedgerStatusAxis,
  type LedgerStageReceipt,
  type SentinelScaffoldRestorationSource,
  type SentinelSlotCallKind,
  type SentinelStageTiming,
  type StudioCatalogName,
} from "./runner/attemptLedger.ts";

export type {
  LedgerStatus,
  LedgerStatusAxis,
  LedgerStageReceipt,
  SentinelDisposition,
  SentinelLayer,
  SentinelScaffoldRestorationSource,
  SentinelSlotCallKind,
  SentinelStageTiming,
};

interface ModelCallRecord {
  /** The call label (frame-design, storyboard, author, concept, critic, …). */
  stage: string;
  promptChars: number;
  completionChars: number;
}

interface SentinelRunContext {
  projectDir: string;
  ledger: AttemptLedger;
}

const storage = new AsyncLocalStorage<SentinelRunContext>();

function active(): SentinelRunContext | undefined {
  return storage.getStore();
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
  const ledger = new AttemptLedger();
  ledger.append({
    kind: "run-start",
    projectDir,
    ...(flags?.skeleton === undefined ? {} : { skeletonEnabled: flags.skeleton }),
    ...(flags?.slots === undefined ? {} : { slotsEnabled: flags.slots }),
  });
  storage.enterWith({ projectDir, ledger });
}

/** Scoped Sentinel context for tests and contained helper workflows. */
export function runInSentinelContext<T>(
  projectDir: string,
  run: () => T,
  flags?: { skeleton?: boolean; slots?: boolean },
): T {
  const ledger = new AttemptLedger();
  ledger.append({
    kind: "run-start",
    projectDir,
    ...(flags?.skeleton === undefined ? {} : { skeletonEnabled: flags.skeleton }),
    ...(flags?.slots === undefined ? {} : { slotsEnabled: flags.slots }),
  });
  return storage.run({ projectDir, ledger }, run);
}

/**
 * Append one raw ledger event from the runner (attempt start/end, hedge win,
 * stream timeout, …). No-op outside a run context, like every emitter here.
 */
export function appendSentinelLedgerEvent(body: AttemptLedgerEventBody): void {
  active()?.ledger.append(body);
}

/** The active run's events, for derived predicates. Undefined outside a run. */
export function activeSentinelLedgerEvents(): readonly AttemptLedgerEvent[] | undefined {
  return active()?.ledger.events;
}

/** The normal create path has an active ledger; isolated helpers/demos do not. */
export function boundedCreatePolicyActive(): boolean {
  return Boolean(active());
}

export const MAX_LOGICAL_MODEL_CALLS = 6;
export const MAX_PHYSICAL_PROVIDER_REQUESTS = 8;
export const MAX_STORYBOARD_MODEL_CALLS = 2;
export const MAX_SOURCE_MODEL_CALLS = 2;

export class SentinelModelCallBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SentinelModelCallBudgetError";
  }
}

function modelStageFamily(stage: string): string {
  if (/^storyboard(?:\s|$)/i.test(stage)) return "storyboard";
  if (/^author(?:\s|$)|source-author/i.test(stage)) return "source-author";
  return stage.trim().toLowerCase().replace(/\s+/g, " ");
}

function reservedModelRequests(events: readonly AttemptLedgerEvent[]): AttemptLedgerEvent[] {
  return events.filter((event) => event.kind === "model-request");
}

/**
 * Atomically reserve one primary provider request before launch. The append is
 * synchronous, so parallel concept/shape work cannot both observe stale cap
 * state. Outcome events settle telemetry later without charging a second time.
 */
export function reserveSentinelModelCall(stage: string): void {
  const context = active();
  if (!context) return;
  const requests = reservedModelRequests(context.ledger.events);
  const hedges = context.ledger.events.filter((event) => event.kind === "hedge-launch").length;
  const family = modelStageFamily(stage);
  const familyCalls = requests.filter((event) =>
    event.kind === "model-request" && modelStageFamily(event.stage) === family
  ).length;
  const familyCap = family === "storyboard"
    ? MAX_STORYBOARD_MODEL_CALLS
    : family === "source-author"
      ? MAX_SOURCE_MODEL_CALLS
      : undefined;
  if (requests.length >= MAX_LOGICAL_MODEL_CALLS) {
    throw new SentinelModelCallBudgetError(
      `model-call budget exhausted before ${stage}: ${MAX_LOGICAL_MODEL_CALLS} logical calls`,
    );
  }
  if (requests.length + hedges >= MAX_PHYSICAL_PROVIDER_REQUESTS) {
    throw new SentinelModelCallBudgetError(
      `provider-request budget exhausted before ${stage}: ` +
        `${MAX_PHYSICAL_PROVIDER_REQUESTS} physical requests`,
    );
  }
  if (familyCap !== undefined && familyCalls >= familyCap) {
    throw new SentinelModelCallBudgetError(
      `${family} budget exhausted before ${stage}: ${familyCap} logical calls`,
    );
  }
  context.ledger.append({ kind: "model-request", stage });
}

/** Record one logical model call (already de-hedged by the retry wrappers). */
export function recordSentinelModelCall(rec: ModelCallRecord): void {
  appendSentinelLedgerEvent({ kind: "model-call", ...rec });
}

/**
 * Record a FAILED logical model call (transport fault, truncation, stall).
 * Successful calls alone would hide the most expensive runs — the ones that
 * spent calls and got nothing back.
 */
export function recordSentinelModelCallFailure(stage: string): void {
  appendSentinelLedgerEvent({ kind: "model-call-failure", stage });
}

/** Record one hedge duplicate launched (an extra physical request = cost). */
export function recordSentinelHedge(stage: string): void {
  appendSentinelLedgerEvent({ kind: "hedge-launch", stage });
}

function hedgeReserveForSourceAuthor(): number {
  const raw = Number(slackSequencesEnvRawValue("SLACK_SEQUENCES_HEDGE_SOURCE_AUTHOR_RESERVE"));
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
  const context = active();
  if (!context) return true;
  const launches = countHedgeLaunches(context.ledger.events, isSourceAuthorHedgeStage);
  if (launches.total >= maxPerRun) return false;
  const stageFamily = modelStageFamily(stage);
  if (context.ledger.events.some((event) =>
    event.kind === "hedge-launch" && modelStageFamily(event.stage) === stageFamily
  )) return false;
  const requests = reservedModelRequests(context.ledger.events).length;
  if (requests + launches.total >= MAX_PHYSICAL_PROVIDER_REQUESTS) return false;
  const authorReserve = Math.min(hedgeReserveForSourceAuthor(), maxPerRun);
  if (authorReserve > 0 && !isSourceAuthorHedgeStage(stage)) {
    const missingAuthorReserve = Math.max(0, authorReserve - launches.author);
    if (maxPerRun - launches.total <= missingAuthorReserve) return false;
  }
  recordSentinelHedge(stage);
  return true;
}

/** Record one scene-slot subcall and how many scenes it re-authored. */
export function recordSentinelSlotCall(kind: SentinelSlotCallKind, scenes: number): void {
  if (!Number.isFinite(scenes) || scenes <= 0) return;
  appendSentinelLedgerEvent({ kind: "slot-call", callKind: kind, scenes });
}

/**
 * Record that the shipping draft carries a degradation (a demoted moment, a
 * least-bad pick with open polish findings, a quarantined interaction, a
 * degraded declared cut, a browser-QA infrastructure bypass). Any entry turns
 * a `published` finalize into `published-degraded` so the disposition ledger
 * never reports a salvaged film as clean. Repeat emissions are kept in the
 * ledger; the derived view dedupes.
 */
export function recordSentinelDegradation(reason: string): void {
  if (!reason) return;
  appendSentinelLedgerEvent({ kind: "degradation", reason });
}

/** Record the reason a deterministic proof film replaced model authoring. */
export function recordSentinelFallback(reason: string): void {
  if (!reason) return;
  appendSentinelLedgerEvent({ kind: "fallback", reason });
}

/** Record final runtime proof and the quality findings left on the film. */
export function recordSentinelQualityStatus(args: {
  runtimeValid: boolean;
  qualityResidue: number;
  findingSignatures?: string[];
}): void {
  const findingSignatures = (args.findingSignatures ?? []).filter(Boolean);
  appendSentinelLedgerEvent({
    kind: "quality-status",
    runtimeValid: args.runtimeValid,
    qualityResidue: Math.max(0, Math.floor(args.qualityResidue)),
    ...(findingSignatures.length ? { findingSignatures } : {}),
  });
}

/** Count a finding caught (or a state made unrepresentable) at a given layer. */
export function recordSentinelLayerFinding(layer: SentinelLayer, count = 1): void {
  if (count <= 0) return;
  appendSentinelLedgerEvent({ kind: "layer-finding", layer, count });
}

/**
 * Count one deterministic normalization (an L2 repair). These are the repairs
 * Phase 1's scaffold moves down to L1 — the metric that should fall to ~0 for
 * the paperwork classes once skeletons emit planes/roots/islands.
 */
export function recordSentinelNormalization(tag: string, count = 1): void {
  if (count <= 0) return;
  appendSentinelLedgerEvent({ kind: "normalization", tag, count });
}

/**
 * Record shipped scaffold-contract coverage. `guaranteedBindings` is the
 * number present in the final document; `plannedBindings` is the storyboard
 * obligation count. Restoration provenance is recorded separately so L2- or
 * scene-repaired bindings are never mislabeled as surviving L1 unchanged.
 */
export function recordSentinelScaffold(guaranteedBindings: number, plannedBindings?: number): void {
  if (guaranteedBindings <= 0) return;
  appendSentinelLedgerEvent({
    kind: "scaffold-coverage",
    present: guaranteedBindings,
    planned: plannedBindings ?? guaranteedBindings,
  });
}

/** Attribute scaffold-contract restorations without pretending they survived L1 unchanged. */
export function recordSentinelScaffoldRestoration(
  source: SentinelScaffoldRestorationSource,
  count = 1,
): void {
  if (!Number.isFinite(count) || count <= 0) return;
  appendSentinelLedgerEvent({ kind: "scaffold-restoration", source, count });
}

/** Record one typed Studio catalog unit that made it into a plan. */
export function recordSentinelCatalogConversion(
  catalog: StudioCatalogName,
  entry: string,
  count = 1,
): void {
  const normalized = entry.trim();
  if (!normalized || !Number.isFinite(count) || count <= 0) return;
  appendSentinelLedgerEvent({
    kind: "catalog-conversion",
    catalog,
    entry: normalized,
    count: Math.floor(count),
  });
}

/** Attach the orchestrator's per-stage timings/attempts to the run. */
export function recordSentinelStages(stages: SentinelStageTiming[]): void {
  appendSentinelLedgerEvent({ kind: "stage-timings", stages });
}

/** Wall-clock to a delivery tier (tier 1 = thumbnails, tier 2 = MP4). */
export function recordSentinelTier(tier: "tier1" | "tier2", ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  appendSentinelLedgerEvent({ kind: "tier", tier, ms });
}

/**
 * Record a delivery tier as elapsed-since-run-start, measured where the tier
 * actually completes (inside `buildPreviews`, after the thumbnails/MP4 exist)
 * rather than where the orchestrator happens to be. Tier 1 previously stopped
 * the clock BEFORE preview generation, so the mission metric "wall-clock to
 * thumbnails" quietly excluded the thumbnails.
 */
export function recordSentinelTierFromRunStart(tier: "tier1" | "tier2"): void {
  const context = active();
  if (!context) return;
  const runStart = context.ledger.events.find((event) => event.kind === "run-start");
  if (!runStart) return;
  recordSentinelTier(tier, Date.now() - runStart.at);
}

/**
 * Finalize the run: fold the ledger into the unchanged
 * `planning/sentinel-run.json` view and persist the raw events beside it as
 * `planning/attempt-ledger.json`. Best-effort; a missing context (never began
 * a run) or a disk error is swallowed.
 */
export function finalizeSentinelRun(disposition: SentinelDisposition): void {
  const context = active();
  if (!context) return;
  if (disposition === "fallback") {
    // The orchestrator only reports the disposition today; a reason-carrying
    // fallback event is emitted here so the raw ledger names the class. S1.2
    // enriches this from the fallback path itself.
    if (!context.ledger.events.some((event) => event.kind === "fallback")) {
      context.ledger.append({ kind: "fallback", reason: "deterministic-fallback-published" });
    }
  }
  context.ledger.append({ kind: "finalize", disposition });
  try {
    const dir = path.join(context.projectDir, "planning");
    fs.mkdirSync(dir, { recursive: true });
    const view = deriveSentinelRunView(context.ledger.events);
    const status = deriveLedgerStatus(context.ledger.events);
    fs.writeFileSync(
      path.join(dir, "sentinel-run.json"),
      JSON.stringify({ ...view, ...status }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "attempt-ledger.json"),
      JSON.stringify({ version: 1, events: context.ledger.events }, null, 2),
      "utf8",
    );
  } catch {
    // Diagnostics only.
  }
}
