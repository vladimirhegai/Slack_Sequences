/**
 * Estimated-time-remaining for a build, replacing the old raw elapsed-seconds
 * stopwatch. Judges watching a multi-minute generation should see a countdown
 * that sharpens as stages land, not a climbing timer that reads as "stuck".
 *
 * Estimates start from a seeded per-step table and are refined by a persisted
 * EMA of real observed durations (same naive read/modify/write JSON idiom as
 * jobStore.ts). Estimation only ever shapes display copy — it never gates or
 * times out any real work.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./projectTemplates.ts";

/** Model authoring stages + MCP tool steps share one timing namespace. */
export type TimedStep = string;

/**
 * Seeded expectations (ms), order-of-magnitude from observed live runs and the
 * stage timeout budgets (storyboard reasoning ~120s cap, author ~360s cap).
 * Real EMA data replaces these after the first few runs.
 */
const SEED_MS: Record<string, number> = {
  "frame-design": 10_000,
  "storyboard-plan": 60_000,
  "source-author": 120_000,
  submit_composition: 8_000,
  submit_plan: 4_000,
  apply_commands: 6_000,
  render_preview: 20_000,
  render: 75_000,
  undo: 2_000,
};

const DEFAULT_STEP_MS = 15_000;
const EMA_ALPHA = 0.3;

function timingsFile(): string {
  return path.join(dataDir(), "stage-timings.json");
}

function readTimings(): Record<string, number> {
  try {
    const parsed = JSON.parse(fs.readFileSync(timingsFile(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Fold one real observed duration into the persisted per-step EMA. */
export function recordStepDuration(step: TimedStep, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  try {
    const timings = readTimings();
    const previous = timings[step];
    timings[step] = Math.round(
      previous && previous > 0
        ? previous * (1 - EMA_ALPHA) + durationMs * EMA_ALPHA
        : durationMs,
    );
    fs.mkdirSync(path.dirname(timingsFile()), { recursive: true });
    fs.writeFileSync(timingsFile(), JSON.stringify(timings, null, 2) + "\n");
  } catch {
    // Timing bookkeeping must never disturb a build.
  }
}

export function estimateStepMs(step: TimedStep): number {
  const learned = readTimings()[step];
  if (learned && learned > 0) return learned;
  return SEED_MS[step] ?? DEFAULT_STEP_MS;
}

/**
 * One tracker per build. Seed it with the steps the flow expects; steps that
 * start unexpectedly are added on the fly, and expected steps that never run
 * simply keep contributing until the run ends (a small overestimate beats a
 * countdown that jumps upward).
 */
export class EtaTracker {
  private readonly pending: Set<TimedStep>;
  private current?: { step: TimedStep; startedAt: number };

  constructor(expectedSteps: TimedStep[]) {
    this.pending = new Set(expectedSteps);
  }

  start(step: TimedStep): void {
    this.pending.add(step);
    this.current = { step, startedAt: Date.now() };
  }

  complete(step: TimedStep, durationMs?: number): void {
    this.pending.delete(step);
    if (this.current?.step === step) this.current = undefined;
    if (durationMs !== undefined) recordStepDuration(step, durationMs);
  }

  remainingMs(): number {
    let total = 0;
    for (const step of this.pending) {
      if (this.current?.step === step) {
        const elapsed = Date.now() - this.current.startedAt;
        total += Math.max(0, estimateStepMs(step) - elapsed);
      } else {
        total += estimateStepMs(step);
      }
    }
    return total;
  }

  /**
   * Display copy for the countdown; once the estimate is exhausted but work is
   * still running, switch to honest copy instead of a frozen "~5s".
   */
  label(): string {
    const remaining = this.remainingMs();
    if (remaining <= 2_500) return "wrapping up…";
    return formatEtaMs(remaining);
  }
}

/**
 * "~45s remaining" / "~2 min remaining". Rounded to 5s so the countdown never
 * pretends to a precision the estimate does not have.
 */
export function formatEtaMs(ms: number): string {
  const seconds = Math.max(5, Math.round(ms / 5_000) * 5);
  if (seconds >= 90) {
    const minutes = Math.round(seconds / 30) / 2;
    return `~${minutes} min remaining`;
  }
  return `~${seconds}s remaining`;
}

/** The steps a live `/sequences` create walks through (tier 1, pre-render). */
export const CREATE_STEPS: TimedStep[] = [
  "frame-design",
  "storyboard-plan",
  "source-author",
  "submit_composition",
  "render_preview",
];

/** The steps a revise walks through before its preview lands. */
export const REVISE_STEPS: TimedStep[] = ["apply_commands", "render_preview"];
