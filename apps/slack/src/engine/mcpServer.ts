/**
 * Entry point for the Sequences MCP server as a child process.
 *
 * The Slack orchestrator spawns this with `node --import tsx mcpServer.ts <dir>`
 * and talks JSON-RPC 2.0 over stdio (see mcpClient.ts). The same file can be
 * registered with Claude Desktop / Cursor to drive a project from any MCP client:
 *
 *   node --import tsx <repo>/apps/slack/src/engine/mcpServer.ts <projectDir>
 */
import { startMcpServer } from "./mcp.ts";

const projectDir = process.argv[2];
if (!projectDir) {
  process.stderr.write("usage: mcpServer.ts <projectDir>\n");
  process.exit(1);
}

startMcpServer(projectDir);
