/**
 * Provider-agnostic direct HyperFrames authoring. The model writes the actual
 * composition source; deterministic validation owns the publication boundary.
 */
export {
  StoryboardValidationError,
  auditDisplayTypeBudget,
  auditDiveInteractions,
  auditShapeMatchHints,
  autoStyleHeadlineReveals,
  autoStyleSemanticHighlights,
  completeStoryboardWorldLayouts,
  degradeMismatchedShapeHintCuts,
  degradeUnsupportedComponentBeats,
  deriveDiveWindows,
  dropUnusableVolunteeredTimeRamps,
  mergeEmbeddedDevelopmentScenes,
  normalizeWorldLayout,
  parseCompositionResponse,
  parseStoryboardResponse,
  reconcileUndeclaredMorphTargets,
  retimeUnmotivatedTimeRamps,
  storyboardFindingDecision,
  validateStoryboardPlan,
} from "./runner/storyboardAudit.ts";
export type {
  CompletedStoryboardWorldLayouts,
  StoryboardPlanRequirements,
  WorldLayoutCompletion,
} from "./runner/storyboardAudit.ts";
export {
  HOST_PLAN_ISLAND_IDS,
  NORMALIZERS,
  SOURCE_SYNTAX_NORMALIZERS,
  addressedPartsForLayoutRepair,
  applyCompositionRepair,
  applyDeterministicSourceRepairs,
  brandBaseStyleBlock,
  correctLoadBearingContainment,
  correctLayoutOverflow,
  correctSparseFraming,
  degradeVolunteeredBridgedCuts,
  ensureHostCompileOrdering,
  ensureRuntimeScriptOrdering,
  evaluateLoadBearingContainmentAdoption,
  injectBrandBase,
  injectDisplayTypeMoments,
  injectLayoutIntentHints,
  injectMissingLivenessBeats,
  injectWorldLayoutStyles,
  quarantineFailedInteractions,
  quoteBareCssVarsInInlineScripts,
  reconcileCameraWorldPlanes,
  reconcileComponentBindings,
  reconcileComponentInternalPartAliases,
  reconcileContractBindings,
  reconcileInteractionTargets,
  rehomeRegionComponents,
  repairContrastAaIssues,
  repairMalformedFromToCalls,
  repairStationPositioning,
  repairStrategyAfterStaticRejection,
  rewriteDegradedCutStoryboard,
  runSourceNormalizerRegistry,
  runSourceSyntaxNormalizerRegistry,
  stripAllHostPlanIslands,
  stripHostKitAssetReferences,
  stripInvalidSvgPathPlaceholders,
  stripUnboundConnectorSvgs,
  stripUnusedHostPlanIslands,
  topUpChartMarkup,
  topUpProgressMarkup,
  topUpRowsMarkup,
  topUpUnderlineMarkup,
  volunteeredCutBoundaries,
} from "./runner/repairs.ts";
export type { SourceNormalizerContext } from "./runner/repairs.ts";
export {
  buildSceneSkeletons,
  buildSceneSlotInteriors,
  countScaffoldBindingsPresent,
  countScaffoldedBindings,
  sceneSkeletonOpenTag,
  slotScaffoldViolations,
} from "./runner/scaffold.ts";
export {
  SLOT_MODE_DIRECTOR_REWRITES,
  adaptDirectorPromptForSlots,
  authorStoryboardProjection,
  creationPrompt,
  slotDirectorPrompt,
} from "./runner/prompts.ts";
export {
  STORYBOARD_SHAPES,
  authorSlotDraft,
  defaultShapeForBrief,
  hedgedCompletion,
  hedgingEnabled,
  inferStoryboardPlanRequirements,
  parseStoryboardShapeHint,
  recoverPersistedStoryboardAttempt,
  repairSlotDraftForFindings,
  repairStoryboardScenesForFindings,
  requestConceptDirection,
  requestStoryboardPlan,
  requestStoryboardShape,
  storyboardShapeScaffold,
} from "./runner/ladder.ts";
export type {
  ConceptDirection,
  StoryboardShape,
  StoryboardShapeHint,
  StoryboardShapeSegment,
} from "./runner/ladder.ts";
export { requestDirectComposition } from "./runner/orchestration.ts";
export { storyboardResponseFormat } from "./runner/storyboardResponseFormat.ts";
export type { CompositionRunResult } from "./runner/types.ts";
export {
  dedupeFeedbackBySignature,
  findingSignature,
} from "./runner/findingSignatures.ts";
export {
  browserQualityPenalty,
  browserQaHasUnresolvedHardFailure,
  criticSkippableCleanDraft,
  earlyLeastBadPublishReason,
  measuredArtSignalPenalty,
  sourceRetryFeedbackForBrowserQa,
  stagnantPolishShipReason,
  stagnantPolishSignature,
  unresolvedHardBrowserFindings,
} from "./runner/browserQuality.ts";
