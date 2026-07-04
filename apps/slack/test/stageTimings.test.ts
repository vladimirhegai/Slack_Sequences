import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-timings-"));
  process.env.SLACK_SEQUENCES_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SLACK_SEQUENCES_DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function load() {
  return import("../src/engine/stageTimings.ts");
}

describe("stage timings", () => {
  it("estimates from the seed table before any observations", async () => {
    const { estimateStepMs } = await load();
    expect(estimateStepMs("storyboard-plan")).toBeGreaterThan(0);
    expect(estimateStepMs("never-heard-of-this-step")).toBeGreaterThan(0);
  });

  it("learns an EMA from recorded durations and persists it", async () => {
    const { estimateStepMs, recordStepDuration } = await load();
    recordStepDuration("storyboard-plan", 20_000);
    expect(estimateStepMs("storyboard-plan")).toBe(20_000);
    recordStepDuration("storyboard-plan", 40_000);
    const blended = estimateStepMs("storyboard-plan");
    expect(blended).toBeGreaterThan(20_000);
    expect(blended).toBeLessThan(40_000);
  });

  it("ignores junk durations instead of corrupting the table", async () => {
    const { estimateStepMs, recordStepDuration } = await load();
    const seed = estimateStepMs("render");
    recordStepDuration("render", Number.NaN);
    recordStepDuration("render", -5);
    recordStepDuration("render", 0);
    expect(estimateStepMs("render")).toBe(seed);
  });
});

describe("EtaTracker", () => {
  it("counts down as steps complete and never returns a negative label", async () => {
    const { EtaTracker } = await load();
    const tracker = new EtaTracker(["frame-design", "storyboard-plan"]);
    const before = tracker.remainingMs();
    expect(before).toBeGreaterThan(0);
    tracker.start("frame-design");
    tracker.complete("frame-design", 5_000);
    expect(tracker.remainingMs()).toBeLessThan(before);
    tracker.complete("storyboard-plan", 30_000);
    expect(tracker.label()).toBe("wrapping up…");
  });

  it("adds unexpected steps when they start", async () => {
    const { EtaTracker } = await load();
    const tracker = new EtaTracker([]);
    expect(tracker.remainingMs()).toBe(0);
    tracker.start("render");
    expect(tracker.remainingMs()).toBeGreaterThan(0);
  });

  it("switches to honest copy once the running step overruns its estimate", async () => {
    const { EtaTracker, recordStepDuration } = await load();
    recordStepDuration("source-author", 1);
    const tracker = new EtaTracker(["source-author"]);
    tracker.start("source-author");
    // estimate is ~1ms and elapsed already exceeds it → no frozen countdown
    expect(tracker.label()).toBe("wrapping up…");
  });

  it("formats minutes for long estimates", async () => {
    const { formatEtaMs } = await load();
    expect(formatEtaMs(45_000)).toBe("~45s remaining");
    expect(formatEtaMs(150_000)).toMatch(/min remaining$/);
  });

  it("shows an optimistic half-time estimate and rounds down", async () => {
    const { formatEtaMs, visibleEtaMs } = await load();
    expect(visibleEtaMs(16 * 60_000)).toBe(8 * 60_000);
    expect(formatEtaMs(visibleEtaMs(16 * 60_000))).toBe("~8 min remaining");
    expect(formatEtaMs(49_000)).toBe("~45s remaining");
  });
});
