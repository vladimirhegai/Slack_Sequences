/**
 * The video lifecycle — the seam between Slack and the Sequences engine.
 *
 *   createVideo()  messy brief  → authored HyperFrames → thumbnails → MP4
 *   reviseVideo()  NL revision  → checkpointed source → thumbnails → MP4
 *
 * Live work routes through the Sequences MCP server (mcpClient) by default —
 * the bot acting as a real MCP client — and falls back to the copied in-process
 * glue if the subprocess can't start. Live jobs author HyperFrames directly;
 * the frozen Plan compiler remains only for the deterministic demo fallback.
 */
import path from "node:path";
import {
  lintProject,
  planToCommands,
  ProjectStore,
  type Command,
  type EventEntry,
  type Plan,
  type Project,
} from "@sequences/core";
import { PROVIDERS, type ProviderId } from "@sequences/platform/providers";
import {
  buildProject,
  commitProject,
  loadProject,
  readEventSequence,
} from "./engine/projectIo.ts";
import { initializeProject, projectDirFor } from "./engine/projectTemplates.ts";
import {
  requestDirectComposition,
  requestStoryboardPlan,
} from "./engine/compositionRunner.ts";
import { buildFallbackComposition } from "./engine/fallbackComposition.ts";
import { buildAuthoringFailureReport, writeFailureReport } from "./engine/failureReport.ts";
import {
  buildJobFrame,
  frameFilePath,
  loadJobFrame,
  readFrameMeta,
} from "./engine/frameDesign.ts";
import { requestTweak } from "./engine/tweakRunner.ts";
import { generateSceneThumbnails } from "./engine/thumbs.ts";
import { renderProject, type RenderQuality } from "./engine/render.ts";
import { withPooledMcpClient } from "./engine/mcpClient.ts";
import { retrieveHyperframesSkillContext } from "./agent/skillContext.ts";
import {
  commitDirectComposition,
  directLintText,
  directOutline,
  generateDirectThumbnails,
  hasDirectComposition,
  loadDirectComposition,
  renderDirectComposition,
  undoDirectComposition,
  validateDirectComposition,
  type DirectCompositionDraft,
} from "./engine/directComposition.ts";
import { inspectDirectComposition } from "./engine/layoutInspector.ts";
import { tryDirectInteractionRevision } from "./engine/directRevisionRouter.ts";
import {
  beginSentinelRun,
  finalizeSentinelRun,
  recordSentinelStages,
  recordSentinelTierFromRunStart,
} from "./engine/sentinelTelemetry.ts";
import { sentinelSkeletonEnabled, sentinelSlotsEnabled } from "./engine/sentinelFlags.ts";

/* ----------------------------------------------------------- provider choice */

/** Default planning brain: a key-free CLI login, else the Anthropic API. */
export function resolveProvider(explicit?: ProviderId): ProviderId {
  if (explicit) return explicit;
  const env = process.env.SLACK_SEQUENCES_PROVIDER as ProviderId | undefined;
  if (env && PROVIDERS[env]) return env;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic-api";
  return "claude-code-cli";
}

/** MCP is opt-out: set SLACK_SEQUENCES_USE_MCP=0 only for local diagnosis. */
export function mcpEnabled(prefer?: boolean): boolean {
  if (prefer !== undefined) return prefer;
  return process.env.SLACK_SEQUENCES_USE_MCP !== "0";
}

/* ------------------------------------------------------------------- briefs */

export type Tone = "crisp-saas" | "warm-startup" | "bold-launch";

export interface BriefFields {
  product: string;
  whatShipped: string;
  audience?: string;
  tone?: Tone;
  lengthSec?: number;
  context?: string;
}

const TONE_HINT: Record<Tone, string> = {
  "crisp-saas": "crisp and precise (dev tools / B2B)",
  "warm-startup": "warm and friendly (startup)",
  "bold-launch": "bold and high-energy (launch)",
};

/** Assemble the modal/thread fields into one brief string for the planner. */
export function assembleBrief(fields: BriefFields): string {
  const lines = [
    `Product: ${fields.product}`,
    `What shipped / the launch: ${fields.whatShipped}`,
  ];
  if (fields.audience) lines.push(`Audience: ${fields.audience}`);
  if (fields.tone) {
    lines.push(`Preferred motion profile: ${fields.tone} — a ${TONE_HINT[fields.tone]} feel.`);
  }
  if (fields.lengthSec) {
    const lower = Math.max(6, Math.floor(fields.lengthSec * 0.8));
    const upper = Math.min(60, Math.ceil(fields.lengthSec * 1.2));
    lines.push(
      `Target runtime: around ${fields.lengthSec} seconds. This is a pacing center, not an ` +
        `exact duration; ${lower}-${upper} seconds is acceptable when the edit plays better.`,
    );
  }
  if (fields.context) lines.push(`Extra context: ${fields.context}`);
  lines.push(
    "Treat product facts, quoted UI copy, and requested product beats as coverage constraints. " +
      "Treat shot lists and motion notes as creative intent, not a literal edit: synthesize them " +
      "into one authored visual argument, atomize long prose into short screen copy, and never " +
      "paste the launch paragraph onto a card.",
    "Build a launch reel: a hook, the product/feature in action, the metric that matters, optional proof, and a CTA close.",
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ outputs */

export interface VideoResult {
  projectDir: string;
  outline: string;
  lint: string;
  thumbnailPaths: string[];
  mp4Path?: string;
  usedMcp: boolean;
  /** Whether this lifecycle requested MCP (as opposed to an explicit local run). */
  mcpRequested: boolean;
  /** Safe, argument-free evidence of the tools actually called. */
  toolCalls: ToolCallReceipt[];
  /** HyperFrames skills retrieved into the planning/revision prompt. */
  skillsUsed: string[];
  /** Read-only Slack-hosted MCP calls used to assemble workspace context. */
  slackMcpTools?: string[];
  /** Set when hosted-MCP context was skipped so the build could still proceed. */
  slackMcpNote?: string;
  /** True when the plan came from a curated preset rather than a planning brain. */
  usedPreset: boolean;
  provider: ProviderId;
  /** The per-job frame.md design system chosen for this video, if any. */
  frame?: FrameInfo;
  /** Argument-free receipts for the named authoring stages that actually ran. */
  stages?: StageReceipt[];
  /**
   * Present only when the published film is the deterministic safe fallback.
   * `stage` names the model stage that failed; `reason` is a bounded local
   * diagnostic for reports/logs — never shown verbatim in Slack.
   */
  fallback?: { stage: AuthoringStage; reason: string };
}

/** The named model stages between the brief and a committed composition. */
export type AuthoringStage =
  | "frame-design"
  | "storyboard-plan"
  | "source-author";

export interface StageReceipt {
  stage: AuthoringStage;
  status: "succeeded" | "failed";
  durationMs: number;
  /** How many model attempts the stage consumed (1 = clean first pass). */
  attempts?: number;
}

export interface FrameInfo {
  presetId: string;
  label: string;
  thesis: string;
  basis: "light" | "dark";
  brandMatched: boolean;
  exceptions: string[];
  /** Absolute path to the job's frame.md (for Slack attachment). */
  path: string;
}

export type McpToolName =
  | "submit_composition"
  | "submit_plan"
  | "apply_commands"
  | "render_preview"
  | "render"
  | "undo";
export type ToolCallStatus = "succeeded" | "fallback" | "failed";

export interface ToolCallReceipt {
  tool: McpToolName;
  status: ToolCallStatus;
  durationMs: number;
}

export interface OrchestratorProgress {
  tool: McpToolName;
  phase: "started" | "completed";
  receipt?: ToolCallReceipt;
  quality?: RenderQuality;
}

export type ProgressCallback = (progress: OrchestratorProgress) => void | Promise<void>;

/**
 * Live pulse for the named model-authoring stages (frame-design, storyboard,
 * source-author) — the long silent window before any MCP tool runs. Feeds the
 * ETA countdown in Slack; never gates work.
 */
export type StageProgressCallback = (
  stage: AuthoringStage,
  phase: "started" | "completed",
  durationMs?: number,
) => void;

async function reportProgress(
  callback: ProgressCallback | undefined,
  progress: OrchestratorProgress,
): Promise<void> {
  if (!callback) return;
  try {
    await callback(progress);
  } catch (error) {
    // Slack status updates are observability, never a reason to fail the render.
    process.stderr.write(`[orchestrator] progress callback failed: ${String(error)}\n`);
  }
}

function outlineText(project: Project): string {
  return project.scenes
    .map(
      (scene, i) =>
        `${i + 1}. ${scene.archetype}${scene.layout ? `/${scene.layout}` : ""} · ${Math.round(
          scene.durationFrames / project.meta.fps,
        )}s${scene.camera ? ` · camera:${scene.camera.move}` : ""}`,
    )
    .join("\n");
}

/** Read the job's existing frame.md metadata into a VideoResult.frame, if present. */
function frameInfo(dir: string): { frame?: FrameInfo } {
  const meta = readFrameMeta(dir);
  if (!meta) return {};
  return {
    frame: {
      presetId: meta.presetId,
      label: meta.label,
      thesis: meta.thesis,
      basis: meta.basis,
      brandMatched: meta.brandMatched,
      exceptions: meta.exceptions,
      path: frameFilePath(dir),
    },
  };
}

function lintText(project: Project): string {
  const findings = lintProject(project);
  if (findings.length === 0) return "lint: clean";
  return findings
    .map((f) => `${f.severity} [${f.rule}] ${[f.sceneId, f.layerId].filter(Boolean).join("/")}: ${f.message}`)
    .join("\n");
}

/* ------------------------------------------------------- apply (MCP / local) */

async function applyViaMcp(
  dir: string,
  tool: McpToolName,
  args: Record<string, unknown>,
): Promise<string> {
  // Pooled: submit/preview/render within one job reuse a single MCP server
  // instead of paying a tsx cold start per tool call.
  return withPooledMcpClient(dir, (client) => client.callTool(tool, args));
}

function applyInProcess(dir: string, command: Command): void {
  const project = loadProject(dir);
  const events: EventEntry[] = [];
  const store = new ProjectStore(project, (entry) => events.push(entry), readEventSequence(dir));
  const outcome = store.apply(command, "agent");
  if (!outcome.ok) {
    throw new Error(outcome.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
  }
  commitProject(dir, store.project, events);
  buildProject(dir, store.project);
}

/** In-process undo (the fallback for the MCP `undo` tool). Returns whether the
 * journal actually moved — "nothing to undo" is a no-op, not an error. */
function undoInProcess(dir: string): boolean {
  const project = loadProject(dir);
  const events: EventEntry[] = [];
  const store = new ProjectStore(project, (entry) => events.push(entry), readEventSequence(dir));
  const moved = store.undo("agent");
  if (moved) {
    commitProject(dir, store.project, events);
    buildProject(dir, store.project);
  }
  return moved;
}

/**
 * Apply a mutation, preferring MCP and falling back to in-process. `command` is
 * the typed command for the local path; `mcp` describes the equivalent tool call.
 */
async function applyMutation(
  dir: string,
  command: Command,
  mcp: { tool: "submit_plan" | "apply_commands"; args: Record<string, unknown> },
  preferMcp?: boolean,
  onProgress?: ProgressCallback,
): Promise<{ usedMcp: boolean; receipt?: ToolCallReceipt }> {
  await reportProgress(onProgress, { tool: mcp.tool, phase: "started" });
  if (mcpEnabled(preferMcp)) {
    const started = performance.now();
    try {
      await applyViaMcp(dir, mcp.tool, mcp.args);
      const receipt: ToolCallReceipt = {
        tool: mcp.tool,
        status: "succeeded",
        durationMs: Math.round(performance.now() - started),
      };
      await reportProgress(onProgress, { tool: mcp.tool, phase: "completed", receipt });
      return {
        usedMcp: true,
        receipt,
      };
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP path failed, falling back in-process: ${String(error)}\n`);
      try {
        applyInProcess(dir, command);
      } catch (fallbackError) {
        const receipt: ToolCallReceipt = {
          tool: mcp.tool,
          status: "failed",
          durationMs: Math.round(performance.now() - started),
        };
        await reportProgress(onProgress, { tool: mcp.tool, phase: "completed", receipt });
        throw fallbackError;
      }
      const receipt: ToolCallReceipt = {
        tool: mcp.tool,
        status: "fallback",
        durationMs: Math.round(performance.now() - started),
      };
      await reportProgress(onProgress, { tool: mcp.tool, phase: "completed", receipt });
      return {
        usedMcp: false,
        receipt,
      };
    }
  }
  const started = performance.now();
  try {
    applyInProcess(dir, command);
  } catch (error) {
    await reportProgress(onProgress, {
      tool: mcp.tool,
      phase: "completed",
      receipt: {
        tool: mcp.tool,
        status: "failed",
        durationMs: Math.round(performance.now() - started),
      },
    });
    throw error;
  }
  await reportProgress(onProgress, { tool: mcp.tool, phase: "completed" });
  return { usedMcp: false };
}

async function applyDirectMutation(
  dir: string,
  title: string,
  draft: DirectCompositionDraft,
  preferMcp?: boolean,
  onProgress?: ProgressCallback,
): Promise<{ usedMcp: boolean; receipt?: ToolCallReceipt }> {
  const tool = "submit_composition" as const;
  await reportProgress(onProgress, { tool, phase: "started" });
  const started = performance.now();
  if (mcpEnabled(preferMcp)) {
    try {
      await applyViaMcp(dir, tool, {
        title,
        html: draft.html,
        storyboard: draft.storyboard as unknown as Record<string, unknown>[],
      });
      const receipt: ToolCallReceipt = {
        tool,
        status: "succeeded",
        durationMs: Math.round(performance.now() - started),
      };
      await reportProgress(onProgress, { tool, phase: "completed", receipt });
      return { usedMcp: true, receipt };
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP direct authoring failed, falling back in-process: ${String(error)}\n`);
      try {
        await commitDirectComposition(dir, title, draft);
      } catch (fallbackError) {
        const receipt: ToolCallReceipt = {
          tool,
          status: "failed",
          durationMs: Math.round(performance.now() - started),
        };
        await reportProgress(onProgress, { tool, phase: "completed", receipt });
        throw fallbackError;
      }
      const receipt: ToolCallReceipt = {
        tool,
        status: "fallback",
        durationMs: Math.round(performance.now() - started),
      };
      await reportProgress(onProgress, { tool, phase: "completed", receipt });
      return { usedMcp: false, receipt };
    }
  }
  await commitDirectComposition(dir, title, draft);
  await reportProgress(onProgress, { tool, phase: "completed" });
  return { usedMcp: false };
}

/* --------------------------------------------------------------- previews */

/**
 * Tier 2 of two-tier delivery: render the draft MP4 for an already-applied
 * project directory. Returns `{}` (no `mp4Path`) instead of throwing when the
 * render host is unavailable (FFmpeg/Chrome missing or a render failure), so the
 * thumbnails-only tier-1 result still stands. Deterministic plumbing: same
 * applied project in, same frames out — no model. MCP is only the transport.
 */
export async function renderVideo(
  dir: string,
  options: {
    preferMcp?: boolean;
    quality?: RenderQuality;
    onProgress?: ProgressCallback;
  } = {},
): Promise<{ mp4Path?: string; toolCalls: ToolCallReceipt[]; usedMcp: boolean }> {
  const quality = options.quality ?? "draft";
  await reportProgress(options.onProgress, { tool: "render", phase: "started", quality });
  if (mcpEnabled(options.preferMcp)) {
    const started = performance.now();
    try {
      const text = await applyViaMcp(dir, "render", { quality });
      const payload = JSON.parse(text) as { outputPath?: unknown };
      if (typeof payload.outputPath !== "string" || !payload.outputPath) {
        throw new Error("render tool returned no outputPath");
      }
      const receipt: ToolCallReceipt = {
        tool: "render",
        status: "succeeded",
        durationMs: Math.round(performance.now() - started),
      };
      await reportProgress(options.onProgress, {
        tool: "render",
        phase: "completed",
        receipt,
        quality,
      });
      return {
        mp4Path: payload.outputPath,
        usedMcp: true,
        toolCalls: [receipt],
      };
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP render failed, falling back in-process: ${String(error)}\n`);
      try {
        const result = hasDirectComposition(dir)
          ? await renderDirectComposition(dir, { quality, quiet: true })
          : await renderProject(dir, loadProject(dir), { quality, quiet: true });
        const receipt: ToolCallReceipt = {
          tool: "render",
          status: "fallback",
          durationMs: Math.round(performance.now() - started),
        };
        await reportProgress(options.onProgress, {
          tool: "render",
          phase: "completed",
          receipt,
          quality,
        });
        return {
          mp4Path: result.outputPath,
          usedMcp: false,
          toolCalls: [receipt],
        };
      } catch (fallbackError) {
        process.stderr.write(`[orchestrator] render skipped: ${String(fallbackError)}\n`);
        const receipt: ToolCallReceipt = {
          tool: "render",
          status: "failed",
          durationMs: Math.round(performance.now() - started),
        };
        await reportProgress(options.onProgress, {
          tool: "render",
          phase: "completed",
          receipt,
          quality,
        });
        return {
          usedMcp: false,
          toolCalls: [receipt],
        };
      }
    }
  }

  const started = performance.now();
  try {
    const result = hasDirectComposition(dir)
      ? await renderDirectComposition(dir, { quality, quiet: true })
      : await renderProject(dir, loadProject(dir), { quality, quiet: true });
    await reportProgress(options.onProgress, { tool: "render", phase: "completed", quality });
    return { mp4Path: result.outputPath, toolCalls: [], usedMcp: false };
  } catch (error) {
    process.stderr.write(`[orchestrator] render skipped: ${String(error)}\n`);
    await reportProgress(options.onProgress, {
      tool: "render",
      phase: "completed",
      quality,
      receipt: {
        tool: "render",
        status: "failed",
        durationMs: Math.round(performance.now() - started),
      },
    });
    return { toolCalls: [], usedMcp: false };
  }
}

async function buildPreviews(
  dir: string,
  options: {
    render: boolean;
    preferMcp?: boolean;
    onProgress?: ProgressCallback;
  },
): Promise<{
  thumbnailPaths: string[];
  mp4Path?: string;
  toolCalls: ToolCallReceipt[];
  usedMcp: boolean;
}> {
  const direct = hasDirectComposition(dir);
  const project = direct ? undefined : loadProject(dir);
  let thumbnailPaths: string[];
  let usedMcp = false;
  const toolCalls: ToolCallReceipt[] = [];

  await reportProgress(options.onProgress, { tool: "render_preview", phase: "started" });
  if (mcpEnabled(options.preferMcp)) {
    const started = performance.now();
    try {
      const text = await applyViaMcp(dir, "render_preview", {});
      const payload = JSON.parse(text) as { files?: unknown };
      if (!Array.isArray(payload.files) || !payload.files.every((file) => typeof file === "string")) {
        throw new Error("render_preview tool returned invalid files");
      }
      thumbnailPaths = payload.files.map((file) => path.join(dir, "build", file));
      usedMcp = true;
      const receipt: ToolCallReceipt = {
        tool: "render_preview",
        status: "succeeded",
        durationMs: Math.round(performance.now() - started),
      };
      toolCalls.push(receipt);
      await reportProgress(options.onProgress, { tool: "render_preview", phase: "completed", receipt });
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP preview failed, falling back in-process: ${String(error)}\n`);
      try {
        const thumbs = direct
          ? await generateDirectThumbnails(dir)
          : await generateSceneThumbnails(dir, project!);
        thumbnailPaths = Object.values(thumbs.files).map((file) => path.join(dir, "build", file));
        const receipt: ToolCallReceipt = {
          tool: "render_preview",
          status: "fallback",
          durationMs: Math.round(performance.now() - started),
        };
        toolCalls.push(receipt);
        await reportProgress(options.onProgress, { tool: "render_preview", phase: "completed", receipt });
      } catch (fallbackError) {
        const receipt: ToolCallReceipt = {
          tool: "render_preview",
          status: "failed",
          durationMs: Math.round(performance.now() - started),
        };
        await reportProgress(options.onProgress, { tool: "render_preview", phase: "completed", receipt });
        throw fallbackError;
      }
    }
  } else {
    const started = performance.now();
    try {
      const thumbs = direct
        ? await generateDirectThumbnails(dir)
        : await generateSceneThumbnails(dir, project!);
      thumbnailPaths = Object.values(thumbs.files).map((file) => path.join(dir, "build", file));
      await reportProgress(options.onProgress, { tool: "render_preview", phase: "completed" });
    } catch (error) {
      await reportProgress(options.onProgress, {
        tool: "render_preview",
        phase: "completed",
        receipt: {
          tool: "render_preview",
          status: "failed",
          durationMs: Math.round(performance.now() - started),
        },
      });
      throw error;
    }
  }

  // Tier 1 = "thumbnails exist" — recorded here, where that is true, not at
  // the orchestrator call site (which used to stamp it before this function).
  recordSentinelTierFromRunStart("tier1");

  if (!options.render) return { thumbnailPaths, toolCalls, usedMcp };
  // MP4 needs FFmpeg + Chrome; renderVideo degrades to thumbnails-only on failure.
  const rendered = await renderVideo(dir, {
    preferMcp: options.preferMcp,
    onProgress: options.onProgress,
  });
  // Tier 2 = "MP4 exists"; a degraded thumbnails-only result records nothing.
  if (rendered.mp4Path) recordSentinelTierFromRunStart("tier2");
  return {
    thumbnailPaths,
    mp4Path: rendered.mp4Path,
    toolCalls: [...toolCalls, ...rendered.toolCalls],
    usedMcp: usedMcp || rendered.usedMcp,
  };
}

/* ----------------------------------------------------------------- create */

export interface CreateVideoOptions extends BriefFields {
  jobId: string;
  brandName?: string;
  provider?: ProviderId;
  render?: boolean;
  preferMcp?: boolean;
  onProgress?: ProgressCallback;
  /** Pulse for the model-authoring stages; drives the Slack ETA countdown. */
  onStageProgress?: StageProgressCallback;
  /**
   * Model-free proof film when creative authoring is exhausted. ON by default:
   * the result is explicitly labeled (`VideoResult.fallback` + the Slack
   * fallback banner and debug receipts keep it honest), and a labeled proof
   * film beats a raw error in front of a demo audience. Operators who prefer
   * visible failures opt out per call or with
   * SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0.
   */
  allowDeterministicFallback?: boolean;
  /**
   * Skip the planning brain and apply this plan directly. A function receives the
   * freshly-initialized project so it can reference seeded asset ids. This is the
   * deterministic `/sequences demo` path — instant, key-free, and known-good.
   */
  presetPlan?: Plan | ((project: Project) => Plan);
}

export async function createVideo(options: CreateVideoOptions): Promise<VideoResult> {
  const providerId = resolveProvider(options.provider);

  const dir = projectDirFor(options.jobId);
  initializeProject(dir, {
    name: options.product,
    brandName: options.brandName ?? options.product,
    seedScreenshot: true,
  });

  const project = loadProject(dir);
  const usedPreset = options.presetPlan !== undefined;
  let skillsUsed: string[] = [];
  if (options.presetPlan === undefined) {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`unknown provider "${providerId}"`);
    // Phase 0 telemetry: enter a Sentinel run context so every downstream
    // model call and deterministic repair lands in planning/sentinel-run.json.
    beginSentinelRun(dir, {
      skeleton: sentinelSkeletonEnabled(),
      slots: sentinelSlotsEnabled(),
    });
    const brief = assembleBrief(options);
    const skills = retrieveHyperframesSkillContext("create", brief);
    skillsUsed = skills.skillNames;
    // Named authoring stages. Each model stage is caught separately so a
    // failure is attributed to the stage that actually broke (plan §5 of the
    // storyboard-density work): a GLM timeout, an invalid storyboard, a
    // truncated source, and a QA rejection are different failures, and the
    // deterministic fallback is an explicitly labeled outcome — never
    // disguised as creative output.
    const stages: StageReceipt[] = [];
    const pulseStage = (
      stage: AuthoringStage,
      phase: "started" | "completed",
      durationMs?: number,
    ): void => {
      try {
        options.onStageProgress?.(stage, phase, durationMs);
      } catch {
        // Progress display must never disturb the build.
      }
    };
    const runStage = async <T>(
      stage: AuthoringStage,
      run: () => Promise<T>,
    ): Promise<{ value?: T; error?: unknown }> => {
      const started = performance.now();
      pulseStage(stage, "started");
      try {
        const value = await run();
        const durationMs = Math.round(performance.now() - started);
        stages.push({ stage, status: "succeeded", durationMs });
        pulseStage(stage, "completed", durationMs);
        return { value };
      } catch (error) {
        const durationMs = Math.round(performance.now() - started);
        stages.push({ stage, status: "failed", durationMs });
        pulseStage(stage, "completed", durationMs);
        process.stderr.write(
          `[orchestrator] stage "${stage}" failed: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
        return { error };
      }
    };
    const stageReason = (error: unknown): string =>
      (error instanceof Error ? error.message : String(error)).slice(0, 300);
    // Attempt counters are out-params the retry loops write into; the debug
    // receipt trail renders them so an operator can see silent retries.
    const setStageAttempts = (stage: AuthoringStage, count: number): void => {
      if (count <= 0) return;
      const receipt = [...stages].reverse().find((entry) => entry.stage === stage);
      if (receipt) receipt.attempts = count;
    };

    // Per-job frame.md: bounded art direction + deterministic design tools.
    // Hard brand/contrast/font constraints, tunable recommendations, safe
    // fallback — buildJobFrame degrades internally, so a throw here is real.
    const framed = await runStage("frame-design", () =>
      buildJobFrame({
        provider,
        projectDir: dir,
        brief,
        tone: options.tone,
        evidence: options.context,
        brandName: options.brandName ?? options.product,
      }));
    if (!framed.value) {
      // frame-design has no safe fallback (brand direction can't be faked), so it
      // always fails loud — surface the same consolidated diagnostic.
      const report = buildAuthoringFailureReport({
        projectDir: dir,
        stage: "frame-design",
        reason: framed.error instanceof Error ? framed.error.message : String(framed.error),
        stages,
      });
      writeFailureReport(dir, report);
      recordSentinelStages(stages);
      finalizeSentinelRun("fail-loud");
      throw new Error(report);
    }
    const frame = framed.value;
    let authoredDraft: DirectCompositionDraft | undefined;
    let fallbackInfo: VideoResult["fallback"];
    const storyboardAttempts = { count: 0 };
    const planned = await runStage("storyboard-plan", () =>
      requestStoryboardPlan(provider, {
        brief,
        projectDir: dir,
        skills,
        frameMd: frame.frameMd,
        targetDurationSec: options.lengthSec,
        attempts: storyboardAttempts,
      }));
    setStageAttempts("storyboard-plan", storyboardAttempts.count);
    let authoredError: unknown;
    if (planned.value) {
      const authorAttempts = { count: 0 };
      const authored = await runStage("source-author", () =>
        requestDirectComposition(provider, {
          brief,
          projectDir: dir,
          skills,
          frameMd: frame.frameMd,
          lockedStoryboard: planned.value,
          attempts: authorAttempts,
        }));
      setStageAttempts("source-author", authorAttempts.count);
      if (authored.value) {
        authoredDraft = authored.value.draft;
      }
      authoredError = authored.error;
    }
    if (!authoredDraft) {
      const failedStage: AuthoringStage = planned.value ? "source-author" : "storyboard-plan";
      const failError = planned.error ?? authoredError;
      const reason = stageReason(failError);
      const fullReason = failError instanceof Error ? failError.message : String(failError);
      const allowFallback =
        options.allowDeterministicFallback ??
        process.env.SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK !== "0";
      // Always assemble + persist the full diagnostic — whether we fail loud or
      // ship the labeled safe film, the operator can retrieve the complete log
      // (stage, per-attempt findings, artifact paths) from FAILURE.md / Railway.
      const report = buildAuthoringFailureReport({
        projectDir: dir,
        stage: failedStage,
        reason: fullReason,
        stages,
      });
      const reportPath = writeFailureReport(dir, report);
      if (!allowFallback) {
        process.stderr.write(
          `[orchestrator] fail-loud: authoring failed at "${failedStage}"; ` +
            `no video published — full diagnostic at ${reportPath ?? `${dir}/FAILURE.md`}\n`,
        );
        // The whole report becomes the surfaced error so Slack (code-block) and
        // sequence:check show the log directly; FAILURE.md carries the untruncated copy.
        recordSentinelStages(stages);
        finalizeSentinelRun("fail-loud");
        throw new Error(report);
      }
      process.stderr.write(
        `[orchestrator] model authoring unavailable at stage "${failedStage}"; ` +
          `publishing the explicitly enabled deterministic safe fallback — ` +
          `full diagnostic at ${reportPath ?? `${dir}/FAILURE.md`}\n`,
      );
      fallbackInfo = { stage: failedStage, reason };
      authoredDraft = buildFallbackComposition({
        product: options.product,
        whatShipped: options.whatShipped,
        audience: options.audience,
        lengthSec: options.lengthSec,
        frameMd: frame.frameMd,
        // Skin the safe film with the plan's own copy when source authoring
        // failed with a proven storyboard in hand (planned.value is undefined
        // when the storyboard stage itself failed → the generic proof reel).
        ...(planned.value ? { plan: planned.value } : {}),
      });
    }
    const mutation = await applyDirectMutation(
      dir,
      options.product,
      authoredDraft,
      options.preferMcp,
      options.onProgress,
    );
    // Tier wall-clocks are recorded INSIDE buildPreviews, where each tier
    // actually completes: tier 1 when the thumbnails exist, tier 2 when the
    // MP4 exists. (They used to be stamped here, before/around the call, so
    // "wall-clock to thumbnails" quietly excluded the thumbnails.)
    const willRender = options.render ?? true;
    const previews = await buildPreviews(dir, {
      render: willRender,
      preferMcp: options.preferMcp,
      onProgress: options.onProgress,
    });
    recordSentinelStages(stages);
    finalizeSentinelRun(fallbackInfo ? "fallback" : "published");
    const current = loadDirectComposition(dir);
    return {
      ...previews,
      projectDir: dir,
      outline: directOutline(current.manifest),
      lint: await directLintText(dir),
      usedMcp: mutation.usedMcp || previews.usedMcp,
      mcpRequested: mcpEnabled(options.preferMcp),
      toolCalls: [...(mutation.receipt ? [mutation.receipt] : []), ...previews.toolCalls],
      skillsUsed,
      usedPreset: false,
      provider: providerId,
      stages,
      ...(fallbackInfo ? { fallback: fallbackInfo } : {}),
      frame: {
        presetId: frame.presetId,
        label: frame.label,
        thesis: frame.thesis,
        basis: frame.basis,
        brandMatched: frame.brandMatched,
        exceptions: frame.exceptions,
        path: frameFilePath(dir),
      },
    };
  }

  let plan: Plan;
  if (options.presetPlan !== undefined) {
    plan = typeof options.presetPlan === "function" ? options.presetPlan(project) : options.presetPlan;
  } else {
    throw new Error("unreachable authoring mode");
  }

  // The model-free preset/demo path also emits a sentinel-run.json (0 model
  // calls, "published") so the telemetry instrument has a real, no-cost
  // end-to-end run to prove itself.
  beginSentinelRun(dir, { skeleton: sentinelSkeletonEnabled(), slots: sentinelSlotsEnabled() });
  const mutation = await applyMutation(
    dir,
    planToCommands(project, plan),
    { tool: "submit_plan", args: { plan: plan as unknown as Record<string, unknown> } },
    options.preferMcp,
    options.onProgress,
  );
  // Tier wall-clocks are recorded inside buildPreviews when each tier's
  // artifact actually exists.
  const presetWillRender = options.render ?? true;
  const previews = await buildPreviews(dir, {
    render: presetWillRender,
    preferMcp: options.preferMcp,
    onProgress: options.onProgress,
  });
  finalizeSentinelRun("published");
  const applied = loadProject(dir);
  return {
    ...previews,
    projectDir: dir,
    outline: outlineText(applied),
    lint: lintText(applied),
    usedMcp: mutation.usedMcp || previews.usedMcp,
    mcpRequested: mcpEnabled(options.preferMcp),
    toolCalls: [...(mutation.receipt ? [mutation.receipt] : []), ...previews.toolCalls],
    skillsUsed,
    usedPreset,
    provider: providerId,
  };
}

/* ----------------------------------------------------------------- revise */

export interface ReviseVideoOptions {
  projectDir: string;
  instruction: string;
  provider?: ProviderId;
  render?: boolean;
  preferMcp?: boolean;
  onProgress?: ProgressCallback;
}

export async function reviseVideo(options: ReviseVideoOptions): Promise<VideoResult & { mode: string }> {
  const dir = options.projectDir;
  const providerId = resolveProvider(options.provider);
  if (hasDirectComposition(dir)) {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`unknown provider "${providerId}"`);
    const current = loadDirectComposition(dir);
    const skills = retrieveHyperframesSkillContext("revise", options.instruction);
    // Reuse the create-time frame.md — brand direction is unchanged on revise.
    const frameMd = loadJobFrame(dir) ?? undefined;
    const currentDraft: DirectCompositionDraft = {
      html: current.html,
      storyboard: current.manifest.scenes,
    };
    const routed = await tryDirectInteractionRevision(
      provider,
      options.instruction,
      currentDraft,
    );
    let draft: DirectCompositionDraft | undefined;
    let revisionMode = "hyperframes-direct";
    if (routed) {
      const staticValidation = await validateDirectComposition(dir, routed);
      const browserValidation = staticValidation.ok
        ? await inspectDirectComposition(dir, routed, { captureGuide: false })
        : undefined;
      if (staticValidation.ok && browserValidation?.ok) {
        draft = routed;
        revisionMode = "hyperframes-interaction-patch";
      }
    }
    if (!draft) {
      const authored = await requestDirectComposition(provider, {
        brief: `Product: ${current.manifest.title}\nRevise the existing launch composition.`,
        projectDir: dir,
        skills,
        frameMd,
        current: currentDraft,
        revisionInstruction: options.instruction,
      });
      draft = authored.draft;
    }
    const mutation = await applyDirectMutation(
      dir,
      current.manifest.title,
      draft,
      options.preferMcp,
      options.onProgress,
    );
    const previews = await buildPreviews(dir, {
      render: options.render ?? true,
      preferMcp: options.preferMcp,
      onProgress: options.onProgress,
    });
    const applied = loadDirectComposition(dir);
    return {
      ...previews,
      projectDir: dir,
      outline: directOutline(applied.manifest),
      lint: await directLintText(dir),
      usedMcp: mutation.usedMcp || previews.usedMcp,
      mcpRequested: mcpEnabled(options.preferMcp),
      toolCalls: [...(mutation.receipt ? [mutation.receipt] : []), ...previews.toolCalls],
      skillsUsed: skills.skillNames,
      usedPreset: false,
      provider: providerId,
      mode: revisionMode,
      ...frameInfo(dir),
    };
  }
  const project = loadProject(dir);

  // Zero-token matcher resolves common edits ("shorter", "warmer") with no model
  // call; otherwise the provider translates the instruction into commands.
  const skills = retrieveHyperframesSkillContext("revise", options.instruction);
  const tweak = await requestTweak(providerId, options.instruction, project, {}, {}, skills.text);
  const command: Command =
    tweak.commands.length === 1 ? tweak.commands[0]! : { type: "Batch", commands: tweak.commands };

  const mutation = await applyMutation(
    dir,
    command,
    { tool: "apply_commands", args: { commands: tweak.commands as unknown as Record<string, unknown>[] } },
    options.preferMcp,
    options.onProgress,
  );

  const previews = await buildPreviews(dir, {
    render: options.render ?? true,
    preferMcp: options.preferMcp,
    onProgress: options.onProgress,
  });
  const applied = loadProject(dir);
  return {
    ...previews,
    projectDir: dir,
    outline: outlineText(applied),
    lint: lintText(applied),
    usedMcp: mutation.usedMcp || previews.usedMcp,
    mcpRequested: mcpEnabled(options.preferMcp),
    toolCalls: [...(mutation.receipt ? [mutation.receipt] : []), ...previews.toolCalls],
    skillsUsed: skills.skillNames,
    usedPreset: false,
    provider: providerId,
    mode: tweak.mode,
  };
}

/* ------------------------------------------------------------------- undo */

/**
 * Revert the most recent change (journaled, source "agent" — law 1), preferring
 * the MCP `undo` tool and falling back to the in-process store. Re-runs previews
 * so the caller can re-deliver the reverted storyboard through the same two-tier
 * path. Deterministic: undo replays the journal, the model is never consulted.
 */
export async function undoVideo(
  dir: string,
  options: {
    render?: boolean;
    preferMcp?: boolean;
    onProgress?: ProgressCallback;
  } = {},
): Promise<VideoResult> {
  const providerId = resolveProvider();
  const toolCalls: ToolCallReceipt[] = [];
  let usedMcp = false;
  const direct = hasDirectComposition(dir);

  if (mcpEnabled(options.preferMcp)) {
    await reportProgress(options.onProgress, { tool: "undo", phase: "started" });
    const started = performance.now();
    try {
      await applyViaMcp(dir, "undo", {});
      usedMcp = true;
      const receipt: ToolCallReceipt = {
        tool: "undo",
        status: "succeeded",
        durationMs: Math.round(performance.now() - started),
      };
      toolCalls.push(receipt);
      await reportProgress(options.onProgress, { tool: "undo", phase: "completed", receipt });
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP undo failed, falling back in-process: ${String(error)}\n`);
      if (direct) undoDirectComposition(dir);
      else undoInProcess(dir);
      const receipt: ToolCallReceipt = {
        tool: "undo",
        status: "fallback",
        durationMs: Math.round(performance.now() - started),
      };
      toolCalls.push(receipt);
      await reportProgress(options.onProgress, { tool: "undo", phase: "completed", receipt });
    }
  } else {
    await reportProgress(options.onProgress, { tool: "undo", phase: "started" });
    if (direct) undoDirectComposition(dir);
    else undoInProcess(dir);
    await reportProgress(options.onProgress, { tool: "undo", phase: "completed" });
  }

  const previews = await buildPreviews(dir, {
    render: options.render ?? false,
    preferMcp: options.preferMcp,
    onProgress: options.onProgress,
  });
  if (direct) {
    const applied = loadDirectComposition(dir);
    return {
      ...previews,
      projectDir: dir,
      outline: directOutline(applied.manifest),
      lint: await directLintText(dir),
      usedMcp: usedMcp || previews.usedMcp,
      mcpRequested: mcpEnabled(options.preferMcp),
      toolCalls: [...toolCalls, ...previews.toolCalls],
      skillsUsed: [],
      usedPreset: false,
      provider: providerId,
      ...frameInfo(dir),
    };
  }
  const applied = loadProject(dir);
  return {
    ...previews,
    projectDir: dir,
    outline: outlineText(applied),
    lint: lintText(applied),
    usedMcp: usedMcp || previews.usedMcp,
    mcpRequested: mcpEnabled(options.preferMcp),
    toolCalls: [...toolCalls, ...previews.toolCalls],
    skillsUsed: [],
    usedPreset: false,
    provider: providerId,
  };
}
