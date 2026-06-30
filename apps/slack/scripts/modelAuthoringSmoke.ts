/**
 * Paid, Slack-free smoke against the configured Railway authoring provider.
 * Uses synthetic content, writes only to local ignored .data, and skips MP4.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SLACK_SEQUENCES_DATA_DIR = path.join(appDir, ".data");
process.env.SLACK_SEQUENCES_USE_MCP = "0";

const [{ createVideo }, { loadDirectComposition }] = await Promise.all([
  import("../src/orchestrator.ts"),
  import("../src/engine/directComposition.ts"),
]);

const started = performance.now();
const result = await createVideo({
  jobId: `model-authoring-smoke-${Date.now()}`,
  product: "RADAR",
  brandName: "RADAR",
  whatShipped:
    "RADAR turns scattered product signals into one live operational view. " +
    "Lead with signal overload, reveal the unified radar dashboard, and close on confident team action.",
  audience: "product and operations teams",
  tone: "crisp-saas",
  lengthSec: 20,
  render: false,
  preferMcp: false,
});
const current = loadDirectComposition(result.projectDir);
console.log(JSON.stringify({
  elapsedMs: Math.round(performance.now() - started),
  provider: result.provider,
  sourceChars: current.html.length,
  sceneCount: current.manifest.scenes.length,
  layoutSamples: current.manifest.qa?.layoutSamples ?? 0,
  qaWarnings: current.manifest.qa?.warningCount ?? 0,
  thumbnails: result.thumbnailPaths.length,
}));
