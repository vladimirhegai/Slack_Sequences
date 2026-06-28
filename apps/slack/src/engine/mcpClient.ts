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

  private constructor(projectDir: string) {
    this.#child = spawn(process.execPath, [SERVER_PATH, projectDir], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    this.#rl = readline.createInterface({ input: this.#child.stdout, terminal: false });
    this.#rl.on("line", (line) => this.#onLine(line));
    this.#child.on("exit", (code) => {
      this.#closed = true;
      this.#exitError = new Error(`MCP server exited (code ${code ?? "null"})`);
      for (const { reject } of this.#pending.values()) reject(this.#exitError);
      this.#pending.clear();
    });
    // Surface server diagnostics without polluting stdout (its JSON-RPC channel).
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", () => {
      /* server logs readiness/errors here; intentionally quiet in production */
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

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rl.close();
    this.#child.stdin.end();
    this.#child.kill();
  }
}
