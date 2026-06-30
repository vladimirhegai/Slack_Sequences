import { describe, expect, it } from "vitest";
import { claudeBaseArgs, PROVIDERS } from "../src/providers.ts";

function sseResponse(events: string[]): Response {
  return new Response(events.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("provider streaming — reasoning vs output", () => {
  it("OpenModel (Anthropic-compatible) routes thinking_delta to onThinking and text_delta to onDelta", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"type":"message_start"}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"weighing "}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"options"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello "}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Forge"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ])) as typeof fetch;
    const output: string[] = [];
    const thinking: string[] = [];
    try {
      const text = await PROVIDERS["openmodel-api"].streamComplete!(
        "hi",
        { apiKey: "om-test" },
        (delta) => output.push(delta),
        (think) => thinking.push(think),
      );
      expect(text).toBe("hello Forge");
      expect(output).toEqual(["hello ", "Forge"]);
      expect(thinking).toEqual(["weighing ", "options"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("DeepSeek (OpenAI-compatible) routes reasoning_content to onThinking and content to onDelta", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"let me think"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"answer "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"here"}}]}\n\n',
        "data: [DONE]\n\n",
      ])) as typeof fetch;
    const output: string[] = [];
    const thinking: string[] = [];
    try {
      const text = await PROVIDERS["deepseek-api"].streamComplete!(
        "hi",
        { apiKey: "sk-test" },
        (delta) => output.push(delta),
        (think) => thinking.push(think),
      );
      expect(text).toBe("answer here");
      expect(output).toEqual(["answer ", "here"]);
      expect(thinking).toEqual(["let me think"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("still works when onThinking is omitted (backward compatible)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"ignored"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
      ])) as typeof fetch;
    const output: string[] = [];
    try {
      const text = await PROVIDERS["openmodel-api"].streamComplete!(
        "hi",
        { apiKey: "om-test" },
        (delta) => output.push(delta),
      );
      expect(text).toBe("ok");
      expect(output).toEqual(["ok"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces structured provider errors from SSE", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      sseResponse(['data: {"type":"error","error":{"type":"overloaded_error","message":"try again later"}}\n\n'])) as typeof fetch;
    try {
      await expect(PROVIDERS["openmodel-api"].streamComplete!("hi", { apiKey: "om-test" }, () => {}))
        .rejects.toThrow("try again later");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("forwards cancellation to streaming API requests", async () => {
    const originalFetch = globalThis.fetch;
    let requestSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
      });
    }) as typeof fetch;
    const controller = new AbortController();
    try {
      const pending = PROVIDERS["deepseek-api"].streamComplete!(
        "hi",
        { apiKey: "sk-test", signal: controller.signal },
        () => {},
      );
      controller.abort(new Error("execution stopped"));
      await expect(pending).rejects.toThrow("execution stopped");
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("OpenRouter bounded completions", () => {
  it("turns reasoning off explicitly so max_tokens remain available for source", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "complete source" } }],
        usage: { completion_tokens: 3 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await expect(PROVIDERS["openrouter-api"].complete("author", {
        apiKey: "or-test",
        maxTokens: 16_384,
        thinkingMode: "none",
      })).resolves.toBe("complete source");
      expect(body?.max_tokens).toBe(16_384);
      expect(body?.reasoning).toEqual({ enabled: false });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("forwards a native strict JSON schema response contract", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"patches":[{"search":"a","replace":"b"}]}' },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const responseFormat = {
      type: "json_schema" as const,
      json_schema: {
        name: "composition_patches",
        strict: true,
        schema: {
          type: "object",
          properties: { patches: { type: "array" } },
          required: ["patches"],
          additionalProperties: false,
        },
      },
    };
    try {
      await PROVIDERS["openrouter-api"].complete("repair", {
        apiKey: "or-test",
        responseFormat,
      });
      expect(body?.response_format).toEqual(responseFormat);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("forwards an assistant prefill so a truncated artifact can continue", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "</html>" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await PROVIDERS["openrouter-api"].complete("author", {
        apiKey: "or-test",
        assistantPrefill: "<!doctype html><html>",
      });
      expect(body?.messages).toEqual([
        { role: "user", content: "author" },
        { role: "assistant", content: "<!doctype html><html>" },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails loudly on normalized finish_reason=length instead of returning partial HTML", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        choices: [{
          finish_reason: "length",
          native_finish_reason: "max_tokens",
          message: { content: "<html>partial" },
        }],
        usage: { completion_tokens: 16_384 },
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const promise = PROVIDERS["openrouter-api"].complete("author", {
        apiKey: "or-test",
        maxTokens: 16_384,
      });
      await expect(promise).rejects.toThrow(/truncated.*16,?384 tokens/i);
      await expect(promise).rejects.toMatchObject({ partialText: "<html>partial" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("claude one-shot argv hardening", () => {
  // Regression: a Stage/Create turn once hung the full timeout because `claude -p`
  // kept its agentic toolset under permissionMode "default" — a tool call blocked
  // on a permission prompt that could never be answered (stdin at EOF).
  it("allows only Read so references work without mutation or shell permission prompts", () => {
    expect(claudeBaseArgs({})).toContain("--tools=Read");
  });

  it("uses the single-token `--tools=` form, never a separate empty-string arg", () => {
    // A bare "" arg collapses under windowsVerbatimArguments (the `.cmd`-shim
    // path) and lets `--tools` swallow the following flag. The `=` form is one
    // token that survives both argv encodings.
    const args = claudeBaseArgs({ model: "claude-sonnet-4-6", thinkingMode: "high" });
    expect(args).not.toContain("");
    expect(args).not.toContain("--tools");
    expect(args).toContain("--tools=Read");
  });

  it("neutralizes the surrounding repo (CLAUDE.md / skills / hooks) via --safe-mode", () => {
    expect(claudeBaseArgs({})).toContain("--safe-mode");
  });

  it("still forwards model and effort overrides", () => {
    const args = claudeBaseArgs({ model: "claude-opus-4-8", thinkingMode: "max" });
    expect(args).toEqual(expect.arrayContaining(["--model", "claude-opus-4-8", "--effort", "max"]));
  });

  it("maps the unsupported `minimal` effort down to `low`", () => {
    const args = claudeBaseArgs({ thinkingMode: "minimal" });
    const effortValue = args[args.indexOf("--effort") + 1];
    expect(effortValue).toBe("low");
  });

  it("omits model/effort when not overridden", () => {
    expect(claudeBaseArgs({})).not.toContain("--model");
    expect(claudeBaseArgs({})).not.toContain("--effort");
  });
});

describe("provider native image inputs", () => {
  it("sends images as Anthropic content blocks, never prompt text", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return sseResponse(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n']);
    }) as typeof fetch;
    try {
      await PROVIDERS["openmodel-api"].streamComplete!(
        "inspect attachment",
        { apiKey: "om-test", images: [{ mimeType: "image/png", base64: "iVBORw==" }] },
        () => {},
      );
      const messages = requestBody?.messages as Array<{ content: Array<Record<string, unknown>> }>;
      expect(messages[0]!.content[0]).toMatchObject({ type: "text", text: "inspect attachment" });
      expect(messages[0]!.content[1]).toMatchObject({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBORw==" },
      });
      expect(JSON.stringify(messages[0]!.content[0])).not.toContain("iVBORw");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
