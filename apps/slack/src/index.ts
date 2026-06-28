import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { App } from "@slack/bolt";
import type { BlockAction, MessageShortcut, ViewSubmitAction } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import {
  buildCreateModal,
  buildReviseModal,
  buildingBlocks,
  errorBlocks,
  resultBlocks,
} from "./blocks.ts";
import { createVideo, reviseVideo, type CreateVideoOptions, type Tone } from "./orchestrator.ts";
import { DEMO_BRIEF, buildDemoPlan } from "./demo.ts";
import { createJob, getJob, updateJob } from "./jobStore.ts";
import {
  postMessageWithAutoJoin,
  userFacingSlackError,
} from "./slackApi.ts";

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

/** Upload storyboard thumbnails, then the MP4 when one was rendered. */
async function uploadPreviews(
  client: WebClient,
  channel: string,
  threadTs: string | undefined,
  result: { thumbnailPaths: string[]; mp4Path?: string },
): Promise<void> {
  const dest = threadTs ? { channel_id: channel, thread_ts: threadTs } : { channel_id: channel };
  if (result.thumbnailPaths.length > 0) {
    await client.files.uploadV2({
      ...dest,
      initial_comment: "Storyboard preview :point_down:",
      file_uploads: result.thumbnailPaths.map((file) => ({
        file,
        filename: path.basename(file),
      })),
    });
  }
  if (result.mp4Path) {
    await client.files.uploadV2({
      ...dest,
      file: result.mp4Path,
      filename: path.basename(result.mp4Path),
      initial_comment: "Draft launch reel :point_down:",
    });
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

  try {
    const result = await createVideo({
      jobId,
      product: args.product,
      brandName: args.brandName ?? args.product,
      whatShipped: args.whatShipped,
      audience: args.audience,
      tone: args.tone,
      lengthSec: args.lengthSec,
      context: args.context,
      presetPlan: args.presetPlan,
      render: true,
    });
    updateJob(jobId, { status: "ready", projectDir: result.projectDir, mp4Path: result.mp4Path });

    await safeUpdate(client, {
      channel: args.channel,
      ts: messageTs,
      blocks: resultBlocks({
        jobId,
        title: args.product,
        outline: result.outline,
        lint: result.lint,
        hasVideo: Boolean(result.mp4Path),
        usedMcp: result.usedMcp,
        usedPreset: result.usedPreset,
        provider: result.provider,
      }),
      text: `“${args.product}” is ready`,
    });
    try {
      await uploadPreviews(client, args.channel, args.threadTs, result);
    } catch (error) {
      logBackgroundError("preview upload failed", error);
      await safeNotify(args.notifyFailure, error);
      await postMessageWithAutoJoin(client, {
        channel: args.channel,
        thread_ts: args.threadTs ?? messageTs,
        text: `:warning: The video was built, but Slack could not upload the preview. ${userFacingSlackError(error)}`,
      }).catch((postError) => logBackgroundError("preview warning failed", postError));
    }
  } catch (error) {
    updateJob(jobId, { status: "error" });
    await safeUpdate(client, {
      channel: args.channel,
      ts: messageTs,
      blocks: errorBlocks(args.product, error instanceof Error ? error.message : String(error)),
      text: `Couldn’t build “${args.product}”`,
    });
  }
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

  try {
    const result = await reviseVideo({ projectDir: job.projectDir, instruction, render: true });
    updateJob(jobId, { mp4Path: result.mp4Path, status: "ready" });
    await safeUpdate(client, {
      channel: job.channel,
      ts: posted.ts as string,
      blocks: resultBlocks({
        jobId,
        title: job.title,
        outline: result.outline,
        lint: result.lint,
        hasVideo: Boolean(result.mp4Path),
        usedMcp: result.usedMcp,
        usedPreset: result.usedPreset,
        provider: result.provider,
      }),
      text: `“${job.title}” revised`,
    });
    try {
      await uploadPreviews(client, job.channel, job.threadTs ?? job.messageTs, result);
    } catch (error) {
      logBackgroundError("revised preview upload failed", error);
      await postMessageWithAutoJoin(client, {
        channel: job.channel,
        thread_ts: job.threadTs ?? job.messageTs,
        text: `:warning: The revision was built, but Slack could not upload the preview. ${userFacingSlackError(error)}`,
      }).catch((postError) => logBackgroundError("revision warning failed", postError));
    }
  } catch (error) {
    await safeUpdate(client, {
      channel: job.channel,
      ts: posted.ts as string,
      blocks: errorBlocks(job.title, error instanceof Error ? error.message : String(error)),
      text: `Couldn’t revise “${job.title}”`,
    });
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

/** Message shortcut "🎬 Make a launch video": open the modal prefilled from the
 * clicked message, so the bot acts on context already in the channel (the
 * zero-friction second entry point; full thread reading lands later). */
app.shortcut("make_launch_video", async ({ ack, shortcut, client }) => {
  await ack();
  const s = shortcut as MessageShortcut;
  const messageText = s.message?.text ?? "";
  await client.views.open({
    trigger_id: s.trigger_id,
    view: buildCreateModal({
      channel: s.channel.id,
      threadTs: s.message?.thread_ts ?? s.message_ts,
      userId: s.user.id,
      whatShipped: messageText,
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

app.event("app_mention", async ({ say }) => {
  await say("Sequences is online. Run `/sequences` to turn a launch into a video.");
});

await app.start();
console.log("⚡ Sequences for Slack is running (Socket Mode). Try /sequences");
