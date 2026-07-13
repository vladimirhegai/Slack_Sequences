/**
 * S1.1 — the attempt ledger replays recorded runs exactly.
 *
 * The fixtures are byte copies of two real paid probes' persisted
 * `planning/sentinel-run.json` (Briefly `refactor-review-normal-1-20260711`
 * and SignalDock `architecture-stress-5-20260711`, PROBE_LOG.md). Each test
 * reconstructs the run's event stream, folds it through
 * `deriveSentinelRunView`, and requires the derived view to reproduce every
 * recorded counter exactly — the proof that the ledger fold and the retired
 * per-site counters agree on real runs.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AttemptLedger,
  deriveLedgerStageReceipts,
  deriveLedgerStatus,
  deriveSentinelRunView,
  type SentinelDisposition,
  type SentinelLayer,
  type SentinelScaffoldRestorationSource,
  type SentinelSlotCallKind,
  type SentinelStageTiming,
} from "../src/engine/runner/attemptLedger.ts";

interface RecordedRun {
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
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadRecordedRun(name: string): RecordedRun {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8")) as RecordedRun;
}

/**
 * Reconstruct a recorded run's event stream. Character totals are distributed
 * deterministically (the recorded file keeps aggregates, not per-call sizes):
 * the first author-stage call carries the recorded max author prompt, the
 * first non-author call carries the remaining prompt volume, and the first
 * call carries all completion characters — any distribution with these
 * invariants folds back to the recorded aggregates.
 */
function ledgerFromRecordedRun(recorded: RecordedRun): AttemptLedger {
  const ledger = new AttemptLedger();
  const startAt = Date.parse(recorded.startedAt);
  ledger.append(
    {
      kind: "run-start",
      projectDir: "/replayed-run",
      ...(recorded.skeletonEnabled === null ? {} : { skeletonEnabled: recorded.skeletonEnabled }),
      ...(recorded.slotsEnabled === null ? {} : { slotsEnabled: recorded.slotsEnabled }),
    },
    startAt,
  );

  const isAuthorStage = (stage: string): boolean => /author/i.test(stage);
  const stageEntries = Object.entries(recorded.modelCalls.byStage);
  const nonAuthorPrompt = recorded.promptChars.totalPrompt - recorded.promptChars.maxAuthor;
  expect(nonAuthorPrompt).toBeGreaterThanOrEqual(0);
  expect(stageEntries.some(([stage]) => !isAuthorStage(stage))).toBe(true);
  let authorMaxAssigned = false;
  let remainderAssigned = false;
  let completionAssigned = false;
  for (const [stage, count] of stageEntries) {
    for (let call = 0; call < count; call += 1) {
      let promptChars = 0;
      if (!authorMaxAssigned && isAuthorStage(stage)) {
        promptChars = recorded.promptChars.maxAuthor;
        authorMaxAssigned = true;
      } else if (!remainderAssigned && !isAuthorStage(stage)) {
        promptChars = nonAuthorPrompt;
        remainderAssigned = true;
      }
      const completionChars = completionAssigned ? 0 : recorded.promptChars.totalCompletion;
      completionAssigned = true;
      ledger.append({ kind: "model-call", stage, promptChars, completionChars }, startAt);
    }
  }
  for (const [stage, count] of Object.entries(recorded.modelCalls.failed)) {
    for (let call = 0; call < count; call += 1) {
      ledger.append({ kind: "model-call-failure", stage }, startAt);
    }
  }
  for (const [stage, count] of Object.entries(recorded.modelCalls.hedged)) {
    for (let call = 0; call < count; call += 1) {
      ledger.append({ kind: "hedge-launch", stage }, startAt);
    }
  }
  for (const [callKind, { calls, scenes }] of Object.entries(recorded.slotCalls) as Array<
    [SentinelSlotCallKind, { calls: number; scenes: number }]
  >) {
    if (calls === 0) {
      expect(scenes).toBe(0);
      continue;
    }
    const firstScenes = scenes - (calls - 1);
    expect(firstScenes).toBeGreaterThanOrEqual(1);
    ledger.append({ kind: "slot-call", callKind, scenes: firstScenes }, startAt);
    for (let call = 1; call < calls; call += 1) {
      ledger.append({ kind: "slot-call", callKind, scenes: 1 }, startAt);
    }
  }
  for (const reason of recorded.degradations) {
    ledger.append({ kind: "degradation", reason }, startAt);
  }
  for (const layer of ["schema", "static", "browser", "model-retry"] as const) {
    if (recorded.layers[layer] > 0) {
      ledger.append({ kind: "layer-finding", layer, count: recorded.layers[layer] }, startAt);
    }
  }
  let normalizationSum = 0;
  for (const [tag, count] of Object.entries(recorded.normalizations)) {
    normalizationSum += count;
    ledger.append({ kind: "normalization", tag, count }, startAt);
  }
  // Every recorded normalize-layer finding must be attributable to a tagged
  // normalization — the recorded runs never counted the layer directly.
  expect(normalizationSum).toBe(recorded.layers.normalize);
  if (recorded.scaffoldCoverage) {
    expect(recorded.layers.scaffold).toBe(recorded.scaffoldCoverage.present);
    ledger.append(
      {
        kind: "scaffold-coverage",
        present: recorded.scaffoldCoverage.present,
        planned: recorded.scaffoldCoverage.planned,
      },
      startAt,
    );
  }
  for (const [source, count] of Object.entries(recorded.scaffoldRestorationEvents) as Array<
    [SentinelScaffoldRestorationSource, number]
  >) {
    if (count > 0) ledger.append({ kind: "scaffold-restoration", source, count }, startAt);
  }
  ledger.append({ kind: "stage-timings", stages: recorded.stages }, startAt);
  if (recorded.wallClock.tier1Ms !== null) {
    ledger.append({ kind: "tier", tier: "tier1", ms: recorded.wallClock.tier1Ms }, startAt);
  }
  if (recorded.wallClock.tier2Ms !== null) {
    ledger.append({ kind: "tier", tier: "tier2", ms: recorded.wallClock.tier2Ms }, startAt);
  }
  ledger.append(
    { kind: "finalize", disposition: recorded.disposition },
    startAt + recorded.durationMs,
  );
  return ledger;
}

describe.each([
  ["Briefly refactor-review-normal-1-20260711", "sentinel-run-briefly-20260711.json"],
  ["SignalDock architecture-stress-5-20260711", "sentinel-run-signaldock-20260711.json"],
])("recorded run replay — %s", (_label, fixture) => {
  it("reproduces the recorded sentinel-run.json counters exactly", () => {
    const recorded = loadRecordedRun(fixture);
    const ledger = ledgerFromRecordedRun(recorded);
    const { at: _derivedAt, ...derived } = deriveSentinelRunView(ledger.events);
    const { at: _recordedAt, ...expected } = recorded;
    expect(derived).toEqual(expected);
  });

  it("survives a JSON persistence round-trip (attempt-ledger.json replay)", () => {
    const recorded = loadRecordedRun(fixture);
    const ledger = ledgerFromRecordedRun(recorded);
    const persisted = JSON.parse(JSON.stringify({ version: 1, events: ledger.events }));
    const replayed = AttemptLedger.replay(persisted.events);
    expect(deriveSentinelRunView(replayed.events)).toEqual(deriveSentinelRunView(ledger.events));
  });
});

describe("recorded probe headline numbers (PROBE_LOG.md)", () => {
  it("both probes fold to 10 logical / 14 physical calls", () => {
    for (const fixture of [
      "sentinel-run-briefly-20260711.json",
      "sentinel-run-signaldock-20260711.json",
    ]) {
      const view = deriveSentinelRunView(ledgerFromRecordedRun(loadRecordedRun(fixture)).events);
      expect(view.modelCalls.total).toBe(10);
      expect(view.modelCalls.physicalRequestTotal).toBe(14);
      expect(view.disposition).toBe("published-degraded");
    }
  });

  it("reports SignalDock's two honest status axes", () => {
    const recorded = loadRecordedRun("sentinel-run-signaldock-20260711.json");
    const ledger = ledgerFromRecordedRun(recorded);
    ledger.append({
      kind: "quality-status",
      runtimeValid: true,
      qualityResidue: 8,
      findingSignatures: Array.from({ length: 8 }, (_, index) => `qa_${index}`),
    });
    const status = deriveLedgerStatus(ledger.events);
    expect(status.runtimeValid).toBe(true);
    expect(status.qualityResidue).toBe(8);
  });
});

describe("AttemptLedger", () => {
  it("stamps append order and freezes events", () => {
    const ledger = new AttemptLedger();
    const first = ledger.append({ kind: "model-call-failure", stage: "storyboard" });
    const second = ledger.append({ kind: "hedge-launch", stage: "storyboard" });
    expect(first.seq).toBe(0);
    expect(second.seq).toBe(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { stage: string }).stage = "tampered";
    }).toThrow();
  });

  it("downgrades a published finalize when any degradation was recorded", () => {
    const ledger = new AttemptLedger();
    ledger.append({ kind: "run-start", projectDir: "/x" });
    ledger.append({ kind: "degradation", reason: "least-bad-pick:penalty=3" });
    ledger.append({ kind: "finalize", disposition: "published" });
    expect(deriveSentinelRunView(ledger.events).disposition).toBe("published-degraded");
  });

  it("keeps duplicate degradation emissions in the ledger but dedupes the view", () => {
    const ledger = new AttemptLedger();
    ledger.append({ kind: "run-start", projectDir: "/x" });
    ledger.append({ kind: "degradation", reason: "browser-qa-infra-bypass" });
    ledger.append({ kind: "degradation", reason: "browser-qa-infra-bypass" });
    ledger.append({ kind: "finalize", disposition: "fallback" });
    expect(ledger.events.filter((event) => event.kind === "degradation")).toHaveLength(2);
    expect(deriveSentinelRunView(ledger.events).degradations).toEqual([
      "browser-qa-infra-bypass",
    ]);
  });

  it("records attempt lifecycles without affecting the legacy counters", () => {
    const ledger = new AttemptLedger();
    ledger.append({ kind: "run-start", projectDir: "/x" });
    ledger.append({ kind: "attempt-start", stage: "storyboard-plan", number: 1, mode: "primary" });
    ledger.append({ kind: "attempt-end", stage: "storyboard-plan", number: 1, outcome: "accepted" });
    ledger.append({ kind: "hedge-win", stage: "storyboard" });
    ledger.append({ kind: "stream-timeout", stage: "storyboard" });
    ledger.append({ kind: "fallback", reason: "deterministic-fallback-published" });
    ledger.append({ kind: "finalize", disposition: "fallback" });
    const view = deriveSentinelRunView(ledger.events);
    expect(view.modelCalls.total).toBe(0);
    expect(view.modelCalls.physicalRequestTotal).toBe(0);
    expect(view.disposition).toBe("fallback");
  });

  it("uses launch reservations for physical cost without double-counting outcomes", () => {
    const ledger = new AttemptLedger();
    ledger.append({ kind: "run-start", projectDir: "/x" });
    ledger.append({ kind: "model-request", stage: "frame-design" });
    ledger.append({ kind: "model-call", stage: "frame-design", promptChars: 10, completionChars: 5 });
    ledger.append({ kind: "model-request", stage: "storyboard" });
    ledger.append({ kind: "model-call-failure", stage: "storyboard" });
    ledger.append({ kind: "hedge-launch", stage: "storyboard" });
    ledger.append({ kind: "finalize", disposition: "fail-loud" });
    const view = deriveSentinelRunView(ledger.events);
    expect(view.modelCalls.total).toBe(1);
    expect(view.modelCalls.failedTotal).toBe(1);
    expect(view.modelCalls.hedgedTotal).toBe(1);
    expect(view.modelCalls.physicalRequestTotal).toBe(3);
  });

  it("derives the honest axes and repeated QA classes from events", () => {
    const ledger = new AttemptLedger();
    ledger.append({ kind: "run-start", projectDir: "/x" });
    ledger.append({ kind: "attempt-start", stage: "storyboard-plan", number: 1, mode: "primary" });
    ledger.append({ kind: "attempt-start", stage: "source-author", number: 1, mode: "full" });
    ledger.append({
      kind: "quality-status",
      runtimeValid: true,
      qualityResidue: 8,
      findingSignatures: ["camera_framed_sparse:one", "composition_washed_out:one"],
    });
    ledger.append({ kind: "finalize", disposition: "published-degraded" });
    const status = deriveLedgerStatus(ledger.events);
    expect(status.runtimeValid).toBe(true);
    expect(status.qualityResidue).toBe(8);
    expect(status.degradedAxes).toEqual(["qualityResidue"]);
    expect(status.repeatedQaClasses).toEqual([]);
    expect(status.oneAttemptSuccess).toBe(true);
  });

  it("derives receipt attempts from attempt-start events", () => {
    const ledger = new AttemptLedger();
    ledger.append({ kind: "run-start", projectDir: "/x" });
    ledger.append({ kind: "attempt-start", stage: "source-author", number: 1, mode: "full" });
    ledger.append({ kind: "attempt-start", stage: "source-author", number: 2, mode: "patch" });
    ledger.append({
      kind: "stage-timings",
      stages: [{ stage: "source-author", status: "succeeded", durationMs: 12 }],
    });
    expect(deriveLedgerStageReceipts(ledger.events)).toEqual([
      { stage: "source-author", status: "succeeded", durationMs: 12, attempts: 2 },
    ]);
  });
});
