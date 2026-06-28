import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { App } from "@slack/bolt";
import type { BlockAction, MessageShortcut, ViewSubmitAction } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import {
  buildCreateModal,
  buildReviseModal,
  buildShareModal,
  buildingBlocks,
  errorBlocks,
  resultBlocks,
  type VideoStage,
} from "./blocks.ts";
import {
  createVideo,
  renderVideo,
  reviseVideo,
  undoVideo,
  type CreateVideoOptions,
  type Tone,
  type VideoResult,
} from "./orchestrator.ts";
import { DEMO_BRIEF, buildDemoPlan } from "./demo.ts";
import { createJob, getJob, updateJob } from "./jobStore.ts";
import {
  postMessageWithAutoJoin,
  userFacingSlackError,
} from "./slackApi.ts";
import { summarizeThread, type ThreadMessage } from "./thread.ts";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
if (!botToken) throw new Error("Missing SLACK_BOT_TOKEN in .env");
if (!appToken) throw new Error("Missing SLACK_APP_TOKEN in .env");

const app = new App({ token: botToken, appToken, socketMode: true });

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
): Promise<void> {
  await client.files.uploadV2({
    ...dest(channel, threadTs),
    file: mp4Path,
    filename: path.basename(mp4Path),
    initial_comment: "Draft launch reel :point_down:",
  });
}

/** Build the result message for a given delivery stage (shared by create + revise). */
function stageBlocks(jobId: string, title: string, result: VideoResult, stage: VideoStage) {
  return resultBlocks({
    jobId,
    title,
    outline: result.outline,
    lint: result.lint,
    videoStage: stage,
    usedMcp: result.usedMcp,
    toolCalls: result.toolCalls,
    skillsUsed: result.skillsUsed,
    usedPreset: result.usedPreset,
    provider: result.provider,
  });
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
  },
): Promise<void> {
  const rendered = await renderVideo(args.result.projectDir, {
    preferMcp: args.result.mcpRequested,
  });
  const result = {
    ...args.result,
    mp4Path: rendered.mp4Path,
    usedMcp: args.result.usedMcp || rendered.usedMcp,
    toolCalls: [...args.result.toolCalls, ...rendered.toolCalls],
  };
  const { mp4Path } = rendered;
  updateJob(args.jobId, { status: "ready", mp4Path });
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

  createJob({
    id: jobId,
    projectDir: "",
    channel: args.channel,
    threadTs: args.threadTs,
    messageTs,
    status: "building",
    title: args.product,
  });

  // Tier 1: plan + apply + thumbnails — fast, no MP4 render yet.
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
      context: args.context,
      presetPlan: args.presetPlan,
      render: false,
    });
  } catch (error) {
    updateJob(jobId, { status: "error" });
    await safeUpdate(client, {
      channel: args.channel,
      ts: messageTs,
      blocks: errorBlocks(args.product, error instanceof Error ? error.message : String(error)),
      text: `Couldn’t build “${args.product}”`,
    });
    return;
  }

  updateJob(jobId, { status: "building", projectDir: result.projectDir });
  await safeUpdate(client, {
    channel: args.channel,
    ts: messageTs,
    blocks: stageBlocks(jobId, args.product, result, "rendering"),
    text: `“${args.product}” storyboard ready`,
  });
  try {
    await uploadThumbnails(client, args.channel, args.threadTs, result.thumbnailPaths);
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

  // Tier 1: apply the tweak + re-thumbnail (zero-token where the matcher is sure).
  let result: VideoResult;
  try {
    result = await reviseVideo({ projectDir: job.projectDir, instruction, render: false });
  } catch (error) {
    await safeUpdate(client, {
      channel: job.channel,
      ts: messageTs,
      blocks: errorBlocks(job.title, error instanceof Error ? error.message : String(error)),
      text: `Couldn’t revise “${job.title}”`,
    });
    return;
  }

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

  // Tier 1: revert the journal + re-thumbnail (deterministic; no model).
  let result: VideoResult;
  try {
    result = await undoVideo(job.projectDir, { render: false });
  } catch (error) {
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
  });
}

/* ------------------------------------------------------------- share flow */

async function runShare(client: WebClient, jobId: string, targetChannel: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  if (!job.mp4Path) {
    await postMessageWithAutoJoin(client, {
      channel: job.channel,
      thread_ts: job.threadTs ?? job.messageTs,
      text: ":warning: Nothing to share yet — wait for the video to finish rendering.",
    }).catch((error) => logBackgroundError("share-before-ready notice failed", error));
    return;
  }

  try {
    await postMessageWithAutoJoin(client, {
      channel: targetChannel,
      text: `:rocket: *${job.title}* — launch reel`,
    });
    await uploadVideo(client, targetChannel, undefined, job.mp4Path);
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
        "• *🎬 Make a launch video* message shortcut — draft a video from any message.",
    });
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
    view: buildCreateModal({ channel: command.channel_id, userId: command.user_id }),
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
  };
  const state = view.state;
  const lengthValue = Number(readSelect(state, "length"));
  runInBackground(
    "create modal",
    runCreate(client, {
      channel: meta.channel ?? "",
      threadTs: meta.threadTs,
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
    runInBackground("revise modal", runRevise(client, meta.jobId, instruction));
  }
});

app.action("undo_apply", async ({ ack, body, client }) => {
  await ack();
  const jobId = actionValue(body as BlockAction);
  if (jobId) runInBackground("undo", runUndo(client, jobId));
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

app.event("app_mention", async ({ say }) => {
  await say("Sequences is online. Run `/sequences` to turn a launch into a video.");
});

await app.start();
console.log("⚡ Sequences for Slack is running (Socket Mode). Try /sequences");
