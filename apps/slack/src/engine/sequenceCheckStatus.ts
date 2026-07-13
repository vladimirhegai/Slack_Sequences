export type SequenceCheckStatus = "pass" | "warn" | "fail";

import type { LedgerStatus } from "./runner/attemptLedger.ts";

export interface SequenceCheckStatusInput {
  direct?: { validation?: { ok?: boolean; motionWarnings?: string[] } };
  result: {
    authoringMode: string;
    thumbnailPaths: Array<{ exists: boolean; bytes: number }>;
    fallback?: unknown;
    stages?: Array<{ attempts?: number }>;
    sentinelDisposition?: string | null;
    sentinelDegradations?: string[];
    ledgerStatus?: LedgerStatus;
  };
  ledger?: LedgerStatus;
  checks?: { qaWarningCount?: number | null };
  artifacts: { mp4?: { exists: boolean; bytes: number } | null };
  options: { render: boolean };
}

/** Honest CLI/probe summary; this does not change any production gate. */
export function summarizeSequenceCheckStatus(
  report: SequenceCheckStatusInput,
): SequenceCheckStatus {
  if (report.direct?.validation?.ok === false) return "fail";
  if (report.result.thumbnailPaths.some((thumb) => !thumb.exists || thumb.bytes <= 0)) return "fail";
  if (report.options.render && (!report.artifacts.mp4?.exists || report.artifacts.mp4.bytes <= 0)) {
    return "fail";
  }
  if (report.result.authoringMode === "deterministic-fallback") return "warn";
  if (report.result.fallback) return "warn";
  const ledger = report.ledger ?? report.result.ledgerStatus;
  if (ledger) {
    // Runtime-invalid authored output is already caught as a hard validation
    // failure above when the defect is provable. A false axis here means the
    // browser proof was unavailable, so keep the artifact but report honestly.
    if (!ledger.runtimeValid) return "warn";
    if (ledger.qualityResidue > 0) return "warn";
    if (ledger.disposition !== "published") return "warn";
    if (!ledger.oneAttemptSuccess) return "warn";
  }
  if (report.result.sentinelDisposition && report.result.sentinelDisposition !== "published") {
    return "warn";
  }
  if ((report.result.sentinelDegradations?.length ?? 0) > 0) return "warn";
  if (report.result.stages?.some((stage) => (stage.attempts ?? 1) > 1)) return "warn";
  if ((report.direct?.validation?.motionWarnings?.length ?? 0) > 0) return "warn";
  if ((report.checks?.qaWarningCount ?? 0) > 0) return "warn";
  return "pass";
}
