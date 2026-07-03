import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { App } from "@slack/bolt";
import type { BlockAction, MessageShortcut, ViewSubmitAction } from "@slack/bolt";
import type { GenericMessageEvent } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import {
  buildCreateModal,
  buildReviseModal,
  buildShareModal,
  buildingBlocks,
  diagnosticsBlocks,
  errorBlocks,
  hdReadyBlocks,
  resultBlocks,
  thinkingStepsBlocks,
  type ThinkingStep,
  type VideoStage,
} from "./blocks.ts";
import {
  createVideo,
  renderVideo,
  reviseVideo,
  undoVideo,
  type CreateVideoOptions,
  type McpToolName,
  type OrchestratorProgress,
  type ProgressCallback,
  type Tone,
  type VideoResult,
} from "./orchestrator.ts";
import { DEMO_BRIEF, buildDemoPlan } from "./demo.ts";
import { createJob, findJobByThread, getJob, listJobs, updateJob } from "./jobStore.ts";
import { EventDeduper, parseThreadReply, type ThreadReply } from "./messageEvents.ts";
import {
  postMessageWithAutoJoin,
  userFacingSlackError,
} from "./slackApi.ts";
import { summarizeThread, type ThreadMessage } from "./thread.ts";
import { getSlackUserToken } from "./slackTokenStore.ts";
import { slackInstallUrl } from "./slackOAuth.ts";
import { retrieveSlackMcpContext } from "./slackMcpContext.ts";
import { runDiagnostics } from "./diagnostics.ts";
import { isDebugEnabled, setDebugEnabled } from "./debugFlags.ts";
import {
  CREATE_STEPS,
  EtaTracker,
  REVISE_STEPS,
  estimateStepMs,
  formatEtaMs,
  recordStepDuration,
} from "./engine/stageTimings.ts";
import { loadJobFrame, publicFrameMd } from "./engine/frameDesign.ts";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
if (!botToken) throw new Error("Missing SLACK_BOT_TOKEN in .env");
if (!appToken) throw new Error("Missing SLACK_APP_TOKEN in .env");

const app = new App({ token: botToken, appToken, socketMode: true });
const eventDeduper = new EventDeduper();
const activeJobs = new Set<string>();
let botUserId: string | undefined;

/* ----------------------------------------------------------------- helpers */

type ViewState = ViewSubmitAction["view"]["state"];

function readInput(state: ViewState, blockId: string): string {
  const value = state.values[blockId]?.value?.value;
  return typeof value === "string" ? value.trim() : "";
}

function readSelect(state: ViewState, blockId: string): string {
  return state.values[blockId]?.value?.selected_option?.value ?? "";
}

function readConversation(state: ViewState, blockId: string): string {
  const value = state.values[blockId]?.value as { selected_conversation?: string } | undefined;
  return value?.selected_conversation ?? "";
}

/** The value of the first block action, when it carries one (buttons do). */
function actionValue(body: BlockAction): string {
  const action = body.actions[0];
  return action && "value" in action ? (action.value ?? "") : "";
}

function logBackgroundError(label: string, error: unknown): void {
  process.stderr.write(`[slack] ${label}: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
}

function runInBackground(label: string, task: Promise<void>): void {
  void task.catch((error) => logBackgroundError(label, error));
}

function runJobInBackground(
  label: string,
  client: WebClient,
  jobId: string,
  task: () => Promise<void>,
): void {
  if (activeJobs.has(jobId)) {
    const job = getJob(jobId);
    if (job) {
      runInBackground(
        `${label} busy notice`,
        postMessageWithAutoJoin(client, {
          channel: job.channel,
          thread_ts: job.threadTs ?? job.messageTs,
          text: ":hourglass_flowing_sand: I’m already updating this reel. Try the next revision when this one is ready.",
        }).then(() => undefined),
      );
    }
    return;
  }
  activeJobs.add(jobId);
  runInBackground(label, task().finally(() => activeJobs.delete(jobId)));
}

/** Honest phase copy for each named model stage while it runs. */
const STAGE_PHASES: Record<string, string> = {
  "frame-design": "Choosing a visual direction…",
  "storyboard-plan": "Shaping the story beats…",
  "source-author": "Building the HyperFrames composition…",
};

/**
 * One live "Building…" view per run: model-stage pulses, MCP tool steps, and a
 * 5s ticker all render the SAME message through one serialized writer, so the
 * countdown stays fresh for the whole build (the old heartbeat died at the
 * first progress step and the old copy showed climbing elapsed seconds, which
 * reads as "stuck" to anyone watching a multi-minute generation).
 */
class BuildingView {
  private readonly steps = new Map<McpToolName, ThinkingStep>();
  private phase = "Gathering the launch details…";
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  private writing: Promise<void> = Promise.resolve();
  private readonly client: WebClient;
  private readonly channel: string;
  private readonly messageTs: string;
  private readonly title: string;
  private readonly tracker: EtaTracker;

  constructor(
    client: WebClient,
    channel: string,
    messageTs: string,
    title: string,
    tracker: EtaTracker,
  ) {
    this.client = client;
    this.channel = channel;
    this.messageTs = messageTs;
    this.title = title;
    this.tracker = tracker;
    this.timer = setInterval(() => this.render(), 5_000);
  }

  /** Model-stage pulse (frame-design / storyboard-plan / source-author). */
  onStage(stage: string, phase: "started" | "completed", durationMs?: number): void {
    if (phase === "started") {
      this.tracker.start(stage);
      this.phase = STAGE_PHASES[stage] ?? this.phase;
    } else {
      this.tracker.complete(stage, durationMs);
    }
    this.render();
  }

  /** MCP tool step (submit/preview/render/…): the visible Thinking-Steps trace. */
  onProgress(progress: OrchestratorProgress): void {
    const previous = this.steps.get(progress.tool);
    if (progress.phase === "started") {
      this.tracker.start(progress.tool);
      this.steps.set(progress.tool, {
        tool: progress.tool,
        state: "running",
        quality: progress.quality ?? previous?.quality,
      });
    } else {
      this.tracker.complete(progress.tool, progress.receipt?.durationMs);
      this.steps.set(progress.tool, {
        tool: progress.tool,
        state: progress.receipt?.status ?? "succeeded",
        durationMs: progress.receipt?.durationMs,
        quality: progress.quality ?? previous?.quality,
      });
    }
    this.render();
  }

  /** Idempotent; the final storyboard/result update replaces this view. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private render(): void {
    if (this.stopped) return;
    const eta = this.tracker.label();
    const blocks = this.steps.size
      ? thinkingStepsBlocks(this.title, [...this.steps.values()], eta)
      : buildingBlocks(this.title, `${this.phase} · ${eta}`);
    // Serialize chat.update calls so a slow write can't be overtaken by a
    // newer one and then land stale.
    this.writing = this.writing.then(() =>
      safeUpdate(this.client, {
        channel: this.channel,
        ts: this.messageTs,
        blocks,
        text: `Building “${this.title}”…`,
      }));
  }
}

async function safeUpdate(
  client: WebClient,
  args: Parameters<WebClient["chat"]["update"]>[0],
): Promise<void> {
  try {
    await client.chat.update(args);
  } catch (error) {
    logBackgroundError("chat.update failed", error);
  }
}

async function safeNotify(
  notify: ((message: string) => Promise<void>) | undefined,
  error: unknown,
): Promise<void> {
  if (!notify) return;
  try {
    await notify(userFacingSlackError(error));
  } catch (notifyError) {
    logBackgroundError("failure notification failed", notifyError);
  }
}

function dest(channel: string, threadTs?: string) {
  return threadTs ? { channel_id: channel, thread_ts: threadTs } : { channel_id: channel };
}

/** Tier 1: upload the storyboard thumbnails (the instant, near-zero-cost preview). */
async function uploadThumbnails(
  client: WebClient,
  channel: string,
  threadTs: string | undefined,
  thumbnailPaths: string[],
): Promise<void> {
  if (thumbnailPaths.length === 0) return;
  await client.files.uploadV2({
    ...dest(channel, threadTs),
    initial_comment: "Storyboard preview :point_down:",
    file_uploads: thumbnailPaths.map((file) => ({ file, filename: path.basename(file) })),
  });
}

/** Tier 2: upload the rendered MP4 so Slack plays it inline. */
async function uploadVideo(
  client: WebClient,
  channel: string,
  threadTs: string | undefined,
  mp4Path: string,
  quality: "draft" | "high" = "draft",
): Promise<void> {
  await client.files.uploadV2({
    ...dest(channel, threadTs),
    file: mp4Path,
    filename: path.basename(mp4Path),
    initial_comment: quality === "high"
      ? "HD launch reel — this replaces the draft :point_down:"
      : "Draft launch reel :point_down:",
  });
}

/** Build the result message for a given delivery stage (shared by create + revise). */
function stageBlocks(
  jobId: string,
  title: string,
  result: VideoResult,
  stage: VideoStage,
  renderQuality: "draft" | "high" = "draft",
) {
  return resultBlocks({
    jobId,
    title,
    outline: result.outline,
    lint: result.lint,
    videoStage: stage,
    usedMcp: result.usedMcp,
    toolCalls: result.toolCalls,
    skillsUsed: result.skillsUsed,
    slackMcpTools: result.slackMcpTools,
    slackMcpNote: result.slackMcpNote,
    usedPreset: result.usedPreset,
    fallback: result.fallback ? { stage: result.fallback.stage } : undefined,
    provider: result.provider,
    renderQuality,
    debugStages: isDebugEnabled() ? result.stages : undefined,
    renderEtaLabel: stage === "rendering" ? formatEtaMs(estimateStepMs("render")) : undefined,
    frame: result.frame
      ? { label: result.frame.label, basis: result.frame.basis, brandMatched: result.frame.brandMatched }
      : undefined,
  });
}

/**
 * Attach the job's frame.md design system so the user can read/keep it.
 * Internal selection metadata stays in the canonical file for later model
 * turns; Slack receives a clean, reader-facing copy.
 */
async function uploadFrame(
  client: WebClient,
  channel: string,
  threadTs: string | undefined,
  result: VideoResult,
): Promise<void> {
  if (!result.frame || !fs.existsSync(result.frame.path)) return;
  const frameMd = loadJobFrame(result.projectDir);
  if (!frameMd) return;
  await client.files.uploadV2({
    ...dest(channel, threadTs),
    content: publicFrameMd(frameMd),
    filename: "frame.md",
    initial_comment: `:art: Design system for this video — *${result.frame.label}* (${result.frame.basis}${result.frame.brandMatched ? ", brand-matched" : ""})`,
  });
}

function makeProgressReporter(
  client: WebClient,
  channel: string,
  messageTs: string,
  title: string,
): ProgressCallback {
  const steps = new Map<McpToolName, ThinkingStep>();
  return async (progress: OrchestratorProgress) => {
    const previous = steps.get(progress.tool);
    const next: ThinkingStep = progress.phase === "started"
      ? {
          tool: progress.tool,
          state: "running",
          quality: progress.quality ?? previous?.quality,
        }
      : {
          tool: progress.tool,
          state: progress.receipt?.status ?? "succeeded",
          durationMs: progress.receipt?.durationMs,
          quality: progress.quality ?? previous?.quality,
        };
    steps.set(progress.tool, next);
    await safeUpdate(client, {
      channel,
      ts: messageTs,
      blocks: thinkingStepsBlocks(title, [...steps.values()]),
      text: `Building “${title}”…`,
    });
  };
}

/**
 * Tier 2, shared by create + revise: render the MP4 off the already-posted
 * storyboard, swap the message to its final state, and upload the video. A render
 * host that can't produce an MP4 leaves the thumbnails-only result standing.
 */
async function deliverVideo(
  client: WebClient,
  args: {
    channel: string;
    threadTs?: string;
    messageTs: string;
    jobId: string;
    title: string;
    result: VideoResult;
    notifyFailure?: (message: string) => Promise<void>;
    onProgress?: ProgressCallback;
  },
): Promise<void> {
  const rendered = await renderVideo(args.result.projectDir, {
    preferMcp: args.result.mcpRequested,
    quality: "draft",
    onProgress: args.onProgress,
  });
  // Teach the countdown: fold the real render duration into the persisted EMA.
  for (const call of rendered.toolCalls) {
    if (call.status === "succeeded") recordStepDuration(call.tool, call.durationMs);
  }
  const result = {
    ...args.result,
    mp4Path: rendered.mp4Path,
    usedMcp: args.result.usedMcp || rendered.usedMcp,
    toolCalls: [...args.result.toolCalls, ...rendered.toolCalls],
  };
  const { mp4Path } = rendered;
  updateJob(args.jobId, { status: "ready", mp4Path, renderQuality: "draft" });
  await safeUpdate(client, {
    channel: args.channel,
    ts: args.messageTs,
    blocks: stageBlocks(args.jobId, args.title, result, mp4Path ? "ready" : "unavailable"),
    text: mp4Path ? `“${args.title}” is ready` : `“${args.title}” storyboard ready`,
  });
  if (!mp4Path) return;
  try {
    await uploadVideo(client, args.channel, args.threadTs, mp4Path);
  } catch (error) {
    logBackgroundError("video upload failed", error);
    await safeNotify(args.notifyFailure, error);
    await postMessageWithAutoJoin(client, {
      channel: args.channel,
      thread_ts: args.threadTs ?? args.messageTs,
      text: `:warning: The video rendered, but Slack could not upload it. ${userFacingSlackError(error)}`,
    }).catch((postError) => logBackgroundError("video warning failed", postError));
  }
}

/* ------------------------------------------------------------- create flow */

interface CreateArgs {
  channel: string;
  threadTs?: string;
  teamId?: string;
  userId?: string;
  product: string;
  brandName?: string;
  whatShipped: string;
  audience?: string;
  tone?: Tone;
  lengthSec?: number;
  context?: string;
  /** Deterministic demo path: skip the planning brain, apply this plan directly. */
  presetPlan?: CreateVideoOptions["presetPlan"];
  /** Ephemeral response or DM used when no channel message could be created. */
  notifyFailure?: (message: string) => Promise<void>;
}

async function runCreate(client: WebClient, args: CreateArgs): Promise<void> {
  let userToken: string | undefined;
  if (!args.presetPlan) {
    if (args.teamId && args.userId) {
      userToken = getSlackUserToken(args.teamId, args.userId);
    }
    if (!userToken) {
      const installUrl = slackInstallUrl(args.teamId);
      const message = installUrl
        ? `Connect Sequences to Slack once, then run the command again: ${installUrl}`
        : "Slack MCP authorization is not configured on this deployment. Set PUBLIC_BASE_URL and the Slack OAuth environment variables.";
      if (args.notifyFailure) await args.notifyFailure(message);
      else logBackgroundError("Slack MCP authorization required", message);
      return;
    }
  }

  const jobId = randomUUID();
  let posted: Awaited<ReturnType<WebClient["chat"]["postMessage"]>>;
  try {
    posted = await postMessageWithAutoJoin(client, {
      channel: args.channel,
      thread_ts: args.threadTs,
      blocks: buildingBlocks(args.product),
      text: `Building “${args.product}”…`,
    });
  } catch (error) {
    logBackgroundError("could not start create flow", error);
    await safeNotify(args.notifyFailure, error);
    return;
  }
  const messageTs = posted.ts as string;
  const view = new BuildingView(
    client,
    args.channel,
    messageTs,
    args.product,
    new EtaTracker(args.presetPlan ? ["submit_plan", "render_preview"] : CREATE_STEPS),
  );
  const onProgress: ProgressCallback = (progress) => view.onProgress(progress);

  createJob({
    id: jobId,
    projectDir: "",
    channel: args.channel,
    threadTs: args.threadTs,
    messageTs,
    status: "building",
    title: args.product,
  });

  // Context plane: search Slack through Slack's hosted MCP server with the
  // invoking user's permissions. The deterministic demo deliberately skips it.
  let enrichedContext = args.context;
  let slackMcpTools: string[] | undefined;
  let slackMcpNote: string | undefined;
  if (userToken) {
    try {
      const workspace = await retrieveSlackMcpContext({
        userToken,
        product: args.product,
        whatShipped: args.whatShipped,
        extraContext: args.context,
      });
      enrichedContext = [
        args.context,
        "Verified workspace context retrieved through Slack's hosted MCP server:",
        workspace.text,
      ].filter(Boolean).join("\n\n");
      slackMcpTools = workspace.toolsCalled;
    } catch (error) {
      // Workspace context is an enrichment, not a prerequisite. A transient
      // hosted-MCP/OpenAI fault (already retried inside the retriever) must never
      // sink the whole build — degrade to the brief the user provided and surface
      // a visible, non-blocking note instead of failing the video.
      logBackgroundError("Slack workspace context retrieval failed; building without it", error);
      slackMcpNote =
        "Couldn’t reach Slack’s hosted MCP for workspace context — built from the details you provided. Run `/sequences` again to include verified context.";
    }
  }

  // Execution plane: direct HyperFrames authoring + MCP validation/checkpointing
  // + thumbnails, then MP4. The preset demo keeps the frozen Plan path.
  let result: VideoResult;
  try {
    result = await createVideo({
      jobId,
      product: args.product,
      brandName: args.brandName ?? args.product,
      whatShipped: args.whatShipped,
      audience: args.audience,
      tone: args.tone,
      lengthSec: args.lengthSec,
      context: enrichedContext,
      presetPlan: args.presetPlan,
      render: false,
      onProgress,
      onStageProgress: (stage, phase, durationMs) => view.onStage(stage, phase, durationMs),
    });
    result.slackMcpTools = slackMcpTools;
    result.slackMcpNote = slackMcpNote;
  } catch (error) {
    view.stop();
    updateJob(jobId, { status: "error" });
    await safeUpdate(client, {
      channel: args.channel,
      ts: messageTs,
      blocks: errorBlocks(args.product, error instanceof Error ? error.message : String(error)),
      text: `Couldn’t build “${args.product}”`,
    });
    return;
  }
  // Authoring finished (success) — the storyboard update replaces the live view.
  view.stop();

  updateJob(jobId, { status: "building", projectDir: result.projectDir });
  await safeUpdate(client, {
    channel: args.channel,
    ts: messageTs,
    blocks: stageBlocks(jobId, args.product, result, "rendering"),
    text: `“${args.product}” storyboard ready`,
  });
  try {
    await uploadThumbnails(client, args.channel, args.threadTs, result.thumbnailPaths);
    await uploadFrame(client, args.channel, args.threadTs, result);
  } catch (error) {
    logBackgroundError("thumbnail upload failed", error);
    await safeNotify(args.notifyFailure, error);
  }

  // Tier 2: render the MP4 asynchronously, then update the message + upload it.
  await deliverVideo(client, {
    channel: args.channel,
    threadTs: args.threadTs,
    messageTs,
    jobId,
    title: args.product,
    result,
    notifyFailure: args.notifyFailure,
    onProgress,
  });
}

/* ------------------------------------------------------------- revise flow */

async function runRevise(client: WebClient, jobId: string, instruction: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !job.projectDir) return;

  let posted: Awaited<ReturnType<WebClient["chat"]["postMessage"]>>;
  try {
    posted = await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: job.threadTs ?? job.messageTs,
      text: `Revising “${job.title}”: ${instruction}`,
    });
  } catch (error) {
    logBackgroundError("could not start revise flow", error);
    return;
  }

  const messageTs = posted.ts as string;
  const threadTs = job.threadTs ?? job.messageTs;
  const view = new BuildingView(
    client,
    job.channel,
    messageTs,
    job.title,
    new EtaTracker(REVISE_STEPS),
  );
  const onProgress: ProgressCallback = (progress) => view.onProgress(progress);
  updateJob(jobId, { status: "building" });

  // Tier 1: apply the tweak + re-thumbnail (zero-token where the matcher is sure).
  let result: VideoResult;
  try {
    result = await reviseVideo({
      projectDir: job.projectDir,
      instruction,
      render: false,
      onProgress,
    });
  } catch (error) {
    view.stop();
    updateJob(jobId, { status: "ready" });
    await safeUpdate(client, {
      channel: job.channel,
      ts: messageTs,
      blocks: errorBlocks(job.title, error instanceof Error ? error.message : String(error)),
      text: `Couldn’t revise “${job.title}”`,
    });
    return;
  }
  view.stop();

  updateJob(jobId, { status: "building" });
  await safeUpdate(client, {
    channel: job.channel,
    ts: messageTs,
    blocks: stageBlocks(jobId, job.title, result, "rendering"),
    text: `“${job.title}” storyboard updated`,
  });
  try {
    await uploadThumbnails(client, job.channel, threadTs, result.thumbnailPaths);
  } catch (error) {
    logBackgroundError("revised thumbnail upload failed", error);
  }

  // Tier 2: re-render the MP4, then update the message + upload it.
  await deliverVideo(client, {
    channel: job.channel,
    threadTs,
    messageTs,
    jobId,
    title: job.title,
    result,
    onProgress,
  });
}

/* --------------------------------------------------------------- undo flow */

async function runUndo(client: WebClient, jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !job.projectDir) return;

  let posted: Awaited<ReturnType<WebClient["chat"]["postMessage"]>>;
  try {
    posted = await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: job.threadTs ?? job.messageTs,
      blocks: buildingBlocks(job.title, "Undoing the last change…"),
      text: `Undoing the last change to “${job.title}”…`,
    });
  } catch (error) {
    logBackgroundError("could not start undo flow", error);
    return;
  }

  const messageTs = posted.ts as string;
  const threadTs = job.threadTs ?? job.messageTs;
  const onProgress = makeProgressReporter(client, job.channel, messageTs, job.title);
  updateJob(jobId, { status: "building" });

  // Tier 1: revert the journal + re-thumbnail (deterministic; no model).
  let result: VideoResult;
  try {
    result = await undoVideo(job.projectDir, { render: false, onProgress });
  } catch (error) {
    updateJob(jobId, { status: "ready" });
    await safeUpdate(client, {
      channel: job.channel,
      ts: messageTs,
      blocks: errorBlocks(job.title, error instanceof Error ? error.message : String(error)),
      text: `Couldn’t undo “${job.title}”`,
    });
    return;
  }

  updateJob(jobId, { status: "building" });
  await safeUpdate(client, {
    channel: job.channel,
    ts: messageTs,
    blocks: stageBlocks(jobId, job.title, result, "rendering"),
    text: `“${job.title}” reverted`,
  });
  try {
    await uploadThumbnails(client, job.channel, threadTs, result.thumbnailPaths);
  } catch (error) {
    logBackgroundError("undo thumbnail upload failed", error);
  }

  // Tier 2: re-render the reverted state + upload.
  await deliverVideo(client, {
    channel: job.channel,
    threadTs,
    messageTs,
    jobId,
    title: job.title,
    result,
    onProgress,
  });
}

/* --------------------------------------------------------------- HD flow */

async function runHdRender(client: WebClient, jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !job.projectDir) return;
  if (job.renderQuality === "high" && job.mp4Path) {
    await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: job.threadTs ?? job.messageTs,
      text: ":high_brightness: This reel is already using the HD render.",
    });
    return;
  }

  const posted = await postMessageWithAutoJoin(client, {
    channel: job.channel,
    thread_ts: job.threadTs ?? job.messageTs,
    blocks: buildingBlocks(job.title, "Preparing the HD replacement…"),
    text: `Rendering “${job.title}” in HD…`,
  });
  const messageTs = posted.ts as string;
  const threadTs = job.threadTs ?? job.messageTs;
  const onProgress = makeProgressReporter(client, job.channel, messageTs, job.title);
  updateJob(jobId, { status: "building" });

  const rendered = await renderVideo(job.projectDir, {
    quality: "high",
    onProgress,
  });
  if (!rendered.mp4Path) {
    updateJob(jobId, { status: "ready" });
    await safeUpdate(client, {
      channel: job.channel,
      ts: messageTs,
      blocks: errorBlocks(job.title, "The HD render was unavailable. The existing draft is still safe to share."),
      text: `Couldn’t render “${job.title}” in HD`,
    });
    return;
  }

  updateJob(jobId, {
    status: "ready",
    mp4Path: rendered.mp4Path,
    renderQuality: "high",
  });
  await safeUpdate(client, {
    channel: job.channel,
    ts: messageTs,
    blocks: hdReadyBlocks(jobId, job.title),
    text: `“${job.title}” is ready in HD`,
  });
  try {
    await uploadVideo(client, job.channel, threadTs, rendered.mp4Path, "high");
  } catch (error) {
    logBackgroundError("HD video upload failed", error);
    await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: threadTs ?? messageTs,
      text: `:warning: The HD video rendered, but Slack could not upload it. ${userFacingSlackError(error)}`,
    }).catch((postError) => logBackgroundError("HD warning failed", postError));
  }
}

/* ------------------------------------------------------------- share flow */

async function runShare(client: WebClient, jobId: string, targetChannel: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  if (job.status === "building" || !job.mp4Path) {
    await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: job.threadTs ?? job.messageTs,
      text: ":warning: Nothing current to share yet — wait for the active render to finish.",
    }).catch((error) => logBackgroundError("share-before-ready notice failed", error));
    return;
  }

  try {
    await postMessageWithAutoJoin(client, {
      channel: targetChannel,
      text: `:rocket: *${job.title}* — launch reel`,
    });
    await uploadVideo(client, targetChannel, undefined, job.mp4Path, job.renderQuality ?? "draft");
    await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: job.threadTs ?? job.messageTs,
      text: `:white_check_mark: Shared the “${job.title}” reel to <#${targetChannel}>.`,
    });
  } catch (error) {
    logBackgroundError("share failed", error);
    await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: job.threadTs ?? job.messageTs,
      text: `:warning: Couldn’t share the reel. ${userFacingSlackError(error)}`,
    }).catch((postError) => logBackgroundError("share warning failed", postError));
  }
}

async function handleConversationalReply(
  client: WebClient,
  reply: ThreadReply,
): Promise<boolean> {
  const job = findJobByThread(reply.channel, reply.threadTs);
  if (!job) return false;
  if (!eventDeduper.claim(reply.eventId)) return true;

  if (job.status === "building") {
    await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: reply.threadTs,
      text: ":hourglass_flowing_sand: This reel is still building. Send that revision again once the draft is ready.",
    });
    return true;
  }

  runJobInBackground(
    "in-thread revise",
    client,
    job.id,
    () => runRevise(client, job.id, reply.instruction),
  );
  return true;
}

/* --------------------------------------------------------------- listeners */

app.command("/sequences", async ({ command, ack, client, respond }) => {
  await ack();
  const text = command.text.trim().toLowerCase();

  if (text === "help") {
    await respond({
      response_type: "ephemeral",
      text:
        "*Sequences — from shipped to shown.*\n" +
        "• `/sequences` — open the modal and turn a launch into an on-brand video.\n" +
        "• `/sequences demo` — build a ready-made *Relay v2* launch reel (no setup).\n" +
        "• `/sequences mcp-test` — self-check every service (MCP, render host, Slack, config).\n" +
        "• `/sequences debug on|off` — show/hide the model-stage receipt trail on results.\n" +
        "• *🎬 Make a launch video* message shortcut — draft a video from any message.\n" +
        "• Reply in a reel’s thread to revise it; common tweaks like “shorter” and “warmer” need no model.",
    });
    return;
  }

  if (text === "debug" || text === "debug on" || text === "debug off") {
    if (text !== "debug") setDebugEnabled(text === "debug on");
    const enabled = isDebugEnabled();
    await respond({
      response_type: "ephemeral",
      text: enabled
        ? ":mag: Debug receipts are *on* — result messages will include the model-stage trail (attempts, durations, fallback attribution). `/sequences debug off` to hide."
        : ":mag: Debug receipts are *off* — result messages stay clean. `/sequences debug on` to show the model-stage trail.",
    });
    return;
  }

  if (text === "mcp-test" || text === "check" || text === "doctor") {
    await respond({ response_type: "ephemeral", text: "Running the Sequences self-check… :stethoscope:" });
    runInBackground(
      "/sequences mcp-test",
      (async () => {
        const report = await runDiagnostics({
          client,
          teamId: command.team_id,
          userId: command.user_id,
        });
        await respond({
          response_type: "ephemeral",
          replace_original: false,
          blocks: diagnosticsBlocks(report),
          text: report.healthy ? "Self-check: all core services healthy." : "Self-check: some services need attention.",
        });
      })(),
    );
    return;
  }

  if (text === "demo") {
    // The zero-setup path: a curated, deterministic reel. No modal, no model.
    await respond({ response_type: "ephemeral", text: "Spinning up the *Relay v2* demo reel… :clapper:" });
    runInBackground(
      "/sequences demo",
      runCreate(client, {
        channel: command.channel_id,
        product: DEMO_BRIEF.product,
        brandName: DEMO_BRIEF.brandName,
        whatShipped: DEMO_BRIEF.whatShipped,
        audience: DEMO_BRIEF.audience,
        tone: DEMO_BRIEF.tone,
        lengthSec: DEMO_BRIEF.lengthSec,
        presetPlan: buildDemoPlan,
        notifyFailure: async (message) => {
          await respond({ response_type: "ephemeral", text: message });
        },
      }),
    );
    return;
  }

  await client.views.open({
    trigger_id: command.trigger_id,
    view: buildCreateModal({
      channel: command.channel_id,
      userId: command.user_id,
      teamId: command.team_id,
    }),
  });
});

/** Message shortcut "🎬 Make a launch video": read the whole release thread (the
 * clicked message + its replies) and prefill the modal with it, so the bot acts
 * on the real in-channel context. Falls back to the single message if the thread
 * can't be read (missing scope / not in a thread). */
app.shortcut("make_launch_video", async ({ ack, shortcut, client }) => {
  await ack();
  const s = shortcut as MessageShortcut;
  const threadTs = s.message?.thread_ts ?? s.message_ts;
  let whatShipped = s.message?.text ?? "";
  try {
    const replies = await client.conversations.replies({
      channel: s.channel.id,
      ts: threadTs,
      limit: 50,
    });
    const summary = summarizeThread((replies.messages ?? []) as ThreadMessage[]);
    if (summary) whatShipped = summary;
  } catch (error) {
    logBackgroundError("thread read failed; using single message", error);
  }
  await client.views.open({
    trigger_id: s.trigger_id,
    view: buildCreateModal({
      channel: s.channel.id,
      threadTs,
      userId: s.user.id,
      teamId: s.team?.id,
      whatShipped,
    }),
  });
});

app.view("create_video", async ({ ack, view, client }) => {
  await ack();
  const meta = JSON.parse(view.private_metadata || "{}") as {
    channel?: string;
    threadTs?: string;
    userId?: string;
    teamId?: string;
  };
  const state = view.state;
  const lengthValue = Number(readSelect(state, "length"));
  runInBackground(
    "create modal",
    runCreate(client, {
      channel: meta.channel ?? "",
      threadTs: meta.threadTs,
      teamId: meta.teamId,
      userId: meta.userId,
      product: readInput(state, "product") || "Untitled launch",
      whatShipped: readInput(state, "what_shipped"),
      audience: readInput(state, "audience") || undefined,
      tone: (readSelect(state, "tone") as Tone) || undefined,
      lengthSec: Number.isFinite(lengthValue) && lengthValue > 0 ? lengthValue : undefined,
      context: readInput(state, "context") || undefined,
      notifyFailure: meta.userId
        ? async (message) => {
            await client.chat.postMessage({ channel: meta.userId!, text: message });
          }
        : undefined,
    }),
  );
});

app.action("revise_open", async ({ ack, body, client }) => {
  await ack();
  const jobId = actionValue(body as BlockAction);
  await client.views.open({
    trigger_id: (body as BlockAction).trigger_id,
    view: buildReviseModal(jobId),
  });
});

app.view("revise_video", async ({ ack, view, client }) => {
  await ack();
  const meta = JSON.parse(view.private_metadata || "{}") as { jobId?: string };
  const instruction = readInput(view.state, "instruction");
  if (meta.jobId && instruction) {
    runJobInBackground(
      "revise modal",
      client,
      meta.jobId,
      () => runRevise(client, meta.jobId!, instruction),
    );
  }
});

app.action("undo_apply", async ({ ack, body, client }) => {
  await ack();
  const jobId = actionValue(body as BlockAction);
  if (jobId) {
    runJobInBackground("undo", client, jobId, () => runUndo(client, jobId));
  }
});

app.action("render_hd", async ({ ack, body, client }) => {
  await ack();
  const jobId = actionValue(body as BlockAction);
  if (jobId) {
    runJobInBackground("HD render", client, jobId, () => runHdRender(client, jobId));
  }
});

app.action("approve_open", async ({ ack, body, client }) => {
  await ack();
  const jobId = actionValue(body as BlockAction);
  await client.views.open({
    trigger_id: (body as BlockAction).trigger_id,
    view: buildShareModal(jobId),
  });
});

app.view("share_video", async ({ ack, view, client }) => {
  await ack();
  const meta = JSON.parse(view.private_metadata || "{}") as { jobId?: string };
  const channel = readConversation(view.state, "channel");
  if (meta.jobId && channel) {
    runInBackground("share", runShare(client, meta.jobId, channel));
  }
});

app.message(async ({ message, client }) => {
  if (message.subtype !== undefined && message.subtype !== "thread_broadcast") return;
  const reply = parseThreadReply(message as GenericMessageEvent, botUserId);
  if (reply) await handleConversationalReply(client, reply);
});

app.event("app_mention", async ({ event, client, say }) => {
  if (event.thread_ts) {
    const instruction = event.text.replace(botUserId ? new RegExp(`<@${botUserId}>`, "g") : /<@[^>]+>/g, "").trim();
    if (instruction) {
      const handled = await handleConversationalReply(client, {
        channel: event.channel,
        threadTs: event.thread_ts,
        eventId: `${event.channel}:${event.ts}`,
        instruction,
      });
      if (handled) return;
    }
  }
  await say("Sequences is online. Run `/sequences` to turn a launch into a video.");
});

/**
 * A container swap (deploy), crash, or OOM kills any in-flight background job:
 * its promise dies with the process, but `jobs.json` still says "building" and
 * its Slack message is frozen on "Drafting a launch reel…" forever, because the
 * new container never looks at it. On boot, every job still marked "building" is
 * by definition orphaned — replace the freeze with a clear, retryable error.
 */
async function recoverInterruptedJobs(client: WebClient): Promise<void> {
  const orphaned = listJobs().filter((job) => job.status === "building");
  for (const job of orphaned) {
    updateJob(job.id, { status: "error" });
    if (!job.messageTs) continue;
    await safeUpdate(client, {
      channel: job.channel,
      ts: job.messageTs,
      blocks: errorBlocks(
        job.title,
        "This job stopped because the bot restarted (a deploy or crash) while it was building. " +
          "Nothing was lost on your end — just run the command again.",
      ),
      text: `“${job.title}” was interrupted by a restart — please re-run`,
    });
  }
  if (orphaned.length > 0) {
    console.log(`Recovered ${orphaned.length} job(s) interrupted by a restart.`);
  }
}

// Never let a stray async rejection or thrown error take the process down: a
// crash here means Railway restarts the container, which orphans every in-flight
// job. Log and stay up; recoverInterruptedJobs cleans up anything truly lost.
process.on("unhandledRejection", (reason) => logBackgroundError("unhandledRejection", reason));
process.on("uncaughtException", (error) => logBackgroundError("uncaughtException", error));

const auth = await app.client.auth.test();
botUserId = typeof auth.user_id === "string" ? auth.user_id : undefined;
await app.start();
console.log("⚡ Sequences for Slack is running (Socket Mode). Try /sequences");

// Recover interrupted jobs in the background, NOT inline. start.ts marks the
// /healthz endpoint ready only after this module finishes evaluating, and a
// restart can leave many orphaned "building" jobs whose chat.update calls get
// rate-limited (429) — awaiting that here can blow past Railway's health-check
// timeout and roll the new deploy back as "failed". Socket Mode is already
// connected and serving, so readiness should not wait on cleanup. Contained so
// a failure can't take the process (and every in-flight job) down with it.
void recoverInterruptedJobs(app.client as WebClient).catch((error) =>
  logBackgroundError("recoverInterruptedJobs failed", error),
);
