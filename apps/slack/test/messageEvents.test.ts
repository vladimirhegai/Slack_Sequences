import { describe, expect, it } from "vitest";
import type { GenericMessageEvent } from "@slack/types";
import { EventDeduper, parseThreadReply } from "../src/messageEvents.ts";

function message(overrides: Partial<GenericMessageEvent> = {}): GenericMessageEvent {
  return {
    type: "message",
    subtype: undefined,
    event_ts: "1710000000.000001",
    channel: "C123",
    channel_type: "channel",
    user: "U_HUMAN",
    text: "make it shorter",
    ts: "1710000000.000001",
    thread_ts: "1709999999.000001",
    ...overrides,
  };
}

describe("parseThreadReply", () => {
  it("accepts a human thread reply and removes the bot mention", () => {
    expect(parseThreadReply(
      message({ text: "<@U_BOT> make it punchier", client_msg_id: "client-1" }),
      "U_BOT",
    )).toEqual({
      channel: "C123",
      threadTs: "1709999999.000001",
      eventId: "C123:1710000000.000001",
      instruction: "make it punchier",
    });
  });

  it("ignores root messages, bots, self, and empty replies", () => {
    expect(parseThreadReply(message({ thread_ts: undefined }), "U_BOT")).toBeUndefined();
    expect(parseThreadReply(message({ bot_id: "B123" }), "U_BOT")).toBeUndefined();
    expect(parseThreadReply(message({ user: "U_BOT" }), "U_BOT")).toBeUndefined();
    expect(parseThreadReply(message({ text: "  " }), "U_BOT")).toBeUndefined();
  });
});

describe("EventDeduper", () => {
  it("claims a delivery once and permits it again after the TTL", () => {
    const deduper = new EventDeduper(1_000);
    expect(deduper.claim("event-1", 10_000)).toBe(true);
    expect(deduper.claim("event-1", 10_500)).toBe(false);
    expect(deduper.claim("event-1", 11_001)).toBe(true);
  });
});
