import type { ChatPostMessageArguments, WebClient } from "@slack/web-api";

const CHANNEL_ACCESS_CODES = new Set(["not_in_channel", "channel_not_found"]);

/** Read Slack's machine-readable error without coupling callers to SDK classes. */
export function slackErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const code = (data as { error?: unknown }).error;
  return typeof code === "string" ? code : undefined;
}

export class ChannelAccessError extends Error {
  constructor(channel: string, cause?: unknown) {
    super(
      "Sequences can’t post in this channel yet. Run `/invite @Sequences` and retry. " +
        "If you just updated the app manifest, reinstall the app to grant the new " +
        "`channels:join` and `files:write` scopes.",
      { cause },
    );
    this.name = "ChannelAccessError";
    this.channel = channel;
  }

  readonly channel: string;
}

/**
 * Slash commands can be invoked before a bot has joined a public channel.
 * Join once and retry; private channels still require a human invitation.
 */
export async function postMessageWithAutoJoin(
  client: WebClient,
  args: ChatPostMessageArguments,
): ReturnType<WebClient["chat"]["postMessage"]> {
  try {
    return await client.chat.postMessage(args);
  } catch (error) {
    const code = slackErrorCode(error);
    if (code === "channel_not_found") {
      // Slack intentionally hides private channels from bots that have not
      // been invited. conversations.join cannot recover that case.
      throw new ChannelAccessError(args.channel, error);
    }
    if (code !== "not_in_channel") throw error;
  }

  try {
    await client.conversations.join({ channel: args.channel });
  } catch (error) {
    throw new ChannelAccessError(args.channel, error);
  }

  try {
    return await client.chat.postMessage(args);
  } catch (error) {
    if (CHANNEL_ACCESS_CODES.has(slackErrorCode(error) ?? "")) {
      throw new ChannelAccessError(args.channel, error);
    }
    throw error;
  }
}

export interface SlackMessageDelivery {
  channelPosted: boolean;
  dmPosted: boolean;
  channelError?: unknown;
  dmError?: unknown;
}

/**
 * Asset capture is durable work, so a channel notification must never become
 * its transaction boundary. Fall back to an actionable DM and return the
 * delivery evidence instead of throwing either Slack error into the caller.
 */
export async function postMessageWithDmFallback(
  client: WebClient,
  args: ChatPostMessageArguments,
  userId?: string,
): Promise<SlackMessageDelivery> {
  try {
    await postMessageWithAutoJoin(client, args);
    return { channelPosted: true, dmPosted: false };
  } catch (channelError) {
    if (!userId) return { channelPosted: false, dmPosted: false, channelError };
    const originalText = "text" in args && typeof args.text === "string"
      ? args.text
      : "Sequences finished an update.";
    try {
      await client.chat.postMessage({
        channel: userId,
        text: `${originalText}\n\n${userFacingSlackError(channelError)}`,
      });
      return { channelPosted: false, dmPosted: true, channelError };
    } catch (dmError) {
      return { channelPosted: false, dmPosted: false, channelError, dmError };
    }
  }
}

/** A concise recovery instruction suitable for an ephemeral message or DM. */
export function userFacingSlackError(error: unknown): string {
  if (error instanceof ChannelAccessError) return error.message;
  const code = slackErrorCode(error);
  if (CHANNEL_ACCESS_CODES.has(code ?? "")) {
    return new ChannelAccessError("unknown", error).message;
  }
  if (code === "missing_scope") {
    return (
      "Sequences is missing a Slack permission. Update the app from `manifest.json`, " +
      "reinstall it to the workspace, refresh `SLACK_BOT_TOKEN`, and retry."
    );
  }
  return `Sequences couldn’t start this request${code ? ` (Slack: \`${code}\`)` : ""}. Check the app logs and retry.`;
}
