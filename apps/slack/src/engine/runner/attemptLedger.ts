/**
 * Attempt ledger — the single append-only record of everything a create run
 * spends and ships (REFACTOR_PLAN.md S1.1).
 *
 * One writer (`AttemptLedger.append`), typed events, no counters anywhere
 * else: the ladder and its seams emit events, and every aggregate the system
 * reports — `planning/sentinel-run.json`, receipts, probe triage — is a fold
 * over the event list (`deriveSentinelRunView`). The fold reproduces the
 * pre-ledger `sentinel-run.json` shape exactly so existing telemetry
 * consumers and tests keep working; the raw events additionally persist to
 * `planning/attempt-ledger.json` for the Phase 1 status derivations (S1.2)
 * and the one-attempt-success predicate (S1.3).
 *
 * This module is pure data + fold: no IO, no AsyncLocalStorage, no imports
 * from the runner. Context plumbing stays in `../sentinelTelemetry.ts`.
 */

/** The four honest end-states of a create (SENTINEL.md). */
export type SentinelDisposition =
  | "published"
  | "published-degraded"
  | "fallback"
  | "fail-loud";

/** The Sentinel layer model (SENTINEL.md) — where a finding was caught. */
export type SentinelLayer =
  | "schema" // L0 — invalid output can't parse
  | "scaffold" // L1 — host chassis + bindings present in the shipped document
  | "normalize" // L2 — deterministic repair, zero paid attempts
  | "static" // L3 — linkedom/regex/kitMarkupAudit findings
  | "browser" // L4 — measured browser truth
  | "model-retry"; // L5 — a paid re-author

/** The two independent publication axes (REFACTOR_PLAN.md S1.3). */
export type LedgerStatusAxis = "runtimeValid" | "qualityResidue";

/** Scene-slot subcalls hidden inside one outer logical attempt. */
export type SentinelSlotCallKind =
  | "truncation-continuation"
  | "scaffold-repair"
  | "validation-repair"
  | "storyboard-scene-repair"
  | "critic-scene-repair";

export type StudioCatalogName = "components" | "assets" | "looks" | "camera" | "plugins" | "recipes";

export interface CatalogConversionView {
  conversions: number;
  entries: Record<string, number>;
}

export type SentinelScaffoldRestorationSource = "scene-repair" | "l2-normalize";

export interface SentinelStageTiming {
  stage: string;
  status: "succeeded" | "failed";
  durationMs: number;
  attempts?: number;
}

/** The stages that run bounded logical attempt loops in the ladder. */
export type LedgerAttemptStage = "storyboard-plan" | "source-author";

/**
 * Everything the ledger records. Each body is appended once, in wall-clock
 * order, and never mutated; `seq`/`at` are stamped by the writer.
 *
 * - `attempt-start`/`attempt-end`: one LOGICAL attempt of a ladder stage.
 * - `model-request`: one logical/physical primary request reserved atomically
 *   before launch. New bounded creates use this for cap enforcement; legacy
 *   replays without reservations continue to derive request cost from outcomes.
 * - `model-call`: one successful logical completion (already de-hedged).
 * - `model-call-failure`: a spent logical call that returned nothing usable
 *   (transport fault, truncation, stall) — cost with no artifact.
 * - `hedge-launch`/`hedge-win`: extra PHYSICAL duplicate requests and which
 *   race the duplicate won. Hedges are cost, never logical attempts.
 * - `stream-timeout`: the no-progress watchdog aborted a stalled stream.
 * - `slot-call`: a scene-scoped paid subcall (repair/critic/continuation).
 * - `degradation`: the shipping draft carries this degradation (dedup happens
 *   in the derived view; the ledger keeps every emission).
 * - `fallback`: a deterministic replacement film shipped instead of authoring.
 * - `qa-finding`: one normalized QA class observed during an attempt.
 * - `quality-status`: the final runtime/quality evidence for the shipping draft.
 */
export type AttemptLedgerEventBody =
  | {
      kind: "run-start";
      projectDir: string;
      skeletonEnabled?: boolean;
      slotsEnabled?: boolean;
    }
  | { kind: "attempt-start"; stage: LedgerAttemptStage; number: number; mode?: string }
  | { kind: "attempt-end"; stage: LedgerAttemptStage; number: number; outcome: string }
  | { kind: "model-request"; stage: string }
  | { kind: "model-call"; stage: string; promptChars: number; completionChars: number }
  | { kind: "model-call-failure"; stage: string }
  | { kind: "hedge-launch"; stage: string }
  | { kind: "hedge-win"; stage: string }
  | { kind: "stream-timeout"; stage: string }
  | { kind: "slot-call"; callKind: SentinelSlotCallKind; scenes: number }
  | { kind: "degradation"; reason: string }
  | { kind: "fallback"; reason: string }
  | { kind: "qa-finding"; signature: string }
  | {
      kind: "quality-status";
      runtimeValid: boolean;
      qualityResidue: number;
      findingSignatures?: string[];
    }
  | { kind: "layer-finding"; layer: SentinelLayer; count: number }
  | { kind: "normalization"; tag: string; count: number }
  | { kind: "scaffold-coverage"; present: number; planned: number }
  | { kind: "scaffold-restoration"; source: SentinelScaffoldRestorationSource; count: number }
  | { kind: "catalog-conversion"; catalog: StudioCatalogName; entry: string; count?: number }
  | { kind: "stage-timings"; stages: SentinelStageTiming[] }
  | { kind: "tier"; tier: "tier1" | "tier2"; ms: number }
  | { kind: "finalize"; disposition: SentinelDisposition };

export type AttemptLedgerEvent = AttemptLedgerEventBody & {
  /** Append order, 0-based, assigned by the single writer. */
  seq: number;
  /** Wall-clock milliseconds (Date.now()) at append time. */
  at: number;
};

/**
 * The append-only ledger. The ONE writer for run accounting: every event
 * enters through `append`, is stamped and frozen, and is never removed.
 */
export class AttemptLedger {
  #events: AttemptLedgerEvent[] = [];

  /** Append one event. `at` is injectable only for replaying persisted runs. */
  append(body: AttemptLedgerEventBody, at = Date.now()): AttemptLedgerEvent {
    const event = Object.freeze({ ...body, seq: this.#events.length, at }) as AttemptLedgerEvent;
    this.#events.push(event);
    return event;
  }

  get events(): readonly AttemptLedgerEvent[] {
    return this.#events;
  }

  /** Rebuild a ledger from persisted events (attempt-ledger.json). */
  static replay(events: readonly (AttemptLedgerEventBody & { at: number })[]): AttemptLedger {
    const ledger = new AttemptLedger();
    for (const { at, ...body } of events) {
      // seq is re-stamped from append order; persisted order IS the order.
      const { seq: _seq, ...rest } = body as AttemptLedgerEventBody & { seq?: number };
      ledger.append(rest as AttemptLedgerEventBody, at);
    }
    return ledger;
  }
}

/** The persisted `planning/sentinel-run.json` payload — now a derived view. */
export interface SentinelRunView {
  disposition: SentinelDisposition;
  startedAt: string;
  durationMs: number;
  skeletonEnabled: boolean | null;
  slotsEnabled: boolean | null;
  wallClock: { tier1Ms: number | null; tier2Ms: number | null };
  stages: SentinelStageTiming[];
  modelCalls: {
    total: number;
    successfulLogicalTotal: number;
    byStage: Record<string, number>;
    failed: Record<string, number>;
    failedTotal: number;
    hedged: Record<string, number>;
    hedgedTotal: number;
    physicalRequestTotal: number;
  };
  slotCalls: Record<SentinelSlotCallKind, { calls: number; scenes: number }>;
  degradations: string[];
  promptChars: { maxAuthor: number; totalPrompt: number; totalCompletion: number };
  layers: Record<SentinelLayer, number>;
  scaffoldCoverage: { planned: number; present: number } | null;
  scaffoldRestorationEvents: Record<SentinelScaffoldRestorationSource, number>;
  normalizations: Record<string, number>;
  at: string;
  catalogConversions?: Record<StudioCatalogName, CatalogConversionView>;
}

/** Status derived exclusively from the append-only event stream. */
export interface LedgerStatus {
  runtimeValid: boolean;
  qualityResidue: number;
  degradedAxes: LedgerStatusAxis[];
  repeatedQaClasses: string[];
  modelRepair: boolean;
  proofFilm: boolean;
  materialDegradation: boolean;
  oneAttemptSuccess: boolean;
  disposition: SentinelDisposition;
}

/** Argument-free receipt data derived from stage-timing and attempt events. */
export interface LedgerStageReceipt {
  stage: string;
  status: "succeeded" | "failed";
  durationMs: number;
  attempts?: number;
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

function emptySlotCalls(): Record<SentinelSlotCallKind, { calls: number; scenes: number }> {
  return {
    "truncation-continuation": { calls: 0, scenes: 0 },
    "scaffold-repair": { calls: 0, scenes: 0 },
    "validation-repair": { calls: 0, scenes: 0 },
    "storyboard-scene-repair": { calls: 0, scenes: 0 },
    "critic-scene-repair": { calls: 0, scenes: 0 },
  };
}

function emptyCatalogConversions(): Record<StudioCatalogName, CatalogConversionView> {
  return {
    components: { conversions: 0, entries: {} },
    assets: { conversions: 0, entries: {} },
    looks: { conversions: 0, entries: {} },
    camera: { conversions: 0, entries: {} },
    plugins: { conversions: 0, entries: {} },
    recipes: { conversions: 0, entries: {} },
  };
}

function qaClass(signature: string): string {
  const text = signature.trim().replace(/^other:/i, "");
  return text.match(/^[a-z][a-z0-9_/-]*/i)?.[0] ?? text.slice(0, 120);
}

function finalDisposition(events: readonly AttemptLedgerEvent[]): {
  disposition: SentinelDisposition;
  degradations: string[];
} {
  let disposition: SentinelDisposition | undefined;
  const degradations: string[] = [];
  for (const event of events) {
    if (event.kind === "degradation" && !degradations.includes(event.reason)) {
      degradations.push(event.reason);
    }
    if (event.kind === "finalize") disposition = event.disposition;
  }
  let resolved = disposition ?? "fail-loud";
  if (resolved === "published" && degradations.length) resolved = "published-degraded";
  return { disposition: resolved, degradations };
}

function stageAttemptCounts(events: readonly AttemptLedgerEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (event.kind !== "attempt-start") continue;
    counts[event.stage] = Math.max(counts[event.stage] ?? 0, event.number);
  }
  return counts;
}

/** Derive the display receipt without consulting orchestrator-local counters. */
export function deriveLedgerStageReceipts(
  events: readonly AttemptLedgerEvent[],
): LedgerStageReceipt[] {
  const attempts = stageAttemptCounts(events);
  let timings: SentinelStageTiming[] = [];
  for (const event of events) {
    if (event.kind === "stage-timings") timings = event.stages;
  }
  return timings.map((stage) => ({
    ...stage,
    ...(stage.attempts !== undefined
      ? { attempts: stage.attempts }
      : attempts[stage.stage] !== undefined
        ? { attempts: attempts[stage.stage] }
        : {}),
  }));
}

/**
 * Fold honest publication semantics from the event stream. The optional
 * fallback is only for pre-S1.3 persisted runs that have no quality-status
 * event; new runs always carry the explicit event.
 */
export function deriveLedgerStatus(
  events: readonly AttemptLedgerEvent[],
  fallback?: Partial<Pick<LedgerStatus, "runtimeValid" | "qualityResidue">>,
): LedgerStatus {
  const terminal = finalDisposition(events);
  let runtimeValid = fallback?.runtimeValid ?? terminal.disposition !== "fail-loud";
  let qualityResidue = fallback?.qualityResidue ?? 0;
  const qaClasses = new Map<string, number>();
  let proofFilm = false;
  let modelRepair = false;

  for (const event of events) {
    if (event.kind === "quality-status") {
      runtimeValid = event.runtimeValid;
      qualityResidue = Math.max(0, Math.floor(event.qualityResidue));
      for (const signature of event.findingSignatures ?? []) {
        const key = qaClass(signature);
        qaClasses.set(key, (qaClasses.get(key) ?? 0) + 1);
      }
    } else if (event.kind === "qa-finding") {
      const key = qaClass(event.signature);
      qaClasses.set(key, (qaClasses.get(key) ?? 0) + 1);
    } else if (event.kind === "fallback") {
      proofFilm = true;
    } else if (event.kind === "attempt-start" && event.number > 1) {
      modelRepair = true;
    } else if (
      event.kind === "model-call" &&
      /patch|critic|repair|rescue/i.test(event.stage)
    ) {
      modelRepair = true;
    } else if (event.kind === "slot-call") {
      modelRepair = true;
    }
  }

  const repeatedQaClasses = [...qaClasses.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const materialDegradation = terminal.degradations.length > 0;
  const degradedAxes: LedgerStatusAxis[] = [];
  if (!runtimeValid) degradedAxes.push("runtimeValid");
  if (qualityResidue > 0 || (terminal.disposition === "published-degraded" && runtimeValid)) {
    degradedAxes.push("qualityResidue");
  }
  const oneAttemptSuccess =
    !modelRepair &&
    !proofFilm &&
    !materialDegradation &&
    repeatedQaClasses.length === 0;

  return {
    runtimeValid,
    qualityResidue,
    degradedAxes,
    repeatedQaClasses,
    modelRepair,
    proofFilm,
    materialDegradation,
    oneAttemptSuccess,
    disposition: terminal.disposition,
  };
}

/**
 * Fold the event list into the exact pre-ledger `sentinel-run.json` payload.
 * Aggregation semantics reproduce the retired per-site counters bit for bit:
 * degradations dedupe on first occurrence, the scaffold layer takes the MAX
 * of reported coverage, normalizations add to the normalize layer, stage
 * timings and tiers are last-write-wins, and a `published` finalize with any
 * recorded degradation downgrades to `published-degraded`.
 */
export function deriveSentinelRunView(events: readonly AttemptLedgerEvent[]): SentinelRunView {
  let startedAt: number | undefined;
  let finalizedAt: number | undefined;
  let skeletonEnabled: boolean | undefined;
  let slotsEnabled: boolean | undefined;
  let disposition: SentinelDisposition | undefined;
  let tier1Ms: number | undefined;
  let tier2Ms: number | undefined;
  let stages: SentinelStageTiming[] = [];
  const byStage: Record<string, number> = {};
  const failed: Record<string, number> = {};
  const hedged: Record<string, number> = {};
  const slotCalls = emptySlotCalls();
  const degradations: string[] = [];
  const layers = emptyLayers();
  const normalizations: Record<string, number> = {};
  let scaffoldCoverage: { planned: number; present: number } | undefined;
  const scaffoldRestorationEvents: Record<SentinelScaffoldRestorationSource, number> = {
    "scene-repair": 0,
    "l2-normalize": 0,
  };
  let successfulCalls = 0;
  let failedTotal = 0;
  let hedgedTotal = 0;
  let reservedLogicalTotal = 0;
  let totalPromptChars = 0;
  let totalCompletionChars = 0;
  let maxAuthorPromptChars = 0;
  const catalogConversions = emptyCatalogConversions();
  let hasCatalogConversions = false;

  for (const event of events) {
    switch (event.kind) {
      case "run-start":
        startedAt = event.at;
        skeletonEnabled = event.skeletonEnabled;
        slotsEnabled = event.slotsEnabled;
        break;
      case "model-call":
        successfulCalls += 1;
        byStage[event.stage] = (byStage[event.stage] ?? 0) + 1;
        totalPromptChars += event.promptChars;
        totalCompletionChars += event.completionChars;
        if (/author/i.test(event.stage)) {
          maxAuthorPromptChars = Math.max(maxAuthorPromptChars, event.promptChars);
        }
        break;
      case "model-request":
        reservedLogicalTotal += 1;
        break;
      case "model-call-failure":
        failed[event.stage] = (failed[event.stage] ?? 0) + 1;
        failedTotal += 1;
        break;
      case "hedge-launch":
        hedged[event.stage] = (hedged[event.stage] ?? 0) + 1;
        hedgedTotal += 1;
        break;
      case "slot-call":
        slotCalls[event.callKind].calls += 1;
        slotCalls[event.callKind].scenes += Math.floor(event.scenes);
        break;
      case "degradation":
        if (!degradations.includes(event.reason)) degradations.push(event.reason);
        break;
      case "layer-finding":
        layers[event.layer] += event.count;
        break;
      case "normalization":
        normalizations[event.tag] = (normalizations[event.tag] ?? 0) + event.count;
        layers.normalize += event.count;
        break;
      case "scaffold-coverage":
        layers.scaffold = Math.max(layers.scaffold, event.present);
        scaffoldCoverage = {
          present: event.present,
          planned: Math.max(event.present, event.planned),
        };
        break;
      case "scaffold-restoration":
        scaffoldRestorationEvents[event.source] += Math.floor(event.count);
        break;
      case "catalog-conversion": {
        hasCatalogConversions = true;
        const count = Math.max(1, Math.floor(event.count ?? 1));
        catalogConversions[event.catalog].conversions += count;
        catalogConversions[event.catalog].entries[event.entry] =
          (catalogConversions[event.catalog].entries[event.entry] ?? 0) + count;
        break;
      }
      case "stage-timings":
        {
          const attempts = stageAttemptCounts(events);
          stages = event.stages.map((stage) => ({
            ...stage,
            ...(stage.attempts === undefined && attempts[stage.stage] !== undefined
              ? { attempts: attempts[stage.stage] }
              : {}),
          }));
        }
        break;
      case "tier":
        if (event.tier === "tier1") tier1Ms = event.ms;
        else tier2Ms = event.ms;
        break;
      case "finalize":
        finalizedAt = event.at;
        disposition = event.disposition;
        break;
      // attempt-start/attempt-end/hedge-win/stream-timeout/fallback/QA status carry
      // detail the legacy view never aggregated; S1.2/S1.3 read them from the
      // raw events.
      default:
        break;
    }
  }

  // The honesty downgrade (SENTINEL.md): a "published" run that shipped with
  // recorded degradations is published-degraded.
  let finalDisposition = disposition ?? "fail-loud";
  if (finalDisposition === "published" && degradations.length) {
    finalDisposition = "published-degraded";
  }
  const start = startedAt ?? events[0]?.at ?? Date.now();
  const end = finalizedAt ?? events[events.length - 1]?.at ?? start;

  return {
    disposition: finalDisposition,
    startedAt: new Date(start).toISOString(),
    durationMs: end - start,
    skeletonEnabled: skeletonEnabled ?? null,
    slotsEnabled: slotsEnabled ?? null,
    wallClock: { tier1Ms: tier1Ms ?? null, tier2Ms: tier2Ms ?? null },
    stages,
    modelCalls: {
      // `total` remains as the backwards-compatible successful-logical count.
      total: successfulCalls,
      successfulLogicalTotal: successfulCalls,
      byStage,
      failed,
      failedTotal,
      hedged,
      hedgedTotal,
      physicalRequestTotal:
        (reservedLogicalTotal || successfulCalls + failedTotal) + hedgedTotal,
    },
    slotCalls,
    degradations,
    promptChars: {
      maxAuthor: maxAuthorPromptChars,
      totalPrompt: totalPromptChars,
      totalCompletion: totalCompletionChars,
    },
    layers,
    scaffoldCoverage: scaffoldCoverage ?? null,
    scaffoldRestorationEvents,
    normalizations,
    at: new Date(end).toISOString(),
    ...(hasCatalogConversions ? { catalogConversions } : {}),
  };
}

/** Total hedge duplicates launched, plus the author-stage share (budget math). */
export function countHedgeLaunches(
  events: readonly AttemptLedgerEvent[],
  isAuthorStage: (stage: string) => boolean,
): { total: number; author: number } {
  let total = 0;
  let author = 0;
  for (const event of events) {
    if (event.kind !== "hedge-launch") continue;
    total += 1;
    if (isAuthorStage(event.stage)) author += 1;
  }
  return { total, author };
}
