import type { WebClient } from "@slack/web-api";
import { describe, expect, it, vi } from "vitest";
import {
  ChannelAccessError,
  postMessageWithAutoJoin,
  slackErrorCode,
  userFacingSlackError,
} from "../src/slackApi.ts";

function platformError(code: string): Error {
  return Object.assign(new Error(code), { data: { ok: false, error: code } });
}

function clientWith(postMessage: ReturnType<typeof vi.fn>, join = vi.fn()) {
  return {
    chat: { postMessage },
    conversations: { join },
  } as unknown as WebClient;
}

describe("postMessageWithAutoJoin", () => {
  it("posts immediately when the bot already has access", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true, ts: "1.2" });
    const join = vi.fn();

    const result = await postMessageWithAutoJoin(clientWith(postMessage, join), {
      channel: "C123",
      text: "Building…",
    });

    expect(result).toMatchObject({ ok: true, ts: "1.2" });
    expect(postMessage).toHaveBeenCalledOnce();
    expect(join).not.toHaveBeenCalled();
  });

  it("joins a public channel and retries after not_in_channel", async () => {
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(platformError("not_in_channel"))
      .mockResolvedValueOnce({ ok: true, ts: "1.2" });
    const join = vi.fn().mockResolvedValue({ ok: true });

    await postMessageWithAutoJoin(clientWith(postMessage, join), {
      channel: "C123",
      text: "Building…",
    });

    expect(join).toHaveBeenCalledWith({ channel: "C123" });
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it("turns an unjoinable private channel into an actionable error", async () => {
    const postMessage = vi.fn().mockRejectedValue(platformError("not_in_channel"));
    const join = vi.fn().mockRejectedValue(platformError("method_not_supported_for_channel_type"));

    await expect(
      postMessageWithAutoJoin(clientWith(postMessage, join), {
        channel: "G123",
        text: "Building…",
      }),
    ).rejects.toBeInstanceOf(ChannelAccessError);
  });
});

describe("Slack error messages", () => {
  it("extracts platform error codes", () => {
    expect(slackErrorCode(platformError("missing_scope"))).toBe("missing_scope");
  });

  it("explains how to refresh stale OAuth scopes", () => {
    expect(userFacingSlackError(platformError("missing_scope"))).toContain("reinstall");
  });
});
