/**
 * Fail-loud diagnostics for a create that could not author a real film.
 *
 * When the deterministic safe fallback is disabled
 * (`SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0`), the orchestrator surfaces
 * this consolidated report instead of a generic video: which stage broke, the
 * terminal reason, the per-attempt finding signatures the author/storyboard
 * loops already persisted, and the on-disk artifact paths that carry the raw
 * documents. The same report is written to `<projectDir>/FAILURE.md` (and logged
 * to stderr → Railway logs) even when the safe fallback IS shipped, so an
 * operator can always retrieve the full log for a fixing agent without turning
 * the safety net off.
 *
 * Best-effort and side-effect-light: every file read is guarded, so a missing or
 * malformed artifact degrades a section rather than throwing while we are already
 * on the failure path.
 */
import fs from "node:fs";
import path from "node:path";

export interface StageReceiptLike {
  stage: string;
  status: "succeeded" | "failed";
  durationMs: number;
  attempts?: number;
}

export interface AuthoringFailureInput {
  projectDir: string;
  /** The named model stage that broke (frame-design / storyboard-plan / source-author). */
  stage: string;
  /** The full terminal error message from the failed stage (untruncated). */
  reason: string;
  /** Argument-free per-stage receipts, if the orchestrator has them. */
  stages?: StageReceiptLike[];
}

/** Cap on the terminal reason so FAILURE.md stays readable; Slack truncates further. */
const MAX_REASON_CHARS = 4_000;

function safeRead(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

interface AuthorRunShape {
  outcome?: string;
  failureReason?: string;
  strategyChanges?: string[];
  terminalFindingSignatures?: string[];
  attempts?: Array<{
    number?: number;
    mode?: string;
    outcome?: string;
    findingSignatures?: string[];
  }>;
}

/**
 * Assemble the consolidated failure report. The most decision-critical lines
 * (failed stage, on-disk report path, why-it-failed) come FIRST so they survive
 * Slack's code-block truncation; exhaustive artifact enumeration trails after.
 */
export function buildAuthoringFailureReport(input: AuthoringFailureInput): string {
  const { projectDir, stage, reason, stages = [] } = input;
  const lines: string[] = [];

  lines.push("SEQUENCES BUILD FAILED — no video or storyboard was published (fail-loud mode).");
  lines.push(`Job ID: ${path.basename(projectDir)}`);
  lines.push(`Failed stage: ${stage}`);
  lines.push(`When: ${new Date().toISOString()}`);
  lines.push(`Full report on disk: ${path.join(projectDir, "FAILURE.md")}`);
  lines.push("");

  lines.push("── WHY IT FAILED ──");
  lines.push((reason.trim() || "(no terminal reason captured)").slice(0, MAX_REASON_CHARS));
  lines.push("");

  const authorRunRaw = safeRead(path.join(projectDir, "planning", "author-run.json"));
  if (authorRunRaw) {
    lines.push("── SOURCE-AUTHOR RUN (planning/author-run.json) ──");
    try {
      const run = JSON.parse(authorRunRaw) as AuthorRunShape;
      if (run.outcome) lines.push(`outcome: ${run.outcome}`);
      if (run.failureReason) lines.push(`failureReason: ${run.failureReason}`);
      for (const attempt of run.attempts ?? []) {
        const sigs = (attempt.findingSignatures ?? []).slice(0, 10).join(", ");
        lines.push(
          `  attempt ${attempt.number ?? "?"} [${attempt.mode ?? "?"}] → ` +
            `${attempt.outcome ?? "?"}${sigs ? `: ${sigs}` : ""}`,
        );
      }
      if (run.strategyChanges?.length) {
        lines.push(`strategy changes: ${run.strategyChanges.join(" | ")}`);
      }
      if (run.terminalFindingSignatures?.length) {
        lines.push(`terminal finding signatures: ${run.terminalFindingSignatures.join(", ")}`);
      }
    } catch {
      lines.push("(author-run.json present but unparseable — raw head follows)");
      lines.push(authorRunRaw.slice(0, 800));
    }
    lines.push("");
  }

  if (stages.length) {
    lines.push("── STAGE RECEIPTS ──");
    for (const receipt of stages) {
      const attempts =
        receipt.attempts && receipt.attempts > 0
          ? ` (${receipt.attempts} attempt${receipt.attempts === 1 ? "" : "s"})`
          : "";
      lines.push(`  ${receipt.stage}: ${receipt.status}${attempts} — ${receipt.durationMs}ms`);
    }
    lines.push("");
  }

  const attemptsDir = path.join(projectDir, "planning", "attempts");
  const attemptFiles = safeList(attemptsDir);
  if (attemptFiles.length) {
    lines.push("── PERSISTED ATTEMPTS (open for full documents + findings) ──");
    for (const file of attemptFiles) lines.push(`  ${path.join(attemptsDir, file)}`);
    lines.push("");
  }

  const lunaRunsDir = path.join(projectDir, "planning", "luna", "runs");
  const lunaRuns = safeList(lunaRunsDir);
  if (lunaRuns.length) {
    lines.push("── PERSISTED LUNA TURNS (exact bundles + worker receipts) ──");
    for (const run of lunaRuns) lines.push(`  ${path.join(lunaRunsDir, run)}`);
    lines.push("");
  }

  const extras = [
    path.join(projectDir, "build", "qa", "sequence-check.json"),
    path.join(projectDir, "build", "qa"),
    path.join(projectDir, "motion-plan.json"),
    path.join(projectDir, "STORYBOARD.md"),
  ].filter((candidate) => fs.existsSync(candidate));
  if (extras.length) {
    lines.push("── OTHER ARTIFACTS ──");
    for (const candidate of extras) lines.push(`  ${candidate}`);
    lines.push("");
  }

  lines.push("Paste this message (or the files above) into your fixing agent.");
  return lines.join("\n");
}

/**
 * Persist the report to `<projectDir>/FAILURE.md`. Returns the path on success so
 * the caller can point Slack/logs at it; swallows write errors (best-effort — we
 * are already reporting a failure).
 */
export function writeFailureReport(projectDir: string, report: string): string | undefined {
  try {
    const file = path.join(projectDir, "FAILURE.md");
    fs.writeFileSync(file, report, "utf8");
    return file;
  } catch {
    return undefined;
  }
}
