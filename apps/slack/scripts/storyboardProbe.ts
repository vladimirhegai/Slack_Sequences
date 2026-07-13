/**
 * Paid, Slack-free probe of the storyboard-plan stage only (concept pass +
 * storyboard ladder + deterministic validation). Uses synthetic content,
 * writes only to local ignored .data, and never authors source or renders —
 * the cheapest way to measure live storyboard-stage reliability.
 *
 *   npm run storyboard:probe --workspace @sequences/slack -- [runs] ["brief"]
 *
 * This is a legacy-provider diagnostic and is never part of the Luna route.
 * It requires both SEQUENCES_ENABLE_LEGACY_PROBES=1 and OPENROUTER_API_KEY (or
 * the configured provider's key). Each run uses a fresh project dir so no
 * planning cache is reused.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SEQUENCES_ENABLE_LEGACY_PROBES !== "1") {
  throw new Error(
    "legacy paid probe disabled; set SEQUENCES_ENABLE_LEGACY_PROBES=1 explicitly",
  );
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.SLACK_SEQUENCES_DATA_DIR = path.join(appDir, ".data");
process.env.SLACK_SEQUENCES_PROVIDER ??= "openrouter-api";

const [{ requestStoryboardPlan }, { retrieveHyperframesSkillContext }, { initializeProject }, providers] =
  await Promise.all([
    import("../src/engine/compositionRunner.ts"),
    import("../src/agent/skillContext.ts"),
    import("../src/engine/projectTemplates.ts"),
    import("@sequences/platform/providers"),
  ]);

const runs = Math.max(1, Number(process.argv[2]) || 1);
const brief = process.argv[3] ??
  "Product: RADAR. Audience: product and operations teams. What shipped: RADAR turns " +
  "scattered product signals into one live operational view. Lead with signal overload, " +
  "reveal the unified radar dashboard with stat cards and a chart, and close on " +
  "confident team action.";

const provider = providers.PROVIDERS[
  (process.env.SLACK_SEQUENCES_PROVIDER ?? "openrouter-api") as keyof typeof providers.PROVIDERS
];
if (!provider) throw new Error("unknown provider");

const results: Array<Record<string, unknown>> = [];
for (let run = 1; run <= runs; run += 1) {
  const dir = path.join(appDir, ".data", "projects", `storyboard-probe-${Date.now()}-${run}`);
  fs.mkdirSync(dir, { recursive: true });
  initializeProject(dir, { name: "Probe", brandName: "Probe", seedScreenshot: true });
  const skills = retrieveHyperframesSkillContext("create", brief);
  const attempts = { count: 0 };
  const started = performance.now();
  try {
    const plan = await requestStoryboardPlan(provider, {
      brief,
      projectDir: dir,
      skills,
      targetDurationSec: 20,
      attempts,
    });
    const moments = plan.flatMap((scene) => scene.moments ?? []);
    results.push({
      run,
      ok: true,
      elapsedSec: Math.round((performance.now() - started) / 1000),
      attempts: attempts.count,
      shots: plan.length,
      moments: moments.length,
      toppedUp: moments.filter((moment) => moment.id.includes("-auto-")).length,
      beats: plan.reduce((count, scene) => count + (scene.beats?.length ?? 0), 0),
      cameraMoves: plan.reduce((count, scene) => count + (scene.camera?.path.length ?? 0), 0),
    });
  } catch (error) {
    results.push({
      run,
      ok: false,
      elapsedSec: Math.round((performance.now() - started) / 1000),
      attempts: attempts.count,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    });
  }
  console.log(JSON.stringify(results[results.length - 1]));
}
const passed = results.filter((result) => result.ok).length;
console.log(JSON.stringify({ summary: true, runs, passed, failed: runs - passed }));
process.exit(0);
