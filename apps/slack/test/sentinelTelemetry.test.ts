import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beginSentinelRun,
  claimSentinelHedge,
  finalizeSentinelRun,
  recordSentinelDegradation,
  recordSentinelHedge,
  recordSentinelModelCall,
  recordSentinelModelCallFailure,
  recordSentinelScaffold,
  recordSentinelScaffoldRestoration,
  recordSentinelSlotCall,
  recordSentinelTierFromRunStart,
} from "../src/engine/sentinelTelemetry.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-telemetry-"));
  roots.push(dir);
  return dir;
}
function readRun(dir: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(dir, "planning", "sentinel-run.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("sentinel telemetry — disposition honesty", () => {
  it("downgrades a published run with recorded degradations to published-degraded", () => {
    const dir = tempDir();
    beginSentinelRun(dir);
    recordSentinelDegradation("least-bad-pick:penalty=3");
    recordSentinelDegradation("least-bad-pick:penalty=3");
    recordSentinelDegradation("interaction-quarantine:cursor-press");
    finalizeSentinelRun("published");
    const run = readRun(dir);
    expect(run.disposition).toBe("published-degraded");
    expect(run.degradations).toEqual([
      "least-bad-pick:penalty=3",
      "interaction-quarantine:cursor-press",
    ]);
  });

  it("keeps a clean published run published (no degradations)", () => {
    const dir = tempDir();
    beginSentinelRun(dir);
    finalizeSentinelRun("published");
    expect(readRun(dir).disposition).toBe("published");
  });

  it("never upgrades a fallback/fail-loud disposition", () => {
    const dir = tempDir();
    beginSentinelRun(dir);
    recordSentinelDegradation("anything");
    finalizeSentinelRun("fallback");
    expect(readRun(dir).disposition).toBe("fallback");
  });
});

describe("sentinel telemetry — cost honesty", () => {
  it("records failed and hedged model calls beside the success ledger", () => {
    const dir = tempDir();
    beginSentinelRun(dir);
    recordSentinelModelCall({ stage: "author source", promptChars: 100, completionChars: 50 });
    recordSentinelModelCallFailure("author source");
    recordSentinelModelCallFailure("storyboard");
    recordSentinelHedge("author source");
    finalizeSentinelRun("published");
    const run = readRun(dir);
    const calls = run.modelCalls as Record<string, unknown>;
    expect(calls.total).toBe(1);
    expect(calls.failedTotal).toBe(2);
    expect(calls.failed).toEqual({ "author source": 1, storyboard: 1 });
    expect(calls.hedgedTotal).toBe(1);
    expect(calls.successfulLogicalTotal).toBe(1);
    expect(calls.physicalRequestTotal).toBe(4);
  });

  it("exposes hidden slot subcalls and honest scaffold coverage/provenance", () => {
    const dir = tempDir();
    beginSentinelRun(dir);
    recordSentinelSlotCall("truncation-continuation", 2);
    recordSentinelSlotCall("scaffold-repair", 1);
    recordSentinelScaffoldRestoration("scene-repair", 2);
    recordSentinelScaffoldRestoration("l2-normalize", 1);
    recordSentinelScaffold(7, 9);
    finalizeSentinelRun("published");
    const run = readRun(dir);
    expect(run.slotCalls).toEqual({
      "truncation-continuation": { calls: 1, scenes: 2 },
      "scaffold-repair": { calls: 1, scenes: 1 },
      "validation-repair": { calls: 0, scenes: 0 },
      "storyboard-scene-repair": { calls: 0, scenes: 0 },
      "critic-scene-repair": { calls: 0, scenes: 0 },
    });
    expect(run.scaffoldCoverage).toEqual({ present: 7, planned: 9 });
    expect(run.scaffoldRestorationEvents).toEqual({
      "scene-repair": 2,
      "l2-normalize": 1,
    });
  });

  it("enforces a per-run hedge budget atomically", () => {
    const dir = tempDir();
    beginSentinelRun(dir);
    expect(claimSentinelHedge("storyboard", 2)).toBe(true);
    expect(claimSentinelHedge("author source", 2)).toBe(true);
    expect(claimSentinelHedge("author patch", 2)).toBe(false);
    finalizeSentinelRun("published");
    const calls = readRun(dir).modelCalls as Record<string, unknown>;
    expect(calls.hedgedTotal).toBe(2);
  });

  it("reserves a hedge for source-author before non-author stages spend the cap", () => {
    const dir = tempDir();
    beginSentinelRun(dir);
    expect(claimSentinelHedge("storyboard", 2)).toBe(true);
    expect(claimSentinelHedge("storyboard rescue", 2)).toBe(false);
    expect(claimSentinelHedge("author source", 2)).toBe(true);
    finalizeSentinelRun("published");
    const run = readRun(dir);
    const calls = run.modelCalls as Record<string, unknown>;
    expect(calls.hedgedTotal).toBe(2);
    expect(calls.hedged).toMatchObject({
      storyboard: 1,
      "author source": 1,
    });
  });

  it("records tier wall-clock from run start where the tier artifact exists", () => {
    const dir = tempDir();
    beginSentinelRun(dir);
    recordSentinelTierFromRunStart("tier1");
    finalizeSentinelRun("published");
    const wallClock = readRun(dir).wallClock as Record<string, unknown>;
    expect(typeof wallClock.tier1Ms).toBe("number");
    expect(wallClock.tier2Ms).toBeNull();
  });
});
