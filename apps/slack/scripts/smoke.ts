/**
 * Slack-free smoke test of the default creative pipeline:
 *   brief → Luna direct composition → mechanical gate → thumbnails → MP4.
 *
 *   npm run smoke --workspace @sequences/slack -- "Relay v2: sub-100ms traces"
 *
 * Renders only when SMOKE_RENDER=1 (MP4 needs FFmpeg + Chrome). Thumbnails need
 * Chrome/Edge. MCP is the default; set SLACK_SEQUENCES_USE_MCP=0 to force local.
 */
import { createVideo } from "../src/orchestrator.ts";

const whatShipped =
  process.argv.slice(2).join(" ") ||
  "sub-100ms traces, 1-click rollback, 40% faster cold starts";

const result = await createVideo({
  jobId: `smoke-${Date.now()}`,
  product: "Relay",
  brandName: "Relay",
  whatShipped,
  audience: "backend engineers evaluating observability tools",
  tone: "crisp-saas",
  lengthSec: 30,
  render: process.env.SMOKE_RENDER === "1",
});

console.log(
  "\n=== Composition applied (%s, %s, %s) ===",
  result.authorRoute ?? "unknown-route",
  result.provider,
  result.usedMcp ? "via MCP" : "in-process",
);
for (const receipt of result.toolCalls) {
  console.log(`MCP ${receipt.tool.padEnd(16)} ${receipt.status} (${receipt.durationMs}ms)`);
}
console.log(result.outline);
console.log("\n%s", result.lint);
console.log("\nproject:", result.projectDir);
console.log("thumbnails:");
for (const file of result.thumbnailPaths) console.log("  -", file);
if (result.mp4Path) console.log("mp4:", result.mp4Path);
else console.log("mp4: (skipped — set SMOKE_RENDER=1 with FFmpeg+Chrome installed)");
