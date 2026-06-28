/**
 * Proves the MCP path end-to-end without Slack or a model: spawn the Sequences
 * MCP server, list its tools, then drive a project entirely through tools/call
 * (submit_plan → outline → lint → render_preview). This is the "agent drives
 * tools" story made runnable — and the exact traffic to show in the demo.
 *
 *   npm run mcp:demo --workspace @sequences/slack
 */
import fs from "node:fs";
import { initializeProject, projectDirFor } from "../src/engine/projectTemplates.ts";
import { McpClient } from "../src/engine/mcpClient.ts";

const dir = projectDirFor("mcp-demo");
fs.rmSync(dir, { recursive: true, force: true });
initializeProject(dir, { name: "Relay", brandName: "Relay", seedScreenshot: true });

const plan = {
  motionProfile: "crisp-saas",
  scenes: [
    {
      archetype: "hook-opener",
      slots: { headline: "Relay v2 is live", subline: "Sub-100ms traces, 1-click rollback" },
    },
    { archetype: "stat-callout", slots: { stat: { value: 40, suffix: "%" }, caption: "faster cold starts" } },
    { archetype: "logo-sting-cta", slots: { cta: "Try Relay" } },
  ],
};

const client = await McpClient.connect(dir);
try {
  const tools = await client.listTools();
  console.log("MCP tools:", tools.map((tool) => tool.name).join(", "));

  console.log("\n→ submit_plan");
  console.log(await client.callTool("submit_plan", { plan }));

  console.log("\n→ get_project_outline");
  console.log(await client.callTool("get_project_outline"));

  console.log("\n→ lint_report");
  console.log(await client.callTool("lint_report"));

  console.log("\n→ render_preview");
  try {
    console.log(await client.callTool("render_preview"));
  } catch (error) {
    console.log("(skipped — render_preview needs Chrome/Edge):", String(error));
  }
} finally {
  client.close();
}
