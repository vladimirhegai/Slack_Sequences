/**
 * Minimal stdio JSON-RPC 2.0 client for the Sequences MCP server (mcp.ts).
 *
 * Spawns `node --import tsx mcpServer.ts <projectDir>` and speaks the small MCP
 * subset the server implements (initialize, tools/list, tools/call). This is the
 * seam that makes the Slack agent a real MCP client: every engine mutation/render
 * the bot performs is a tools/call across this boundary.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcpServer.ts");
const PROTOCOL_VERSION = "2025-06-18";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class McpClient {
  #child: ChildProcessWithoutNullStreams;
  #rl: readline.Interface;
  #pending = new Map<number, PendingCall>();
  #nextId = 1;
  #closed = false;
  #exitError: Error | null = null;
  #stderr = "";

  private constructor(projectDir: string) {
    this.#child = spawn(process.execPath, ["--import", "tsx", SERVER_PATH, projectDir], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    this.#rl = readline.createInterface({ input: this.#child.stdout, terminal: false });
    this.#rl.on("line", (line) => this.#onLine(line));
    this.#child.on("exit", (code) => {
      this.#closed = true;
      const detail = this.#stderr.trim();
      this.#exitError = new Error(
        `MCP server exited (code ${code ?? "null"})${detail ? `: ${detail}` : ""}`,
      );
      for (const { reject } of this.#pending.values()) reject(this.#exitError);
      this.#pending.clear();
    });
    // Preserve a bounded stderr tail for diagnostics without polluting stdout
    // (the JSON-RPC channel) or Railway logs during successful requests.
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-2_000);
    });
  }

  /** Spawn a server for `projectDir` and complete the MCP handshake. */
  static async connect(projectDir: string): Promise<McpClient> {
    const client = new McpClient(projectDir);
    await client.#request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "sequences-slack", version: "0.1.0" },
    });
    client.#notify("notifications/initialized");
    return client;
  }

  #onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      message = JSON.parse(trimmed);
    } catch {
      return; // non-JSON banner line
    }
    if (typeof message.id !== "number") return; // server-initiated notification
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message ?? "MCP error"));
    else pending.resolve(message.result);
  }

  #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.#closed) return Promise.reject(this.#exitError ?? new Error("MCP server closed"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  #notify(method: string): void {
    if (this.#closed) return;
    this.#child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }

  /** Call a tool; returns its text payload. Throws on tool/transport errors. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = (await this.#request("tools/call", { name, arguments: args })) as ToolResult;
    const text = (result.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
    if (result.isError) throw new Error(text || `tool ${name} failed`);
    return text;
  }

  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const result = (await this.#request("tools/list", {})) as {
      tools?: Array<{ name: string; description: string }>;
    };
    return result.tools ?? [];
  }

  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Detach this client's child process and pipes from the parent's event-loop
   * ref count so an IDLE pooled connection can never hold a script open.
   * CAUTION: an unref'd client must never be awaited on — with no other live
   * handles node exits mid-call. The pool re-refs before every use.
   */
  unref(): void {
    // Piped child stdio are net.Sockets at runtime; the stream types just
    // don't declare unref/ref.
    for (const stream of [this.#child.stdin, this.#child.stdout, this.#child.stderr]) {
      (stream as unknown as { unref?: () => void }).unref?.();
    }
    this.#child.unref();
  }

  /** Re-attach to the event loop for the duration of an in-flight call. */
  ref(): void {
    for (const stream of [this.#child.stdin, this.#child.stdout, this.#child.stderr]) {
      (stream as unknown as { ref?: () => void }).ref?.();
    }
    this.#child.ref();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rl.close();
    this.#child.stdin.end();
    this.#child.kill();
  }
}

/* ---------------------------------------------------------- connection pool */

/**
 * One live create walks submit_composition → render_preview → render as three
 * separate tool calls; spawning a fresh tsx server (a multi-second cold start,
 * per call, per job) was pure overhead. The pool keeps one connected server per
 * project directory for a short idle window and hands out the same client. A
 * dead subprocess is dropped and replaced transparently; callers keep their
 * existing per-call fallback semantics. The child is unref'd so an idle pooled
 * connection never keeps a CLI script's process alive.
 */
const POOL_IDLE_MS = 45_000;
const pool = new Map<string, { client: McpClient; idleTimer?: NodeJS.Timeout }>();

function dropFromPool(key: string, client: McpClient): void {
  const entry = pool.get(key);
  if (entry?.client === client) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    pool.delete(key);
  }
  client.close();
}

export async function withPooledMcpClient<T>(
  projectDir: string,
  use: (client: McpClient) => Promise<T>,
): Promise<T> {
  const key = path.resolve(projectDir);
  let entry = pool.get(key);
  if (entry?.idleTimer) clearTimeout(entry.idleTimer);
  if (!entry || entry.client.closed) {
    if (entry) pool.delete(key);
    const client = await McpClient.connect(key);
    entry = { client };
    pool.set(key, entry);
  }
  const { client } = entry;
  // Ref'd while a call is in flight; unref'd while parked so an idle pooled
  // connection never keeps a CLI script's process alive.
  client.ref();
  try {
    return await use(client);
  } catch (error) {
    // A tool-level error keeps the transport; a dead transport leaves the pool.
    if (client.closed) dropFromPool(key, client);
    throw error;
  } finally {
    const current = pool.get(key);
    if (current?.client === client && !client.closed) {
      client.unref();
      current.idleTimer = setTimeout(() => dropFromPool(key, client), POOL_IDLE_MS);
      current.idleTimer.unref();
    }
  }
}
