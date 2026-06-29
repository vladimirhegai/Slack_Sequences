import type { GenericMessageEvent } from "@slack/types";

type HumanReplyEvent = GenericMessageEvent | (Omit<GenericMessageEvent, "subtype"> & {
  subtype: "thread_broadcast";
});

export interface ThreadReply {
  channel: string;
  threadTs: string;
  eventId: string;
  instruction: string;
}

/**
 * Narrow a Slack message event to a human-authored, non-empty thread reply.
 * The explicit bot-id and self-user checks are both intentional: Slack bot
 * messages normally carry bot_id, while some app-authored messages also carry
 * the bot user's user id.
 */
export function parseThreadReply(
  event: HumanReplyEvent,
  botUserId?: string,
): ThreadReply | undefined {
  if (event.subtype !== undefined && event.subtype !== "thread_broadcast") return undefined;
  if (event.bot_id) return undefined;
  if (!event.user || (botUserId && event.user === botUserId)) return undefined;
  if (!event.thread_ts) return undefined;

  const mention = botUserId ? new RegExp(`<@${botUserId}>`, "g") : undefined;
  const instruction = (mention ? (event.text ?? "").replace(mention, "") : (event.text ?? "")).trim();
  if (!instruction) return undefined;

  return {
    channel: event.channel,
    threadTs: event.thread_ts,
    // `ts` is shared by message.channels and app_mention deliveries for the
    // same Slack message, so it also prevents cross-subscription double work.
    eventId: `${event.channel}:${event.ts}`,
    instruction,
  };
}

/**
 * Socket Mode can redeliver an event when an acknowledgement is interrupted.
 * Keep a bounded, in-memory claim set so a retry cannot apply the same revision
 * twice. Persistent project journaling remains the source of truth.
 */
export class EventDeduper {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 10 * 60_000) {
    this.ttlMs = ttlMs;
  }

  claim(eventId: string, now = Date.now()): boolean {
    for (const [id, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(id);
    }
    if (this.seen.has(eventId)) return false;
    this.seen.set(eventId, now + this.ttlMs);
    return true;
  }
}
