/**
 * Recipe Studio — Claude Code CLI file-first agent (plan §6.3).
 *
 * The strong-model path: the agent works in the workspace directory like a
 * developer while the studio is the file-watching referee. We spawn
 *   claude -p --output-format stream-json --permission-mode acceptEdits --verbose
 * with cwd = the workspace project dir, feed the message on STDIN (so no shell
 * escaping is ever needed), stream assistant text back to the chat, and persist
 * the session id so the next turn resumes the same conversation (`--resume`).
 * Ref images are files in the workspace; the prompt references their paths and
 * Claude Code reads them natively (§6.4).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { workspaceProjectDir } from "../workspaces.ts";

function sessionFile(id: string): string {
  return path.join(workspaceProjectDir(id), "chat", "claude-session.json");
}

function readSessionId(id: string): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(id), "utf8")).sessionId as string;
  } catch {
    return undefined;
  }
}

function writeSessionId(id: string, sessionId: string): void {
  const file = sessionFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ sessionId }, null, 2), "utf8");
}

export interface CliTurnResult {
  text: string;
  sessionId?: string;
  events: number;
}

/**
 * Run one Claude CLI turn. `onChunk` streams assistant text as it arrives (for
 * SSE). Resolves when the subprocess exits. Never throws on a non-zero exit —
 * a failed turn returns whatever text arrived plus an error line.
 */
export function runClaudeCliTurn(
  id: string,
  message: string,
  onChunk: (text: string) => void,
  options: { resume?: boolean; signal?: AbortSignal } = {},
): Promise<CliTurnResult> {
  const cwd = workspaceProjectDir(id);
  const resumeId = options.resume === false ? undefined : readSessionId(id);
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "acceptEdits",
    "--verbose",
    ...(resumeId ? ["--resume", resumeId] : []),
  ];
  return new Promise<CliTurnResult>((resolve) => {
    let child;
    try {
      child = spawn("claude", args, {
        cwd,
        shell: process.platform === "win32",
        stdio: ["pipe", "pipe", "pipe"],
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      onChunk(`\n[cli error] ${error instanceof Error ? error.message : String(error)}`);
      resolve({ text: "", events: 0 });
      return;
    }
    let buffer = "";
    let text = "";
    let sessionId: string | undefined;
    let events = 0;
    const stderrChunks: string[] = [];

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return; // non-JSON banner lines
      }
      events += 1;
      if (typeof event.session_id === "string") sessionId = event.session_id;
      // Assistant messages carry content blocks; surface text + tool-use notes.
      if (event.type === "assistant" && event.message && typeof event.message === "object") {
        const content = (event.message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object") {
              const b = block as Record<string, unknown>;
              if (b.type === "text" && typeof b.text === "string") {
                text += b.text;
                onChunk(b.text);
              } else if (b.type === "tool_use" && typeof b.name === "string") {
                onChunk(`\n_[edit: ${b.name}]_ `);
              }
            }
          }
        }
      } else if (event.type === "result" && typeof event.result === "string") {
        // The final result string (may repeat the text); ignore to avoid dupes.
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      onChunk(`\n[cli spawn error] ${error.message}`);
    });
    child.on("close", (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (sessionId) writeSessionId(id, sessionId);
      if (code !== 0 && !text) {
        onChunk(`\n[claude exited ${code}] ${stderrChunks.join("").slice(0, 400)}`);
      }
      resolve({ text, sessionId, events });
    });

    child.stdin.write(message);
    child.stdin.end();
  });
}

/** Whether the claude CLI is resolvable (advisory badge in the UI). */
export function claudeCliAvailable(): boolean {
  try {
    const probe = spawn("claude", ["--version"], { shell: process.platform === "win32" });
    probe.kill();
    return true;
  } catch {
    return false;
  }
}
