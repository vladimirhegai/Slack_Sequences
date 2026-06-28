import { afterEach, describe, expect, it, vi } from "vitest";
import { retrieveSlackMcpContext } from "../src/slackMcpContext.ts";

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
});

describe("Slack hosted MCP context", () => {
  it("sends a non-persisted remote MCP request and returns tool receipts", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        store: boolean;
        tools: Array<{ server_url: string; authorization: string }>;
      };
      expect(body.store).toBe(false);
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
});
