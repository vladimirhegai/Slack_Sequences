/**
 * Agent-friendly local simulator for a Slack `/sequences` create.
 *
 * It runs the same orchestrator path Slack uses after modal/thread fields are
 * collected: brief -> frame.md -> storyboard/source authoring -> validation /
 * checkpoint -> thumbnails -> optional MP4. It does not post to Slack and does
 * not require Slack tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS, type ProviderId } from "@sequences/platform/providers";
import {
  createVideo,
  type BriefFields,
  type OrchestratorProgress,
  type Tone,
} from "../src/orchestrator.ts";
import { DEMO_BRIEF, buildDemoPlan } from "../src/demo.ts";
import {
  hasDirectComposition,
  loadDirectComposition,
  validateDirectComposition,
  type DirectCompositionManifest,
  type DirectValidationResult,
} from "../src/engine/directComposition.ts";
import { reportTemporalEvidence } from "../src/engine/temporalInspector.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SLACK_SEQUENCES_DATA_DIR ??= path.join(appDir, ".data");

type OutputFormat = "json" | "markdown" | "both";
type CheckStatus = "pass" | "warn" | "fail";

interface FileEvidence {
  path: string;
  exists: boolean;
  bytes: number;
}

type DirectValidationSummary = Pick<
  DirectValidationResult,
  "ok" | "errors" | "warnings" | "frameErrors" | "frameWarnings" | "motionWarnings"
>;

interface DirectEvidence {
  manifest: DirectCompositionManifest;
  validation: DirectValidationSummary;
  motionDensity: unknown;
  spatialQa: unknown;
}

interface StatusReport {
  direct?: { validation?: { ok?: boolean; motionWarnings?: string[] } };
  result: {
    authoringMode: string;
    thumbnailPaths: FileEvidence[];
  };
  artifacts: {
    mp4?: FileEvidence | null;
  };
  options: {
    render: boolean;
  };
}

interface CliOptions extends BriefFields {
  brandName?: string;
  jobId: string;
  demo: boolean;
  render: boolean;
  temporal: boolean;
  preferMcp?: boolean;
  provider?: ProviderId;
  output?: string;
  format: OutputFormat;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run sequence:check --workspace @sequences/slack -- --demo",
    "  npm run sequence:check --workspace @sequences/slack -- --product RADAR --what \"Live operational view\" --audience \"PMs\" --length 15 --no-mcp",
    "",
    "Options:",
    "  --demo                    Use the deterministic /sequences demo plan; no model call.",
    "  --input <file.json>        Read product/whatShipped/audience/tone/lengthSec/context.",
    "  --product <text>           Product name.",
    "  --brand <text>             Brand name; defaults to product.",
    "  --what <text>              What shipped / launch brief.",
    "  --audience <text>          Target audience.",
    "  --tone <crisp-saas|warm-startup|bold-launch>",
    "  --length <seconds>         Target length.",
    "  --context <text>           Extra trusted context.",
    "  --context-file <path>      Append file contents to context.",
    "  --provider <id>            Provider override, e.g. openrouter-api.",
    "  --mcp / --no-mcp           Prefer internal Sequences MCP transport (default: app setting).",
    "  --render                   Also render draft MP4.",
    "  --temporal                 Capture temporal evidence after create (Chrome required).",
    "  --job-id <id>              Stable local job id; defaults to sequence-check-<timestamp>.",
    "  --out <path>               Report file or directory. Default: <project>/build/qa/sequence-check.json.",
    "  --format <json|markdown|both>",
  ].join("\n");
}

function readJson(file: string): Partial<BriefFields & { brandName?: string }> {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--input must point to a JSON object");
  }
  return parsed as Partial<BriefFields & { brandName?: string }>;
}

function parseArgs(argv: string[]): CliOptions {
  let values: Partial<CliOptions> = {
    demo: false,
    render: false,
    temporal: false,
    format: "json",
    jobId: `sequence-check-${Date.now()}`,
  };
  const extraContext: string[] = [];
  const take = (index: number, name: string): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--demo") {
      values.demo = true;
    } else if (arg === "--input") {
      values = { ...readJson(take(index, arg)), ...values };
      index += 1;
    } else if (arg === "--product") {
      values.product = take(index, arg);
      index += 1;
    } else if (arg === "--brand") {
      values.brandName = take(index, arg);
      index += 1;
    } else if (arg === "--what" || arg === "--what-shipped") {
      values.whatShipped = take(index, arg);
      index += 1;
    } else if (arg === "--audience") {
      values.audience = take(index, arg);
      index += 1;
    } else if (arg === "--tone") {
      values.tone = take(index, arg) as Tone;
      index += 1;
    } else if (arg === "--length") {
      values.lengthSec = Number(take(index, arg));
      index += 1;
    } else if (arg === "--context") {
      extraContext.push(take(index, arg));
      index += 1;
    } else if (arg === "--context-file") {
      extraContext.push(fs.readFileSync(path.resolve(take(index, arg)), "utf8"));
      index += 1;
    } else if (arg === "--provider") {
      values.provider = take(index, arg) as ProviderId;
      index += 1;
    } else if (arg === "--mcp") {
      values.preferMcp = true;
    } else if (arg === "--no-mcp") {
      values.preferMcp = false;
    } else if (arg === "--render") {
      values.render = true;
    } else if (arg === "--temporal") {
      values.temporal = true;
    } else if (arg === "--job-id") {
      values.jobId = take(index, arg);
      index += 1;
    } else if (arg === "--out") {
      values.output = take(index, arg);
      index += 1;
    } else if (arg === "--format") {
      values.format = take(index, arg) as OutputFormat;
      index += 1;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  if (values.demo) {
    values = {
      ...values,
      product: values.product ?? DEMO_BRIEF.product,
      brandName: values.brandName ?? DEMO_BRIEF.brandName,
      whatShipped: values.whatShipped ?? DEMO_BRIEF.whatShipped,
      audience: values.audience ?? DEMO_BRIEF.audience,
      tone: values.tone ?? DEMO_BRIEF.tone,
      lengthSec: values.lengthSec ?? DEMO_BRIEF.lengthSec,
    };
  }
  if (extraContext.length) {
    values.context = [values.context, ...extraContext].filter(Boolean).join("\n\n");
  }
  if (!values.product || !values.whatShipped) {
    throw new Error("provide --demo or at least --product and --what");
  }
  if (values.tone && !["crisp-saas", "warm-startup", "bold-launch"].includes(values.tone)) {
    throw new Error(`unsupported tone: ${values.tone}`);
  }
  if (values.format && !["json", "markdown", "both"].includes(values.format)) {
    throw new Error(`unsupported format: ${values.format}`);
  }
  if (values.provider && !PROVIDERS[values.provider]) {
    throw new Error(`unknown provider: ${values.provider}`);
  }
  return values as CliOptions;
}

function safeReadJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function fileStatus(file: string): FileEvidence {
  const exists = fs.existsSync(file);
  return {
    path: file,
    exists,
    bytes: exists ? fs.statSync(file).size : 0,
  };
}

function directAuthoringMode(projectDir: string): string {
  if (!hasDirectComposition(projectDir)) return "legacy-plan";
  const current = loadDirectComposition(projectDir);
  const fallbackIds = current.manifest.scenes.every((scene) => scene.id.startsWith("fallback-"));
  return fallbackIds || current.manifest.compositionId.endsWith("-fallback")
    ? "deterministic-fallback"
    : "hyperframes-direct";
}

function reportPaths(projectDir: string, requested: string | undefined, format: OutputFormat) {
  const defaultDir = path.join(projectDir, "build", "qa");
  const resolved = requested ? path.resolve(requested) : defaultDir;
  const looksLikeDir = !path.extname(resolved) ||
    (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory());
  const dir = looksLikeDir ? resolved : path.dirname(resolved);
  const base = looksLikeDir ? "sequence-check" : path.basename(resolved, path.extname(resolved));
  fs.mkdirSync(dir, { recursive: true });
  return {
    json: format === "markdown" ? undefined : path.join(dir, `${base}.json`),
    markdown: format === "json" ? undefined : path.join(dir, `${base}.md`),
  };
}

function markdownReport(report: Record<string, unknown>): string {
  const result = report.result as Record<string, unknown>;
  const direct = report.direct as Record<string, unknown> | undefined;
  const checks = report.checks as Record<string, unknown>;
  const artifacts = report.artifacts as Record<string, unknown>;
  const progress = report.progress as unknown[];
  return [
    `# Sequence Check - ${String(result.title ?? "Untitled")}`,
    "",
    `- Status: **${String(report.status)}**`,
    `- Provider: \`${String(result.provider)}\``,
    `- Authoring mode: \`${String(result.authoringMode)}\``,
    `- Project: \`${String(result.projectDir)}\``,
    `- Used MCP: \`${String(result.usedMcp)}\``,
    `- Lint: ${String(result.lint)}`,
    "",
    "## Scenes",
    String(result.outline ?? "(none)"),
    "",
    "## Checks",
    "```json",
    JSON.stringify(checks, null, 2),
    "```",
    "",
    "## Motion Density",
    "```json",
    JSON.stringify(direct?.motionDensity ?? null, null, 2),
    "```",
    "",
    "## Artifacts",
    "```json",
    JSON.stringify(artifacts, null, 2),
    "```",
    "",
    "## Progress",
    "```json",
    JSON.stringify(progress, null, 2),
    "```",
    "",
  ].join("\n");
}

function summarizeStatus(report: StatusReport): CheckStatus {
  if (report.direct?.validation?.ok === false) return "fail";
  if (report.result.thumbnailPaths.some((thumb) => !thumb.exists || thumb.bytes <= 0)) return "fail";
  if (report.options.render && (!report.artifacts.mp4?.exists || report.artifacts.mp4.bytes <= 0)) {
    return "warn";
  }
  if (report.result.authoringMode === "deterministic-fallback") return "warn";
  if ((report.direct?.validation?.motionWarnings?.length ?? 0) > 0) return "warn";
  return "pass";
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const progress: Array<OrchestratorProgress & { atMs: number }> = [];
  const started = performance.now();
  const result = await createVideo({
    jobId: options.jobId,
    product: options.product,
    brandName: options.brandName ?? options.product,
    whatShipped: options.whatShipped,
    audience: options.audience,
    tone: options.tone,
    lengthSec: options.lengthSec,
    context: options.context,
    provider: options.provider,
    render: options.render,
    preferMcp: options.preferMcp,
    presetPlan: options.demo ? buildDemoPlan : undefined,
    onProgress: (event) => {
      progress.push({ ...event, atMs: Math.round(performance.now() - started) });
    },
  });

  let direct: DirectEvidence | undefined;
  if (hasDirectComposition(result.projectDir)) {
    const current = loadDirectComposition(result.projectDir);
    const validation = await validateDirectComposition(result.projectDir, {
      html: current.html,
      storyboard: current.manifest.scenes,
    });
    const motionPlan = safeReadJson(path.join(result.projectDir, "composition", "motion-plan.json")) as
      | { motionDensity?: unknown }
      | undefined;
    direct = {
      manifest: current.manifest,
      validation: {
        ok: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
        frameErrors: validation.frameErrors,
        frameWarnings: validation.frameWarnings,
        motionWarnings: validation.motionWarnings,
      },
      motionDensity: motionPlan?.motionDensity ?? validation.motionReport,
      spatialQa: safeReadJson(path.join(result.projectDir, "composition", "qa", "spatial.json")),
    };
  }

  let temporal: { summary: string; stripPath: string; jsonPath: string } | undefined;
  if (options.temporal && hasDirectComposition(result.projectDir)) {
    const evidence = await reportTemporalEvidence(result.projectDir);
    temporal = {
      summary: evidence.summary,
      stripPath: evidence.stripPath,
      jsonPath: evidence.jsonPath,
    };
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "pass",
    options: {
      demo: options.demo,
      render: options.render,
      temporal: options.temporal,
      preferMcp: options.preferMcp ?? null,
      provider: options.provider ?? null,
    },
    environment: {
      providerEnv: process.env.SLACK_SEQUENCES_PROVIDER ?? null,
      storyboardModel: process.env.SLACK_SEQUENCES_STORYBOARD_MODEL ?? null,
      productionModel: process.env.SLACK_SEQUENCES_PRODUCTION_MODEL ?? null,
      repairModel: process.env.SLACK_SEQUENCES_REPAIR_MODEL ?? null,
      hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      dataDir: process.env.SLACK_SEQUENCES_DATA_DIR,
    },
    input: {
      product: options.product,
      brandName: options.brandName ?? options.product,
      whatShipped: options.whatShipped,
      audience: options.audience ?? null,
      tone: options.tone ?? null,
      lengthSec: options.lengthSec ?? null,
      contextChars: options.context?.length ?? 0,
      slackContextSimulated: false,
      slackContextNote:
        "This script simulates /sequences after Slack has collected fields. It does not call Slack hosted MCP or post to Slack.",
    },
    result: {
      elapsedMs: Math.round(performance.now() - started),
      title: options.product,
      projectDir: result.projectDir,
      provider: result.provider,
      usedMcp: result.usedMcp,
      mcpRequested: result.mcpRequested,
      usedPreset: result.usedPreset,
      authoringMode: directAuthoringMode(result.projectDir),
      outline: result.outline,
      lint: result.lint,
      skillsUsed: result.skillsUsed,
      toolCalls: result.toolCalls,
      frame: result.frame ?? null,
      thumbnailPaths: result.thumbnailPaths.map(fileStatus),
    },
    checks: {
      directValidationOk: (direct?.validation as { ok?: boolean } | undefined)?.ok ?? null,
      staticWarningCount: (direct?.validation as { warnings?: unknown[] } | undefined)?.warnings?.length ?? null,
      motionWarningCount:
        (direct?.validation as { motionWarnings?: unknown[] } | undefined)?.motionWarnings?.length ?? null,
      browserValidated: (direct?.manifest as { qa?: { browserValidated?: boolean } } | undefined)?.qa?.browserValidated ?? null,
      layoutSamples: (direct?.manifest as { qa?: { layoutSamples?: number } } | undefined)?.qa?.layoutSamples ?? null,
      qaWarningCount: (direct?.manifest as { qa?: { warningCount?: number } } | undefined)?.qa?.warningCount ?? null,
    },
    direct,
    artifacts: {
      reportDirectory: path.join(result.projectDir, "build", "qa"),
      thumbnails: result.thumbnailPaths.map(fileStatus),
      mp4: result.mp4Path ? fileStatus(result.mp4Path) : null,
      temporal: temporal ?? null,
    },
    progress,
  };
  report.status = summarizeStatus(report);

  const paths = reportPaths(result.projectDir, options.output, options.format);
  if (paths.json) {
    fs.writeFileSync(paths.json, JSON.stringify(report, null, 2) + "\n");
  }
  if (paths.markdown) {
    fs.writeFileSync(paths.markdown, markdownReport(report));
  }

  console.log(JSON.stringify({
    status: report.status,
    projectDir: result.projectDir,
    reportJson: paths.json ?? null,
    reportMarkdown: paths.markdown ?? null,
    provider: result.provider,
    authoringMode: report.result.authoringMode,
    usedMcp: result.usedMcp,
    thumbnails: result.thumbnailPaths.length,
    motionWarnings: report.checks.motionWarningCount,
    qaWarnings: report.checks.qaWarningCount,
    mp4: result.mp4Path ?? null,
  }, null, 2));

  process.exit(report.status === "fail" ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  console.error("\n" + usage());
  process.exit(1);
});
