import type { WebClient } from "@slack/web-api";
import { describe, expect, it, vi } from "vitest";
import {
  ChannelAccessError,
  postMessageWithDmFallback,
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

  it("does not try to join a private channel hidden as channel_not_found", async () => {
    const postMessage = vi.fn().mockRejectedValue(platformError("channel_not_found"));
    const join = vi.fn();

    await expect(
      postMessageWithAutoJoin(clientWith(postMessage, join), {
        channel: "G123",
        text: "Building…",
      }),
    ).rejects.toBeInstanceOf(ChannelAccessError);
    expect(join).not.toHaveBeenCalled();
  });

  it("falls back to an actionable DM without failing durable asset work", async () => {
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(platformError("channel_not_found"))
      .mockResolvedValueOnce({ ok: true, ts: "2.3" });
    const join = vi.fn();

    const delivery = await postMessageWithDmFallback(
      clientWith(postMessage, join),
      { channel: "G123", text: "Screenshots captured." },
      "U123",
    );

    expect(delivery).toMatchObject({ channelPosted: false, dmPosted: true });
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1]?.[0]).toMatchObject({ channel: "U123" });
    expect(postMessage.mock.calls[1]?.[0].text).toContain("/invite @Sequences");
    expect(join).not.toHaveBeenCalled();
  });

  it("reports both delivery failures instead of throwing into the asset transaction", async () => {
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(platformError("channel_not_found"))
      .mockRejectedValueOnce(platformError("user_not_found"));

    await expect(
      postMessageWithDmFallback(
        clientWith(postMessage),
        { channel: "G123", text: "Screenshots captured." },
        "U123",
      ),
    ).resolves.toMatchObject({ channelPosted: false, dmPosted: false });
  });
});

describe("Slack error messages", () => {
  it("extracts platform error codes", () => {
    expect(slackErrorCode(platformError("missing_scope"))).toBe("missing_scope");
  });

  it("explains how to refresh stale OAuth scopes", () => {
    expect(userFacingSlackError(platformError("missing_scope"))).toContain("reinstall");
  });

  it("turns raw channel_not_found into an invite instruction", () => {
    expect(userFacingSlackError(platformError("channel_not_found"))).toContain("/invite @Sequences");
  });
});
