/**
 * Block Kit builders - the Slack-native UI. Kept declarative + typed against
 * @slack/bolt so the modal and result message stay valid Block Kit.
 */
import type { KnownBlock, View } from "@slack/types";
import type {
  McpToolName,
  OrchestratorProgress,
  StageReceipt,
  Tone,
  ToolCallReceipt,
} from "./orchestrator.ts";
import type { CheckStatus, DiagnosticsReport } from "./diagnostics.ts";
import type { LedgerStatus } from "./engine/runner/attemptLedger.ts";

export interface ModalContext {
  channel: string;
  threadTs?: string;
  teamId?: string;
  /** Used only to DM a startup error when the bot cannot post in the channel. */
  userId?: string;
  /** Prefill the "what shipped" field (e.g. from a thread the user invoked on). */
  whatShipped?: string;
  product?: string;
}

const TONE_OPTIONS: Array<{ value: Tone; label: string }> = [
  { value: "crisp-saas", label: "Crisp & precise - dev tools / B2B" },
  { value: "warm-startup", label: "Warm & friendly - startup" },
  { value: "bold-launch", label: "Bold & high-energy - launch" },
];

const LENGTH_OPTIONS = [15, 20, 25, 30, 45, 60];

function plain(text: string) {
  return { type: "plain_text" as const, text, emoji: true };
}

function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function codeBlock(text: string): string {
  return "```\n" + text.replaceAll("```", "'''").slice(0, 2_500) + "\n```";
}

const STATUS_ICON: Record<CheckStatus, string> = {
  ok: ":white_check_mark:",
  warn: ":warning:",
  fail: ":x:",
};

/** Render a `/sequences mcp-test` self-check report as a compact Block Kit board. */
export function diagnosticsBlocks(report: DiagnosticsReport): KnownBlock[] {
  const headline = report.healthy
    ? ":white_check_mark: *All core services healthy* - good to continue."
    : ":x: *Some core services need attention.*";
  const lines = report.checks
    .map((check) => `${STATUS_ICON[check.status]} *${escapeMrkdwn(check.label)}* - ${escapeMrkdwn(check.detail)}`)
    .join("\n");
  return [
    { type: "header", text: plain("Sequences self-check") },
    { type: "section", text: { type: "mrkdwn", text: headline } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: lines } },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "Run `/sequences demo` for a full end-to-end render smoke." }],
    },
  ];
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
      teamId: ctx.teamId,
    }),
    title: plain("Make a launch video"),
    submit: plain("Create"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            ":clapper: *Turn your launch into a short, on-brand video.*\n" +
            "Give me the essentials. I'll retrieve permission-scoped Slack context, " +
            "build a storyboard and preview, then return the rendered MP4 to the channel.",
        },
      },
      { type: "divider" },
      {
        type: "input",
        block_id: "product",
        label: plain("Product"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          max_length: 80,
          ...(ctx.product ? { initial_value: ctx.product } : {}),
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
          ...(ctx.whatShipped ? { initial_value: ctx.whatShipped } : {}),
          placeholder: plain("A launch brief now becomes a storyboard, preview, and MP4 in Slack"),
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
      { type: "divider" },
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
          initial_option: { text: plain("15 seconds"), value: "15" },
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
          placeholder: plain("Trusted facts, CTA, or constraints not already in Slack"),
        },
      },
    ],
  };
}

/**
 * The `/sequences assets` intake modal. Slash commands can't carry files, so
 * the modal's `file_input` block is how screenshots reach the bot. Kept to
 * two fields — images + notes — because everything else is derived.
 */
export function buildAssetBriefModal(ctx: ModalContext): View {
  return {
    type: "modal",
    callback_id: "asset_brief",
    private_metadata: JSON.stringify({
      channel: ctx.channel,
      userId: ctx.userId,
      teamId: ctx.teamId,
    }),
    title: plain("Capture your brand"),
    submit: plain("Capture"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            ":art: *Show me your product's UI.*\n" +
            "I'll extract your brand truth (accent, canvas tone) and theme every video " +
            "made in this channel with it — plus preview the asset kit in your colors. " +
            "Re-run to replace; `/sequences assets clear` to forget.",
        },
      },
      {
        type: "input",
        block_id: "images",
        label: plain("UI screenshots"),
        element: {
          type: "file_input",
          action_id: "value",
          filetypes: ["png", "jpg", "jpeg", "webp"],
          max_files: 5,
        },
      },
      {
        type: "input",
        block_id: "notes",
        optional: true,
        label: plain("Notes"),
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: 1_000,
          placeholder: plain("Vibe, colors to avoid, product nouns, or other brand constraints"),
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
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: ":pencil2: Describe the change in plain language - I'll re-plan only what's needed and re-render.",
          },
        ],
      },
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

export function buildingBlocks(title: string, note = "Getting the launch details into focus..."): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clapper: *Building "${escapeMrkdwn(title)}"*`,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `:hourglass_flowing_sand: ${escapeMrkdwn(note)}` }],
    },
  ];
}

/** Static handoff shown immediately above the uploaded storyboard images. */
export function storyboardReadyBlocks(
  title: string,
  note = "Storyboard preview below.",
): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:framed_picture: *"${escapeMrkdwn(title)}" storyboard ready*`,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: escapeMrkdwn(note) }],
    },
  ];
}

export interface ThinkingStep {
  tool: McpToolName;
  state: "running" | "succeeded" | "fallback" | "failed";
  durationMs?: number;
  quality?: OrchestratorProgress["quality"];
}

const TOOL_LABELS: Record<McpToolName, string> = {
  submit_composition: "Publish HyperFrames composition",
  submit_plan: "Apply launch plan",
  apply_commands: "Apply revision",
  render_preview: "Render storyboard",
  render: "Render video",
  undo: "Restore previous version",
};

/** Live, incrementally updated work trace shown while the lifecycle is running. */
export function thinkingStepsBlocks(
  title: string,
  steps: ThinkingStep[],
  etaLabel?: string,
): KnownBlock[] {
  const lines = steps.map((step) => {
    const icon =
      step.state === "running"
        ? ":large_blue_circle:"
        : step.state === "succeeded"
          ? ":white_check_mark:"
          : step.state === "fallback"
            ? ":twisted_rightwards_arrows:"
            : ":x:";
    const suffix =
      step.state === "running"
        ? "running..."
        : step.state === "fallback"
          ? `local fallback${step.durationMs !== undefined ? ` - ${step.durationMs}ms` : ""}`
          : step.state === "failed"
            ? "unavailable"
            : step.durationMs !== undefined
              ? `${step.durationMs}ms`
              : "done";
    const quality = step.tool === "render" && step.quality ? ` (${step.quality})` : "";
    return `${icon} \`${step.tool}\` - ${TOOL_LABELS[step.tool]}${quality} - ${suffix}`;
  });
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:sparkles: *Thinking steps for "${escapeMrkdwn(title)}"*\n${lines.join("\n")}`,
      },
    },
    ...(etaLabel
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: `:stopwatch: ${etaLabel}` }],
        }]
      : []),
  ];
}

/**
 * The two-tier delivery stages, in order:
 *  - `rendering`    - storyboard + thumbnails are up; the MP4 is still rendering.
 *  - `ready`        - the draft MP4 has been uploaded below.
 *  - `unavailable`  - render host couldn't produce the MP4; thumbnails stand.
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
  slackMcpTools?: string[];
  /** Non-blocking note shown when hosted-MCP context was skipped. */
  slackMcpNote?: string;
  /** True when the plan came from the curated demo preset (no creative author). */
  usedPreset?: boolean;
  /**
   * Present when this result is the deterministic safe fallback because a
   * named model stage failed. Only the stage name is shown — never model
   * output or error content.
   */
  fallback?: { stage: string; reason?: string };
  provider: string;
  renderQuality?: "draft" | "high";
  /**
   * Demo-operator receipts (`/sequences debug on`): the model-stage trail with
   * attempt counts. Argument-free by construction — stage names, statuses,
   * attempts, durations only.
   */
  debugStages?: StageReceipt[];
  /** Honest runtime/quality axes folded from the create attempt ledger. */
  ledgerStatus?: LedgerStatus;
  /** Countdown shown on the "rendering" headline (e.g. "~60s remaining"). */
  renderEtaLabel?: string;
  /** The per-job frame.md design system chosen for this video, if any. */
  frame?: {
    label: string;
    basis: "light" | "dark";
    brandMatched: boolean;
  };
}

export function resultBlocks(view: ResultView): KnownBlock[] {
  const title = escapeMrkdwn(view.title);
  const headline =
    view.videoStage === "ready"
      ? `:movie_camera: *"${title}" is ready* - draft below.`
      : view.videoStage === "unavailable"
        ? `:movie_camera: *"${title}" - storyboard ready.* Couldn't render the video on this host; thumbnails above.`
        : `:hourglass_flowing_sand: *"${title}" - storyboard ready.* Rendering the video...${
            view.renderEtaLabel ? ` (${view.renderEtaLabel})` : ""
          }`;
  const path = view.usedMcp ? "through an MCP-first lifecycle" : "through the in-process engine";
  const planned = view.usedPreset
    ? `curated demo plan ${path}`
    : view.fallback
      ? `deterministic safe fallback ${path} (model \`${escapeMrkdwn(view.fallback.stage)}\` stage failed)`
      : `authored by \`${view.provider}\` ${path}`;
  const fallbackNotice = view.fallback
    ? `:twisted_rightwards_arrows: *Safe fallback* - the \`${escapeMrkdwn(view.fallback.stage)}\` ` +
      "stage failed, so this is the deterministic proof film, not a model-authored cut. " +
      `Job ID: \`${escapeMrkdwn(view.jobId)}\`. Run \`/sequences\` again or reply here to retry.` +
      (view.fallback.reason ? `\n*Mechanical failure*\n${codeBlock(view.fallback.reason)}` : "")
    : "";
  const buildTrace = (view.toolCalls ?? [])
    .map((call) => {
      const mark =
        call.status === "succeeded" ? "ok" : call.status === "fallback" ? "local fallback" : "unavailable";
      return `\`${call.tool}\` ${mark} ${call.durationMs}ms`;
    })
    .join("  -  ");
  const debugTrace = (view.debugStages ?? [])
    .map((stage) => {
      const mark = stage.status === "succeeded" ? ":white_check_mark:" : ":x:";
      const attempts =
        stage.attempts !== undefined && stage.attempts > 1 ? ` · ${stage.attempts} attempts` : "";
      return `${mark} \`${stage.stage}\`${attempts} · ${Math.round(stage.durationMs / 100) / 10}s`;
    })
    .join("\n");
  const skillReceipt = (view.skillsUsed ?? []).map((name) => `\`/${name}\``).join(" - ");
  const slackReceipt = (view.slackMcpTools ?? []).map((name) => `\`${name}\``).join(" - ");
  const frameReceipt = view.frame
    ? `*Design system*  -  \`${escapeMrkdwn(view.frame.label)}\` (${view.frame.basis}) - ${
        view.frame.brandMatched ? "brand-matched palette + type" : "house preset"
      } - frame.md attached`
    : "";
  const ledgerReceipt = view.ledgerStatus
    ? `*Ledger status*  -  runtimeValid: \`${view.ledgerStatus.runtimeValid}\`  -  ` +
      `qualityResidue: \`${view.ledgerStatus.qualityResidue}\`  -  disposition: \`${view.ledgerStatus.disposition}\`` +
      (view.ledgerStatus.degradedAxes.length
        ? `  -  degraded axes: \`${view.ledgerStatus.degradedAxes.join(", ")}\``
        : "")
    : "";
  return [
    { type: "section", text: { type: "mrkdwn", text: headline } },
    ...(fallbackNotice
      ? [{
          type: "section" as const,
          text: { type: "mrkdwn" as const, text: fallbackNotice },
        }]
      : []),
    { type: "section", text: { type: "mrkdwn", text: `:clipboard: *Storyboard*\n${codeBlock(view.outline)}` } },
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${view.lint}  -  ${planned}  -  job \`${escapeMrkdwn(view.jobId)}\``,
        },
      ],
    },
    ...(buildTrace
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: `*Build trace*  -  ${buildTrace}` }],
        }]
      : []),
    ...(ledgerReceipt
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: ledgerReceipt }],
        }]
      : []),
    ...(debugTrace
      ? [{
          type: "section" as const,
          text: {
            type: "mrkdwn" as const,
            text: `:mag: *Debug — model stage receipts* (\`/sequences debug off\` to hide)\n${debugTrace}`,
          },
        }]
      : []),
    ...(frameReceipt
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: frameReceipt }],
        }]
      : []),
    ...(skillReceipt
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: `*Agent context*  -  ${skillReceipt}` }],
        }]
      : []),
    ...(slackReceipt
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: `*Slack context (hosted MCP)*  -  ${slackReceipt}` }],
        }]
      : []),
    ...(view.slackMcpNote
      ? [{
          type: "context" as const,
          elements: [{ type: "mrkdwn" as const, text: `:information_source: ${view.slackMcpNote}` }],
        }]
      : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ':left_speech_bubble: Reply in this thread to revise - try "make it shorter", "warmer", or "punchier".',
        },
      ],
    },
    { type: "divider" },
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
        // Sharing a not-yet-rendered reel would be a lie; offer it only when ready.
        ...(view.videoStage === "ready"
          ? [
              ...(view.renderQuality === "high"
                ? []
                : [{
                    type: "button" as const,
                    action_id: "render_hd",
                    text: plain("Render HD"),
                    value: view.jobId,
                  }]),
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

/** Compact completion state for an HD replacement render. */
export function hdReadyBlocks(jobId: string, title: string): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:high_brightness: *"${escapeMrkdwn(title)}" is ready in HD.* Future shares use this version.`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "revise_open",
          text: plain("Revise"),
          value: jobId,
        },
        {
          type: "button",
          action_id: "approve_open",
          style: "primary",
          text: plain("Approve & share"),
          value: jobId,
        },
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
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: ":rocket: Posts the finished reel as a new message in the channel you choose.",
          },
        ],
      },
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

export function errorBlocks(title: string, message: string, jobId?: string): KnownBlock[] {
  const receipt = jobId ? `\nJob ID: \`${escapeMrkdwn(jobId)}\`` : "";
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *Couldn't build "${escapeMrkdwn(title)}"*${receipt}\n${codeBlock(message)}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ":arrows_counterclockwise: Nothing was changed. Fix the issue above and run `/sequences` again, or `/sequences mcp-test` to check services.",
        },
      ],
    },
  ];
}
