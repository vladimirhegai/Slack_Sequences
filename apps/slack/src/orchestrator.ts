/**
 * The video lifecycle — the seam between Slack and the Sequences engine.
 *
 *   createVideo()  messy brief  → authored HyperFrames → thumbnails → MP4
 *   reviseVideo()  NL revision  → checkpointed source → thumbnails → MP4
 *
 * Luna owns live creative authoring in one exact Codex thread. Accepted bytes
 * still route through the Sequences MCP server (mcpClient) for deterministic
 * commit/render operations by default, with copied in-process glue as the
 * mechanical fallback. The former provider committee is explicit rollback;
 * the frozen Plan compiler remains only for the deterministic demo.
 */
import fs from "node:fs";
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
import { reportTemporalEvidence } from "./engine/temporalInspector.ts";
import { tryDirectInteractionRevision } from "./engine/directRevisionRouter.ts";
import {
  activeSentinelLedgerEvents,
  beginSentinelRun,
  finalizeSentinelRun,
  recordSentinelFallback,
  recordSentinelCatalogConversion,
  recordSentinelQualityStatus,
  recordSentinelStages,
  recordSentinelTierFromRunStart,
} from "./engine/sentinelTelemetry.ts";
import {
  deriveLedgerStageReceipts,
  deriveLedgerStatus,
  type LedgerStatus,
} from "./engine/runner/attemptLedger.ts";
import { sentinelSkeletonEnabled, sentinelSlotsEnabled } from "./engine/sentinelFlags.ts";
import { resolveFeatureFlag, slackSequencesEnvRawValue } from "./engine/featureFlags.ts";
import {
  activateLunaCompositionAssets,
  authorLunaComposition,
  confirmLunaComposition,
  lunaCreateFailureStage,
  LunaRejectedBundleError,
  loadLunaSession,
  repairLunaComposition,
  reconcileLunaSessionAfterUndo,
  resolveAuthorRoute,
  reviseLunaComposition,
  selfReviewLunaComposition,
  type LunaAuthoredComposition,
  type LunaFactEnvelope,
  type LunaMotionIntentV1,
} from "./engine/lunaRoute.ts";

/* ----------------------------------------------------------- provider choice */

/** Provider resolver for the explicit legacy-provider rollback route only. */
export function resolveProvider(explicit?: ProviderId): ProviderId {
  if (explicit) return explicit;
  const env = slackSequencesEnvRawValue("SLACK_SEQUENCES_PROVIDER") as ProviderId | undefined;
  if (env && PROVIDERS[env]) return env;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic-api";
  return "claude-code-cli";
}

/** MCP is opt-out: set SLACK_SEQUENCES_USE_MCP=0 only for local diagnosis. */
export function mcpEnabled(prefer?: boolean): boolean {
  if (prefer !== undefined) return prefer;
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_USE_MCP") !== "0";
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

/**
 * Pacing center when the caller never picked a length (🎬 shortcut, thread
 * replies): probes at the storyboard's own discretion routinely landed ~12-15s
 * films that read as truncated. ~24s gives the hook→proof→CTA arc room, and
 * `pacing/duration:` in `validateStoryboardPlan` holds the plan to the target.
 */
export const DEFAULT_TARGET_LENGTH_SEC = 24;

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

/**
 * An explicit paid-artifact recovery may resume only a failed project that has
 * never committed a direct composition. This keeps normal job ids immutable
 * while allowing a validator/source fix to continue from persisted attempts.
 */
export function canResumeFailedProject(
  dir: string,
  recoverySelector = slackSequencesEnvRawValue(
    "SLACK_SEQUENCES_RECOVER_REJECTED_STORYBOARD",
  )?.trim(),
): boolean {
  return Boolean(
    recoverySelector &&
    fs.existsSync(path.join(dir, "project.json")) &&
    fs.existsSync(path.join(dir, "FAILURE.md")) &&
    !hasDirectComposition(dir),
  );
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
  /** Creative orchestration seam; Luna-direct never enters the legacy committee. */
  authorRoute?: "luna-direct" | "legacy-provider";
  /** Honest runtime/quality publication axes folded from the attempt ledger. */
  ledgerStatus?: LedgerStatus;
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
  | "source-author"
  | "luna-director"
  | "luna-direction"
  | "luna-build"
  | "luna-repair"
  | "luna-self-review"
  | "luna-revision";

export interface StageReceipt {
  stage: AuthoringStage;
  status: "succeeded" | "failed";
  durationMs: number;
  /** How many model attempts the stage consumed (1 = clean first pass). */
  attempts?: number;
}

function ledgerStageReceipts(): StageReceipt[] {
  return deriveLedgerStageReceipts(activeSentinelLedgerEvents() ?? [])
    .filter((stage): stage is typeof stage & { stage: AuthoringStage } =>
      stage.stage === "frame-design" ||
      stage.stage === "storyboard-plan" ||
      stage.stage === "source-author",
    )
    .map((stage) => ({
      stage: stage.stage,
      status: stage.status,
      durationMs: stage.durationMs,
      ...(stage.attempts === undefined ? {} : { attempts: stage.attempts }),
    }));
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
        ...(draft.declaredPrimarySelectors
          ? { declaredPrimarySelectors: draft.declaredPrimarySelectors }
          : {}),
        ...(draft.declaredInteractions?.length
          ? { declaredInteractions: draft.declaredInteractions }
          : {}),
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
  /** Approved `/sequences assets` files copied into the isolated Luna job. */
  assetReferencePaths?: readonly string[];
  /** Containment root for those host-owned references. Required when files exist. */
  assetReferenceRoot?: string;
  /** Host-validated `/sequences assets` UI-pack deliverables directory. */
  preparedAssetPackDir?: string;
  /** Containment root for the versioned UI pack. */
  preparedAssetPackRoot?: string;
  /** Host-accepted byte fingerprint for that exact versioned UI pack. */
  preparedAssetPackFingerprint?: string;
  /** Context without legacy planner/asset offers; preserves Luna's creative ownership. */
  lunaContext?: string;
  /**
   * Model-free proof film when creative authoring is exhausted. This is an
   * explicit operator/demo escape hatch; ordinary Luna runs fail loudly so a
   * deterministic proof can never masquerade as a successful creative run.
   */
  allowDeterministicFallback?: boolean;
  /**
   * Skip creative authoring and apply this plan directly. A function receives the
   * freshly-initialized project so it can reference seeded asset ids. This is the
   * deterministic local engine smoke path — key-free and known-good.
   */
  presetPlan?: Plan | ((project: Project) => Plan);
}

function pulseAuthorStage(
  callback: StageProgressCallback | undefined,
  stage: AuthoringStage,
  phase: "started" | "completed",
  durationMs?: number,
): void {
  try {
    callback?.(stage, phase, durationMs);
  } catch {
    // Slack progress is advisory and must never disturb the authoring run.
  }
}

async function captureLunaTemporalEvidence(
  dir: string,
  intent: LunaMotionIntentV1,
): Promise<void> {
  await reportTemporalEvidence(dir, {
    framesPerShot: 5,
    declaredPrimarySelectors: Object.fromEntries(
      intent.acts.map((act) => [act.sceneId, act.primarySelector]),
    ),
    declaredBoundaries: intent.boundaries.map((boundary) => ({
      fromScene: boundary.fromScene,
      toScene: boundary.toScene,
      strategy: boundary.strategy,
      atSec: boundary.atSec,
    })),
    declaredCameraMoves: intent.cameraMoves.map((camera) => ({
      sceneId: camera.sceneId,
      targetSelector: camera.targetSelector,
      startSec: camera.startSec,
      arrivalSec: camera.arrivalSec,
      settleEndSec: camera.settleEndSec,
      holdEndSec: camera.holdEndSec,
    })),
  });
}

async function commitLunaCandidate(
  options: CreateVideoOptions,
  dir: string,
  authored: LunaAuthoredComposition,
): Promise<Awaited<ReturnType<typeof applyDirectMutation>>> {
  const assets = activateLunaCompositionAssets(dir, authored);
  try {
    const mutation = await applyDirectMutation(
      dir,
      options.product,
      authored.draft,
      options.preferMcp,
      options.onProgress,
    );
    confirmLunaComposition(dir, authored);
    assets.commit();
    return mutation;
  } catch (error) {
    assets.rollback();
    throw error;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function publishLunaFallback(
  options: CreateVideoOptions,
  dir: string,
  stages: StageReceipt[],
  failedStage: AuthoringStage,
  failure: unknown,
): Promise<VideoResult> {
  const reason = errorText(failure);
  const report = buildAuthoringFailureReport({
    projectDir: dir,
    stage: failedStage,
    reason,
    stages,
  });
  const reportPath = writeFailureReport(dir, report);
  const allowFallback = options.allowDeterministicFallback ??
    resolveFeatureFlag("SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK").value === "on";
  if (!allowFallback) {
    throw new Error(`Job ID: ${options.jobId}\n${report}`);
  }
  process.stderr.write(
    `[luna] job ${options.jobId} failed at "${failedStage}"; publishing the labeled ` +
      `deterministic safe fallback — full diagnostic at ${
        reportPath ?? `${dir}/FAILURE.md`
      }\n`,
  );
  const draft = buildFallbackComposition({
    product: options.product,
    whatShipped: options.whatShipped,
    audience: options.audience,
    lengthSec: options.lengthSec ?? DEFAULT_TARGET_LENGTH_SEC,
  });
  const mutation = await applyDirectMutation(
    dir,
    options.product,
    draft,
    options.preferMcp,
    options.onProgress,
  );
  const previews = await buildPreviews(dir, {
    render: options.render ?? true,
    preferMcp: options.preferMcp,
    onProgress: options.onProgress,
  });
  const current = loadDirectComposition(dir);
  return {
    ...previews,
    projectDir: dir,
    outline: directOutline(current.manifest),
    lint: await directLintText(dir),
    usedMcp: mutation.usedMcp || previews.usedMcp,
    mcpRequested: mcpEnabled(options.preferMcp),
    toolCalls: [...(mutation.receipt ? [mutation.receipt] : []), ...previews.toolCalls],
    skillsUsed: ["luna-single-director", "deterministic-safe-fallback"],
    usedPreset: false,
    provider: "codex-cli",
    authorRoute: "luna-direct",
    stages,
    fallback: { stage: failedStage, reason: reason.slice(0, 300) },
  };
}

async function createVideoWithLuna(
  options: CreateVideoOptions,
  dir: string,
): Promise<VideoResult> {
  const stages: StageReceipt[] = [];
  const targetDurationSec = options.lengthSec ?? DEFAULT_TARGET_LENGTH_SEC;
  const facts: LunaFactEnvelope = {
    version: 1,
    product: options.product,
    brandName: options.brandName ?? options.product,
    whatShipped: options.whatShipped,
    ...(options.audience ? { audience: options.audience } : {}),
    ...(options.tone ? { tone: options.tone } : {}),
    targetDurationSec,
    // The same pacing freedom the legacy brief always granted in prose
    // ("a pacing center, not an exact duration"), declared as data.
    minDurationSec: Math.min(targetDurationSec, Math.max(6, Math.floor(targetDurationSec * 0.8))),
    maxDurationSec: Math.max(targetDurationSec, Math.min(60, Math.ceil(targetDurationSec * 1.2))),
    ...((options.lunaContext ?? options.context)
      ? { context: options.lunaContext ?? options.context }
      : {}),
    provenance: {
      source: "slack-user-and-authorized-workspace-context",
      unsupportedClaimsAllowed: false,
    },
  };

  let authored: LunaAuthoredComposition | undefined;
  let failedStage: AuthoringStage = "luna-director";
  let terminalFailure: unknown;
  let rejectedWorker: LunaAuthoredComposition["worker"] | undefined;
  try {
    authored = await authorLunaComposition({
      projectDir: dir,
      jobId: options.jobId,
      facts,
      assetReferencePaths: options.assetReferencePaths,
      assetReferenceRoot: options.assetReferenceRoot,
      preparedAssetPackDir: options.preparedAssetPackDir,
      preparedAssetPackRoot: options.preparedAssetPackRoot,
      preparedAssetPackFingerprint: options.preparedAssetPackFingerprint,
      onWorkflowStage: (stage, phase, durationMs, attempts) => {
        pulseAuthorStage(options.onStageProgress, stage, phase, durationMs);
        if (phase === "completed") {
          stages.push({
            stage,
            status: "succeeded",
            durationMs: durationMs ?? 0,
            attempts: attempts ?? 1,
          });
        }
      },
    });
  } catch (error) {
    failedStage = lunaCreateFailureStage(error) ?? "luna-director";
    const receipt = [...stages].reverse().find((entry) => entry.stage === failedStage);
    if (receipt) receipt.status = "failed";
    else stages.push({ stage: failedStage, status: "failed", durationMs: 0, attempts: 1 });
    terminalFailure = error;
    if (error instanceof LunaRejectedBundleError) rejectedWorker = error.worker;
  }

  let initialMutation: Awaited<ReturnType<typeof applyDirectMutation>> | undefined;
  if (authored) {
    try {
      initialMutation = await commitLunaCandidate(options, dir, authored);
    } catch (error) {
      terminalFailure = error;
      rejectedWorker = authored.worker;
      failedStage = "luna-build";
      const buildReceipt = [...stages].reverse().find((entry) => entry.stage === "luna-build");
      if (buildReceipt) buildReceipt.status = "failed";
    }
  }

  // A paid create bundle is never discarded without one exact-thread repair.
  // The repair sees only the verbatim hard failure; all static taste findings
  // were already retained as warnings by the declared-intent validation path.
  if (!initialMutation && rejectedWorker) {
    const repairBaseRunCount = rejectedWorker.runCount;
    const repairStarted = performance.now();
    pulseAuthorStage(options.onStageProgress, "luna-repair", "started");
    try {
      const repaired = await repairLunaComposition({
        projectDir: dir,
        facts,
        rejectedWorker,
        hardFindings: [errorText(terminalFailure)],
      });
      initialMutation = await commitLunaCandidate(options, dir, repaired);
      authored = repaired;
      const durationMs = Math.round(performance.now() - repairStarted);
      stages.push({
        stage: "luna-repair",
        status: "succeeded",
        durationMs,
        attempts: Math.max(1, repaired.worker.runCount - repairBaseRunCount),
      });
      pulseAuthorStage(options.onStageProgress, "luna-repair", "completed", durationMs);
    } catch (error) {
      const durationMs = Math.round(performance.now() - repairStarted);
      stages.push({ stage: "luna-repair", status: "failed", durationMs, attempts: 1 });
      pulseAuthorStage(options.onStageProgress, "luna-repair", "completed", durationMs);
      failedStage = "luna-repair";
      terminalFailure = error;
    }
  }

  if (!authored || !initialMutation) {
    return publishLunaFallback(
      options,
      dir,
      stages,
      failedStage,
      terminalFailure ?? "Luna create did not produce an accepted bundle",
    );
  }

  let previews = await buildPreviews(dir, {
    render: false,
    preferMcp: options.preferMcp,
    onProgress: options.onProgress,
  });
  const toolCalls: ToolCallReceipt[] = [
    ...(initialMutation.receipt ? [initialMutation.receipt] : []),
    ...previews.toolCalls,
  ];
  let usedMcp = initialMutation.usedMcp || previews.usedMcp;

  // Rendered self-review is one optional director turn. A failed polish pass
  // cannot invalidate the already mechanically accepted first cut.
  const reviewStarted = performance.now();
  pulseAuthorStage(options.onStageProgress, "luna-self-review", "started");
  try {
    await captureLunaTemporalEvidence(dir, authored.intent);
    const reviewed = await selfReviewLunaComposition({
      projectDir: dir,
      thumbnailPaths: previews.thumbnailPaths,
    });
    if (reviewed.artifactFingerprint !== authored.artifactFingerprint) {
      const acceptedPreviewBytes = previews.thumbnailPaths.map((filePath) => ({
        filePath,
        bytes: fs.existsSync(filePath) ? fs.readFileSync(filePath) : undefined,
      }));
      const reviewAssets = activateLunaCompositionAssets(dir, reviewed);
      let reviewCommitted = false;
      try {
        const reviewMutation = await applyDirectMutation(
          dir,
          options.product,
          reviewed.draft,
          options.preferMcp,
          options.onProgress,
        );
        reviewCommitted = true;
        const reviewPreviews = await buildPreviews(dir, {
          render: false,
          preferMcp: options.preferMcp,
          onProgress: options.onProgress,
        });
        await captureLunaTemporalEvidence(dir, reviewed.intent);
        confirmLunaComposition(dir, reviewed);
        reviewAssets.commit();
        if (reviewMutation.receipt) toolCalls.push(reviewMutation.receipt);
        usedMcp ||= reviewMutation.usedMcp;
        previews = reviewPreviews;
        toolCalls.push(...previews.toolCalls);
        usedMcp ||= previews.usedMcp;
        authored = reviewed;
      } catch (error) {
        if (reviewCommitted) undoDirectComposition(dir);
        reviewAssets.rollback();
        for (const accepted of acceptedPreviewBytes) {
          if (accepted.bytes) fs.writeFileSync(accepted.filePath, accepted.bytes);
          else fs.rmSync(accepted.filePath, { force: true });
        }
        if (reviewCommitted) {
          await captureLunaTemporalEvidence(dir, authored.intent).catch((restoreError) => {
            process.stderr.write(
              `[luna] could not restore first-cut temporal evidence: ${String(restoreError)}\n`,
            );
          });
        }
        throw error;
      }
    } else {
      // The same thread explicitly chose to keep the accepted bytes.
      confirmLunaComposition(dir, reviewed);
      authored = reviewed;
    }
    const durationMs = Math.round(performance.now() - reviewStarted);
    stages.push({ stage: "luna-self-review", status: "succeeded", durationMs, attempts: 1 });
    pulseAuthorStage(options.onStageProgress, "luna-self-review", "completed", durationMs);
  } catch (error) {
    const durationMs = Math.round(performance.now() - reviewStarted);
    stages.push({ stage: "luna-self-review", status: "failed", durationMs, attempts: 1 });
    pulseAuthorStage(options.onStageProgress, "luna-self-review", "completed", durationMs);
    process.stderr.write(
      `[luna] optional rendered self-review failed; retaining accepted first cut: ${String(error)}\n`,
    );
  }

  if (options.render ?? true) {
    const rendered = await renderVideo(dir, {
      preferMcp: options.preferMcp,
      onProgress: options.onProgress,
    });
    previews = {
      ...previews,
      ...(rendered.mp4Path ? { mp4Path: rendered.mp4Path } : {}),
      toolCalls: previews.toolCalls,
      usedMcp: previews.usedMcp,
    };
    toolCalls.push(...rendered.toolCalls);
    usedMcp ||= rendered.usedMcp;
  }

  const current = loadDirectComposition(dir);
  return {
    ...previews,
    projectDir: dir,
    outline: directOutline(current.manifest),
    lint: await directLintText(dir),
    usedMcp,
    mcpRequested: mcpEnabled(options.preferMcp),
    toolCalls,
    skillsUsed: ["luna-single-director"],
    usedPreset: false,
    provider: "codex-cli",
    authorRoute: "luna-direct",
    stages,
  };
}

export async function createVideo(options: CreateVideoOptions): Promise<VideoResult> {
  const authorRoute = resolveAuthorRoute(options.provider);
  const providerId = authorRoute === "luna-direct"
    ? "codex-cli"
    : resolveProvider(options.provider);

  const dir = projectDirFor(options.jobId);
  const resumedFailedProject = canResumeFailedProject(dir);
  if (resumedFailedProject) {
    process.stderr.write(
      `[orchestrator] resuming failed uncommitted project from its persisted paid artifacts: ${dir}\n`,
    );
  } else {
    initializeProject(dir, {
      name: options.product,
      brandName: options.brandName ?? options.product,
      seedScreenshot: true,
    });
  }

  const project = loadProject(dir);
  const usedPreset = options.presetPlan !== undefined;
  let skillsUsed: string[] = [];
  if (options.presetPlan === undefined && authorRoute === "luna-direct") {
    return createVideoWithLuna(options, dir);
  }
  if (options.presetPlan === undefined) {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`unknown provider "${providerId}"`);
    // Phase 0 telemetry: enter a Sentinel run context so every downstream
    // model call and deterministic repair lands in planning/sentinel-run.json.
    beginSentinelRun(dir, {
      skeleton: sentinelSkeletonEnabled(),
      slots: sentinelSlotsEnabled(),
    });
    const targetLengthSec = options.lengthSec ?? DEFAULT_TARGET_LENGTH_SEC;
    const brief = assembleBrief({ ...options, lengthSec: targetLengthSec });
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
    recordSentinelCatalogConversion("looks", frame.dialectId);
    let authoredDraft: DirectCompositionDraft | undefined;
    let fallbackInfo: VideoResult["fallback"];
    const planned = await runStage("storyboard-plan", () =>
      requestStoryboardPlan(provider, {
        brief,
        projectDir: dir,
        skills,
        frameMd: frame.frameMd,
        targetDurationSec: targetLengthSec,
      }));
    let authoredError: unknown;
    if (planned.value) {
      const authored = await runStage("source-author", () =>
        requestDirectComposition(provider, {
          brief,
          projectDir: dir,
          skills,
          frameMd: frame.frameMd,
          lockedStoryboard: planned.value,
        }));
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
      const allowFallback = options.allowDeterministicFallback ??
        resolveFeatureFlag("SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK").value === "on";
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
      recordSentinelFallback(`${failedStage}:${reason}`);
      authoredDraft = buildFallbackComposition({
        product: options.product,
        whatShipped: options.whatShipped,
        audience: options.audience,
        lengthSec: targetLengthSec,
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
    // A deterministic fallback bypasses the author runner's final browser
    // evidence event; recover its two axes from the committed manifest.
    if (!activeSentinelLedgerEvents()?.some((event) => event.kind === "quality-status")) {
      const committedQa = loadDirectComposition(dir).manifest.qa;
      recordSentinelQualityStatus({
        runtimeValid: committedQa?.browserValidated ?? false,
        qualityResidue: committedQa?.warningCount ?? 0,
      });
    }
    if (resumedFailedProject) {
      // The attempt documents remain valuable probe evidence; only the stale
      // top-level fail-loud marker is retired after a composition really commits.
      fs.rmSync(path.join(dir, "FAILURE.md"), { force: true });
    }
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
    const ledgerEvents = activeSentinelLedgerEvents() ?? [];
    const ledgerStatus = deriveLedgerStatus(ledgerEvents);
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
      authorRoute: "legacy-provider",
      stages: ledgerStageReceipts(),
      ledgerStatus,
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
  recordSentinelQualityStatus({ runtimeValid: true, qualityResidue: 0 });
  finalizeSentinelRun("published");
  const ledgerStatus = deriveLedgerStatus(activeSentinelLedgerEvents() ?? []);
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
    authorRoute: "legacy-provider",
    ledgerStatus,
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
  onStageProgress?: StageProgressCallback;
}

export async function reviseVideo(options: ReviseVideoOptions): Promise<VideoResult & { mode: string }> {
  const dir = options.projectDir;
  const authorRoute = resolveAuthorRoute(options.provider);
  const providerId = authorRoute === "luna-direct"
    ? "codex-cli"
    : resolveProvider(options.provider);
  if (hasDirectComposition(dir) && authorRoute === "luna-direct") {
    const previousSession = loadLunaSession(dir);
    if (!previousSession) {
      throw new Error(
        "This film predates the Luna session route. Recreate it with /sequences or use the explicit legacy-provider rollback route.",
      );
    }
    const started = performance.now();
    pulseAuthorStage(options.onStageProgress, "luna-revision", "started");
    let revisionStageCompleted = false;
    let revisionDurationMs = 0;
    const completeRevisionStage = (): number => {
      if (!revisionStageCompleted) {
        revisionStageCompleted = true;
        revisionDurationMs = Math.round(performance.now() - started);
        pulseAuthorStage(
          options.onStageProgress,
          "luna-revision",
          "completed",
          revisionDurationMs,
        );
      }
      return revisionDurationMs;
    };
    let authored;
    try {
      authored = await reviseLunaComposition({
        projectDir: dir,
        instruction: options.instruction,
      });
    } catch (error) {
      completeRevisionStage();
      throw error;
    }

    let mutation: Awaited<ReturnType<typeof applyDirectMutation>> = { usedMcp: false };
    let mode = "luna-direct-noop";
    let revisedAssets: ReturnType<typeof activateLunaCompositionAssets> | undefined;
    let revisionCommitted = false;
    if (
      authored.artifactFingerprint !==
      (previousSession.latestArtifactFingerprint ?? previousSession.latestRawSourceSha256)
    ) {
      revisedAssets = activateLunaCompositionAssets(dir, authored);
      try {
        mutation = await applyDirectMutation(
          dir,
          loadDirectComposition(dir).manifest.title,
          authored.draft,
          options.preferMcp,
          options.onProgress,
        );
        revisionCommitted = true;
        mode = "luna-direct-revision";
      } catch (error) {
        revisedAssets.rollback();
        completeRevisionStage();
        throw error;
      }
    }
    try {
      confirmLunaComposition(dir, authored);
      revisedAssets?.commit();
    } catch (error) {
      if (revisionCommitted) undoDirectComposition(dir);
      revisedAssets?.rollback();
      completeRevisionStage();
      throw error;
    }
    const durationMs = completeRevisionStage();
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
      skillsUsed: ["luna-single-director"],
      usedPreset: false,
      provider: "codex-cli",
      authorRoute: "luna-direct",
      stages: [{ stage: "luna-revision", status: "succeeded", durationMs, attempts: 1 }],
      mode,
    };
  }
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
      authorRoute: "legacy-provider",
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
    authorRoute: "legacy-provider",
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
    const restoredLunaSession = reconcileLunaSessionAfterUndo(dir);
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
      provider: restoredLunaSession ? "codex-cli" : providerId,
      authorRoute: restoredLunaSession ? "luna-direct" : "legacy-provider",
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
