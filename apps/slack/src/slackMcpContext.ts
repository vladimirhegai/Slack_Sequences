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

/** OpenAI/gateway statuses worth another attempt (rate limit + transient 5xx). */
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

interface RetrieveInput {
  userToken: string;
  product: string;
  whatShipped: string;
  extraContext?: string;
}

/**
 * A transport-level failure (network fault, timeout, empty body, or a transient
 * upstream status) that a later attempt can plausibly recover. Kept distinct from
 * a permanent error so the retry loop only spends a call where it can help.
 */
class RetryableContextError extends Error {}

/** Pull OpenAI's structured `error.message` out of a body if it is JSON. */
function parseErrorMessage(bodyText: string): string | undefined {
  if (!bodyText.trim()) return undefined;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
    const message = parsed.error?.message;
    return typeof message === "string" && message.trim() ? message.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One retrieval attempt. Reads the body as text *before* parsing so an empty or
 * non-JSON response (a 5xx gateway page, a dropped connection, a rate-limit
 * stub) surfaces as an actionable, retryable error rather than a bare
 * "Unexpected end of JSON input" that used to sink the entire build.
 */
async function requestSlackMcpContext(input: RetrieveInput, apiKey: string): Promise<SlackMcpContext> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
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
  } catch (error) {
    // DNS/reset/timeout never yield a Response object — always worth a retry.
    throw new RetryableContextError(
      `OpenAI request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    const detail = parseErrorMessage(bodyText) ?? bodyText.slice(0, 300).trim();
    const message = `OpenAI Slack MCP request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`;
    if (TRANSIENT_STATUS.has(response.status)) throw new RetryableContextError(message);
    throw new Error(message);
  }
  if (!bodyText.trim()) {
    // A 2xx with an empty body is the exact source of the old
    // "Unexpected end of JSON input" build failure — treat it as transient.
    throw new RetryableContextError(`OpenAI returned an empty response body (HTTP ${response.status})`);
  }
  let payload: ResponsesOutput;
  try {
    payload = JSON.parse(bodyText) as ResponsesOutput;
  } catch {
    throw new Error(`OpenAI returned an unreadable (non-JSON) response (HTTP ${response.status})`);
  }
  return extractResponse(payload);
}

/**
 * Lets the model discover Slack's hosted MCP tools and retrieve only the context
 * needed for this video. The user token is forwarded to Slack, never placed in
 * model input, and the Responses API object is not retained (`store: false`).
 * Transient upstream faults are retried with backoff so a single OpenAI hiccup
 * doesn't fail the whole build.
 */
export async function retrieveSlackMcpContext(input: RetrieveInput): Promise<SlackMcpContext> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for Slack MCP context retrieval");
  const attempts = boundedEnvInt("SLACK_MCP_CONTEXT_ATTEMPTS", 3, 1, 5);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestSlackMcpContext(input, apiKey);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !(error instanceof RetryableContextError)) throw error;
      process.stderr.write(
        `[slack-mcp-context] attempt ${attempt}/${attempts} transient fault: ${
          error instanceof Error ? error.message : String(error)
        } — retrying\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }
  }
  throw lastError;
}
