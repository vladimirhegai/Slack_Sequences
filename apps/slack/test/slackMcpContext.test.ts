import { afterEach, describe, expect, it, vi } from "vitest";
import { retrieveSlackMcpContext } from "../src/slackMcpContext.ts";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalAttempts = process.env.SLACK_MCP_CONTEXT_ATTEMPTS;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalAttempts === undefined) delete process.env.SLACK_MCP_CONTEXT_ATTEMPTS;
  else process.env.SLACK_MCP_CONTEXT_ATTEMPTS = originalAttempts;
});

describe("Slack hosted MCP context", () => {
  it("sends a non-persisted remote MCP request and returns tool receipts", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        store: boolean;
        max_output_tokens: number;
        max_tool_calls: number;
        reasoning: { effort: string };
        tools: Array<{ server_url: string; authorization: string }>;
      };
      expect(body.store).toBe(false);
      expect(body.max_output_tokens).toBe(1_600);
      expect(body.max_tool_calls).toBe(4);
      expect(body.reasoning.effort).toBe("minimal");
      expect(body.tools[0]?.server_url).toBe("https://mcp.slack.com/mcp");
      expect(body.tools[0]?.authorization).toBe("xoxp-user");
      return new Response(JSON.stringify({
        output: [
          { type: "mcp_call", name: "search_messages" },
          {
            type: "message",
            content: [{ type: "output_text", text: "Verified launch metric: 40%." }],
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await retrieveSlackMcpContext({
      userToken: "xoxp-user",
      product: "Relay",
      whatShipped: "Faster search",
    });

    expect(result.text).toContain("40%");
    expect(result.toolsCalled).toEqual(["search_messages"]);
  });

  it("reports an empty response body as an actionable error, not a raw JSON parse crash", async () => {
    // Regression: OpenAI returned a 200 with an empty body (transient gateway
    // hiccup). The old code called response.json() first and surfaced the bare
    // "Unexpected end of JSON input" as "Couldn’t build …".
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SLACK_MCP_CONTEXT_ATTEMPTS = "1";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    await expect(
      retrieveSlackMcpContext({ userToken: "xoxp-user", product: "Radar", whatShipped: "New alerts" }),
    ).rejects.toThrow(/empty response body/i);
    await expect(
      retrieveSlackMcpContext({ userToken: "xoxp-user", product: "Radar", whatShipped: "New alerts" }),
    ).rejects.not.toThrow(/Unexpected end of JSON input/i);
  });

  it("surfaces the upstream error message on a non-retryable HTTP failure", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SLACK_MCP_CONTEXT_ATTEMPTS = "1";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "Invalid Authentication" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    )));

    await expect(
      retrieveSlackMcpContext({ userToken: "xoxp-user", product: "Radar", whatShipped: "New alerts" }),
    ).rejects.toThrow(/HTTP 401.*Invalid Authentication/i);
  });

  it("retries a transient upstream fault and then succeeds", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.SLACK_MCP_CONTEXT_ATTEMPTS = "3";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [
          { type: "mcp_call", name: "search_messages" },
          { type: "message", content: [{ type: "output_text", text: "Recovered context." }] },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await retrieveSlackMcpContext({
      userToken: "xoxp-user",
      product: "Radar",
      whatShipped: "New alerts",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toContain("Recovered context.");
  });
});
