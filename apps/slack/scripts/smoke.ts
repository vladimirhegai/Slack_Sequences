/**
 * Slack-free smoke test of the whole pipeline:
 *   brief → plan (real provider) → applied project → thumbnails → MP4.
 *
 *   npm run smoke --workspace @sequences/slack -- "Relay v2: sub-100ms traces"
 *
 * Renders only when SMOKE_RENDER=1 (MP4 needs FFmpeg + Chrome). Thumbnails need
 * Chrome/Edge. Set SLACK_SEQUENCES_USE_MCP=1 to route the mutation through MCP.
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

console.log("\n=== Plan applied (%s, %s) ===", result.provider, result.usedMcp ? "via MCP" : "in-process");
console.log(result.outline);
console.log("\n%s", result.lint);
console.log("\nproject:", result.projectDir);
console.log("thumbnails:");
for (const file of result.thumbnailPaths) console.log("  -", file);
if (result.mp4Path) console.log("mp4:", result.mp4Path);
else console.log("mp4: (skipped — set SMOKE_RENDER=1 with FFmpeg+Chrome installed)");
