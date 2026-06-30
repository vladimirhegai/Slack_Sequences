/**
 * Shared agent providers for Sequences and Forge.
 *
 * Priority design goal (Phase 1): work WITHOUT API keys. Local `cli`
 * providers shell out to locally installed, subscription-authenticated
 * agent CLIs:
 *
 *   - codex-cli       → `codex exec` (uses your ChatGPT/Codex login)
 *   - claude-code-cli → `claude -p`  (uses your Claude Code subscription login)
 *
 * Google Antigravity is also available through its authenticated `agy`
 * executable. The `api` providers are optional and only light up when a key is
 * present (env var or a key passed per request — never persisted to disk).
 *
 * Every provider implements one method: complete(prompt) → text. The plan
 * pipeline (prompt building, JSON extraction, schema validation, commands)
 * is identical regardless of brain — quality is enforced by the schema +
 * validator + deterministic fill, not by the model.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ProviderId =
  | "codex-cli"
  | "claude-code-cli"
  | "antigravity-cli"
  | "deepseek-api"
  | "openmodel-api"
  | "openrouter-api"
  | "openai-api"
  | "anthropic-api";

export interface CompleteOptions {
  /** Per-request API key (api providers only). Overrides the env var. */
  apiKey?: string;
  /** Per-request model override. Empty/undefined keeps the provider default. */
  model?: string;
  /**
   * Per-request thinking/effort override. "auto" keeps the provider default.
   * "none" explicitly disables optional API reasoning. Codex accepts
   * minimal|low|medium|high|xhigh; Claude Code accepts low|medium|high|xhigh|max
   * — each provider clamps to its nearest valid level.
   */
  thinkingMode?: "auto" | "none" | "enabled" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * Maximum output (completion) tokens for api providers. When omitted the
   * provider/model default applies — which for DeepSeek-style chat models is a
   * small 4096-token cap that silently truncates a long structured response.
   * Set this for any task that must emit a large, complete artifact.
   */
  maxTokens?: number;
  timeoutMs?: number;
  cacheHint?: string;
  /** Cancels an in-flight API request or local CLI subprocess. */
  signal?: AbortSignal;
  /** Native multimodal image inputs for API providers (never embedded in prompt text). */
  images?: Array<{ mimeType: string; base64: string }>;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderRequest {
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  toolChoice?: string;
  cacheHint?: string;
}

export interface AgentProvider {
  id: ProviderId;
  label: string;
  kind: "cli" | "api";
  /** Env var consulted for api providers when no per-request key is given. */
  apiKeyEnv?: string;
  /** Quick availability probe (CLI on PATH / key in env). */
  detect(): Promise<{ available: boolean; detail: string }>;
  complete(prompt: string, options?: CompleteOptions): Promise<string>;
  /**
   * Stream a completion. `onDelta` receives the final-answer text as it arrives
   * (backward-compatible). `onThinking`, when supplied, additionally receives the
   * model's reasoning/thinking stream — token deltas where the provider exposes
   * them (Claude), or whole reasoning blocks as they finalize (Codex). Providers
   * that cannot surface reasoning simply never call it.
   */
  streamComplete?(
    prompt: string,
    options: CompleteOptions | undefined,
    onDelta: (chunk: string) => void,
    onThinking?: (chunk: string) => void,
  ): Promise<string>;
  completeRequest?(request: ProviderRequest, options?: CompleteOptions): Promise<string>;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: "cli" | "api";
  apiKeyEnv?: string;
  available: boolean;
  detail: string;
}

/** The provider returned partial text because its completion budget was exhausted. */
export class ProviderOutputTruncatedError extends Error {
  readonly finishReason = "length";
  readonly completionTokens?: number;

  constructor(provider: string, completionTokens?: number) {
    super(
      `${provider} truncated the completion at its output-token limit${
        completionTokens ? ` after ${completionTokens} tokens` : ""
      }`,
    );
    this.name = "ProviderOutputTruncatedError";
    this.completionTokens = completionTokens;
  }
}

const DEFAULT_TIMEOUT_MS = 240_000;
const ANTIGRAVITY_DIRECT_PROMPT_MAX_CHARS = 18_000;

export function completeProviderRequest(
  provider: AgentProvider,
  request: ProviderRequest,
  options: CompleteOptions = {},
): Promise<string> {
  if (provider.completeRequest) {
    return provider.completeRequest(request, {
      ...options,
      cacheHint: options.cacheHint ?? request.cacheHint,
    });
  }
  const prompt = [
    ...request.messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`),
    ...(request.tools?.length
      ? [
          "TOOLS:",
          JSON.stringify(request.tools),
          request.toolChoice ? `TOOL CHOICE: ${request.toolChoice}` : "",
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n\n");
  return provider.complete(prompt, {
    ...options,
    cacheHint: options.cacheHint ?? request.cacheHint,
  });
}

function modelOverride(options: CompleteOptions): string | undefined {
  const model = options.model?.trim();
  return model || undefined;
}

function effortOverride(options: CompleteOptions): CompleteOptions["thinkingMode"] | undefined {
  return options.thinkingMode && options.thinkingMode !== "auto" ? options.thinkingMode : undefined;
}

function cliErrorDetail(stderr: string, stdout: string): string {
  const text = (stderr || stdout || "").trim();
  // CLIs often emit many startup warnings before the actionable error. Keep
  // the tail so Forge surfaces the quota/model/auth failure instead of hiding
  // it behind plugin diagnostics.
  return text.slice(-1_200);
}

function openAiReasoningEffort(options: CompleteOptions): "low" | "medium" | "high" | undefined {
  const effort = effortOverride(options);
  if (!effort || effort === "none") return undefined;
  return effort === "low" || effort === "medium" ? effort : "high";
}

function deepSeekReasoningEffort(options: CompleteOptions): "low" | "medium" | "high" | undefined {
  const effort = effortOverride(options);
  if (!effort || effort === "none" || effort === "minimal") return undefined;
  return effort === "low" || effort === "medium" ? effort : "high";
}

function openRouterReasoning(options: CompleteOptions): Record<string, unknown> | undefined {
  const effort = effortOverride(options);
  if (!effort) return undefined;
  if (effort === "none") return { enabled: false };
  if (effort === "enabled") return { enabled: true };
  return { effort: effort === "max" ? "xhigh" : effort };
}

function openModelThinkingEnabled(options: CompleteOptions): boolean {
  return effortOverride(options) === "enabled";
}

/**
 * Apply a caller-requested output-token cap to an OpenAI-/Anthropic-compatible
 * request body. A no-op when the caller does not set one, so existing callers
 * keep the provider/model default. `field` differs by API dialect.
 */
function withMaxTokens(
  body: Record<string, unknown>,
  options: CompleteOptions,
  field: "max_tokens" | "max_completion_tokens" = "max_tokens",
): Record<string, unknown> {
  if (options.maxTokens && Number.isFinite(options.maxTokens) && options.maxTokens > 0) {
    body[field] = Math.floor(options.maxTokens);
  }
  return body;
}

interface OpenAiCompatibleCompletion {
  choices?: Array<{
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    message?: { content?: string };
    error?: { message?: string; code?: string | number };
  }>;
  usage?: { completion_tokens?: number };
  error?: { message?: string; code?: string | number };
}

function completionText(
  json: OpenAiCompatibleCompletion,
  provider: string,
): string {
  const choice = json.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new ProviderOutputTruncatedError(provider, json.usage?.completion_tokens);
  }
  if (json.error || choice?.finish_reason === "error" || choice?.error) {
    const error = choice?.error ?? json.error;
    throw new Error(
      `${provider} completion failed: ${error?.message ?? error?.code ?? choice?.native_finish_reason ?? "provider error"}`,
    );
  }
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error(`${provider} returned an empty completion`);
  return text;
}

function openAiUserContent(prompt: string, options: CompleteOptions): unknown {
  if (!options.images?.length) return prompt;
  return [
    { type: "text", text: prompt },
    ...options.images.map((image) => ({
      type: "image_url",
      image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
    })),
  ];
}

function anthropicUserContent(prompt: string, options: CompleteOptions): unknown {
  if (!options.images?.length) return prompt;
  return [
    { type: "text", text: prompt },
    ...options.images.map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.mimeType, data: image.base64 },
    })),
  ];
}

/** Resolve a command on PATH (where.exe on Windows, which elsewhere). */
export function findOnPath(command: string): string | undefined {
  try {
    const finder = process.platform === "win32" ? "where.exe" : "which";
    const output = execFileSync(finder, [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

/**
 * Run a CLI with the prompt on STDIN (never as an argv — prompts are long,
 * multi-line, and full of quotes). Windows `.cmd`/`.bat` shims are launched
 * through cmd.exe.
 */
function runCli(
  file: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  const isCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
  const command = isCmdShim ? "cmd.exe" : file;
  const commandArgs = isCmdShim ? ["/d", "/s", "/c", file, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      commandArgs,
      {
        encoding: "utf8",
        timeout: timeoutMs,
        signal,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        ...(isCmdShim ? { windowsVerbatimArguments: true } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const killed = error as Error & { killed?: boolean; signal?: NodeJS.Signals | null };
          // execFile SIGTERMs the child on timeout — that path yields no stderr,
          // so report it as a timeout instead of an opaque "Command failed".
          if (killed.killed && (killed.signal === "SIGTERM" || killed.signal === "SIGKILL")) {
            reject(
              new Error(
                `${path.basename(file)} timed out after ${Math.round(timeoutMs / 1000)}s with no output — ` +
                  `try a lower effort, a smaller request, or a longer timeout`,
              ),
            );
            return;
          }
          const detail = cliErrorDetail(stderr, stdout);
          reject(new Error(`${path.basename(file)} failed: ${error.message}${detail ? `\n${detail}` : ""}`));
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
    child.stdin?.end(stdin);
  });
}

function runCliStreaming(
  file: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  onStdout: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  const isCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
  const command = isCmdShim ? "cmd.exe" : file;
  const commandArgs = isCmdShim ? ["/d", "/s", "/c", file, ...args] : args;
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, commandArgs, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      signal,
      ...(isCmdShim ? { windowsVerbatimArguments: true } : {}),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      onStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `${path.basename(file)} timed out after ${Math.round(timeoutMs / 1000)}s with no output - ` +
              `try a lower effort, a smaller request, or a longer timeout`,
          ),
        );
        return;
      }
      if (code && code !== 0) {
        const detail = cliErrorDetail(stderr, stdout);
        reject(new Error(`${path.basename(file)} failed with exit ${code}${signal ? ` (${signal})` : ""}${detail ? `\n${detail}` : ""}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin?.end(stdin);
  });
}

/**
 * Run a CLI whose stdout is JSON Lines, parsing each complete line into an
 * object for `onLine`. Buffers partial lines across chunks; ignores non-JSON
 * lines (banners, blank lines, partial fragments).
 */
function runCliJsonLines(
  file: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  onLine: (obj: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  let buffer = "";
  const consume = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") return;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") onLine(parsed as Record<string, unknown>);
    } catch {
      // A partial or non-JSON line — skip it.
    }
  };
  return runCliStreaming(file, args, stdin, timeoutMs, (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }, signal).then((result) => {
    if (buffer.trim()) consume(buffer);
    return result;
  });
}

/* ---------- CLI providers (no API key — local subscription logins) ---------- */

export const codexCli: AgentProvider = {
  id: "codex-cli",
  label: "Codex CLI (ChatGPT login)",
  kind: "cli",
  async detect() {
    const found = findOnPath("codex");
    return found
      ? { available: true, detail: found }
      : { available: false, detail: "codex not on PATH — install: npm i -g @openai/codex, then `codex login`" };
  },
  async complete(prompt, options = {}) {
    const file = findOnPath("codex");
    if (!file) throw new Error("codex CLI not found on PATH");
    // --output-last-message gives us ONLY the final agent message (stdout
    // carries reasoning/log noise). Read-only sandbox: planning never needs
    // to touch the filesystem.
    const lastMessageFile = path.join(
      os.tmpdir(),
      `seq-codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
    );
    try {
      const model = modelOverride(options);
      const effort = effortOverride(options);
      // Codex reasoning effort is none|minimal|low|medium|high|xhigh — no "max".
      const codexEffort = effort === "max" ? "xhigh" : effort;
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        lastMessageFile,
      ];
      if (model) args.push("--model", model);
      if (codexEffort) args.push("--config", `model_reasoning_effort=${JSON.stringify(codexEffort)}`);
      args.push("-");
      await runCli(
        file,
        args,
        prompt,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        options.signal,
      );
      if (fs.existsSync(lastMessageFile)) {
        const text = fs.readFileSync(lastMessageFile, "utf8").trim();
        if (text) return text;
      }
      throw new Error("codex exec produced no final message");
    } finally {
      fs.rmSync(lastMessageFile, { force: true });
    }
  },
  async streamComplete(prompt, options = {}, onDelta, onThinking) {
    const file = findOnPath("codex");
    if (!file) throw new Error("codex CLI not found on PATH");
    const lastMessageFile = path.join(
      os.tmpdir(),
      `seq-codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
    );
    try {
      const model = modelOverride(options);
      const effort = effortOverride(options);
      const codexEffort = effort === "max" ? "xhigh" : effort;
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "--output-last-message",
        lastMessageFile,
      ];
      if (model) args.push("--model", model);
      if (codexEffort) args.push("--config", `model_reasoning_effort=${JSON.stringify(codexEffort)}`);
      args.push("-");
      // codex exec --json emits JSON Lines. Reasoning surfaces as whole blocks
      // (newer: item.completed/type=reasoning; older: msg.agent_reasoning*), and
      // the final answer is read authoritatively from --output-last-message.
      await runCliJsonLines(file, args, prompt, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, (obj) => {
        const item = obj.item as { type?: string; item_type?: string; text?: string } | undefined;
        if ((obj.type === "item.completed" || obj.type === "item.updated") && item) {
          const itemType = item.type ?? item.item_type;
          if (itemType === "reasoning" && typeof item.text === "string" && item.text.trim()) onThinking?.(item.text);
          else if (itemType === "agent_message" && typeof item.text === "string") onDelta(item.text);
          return;
        }
        const msg = obj.msg as { type?: string; delta?: string; text?: string; message?: string } | undefined;
        if (!msg || typeof msg.type !== "string") return;
        if (msg.type === "agent_reasoning_delta" && typeof msg.delta === "string") onThinking?.(msg.delta);
        else if (msg.type === "agent_reasoning" && typeof msg.text === "string") onThinking?.(msg.text);
        else if (msg.type === "agent_message_delta" && typeof msg.delta === "string") onDelta(msg.delta);
        else if (msg.type === "agent_message" && typeof msg.message === "string") onDelta(msg.message);
      }, options.signal);
      if (fs.existsSync(lastMessageFile)) {
        const text = fs.readFileSync(lastMessageFile, "utf8").trim();
        if (text) return text;
      }
      throw new Error("codex exec produced no final message");
    } finally {
      fs.rmSync(lastMessageFile, { force: true });
    }
  },
};

/**
 * Base argv for a one-shot `claude -p` completion.
 *
 * Two flags are load-bearing, not cosmetic:
 *   --tools=      Disable ALL built-in tools. In print mode claude still ships
 *                 the full agentic toolset under permissionMode "default"; a
 *                 creative prompt ("build me this component") can make the model
 *                 call Bash/Read/Write, which then BLOCKS on a permission prompt
 *                 that can never be answered (stdin is already at EOF). The child
 *                 then hangs until the outer timeout SIGTERMs it — the "timed out
 *                 after 600s with no output" failure. With no tools, the turn can
 *                 only ever produce text, so it can never block. Written as the
 *                 single token `--tools=` (empty value) so it survives both the
 *                 direct-exe argv and the verbatim `.cmd`-shim join, where a
 *                 separate "" arg would collapse and swallow the next flag.
 *   --safe-mode   Spawned cwd is whatever the host happens to be (often a real
 *                 repo with CLAUDE.md, skills, and hooks). Safe mode skips all of
 *                 that — a stray hook can't stall the turn, and the repo's
 *                 engineering context can't contaminate the completion. Auth,
 *                 model selection, and built-in tools still work normally, so the
 *                 subscription login is unaffected.
 */
export function claudeBaseArgs(options: CompleteOptions): string[] {
  // Read is the only enabled tool: it lets Claude inspect explicitly attached
  // visual references while still making writes, shell calls, and permission
  // deadlocks impossible in non-interactive print mode.
  const args = ["--safe-mode", "--tools=Read"];
  const model = modelOverride(options);
  const effort = effortOverride(options);
  // Claude Code --effort is low|medium|high|xhigh|max — no "minimal".
  const claudeEffort = effort === "none" ? undefined : effort === "minimal" ? "low" : effort;
  if (model) args.push("--model", model);
  if (claudeEffort) args.push("--effort", claudeEffort);
  return args;
}

export const claudeCodeCli: AgentProvider = {
  id: "claude-code-cli",
  label: "Claude Code CLI (subscription login)",
  kind: "cli",
  async detect() {
    const found = findOnPath("claude");
    return found
      ? { available: true, detail: found }
      : { available: false, detail: "claude not on PATH — install Claude Code, then sign in once" };
  },
  async complete(prompt, options = {}) {
    const file = findOnPath("claude");
    if (!file) throw new Error("claude CLI not found on PATH");
    // -p (print mode) reads the prompt from stdin and prints the final
    // response. Planning is a one-shot text task — no tools (see claudeBaseArgs).
    const args = ["-p", "--output-format", "text", ...claudeBaseArgs(options)];
    const { stdout } = await runCli(
      file,
      args,
      prompt,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal,
    );
    const text = stdout.trim();
    if (!text) throw new Error("claude -p produced no output");
    return text;
  },
  async streamComplete(prompt, options = {}, onDelta, onThinking) {
    const file = findOnPath("claude");
    if (!file) throw new Error("claude CLI not found on PATH");
    // stream-json + partial messages gives token-level deltas for both the
    // answer (text_delta) and extended thinking (thinking_delta). `-p` requires
    // `--verbose` when the output format is stream-json.
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...claudeBaseArgs(options),
    ];
    let finalText = "";
    let streamedText = "";
    await runCliJsonLines(file, args, prompt, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, (obj) => {
      if (obj.type === "stream_event") {
        const event = obj.event as
          | { type?: string; delta?: { type?: string; text?: string; thinking?: string } }
          | undefined;
        const delta = event?.delta;
        if (event?.type === "content_block_delta" && delta) {
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            streamedText += delta.text;
            onDelta(delta.text);
          } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
            onThinking?.(delta.thinking);
          }
        }
        return;
      }
      // The terminal result event carries the authoritative final answer.
      if (obj.type === "result" && typeof obj.result === "string") finalText = obj.result;
    }, options.signal);
    const text = (finalText || streamedText).trim();
    if (!text) throw new Error("claude -p produced no output");
    return text;
  },
};

interface AntigravityTranscriptEntry {
  source?: string;
  type?: string;
  content?: string;
}

function antigravityAppDataDir(): string {
  return path.join(os.homedir(), ".gemini", "antigravity-cli");
}

/**
 * Recover the final response from Antigravity's own transcript.
 *
 * agy 1.0.x has a known Windows non-TTY bug: `--print` completes with exit 0
 * but writes no bytes to redirected stdout. The completed response is still
 * persisted under brain/<conversation-id>/.system_generated/logs, so use the
 * invocation's private log to identify the exact conversation and recover it.
 * Keeping this keyed by a per-call log also makes concurrent Forge turns safe.
 */
export function recoverAntigravityResponse(
  logFile: string,
  appDataDir = antigravityAppDataDir(),
): string | undefined {
  if (!fs.existsSync(logFile)) return undefined;
  const log = fs.readFileSync(logFile, "utf8");
  const ids = [...log.matchAll(/Print mode: conversation=([0-9a-f-]+)/gi)];
  const conversationId = ids.at(-1)?.[1];
  if (!conversationId) return undefined;

  const transcriptDir = path.join(
    appDataDir,
    "brain",
    conversationId,
    ".system_generated",
    "logs",
  );
  const fullTranscript = path.join(transcriptDir, "transcript_full.jsonl");
  const transcript = fs.existsSync(fullTranscript)
    ? fullTranscript
    : path.join(transcriptDir, "transcript.jsonl");
  if (!fs.existsSync(transcript)) return undefined;

  let response: string | undefined;
  for (const line of fs.readFileSync(transcript, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as AntigravityTranscriptEntry;
      if (
        entry.source === "MODEL" &&
        (entry.type === "PLANNER_RESPONSE" || entry.type === "MODIFIED_RESPONSE") &&
        typeof entry.content === "string" &&
        entry.content.trim()
      ) {
        response = entry.content.trim();
      }
    } catch {
      // A partially written diagnostic line should not hide a valid response.
    }
  }
  return response;
}

function antigravityPrintTimeout(timeoutMs: number): string {
  // Let agy finish and persist its transcript before the outer process timeout.
  return `${Math.max(1, Math.floor((timeoutMs - 5_000) / 1_000))}s`;
}

export const antigravityCli: AgentProvider = {
  id: "antigravity-cli",
  label: "Antigravity CLI (Google login)",
  kind: "cli",
  async detect() {
    const found = findOnPath("agy");
    return found
      ? { available: true, detail: found }
      : {
          available: false,
          detail:
            "agy not on PATH - install from https://antigravity.google/download, then launch `agy` once to sign in",
        };
  },
  async complete(prompt, options = {}) {
    const file = findOnPath("agy");
    if (!file) throw new Error("Antigravity CLI (`agy`) not found on PATH");

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "seq-agy-"));
    const logFile = path.join(workDir, "agy.log");
    const promptFile = path.join(workDir, "prompt.txt");
    try {
      const args = [
        "--sandbox",
        "--print-timeout",
        antigravityPrintTimeout(timeoutMs),
        "--log-file",
        logFile,
      ];
      const model = modelOverride(options);
      if (model) args.push("--model", model);
      if (prompt.length <= ANTIGRAVITY_DIRECT_PROMPT_MAX_CHARS) {
        // Direct transport avoids a pathological agy 1.0.x behavior where a
        // full Stage prompt read through a file can stay in agent/tool mode
        // indefinitely. Keep a conservative margin under Windows' command-line
        // limit because quoting JSON expands the physical command line.
        args.push("--print", prompt);
      } else {
        fs.writeFileSync(promptFile, prompt, "utf8");
        args.push(
          "--add-dir",
          workDir,
          "--print",
          `Read ${JSON.stringify(promptFile)} exactly once. Its complete contents are the user request. ` +
            "Do not inspect other instruction or skill files; return only the final response requested by that file.",
        );
      }

      const { stdout } = await runCli(file, args, "", timeoutMs, options.signal);
      const text = stdout.trim() || recoverAntigravityResponse(logFile);
      if (!text) {
        throw new Error(
          "agy --print produced no final response; launch `agy` interactively to verify sign-in, then try again",
        );
      }
      return text;
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  },
};

/* ---------- API providers (optional, key required, never persisted) ---------- */

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    throw new Error(`${url} → HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

async function streamOpenAiCompatibleChat(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
  onDelta: (chunk: string) => void,
  onThinking?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...body, stream: true }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    throw new Error(`${url} -> HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  if (!res.body) throw new Error(`${url} returned no response body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let streamError = "";
  let streamTruncated = false;
  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") return;
    let json: {
      error?: { message?: string; type?: string; code?: string };
      choices?: Array<{
        delta?: { content?: string; reasoning_content?: string; reasoning?: string };
        message?: { content?: string };
        finish_reason?: string | null;
      }>;
    };
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.error) {
      streamError = json.error.message || json.error.code || json.error.type || "provider stream error";
      return;
    }
    if (json.choices?.[0]?.finish_reason === "length") {
      streamTruncated = true;
      return;
    }
    // DeepSeek-style reasoning surfaces on delta.reasoning_content (or .reasoning).
    const reasoning = json.choices?.[0]?.delta?.reasoning_content ?? json.choices?.[0]?.delta?.reasoning;
    if (reasoning) onThinking?.(reasoning);
    const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
    if (delta) {
      text += delta;
      onDelta(delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) consumeLine(line);
  if (streamTruncated) throw new ProviderOutputTruncatedError(new URL(url).hostname);
  if (streamError) throw new Error(`${url} stream failed: ${streamError}`);
  return text.trim();
}

async function streamAnthropicCompatibleMessages(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
  onDelta: (chunk: string) => void,
  onThinking?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...body, stream: true }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    throw new Error(`${url} -> HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  if (!res.body) throw new Error(`${url} returned no response body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let streamError = "";
  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") return;
    let json: {
      type?: string;
      error?: { message?: string; type?: string };
      delta?: { type?: string; text?: string; thinking?: string };
    };
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.type === "error" || json.error) {
      streamError = json.error?.message || json.error?.type || "provider stream error";
      return;
    }
    if (json.type !== "content_block_delta" || !json.delta) return;
    if (json.delta.type === "thinking_delta" && typeof json.delta.thinking === "string") {
      onThinking?.(json.delta.thinking);
    } else if (typeof json.delta.text === "string" && json.delta.text) {
      text += json.delta.text;
      onDelta(json.delta.text);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) consumeLine(line);
  if (streamError) throw new Error(`${url} stream failed: ${streamError}`);
  return text.trim();
}

export const openaiApi: AgentProvider = {
  id: "openai-api",
  label: "OpenAI API (key)",
  kind: "api",
  apiKeyEnv: "OPENAI_API_KEY",
  async detect() {
    return process.env.OPENAI_API_KEY
      ? { available: true, detail: "OPENAI_API_KEY set" }
      : { available: false, detail: "no OPENAI_API_KEY — optional; the CLI providers need no key" };
  },
  async complete(prompt, options = {}) {
    const key = options.apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("no OpenAI API key (set OPENAI_API_KEY or pass one per request)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_OPENAI_MODEL ?? "gpt-5.1-mini";
    const body: Record<string, unknown> = { model, messages: [{ role: "user", content: openAiUserContent(prompt, options) }] };
    withMaxTokens(body, options, "max_completion_tokens");
    const effort = openAiReasoningEffort(options);
    if (effort) body.reasoning_effort = effort;
    const json = (await postJson(
      "https://api.openai.com/v1/chat/completions",
      { authorization: `Bearer ${key}` },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal,
    )) as OpenAiCompatibleCompletion;
    return completionText(json, "OpenAI");
  },
  async streamComplete(prompt, options = {}, onDelta, onThinking) {
    const key = options.apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("no OpenAI API key (set OPENAI_API_KEY or pass one per request)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_OPENAI_MODEL ?? "gpt-5.1-mini";
    const body: Record<string, unknown> = { model, messages: [{ role: "user", content: openAiUserContent(prompt, options) }] };
    withMaxTokens(body, options, "max_completion_tokens");
    const effort = openAiReasoningEffort(options);
    if (effort) body.reasoning_effort = effort;
    const text = await streamOpenAiCompatibleChat(
      "https://api.openai.com/v1/chat/completions",
      { authorization: `Bearer ${key}` },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onDelta,
      onThinking,
      options.signal,
    );
    if (!text) throw new Error("OpenAI returned an empty completion");
    return text;
  },
};

/**
 * OpenRouter is an OpenAI-compatible gateway: one key fronts DeepSeek, GLM, and
 * many other models, selected by the `vendor/model` id (e.g. `deepseek/deepseek-v4-pro`,
 * `z-ai/glm-4.6`). Reasoning surfaces on `delta.reasoning(_content)`, already
 * handled by streamOpenAiCompatibleChat. The optional X-Title header only affects
 * OpenRouter's public rankings.
 */
export const openrouterApi: AgentProvider = {
  id: "openrouter-api",
  label: "OpenRouter API (key)",
  kind: "api",
  apiKeyEnv: "OPENROUTER_API_KEY",
  async detect() {
    return process.env.OPENROUTER_API_KEY
      ? { available: true, detail: "OPENROUTER_API_KEY set" }
      : { available: false, detail: "no OPENROUTER_API_KEY — optional gateway to DeepSeek/GLM/etc." };
  },
  async complete(prompt, options = {}) {
    const key = options.apiKey || process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("no OpenRouter API key (set OPENROUTER_API_KEY or pass one per request)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_OPENROUTER_MODEL ?? "deepseek/deepseek-v4-pro";
    const body: Record<string, unknown> = { model, messages: [{ role: "user", content: openAiUserContent(prompt, options) }] };
    withMaxTokens(body, options);
    const reasoning = openRouterReasoning(options);
    if (reasoning) body.reasoning = reasoning;
    const json = (await postJson(
      "https://openrouter.ai/api/v1/chat/completions",
      { authorization: `Bearer ${key}`, "x-title": "Sequences for Slack" },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal,
    )) as OpenAiCompatibleCompletion;
    return completionText(json, "OpenRouter");
  },
  async streamComplete(prompt, options = {}, onDelta, onThinking) {
    const key = options.apiKey || process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("no OpenRouter API key (set OPENROUTER_API_KEY or pass one per request)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_OPENROUTER_MODEL ?? "deepseek/deepseek-v4-pro";
    const body: Record<string, unknown> = { model, messages: [{ role: "user", content: openAiUserContent(prompt, options) }] };
    withMaxTokens(body, options);
    const reasoning = openRouterReasoning(options);
    if (reasoning) body.reasoning = reasoning;
    const text = await streamOpenAiCompatibleChat(
      "https://openrouter.ai/api/v1/chat/completions",
      { authorization: `Bearer ${key}`, "x-title": "Sequences for Slack" },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onDelta,
      onThinking,
      options.signal,
    );
    if (!text) throw new Error("OpenRouter returned an empty completion");
    return text;
  },
};

export const deepseekApi: AgentProvider = {
  id: "deepseek-api",
  label: "DeepSeek API (key)",
  kind: "api",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  async detect() {
    return process.env.DEEPSEEK_API_KEY
      ? { available: true, detail: "DEEPSEEK_API_KEY set" }
      : { available: false, detail: "no DEEPSEEK_API_KEY - add one in Forge settings or set the env var" };
  },
  async complete(prompt, options = {}) {
    const key = options.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("no DeepSeek API key (add one in Forge settings or set DEEPSEEK_API_KEY)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_DEEPSEEK_MODEL ?? "deepseek-v4-flash";
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: openAiUserContent(prompt, options) }],
      stream: false,
    };
    withMaxTokens(body, options);
    const effort = deepSeekReasoningEffort(options);
    if (effort) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = effort;
    }
    const json = (await postJson(
      "https://api.deepseek.com/chat/completions",
      { authorization: `Bearer ${key}` },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal,
    )) as OpenAiCompatibleCompletion;
    return completionText(json, "DeepSeek");
  },
  async streamComplete(prompt, options = {}, onDelta, onThinking) {
    const key = options.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("no DeepSeek API key (add one in Forge settings or set DEEPSEEK_API_KEY)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_DEEPSEEK_MODEL ?? "deepseek-v4-flash";
    const body: Record<string, unknown> = { model, messages: [{ role: "user", content: openAiUserContent(prompt, options) }] };
    withMaxTokens(body, options);
    const effort = deepSeekReasoningEffort(options);
    if (effort) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = effort;
    }
    const text = await streamOpenAiCompatibleChat(
      "https://api.deepseek.com/chat/completions",
      { authorization: `Bearer ${key}` },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onDelta,
      onThinking,
      options.signal,
    );
    if (!text) throw new Error("DeepSeek returned an empty completion");
    return text;
  },
};

export const openModelApi: AgentProvider = {
  id: "openmodel-api",
  label: "OpenModel DeepSeek API (key)",
  kind: "api",
  apiKeyEnv: "OPENMODEL_API_KEY",
  async detect() {
    return process.env.OPENMODEL_API_KEY
      ? { available: true, detail: "OPENMODEL_API_KEY set" }
      : {
          available: false,
          detail: "no OPENMODEL_API_KEY - add an om- key in Forge settings or set the env var",
        };
  },
  async complete(prompt, options = {}) {
    const key = options.apiKey || process.env.OPENMODEL_API_KEY;
    if (!key) throw new Error("no OpenModel API key (add an om- key in Forge settings or set OPENMODEL_API_KEY)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_OPENMODEL_MODEL ?? "deepseek-v4-flash";
    const body: Record<string, unknown> = {
      model,
      max_tokens: 16_384,
      messages: [{ role: "user", content: anthropicUserContent(prompt, options) }],
    };
    if (openModelThinkingEnabled(options)) body.thinking = { type: "enabled" };
    const json = (await postJson(
      "https://api.openmodel.ai/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal,
    )) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("OpenModel returned an empty completion");
    return text;
  },
  async streamComplete(prompt, options = {}, onDelta, onThinking) {
    const key = options.apiKey || process.env.OPENMODEL_API_KEY;
    if (!key) throw new Error("no OpenModel API key (add an om- key in Forge settings or set OPENMODEL_API_KEY)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_OPENMODEL_MODEL ?? "deepseek-v4-flash";
    const body: Record<string, unknown> = {
      model,
      max_tokens: 16_384,
      messages: [{ role: "user", content: anthropicUserContent(prompt, options) }],
    };
    if (openModelThinkingEnabled(options)) body.thinking = { type: "enabled" };
    const text = await streamAnthropicCompatibleMessages(
      "https://api.openmodel.ai/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onDelta,
      onThinking,
      options.signal,
    );
    if (!text) throw new Error("OpenModel returned an empty completion");
    return text;
  },
};

export const anthropicApi: AgentProvider = {
  id: "anthropic-api",
  label: "Anthropic API (key)",
  kind: "api",
  apiKeyEnv: "ANTHROPIC_API_KEY",
  async detect() {
    return process.env.ANTHROPIC_API_KEY
      ? { available: true, detail: "ANTHROPIC_API_KEY set" }
      : { available: false, detail: "no ANTHROPIC_API_KEY — optional; the CLI providers need no key" };
  },
  async complete(prompt, options = {}) {
    const key = options.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("no Anthropic API key (set ANTHROPIC_API_KEY or pass one per request)");
    const model = modelOverride(options) ?? process.env.SEQUENCES_ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
    const effort = effortOverride(options);
    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 4096,
      messages: [{ role: "user", content: anthropicUserContent(prompt, options) }],
    };
    if (effort && effort !== "none") {
      body.thinking = { type: "adaptive" };
      body.effort = effort;
    }
    const json = (await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      body,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal,
    )) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Anthropic returned an empty completion");
    return text;
  },
};

/* ---------- registry ---------- */

/** Ordered by preference: local subscription CLIs first — no keys required. */
export const PROVIDERS: Record<ProviderId, AgentProvider> = {
  "codex-cli": codexCli,
  "claude-code-cli": claudeCodeCli,
  "antigravity-cli": antigravityCli,
  "deepseek-api": deepseekApi,
  "openmodel-api": openModelApi,
  "openrouter-api": openrouterApi,
  "anthropic-api": anthropicApi,
  "openai-api": openaiApi,
};

let detectCache: Promise<ProviderInfo[]> | null = null;

export function detectProviders(force = false): Promise<ProviderInfo[]> {
  if (!detectCache || force) {
    detectCache = Promise.all(
      Object.values(PROVIDERS).map(async (provider) => {
        const { available, detail } = await provider.detect();
        return {
          id: provider.id,
          label: provider.label,
          kind: provider.kind,
          ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
          available,
          detail,
        };
      }),
    );
  }
  return detectCache;
}

/** First available provider in preference order (CLIs before APIs). */
export async function defaultProvider(): Promise<ProviderId | null> {
  const infos = await detectProviders();
  return infos.find((p) => p.available)?.id ?? null;
}
