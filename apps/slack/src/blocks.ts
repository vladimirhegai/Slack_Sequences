/**
 * Block Kit builders — the Slack-native UI. Kept declarative + typed against
 * @slack/bolt so the modal and result message stay valid Block Kit.
 */
import type { KnownBlock, View } from "@slack/types";
import type { Tone, ToolCallReceipt } from "./orchestrator.ts";

export interface ModalContext {
  channel: string;
  threadTs?: string;
  /** Used only to DM a startup error when the bot cannot post in the channel. */
  userId?: string;
  /** Prefill the "what shipped" field (e.g. from a thread the user invoked on). */
  whatShipped?: string;
  product?: string;
}

const TONE_OPTIONS: Array<{ value: Tone; label: string }> = [
  { value: "crisp-saas", label: "Crisp & precise — dev tools / B2B" },
  { value: "warm-startup", label: "Warm & friendly — startup" },
  { value: "bold-launch", label: "Bold & high-energy — launch" },
];

const LENGTH_OPTIONS = [15, 30, 45, 60];

function plain(text: string) {
  return { type: "plain_text" as const, text, emoji: true };
}

function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function codeBlock(text: string): string {
  return "```\n" + text.replaceAll("```", "'''").slice(0, 2_500) + "\n```";
}

/** The /sequences create modal. private_metadata carries where to post back. */
export function buildCreateModal(ctx: ModalContext): View {
  return {
    type: "modal",
    callback_id: "create_video",
    private_metadata: JSON.stringify({
      channel: ctx.channel,
      threadTs: ctx.threadTs,
      userId: ctx.userId,
    }),
    title: plain("Make a launch video"),
    submit: plain("Create"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: "product",
        label: plain("Product"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          max_length: 80,
          initial_value: ctx.product ?? "",
          placeholder: plain("Relay"),
        },
      },
      {
        type: "input",
        block_id: "what_shipped",
        label: plain("What shipped / the launch"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: 2_000,
          initial_value: ctx.whatShipped ?? "",
          placeholder: plain("sub-100ms traces, 1-click rollback, 40% faster cold starts"),
        },
      },
      {
        type: "input",
        block_id: "audience",
        optional: true,
        label: plain("Audience"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          max_length: 200,
          placeholder: plain("backend engineers evaluating observability tools"),
        },
      },
      {
        type: "input",
        block_id: "tone",
        label: plain("Tone"),
        element: {
          type: "static_select",
          action_id: "value",
          initial_option: {
            text: plain(TONE_OPTIONS[0]!.label),
            value: TONE_OPTIONS[0]!.value,
          },
          options: TONE_OPTIONS.map((option) => ({
            text: plain(option.label),
            value: option.value,
          })),
        },
      },
      {
        type: "input",
        block_id: "length",
        label: plain("Target length"),
        element: {
          type: "static_select",
          action_id: "value",
          initial_option: { text: plain("30 seconds"), value: "30" },
          options: LENGTH_OPTIONS.map((seconds) => ({
            text: plain(`${seconds} seconds`),
            value: String(seconds),
          })),
        },
      },
      {
        type: "input",
        block_id: "context",
        optional: true,
        label: plain("Extra context"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: 2_000,
          placeholder: plain("Anything else the video should say or show"),
        },
      },
    ],
  };
}

/** The revise modal opened by the Revise button. */
export function buildReviseModal(jobId: string): View {
  return {
    type: "modal",
    callback_id: "revise_video",
    private_metadata: JSON.stringify({ jobId }),
    title: plain("Revise the video"),
    submit: plain("Revise"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: "instruction",
        label: plain("What should change?"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          placeholder: plain("punchier; drop the quote scene; warmer tone; make it shorter"),
        },
      },
    ],
  };
}

export function buildingBlocks(title: string, note = "Drafting a launch reel…"): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clapper: *Building “${escapeMrkdwn(title)}”* — ${escapeMrkdwn(note)}`,
      },
    },
  ];
}

/**
 * The two-tier delivery stages, in order:
 *  - `rendering`    — storyboard + thumbnails are up; the MP4 is still rendering.
 *  - `ready`        — the draft MP4 has been uploaded below.
 *  - `unavailable`  — render host couldn't produce the MP4; thumbnails stand.
 */
export type VideoStage = "rendering" | "ready" | "unavailable";

export interface ResultView {
  jobId: string;
  title: string;
  outline: string;
  lint: string;
  videoStage: VideoStage;
  usedMcp: boolean;
  toolCalls?: ToolCallReceipt[];
  skillsUsed?: string[];
  /** True when the plan came from the curated demo preset (no planning brain). */
  usedPreset?: boolean;
  provider: string;
}

export function resultBlocks(view: ResultView): KnownBlock[] {
  const title = escapeMrkdwn(view.title);
  const headline =
    view.videoStage === "ready"
      ? `:movie_camera: *“${title}” is ready* — draft below.`
      : view.videoStage === "unavailable"
        ? `:movie_camera: *“${title}” — storyboard ready.* Couldn’t render the video on this host; thumbnails above.`
        : `:hourglass_flowing_sand: *“${title}” — storyboard ready.* Rendering the video…`;
  const path = view.usedMcp ? "through an MCP-first lifecycle" : "through the in-process engine";
  const planned = view.usedPreset
    ? `curated demo plan ${path}`
    : `planned by \`${view.provider}\` ${path}`;
  const toolReceipt = (view.toolCalls ?? [])
    .map((call) => {
      const mark =
        call.status === "succeeded" ? "✓" : call.status === "fallback" ? "↪ local fallback" : "✕ unavailable";
      return `\`${call.tool}\` ${mark} ${call.durationMs}ms`;
    })
    .join("  ·  ");
  const skillReceipt = (view.skillsUsed ?? []).map((name) => `\`/${name}\``).join(" · ");
  return [
    { type: "section", text: { type: "mrkdwn", text: headline } },
    { type: "section", text: { type: "mrkdwn", text: codeBlock(view.outline) } },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `${view.lint}  ·  ${planned}` },
      ],
    },
    ...(toolReceipt
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: `*MCP tool receipt*  ·  ${toolReceipt}` }],
        }]
      : []),
    ...(skillReceipt
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: `*Agent context*  ·  ${skillReceipt}` }],
        }]
      : []),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "revise_open",
          text: plain("Revise"),
          value: view.jobId,
        },
        {
          type: "button",
          action_id: "undo_apply",
          text: plain("Undo"),
          value: view.jobId,
        },
        // Sharing a not-yet-rendered reel would be a lie — offer it only when ready.
        ...(view.videoStage === "ready"
          ? [
              {
                type: "button" as const,
                action_id: "approve_open",
                style: "primary" as const,
                text: plain("Approve & share"),
                value: view.jobId,
              },
            ]
          : []),
      ],
    },
  ];
}

/** The "Approve & share" modal: pick a channel to post the finished reel into. */
export function buildShareModal(jobId: string): View {
  return {
    type: "modal",
    callback_id: "share_video",
    private_metadata: JSON.stringify({ jobId }),
    title: plain("Approve & share"),
    submit: plain("Share"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: "channel",
        label: plain("Post the launch reel to"),
        element: {
          type: "conversations_select",
          action_id: "value",
          default_to_current_conversation: true,
          placeholder: plain("Pick a channel"),
        },
      },
    ],
  };
}

export function errorBlocks(title: string, message: string): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *Couldn’t build “${escapeMrkdwn(title)}”*\n${codeBlock(message)}`,
      },
    },
  ];
}
