import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  browserQualityPenalty,
  findingSignature,
  storyboardResponseFormat,
} from "../src/engine/compositionRunner.ts";
import * as legacyRunner from "../src/engine/compositionRunner.ts";
import {
  browserQualityPenalty as directBrowserQualityPenalty,
  browserQualityNonRegression,
} from "../src/engine/runner/browserQuality.ts";
import { findingSignature as directFindingSignature } from "../src/engine/runner/findingSignatures.ts";
import {
  extractIndexHtmlSource,
  extractStoryboardSource,
} from "../src/engine/runner/parse.ts";
import * as directLadder from "../src/engine/runner/ladder.ts";
import * as directOrchestration from "../src/engine/runner/orchestration.ts";
import * as directPrompts from "../src/engine/runner/prompts.ts";
import * as directRepairs from "../src/engine/runner/repairs.ts";
import * as directScaffold from "../src/engine/runner/scaffold.ts";
import * as directStoryboardAudit from "../src/engine/runner/storyboardAudit.ts";
import { storyboardResponseFormat as directStoryboardResponseFormat } from "../src/engine/runner/storyboardResponseFormat.ts";
import * as runner from "../src/engine/runner/index.ts";
import {
  visionCriticDraftHash,
  type DirectBrowserQaResult,
} from "../src/engine/layoutInspector.ts";
import type { CompositionRunResult } from "../src/engine/runner/types.ts";

describe("runner extraction parity (WS-F2)", () => {
  it("pins the legacy runner runtime export surface", () => {
    expect(Object.keys(legacyRunner).sort()).toEqual([
      "HOST_PLAN_ISLAND_IDS",
      "NORMALIZERS",
      "SLOT_MODE_DIRECTOR_REWRITES",
      "SOURCE_SYNTAX_NORMALIZERS",
      "STORYBOARD_SHAPES",
      "StoryboardValidationError",
      "adaptDirectorPromptForSlots",
      "addressedPartsForLayoutRepair",
      "applyCompositionRepair",
      "applyDeterministicSourceRepairs",
      "auditDisplayTypeBudget",
      "auditDiveInteractions",
      "auditShapeMatchHints",
      "authorSlotDraft",
      "authorStoryboardProjection",
      "autoStyleHeadlineReveals",
      "autoStyleSemanticHighlights",
      "brandBaseStyleBlock",
      "browserQaHasUnresolvedHardFailure",
      "browserQualityPenalty",
      "buildSceneSkeletons",
      "buildSceneSlotInteriors",
      "completeStoryboardWorldLayouts",
      "correctLayoutOverflow",
      "correctLoadBearingContainment",
      "correctSparseFraming",
      "countScaffoldBindingsPresent",
      "countScaffoldedBindings",
      "creationPrompt",
      "criticSkippableCleanDraft",
      "dedupeFeedbackBySignature",
      "defaultShapeForBrief",
      "degradeMismatchedShapeHintCuts",
      "degradeUnsupportedComponentBeats",
      "degradeVolunteeredBridgedCuts",
      "deriveDiveWindows",
      "dropUnusableVolunteeredTimeRamps",
      "earlyLeastBadPublishReason",
      "ensureHostCompileOrdering",
      "ensureRuntimeScriptOrdering",
      "evaluateLoadBearingContainmentAdoption",
      "findingSignature",
      "hedgedCompletion",
      "hedgingEnabled",
      "inferStoryboardPlanRequirements",
      "injectBrandBase",
      "injectDisplayTypeMoments",
      "injectLayoutIntentHints",
      "injectMissingLivenessBeats",
      "injectWorldLayoutStyles",
      "measuredArtSignalPenalty",
      "mergeEmbeddedDevelopmentScenes",
      "normalizeWorldLayout",
      "parseCompositionResponse",
      "parseStoryboardResponse",
      "parseStoryboardShapeHint",
      "quarantineFailedInteractions",
      "quoteBareCssVarsInInlineScripts",
      "reconcileCameraWorldPlanes",
      "reconcileComponentBindings",
      "reconcileComponentInternalPartAliases",
      "reconcileContractBindings",
      "reconcileInteractionTargets",
      "reconcileUndeclaredMorphTargets",
      "recoverPersistedStoryboardAttempt",
      "rehomeRegionComponents",
      "repairContrastAaIssues",
      "repairMalformedFromToCalls",
      "repairSlotDraftForFindings",
      "repairStationPositioning",
      "repairStoryboardScenesForFindings",
      "repairStrategyAfterStaticRejection",
      "requestConceptDirection",
      "requestDirectComposition",
      "requestStoryboardPlan",
      "requestStoryboardShape",
      "retimeUnmotivatedTimeRamps",
      "rewriteDegradedCutStoryboard",
      "runSourceNormalizerRegistry",
      "runSourceSyntaxNormalizerRegistry",
      "sceneSkeletonOpenTag",
      "slotDirectorPrompt",
      "slotScaffoldViolations",
      "sourceRetryFeedbackForBrowserQa",
      "stagnantPolishShipReason",
      "stagnantPolishSignature",
      "storyboardFindingDecision",
      "storyboardResponseFormat",
      "storyboardShapeScaffold",
      "stripAllHostPlanIslands",
      "stripHostKitAssetReferences",
      "stripInvalidSvgPathPlaceholders",
      "stripUnboundConnectorSvgs",
      "stripUnusedHostPlanIslands",
      "topUpChartMarkup",
      "topUpProgressMarkup",
      "topUpRowsMarkup",
      "topUpUnderlineMarkup",
      "unresolvedHardBrowserFindings",
      "validateStoryboardPlan",
      "volunteeredCutBoundaries",
    ]);
  });

  it("keeps raw parsers internal and preserves audit export identity", () => {
    const movedExports = [
      "normalizeWorldLayout",
      "completeStoryboardWorldLayouts",
      "mergeEmbeddedDevelopmentScenes",
      "autoStyleSemanticHighlights",
      "deriveDiveWindows",
      "autoStyleHeadlineReveals",
      "auditDisplayTypeBudget",
      "validateStoryboardPlan",
      "auditShapeMatchHints",
      "auditDiveInteractions",
      "degradeMismatchedShapeHintCuts",
      "degradeUnsupportedComponentBeats",
      "reconcileUndeclaredMorphTargets",
      "retimeUnmotivatedTimeRamps",
      "dropUnusableVolunteeredTimeRamps",
      "StoryboardValidationError",
      "parseStoryboardResponse",
      "parseCompositionResponse",
    ] as const;
    for (const name of movedExports) {
      expect(legacyRunner[name], `${name} legacy identity`).toBe(directStoryboardAudit[name]);
      expect(runner[name], `${name} barrel identity`).toBe(directStoryboardAudit[name]);
    }
    expect("extractStoryboardSource" in legacyRunner).toBe(false);
    expect("extractIndexHtmlSource" in legacyRunner).toBe(false);

    const plan = [{ id: "cold-open", title: "Open" }];
    expect(JSON.parse(extractStoryboardSource(JSON.stringify({ storyboard: plan })))).toEqual(plan);
    expect(JSON.parse(extractStoryboardSource(`plan:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``)))
      .toEqual(plan);
    expect(() => extractStoryboardSource('```json\n{"storyboard":[{"id":"cold-open"}'))
      .toThrow(/truncated/i);
    expect(() => extractStoryboardSource('[{"id":"cold-open"}'))
      .toThrow(/truncated/i);
    expect(() => extractStoryboardSource("I could not create a plan"))
      .toThrow(/missing <storyboard_json>/i);
    expect(extractIndexHtmlSource("preface\n```html\n<html><body>proof</body></html>\n```"))
      .toBe("<html><body>proof</body></html>");
    expect(() => extractIndexHtmlSource("<index_html><html>unfinished"))
      .toThrow(/truncated/i);
  });

  it("reactivates persisted scene-slot arrow envelopes without touching ordinary scene bodies", () => {
    const persisted = `<script>
const tl = gsap.timeline({ paused: true });
(function (tl) {
/* Scene window: 4-8s. */
(tl) => {
  const root = document.querySelector("#proof");
  tl.to(root, { opacity: 1, duration: 0.4 }, 4.2);
}
})(tl);
(function (tl) {
  tl.to("#cta", { opacity: 1, duration: 0.4 }, 8.2);
})(tl);
</script>`;
    const repaired = directRepairs.unwrapPersistedSceneSlotArrows(persisted);
    expect(repaired.repairs).toBe(1);
    expect(repaired.html).not.toContain("(tl) => {");
    expect(repaired.html).toContain('const root = document.querySelector("#proof");');
    expect(repaired.html).toContain('tl.to("#cta", { opacity: 1, duration: 0.4 }, 8.2);');
  });

  it("preserves deterministic repair and registry export identity", () => {
    const movedExports = [
      "reconcileInteractionTargets",
      "injectWorldLayoutStyles",
      "reconcileCameraWorldPlanes",
      "reconcileContractBindings",
      "topUpRowsMarkup",
      "topUpUnderlineMarkup",
      "topUpChartMarkup",
      "topUpProgressMarkup",
      "stripUnusedHostPlanIslands",
      "HOST_PLAN_ISLAND_IDS",
      "stripAllHostPlanIslands",
      "injectLayoutIntentHints",
      "reconcileComponentBindings",
      "reconcileComponentInternalPartAliases",
      "repairContrastAaIssues",
      "correctLoadBearingContainment",
      "correctSparseFraming",
      "addressedPartsForLayoutRepair",
      "correctLayoutOverflow",
      "evaluateLoadBearingContainmentAdoption",
      "injectMissingLivenessBeats",
      "stripHostKitAssetReferences",
      "ensureRuntimeScriptOrdering",
      "ensureHostCompileOrdering",
      "repairMalformedFromToCalls",
      "quoteBareCssVarsInInlineScripts",
      "stripInvalidSvgPathPlaceholders",
      "stripUnboundConnectorSvgs",
      "repairStationPositioning",
      "brandBaseStyleBlock",
      "injectBrandBase",
      "injectDisplayTypeMoments",
      "NORMALIZERS",
      "SOURCE_SYNTAX_NORMALIZERS",
      "runSourceSyntaxNormalizerRegistry",
      "runSourceNormalizerRegistry",
      "applyDeterministicSourceRepairs",
      "applyCompositionRepair",
      "quarantineFailedInteractions",
      "volunteeredCutBoundaries",
      "repairStrategyAfterStaticRejection",
      "degradeVolunteeredBridgedCuts",
      "rewriteDegradedCutStoryboard",
    ] as const;
    for (const name of movedExports) {
      expect(legacyRunner[name], `${name} legacy identity`).toBe(directRepairs[name]);
      expect(runner[name], `${name} barrel identity`).toBe(directRepairs[name]);
    }
    expect("MAX_REPAIR_PATCHES" in legacyRunner).toBe(false);
    expect("PATCH_RESPONSE_FORMAT" in legacyRunner).toBe(false);
    expect("lockedSceneGraphError" in legacyRunner).toBe(false);
  });

  it("preserves scaffold export identity", () => {
    const movedExports = [
      "sceneSkeletonOpenTag",
      "buildSceneSkeletons",
      "countScaffoldedBindings",
      "countScaffoldBindingsPresent",
      "buildSceneSlotInteriors",
      "slotScaffoldViolations",
    ] as const;
    for (const name of movedExports) {
      expect(legacyRunner[name], `${name} legacy identity`).toBe(directScaffold[name]);
      expect(runner[name], `${name} barrel identity`).toBe(directScaffold[name]);
    }
    expect("skeletonContext" in legacyRunner).toBe(false);
    expect("worldStationRects" in legacyRunner).toBe(false);
  });

  it("preserves prompt identity while keeping critic parsing internal and bounded", () => {
    const movedExports = [
      "authorStoryboardProjection",
      "SLOT_MODE_DIRECTOR_REWRITES",
      "adaptDirectorPromptForSlots",
      "slotDirectorPrompt",
      "creationPrompt",
    ] as const;
    for (const name of movedExports) {
      expect(legacyRunner[name], `${name} legacy identity`).toBe(directPrompts[name]);
      expect(runner[name], `${name} barrel identity`).toBe(directPrompts[name]);
    }
    expect("parseCritique" in legacyRunner).toBe(false);
    expect("CRITIC_RESPONSE_FORMAT" in legacyRunner).toBe(false);

    const directives = Array.from({ length: 7 }, (_, index) => `repair ${index + 1}`);
    expect(directPrompts.parseCritique(JSON.stringify({ verdict: "repair", directives })))
      .toEqual(directives.slice(0, 5));
    expect(directPrompts.CRITIC_RESPONSE_FORMAT.type).toBe("json_schema");
    if (directPrompts.CRITIC_RESPONSE_FORMAT.type !== "json_schema") {
      throw new Error("critic response format must remain a JSON schema");
    }
    const schema = directPrompts.CRITIC_RESPONSE_FORMAT.json_schema.schema as {
      properties: { directives: { maxItems: number } };
    };
    expect(schema.properties.directives.maxItems).toBe(5);
  });

  it("preserves provider, planning, author, and critic-ladder export identity", () => {
    const movedExports = [
      "hedgingEnabled",
      "hedgedCompletion",
      "requestConceptDirection",
      "STORYBOARD_SHAPES",
      "defaultShapeForBrief",
      "storyboardShapeScaffold",
      "parseStoryboardShapeHint",
      "requestStoryboardShape",
      "inferStoryboardPlanRequirements",
      "recoverPersistedStoryboardAttempt",
      "repairStoryboardScenesForFindings",
      "requestStoryboardPlan",
      "authorSlotDraft",
      "repairSlotDraftForFindings",
    ] as const;
    for (const name of movedExports) {
      expect(legacyRunner[name], `${name} legacy identity`).toBe(directLadder[name]);
      expect(runner[name], `${name} barrel identity`).toBe(directLadder[name]);
    }
    expect("authorComposition" in legacyRunner).toBe(false);
    expect("applyContinuityCritique" in legacyRunner).toBe(false);
    expect("persistUpgradedStoryboard" in legacyRunner).toBe(false);
    expect("adoptCriticCandidate" in legacyRunner).toBe(false);
  });

  it("preserves the public orchestration entrypoint identity", () => {
    expect(legacyRunner.requestDirectComposition)
      .toBe(directOrchestration.requestDirectComposition);
    expect(runner.requestDirectComposition)
      .toBe(directOrchestration.requestDirectComposition);
    expect("applyShapeMatchUpgrade" in legacyRunner).toBe(false);
    expect("reconcileDegradedCutPaperwork" in legacyRunner).toBe(false);
  });

  it("rejects critic candidates on missing/infra/hard/regressed browser evidence", () => {
    const clean = {
      ok: true,
      strictOk: true,
      samples: [],
      issues: [],
      errors: [],
      warnings: [],
    } as unknown as DirectBrowserQaResult;
    expect(browserQualityNonRegression({ before: undefined, after: clean }).reason)
      .toBe("baseline-missing");
    expect(browserQualityNonRegression({
      before: clean,
      after: { ...clean, ok: false, infraError: "browser unavailable" },
    }).reason).toBe("infrastructure");
    expect(browserQualityNonRegression({
      before: clean,
      after: { ...clean, ok: false, errors: ["runtime"] },
    }).reason).toBe("hard-failure");
    const regressed = {
      ...clean,
      strictOk: false,
      issues: [{ code: "camera_blocking_landing", severity: "warning" }],
    } as unknown as DirectBrowserQaResult;
    expect(browserQualityNonRegression({ before: clean, after: regressed })).toMatchObject({
      accepted: false,
      beforePenalty: 0,
      afterPenalty: 8,
      reason: "quality-regression",
    });
    expect(browserQualityNonRegression({ before: regressed, after: clean })).toMatchObject({
      accepted: true,
      beforePenalty: 8,
      afterPenalty: 0,
    });

    const before = {
      draft: { storyboard: [], html: "<html>baseline</html>" },
      raw: "baseline",
      attempts: 1,
      browserQa: regressed,
    } as CompositionRunResult;
    const candidateDraft = { storyboard: [], html: "<html>candidate</html>" };
    const adoption = directLadder.adoptCriticCandidate({
      projectDir: ".",
      before,
      draft: candidateDraft,
      browserQa: clean,
      staticRepairWarnings: [],
      requireVisualEvidence: false,
    });
    expect(adoption).toMatchObject({
      accepted: true,
      beforePenalty: 8,
      afterPenalty: 0,
      result: { draft: candidateDraft, browserQa: clean },
    });

    const visualBaseline = {
      ...before,
      browserQa: {
        ...regressed,
        visionCriticEvidence: {
          evidenceHash: "baseline",
          draftHash: visionCriticDraftHash(".", before.draft),
        },
      } as unknown as DirectBrowserQaResult,
    };
    expect(directLadder.adoptCriticCandidate({
      projectDir: ".",
      before: visualBaseline,
      draft: candidateDraft,
      browserQa: clean,
      staticRepairWarnings: [],
      requireVisualEvidence: true,
    })).toMatchObject({
      accepted: false,
      reason: "candidate-visual-evidence-missing",
      beforePenalty: 8,
      afterPenalty: 0,
    });
    const mismatchedBaseline = {
      ...visualBaseline,
      browserQa: {
        ...regressed,
        visionCriticEvidence: { draftHash: "0".repeat(64) },
      } as unknown as DirectBrowserQaResult,
    };
    expect(directLadder.adoptCriticCandidate({
      projectDir: ".",
      before: mismatchedBaseline,
      draft: candidateDraft,
      browserQa: clean,
      staticRepairWarnings: [],
      requireVisualEvidence: true,
    })).toMatchObject({
      accepted: false,
      reason: "visual-baseline-draft-mismatch",
      beforePenalty: 8,
      afterPenalty: 0,
    });
    expect(directLadder.adoptCriticCandidate({
      projectDir: ".",
      before: visualBaseline,
      draft: candidateDraft,
      browserQa: {
        ...clean,
        visionCriticEvidence: { draftHash: "0".repeat(64) },
      } as unknown as DirectBrowserQaResult,
      staticRepairWarnings: [],
      requireVisualEvidence: true,
    })).toMatchObject({
      accepted: false,
      reason: "candidate-visual-draft-mismatch",
      beforePenalty: 8,
      afterPenalty: 0,
    });
  });

  it("pins the serialized structured-storyboard schema", () => {
    expect(storyboardResponseFormat).toBe(directStoryboardResponseFormat);
    expect(runner.storyboardResponseFormat).toBe(directStoryboardResponseFormat);
    const hash = createHash("sha256")
      .update(JSON.stringify(storyboardResponseFormat()))
      .digest("hex");
    expect(hash).toBe("df74c6a6eb86c48e2970f528dfaea5e550d0bc7c607972cb505eef8fe3d3f057");
  });

  it("preserves public quality/signature exports and their exact scoring", () => {
    expect(browserQualityPenalty).toBe(directBrowserQualityPenalty);
    expect(runner.browserQualityPenalty).toBe(directBrowserQualityPenalty);
    expect(findingSignature).toBe(directFindingSignature);
    expect(runner.findingSignature).toBe(directFindingSignature);

    const qa = {
      ok: true,
      strictOk: false,
      warnings: ["browser_warning: deprecated api"],
      issues: [{ code: "camera_framed_sparse", severity: "warning" }],
    } as unknown as DirectBrowserQaResult;
    expect(browserQualityPenalty(qa, ["frame: repaired contrast"])).toBe(10);
    expect(findingSignature("cut_degraded: shape-match opener->proof compiled as crossfade"))
      .toBe("cut_degraded:opener->proof");
  });
});
