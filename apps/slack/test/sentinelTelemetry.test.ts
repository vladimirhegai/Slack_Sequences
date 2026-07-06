import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beginSentinelRun,
  finalizeSentinelRun,
  recordSentinelDegradation,
  recordSentinelHedge,
  recordSentinelModelCall,
  recordSentinelModelCallFailure,
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
