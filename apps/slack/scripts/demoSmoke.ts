/**
 * Model-free smoke of the `/sequences demo` reel: applies the curated demo plan
 * (no provider, no API key) and proves real per-scene thumbnails land on disk —
 * the exact create → thumbnails path the Slack bot runs, minus Slack.
 *
 *   npm run demo --workspace @sequences/slack            # thumbnails only
 *   VERIFY_RENDER=1 npm run demo --workspace @sequences/slack   # + MP4 (needs FFmpeg+Chrome)
 */
import fs from "node:fs";
import { createVideo } from "../src/orchestrator.ts";
import { DEMO_BRIEF, buildDemoPlan } from "../src/demo.ts";

const result = await createVideo({
  jobId: `demo-smoke-${Date.now()}`,
  product: DEMO_BRIEF.product,
  brandName: DEMO_BRIEF.brandName,
  whatShipped: DEMO_BRIEF.whatShipped,
  audience: DEMO_BRIEF.audience,
  tone: DEMO_BRIEF.tone,
  lengthSec: DEMO_BRIEF.lengthSec,
  presetPlan: buildDemoPlan,
  render: process.env.VERIFY_RENDER === "1",
});

console.log("=== /sequences demo (preset: %s) ===", result.usedPreset ? "yes" : "no");
console.log(result.outline);
console.log("\n%s", result.lint);
for (const receipt of result.toolCalls) {
  console.log(`MCP ${receipt.tool.padEnd(16)} ${receipt.status} (${receipt.durationMs}ms)`);
}

let ok = result.thumbnailPaths.length > 0;
console.log("\nthumbnails (%d):", result.thumbnailPaths.length);
for (const file of result.thumbnailPaths) {
  const exists = fs.existsSync(file) && fs.statSync(file).size > 0;
  if (!exists) ok = false;
  console.log(`  - ${exists ? "ok" : "MISSING"}  ${file}`);
}
if (result.mp4Path) console.log("mp4:", result.mp4Path);
else console.log("mp4: (skipped — set VERIFY_RENDER=1 with FFmpeg+Chrome)");

console.log("\n%s", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
