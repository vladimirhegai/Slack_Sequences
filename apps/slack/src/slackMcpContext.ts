import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SlackMcpContext {
  text: string;
  toolsCalled: string[];
}

/**
 * The context bot's system prompt lives as editable prose in
 * `prompts/context-retrieval.md` (see prompts/README.md), not inline here.
 */
const CONTEXT_INSTRUCTIONS = fs
  .readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prompts/context-retrieval.md"),
    "utf8",
  )
  .trim();

interface ResponsesOutput {
  output?: Array<{
    type?: string;
    name?: string;
    error?: string | null;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
}

function boundedEnvInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function extractResponse(payload: ResponsesOutput): SlackMcpContext {
  const text = (payload.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text!)
    .join("\n")
    .trim();
  const calls = (payload.output ?? []).filter((item) => item.type === "mcp_call");
  const failed = calls.find((call) => call.error);
  if (failed) throw new Error(`Slack MCP tool failed: ${failed.error}`);
  if (calls.length === 0) throw new Error("The context model did not call Slack MCP");
  if (!text) throw new Error("Slack MCP returned no usable workspace context");
  return {
    text: text.slice(0, 10_000),
    toolsCalled: [...new Set(calls.map((call) => call.name).filter((name): name is string => Boolean(name)))],
  };
}

/**
 * Lets the model discover Slack's hosted MCP tools and retrieve only the context
 * needed for this video. The user token is forwarded to Slack, never placed in
 * model input, and the Responses API object is not retained (`store: false`).
 */
export async function retrieveSlackMcpContext(input: {
  userToken: string;
  product: string;
  whatShipped: string;
  extraContext?: string;
}): Promise<SlackMcpContext> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for Slack MCP context retrieval");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.SLACK_MCP_CONTEXT_MODEL ?? "gpt-5-mini",
      store: false,
      // Context retrieval is intentionally small: enough room for a compact
      // evidence pack, not an open-ended research turn.
      max_output_tokens: boundedEnvInt(
        "SLACK_MCP_CONTEXT_MAX_OUTPUT_TOKENS",
        1_600,
        800,
        4_000,
      ),
      max_tool_calls: boundedEnvInt("SLACK_MCP_CONTEXT_MAX_TOOL_CALLS", 4, 1, 8),
      reasoning: { effort: "minimal" },
      instructions: CONTEXT_INSTRUCTIONS,
      input: [
        `Product: ${input.product}`,
        `Launch request: ${input.whatShipped}`,
        input.extraContext ? `User context: ${input.extraContext}` : "",
      ].filter(Boolean).join("\n"),
      tools: [{
        type: "mcp",
        server_label: "slack",
        server_url: "https://mcp.slack.com/mcp",
        authorization: input.userToken,
        require_approval: "never",
      }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json() as ResponsesOutput;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `OpenAI Slack MCP request failed (${response.status})`);
  }
  return extractResponse(payload);
}
