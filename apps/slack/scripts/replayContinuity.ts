/** Apply the default-off continuity graph to an exact persisted project clone. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDeterministicSourceRepairs,
  browserQualityPenalty,
  completeStoryboardWorldLayouts,
  correctLayoutOverflow,
  repairContrastAaIssues,
} from "../src/engine/compositionRunner.ts";
import { retimeLateLoadBearingEntrances } from "../src/engine/componentContract.ts";
import { delayConflictingCameraMoves } from "../src/engine/pacingAudit.ts";
import {
  alignCameraDestinationsWithLateEntrances,
  ensureCameraBlockingChassis,
  reserveFinalCameraLanding,
  upgradeCrossStationDrifts,
} from "../src/engine/cameraContract.ts";
import {
  commitDirectComposition,
  loadDirectComposition,
  validateDirectComposition,
  type DirectCompositionDraft,
} from "../src/engine/directComposition.ts";
import { correctEyeTracePingPong } from "../src/engine/eyeTraceRepair.ts";
import { cohereInteractionFocusItems } from "../src/engine/interactionContract.ts";
import { inspectDirectComposition, type DirectBrowserQaResult } from "../src/engine/layoutInspector.ts";
import { reconcileAndLowerPlugins } from "../src/engine/pluginContract.ts";
import { reconcileRecipeDeclarations } from "../src/engine/recipeContract.ts";
import { resolveCliInputPath } from "../src/engine/cliPaths.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsDir = path.join(appDir, ".data", "projects");
const args = process.argv.slice(2);
const sourceArg = args[0];
const outIndex = args.indexOf("--out");
const outId = outIndex >= 0 ? args[outIndex + 1] : undefined;

if (!sourceArg) {
  console.error("usage: npm run continuity:replay -- <project-dir-or-id> [--out <new-project-id>]");
  process.exitCode = 2;
} else {
  const resolvedSource = resolveCliInputPath(sourceArg, appDir);
  const source = fs.existsSync(resolvedSource)
    ? resolvedSource
    : path.join(projectsDir, sourceArg);
  if (!fs.existsSync(source)) throw new Error(`source project does not exist: ${source}`);
  const target = outId ? path.join(projectsDir, outId) : source;
  if (outId) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(outId)) throw new Error(`invalid --out id: ${outId}`);
    if (fs.existsSync(target)) throw new Error(`target project already exists: ${target}`);
    fs.cpSync(source, target, { recursive: true });
  }
  process.env.SLACK_SEQUENCES_CONTINUITY_GRAPH = "1";
  const current = loadDirectComposition(target);
  // Older commits normalized scene timing/components back from HTML but
  // accidentally omitted the locked worldLayout field. Recover that exact
  // paid planning artifact before replay; current commits preserve it.
  let persistedScenes = current.manifest.scenes;
  const planningPath = path.join(target, "planning", "storyboard.json");
  if (fs.existsSync(planningPath)) {
    try {
      const planning = JSON.parse(fs.readFileSync(planningPath, "utf8")) as {
        storyboard?: DirectCompositionDraft["storyboard"];
      };
      const byId = new Map((planning.storyboard ?? []).map((scene) => [scene.id, scene]));
      persistedScenes = persistedScenes.map((scene) =>
        scene.worldLayout?.length || !byId.get(scene.id)?.worldLayout?.length
          ? scene
          : { ...scene, worldLayout: byId.get(scene.id)!.worldLayout }
      );
    } catch {
      // A missing/corrupt optional planning cache cannot make deterministic
      // replay fail; the committed scene remains the source of truth.
    }
  }
  const entrance = retimeLateLoadBearingEntrances(persistedScenes);
  const focus = cohereInteractionFocusItems(entrance.scenes);
  const plugins = reconcileAndLowerPlugins(focus.scenes);
  // Replays can start from a pre-governor cached manifest. Run the same L2
  // declaration governor used by fresh storyboards so a now-known duplicate
  // primary surface is absorbed before source injection and validation.
  const recipes = reconcileRecipeDeclarations(plugins.scenes);
  const blockingChassis = ensureCameraBlockingChassis(recipes.scenes);
  const crossStationTravel = upgradeCrossStationDrifts(blockingChassis.storyboard);
  const landingReserve = reserveFinalCameraLanding(crossStationTravel.storyboard);
  const destinationAlignment = alignCameraDestinationsWithLateEntrances(
    landingReserve.storyboard,
  );
  const moveDelay = delayConflictingCameraMoves(destinationAlignment.storyboard);
  // Planning artifacts and older manifests may both carry only a partial map.
  // Complete after plugin lowering, matching parse-time ordering so generated
  // component regions participate too, while preserving every recovered cell.
  const worldLayoutCompletion = completeStoryboardWorldLayouts(moveDelay.storyboard);
  let draft = applyDeterministicSourceRepairs(
    { html: current.html, storyboard: worldLayoutCompletion.scenes },
    target,
    worldLayoutCompletion.scenes,
  );

  let lastReviewFailure = "";
  const review = async (
    candidate: DirectCompositionDraft,
  ): Promise<{ qa: DirectBrowserQaResult; penalty: number } | undefined> => {
    const validation = await validateDirectComposition(target, candidate);
    if (!validation.ok) {
      lastReviewFailure = `static validation:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`;
      return undefined;
    }
    const qa = await inspectDirectComposition(target, candidate, { captureGuide: false });
    if (qa.infraError || !qa.ok) {
      lastReviewFailure = [
        qa.infraError ? `browser infrastructure: ${qa.infraError}` : "browser review rejected",
        ...qa.errors.map((error) => `- ${error}`),
      ].join("\n");
      return undefined;
    }
    return {
      qa,
      penalty: browserQualityPenalty(qa, [
        ...validation.frameWarnings,
        ...validation.motionWarnings,
      ]),
    };
  };

  let reviewed = await review(draft);
  if (!reviewed) {
    throw new Error(
      `replayed composition failed deterministic review${lastReviewFailure ? `:\n${lastReviewFailure}` : ""}`,
    );
  }
  const adoptedLayout: string[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    const layout = correctLayoutOverflow(draft.storyboard, reviewed.qa);
    if (!layout.corrected.length) break;
    const candidateDraft = applyDeterministicSourceRepairs(
      { html: draft.html, storyboard: layout.storyboard },
      target,
      layout.storyboard,
    );
    const candidate = await review(candidateDraft);
    if (!candidate || candidate.penalty >= reviewed.penalty) break;
    draft = candidateDraft;
    reviewed = candidate;
    adoptedLayout.push(...layout.corrected);
  }
  const contrast = repairContrastAaIssues(draft, reviewed.qa);
  let adoptedContrast: string[] = [];
  if (contrast.repaired.length) {
    const candidate = await review(contrast.draft);
    if (candidate && candidate.penalty < reviewed.penalty) {
      draft = contrast.draft;
      reviewed = candidate;
      adoptedContrast = contrast.repaired;
    }
  }
  const eyeTrace = correctEyeTracePingPong(draft.storyboard, reviewed.qa);
  let adoptedEyeTrace: string[] = [];
  if (eyeTrace.corrected.length) {
    const eyeDraft = applyDeterministicSourceRepairs(
      { html: draft.html, storyboard: eyeTrace.storyboard },
      target,
      eyeTrace.storyboard,
    );
    const candidate = await review(eyeDraft);
    const corrected = new Set(eyeTrace.corrected);
    const targetCleared = candidate && !(candidate.qa.issues ?? []).some((issue) => {
      const evidence = issue.eyeTracePingPong;
      return issue.code === "eye_trace_pingpong" && evidence &&
        corrected.has(`${evidence.sceneId}:${evidence.firstBeatId}->${evidence.secondBeatId}`);
    });
    if (candidate && targetCleared && candidate.penalty < reviewed.penalty) {
      draft = eyeDraft;
      reviewed = candidate;
      adoptedEyeTrace = eyeTrace.corrected;
    }
  }
  const committed = await commitDirectComposition(
    target,
    `${current.manifest.title} + continuity blocking`,
    draft,
    current.manifest.fps,
  );
  console.log(JSON.stringify({
    source,
    projectDir: target,
    revision: committed.manifest.revision,
    durationSec: committed.manifest.durationSec,
    scenes: committed.manifest.scenes.length,
    plannerNormalizations: [
      ...worldLayoutCompletion.completions.map((completion) =>
        `world-layout-derive: scene "${completion.sceneId}" completed ` +
        `${completion.addedRegions.join(", ")}`
      ),
      ...entrance.normalized,
      ...focus.normalized,
      ...plugins.notes,
      ...recipes.notes.map((note) => `recipe-reconcile: ${note}`),
      ...crossStationTravel.normalized,
      ...blockingChassis.normalized,
      ...landingReserve.normalized,
      ...destinationAlignment.normalized,
      ...moveDelay.normalized,
    ],
    browserPenalty: reviewed.penalty,
    contrastRepairs: adoptedContrast,
    eyeTraceRepairs: adoptedEyeTrace,
    layoutRepairs: adoptedLayout,
    validationWarnings: committed.validation.warnings,
  }, null, 2));
}
