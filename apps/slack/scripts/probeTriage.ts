/** Read one persisted probe and produce the operator's compact triage report. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SENTINEL_CONTRACT } from "../src/engine/sentinel.ts";
import {
  AttemptLedger,
  deriveLedgerStatus,
  type AttemptLedgerEvent,
  type LedgerStatus,
} from "../src/engine/runner/attemptLedger.ts";

type JsonObject = Record<string, unknown>;

type StageName = "frame-design" | "storyboard-plan" | "source-author" | "other";

interface StageCalls {
  stage: StageName;
  logical: number;
  physical: number;
}

interface DegradationRecord {
  kind: "degradation" | "fallback";
  stage: StageName;
  reason: string;
}

interface QaFinding {
  code: string;
  count: number;
  status: "known" | "new";
  registryOwner: string | null;
  sources: string[];
}

interface EvidencePath {
  kind: "mp4" | "temporal-strip" | "blocking-overlay" | "moment-thumb" | "rejected-artifact" | "report";
  path: string;
  exists: boolean;
}

interface TriageReport {
  schemaVersion: 1;
  jobId: string;
  projectDir: string;
  disposition: string;
  status: string;
  runtimeValid: boolean | null;
  qualityResidue: number | null;
  degradedAxes: string[];
  oneAttemptSuccess: boolean | null;
  calls: {
    logicalTotal: number;
    physicalTotal: number;
    failedTotal: number;
    hedgedTotal: number;
    byStage: StageCalls[];
  };
  degradations: DegradationRecord[];
  qa: {
    recordedWarningCount: number | null;
    findings: QaFinding[];
  };
  evidence: EvidencePath[];
  warnings: string[];
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsDir = path.join(appDir, ".data", "projects");
const sourceArg = process.argv[2];

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readJson(file: string, warnings: string[]): JsonObject {
  if (!fs.existsSync(file)) {
    warnings.push(`missing ${file}`);
    return {};
  }
  try {
    return asObject(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    warnings.push(`unparseable ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function resolveProject(value: string): { jobId: string; projectDir: string } {
  const candidate = path.resolve(value);
  if (fs.existsSync(path.join(candidate, "planning", "sentinel-run.json"))) {
    return { jobId: path.basename(candidate), projectDir: candidate };
  }
  const projectDir = path.join(projectsDir, value);
  if (fs.existsSync(path.join(projectDir, "planning", "sentinel-run.json"))) {
    return { jobId: value, projectDir: path.resolve(projectDir) };
  }
  throw new Error(`probe project not found: ${value}\nlooked in ${projectsDir}`);
}

function stageForCallKey(key: string): StageName {
  const normalized = key.toLowerCase();
  if (normalized === "shape" || normalized === "concept" || normalized.includes("frame")) {
    return "frame-design";
  }
  if (normalized.includes("storyboard") || normalized.includes("plan")) {
    return "storyboard-plan";
  }
  if (
    normalized.includes("author") ||
    normalized.includes("critic") ||
    normalized.includes("patch") ||
    normalized.includes("source")
  ) {
    return "source-author";
  }
  return "other";
}

function stageForReason(reason: string): StageName {
  const normalized = reason.toLowerCase();
  if (normalized.startsWith("storyboard-") || normalized.startsWith("storyboard/")) {
    return "storyboard-plan";
  }
  if (
    normalized.includes("least-bad") ||
    normalized.includes("stagnant") ||
    normalized.includes("rows-") ||
    normalized.includes("foreground") ||
    normalized.startsWith("cut-") ||
    normalized.includes("browser")
  ) {
    return "source-author";
  }
  return "other";
}

function findingCode(signature: string): string {
  const text = signature.trim();
  const withoutOther = text.startsWith("other:") ? text.slice("other:".length) : text;
  const match = withoutOther.match(/^([a-z][a-z0-9_/-]*)/i);
  return match?.[1] ?? withoutOther.slice(0, 80);
}

function registryOwner(signature: string): string | null {
  const code = findingCode(signature);
  const row = SENTINEL_CONTRACT.find((candidate) =>
    candidate.findingPrefixes.some((prefix) =>
      signature.startsWith(prefix) || code.startsWith(prefix),
    ),
  );
  return row?.id ?? null;
}

function addFinding(
  findings: Map<string, QaFinding>,
  signature: string,
  source: string,
): void {
  const code = findingCode(signature);
  if (!code) return;
  const existing = findings.get(code);
  if (existing) {
    existing.count += 1;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return;
  }
  const owner = registryOwner(signature);
  findings.set(code, {
    code,
    count: 1,
    status: owner ? "known" : "new",
    registryOwner: owner,
    sources: [source],
  });
}

function absolutePath(value: unknown, projectDir: string): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectDir, raw);
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(file));
    else files.push(file);
  }
  return files;
}

function addEvidence(
  evidence: EvidencePath[],
  kind: EvidencePath["kind"],
  value: unknown,
  projectDir: string,
): void {
  const resolved = absolutePath(value, projectDir);
  if (!resolved || evidence.some((entry) => entry.path === resolved)) return;
  evidence.push({ kind, path: resolved, exists: fs.existsSync(resolved) });
}

function collectEvidence(
  projectDir: string,
  sequence: JsonObject,
  warnings: string[],
): EvidencePath[] {
  const evidence: EvidencePath[] = [];
  const artifacts = asObject(sequence.artifacts);
  const mp4 = asObject(artifacts.mp4);
  addEvidence(evidence, "mp4", mp4.path, projectDir);
  const temporal = asObject(artifacts.temporal);
  addEvidence(evidence, "temporal-strip", temporal.stripPath, projectDir);
  addEvidence(evidence, "report", path.join(projectDir, "build", "qa", "sequence-check.json"), projectDir);
  addEvidence(evidence, "report", path.join(projectDir, "planning", "sentinel-run.json"), projectDir);
  addEvidence(evidence, "report", path.join(projectDir, "planning", "author-run.json"), projectDir);

  const thumbnails = asArray(artifacts.thumbnails);
  for (const item of thumbnails) addEvidence(evidence, "moment-thumb", asObject(item).path, projectDir);
  for (const file of walkFiles(path.join(projectDir, "build", "thumbs"))) {
    addEvidence(evidence, "moment-thumb", file, projectDir);
  }
  for (const file of walkFiles(path.join(projectDir, "build", "qa", "temporal"))) {
    if (path.basename(file).toLowerCase().includes("strip")) addEvidence(evidence, "temporal-strip", file, projectDir);
    if (path.basename(file).toLowerCase().includes("blocking")) addEvidence(evidence, "blocking-overlay", file, projectDir);
  }
  for (const file of walkFiles(path.join(projectDir, "build", "qa", "critic"))) {
    if (path.basename(file).toLowerCase().includes("blocking")) addEvidence(evidence, "blocking-overlay", file, projectDir);
    if (path.basename(file).toLowerCase().includes("strip")) addEvidence(evidence, "temporal-strip", file, projectDir);
  }
  for (const file of walkFiles(path.join(projectDir, "planning", "attempts"))) {
    addEvidence(evidence, "rejected-artifact", file, projectDir);
  }
  if (!evidence.some((entry) => entry.kind === "mp4" && entry.exists)) {
    for (const file of walkFiles(path.join(projectDir, "renders"))) {
      if (path.extname(file).toLowerCase() === ".mp4") addEvidence(evidence, "mp4", file, projectDir);
    }
  }
  if (evidence.some((entry) => !entry.exists)) {
    warnings.push("one or more referenced evidence paths are missing; open the existing paths first");
  }
  return evidence;
}

function stageCallsFromLedger(events: readonly AttemptLedgerEvent[]): TriageReport["calls"] {
  const logicalByStage = new Map<StageName, number>();
  const physicalByStage = new Map<StageName, number>();
  const add = (target: Map<StageName, number>, stage: StageName): void => {
    target.set(stage, (target.get(stage) ?? 0) + 1);
  };
  for (const event of events) {
    if (event.kind === "model-call") {
      add(logicalByStage, stageForCallKey(event.stage));
      add(physicalByStage, stageForCallKey(event.stage));
    } else if (event.kind === "model-call-failure" || event.kind === "hedge-launch") {
      add(physicalByStage, stageForCallKey(event.stage));
    }
  }
  const byStage = (["frame-design", "storyboard-plan", "source-author", "other"] as StageName[])
    .map((stage) => ({ stage, logical: logicalByStage.get(stage) ?? 0, physical: physicalByStage.get(stage) ?? 0 }))
    .filter((stage) => stage.logical > 0 || stage.physical > 0);
  return {
    logicalTotal: [...logicalByStage.values()].reduce((sum, count) => sum + count, 0),
    physicalTotal: [...physicalByStage.values()].reduce((sum, count) => sum + count, 0),
    failedTotal: events.filter((event) => event.kind === "model-call-failure").length,
    hedgedTotal: events.filter((event) => event.kind === "hedge-launch").length,
    byStage,
  };
}

function stageCalls(sentinel: JsonObject, ledgerEvents?: readonly AttemptLedgerEvent[]): {
  logicalTotal: number;
  physicalTotal: number;
  failedTotal: number;
  hedgedTotal: number;
  byStage: StageCalls[];
} {
  if (ledgerEvents?.length) return stageCallsFromLedger(ledgerEvents);
  const modelCalls = asObject(sentinel.modelCalls);
  const logicalByStage = new Map<StageName, number>();
  const physicalByStage = new Map<StageName, number>();
  const add = (target: Map<StageName, number>, stage: StageName, amount: number): void => {
    target.set(stage, (target.get(stage) ?? 0) + amount);
  };
  for (const [key, value] of Object.entries(asObject(modelCalls.byStage))) {
    const amount = asNumber(value) ?? 0;
    const stage = stageForCallKey(key);
    add(logicalByStage, stage, amount);
    add(physicalByStage, stage, amount);
  }
  for (const [key, value] of Object.entries(asObject(modelCalls.failed))) {
    add(physicalByStage, stageForCallKey(key), asNumber(value) ?? 0);
  }
  for (const [key, value] of Object.entries(asObject(modelCalls.hedged))) {
    add(physicalByStage, stageForCallKey(key), asNumber(value) ?? 0);
  }
  const logicalTotal = asNumber(modelCalls.total) ?? [...logicalByStage.values()].reduce((a, b) => a + b, 0);
  const physicalTotal = asNumber(modelCalls.physicalRequestTotal) ?? [...physicalByStage.values()].reduce((a, b) => a + b, 0);
  const byStage: StageCalls[] = (["frame-design", "storyboard-plan", "source-author", "other"] as StageName[])
    .map((stage) => ({ stage, logical: logicalByStage.get(stage) ?? 0, physical: physicalByStage.get(stage) ?? 0 }))
    .filter((stage) => stage.logical > 0 || stage.physical > 0);
  const accountedPhysical = byStage.reduce((sum, stage) => sum + stage.physical, 0);
  if (accountedPhysical !== physicalTotal) {
    const other = byStage.find((stage) => stage.stage === "other");
    if (other) other.physical += physicalTotal - accountedPhysical;
    else byStage.push({ stage: "other", logical: 0, physical: physicalTotal - accountedPhysical });
  }
  return {
    logicalTotal,
    physicalTotal,
    failedTotal: asNumber(modelCalls.failedTotal) ?? 0,
    hedgedTotal: asNumber(modelCalls.hedgedTotal) ?? 0,
    byStage,
  };
}

function collectQa(sequence: JsonObject, author: JsonObject): TriageReport["qa"] {
  const findings = new Map<string, QaFinding>();
  const spatial = asObject(asObject(sequence.direct).spatialQa);
  for (const issue of asArray(spatial.issues)) {
    const item = asObject(issue);
    const code = asString(item.code);
    if (code) addFinding(findings, code, "browser QA spatial issues");
  }
  const attempts = asArray(author.attempts);
  const latestRejected = [...attempts].reverse().find((attempt) =>
    /browser-rejected/i.test(asString(asObject(attempt).outcome) ?? ""),
  );
  for (const signature of asArray(asObject(latestRejected).findingSignatures)) {
    if (typeof signature === "string" && signature.startsWith("browser_warning:")) {
      addFinding(findings, signature, "latest rejected source attempt");
    }
  }
  if (findings.size === 0) {
    for (const signature of asArray(author.terminalFindingSignatures)) {
      if (typeof signature === "string") addFinding(findings, signature, "terminal author findings");
    }
  }
  const checks = asObject(sequence.checks);
  return {
    recordedWarningCount: asNumber(checks.qaWarningCount) ?? null,
    findings: [...findings.values()].sort((a, b) => a.code.localeCompare(b.code)),
  };
}

function collectTriage(jobId: string, projectDir: string): TriageReport {
  const warnings: string[] = [];
  const sentinel = readJson(path.join(projectDir, "planning", "sentinel-run.json"), warnings);
  const author = readJson(path.join(projectDir, "planning", "author-run.json"), warnings);
  const sequence = readJson(path.join(projectDir, "build", "qa", "sequence-check.json"), warnings);
  const ledgerPayload = readJson(path.join(projectDir, "planning", "attempt-ledger.json"), warnings);
  const ledgerEvents = Array.isArray(ledgerPayload.events)
    ? AttemptLedger.replay(ledgerPayload.events as Parameters<typeof AttemptLedger.replay>[0]).events
    : [];
  const result = asObject(sequence.result);
  const checks = asObject(sequence.checks);
  const legacyStatus: Partial<Pick<LedgerStatus, "runtimeValid" | "qualityResidue">> = {
    runtimeValid: typeof checks.browserValidated === "boolean" ? checks.browserValidated : undefined,
    qualityResidue: asNumber(checks.qaWarningCount) ?? undefined,
  };
  const ledgerStatus = ledgerEvents.length
    ? deriveLedgerStatus(ledgerEvents, legacyStatus)
    : undefined;
  const degradationReasons = new Set<string>();
  for (const reason of asArray(sentinel.degradations)) if (typeof reason === "string") degradationReasons.add(reason);
  for (const reason of asArray(result.sentinelDegradations)) if (typeof reason === "string") degradationReasons.add(reason);
  const degradations: DegradationRecord[] = [...degradationReasons].map((reason) => ({
    kind: "degradation",
    stage: stageForReason(reason),
    reason,
  }));
  const fallback = asObject(result.fallback);
  const fallbackReason = asString(fallback.reason);
  if (fallbackReason) {
    degradations.push({
      kind: "fallback",
      stage: (asString(fallback.stage) as StageName | undefined) ?? stageForReason(fallbackReason),
      reason: fallbackReason,
    });
  }
  const sequenceStatus = asString(sequence.status) ?? "unknown";
  const status = ledgerStatus
    ? sequenceStatus === "fail"
      ? "fail"
      : ledgerStatus.runtimeValid &&
          ledgerStatus.qualityResidue === 0 &&
          ledgerStatus.disposition === "published" &&
          ledgerStatus.oneAttemptSuccess
        ? "pass"
        : "warn"
    : sequenceStatus;
  const evidence = collectEvidence(projectDir, sequence, warnings);
  return {
    schemaVersion: 1,
    jobId,
    projectDir,
    disposition: asString(sentinel.disposition) ?? asString(result.sentinelDisposition) ?? "unknown",
    status,
    runtimeValid: ledgerStatus?.runtimeValid ?? (typeof checks.browserValidated === "boolean" ? checks.browserValidated : null),
    qualityResidue: ledgerStatus?.qualityResidue ?? (asNumber(checks.qaWarningCount) ?? null),
    degradedAxes: ledgerStatus?.degradedAxes ?? [],
    oneAttemptSuccess: ledgerStatus?.oneAttemptSuccess ?? null,
    calls: stageCalls(sentinel, ledgerEvents),
    degradations,
    qa: collectQa(sequence, author),
    evidence,
    warnings,
  };
}

function markdown(report: TriageReport): string {
  const lines = [
    `# Probe triage: ${report.jobId}`,
    "",
    `- Project: \`${report.projectDir}\``,
    `- Disposition: **${report.disposition}**`,
    `- Sequence-check status: **${report.status}**`,
    `- Ledger axes: **runtimeValid=${String(report.runtimeValid)}**, **qualityResidue=${String(report.qualityResidue)}**`,
    `- Degraded axes: ${report.degradedAxes.length ? report.degradedAxes.join(", ") : "none"}`,
    /*
      (report.degradedAxes.length ? ` · degraded: `${report.degradedAxes.join(", ")}`` : ""),
    */
    `- One-attempt success: **${String(report.oneAttemptSuccess)}**`,
    "",
    "## Calls",
    "",
    "| Stage | Logical | Physical |",
    "| --- | ---: | ---: |",
    ...report.calls.byStage.map((stage) => `| ${stage.stage} | ${stage.logical} | ${stage.physical} |`),
    `| **Total** | **${report.calls.logicalTotal}** | **${report.calls.physicalTotal}** |`,
    `| Failed physical requests | ${report.calls.failedTotal} | |`,
    `| Hedged physical requests | ${report.calls.hedgedTotal} | |`,
    "",
    "## Degradations and fallbacks",
    "",
  ];
  if (report.degradations.length === 0) lines.push("- None recorded.");
  else for (const item of report.degradations) lines.push(`- **${item.kind}** · stage \`${item.stage}\` · ${item.reason}`);
  lines.push("", "## QA finding classes", "", "| Class | Count | Registry |", "| --- | ---: | --- |");
  if (report.qa.findings.length === 0) lines.push("| None recorded | 0 | — |");
  else for (const finding of report.qa.findings) {
    lines.push(`| \`${finding.code}\` | ${finding.count} | **${finding.status}**${finding.registryOwner ? ` · ${finding.registryOwner}` : ""} |`);
  }
  if (report.qa.recordedWarningCount !== null) lines.push("", `Recorded QA warning count: **${report.qa.recordedWarningCount}**.`);
  lines.push("", "## Evidence", "");
  for (const entry of report.evidence) lines.push(`- ${entry.kind}: \`${entry.path}\`${entry.exists ? "" : " *(missing)*"}`);
  if (report.warnings.length) {
    lines.push("", "## Triage warnings", "", ...report.warnings.map((warning) => `- ${warning}`));
  }
  lines.push(
    "",
    "## Sentinel next action",
    "",
    "Replay first, fix the lowest owner, add a regression, and log the result in `PROBE_LOG.md`.",
    "",
  );
  return lines.join("\n");
}

if (!sourceArg || sourceArg.startsWith("-")) {
  console.error("usage: npm run probe:triage -- <jobId-or-project-dir>");
  process.exitCode = 2;
} else {
  try {
    const project = resolveProject(sourceArg);
    const report = collectTriage(project.jobId, project.projectDir);
    const reportPath = path.join(project.projectDir, "planning", "triage.md");
    const jsonPath = path.join(project.projectDir, "planning", "triage.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, markdown(report), "utf8");
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    process.stdout.write(markdown(report));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
