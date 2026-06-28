import type { ChatPostMessageArguments, WebClient } from "@slack/web-api";

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
    if (slackErrorCode(error) !== "not_in_channel") throw error;
  }

  try {
    await client.conversations.join({ channel: args.channel });
  } catch (error) {
    throw new ChannelAccessError(args.channel, error);
  }

  try {
    return await client.chat.postMessage(args);
  } catch (error) {
    if (slackErrorCode(error) === "not_in_channel") {
      throw new ChannelAccessError(args.channel, error);
    }
    throw error;
  }
}

/** A concise recovery instruction suitable for an ephemeral message or DM. */
export function userFacingSlackError(error: unknown): string {
  if (error instanceof ChannelAccessError) return error.message;
  const code = slackErrorCode(error);
  if (code === "missing_scope") {
    return (
      "Sequences is missing a Slack permission. Update the app from `manifest.json`, " +
      "reinstall it to the workspace, refresh `SLACK_BOT_TOKEN`, and retry."
    );
  }
  return `Sequences couldn’t start this request${code ? ` (Slack: \`${code}\`)` : ""}. Check the app logs and retry.`;
}
