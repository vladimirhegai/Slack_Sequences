/**
 * `npm run sentinel:report` — the before/after instrument for the
 * correctness-by-construction system (SENTINEL.md telemetry contract).
 *
 * Aggregates every `planning/sentinel-run.json` (+ the sibling
 * `author-run.json`) under a directory into the mission metric table. Point it
 * at the projects root (default) or a specific run/probe directory:
 *
 *   npm run sentinel:report --workspace @sequences/slack
 *   npm run sentinel:report --workspace @sequences/slack -- <dir> [--json]
 *   npm run sentinel:report --workspace @sequences/slack -- <dir> --label baseline
 *
 * It reads persisted artifacts only — no Slack, no model calls, no cost.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SLACK_SEQUENCES_DATA_DIR ??= path.join(appDir, ".data");

interface StageTiming {
  stage: string;
  status: "succeeded" | "failed";
  durationMs: number;
  attempts?: number;
}

interface SentinelRun {
  disposition: "published" | "published-degraded" | "fallback" | "fail-loud";
  startedAt?: string;
  durationMs?: number;
  skeletonEnabled?: boolean | null;
  slotsEnabled?: boolean | null;
  wallClock?: { tier1Ms?: number | null; tier2Ms?: number | null };
  stages?: StageTiming[];
  modelCalls?: {
    total?: number;
    successfulLogicalTotal?: number;
    physicalRequestTotal?: number;
    byStage?: Record<string, number>;
    failed?: Record<string, number>;
    failedTotal?: number;
    hedged?: Record<string, number>;
    hedgedTotal?: number;
  };
  slotCalls?: Record<string, { calls?: number; scenes?: number }>;
  scaffoldCoverage?: { planned?: number; present?: number } | null;
  scaffoldRestorationEvents?: Record<string, number>;
  promptChars?: { maxAuthor?: number; totalPrompt?: number; totalCompletion?: number };
  layers?: Record<string, number>;
  normalizations?: Record<string, number>;
  degradations?: string[];
  __projectDir?: string;
}

interface AuthorRun {
  attempts?: { number: number; outcome: string }[];
  outcome?: string;
}

function findSentinelRuns(root: string): SentinelRun[] {
  const runs: SentinelRun[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        visit(full, depth + 1);
      } else if (entry.isFile() && entry.name === "sentinel-run.json") {
        try {
          const run = JSON.parse(fs.readFileSync(full, "utf8")) as SentinelRun;
          run.__projectDir = path.dirname(path.dirname(full));
          runs.push(run);
        } catch {
          // Skip unreadable/partial artifacts.
        }
      }
    }
  };
  // Direct hit: the given dir IS a project dir with planning/sentinel-run.json.
  const direct = path.join(root, "planning", "sentinel-run.json");
  if (fs.existsSync(direct)) {
    try {
      const run = JSON.parse(fs.readFileSync(direct, "utf8")) as SentinelRun;
      run.__projectDir = root;
      return [run];
    } catch {
      // fall through to recursive scan
    }
  }
  visit(root, 0);
  return runs;
}

function stageAttempts(run: SentinelRun, stage: string): number | undefined {
  const timing = run.stages?.find((entry) => entry.stage === stage);
  if (!timing) return undefined;
  // A succeeded stage that never bumped its retry counter ran exactly once.
  return timing.attempts && timing.attempts > 0 ? timing.attempts : 1;
}

function sourceAttempts(run: SentinelRun): number | undefined {
  const fromStage = stageAttempts(run, "source-author");
  if (fromStage !== undefined) return fromStage;
  if (!run.__projectDir) return undefined;
  try {
    const authorRun = JSON.parse(
      fs.readFileSync(path.join(run.__projectDir, "planning", "author-run.json"), "utf8"),
    ) as AuthorRun;
    return authorRun.attempts?.length || undefined;
  } catch {
    return undefined;
  }
}

function avg(values: number[]): number | undefined {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return undefined;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function successfulLogicalCalls(run: SentinelRun): number {
  return run.modelCalls?.successfulLogicalTotal ?? run.modelCalls?.total ?? 0;
}

function physicalRequests(run: SentinelRun): number {
  return run.modelCalls?.physicalRequestTotal ??
    successfulLogicalCalls(run) +
      (run.modelCalls?.failedTotal ?? 0) +
      (run.modelCalls?.hedgedTotal ?? 0);
}

function fmt(value: number | undefined, digits = 2): string {
  if (value === undefined) return "—";
  return value.toFixed(digits);
}

function fmtMs(value: number | undefined): string {
  if (value === undefined) return "—";
  const seconds = value / 1000;
  if (seconds >= 90) return `${(seconds / 60).toFixed(1)} min`;
  return `${seconds.toFixed(1)}s`;
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const labelIndex = args.indexOf("--label");
  const label = labelIndex >= 0 ? args[labelIndex + 1] : undefined;
  const positional = args.filter(
    (arg, index) =>
      !arg.startsWith("--") && !(index > 0 && args[index - 1] === "--label"),
  );
  const root = positional[0]
    ? path.resolve(process.cwd(), positional[0])
    : path.join(process.env.SLACK_SEQUENCES_DATA_DIR!, "projects");

  const runs = findSentinelRuns(root);
  if (!runs.length) {
    process.stderr.write(
      `No sentinel-run.json found under ${root}. Run a create (npm run sequence:check) first.\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Attempt averages deliberately include fail-loud runs: those are the runs
  // that spent the MOST attempts, and excluding them (the old behavior) biased
  // the aggregate away from exactly the failures the mission table exists to
  // measure. Runs with no recorded stage data still drop out naturally.
  const cleanRuns = runs.filter((run) => run.disposition === "published");
  const publishedRuns = runs.filter(
    (run) => run.disposition === "published" || run.disposition === "published-degraded",
  );

  const metrics = {
    runs: runs.length,
    hardFailures: runs.filter((run) => run.disposition === "fail-loud").length,
    fallbacks: runs.filter((run) => run.disposition === "fallback").length,
    published: cleanRuns.length,
    publishedDegraded: runs.filter((run) => run.disposition === "published-degraded").length,
    storyboardAttemptsAvg: avg(
      runs.map((run) => stageAttempts(run, "storyboard-plan")).filter((v): v is number => v !== undefined),
    ),
    sourceAttemptsAvg: avg(
      runs.map((run) => sourceAttempts(run)).filter((v): v is number => v !== undefined),
    ),
    failedModelCallsTotal: runs.reduce(
      (sum, run) => sum + (run.modelCalls?.failedTotal ?? 0),
      0,
    ),
    hedgedModelCallsTotal: runs.reduce(
      (sum, run) => sum + (run.modelCalls?.hedgedTotal ?? 0),
      0,
    ),
    degradationsTotal: runs.reduce((sum, run) => sum + (run.degradations?.length ?? 0), 0),
    tier1MsAvg: avg(
      runs.map((run) => run.wallClock?.tier1Ms).filter((v): v is number => typeof v === "number"),
    ),
    tier2MsAvg: avg(
      runs.map((run) => run.wallClock?.tier2Ms).filter((v): v is number => typeof v === "number"),
    ),
    authorPromptCharsMax: Math.max(
      0,
      ...runs.map((run) => run.promptChars?.maxAuthor ?? 0),
    ),
    authorPromptCharsAvg: avg(
      runs.map((run) => run.promptChars?.maxAuthor ?? 0).filter((v) => v > 0),
    ),
    logicalCallsPerCleanRunAvg: avg(
      cleanRuns.map(successfulLogicalCalls).filter((v) => v > 0),
    ),
    physicalRequestsPerCleanRunAvg: avg(
      cleanRuns.map(physicalRequests).filter((v) => v > 0),
    ),
    physicalRequestsPerPublishedRunAvg: avg(
      publishedRuns.map(physicalRequests).filter((v) => v > 0),
    ),
    physicalRequestsPerRunAvg: avg(
      runs.map(physicalRequests).filter((v) => v > 0),
    ),
    physicalRequestsTotal: runs.reduce((sum, run) => sum + physicalRequests(run), 0),
    slotSubcallsTotal: runs.reduce(
      (sum, run) =>
        sum +
        Object.values(run.slotCalls ?? {}).reduce((slotSum, entry) => slotSum + (entry.calls ?? 0), 0),
      0,
    ),
  };

  const layerTotals: Record<string, number> = {};
  const normTotals: Record<string, number> = {};
  for (const run of runs) {
    for (const [layer, count] of Object.entries(run.layers ?? {})) {
      layerTotals[layer] = (layerTotals[layer] ?? 0) + count;
    }
    for (const [tag, count] of Object.entries(run.normalizations ?? {})) {
      normTotals[tag] = (normTotals[tag] ?? 0) + count;
    }
  }

  if (jsonOut) {
    process.stdout.write(
      JSON.stringify({ label, root, metrics, layerTotals, normTotals, runs }, null, 2) + "\n",
    );
    return;
  }

  const lines: string[] = [];
  lines.push(`# Sentinel report${label ? ` — ${label}` : ""}`);
  lines.push("");
  lines.push(`Source: \`${root}\` · ${runs.length} run(s)`);
  lines.push("");
  lines.push("| Metric | Target | Observed |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Hard authoring failures (fail-loud) | 0 | ${metrics.hardFailures} |`);
  lines.push(`| Visible fallbacks | 0 | ${metrics.fallbacks} |`);
  lines.push(`| Storyboard attempts / run (avg) | ≤ 1.5 | ${fmt(metrics.storyboardAttemptsAvg)} |`);
  lines.push(`| Source-author attempts / run (avg) | ≤ 1.5 | ${fmt(metrics.sourceAttemptsAvg)} |`);
  lines.push(`| Wall-clock to tier-1 (avg) | ≤ 8 min | ${fmtMs(metrics.tier1MsAvg)} |`);
  lines.push(`| Wall-clock to tier-2 (avg) | ≤ 14 min | ${fmtMs(metrics.tier2MsAvg)} |`);
  lines.push(`| Author prompt size (max chars) | ≤ 45,000 | ${metrics.authorPromptCharsMax.toLocaleString("en-US")} |`);
  lines.push(`| Physical model requests / clean run (avg) | ≤ 5 | ${fmt(metrics.physicalRequestsPerCleanRunAvg, 1)} |`);
  lines.push(`| Physical model requests / any published run (avg) | — | ${fmt(metrics.physicalRequestsPerPublishedRunAvg, 1)} |`);
  lines.push("");
  lines.push("## Dispositions");
  lines.push("");
  lines.push(
    `published ${metrics.published} · published-degraded ${metrics.publishedDegraded} · ` +
      `fallback ${metrics.fallbacks} · fail-loud ${metrics.hardFailures}`,
  );
  lines.push("");
  lines.push("## Cost honesty");
  lines.push("");
  lines.push(
    `failed model calls ${metrics.failedModelCallsTotal} · hedge duplicates ` +
      `${metrics.hedgedModelCallsTotal} · physical request launches ${metrics.physicalRequestsTotal} · ` +
      `slot subcalls ${metrics.slotSubcallsTotal} · shipped degradations ${metrics.degradationsTotal}`,
  );
  lines.push("");
  lines.push("## Findings by layer (L0→L5)");
  lines.push("");
  for (const layer of ["schema", "scaffold", "normalize", "static", "browser", "model-retry"]) {
    lines.push(`- ${layer}: ${layerTotals[layer] ?? 0}`);
  }
  if (Object.keys(normTotals).length) {
    lines.push("");
    lines.push("## Deterministic normalizations (L2 tags)");
    lines.push("");
    for (const [tag, count] of Object.entries(normTotals).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${tag}: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Per-run detail");
  lines.push("");
  lines.push("| Run | Disposition | Skel | Slots | SB att | Src att | Logical / physical requests | Slot subcalls | L1 present / planned | Author chars | Tier1 | Tier2 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const run of runs) {
    const id = run.__projectDir ? path.basename(run.__projectDir) : "?";
    const slotSubcalls = Object.values(run.slotCalls ?? {})
      .reduce((sum, entry) => sum + (entry.calls ?? 0), 0);
    const scaffold = run.scaffoldCoverage
      ? `${run.scaffoldCoverage.present ?? "—"} / ${run.scaffoldCoverage.planned ?? "—"}`
      : "—";
    lines.push(
      `| ${id} | ${run.disposition} | ${flag(run.skeletonEnabled)} | ${flag(run.slotsEnabled)} | ` +
        `${stageAttempts(run, "storyboard-plan") ?? "—"} | ${sourceAttempts(run) ?? "—"} | ` +
        `${successfulLogicalCalls(run)} / ${physicalRequests(run)} | ${slotSubcalls || "—"} | ${scaffold} | ` +
        `${(run.promptChars?.maxAuthor ?? 0).toLocaleString("en-US")} | ` +
        `${fmtMs(run.wallClock?.tier1Ms ?? undefined)} | ${fmtMs(run.wallClock?.tier2Ms ?? undefined)} |`,
    );
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function flag(value: boolean | null | undefined): string {
  if (value === true) return "on";
  if (value === false) return "off";
  return "—";
}

main();
