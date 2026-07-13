/** Compact, Luna-native triage for exact worker run evidence. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditLunaRunHistory,
  resolveLunaRunDirectories,
  type LunaRunAudit,
} from "./lib/lunaEvidence.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function nearbyFailure(source: string): string | null {
  const direct = path.resolve(source);
  const candidates = [
    path.join(direct, "FAILURE.md"),
    path.join(direct, "planning", "FAILURE.md"),
    path.join(appDir, ".data", "projects", source, "FAILURE.md"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  return found ? fs.readFileSync(found, "utf8").slice(0, 4_000) : null;
}

export interface LunaTriageReport {
  schemaVersion: 1;
  route: "luna-direct";
  legacyStagesRead: 0;
  jobId: string;
  threadId: string;
  runs: LunaRunAudit[];
  findings: string[];
  failure: string | null;
}

export function renderLunaTriageMarkdown(report: LunaTriageReport): string {
  const lines = [
    `# Luna triage: ${report.jobId}`,
    "",
    `- Exact Codex thread: \`${report.threadId}\``,
    `- Worker turns: **${report.runs.length}**`,
    `- Model: \`${report.runs.at(-1)?.model}\` / \`${report.runs.at(-1)?.reasoningEffort}\``,
    "- Artifact integrity: **verified**",
    "",
    "| Turn | Kind | Input | Output | Changed files | Composition |",
    "| ---: | --- | ---: | ---: | ---: | --- |",
    ...report.runs.map((run) =>
      `| ${run.runCount} | ${run.artifactKind} (${run.kind}) | ${run.usage.inputTokens ?? "?"} | ` +
      `${run.usage.outputTokens ?? "?"} | ${run.changedPaths.length} | ` +
      `${run.compositionChanged === null ? "initial" : run.compositionChanged ? "changed" : "unchanged"} |`
    ),
    "",
    "## Findings",
    "",
    ...(report.findings.length ? report.findings.map((finding) => `- ${finding}`) : ["- No evidence-integrity finding."]),
  ];
  if (report.failure) lines.push("", "## Persisted host failure", "", "```text", report.failure, "```");
  lines.push(
    "",
    "## Next proof",
    "",
    "Run `npm run luna:replay --workspace @sequences/slack -- <same-path>` to execute the current host gate without a model call.",
    "",
  );
  return lines.join("\n");
}

export function buildLunaTriageReport(source: string): LunaTriageReport {
  const bundles = auditLunaRunHistory(resolveLunaRunDirectories(source, appDir));
  const runs = bundles.map((bundle) => bundle.audit);
  const findings: string[] = [];
  for (const run of runs.slice(1)) {
    if (run.kind.includes("repair") && run.compositionChanged === false) {
      findings.push(
        `Repair turn ${run.runCount} did not change composition.html; any authored HTML/runtime defect ` +
        "would remain byte-identical. Replay the current host gate to distinguish gate drift from source failure.",
      );
    }
    if (run.changedPaths.length === 0) {
      findings.push(`Turn ${run.runCount} materialized the same complete bundle as the previous turn.`);
    }
  }
  const latest = runs.at(-1)!;
  if (!runs.some((run) => run.artifactKind === "film")) {
    findings.push("This evidence history has no film bundle; browser film replay is not applicable yet.");
  }
  if (latest.status !== "completed") findings.push(`Latest worker status is ${latest.status}, not completed.`);
  if (latest.model !== "gpt-5.6-luna" || latest.reasoningEffort !== "high") {
    findings.push(`Latest turn used ${latest.model}/${latest.reasoningEffort}, not the pinned Luna/high route.`);
  }
  return {
    schemaVersion: 1,
    route: "luna-direct" as const,
    legacyStagesRead: 0 as const,
    jobId: latest.jobId,
    threadId: latest.threadId,
    runs,
    findings,
    failure: nearbyFailure(source),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const source = args.find((arg) => !arg.startsWith("-"));
    const json = args.includes("--json");
    if (!source || args.some((arg) => arg !== source && arg !== "--json")) {
      throw new Error("usage: npm run luna:triage -- <job-id|project-dir|runs-dir|downloaded-reports-dir> [--json]");
    }
    const report = buildLunaTriageReport(source);
    process.stdout.write(json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderLunaTriageMarkdown(report));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
