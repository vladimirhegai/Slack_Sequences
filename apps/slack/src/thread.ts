/**
 * Turn a Slack thread (the release announcement + its replies) into a compact
 * brief the planner can use. Pure + deterministic so it is unit-testable without
 * a live workspace. The Slack host fetches the messages (`conversations.replies`)
 * and hands them here; we keep only human prose, in order, within a budget.
 */
export interface ThreadMessage {
  user?: string;
  text?: string;
  /** Present on messages posted by a bot/app (including our own posts). */
  bot_id?: string;
  /** Join/leave and other system messages carry a subtype we skip. */
  subtype?: string;
}

export interface SummarizeThreadOptions {
  /** Drop messages from this user id (the bot's own user), belt-and-suspenders. */
  botUserId?: string;
  maxChars?: number;
}

/** Strip Slack control sequences and collapse whitespace to one line. */
function clean(text: string): string {
  return text
    .replace(/<!(here|channel|everyone)>/g, "")
    .replace(/<@[^>]+>/g, "")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2") // <url|label> -> label
    .replace(/<([^>]+)>/g, "$1") // <url> -> url
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Join the human-authored lines of a thread into a single brief string. Bot
 * posts (the reel drafts we upload) and system messages are skipped so the brief
 * reflects what the team actually said about the release.
 */
export function summarizeThread(
  messages: ThreadMessage[],
  options: SummarizeThreadOptions = {},
): string {
  const maxChars = options.maxChars ?? 1_500;
  const lines: string[] = [];
  for (const message of messages) {
    if (message.bot_id) continue;
    if (message.subtype) continue;
    if (options.botUserId && message.user === options.botUserId) continue;
    const text = clean(message.text ?? "");
    if (text) lines.push(text);
  }
  return lines.join("\n").slice(0, maxChars).trim();
}
