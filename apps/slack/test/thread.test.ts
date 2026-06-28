import { describe, expect, it } from "vitest";
import { summarizeThread, type ThreadMessage } from "../src/thread.ts";

describe("summarizeThread", () => {
  it("keeps human prose in order and drops bot/system noise", () => {
    const messages: ThreadMessage[] = [
      { user: "U_PM", text: "Relay v2 is live :rocket: sub-100ms traces" },
      { bot_id: "B_SEQ", text: "On it — drafting a launch reel…" }, // our own post
      { user: "U_ENG", text: "and 1-click rollback" },
      { user: "U_X", subtype: "channel_join", text: "has joined the channel" },
      { user: "U_PM", text: "" }, // empty
    ];
    expect(summarizeThread(messages)).toBe(
      "Relay v2 is live :rocket: sub-100ms traces\nand 1-click rollback",
    );
  });

  it("strips mentions/links and respects the char budget", () => {
    const messages: ThreadMessage[] = [
      { user: "U", text: "<@U123> see <https://x.com|the docs> <!here>" },
      { user: "U", text: "second line that should be cut" },
    ];
    expect(summarizeThread(messages, { maxChars: 12 })).toBe("see the docs");
  });

  it("drops the bot's own user id when provided", () => {
    const messages: ThreadMessage[] = [
      { user: "U_BOT", text: "automated reply" },
      { user: "U_HUMAN", text: "real context" },
    ];
    expect(summarizeThread(messages, { botUserId: "U_BOT" })).toBe("real context");
  });
});
