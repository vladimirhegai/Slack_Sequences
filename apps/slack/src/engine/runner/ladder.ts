import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  ProviderOutputTruncatedError,
  type AgentProvider,
  type CompleteOptions,
} from "@sequences/platform/providers";
import type { RetrievedSkillContext } from "../../agent/skillContext.ts";
import {
  validateDirectComposition,
  type DirectCompositionDraft,
  type DirectScene,
} from "../directComposition.ts";
import {
  inspectDirectComposition,
  publishCanonicalVisionEvidence,
  visionCriticDraftHash,
  type DirectBrowserQaResult,
} from "../layoutInspector.ts";
import { continuityGraphEnabled } from "../continuityGraph.ts";
import { CAMERA_PATTERNS } from "../cameraPatterns.ts";
import { ASSET_LIBRARY } from "../assets/index.ts";
import { correctEyeTracePingPong } from "../eyeTraceRepair.ts";
import {
  componentPlanningVocabulary,
  type ComponentKind,
} from "../componentContract.ts";
import { resolveMomentContract } from "../storyboardMoments.ts";
import { analyzeMotionDensity } from "../motionDensity.ts";
import { frameCapsule } from "../frameDesign.ts";
import { parseFrameBasis } from "../frameValidation.ts";
import {
  activeSentinelLedgerEvents,
  appendSentinelLedgerEvent,
  boundedCreatePolicyActive,
  claimSentinelHedge,
  recordSentinelDegradation,
  recordSentinelLayerFinding,
  recordSentinelModelCall,
  recordSentinelModelCallFailure,
  recordSentinelNormalization,
  recordSentinelScaffoldRestoration,
  recordSentinelSlotCall,
  reserveSentinelModelCall,
  type SentinelSlotCallKind,
} from "../sentinelTelemetry.ts";
import {
  assetsEnabled,
  criticSkipCleanEnabled,
  criticSlotRepairEnabled,
  recipesEnabled,
  sentinelSlotsEnabled,
  storyboardSceneRepairEnabled,
} from "../sentinelFlags.ts";
import {
  autoDeclareHighConfidenceRecipes,
  loadRecipeLibrary,
} from "../recipeContract.ts";
import {
  autoDeclareHighConfidenceAssets,
  recordStudioCatalogConversions,
} from "../studioLibrary.ts";
import { pluginPlanningVocabulary } from "../pluginContract.ts";
import {
  assembleSlotComposition,
  attributeFindingsToScenes,
  extractSceneSlots,
  type ParsedSceneSlots,
} from "../sceneSlots.ts";
import {
  cleanCriticSkipAllowed,
  visionCriticEnabled,
  visionCriticReviewInputs,
} from "./visionCritic.ts";
import {
  extractIndexHtmlSource,
  extractStoryboardSource,
} from "./parse.ts";
import {
  StoryboardValidationError,
  acceptedStoryboardDegradations,
  completeStoryboardWorldLayouts,
  parseCompositionResponse,
  parseStoryboardResponse,
  reportWorldLayoutCompletions,
  storyboardProductionBasis,
  validateStoryboardPlan,
  type StoryboardPlanRequirements,
} from "./storyboardAudit.ts";
import {
  PATCH_RESPONSE_FORMAT,
  applyCompositionRepair,
  applyDeterministicSourceRepairs,
  browserInteractionIssues,
  correctLoadBearingContainment,
  correctLayoutOverflow,
  correctSparseFraming,
  degradeVolunteeredBridgedCuts,
  evaluateLoadBearingContainmentAdoption,
  lockedSceneGraphError,
  quarantineStaticInteractionErrors,
  recoverByQuarantiningInteractions,
  repairCompositionWashoutIssues,
  repairContrastAaIssues,
  repairStrategyAfterStaticRejection,
  volunteeredCutBoundaries,
} from "./repairs.ts";
import { slotScaffoldViolations } from "./scaffold.ts";
import {
  assertAuthorPromptBudget,
  COMPOSITION_SOURCE_BUDGET_CHARS,
  CRITIC_MAX_DIRECTIVES,
  CRITIC_RESPONSE_FORMAT,
  availableAssets,
  creationPrompt,
  isAuthorPromptBudgetError,
  parseCritique,
  slotContinuationPrompt,
} from "./prompts.ts";
import { storyboardResponseFormat } from "./storyboardResponseFormat.ts";
import type { CompositionRunResult, DirectCompositionArgs } from "./types.ts";
import {
  dedupeFeedbackBySignature,
  findingSignature,
} from "./findingSignatures.ts";
import {
  browserQualityPenalty,
  browserQualityNonRegression,
  browserQaHasUnresolvedHardFailure,
  criticSkippableCleanDraft,
  earlyLeastBadPublishReason,
  hasNoNewDiagnostics,
  layoutRepairIssueScore,
  layoutRepairTargetScore,
  protectedLayoutIssuesIncreased,
  sourceRetryFeedbackForBrowserQa,
  stagnantPolishShipReason,
  stagnantPolishSignature,
  unresolvedHardBrowserFindings,
} from "./browserQuality.ts";
import {
  creativeModel,
  creativeThinkingMode,
  lightModel,
  productionModel,
  sourceRescueModel,
  sourceRescueThinkingMode,
  storyboardRescueModel,
  thinkingOverride,
  visionCriticModelRoute,
} from "../modelPolicy.ts";
import { slackSequencesEnvRawValue } from "../featureFlags.ts";

// 8k, not 4k: fix-probe-2 (and plugin-probe-1 before it) burned its FINAL
// author attempt on a compact patch truncating at the 4096 output-token
// ceiling — a config death, not a model one. Patches are still an order of
// magnitude cheaper than a full re-author.
const REPAIR_MAX_TOKENS = 8_192;
// Camera-era storyboards carry typed camera paths and more shots, so the
// compact JSON artifact needs more room than the pre-rig 4K ceiling.
const STORYBOARD_MAX_TOKENS = 6_144;
// GLM spends this shared budget on reasoning before the JSON artifact.
// OpenRouter currently exposes a 32,768-token completion ceiling for GLM 5.2;
// reserving almost all of it prevents a good long think from truncating the
// actual storyboard at the old 16K application cap.
const REASONING_STORYBOARD_MAX_TOKENS = 30_720;
// The scene-scoped storyboard repair rewrites only a few shots against a locked
// remainder, so it needs far less than the full artifact budget — capping it
// (plus low reasoning) is what makes it a CHEAPER substitute for a whole re-plan
// rather than an equally slow one.
const STORYBOARD_SCENE_REPAIR_MAX_TOKENS = 16_384;
const MAX_AUTHOR_SEGMENTS = 3;



function supportsStructuredOutputs(provider: AgentProvider): boolean {
  return provider.id === "openrouter-api" || provider.id === "openai-api";
}

/**
 * Output-token budget for the authoring call. A full composition (storyboard +
 * a complete index.html with rich scenes and GSAP) far exceeds the ~4096-token
 * default that DeepSeek-style chat models apply when none is requested — without
 * this the response truncates mid-document and the tag parse fails. Override with
 * SEQUENCES_MAX_OUTPUT_TOKENS if a deliberately complex composition needs more.
 */
function authorMaxTokens(): number {
  const parsed = Number(process.env.SEQUENCES_MAX_OUTPUT_TOKENS);
  return Number.isFinite(parsed) && parsed >= 4096 ? Math.floor(parsed) : 12_288;
}

/**
 * Keep the expensive model for the first creative pass. Once deterministic QA
 * names a concrete defect, a fast/cheap model can repair the existing source
 * without re-directing the film.
 */
function repairModel(_provider: AgentProvider): string | undefined {
  const configured = slackSequencesEnvRawValue("SLACK_SEQUENCES_REPAIR_MODEL")?.trim();
  if (configured) return configured;
  // Structural repair stays on the configured primary model. Cursor endpoints,
  // ripple origins, safe target points, and other mechanical geometry are owned
  // by deterministic helpers and should not consume a second provider call.
  // Operators may explicitly opt into a different patch model, including
  // OpenAI, but it is never the default.
  return undefined;
}

function repairThinkingMode(model: string | undefined): CompleteOptions["thinkingMode"] {
  // OpenRouter's GPT-5 endpoints require reasoning to be enabled. Minimal
  // effort preserves nearly all of the small completion budget for patch JSON.
  return model && /(?:^|\/)gpt-5(?:[.-]|$)/i.test(model) ? "minimal" : "none";
}

/**
 * The storyboard is a required, high-leverage production artifact rather than
 * an optional cheap classification. OpenRouter gets one reasoning-enabled GLM
 * director call; operators can pin any other model or select "primary". The
 * old implicit Flash override was the common root of wrapper drift and exact
 * 3,072-token truncation failures in production.
 */
function storyboardModel(provider: AgentProvider): string | undefined {
  return creativeModel(
    provider,
    slackSequencesEnvRawValue("SLACK_SEQUENCES_STORYBOARD_MODEL"),
  );
}

function storyboardThinkingMode(
  provider: AgentProvider,
  model: string | undefined,
): CompleteOptions["thinkingMode"] {
  const override = thinkingOverride("SLACK_SEQUENCES_STORYBOARD_THINKING");
  if (override) return override;
  const creative = creativeThinkingMode(provider, model);
  // The cached concept pass already spends high effort on taste. Storyboard
  // expansion is a large strict artifact; medium preserves deliberation while
  // reserving budget/time for the JSON that the source author needs.
  return creative === "high" ? "medium" : creative;
}

/**
 * The rescue rung's reasoning effort. The benched rescue model passed the full
 * contract at medium (2026-07-03 matrix), and a rescue pass exists precisely
 * because the strict artifact needs deliberation — never inherit the primary
 * model's mode.
 */
function storyboardRescueThinkingMode(): CompleteOptions["thinkingMode"] {
  return thinkingOverride("SLACK_SEQUENCES_STORYBOARD_RESCUE_THINKING") ?? "medium";
}

/**
 * The scene-scoped repair's reasoning effort. It edits a few shots against a
 * locked remainder with each finding naming its own fix, so it earns a *lower*
 * effort than a from-scratch storyboard pass — that is the wall-clock lever
 * (minimal reasoning + a small artifact + a compact prompt). If minimal effort
 * fails to converge, the repair returns undefined and the full-reasoning ladder
 * takes over, so quality is never traded for the latency win.
 */
function storyboardSceneRepairThinkingMode(): CompleteOptions["thinkingMode"] {
  return thinkingOverride("SLACK_SEQUENCES_STORYBOARD_SCENE_REPAIR_THINKING") ?? "minimal";
}

/**
 * Full-document source emission defaults to reasoning off — DeepSeek-style
 * models spend the whole budget on source, not deliberation. The override
 * exists so operators can measure whether a reasoning pass earns its latency.
 */
function authorThinkingMode(): CompleteOptions["thinkingMode"] {
  return thinkingOverride("SLACK_SEQUENCES_AUTHOR_THINKING") ?? "none";
}

function isOutputTruncation(error: unknown): boolean {
  return error instanceof ProviderOutputTruncatedError ||
    (error instanceof Error && /truncat|output-token limit|finish_reason.?length/i.test(error.message));
}

/**
 * Some OpenRouter endpoints (Kimi K2.7, GPT-5 tiers) reject `reasoning: none`
 * with an HTTP 400. The retry loops downgrade reasoning on recovery passes to
 * protect the completion budget, so this must be detected reactively — the
 * next attempt keeps a minimal reasoning floor instead of failing the stage.
 */
function isReasoningMandatoryError(error: unknown): boolean {
  return error instanceof Error && /reasoning is mandatory/i.test(error.message);
}

function appendContinuation(prefix: string, continuation: string): string {
  if (!prefix) return continuation;
  if (!continuation) return prefix;
  if (continuation.startsWith(prefix)) return continuation;
  const maxOverlap = Math.min(prefix.length, continuation.length, 16_000);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (prefix.endsWith(continuation.slice(0, size))) {
      return prefix + continuation.slice(size);
    }
  }
  return prefix + continuation;
}


/**
 * OpenRouter can return a useful partial artifact with finish_reason=length.
 * Continue that exact assistant prefix instead of discarding it and spending a
 * validation attempt regenerating the same first segment. This makes complete
 * HTML authoring independent of a route's per-completion output ceiling.
 */
async function completeSourceWithContinuation(
  provider: AgentProvider,
  prompt: string,
  options: CompleteOptions,
): Promise<string> {
  let accumulated = "";
  let lastTruncation: ProviderOutputTruncatedError | undefined;
  for (let segment = 1; segment <= MAX_AUTHOR_SEGMENTS; segment += 1) {
    try {
      // Long HTML generations can be actively producing tokens while an
      // OpenRouter route's non-streaming proxy reports an upstream idle
      // timeout. Consume the stream when the provider exposes it; the helper
      // still returns only the final accumulated text and preserves
      // ProviderOutputTruncatedError partials for continuation below.
      const output = await completeReasoningWithRetry(provider, prompt, {
        ...options,
        ...(accumulated ? { assistantPrefill: accumulated } : {}),
      }, "author source");
      return appendContinuation(accumulated, output);
    } catch (error) {
      if (
        provider.id !== "openrouter-api" ||
        !(error instanceof ProviderOutputTruncatedError) ||
        !error.partialText
      ) {
        throw error;
      }
      accumulated = appendContinuation(accumulated, error.partialText);
      lastTruncation = error;
      process.stderr.write(
        `[author] source segment ${segment}/${MAX_AUTHOR_SEGMENTS} reached the provider ceiling ` +
          `after ${error.completionTokens ?? "unknown"} tokens; continuing ${accumulated.length} chars\n`,
      );
    }
  }
  throw new ProviderOutputTruncatedError(
    "OpenRouter",
    lastTruncation?.completionTokens,
    accumulated,
  );
}


/**
 * The streaming providers wrap each request in a single wall-clock
 * `AbortSignal.timeout`, so a transient OpenRouter/DeepSeek stall or a dropped
 * connection surfaces as a raw "operation was aborted due to timeout" / "fetch
 * failed". On a one-shot call (the storyboard plan) that aborts the entire build
 * with nothing changed. These are retryable transport faults — a long but healthy
 * generation streams to completion and never trips this.
 */
function isTransientProviderError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /returned an empty completion|aborted due to timeout|operation was aborted|the operation timed out|idle timeout|upstream.*timeout|fetch failed|network|terminated|socket hang ?up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|503|502|429/i.test(
      message,
    )
  );
}

/* -------------------------------------- latency defense: hedge + watchdog */

/**
 * Wall-clock, not quality, is the enemy on OpenRouter: the same request to the
 * same model can take 60s or 360s depending on which upstream route it lands
 * on, and a stalled route silently burns the entire stage timeout before the
 * serial retry fires. Two complementary defenses, both quality-neutral because
 * the deterministic validation/QA gates remain the only arbiter of what ships:
 *
 * 1. Idle watchdog (streaming calls): if the stream produces no delta for
 *    STREAM_IDLE_TIMEOUT_MS, abort and surface a transient "idle timeout" so
 *    the bounded retry replaces a ~6-minute stall with a ~90-second one. A
 *    healthy reasoning stream emits deltas continuously, so this can only
 *    trigger on a genuinely stuck route.
 * 2. Hedged requests: after HEDGE_DELAY_MS a duplicate of the same request is
 *    launched and the first completion wins (the loser is aborted). Both draws
 *    come from the identical model/prompt/params distribution; selection by
 *    arrival time does not change what the QA gates accept. A per-run budget
 *    (default 2, `SLACK_SEQUENCES_HEDGE_MAX_PER_RUN`) prevents a slow run from
 *    duplicating every stage. Kill switch: SLACK_SEQUENCES_HEDGED_REQUESTS=0.
 */
const STREAM_IDLE_TIMEOUT_MS = (() => {
  const raw = Number(slackSequencesEnvRawValue("SLACK_SEQUENCES_STREAM_IDLE_TIMEOUT_MS"));
  return Number.isFinite(raw) && raw >= 10_000 ? raw : 90_000;
})();

const HEDGE_DELAY_MS = (() => {
  const raw = Number(slackSequencesEnvRawValue("SLACK_SEQUENCES_HEDGE_DELAY_MS"));
  return Number.isFinite(raw) && raw >= 0 ? raw : 25_000;
})();

const HEDGE_MAX_PER_RUN = (() => {
  const raw = Number(slackSequencesEnvRawValue("SLACK_SEQUENCES_HEDGE_MAX_PER_RUN"));
  return Number.isInteger(raw) && raw >= 0 ? raw : 2;
})();

export function hedgingEnabled(provider: AgentProvider): boolean {
  return provider.id === "openrouter-api" &&
    slackSequencesEnvRawValue("SLACK_SEQUENCES_HEDGED_REQUESTS") !== "0";
}

/** Abort `controller` when `outer` aborts; returns an unlink cleanup. */
function linkAbort(
  outer: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!outer) return () => {};
  if (outer.aborted) {
    controller.abort(outer.reason);
    return () => {};
  }
  const onAbort = (): void => controller.abort(outer.reason);
  outer.addEventListener("abort", onAbort, { once: true });
  return () => outer.removeEventListener("abort", onAbort);
}

/**
 * Race one primary and one delayed duplicate of the same completion. The
 * duplicate launches only when the primary is still running after the delay —
 * a hedge against a slow route, never a replacement for the serial retry loop
 * (a fast failure rejects immediately so the caller's recovery logic keeps its
 * exact contract). First fulfilled value wins and the loser is aborted
 * mid-stream. A non-transient rejection (truncation, content error) settles
 * the race immediately — it is a property of the request, not the route.
 * `run` must respect its AbortSignal.
 */
export async function hedgedCompletion(
  provider: AgentProvider,
  label: string,
  run: (signal: AbortSignal) => Promise<string>,
  hedgeDelayMs = HEDGE_DELAY_MS,
): Promise<string> {
  if (!hedgingEnabled(provider)) {
    return run(new AbortController().signal);
  }
  return new Promise<string>((resolve, reject) => {
    const controllers = {
      primary: new AbortController(),
      backup: new AbortController(),
    };
    const inFlight = { primary: true, backup: false };
    let settled = false;
    let backupStarted = false;
    const errors: unknown[] = [];
    let timer: NodeJS.Timeout | undefined;

    const settle = (act: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      act();
    };
    const launch = (kind: "primary" | "backup"): void => {
      inFlight[kind] = true;
      const other = kind === "primary" ? "backup" : "primary";
      run(controllers[kind].signal).then(
        (value) => {
          inFlight[kind] = false;
          settle(() => {
            controllers[other].abort();
            if (kind === "backup") {
              appendSentinelLedgerEvent({ kind: "hedge-win", stage: label });
              process.stderr.write(`[${label}] hedged duplicate finished first; using it\n`);
            }
            resolve(value);
          });
        },
        (error: unknown) => {
          inFlight[kind] = false;
          if (settled) return;
          errors.push(error);
          if (!backupStarted) {
            // Fast primary failure: reject now and let the caller's bounded
            // retry loop (with its backoff/recovery semantics) own recovery.
            settle(() => reject(error));
            return;
          }
          if (!isTransientProviderError(error)) {
            // Truncation/content errors reproduce on the duplicate too; waiting
            // for it only delays the caller's real recovery path.
            settle(() => {
              controllers[other].abort();
              reject(error);
            });
            return;
          }
          if (!inFlight[other]) {
            settle(() => reject(errors.find(isOutputTruncation) ?? errors[0]));
          }
        },
      );
    };
    const startBackup = (): void => {
      if (settled || backupStarted || !inFlight.primary) return;
      if (!claimSentinelHedge(label, HEDGE_MAX_PER_RUN)) {
        process.stderr.write(
          `[${label}] slow response — per-run hedge budget (${HEDGE_MAX_PER_RUN}) exhausted; ` +
            `letting the primary continue\n`,
        );
        return;
      }
      backupStarted = true;
      process.stderr.write(
        `[${label}] slow response — hedging with a parallel duplicate request\n`,
      );
      launch("backup");
    };
    launch("primary");
    timer = setTimeout(startBackup, hedgeDelayMs);
  });
}

/**
 * One streaming call guarded by the no-progress watchdog. Converts an idle
 * abort into a transient-classified error message so the retry loops treat a
 * stalled route exactly like a provider timeout.
 */
async function streamOnceWithWatchdog(
  provider: AgentProvider,
  prompt: string,
  options: CompleteOptions,
  label: string,
  raceSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const unlinkOuter = linkAbort(options.signal, controller);
  const unlinkRace = linkAbort(raceSignal, controller);
  let idleTimer: NodeJS.Timeout | undefined;
  let idleAborted = false;
  const armIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleAborted = true;
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  armIdle();
  try {
    return await provider.streamComplete!(
      prompt,
      { ...options, signal: controller.signal },
      () => armIdle(),
      () => armIdle(),
    );
  } catch (error) {
    if (idleAborted) {
      appendSentinelLedgerEvent({ kind: "stream-timeout", stage: label });
      throw new Error(
        `[${label}] stream produced no tokens for ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)}s ` +
          `— aborted as a stalled route idle timeout`,
      );
    }
    throw error;
  } finally {
    clearTimeout(idleTimer);
    unlinkOuter();
    unlinkRace();
  }
}

/**
 * Bounded retry for single-shot provider calls that otherwise have no recovery
 * path. Retries only transient transport faults (never a genuine model/content
 * error), with a short backoff, so a momentary provider hiccup no longer kills a
 * build. Output truncation is NOT transient here — it must surface so the caller
 * can shrink the request rather than blindly replay the same oversized prompt.
 */
async function completeWithRetry(
  provider: AgentProvider,
  prompt: string,
  options: CompleteOptions,
  label: string,
  attempts = 3,
): Promise<string> {
  assertAuthorPromptBudget(prompt, label);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    reserveSentinelModelCall(label);
    try {
      const output = await hedgedCompletion(provider, label, async (raceSignal) => {
        const controller = new AbortController();
        const unlinkOuter = linkAbort(options.signal, controller);
        const unlinkRace = linkAbort(raceSignal, controller);
        try {
          return await provider.complete(prompt, { ...options, signal: controller.signal });
        } finally {
          unlinkOuter();
          unlinkRace();
        }
      });
      recordSentinelModelCall({
        stage: label,
        promptChars: prompt.length,
        completionChars: output.length,
      });
      return output;
    } catch (error) {
      lastError = error;
      recordSentinelModelCallFailure(label);
      if (attempt >= attempts || isOutputTruncation(error) || !isTransientProviderError(error)) {
        throw error;
      }
      process.stderr.write(
        `[${label}] attempt ${attempt}/${attempts} transient provider fault: ` +
          `${error instanceof Error ? error.message : String(error)} — retrying\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    }
  }
  throw lastError;
}

/**
 * Reasoning-heavy OpenRouter calls should use the streaming transport when it
 * exists. GLM can spend minutes thinking before a non-streaming response is
 * returned, which leaves the upstream route idle long enough to be killed even
 * though generation is healthy. Streaming reasoning deltas keeps the route
 * active; the callbacks intentionally discard private reasoning and collect
 * only the provider's final text.
 */
async function completeReasoningWithRetry(
  provider: AgentProvider,
  prompt: string,
  options: CompleteOptions,
  label: string,
  attempts = 3,
): Promise<string> {
  assertAuthorPromptBudget(prompt, label);
  if (!provider.streamComplete) {
    return completeWithRetry(provider, prompt, options, label, attempts);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    reserveSentinelModelCall(label);
    try {
      const output = await hedgedCompletion(provider, label, (raceSignal) =>
        streamOnceWithWatchdog(provider, prompt, options, label, raceSignal));
      recordSentinelModelCall({
        stage: label,
        promptChars: prompt.length,
        completionChars: output.length,
      });
      return output;
    } catch (error) {
      lastError = error;
      recordSentinelModelCallFailure(label);
      if (attempt >= attempts || isOutputTruncation(error) || !isTransientProviderError(error)) {
        throw error;
      }
      process.stderr.write(
        `[${label}] attempt ${attempt}/${attempts} transient streaming fault: ` +
          `${error instanceof Error ? error.message : String(error)} — retrying\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    }
  }
  throw lastError;
}



/**
 * GLM job #1 — concept/arc. One bounded creative artifact chosen before any
 * shots exist: the visual thesis, narrative pressure, energy curve, recurring
 * motif, color arc, and one deliberate risk. It feeds the beat-expansion
 * (storyboard) pass. The concept is taste, not mechanics — a failure here
 * degrades to no concept rather than failing the build.
 */
export interface ConceptDirection {
  thesis: string;
  narrativePressure: string;
  energyCurve: string;
  motif: string;
  colorArc: string;
  creativeRisk: string;
}

const CONCEPT_FIELDS: Array<keyof ConceptDirection> = [
  "thesis",
  "narrativePressure",
  "energyCurve",
  "motif",
  "colorArc",
  "creativeRisk",
];

const CONCEPT_RESPONSE_FORMAT: NonNullable<CompleteOptions["responseFormat"]> = {
  type: "json_schema",
  json_schema: {
    name: "sequences_concept",
    strict: true,
    schema: {
      type: "object",
      properties: Object.fromEntries(
        CONCEPT_FIELDS.map((field) => [field, { type: "string" }]),
      ),
      required: [...CONCEPT_FIELDS],
      additionalProperties: false,
    },
  },
};

function parseConceptDirection(raw: string): ConceptDirection | undefined {
  const source = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  if (start < 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(source.slice(start, source.lastIndexOf("}") + 1));
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const concept = {} as ConceptDirection;
  for (const field of CONCEPT_FIELDS) {
    const entry = object[field];
    if (typeof entry !== "string" || !entry.trim()) return undefined;
    concept[field] = entry.trim().slice(0, 240);
  }
  return concept;
}

export async function requestConceptDirection(
  provider: AgentProvider,
  args: {
    brief: string;
    projectDir: string;
    frameMd?: string;
    options?: CompleteOptions;
  },
): Promise<ConceptDirection | undefined> {
  // Operator kill-switch: the concept pass is a taste enhancement, and some
  // deployments (or deterministic tests) run the storyboard pass directly.
  if (slackSequencesEnvRawValue("SLACK_SEQUENCES_CONCEPT_PASS") === "0") return undefined;
  return requestConceptDirectionUncached(provider, args);
}

/**
 * Planning artifacts (concept / shape hint / storyboard) are already cached
 * per job dir, but job dirs are immutable — a fresh --job-id retry after a
 * SOURCE failure re-paid frame+concept+shape+storyboard for nothing. The keys
 * derive from brief + contract version (never the job id), so a sibling
 * shared cache dir lets a retry (or a user immediately re-running a failed
 * create) reuse the already-paid, already-validated plan.
 * SLACK_SEQUENCES_SHARED_PLANNING_CACHE=0 opts out.
 */
function sharedPlanningCacheFile(
  projectDir: string,
  artifact: string,
  key: string,
): string | undefined {
  if (slackSequencesEnvRawValue("SLACK_SEQUENCES_SHARED_PLANNING_CACHE") === "0") {
    return undefined;
  }
  const root = path.join(path.dirname(path.dirname(path.resolve(projectDir))), "planning-cache");
  return path.join(root, `${artifact}-${key.slice(0, 32)}.json`);
}

/** Read one {version:1, key, …payload} planning artifact; undefined on any mismatch. */
function readPlanningArtifact(
  file: string | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!file || !fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (parsed.version === 1 && parsed.key === key) return parsed;
  } catch {
    // A partial cache from an interrupted write is simply a miss.
  }
  return undefined;
}

/** Best-effort atomic planning-artifact write; cache bookkeeping never breaks a build. */
function writePlanningArtifact(file: string | undefined, payload: object): void {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n", "utf8");
    fs.renameSync(temporary, file);
  } catch {
    // Diagnostics only.
  }
}

async function requestConceptDirectionUncached(
  provider: AgentProvider,
  args: {
    brief: string;
    projectDir: string;
    frameMd?: string;
    options?: CompleteOptions;
  },
): Promise<ConceptDirection | undefined> {
  const model = storyboardModel(provider);
  const thinkingMode = creativeThinkingMode(provider, model);
  const cacheKey = createHash("sha256").update(JSON.stringify({
    contract: 1,
    provider: provider.id,
    model: model ?? null,
    brief: args.brief,
    frameMd: args.frameMd ?? null,
  })).digest("hex");
  const planningDir = path.join(args.projectDir, "planning");
  const cacheFile = path.join(planningDir, "concept.json");
  const sharedFile = sharedPlanningCacheFile(args.projectDir, "concept", cacheKey);
  for (const candidate of [cacheFile, sharedFile]) {
    const cached = readPlanningArtifact(candidate, cacheKey) as
      | { concept?: ConceptDirection }
      | undefined;
    if (cached?.concept) {
      if (candidate === sharedFile) {
        process.stderr.write("[concept] reusing already-paid concept from the shared planning cache\n");
        writePlanningArtifact(cacheFile, { version: 1, key: cacheKey, concept: cached.concept });
      }
      return cached.concept;
    }
  }
  const structuredOutput = supportsStructuredOutputs(provider);
  const prompt = [
    "SYSTEM: You are the creative director of a short SaaS launch film.",
    "Before any shots exist, commit to one concept the whole film will serve.",
    "Think like a motion-design director reviewing a client brief: find the one",
    "visual argument the evidence supports, the tension that keeps it moving,",
    "and the device that makes it feel authored rather than assembled.",
    "Choose exactly these six commitments:",
    '- "thesis": the film\'s visual argument in one sentence.',
    '- "narrativePressure": the tension/problem that drives the edit forward.',
    '- "energyCurve": the pacing arc across the film (e.g. "cold staccato open',
    '  → building density → whip peak → warm still resolve").',
    '- "motif": ONE recurring visual device carried across cuts (a shape, a',
    "  direction, a color field, a typographic behavior, a UI element).",
    '- "colorArc": how the scene grades progress (cold/neutral/warm/noir) and why.',
    '- "creativeRisk": one deliberate, tasteful risk this film takes.',
    "Ground every choice in the brief evidence; never invent product facts.",
    "",
    "## Brief and trusted evidence",
    args.brief,
    "",
    args.frameMd
      ? `## Job frame capsule (art direction system)\n${frameCapsule(args.frameMd)}`
      : "",
    "",
    "## Response contract",
    "Return only a JSON object with exactly those six string fields. No prose.",
  ].filter(Boolean).join("\n");
  try {
    // Streaming transport: the concept pass thinks for tens of seconds on GLM,
    // exactly the profile the idle watchdog + hedging exist for.
    const raw = await completeReasoningWithRetry(provider, prompt, {
      ...args.options,
      timeoutMs: 120_000,
      maxTokens: thinkingMode === "none" ? 1_024 : 8_192,
      thinkingMode,
      ...(structuredOutput ? { responseFormat: CONCEPT_RESPONSE_FORMAT } : {}),
      ...(model ? { model } : {}),
    }, "concept");
    const concept = parseConceptDirection(raw);
    if (!concept) {
      process.stderr.write("[concept] response was not a valid concept artifact; continuing without one\n");
      return undefined;
    }
    writePlanningArtifact(cacheFile, { version: 1, key: cacheKey, concept });
    writePlanningArtifact(sharedFile, { version: 1, key: cacheKey, concept });
    return concept;
  } catch (error) {
    process.stderr.write(
      `[concept] pass unavailable (${error instanceof Error ? error.message : String(error)}); ` +
        "continuing without a concept artifact\n",
    );
    return undefined;
  }
}

/* --------------------------------------------------- storyboard shape hint */

export interface StoryboardShapeSegment {
  /** Narrative role, e.g. "problem", "product proof", "CTA resolve". */
  role: string;
  /** Share of the film's runtime this segment owns (weights sum to 1). */
  weight: number;
}

export interface StoryboardShape {
  id: string;
  /** Segment skeleton, human-readable. */
  label: string;
  /** What kind of brief this shape serves. */
  best: string;
  /** Typed segments — the duration-scaffold arithmetic source. */
  segments: StoryboardShapeSegment[];
}

/**
 * Curated narrative skeletons. Deliberately structural — pacing and segment
 * order only, zero visual/creative vocabulary — so the small selector model
 * is never in charge of taste.
 */
export const STORYBOARD_SHAPES: readonly StoryboardShape[] = [
  {
    id: "problem-turn-product-cta",
    label: "problem (short) → turn (short) → product proof (long, held & developed) → CTA resolve (short)",
    best: "pain-led briefs where the product resolves a named workflow problem",
    segments: [
      { role: "problem", weight: 0.17 },
      { role: "turn", weight: 0.12 },
      { role: "product proof (held & developed)", weight: 0.54 },
      { role: "CTA resolve", weight: 0.17 },
    ],
  },
  {
    id: "hook-demo-payoff",
    label: "cold hook (short) → guided product demo (long, held & developed) → payoff metric + CTA (medium)",
    best: "feature launches whose UI walkthrough is the star",
    segments: [
      { role: "cold hook", weight: 0.15 },
      { role: "guided product demo (held & developed)", weight: 0.6 },
      { role: "payoff metric + CTA", weight: 0.25 },
    ],
  },
  {
    id: "stat-proof-tour",
    label: "hero stat (medium) → proof tour across product surfaces (long, one held framing per surface) → brand resolve (short)",
    best: "metric- or performance-led stories",
    segments: [
      { role: "hero stat", weight: 0.22 },
      { role: "proof tour (one held framing per surface)", weight: 0.6 },
      { role: "brand resolve", weight: 0.18 },
    ],
  },
  {
    id: "feature-triptych",
    label: "three feature vignettes (equal, medium) → unifying claim + CTA (medium)",
    best: "multi-feature releases with no single hero feature",
    segments: [
      { role: "feature vignette 1", weight: 0.26 },
      { role: "feature vignette 2", weight: 0.26 },
      { role: "feature vignette 3", weight: 0.26 },
      { role: "unifying claim + CTA", weight: 0.22 },
    ],
  },
  {
    id: "before-after",
    label: "before state (medium) → transformation beat (short) → after state (medium) → CTA (short)",
    best: "workflow-transformation stories with a clear old-way/new-way contrast",
    segments: [
      { role: "before state", weight: 0.3 },
      { role: "transformation beat", weight: 0.12 },
      { role: "after state", weight: 0.34 },
      { role: "CTA", weight: 0.24 },
    ],
  },
  {
    id: "crescendo-reveal",
    label: "quiet claim (short) → building evidence (medium) → energetic peak reveal (medium) → still resolve (short)",
    best: "brand-forward launches built around one big reveal",
    segments: [
      { role: "quiet claim", weight: 0.15 },
      { role: "building evidence", weight: 0.3 },
      { role: "energetic peak reveal", weight: 0.35 },
      { role: "still resolve", weight: 0.2 },
    ],
  },
];

/**
 * Deterministic default when the light-model shape hint is disabled or
 * failed: a keyword sniff over the brief, never a model. The scaffold must
 * ALWAYS exist — duration lives in the template, not in a validation gate.
 */
export function defaultShapeForBrief(brief: string): StoryboardShape {
  const pick = (id: string): StoryboardShape =>
    STORYBOARD_SHAPES.find((shape) => shape.id === id)!;
  if (/\b(problem|pain|struggle|tired of|manual|broken|slow(?:s|ed)? (?:us|you|teams?) down)\b/i.test(brief)) {
    return pick("problem-turn-product-cta");
  }
  if (/\b\d+(?:\.\d+)?\s*(?:%|x|ms|sec)|\bfaster\b|\bbenchmark|\bmetric/i.test(brief)) {
    return pick("stat-proof-tour");
  }
  if (/\bbefore\b.*\bafter\b|\bmigrat|\bold way|\bnew way/i.test(brief)) {
    return pick("before-after");
  }
  if (/\bthree|\b3 (?:new )?features|\bacross the board|\bbundle/i.test(brief)) {
    return pick("feature-triptych");
  }
  return pick("hook-demo-payoff");
}

/**
 * The template's duration arithmetic, done by the HOST: distribute the
 * target runtime across the shape's segments and suggest a shot count per
 * segment, so the planner completes a concrete scaffold instead of inventing
 * (and routinely lowballing) film length. Guidance by construction — there
 * is deliberately NO duration veto and no retry pressure behind it (owner
 * call 2026-07-09: a time miss must never burn an attempt).
 */
export function storyboardShapeScaffold(shape: StoryboardShape, targetSec: number): string[] {
  const total = Math.min(60, Math.max(12, Math.round(targetSec)));
  const lines = shape.segments.map((segment, index) => {
    const seconds = Math.max(2, Math.round(segment.weight * total));
    const shots = seconds <= 6 ? "1 shot" : seconds <= 11 ? "1-2 shots" : "2-3 shots";
    return `  ${index + 1}. ${segment.role} — ~${seconds}s (${shots})`;
  });
  return [
    `## Narrative template — "${shape.id}" scaled to ~${total}s`,
    ...lines,
    "Complete this template: keep the segment order and roughly these second",
    "allocations (a few seconds of drift is fine when the edit plays better,",
    `but a film far under ~${total}s reads as truncated — develop the long`,
    "segments with held, evolving surfaces rather than compressing them).",
    "It is pacing scaffolding, not creative direction: deviate when the brief",
    "evidence or the concept demands a different structure, and it never",
    "overrides the moments, density, or energy contracts.",
  ];
}

export interface StoryboardShapeHint {
  shape: StoryboardShape;
  why: string;
}

/**
 * Parse + validate the small model's selection. Anything but an exact
 * template id degrades to no hint — the selector is deterministically
 * rejectable by construction.
 */
export function parseStoryboardShapeHint(raw: string): StoryboardShapeHint | undefined {
  const source = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  if (start < 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(source.slice(start, source.lastIndexOf("}") + 1));
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const shape = STORYBOARD_SHAPES.find((entry) => entry.id === object.shape);
  if (!shape) return undefined;
  const why = typeof object.why === "string" ? object.why.trim().slice(0, 160) : "";
  return { shape, why };
}

/**
 * Small-agent helper pass: a light model picks the film's pacing skeleton
 * from the curated template list. It runs in PARALLEL with the concept pass
 * (flash returns in seconds while GLM reasons for tens of them), so it adds
 * roughly zero wall-clock; its output is one prompt paragraph the storyboard
 * model treats as a default, never a veto. Structure selection is the whole
 * mandate — creativity and design stay with the big models. Kill switch:
 * SLACK_SEQUENCES_SHAPE_HINT=0.
 */
export async function requestStoryboardShape(
  provider: AgentProvider,
  args: {
    brief: string;
    projectDir: string;
    options?: CompleteOptions;
  },
): Promise<StoryboardShapeHint | undefined> {
  if (slackSequencesEnvRawValue("SLACK_SEQUENCES_SHAPE_HINT") === "0") return undefined;
  const model = lightModel(provider);
  if (!model) return undefined;
  const cacheKey = createHash("sha256").update(JSON.stringify({
    contract: 1,
    provider: provider.id,
    model,
    brief: args.brief,
    shapes: STORYBOARD_SHAPES.map((shape) => shape.id),
  })).digest("hex");
  const planningDir = path.join(args.projectDir, "planning");
  const cacheFile = path.join(planningDir, "shape.json");
  const sharedFile = sharedPlanningCacheFile(args.projectDir, "shape", cacheKey);
  for (const candidate of [cacheFile, sharedFile]) {
    const cached = readPlanningArtifact(candidate, cacheKey) as
      | { hint?: { shape?: string; why?: string } }
      | undefined;
    if (cached?.hint?.shape) {
      const shape = STORYBOARD_SHAPES.find((entry) => entry.id === cached.hint!.shape);
      if (shape) {
        if (candidate === sharedFile) {
          writePlanningArtifact(cacheFile, { version: 1, key: cacheKey, hint: cached.hint });
        }
        return { shape, why: cached.hint.why ?? "" };
      }
    }
  }
  const prompt = [
    "SYSTEM: You are a pacing analyst for short SaaS launch films. Pick the",
    "narrative skeleton that best fits the brief below. You choose STRUCTURE",
    "only; every creative decision belongs to a later pass.",
    "Available shapes:",
    ...STORYBOARD_SHAPES.map((shape) => `- "${shape.id}": ${shape.label} — best for ${shape.best}`),
    "",
    "## Brief",
    args.brief.slice(0, 6_000),
    "",
    "## Response contract",
    'Return only a JSON object: {"shape":"<exact shape id>","why":"<one sentence, <=140 chars>"}.',
  ].join("\n");
  try {
    const raw = await completeReasoningWithRetry(provider, prompt, {
      ...args.options,
      timeoutMs: 45_000,
      maxTokens: 256,
      thinkingMode: "none",
      model,
    }, "shape");
    const hint = parseStoryboardShapeHint(raw);
    if (!hint) {
      process.stderr.write("[shape] selector response was not a valid template pick; continuing without a shape hint\n");
      return undefined;
    }
    const payload = { version: 1, key: cacheKey, hint: { shape: hint.shape.id, why: hint.why } };
    writePlanningArtifact(cacheFile, payload);
    writePlanningArtifact(sharedFile, payload);
    process.stderr.write(`[shape] selected "${hint.shape.id}"${hint.why ? ` — ${hint.why}` : ""}\n`);
    return hint;
  } catch (error) {
    process.stderr.write(
      `[shape] selector unavailable (${error instanceof Error ? error.message : String(error)}); ` +
        "continuing without a shape hint\n",
    );
    return undefined;
  }
}

function storyboardReference(text: string): string {
  const capability = text.match(
    /## Synced HyperFrames capability index[\s\S]*?(?=\n## Available scene blueprints)/,
  )?.[0] ?? "";
  const blueprints = text.match(
    /## Available scene blueprints[\s\S]*?(?=\n## Available motion rules)/,
  )?.[0] ?? "";
  return [capability, blueprints].filter(Boolean).join("\n\n").slice(0, 14_000);
}

export function inferStoryboardPlanRequirements(
  brief: string,
  targetDurationSec?: number,
): StoryboardPlanRequirements {
  const componentSignals: Array<[RegExp, ComponentKind]> = [
    [/\bsearch\b/i, "search"],
    [/\bcommand[\s-]?palette\b/i, "command-palette"],
    [/\btable\b/i, "table"],
    [/\bstat[\s-]?card\b|\brisk score\b/i, "stat-card"],
    [/\bterminal\b/i, "terminal"],
    [/\btoast\b/i, "toast"],
    [/\bprogress\b/i, "progress"],
    [/\bchart\b/i, "chart-line"],
  ];
  const requestedComponentKinds = componentSignals.flatMap(([pattern, kind]) =>
    pattern.test(brief) ? [kind] : []
  );
  const explicitComponents =
    /\bcomponent beats?\b|\bcomponents?\s+for\b|\bmotion-native components?\b/i.test(brief);
  // A WORLD demand ("one large spatial UI world", "stations") is stronger than
  // a camera-motion mention ("camera moves"): only the former earns the
  // multi-station single-shot requirement — the validation finding literally
  // claims "the brief requests one large spatial UI world", so inferring it
  // from a passing "camera move" fabricated a demand the brief never made
  // (2026-07-06 probe `sentinel-p5-camera-b` burned 5 attempts against it).
  const explicitWorld =
    /\blarge spatial\b|\bspatial ui world\b|\bone (?:large|big|continuous) world\b|\b(?:camera |named |multiple )stations?\b/i
      .test(brief);
  const explicitCamera =
    explicitWorld || /\bcamera (?:push|pan|whip|move|travel)/i.test(brief);
  const cameraCountToken = brief.match(
    /\bat least\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:purposeful\s+)?(?:full\s+)?(?:typed\s+)?camera moves?\b/i,
  )?.[1]?.toLowerCase();
  const numberWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const explicitCameraCount = cameraCountToken
    ? Math.min(12, Math.max(1, numberWords[cameraCountToken] ?? Number(cameraCountToken)))
    : undefined;
  return {
    ...(targetDurationSec ? { targetDurationSec } : {}),
    ...(requestedComponentKinds.length ? { requestedComponentKinds } : {}),
    ...(explicitComponents && requestedComponentKinds.length
      ? {
          // Never demand more kinds than the brief actually names — a brief
          // with 2-3 explicit kinds must stay satisfiable.
          minRequestedComponentKinds: Math.min(
            requestedComponentKinds.length,
            Math.max(4, Math.ceil(requestedComponentKinds.length * 0.75)),
          ),
          minComponentBeats: Math.max(6, requestedComponentKinds.length),
        }
      : {}),
    ...(explicitCamera
      ? {
          minCameraMoves: explicitCameraCount ?? 2,
          ...(explicitWorld ? { requireMultiStationWorld: true } : {}),
        }
      : {}),
    ...(/\bobject[\s-]?match cuts?\b/i.test(brief)
      ? { requireObjectMatch: true }
      : {}),
    ...(/\bshape[\s-]?match(?:ed)?\s+(?:cuts?|transitions?|boundar(?:y|ies))\b/i.test(brief)
      ? { requireShapeMatch: true }
      : {}),
    ...(/\brack[\s-]?focus\b|\bfocus pull\b|\bdepth of field\b/i.test(brief)
      ? { requireRackFocus: true }
      : {}),
    ...(/\bspeed[\s-]?ramp(?:ing)?\b|\btime[\s-]?remap(?:ping)?\b|\bslow[\s-]?motion\b|\bslow[\s-]?mo\b/i
      .test(brief)
      ? { requireTimeRamp: true }
      : {}),
    ...(/\btrue orbit\b|\borbit[\s-]?lite\b|\borbit peak\b/i.test(brief)
      ? { requireOrbit: true }
      : {}),
    ...(/\bshared[\s-]?element\b.{0,48}\b(?:morph|match)\b|\b(?:morph|match)\b.{0,48}\bshared[\s-]?element\b/i
      .test(brief)
      ? { requireSharedElementCut: true }
      : {}),
  };
}

/**
 * Diagnostic persistence for the storyboard chain (author-stage parity —
 * LESS_FALLBACKS lever 12): every rejected attempt's raw response + findings
 * land under `planning/attempts/` so a failed paid plan run can be studied
 * offline. Best-effort only; a disk error never affects planning and nothing
 * here re-enters the pipeline.
 */
function persistStoryboardAttempt(
  projectDir: string,
  attempt: number,
  outcome: "rejected" | "truncated" | "artifact-missing",
  details: { rung: string; findings?: string[]; raw?: string; cacheKey?: string },
): void {
  // Storyboard-stage layer attribution (the author stage already has this):
  // a rejected plan's findings were caught at L3 static (plan audits run in
  // parseStoryboardResponse), and every persisted failed attempt bought a
  // paid replacement call — an L5 model retry.
  if (outcome === "rejected") {
    recordSentinelLayerFinding("static", Math.max(1, details.findings?.length ?? 0));
  }
  recordSentinelLayerFinding("model-retry");
  try {
    const dir = path.join(projectDir, "planning", "attempts");
    fs.mkdirSync(dir, { recursive: true });
    const stem = `storyboard-${attempt}-${outcome}`;
    if (details.raw) {
      fs.writeFileSync(path.join(dir, `${stem}.raw.txt`), details.raw.slice(0, 400_000), "utf8");
    }
    fs.writeFileSync(
      path.join(dir, `${stem}.json`),
      JSON.stringify(
        {
          attempt,
          outcome,
          rung: details.rung,
          ...(details.cacheKey ? { key: details.cacheKey } : {}),
          at: new Date().toISOString(),
          findings: (details.findings ?? []).slice(0, 40),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Diagnostics only.
  }
}

interface PersistedStoryboardRecovery {
  requested: boolean;
  storyboard?: DirectScene[];
  degradations?: string[];
  productionBasis?: "light" | "dark";
  source?: string;
  failures: string[];
}

/**
 * Reclaim a storyboard response that was already paid for but rejected by an
 * older deterministic contract. Normal retries only consider artifacts whose
 * persisted cache key matches this exact brief/model/registry contract. An
 * operator may explicitly select `latest` after repairing a validator bug;
 * that opt-in is intentionally fail-loud so a bad recovery never silently
 * falls through to another paid planning ladder.
 */
export function recoverPersistedStoryboardAttempt(
  projectDir: string,
  cacheKey: string,
  requirements: StoryboardPlanRequirements,
  selector = slackSequencesEnvRawValue("SLACK_SEQUENCES_RECOVER_REJECTED_STORYBOARD")?.trim(),
  frameMd?: string,
): PersistedStoryboardRecovery {
  const attemptsDir = path.join(projectDir, "planning", "attempts");
  const explicit = Boolean(selector);
  if (!fs.existsSync(attemptsDir)) {
    return {
      requested: explicit,
      failures: explicit ? [`attempts directory does not exist: ${attemptsDir}`] : [],
    };
  }

  const attemptNumber = (file: string): number =>
    Number(file.match(/^storyboard-(\d+)-rejected\.raw\.txt$/)?.[1] ?? -1);
  const rawFiles = fs.readdirSync(attemptsDir)
    .filter((file) => /^storyboard-\d+-rejected\.raw\.txt$/.test(file))
    .sort((a, b) => attemptNumber(b) - attemptNumber(a));
  let candidates: string[] = [];
  if (selector) {
    if (selector === "latest") {
      candidates = rawFiles.slice(0, 1);
    } else if (/^storyboard-\d+-rejected\.raw\.txt$/.test(selector)) {
      candidates = rawFiles.includes(selector) ? [selector] : [];
    } else {
      return {
        requested: true,
        failures: [
          "SLACK_SEQUENCES_RECOVER_REJECTED_STORYBOARD must be `latest` or a " +
            "storyboard-N-rejected.raw.txt basename",
        ],
      };
    }
  } else {
    // Automatic recovery is exact-contract only. Old diagnostics without a
    // key remain inert unless an operator explicitly selects one.
    candidates = rawFiles.filter((rawFile) => {
      const metadataFile = path.join(attemptsDir, rawFile.replace(/\.raw\.txt$/, ".json"));
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8")) as {
          key?: unknown;
          outcome?: unknown;
        };
        return metadata.outcome === "rejected" && metadata.key === cacheKey;
      } catch {
        return false;
      }
    });
  }

  if (!candidates.length) {
    return {
      requested: explicit,
      failures: explicit ? ["no matching rejected storyboard artifact was found"] : [],
    };
  }

  const failures: string[] = [];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(path.join(attemptsDir, file), "utf8");
      // A persisted rejection has already exhausted the quality-pressure rung,
      // so replay it with the same late-attempt policy used by the final rescue
      // draw. All non-polish validation remains blocking.
      const storyboard = parseStoryboardResponse(raw, requirements, {
        ...(frameMd ? { frameMd } : {}),
        degradeShapeHintMismatches: true,
        degradePacingFindings: true,
      });
      const productionBasis = storyboardProductionBasis(raw);
      return {
        requested: true,
        storyboard,
        degradations: acceptedStoryboardDegradations.get(storyboard) ?? [],
        ...(productionBasis ? { productionBasis } : {}),
        source: path.join(attemptsDir, file),
        failures,
      };
    } catch (error) {
      failures.push(
        `${file}: ${error instanceof Error ? error.message.slice(0, 500) : String(error)}`,
      );
    }
  }
  return { requested: true, failures };
}

/**
 * Scene-scoped storyboard findings repair — the storyboard analogue of the
 * author-stage `repairSlotDraftForFindings`. The dominant wall-clock cost of a
 * rejected storyboard is a whole re-plan (~6 min of GLM reasoning), yet most
 * rejections name specific shots. When EVERY blocking finding maps to a named
 * shot, re-plan ONLY those shots (one bounded, low-reasoning call) against the
 * LOCKED remainder — every other shot, and every repaired shot's id / startSec /
 * durationSec, is fixed so the merged film stays contiguous — then re-validate
 * the merged plan through the FULL gate (`parseStoryboardResponse`, so every
 * normalizer, audit, and moment check runs exactly as on a normal attempt). On
 * convergence it replaces the cost of a full attempt; on ANY miss (a film-level
 * finding, an incomplete subset, a call failure, or a merge the gate still
 * rejects) it returns undefined and the caller falls through to the existing
 * whole-plan ladder unchanged — it can never reduce a run's chances.
 *
 * Structural live-create change → gated by `storyboardSceneRepairEnabled()`
 * (`SLACK_SEQUENCES_STORYBOARD_SCENE_REPAIR=0` reverts). Telemetry mirrors the
 * author slot repair (`recordSentinelSlotCall("storyboard-scene-repair", n)`).
 */
export async function repairStoryboardScenesForFindings(
  provider: AgentProvider,
  args: {
    brief: string;
    frameMd?: string;
    options?: CompleteOptions;
    requirements: StoryboardPlanRequirements;
    model?: string;
  },
  lockedPlan: DirectScene[],
  findings: string[],
): Promise<DirectScene[] | undefined> {
  if (!storyboardSceneRepairEnabled()) return undefined;
  if (lockedPlan.length < 2 || !findings.length) return undefined;
  const attributed = attributeFindingsToScenes(findings, lockedPlan.map((scene) => scene.id));
  // A film-level finding (total duration, distinct-framings floor, whip cap,
  // film component cap, camera/energy) cannot be fixed by editing a shot subset
  // — the whole plan must move — so defer entirely to the full ladder.
  if (attributed.has("__film__")) return undefined;
  const repairIds = lockedPlan.map((scene) => scene.id).filter((id) => attributed.has(id));
  // Need a genuine locked remainder: repairing every shot IS a whole re-plan, so
  // there is no cheaper substitute to make.
  if (!repairIds.length || repairIds.length >= lockedPlan.length) return undefined;
  const repairSet = new Set(repairIds);

  const rawScene = (scene: DirectScene): Record<string, unknown> => {
    const { sentinelNormalizations: _notes, layoutRepairs: _layoutRepairs, ...rest } = scene;
    return rest as unknown as Record<string, unknown>;
  };
  const prompt = [
    "SYSTEM: You are repairing a SMALL SUBSET of an already-approved storyboard.",
    "Deterministic validation rejected ONLY the shots listed below; every other",
    "shot is locked and correct. Return corrected versions of ONLY the listed",
    "shots, in the same JSON scene shape, fixing each finding with the SMALLEST",
    "edit and changing nothing a finding does not name.",
    "",
    "HARD CONSTRAINTS:",
    "- Keep each listed shot's \"id\", \"startSec\", and \"durationSec\" EXACTLY as",
    "  given. The film's timing is LOCKED — you may not retime or resize a shot.",
    "  If a finding can only be fixed by changing a shot's duration, it is out of",
    "  scope: return that shot unchanged (the full planner will handle it).",
    "- Reproduce every field a finding does not name, byte-for-byte (a dropped",
    "  camera target or beat text creates NEW violations).",
    "- Fix each finding with the edit it names (drop a set-dressing surface, type",
    "  the copy earlier, move a payoff earlier, retarget a camera move, …).",
    "",
    "## Brief and trusted evidence",
    args.brief,
    "",
    args.frameMd
      ? `## Job frame capsule\n<frame_capsule>\n${frameCapsule(args.frameMd)}\n</frame_capsule>\n`
      : "",
    "## Locked storyboard (the full film, for context — do NOT return locked shots)",
    "<locked_storyboard_json>",
    JSON.stringify(lockedPlan.map(rawScene)),
    "</locked_storyboard_json>",
    "",
    "## Shots to repair (return corrected versions of EXACTLY these ids)",
    ...repairIds.flatMap((id) => {
      const scene = lockedPlan.find((candidate) => candidate.id === id)!;
      const sceneFindings = attributed.get(id) ?? [];
      return [
        `### shot "${id}"`,
        JSON.stringify(rawScene(scene)),
        "Findings to fix (each names its own fix):",
        ...sceneFindings.map((finding) => `- ${finding}`),
        "",
      ];
    }),
    "## Response",
    `Return only <storyboard_json> containing a JSON ARRAY of exactly these ${repairIds.length} ` +
      "corrected shot object(s) — no other shots, no Markdown, no prose.",
  ].filter(Boolean).join("\n");

  recordSentinelSlotCall("storyboard-scene-repair", repairIds.length);
  let raw: string;
  try {
    raw = await completeReasoningWithRetry(provider, prompt, {
      ...args.options,
      timeoutMs: 240_000,
      maxTokens: STORYBOARD_SCENE_REPAIR_MAX_TOKENS,
      thinkingMode: storyboardSceneRepairThinkingMode(),
      ...(args.model ? { model: args.model } : {}),
    }, "storyboard");
  } catch (error) {
    process.stderr.write(
      `[storyboard] scene-repair call failed (${
        error instanceof Error ? error.message.slice(0, 200) : String(error)
      }); falling back to the full re-plan\n`,
    );
    return undefined;
  }

  let subset: unknown;
  try {
    subset = JSON.parse(extractStoryboardSource(raw));
  } catch {
    process.stderr.write("[storyboard] scene-repair returned no parseable subset; full re-plan\n");
    return undefined;
  }
  if (!Array.isArray(subset)) return undefined;
  const repairedById = new Map<string, Record<string, unknown>>();
  for (const entry of subset) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const id = (entry as Record<string, unknown>).id;
      if (typeof id === "string" && repairSet.has(id)) {
        repairedById.set(id, entry as Record<string, unknown>);
      }
    }
  }
  // Every requested shot must come back; a partial response must not look like a
  // success merely because the merge kept the locked half.
  if (repairIds.some((id) => !repairedById.has(id))) {
    process.stderr.write(
      "[storyboard] scene-repair returned an incomplete subset; falling back to the full re-plan\n",
    );
    return undefined;
  }

  // Merge: locked shots verbatim; repaired shots with their timing envelope
  // forced back to the locked values so the film stays contiguous.
  const mergedRaw = lockedPlan.map((scene) => {
    if (!repairSet.has(scene.id)) return rawScene(scene);
    return {
      ...repairedById.get(scene.id)!,
      id: scene.id,
      startSec: scene.startSec,
      durationSec: scene.durationSec,
    };
  });
  const mergedText = `<storyboard_json>${JSON.stringify(mergedRaw)}</storyboard_json>`;
  let merged: DirectScene[];
  try {
    // Judge strictly — the repair must genuinely FIX the findings, not have them
    // demoted (it fires early, before the ladder's late-attempt demotions).
    merged = parseStoryboardResponse(mergedText, args.requirements, {
      degradeShapeHintMismatches: false,
      degradePacingFindings: false,
    });
  } catch (error) {
    process.stderr.write(
      `[storyboard] scene-repair did not converge (${
        error instanceof Error ? error.message.slice(0, 200) : String(error)
      }); falling back to the full re-plan\n`,
    );
    return undefined;
  }
  process.stderr.write(
    `[storyboard] scene-repair converged: re-planned ${repairIds.length}/${lockedPlan.length} ` +
      `shot(s) (${repairIds.join(", ")}) in one bounded call — saved a full re-plan\n`,
  );
  return merged;
}

export async function requestStoryboardPlan(
  provider: AgentProvider,
  args: {
    brief: string;
    projectDir: string;
    skills: RetrievedSkillContext;
    frameMd?: string;
    targetDurationSec?: number;
    options?: CompleteOptions;
    /** @deprecated Attempt counts are folded from ledger events; ignored. */
    attempts?: { count: number };
  },
): Promise<DirectScene[]> {
  const boundedCreate = boundedCreatePolicyActive();
  const structuredOutput = supportsStructuredOutputs(provider);
  const model = storyboardModel(provider);
  const thinkingMode = storyboardThinkingMode(provider, model);
  const requirements = inferStoryboardPlanRequirements(
    args.brief,
    args.targetDurationSec,
  );
  const recipeLibrary = recipesEnabled() ? loadRecipeLibrary() : undefined;
  // The planner-facing skill context stays retrieval-bounded, but host
  // adoption must not depend on the model declaring an offered recipe first.
  // Match the complete typed library here; stale/required-param recipes are
  // still rejected by autoDeclareHighConfidenceRecipes.
  const offeredRecipes = recipeLibrary ? [...recipeLibrary.recipes.values()] : [];
  const autoDeclareRecipes = (storyboard: DirectScene[]): DirectScene[] => {
    let resultScenes = storyboard;
    if (offeredRecipes.length) {
      const result = autoDeclareHighConfidenceRecipes(resultScenes, offeredRecipes, args.brief);
      resultScenes = result.scenes;
      if (result.declared.length) {
        recordSentinelNormalization("recipe-auto-declare", result.declared.length);
        process.stderr.write(
          `[storyboard] host auto-declared high-confidence recipe(s): ` +
            `${result.declared.map((entry) => `${entry.recipeId}@${entry.sceneId}:${entry.score}`).join(", ")}\n`,
        );
      }
      if (result.absorbed.length) {
        recordSentinelNormalization("recipe-primary-surface-absorb", result.absorbed.length);
        process.stderr.write(
          `[storyboard] host absorbed duplicate primary-surface recipe(s): ` +
            `${result.absorbed.map((entry) => `${entry.recipeId}@${entry.sceneId}`).join(", ")}\n`,
        );
      }
    }
    if (assetsEnabled()) {
      const beforeAssets = resultScenes;
      const assets = autoDeclareHighConfidenceAssets(resultScenes, args.brief);
      const assetPlanFindings = assets.declared.length
        ? validateStoryboardPlan(assets.scenes, requirements)
        : [];
      if (assetPlanFindings.length) {
        resultScenes = beforeAssets;
        recordSentinelNormalization("asset-auto-declare-invalid", assets.declared.length);
        process.stderr.write(
          `[storyboard] host declined auto-declared asset(s) after full plan validation: ` +
            `${assetPlanFindings.slice(0, 3).join("; ")}\n`,
        );
      } else {
        resultScenes = assets.scenes;
      }
      if (!assetPlanFindings.length && assets.reconciliationNotes.length) {
        recordSentinelNormalization("plugin-reconcile", assets.reconciliationNotes.length);
        for (const note of assets.reconciliationNotes) {
          process.stderr.write(`[storyboard] plugin-reconcile: ${note}\n`);
        }
      }
      if (!assetPlanFindings.length && assets.declared.length) {
        recordSentinelNormalization("asset-auto-declare", assets.declared.length);
        process.stderr.write(
          `[storyboard] host auto-declared matching asset(s): ` +
            `${assets.declared.map((entry) => `${entry.assetId}@${entry.sceneId}:${entry.score}`).join(", ")}\n`,
        );
      }
      if (assets.declined.length) {
        recordSentinelNormalization("asset-auto-declare-declined", assets.declined.length);
        process.stderr.write(
          `[storyboard] host declined unsafe/redundant asset adoption: ` +
            `${assets.declined.map((entry) =>
              `${entry.assetId}@${entry.sceneId}:${entry.reason}`
            ).join(", ")}\n`,
        );
      }
    }
    return resultScenes;
  };
  const recordConversions = (storyboard: DirectScene[]): void => {
    recordStudioCatalogConversions(storyboard);
  };
  // GLM job #1: the concept pass. Its artifact is cached independently, so a
  // storyboard retry never re-spends the concept call. The light-model shape
  // selector rides in parallel — it finishes long before GLM's reasoning
  // does, so the hint is free wall-clock-wise.
  const [concept, shapeHint] = await Promise.all([
    requestConceptDirection(provider, {
      brief: args.brief,
      projectDir: args.projectDir,
      frameMd: args.frameMd,
      options: args.options,
    }),
    requestStoryboardShape(provider, {
      brief: args.brief,
      projectDir: args.projectDir,
      options: args.options,
    }),
  ]);
  const cacheKey = createHash("sha256").update(JSON.stringify({
    // Bump when the storyboard contract changes shape (v2: StoryboardMomentV1,
    // v3: typed components + beats; v4: brief-derived coverage requirements;
    // v5: shape-match cuts + orbit/rack-focus camera vocabulary; v6: timeRamp
    // speed-ramping dips; v7: depth3d level-2 camera depth; v8:
    // hold-what-matters pacing audits — reading floors, outcome holds,
    // introduction development, camera budget; v9: pacing bugfixes — single-
    // introduction holds, in-flight camera conflicts, headline/swap reading
    // floors, viewer-time deadline — plus host-owned timing re-base and
    // unsupported-beat degrade at parse; v10: the re-base shifts nested
    // beat/camera/interaction/moment/ramp times with their scene, the
    // final-resolve pacing exemption covers only compact resolve surfaces,
    // and headline detection no longer misreads "prototype"; v11 persists the
    // accepted storyboard's degradation ledger beside the cached plan; v12:
    // the MOTION_DESIGN_PLAN schema fields land together — the 3-transition
    // cut language (swipe+axis+cover / morph / match, legacy names
    // canonicalized), the `dive` camera move, scene `gradeShift`, and the
    // optional `style` enums on type/open/highlight beats); v13: the host now
    // AUTO-DERIVES the MD3/MD4/MD6 styles a production planner under-reaches for
    // — compact `open`→pop, headline `type`→rise/assemble, and a scene
    // `gradeShift` from a primary moment naming a temperature — so the same raw
    // plan parses to a styled storyboard (the md-audit-probe gap fix); v14:
    // Recipe Studio Level-1 consumption — scenes may declare typed
    // `recipes:[{id,params}]` from the retrieved library, reconciled at parse
    // and host-instantiated verbatim (recipeContract.ts). The library content
    // hash below also keys the cache, so an exported/re-proven recipe
    // invalidates plans that could now use it; v15: host plugins — scenes may
    // declare typed `plugins:[{kind,params}]` generator forms that LOWER into
    // components/beats at parse (pluginContract.ts), so a cached plan's parse
    // now carries the lowered unit; v16: the plugin reconciler also ABSORBS
    // free same-kind components duplicating a declared unit's content (the
    // plugin-probe-1 double-declaration lesson); v17: plugin entrance beats
    // wait for the camera's arrival at the unit's station (cameraArrivalSec)
    // and absorbed duplicate parts persist on the scene
    // (pluginAbsorbedParts) for injection-time hiding; v18: camera scenes
    // without a declared worldLayout get default viewport cells synthesized
    // per path region (world-layout-derive); v19: duration lives in the
    // template — the prompt always carries a host-computed narrative/duration
    // scaffold (storyboardShapeScaffold over typed shape segments, scaled to
    // targetDurationSec, keyword-picked default when the hint is off), and
    // there is deliberately NO duration veto (a time miss never burns an
    // attempt); plans cached before the scaffold predate the duration ask;
    // v20: asset units lower to an internal `asset` component + typed
    // `animate` beats (spring animations compiled by sequences-assets), so a
    // cached plan's parse now carries the lowered asset choreography; v21:
    // camera arrival honors the runtime's ENTRY frame (first segment's
    // from-else-to target) — a unit framed from scene start anchors at the
    // default entrance instead of a same-station re-frame's end (the
    // asset-probe-1 manufactured pacing/holds rejection); v22: the default-off
    // continuity graph adds stable component/entity identities plus explicit
    // scene appearance declarations. The flag keys the cache so off/on plans
    // never cross the experiment boundary; v23: dive windows extend for a
    // covered payoff's OUTCOME_HOLD_SEC before the pull-back leg (the
    // quillsign pacing/outcome parity fix), and a camera path naming no
    // station other than a plugin unit's own anchors the unit at the default
    // entrance (a target-less drift is not an away-frame); v24 adds typed
    // follows/lag choreography, scene entrance families, one display-type
    // moment, and high-confidence safe-default recipe auto-declaration; v25
    // makes host asset adoption executable rather than declarative paperwork:
    // semantic params bind from target-scene facts, a typed hero wins a
    // duplicate, plugin lowering stamps the uid before conversion telemetry,
    // and the augmented plan revalidates before it can enter the cache.
    contract: 25,
    provider: provider.id,
    model: model ?? null,
    brief: args.brief,
    frameMd: args.frameMd ?? null,
    concept: concept ?? null,
    shape: shapeHint?.shape.id ?? null,
    requirements,
    registryVersion: args.skills.registryVersion,
    blueprints: args.skills.blueprintIds,
    recipesVersion: recipeLibrary?.version ?? "off",
    recipeIds: args.skills.recipeIds ?? [],
    // Asset vocabulary keys the cache: flipping the flag (or growing the
    // library) changes what the planner may declare, so cached plans from the
    // other regime never replay.
    assets: assetsEnabled() ? ASSET_LIBRARY.map((asset) => asset.id).join(",") : "off",
    continuityGraph: continuityGraphEnabled() ? "v1" : "off",
  })).digest("hex");
  const planningDir = path.join(args.projectDir, "planning");
  const cacheFile = path.join(planningDir, "storyboard.json");
  const sharedFile = sharedPlanningCacheFile(args.projectDir, "storyboard", cacheKey);
  const expectedBasis = args.frameMd ? parseFrameBasis(args.frameMd) : undefined;
  for (const candidate of [cacheFile, sharedFile]) {
    const cached = readPlanningArtifact(candidate, cacheKey) as
      | { storyboard?: DirectScene[]; degradations?: string[]; productionBasis?: "light" | "dark" }
      | undefined;
    if (cached?.storyboard && (!expectedBasis || cached.productionBasis === expectedBasis)) {
      const autoDeclared = autoDeclareRecipes(cached.storyboard);
      const errors = validateStoryboardPlan(autoDeclared, requirements);
      if (!errors.length) {
        // Cache artifacts are paid, validated plans, but the deterministic
        // migration contract can still grow. Re-run pure station completion
        // here so a v22 partial map cannot bypass a rule added after it was
        // cached, and persist the upgraded artifact for every later replay.
        const worldLayoutCompletion = completeStoryboardWorldLayouts(autoDeclared);
        const storyboard = worldLayoutCompletion.scenes;
        reportWorldLayoutCompletions(worldLayoutCompletion.completions);
        for (const degradation of cached.degradations ?? []) {
          recordSentinelDegradation(degradation);
        }
        const payload = {
          version: 1,
          key: cacheKey,
          storyboard,
          degradations: cached.degradations ?? [],
          ...(cached.productionBasis ? { productionBasis: cached.productionBasis } : {}),
        };
        if (worldLayoutCompletion.completions.length || autoDeclared !== cached.storyboard) {
          writePlanningArtifact(candidate, payload);
          if (candidate !== sharedFile) writePlanningArtifact(sharedFile, payload);
        }
        if (candidate === sharedFile) {
          process.stderr.write(
            "[storyboard] reusing already-paid storyboard from the shared planning cache\n",
          );
          writePlanningArtifact(cacheFile, payload);
        }
        recordConversions(storyboard);
        return storyboard;
      }
    }
  }
  const persistedRecovery = recoverPersistedStoryboardAttempt(
    args.projectDir,
    cacheKey,
    requirements,
    undefined,
    args.frameMd,
  );
  if (persistedRecovery.storyboard) {
    const storyboard = autoDeclareRecipes(persistedRecovery.storyboard);
    const degradations = persistedRecovery.degradations ?? [];
    for (const degradation of degradations) recordSentinelDegradation(degradation);
    const payload = {
      version: 1,
      key: cacheKey,
      storyboard,
      degradations,
      ...(persistedRecovery.productionBasis
        ? { productionBasis: persistedRecovery.productionBasis }
        : {}),
    };
    writePlanningArtifact(cacheFile, payload);
    writePlanningArtifact(sharedFile, payload);
    process.stderr.write(
      `[storyboard] recovered already-paid rejected artifact under the current contract: ` +
        `${persistedRecovery.source}\n`,
    );
    recordConversions(storyboard);
    return storyboard;
  }
  if (
    slackSequencesEnvRawValue("SLACK_SEQUENCES_RECOVER_REJECTED_STORYBOARD")?.trim() &&
    persistedRecovery.requested
  ) {
    throw new Error(
      "requested rejected-storyboard recovery did not validate; no new provider call was made: " +
        (persistedRecovery.failures[0] ?? "unknown recovery failure"),
    );
  }
  const basePrompt = [
    "SYSTEM: You are the cut-first editor for a short SaaS launch film.",
    "Design the storyboard before any HTML is written. Make 3-10 distinct shots",
    "that form one visual argument, not a centered headline/stat/CTA parade.",
    "Each shot needs a different foreground composition and a purposeful camera",
    "or framing intention. Carry the eye across every cut through one explicit",
    "anchor: component, position, direction, color field, shape, or semantic idea.",
    "The frame must earn a NEW FRAMING roughly every 3.5 seconds. A framing is a",
    "shot boundary OR a typed camera move. Plan density accordingly: a 15s film",
    "needs 4+ framings, a 24s film 7+, a 40s+ film 12. Short punchy shots",
    "(1.5-3s) are welcome; so are longer shots whose camera keeps traveling.",
    "PACING CEILING — density has a ceiling as well as a floor, enforced",
    "deterministically. Per shot, at most 1 + floor(shotSec/3.5) full camera",
    "moves; at most 2 whips per film. After introducing a dense surface, HOLD",
    "and develop it: the last new surface in a shot must land by ~65% of the",
    "shot window, leaving ~0.9s per introduced surface to read. Hold on",
    "outcomes longer than actions: after a press, set-state, or toast payoff,",
    "leave >=0.8s before the next framing change. Typed copy needs ~0.3s per",
    "word of reading time before the frame cuts or whips away. A hold is not",
    "a freeze — develop the held surface with count/progress/highlight beats.",
    "ONE focal information change at a time does NOT mean one moving object.",
    "Layer the dominant action with one quiet supporting response and one",
    "ambient/camera layer; offset reactions by 2-6 frames and overlap the tail",
    "of one move with the next. Only one layer may yank the eye across the frame;",
    "serial move-stop-move-stop choreography reads as PowerPoint.",
    ...(continuityGraphEnabled()
      ? [
          "CONTINUITY GRAPH — important product objects keep one semantic identity",
          "across shots even when their representation changes. Give repeated hero",
          "components the same entityId (product-shell, trace, alert, metric, CTA),",
          "and declare continuity entries when a non-component or renamed part is the",
          "same object. Carry at least one important entity through THREE shots. The",
          "host measures its DOM bounds, blocks every phrase to an occupancy/anchor/dwell",
          "target, and executes shared-element handoffs; do not draw transition twins.",
        ]
      : []),
    "CAMERA RIG — the continuous spatial world. Each scene may declare a typed",
    '"camera" path over a data-camera-world plane larger than the 1920x1080',
    "viewport. The author scatters that scene's content across named",
    "data-region stations on the plane (the viewer never sees the whole world);",
    "the host rig moves the camera between regions with cinematic SaaS motion.",
    "Moves: hold (locked framing, use sparingly and briefly), drift (slow",
    "connective travel — the host auto-fills every gap with drift so the camera",
    "never freezes), pan (reframe to a region), whip (fast swoosh reframe),",
    "push-in (commit deeper into a region), pull-back (widen to reveal",
    "context), track-to-anchor (land tight on one data-part), parallax-pass",
    "(lateral travel that separates data-depth layers), orbit-lite",
    "(a shallow lateral crane with parallax, no barrel roll), orbit (a true 3D arc around the framed subject,",
    'optional "arcDeg" up to 35 — reserve it for ONE hero logo/graphic scene',
    "per film, never a text-heavy scene, and never overlapping a cursor",
    "interaction). Times are absolute seconds inside the shot window.",
    'COMPOUND MOVES — any full move may carry "zoom": a pan with "zoom":1.2',
    "travels AND zooms in one continuous operated move. NEVER plan",
    "pan-then-push-in (or track-then-push-in) on the same region as two serial",
    "steps — it plays as travel, dead stop, zoom (the amateur tell); declare",
    "ONE move with the zoom on it (the host merges such adjacent pairs anyway).",
    "Camera motion and content motion are expected to overlap: schedule",
    "component beats and reveals DURING pans/drifts, not after the camera",
    "parks.",
    "CURATED CAMERA GRAMMARS — use these as proven blocking patterns when they",
    "fit, renaming station ids and scaling times to the shot rather than copying",
    "them blindly. They compile through the same typed camera runtime:",
    ...CAMERA_PATTERNS.map((pattern) =>
      `- ${pattern.id}: ${pattern.purpose} ${pattern.eyeTrace}`
    ),
    'DEPTH 3D — a shot whose path has an orbit may set "depth3d":true on its',
    '"camera" object when the scene carries 2-4 data-depth layers: the layers',
    "then separate in real 3D while the camera arcs (rest frames stay flat and",
    "legible). Reserve it for the same hero/graphic scene as the orbit itself.",
    "RACK FOCUS — any camera move may carry a",
    '"focus":{"part":"data-part","blurMaxPx":6} (or {"depth":0..1}) modifier:',
    "the rig pulls a focal plane between the scene's data-depth layers,",
    "blurring the others in proportion to depth distance. Two consecutive",
    "moves with different focus targets stage a cinematic focus pull",
    "(defocus the background context, then land focus on the payoff detail).",
    "Use it only in scenes the author will build with 2+ depth layers.",
    "CAMERA ENERGY — camera verbs must track the film's energy curve, never",
    "distribute one verb evenly. Peak scenes get a whip, a hard push-in",
    '("zoom":1.35+), or a morph/cover-swipe cut INTO them; valleys get',
    "a short hold or slow drift so the claim can breathe. A 12s+ film with no",
    "whip, no 1.3+ push-in, and no energetic cut is rejected deterministically.",
    "Rhythm pattern that works: whip to a region, drift while its content",
    "reveals, then whip onward — alternate loud and quiet camera energy.",
    "Give a camera path to any shot longer than ~4 seconds; name 2-4 regions",
    "per world using stable kebab-case (hero-claim, metric-wall, ui-demo,",
    "cta-station). track-to-anchor requires a toPart the author will create.",
    "DIVE — to work inside a dense frame, declare ONE move:",
    '{"move":"dive","toPart":"<the surface you are about to change>",',
    '"startSec":…,"durationSec":<the TOTAL in+hold+out window>,"zoom":1.0-1.4}.',
    "The host times the hold to your typed beats/interactions on that surface",
    "(including reading time for typed copy) and returns the camera itself,",
    "exactly to its pre-dive framing. Never choreograph push-in + hold +",
    "pull-back yourself — dive replaces all three and counts as ONE full move.",
    "A dive needs a beat or interaction on its toPart inside the window;",
    "without one it degrades to a plain push-in.",
    "WORLD LAYOUT — for any shot whose camera visits 2+ stations, also declare",
    '"worldLayout": pin each region to a distinct viewport-sized grid cell of',
    "the world plane. [0,0] is the entry framing; [1,0] is one full screen",
    "right, [0,-1] one up (cells range -2..2). Make cell adjacency match the",
    "camera journey (a pan right should land on the cell to the right). The",
    "author receives exact pixel rects per station, so stations never clip",
    "each other or sit half out of frame.",
    "For a 10s+ film, plan visible development inside shots: a 4.5s+ shot must",
    "have at least two non-wrapper component/camera beats, with one in the back",
    "half. Three long scenes without internal events reads as a slide deck.",
    "",
    componentPlanningVocabulary(),
    "Plan the product story AS component state changes: a search shot is a",
    "search component + a type beat + an open beat; a metrics shot is stat-card",
    "components + count beats + a chart beat; an AI shot is a chat component +",
    "a stream beat. Place components at camera regions (set their region) so",
    "whips and pans land ON a component as its beat fires — camera arrival +",
    "state change on the same frame is the signature move. Morph beats are the",
    "film's showpiece transitions: search→command-palette, card→expanded-card,",
    "metric→metric, and distinct button→button pills. Same-kind morphs require",
    "TWO declared component ids; never self-morph one id. Use 1-2 morphs per",
    "film where the story earns them, never",
    "decoratively. A morph beat's morphTo must name a component DECLARED in",
    "the same shot's components array — always declare BOTH twins (e.g. the",
    "search AND the command-palette) or the plan is rejected.",
    "Beats are host-compiled, so declaring them costs the source",
    "budget nothing — prefer typed beats over prose asks for UI motion.",
    "FOCUS TARGET COHERENCE — when one action includes a cursor arrival, press,",
    "selection, highlight, sweep, or underline, all of them must name the same",
    "semantic child. Name the component once; use the same 1-based item on the",
    "interaction and component/FX beats. Never point to row 2",
    "then outline row 3 or the whole table.",
    "COMPONENT BUDGET — components are the expensive resource (the author must",
    "build full product markup for every one, and the viewer must read it):",
    "at most 1 component per ~1.2s of its scene (never more than 4 per scene)",
    "and about 1 per 2s of film overall. One component carrying three beats is",
    "ALWAYS better than three components carrying one beat each. Never declare",
    "a component that exists only as set dressing.",
    "",
    pluginPlanningVocabulary(),
    "",
    "Do not schedule a press/select/highlight beat on the same component a",
    "cursor interaction is pressing at the same time — the cursor's press",
    "feedback already animates the target, and the doubled pulse reads as a",
    "stutter.",
    "Every shot's boundary is a typed, machine-executed cut. The transition",
    "language is THREE transitions plus hard — pick ONE signature transition and",
    "repeat it; morph/match are premium, at most one or two per film:",
    "- swipe (movement/continuation — the default for scene-to-scene motion):",
    '  requires "axis":"left|right|up|down" (the direction the outgoing content',
    '  travels); optional "cover":true sends a palette panel wiping across the',
    "  frame so the cut hides under full cover (loud — use at a register turn).",
    "  The host adds directional motion blur; you never author it.",
    "- morph (one thing BECOMES a semantic relative): two DIFFERENT elements whose",
    "  identity/structure and silhouettes rhyme — search becomes command control,",
    "  metric becomes metric, compact card becomes expanded card. Copy→percentage,",
    "  dashboard→headline, or whole app→badge must use swipe/match/hard instead.",
    "  Swap across the boundary through a crossfading bridge. Requires",
    "  focalPartOut/focalPartIn data-part names the author will create, plus",
    "  optional shapeOut/shapeIn hints from pill|bar|card|circle|window as your",
    "  own silhouette self-check. pill<->bar rhyme; card<->window<->circle",
    "  rhyme; a cross-family pair like pill->card is rejected at plan time, and",
    "  a >2.5x measured aspect mismatch degrades to a swipe at bind time.",
    "- match (the SAME subject on both sides of the seam): with BOTH",
    "  focalPartOut/focalPartIn the element visibly travels to its counterpart;",
    "  with only focalPartIn it is a hard cut whose incoming subject MUST land",
    "  where the eye already is — QA enforces a tightened eye-trace budget, so",
    "  declare match only when the two frames genuinely align.",
    "- hard (punctuation, not a transition): the intentional register break.",
    "  A film with zero plain cuts is its own tell.",
    "The host compiles the cut deterministically;",
    "the prose outgoingCut must describe the same editorial idea as cut.style.",
    "SPEED RAMP — time itself may bend for emphasis. A shot may declare ONE",
    '"timeRamp": the film decelerates to slowTo (0.2-0.6) for holdSec seconds',
    "of slow motion at the shot's most important resolve, then snaps back",
    "above speed to repay the borrowed time before the shot ends (net-zero:",
    "scene boundaries and total duration never move). The dip must be",
    "MOTIVATED: a declared storyboard moment's atSec must fall inside the",
    "slow-motion hold. Keep the dip inside the shot with ~0.3s native-speed",
    "margins (it can never overlap the outgoing cut window), never place one",
    "in shot 1, and use at most 2 dips per film — one is usually right, on the",
    "metric landing or hero resolve. Most shots have no ramp.",
    "Name one frame.md flow scaffold in spatialIntent.composition for every shot:",
    "layout-center-stack, layout-split, layout-editorial-left, layout-meta-top,",
    "layout-corner-chrome, or layout-hero-band. Describe foreground groups as",
    "semantic zones within that scaffold, not as guessed canvas coordinates.",
    "Registry capabilities are a reuse-first vocabulary, not a mandatory quota.",
    "Use only capability ids that appear in the supplied synced index.",
    ...(requirements.minRequestedComponentKinds
      ? [
          "",
          "BRIEF-SPECIFIC COMPONENT COVERAGE — this brief explicitly asks for",
          `motion-native ${requirements.requestedComponentKinds?.join(", ")} components.`,
          `Plan at least ${requirements.minRequestedComponentKinds} of those distinct kinds and at least`,
          `${requirements.minComponentBeats} typed component beats. Product beats must become`,
          "visible UI state changes; mentioning them only in foreground prose does not count.",
        ]
      : []),
    ...(requirements.minCameraMoves
      ? [
          "",
          "BRIEF-SPECIFIC CAMERA COVERAGE — this brief explicitly asks for a",
          `spatial camera world. Plan at least ${requirements.minCameraMoves} FULL typed camera`,
          "moves. Full moves are pan/whip/push-in/pull-back/track-to-anchor/",
          "parallax-pass/orbit/dive — drift and hold are connective travel and do NOT",
          "count toward this coverage. A set of static shots or a single minor",
          "pan does not satisfy the request.",
          ...(requirements.requireMultiStationWorld
            ? [
                "At least ONE shot must itself travel through multiple stations with",
                "2+ FULL moves in its own path. Recipe: one 5s+ shot, worldLayout",
                "cells for 2-3 regions, pan to the second region at ~1s, then",
                "track-to-anchor (or pan with zoom) onto the third at ~3s.",
              ]
            : []),
        ]
      : []),
    ...(requirements.requireObjectMatch
      ? [
          "The brief explicitly asks for an object-carrying cut; plan at least one typed",
          "match boundary with both focal part names.",
        ]
      : []),
    ...(requirements.requireShapeMatch
      ? [
          "The brief explicitly asks for a morph transition; plan at least one",
          "typed morph boundary with both focal part names and shapeOut/shapeIn",
          "silhouette hints, at the story beat where the two elements' meanings connect.",
        ]
      : []),
    ...(requirements.requireSharedElementCut
      ? [
          "The brief explicitly asks for shared-element continuity; plan at least one",
          "typed morph boundary, or a typed match boundary with BOTH focal part names.",
        ]
      : []),
    ...(requirements.requireOrbit
      ? [
          "The brief explicitly asks for an orbit peak; one camera path must contain a",
          "typed orbit or orbit-lite move. Describing an orbit only in prose does not count.",
        ]
      : []),
    ...(requirements.requireTimeRamp
      ? [
          "The brief explicitly asks for a speed ramp / slow-motion beat; declare one",
          "timeRamp dip on the shot with the film's most important resolve (never shot",
          "1) and place a declared moment inside its slow-motion hold.",
        ]
      : []),
    "",
    "STORYBOARD MOMENTS — the real review contract. A moment is one reviewable",
    "CHANGED STATE the viewer can point at: a typed word replacing another, a",
    "cursor arriving, a chart completing, a camera landing on a station, a UI",
    "state flipping, a metric hitting its number, a logo resolving. Think like",
    "an animatic: thumbnail by thumbnail, what happens, where, and when. Scenes",
    "are render containers; moments are the film. Plan roughly one moment every",
    "2.25 seconds — a 15s film needs 7+, a 24s film 10+ — and never leave more",
    "than ~2.5s without one (a short final resolve is the only exception).",
    "Every moment must be executable: the author will bind it to a cut, a typed",
    "camera move, an interaction, or an explicitly timed component beat at its",
    "atSec, and publication fails if the timeline cannot prove it. Ambient",
    "drift never counts as a moment. Spread moments across each shot (one in",
    "the back half); do not cluster them at entrances, and make consecutive",
    "moments show visibly different frames. Mark the film's key images",
    '"primary" (5-8 per film) and connective development "supporting".',
    "METHOD — plan typed beats and camera arrivals FIRST, then place moments",
    "ON them: any ~2.5s stretch of the film with no typed beat, camera",
    "arrival, or cut is rejected as a dead interval, because a moment there",
    "would have no executable evidence. When you find a dead stretch, add a",
    "count/progress/highlight development beat on an existing component (or a",
    "camera arrival) there — never a bare moment.",
    "",
    ...(concept
      ? [
          "## Locked creative direction (from the concept pass)",
          "Expand this direction faithfully: the shots must express the thesis,",
          "follow the energy curve, carry the motif across cuts, and realize the",
          "color arc through scene grades.",
          `<concept_json>${JSON.stringify(concept)}</concept_json>`,
          "",
        ]
      : []),
    // Always present: the template generator owns duration by construction
    // (host arithmetic over typed segments), replacing the retry-causing
    // duration gate. The light model only picks WHICH template; a failed or
    // disabled hint falls back to a deterministic keyword pick.
    ...storyboardShapeScaffold(
      shapeHint?.shape ?? defaultShapeForBrief(args.brief),
      args.targetDurationSec ?? 24,
    ),
    ...(shapeHint?.why ? [`(Template chosen by a structural pre-pass: ${shapeHint.why})`] : []),
    "",
    storyboardReference(args.skills.text),
    "",
    "## Brief and trusted evidence",
    args.brief,
    "",
    args.frameMd
      ? `## Job frame capsule\nUse its visual thesis, palette/type constraints, spatial character, material profile, and motion signature as binding taste. Exact choreography remains yours.\n<frame_capsule>\n${frameCapsule(args.frameMd)}\n</frame_capsule>`
      : "",
    "",
    "## Available project-local assets",
    availableAssets(args.projectDir),
    "",
    "## Response contract",
    structuredOutput
      ? 'Return only a JSON object with "productionBasis" (light|dark) and one "storyboard" array. No tags, Markdown, or prose.'
      : "Return only <storyboard_json> containing a JSON object with productionBasis (light|dark) and a storyboard array. No Markdown or prose.",
    "Shots must be contiguous, start at 0, total 6-60 seconds, and last 1.5-15 seconds each.",
    "Use this exact shape for every shot:",
    '{"id":"kebab-case","title":"human title","purpose":"viewer change",',
    '"incomingIdea":"idea entering this shot","foreground":"specific hero composition",',
    '"background":"specific atmospheric/set layer","cameraIntent":"framing or camera move",',
    '"startSec":0,"durationSec":4,"blueprint":"known blueprint or compose",',
    '"rules":["known rule"],"capabilityIds":["zero or more exact index ids"],',
    '"continuityAnchor":"what the eye tracks across this boundary",',
    '"outgoingCut":"cut mechanism and destination",',
    '"cut":{"version":1,"style":"swipe|morph|match|hard",',
    '"axis":"swipe only: left|right|up|down","cover":true,',
    '"focalPartOut":"for morph/match","focalPartIn":"for morph (and match when bridged)",',
    '"shapeOut":"optional morph hint: pill|bar|card|circle|window","shapeIn":"same"},',
    '"timeRamp":{"version":1,"atSec":17.2,"slowTo":0.35,"holdSec":0.6,"recoverSec":0.9} for the',
    'one motivated slow-motion dip; use "timeRamp":{"version":1} for no ramp (the default).',
    "timeRamp atSec is absolute composition seconds where the dip begins.",
    '"gradeShift":{"version":1,"atSec":12.4,"toGrade":"cold|neutral|warm|noir","fromPart":"optional"}',
    "for one mid-scene temperature turn — the story warming/cooling AT a payoff.",
    "atSec is absolute composition seconds; it needs >=1.2s of scene after it and",
    "must coincide with a declared moment. fromPart is the element the wash expands",
    "from (default: frame center). At most one per scene, two per film; omit it otherwise.",
    '"camera":{"version":1,"depth3d":true,"path":[{"version":1,"move":"hold|drift|pan|whip|push-in|pull-back|track-to-anchor|parallax-pass|orbit-lite|orbit|dive",',
    '"toRegion":"region name (or toPart for track-to-anchor)","zoom":1,"startSec":0,"durationSec":1.2,',
    '"arcDeg":28,"focus":{"part":"data-part to pull focus onto","depth":0.35,"blurMaxPx":6},',
    "arcDeg only for orbit; focus is an optional rack-focus modifier on any move,",
    "with either part or depth (not both).",
    "depth3d is optional and rare: only on a hero/graphic shot whose path has an",
    "orbit AND whose scene will carry 2-4 data-depth layers — the layers then",
    "separate in real 3D while the camera arcs. Omit it everywhere else.",
    '"ease":"optional: seqSwoosh|seqWhip|seqImpulse|seqSettle|seqGlide|seqDrift|seqAnticipate"}]},',
    'Use "camera":{"version":1,"path":[]} for a shot without a camera path.',
    "The first path entry establishes the entry framing: start with a short",
    "hold or drift on the region the cut lands on, or give the first full move",
    "a fromRegion. The host fills every timing gap with drift automatically.",
    '"worldLayout":[{"region":"metric-wall","cell":[1,0]}] — required for shots',
    "whose camera visits 2+ regions; one distinct cell per region, integers -2..2.",
    '"components":[{"version":1,"id":"kebab-case-part-name","kind":"one of the component kit kinds",',
    '"region":"optional camera region it lives at","role":"hero|support",',
    ...(continuityGraphEnabled()
      ? ['"entityId":"stable product identity shared across shots"}],']
      : ['"entityId":"optional"}],']),
    '"beats":[{"version":1,"id":"kebab-case","component":"declared component id","kind":"type|open|close|select|press|set-state|count|progress|chart|rows|stream|highlight|morph|swap",',
    '"atSec":2.4,"durationSec":1.1,"text":"for type/stream/swap","value":40,"item":2,',
    '"toState":"for set-state/press","morphTo":"for morph","ease":"optional",',
    '"style":"optional: type→typewriter|rise|pop|assemble, open→pop (compact kinds), highlight→ring|sweep|underline"}],',
    "Beat atSec values are absolute composition seconds inside the shot window.",
    'Use "components":[] and "beats":[] when a shot has no product surface.',
    ...(continuityGraphEnabled()
      ? [
          '"continuity":[{"version":1,"entityId":"trace",',
          '"part":"scene-local-part","kind":"product-shell|trace|alert|metric|cta|generic",',
          '"representation":"how this shot renders the same object"}] — use for renamed',
          "or non-component representations; repeated component entityId is already enough.",
          'Use "continuity":[] when no extra mapping is needed.',
        ]
      : []),
    '"recipes":[{"version":1,"id":"library recipe id","params":[{"name":"slot","value":"…"}]}]',
    "— declare a retrieved proven recipe (see the recipe section above when",
    "present) on the shot it belongs to; the host injects its proven",
    "markup+motion verbatim with your param values, costing zero authoring",
    'budget. Use "recipes":[] when no library recipe fits the shot.',
    '"plugins":[{"version":1,"kind":"dashboard-grid|notification-stack|lockup",',
    '"id":"kebab-case unit part name","region":"optional station",',
    '"params":[{"name":"…","value":"…"}]}]',
    "— declare a host plugin (see HOST PLUGINS above) on the shot that wants a",
    'generated set-piece; use "plugins":[] otherwise.',
    "A component id doubles as its data-part: cameras can track-to-anchor it,",
    "object-match cuts can carry it, and cursor interactions can click it.",
    '"spatialIntent":{"version":1,"focalPart":"stable semantic part",',
    '"composition":"free-text compositional character","relationships":["important relationship"]},',
    '"moments":[{"version":1,"id":"kebab-case","atSec":1.2,"title":"short reviewable title",',
    '"visualState":"what the review frame shows","change":"what became different",',
    '"motionIntent":"type-on|ui-state|camera-arrival|cut|reveal|draw-on|morph|resolve",',
    '"importance":"primary|supporting"}],',
    "Moment atSec values are absolute composition seconds inside the shot window.",
    '"interactions":[]}.',
    "For a cursor shot, interactions contains semantic movement/click intents with",
    "version,id,sceneId,cursorId,targetPart,item,action,startSec,arriveSec,from,path,",
    "aimX,aimY,feedback and action-specific pressSec/releaseSec/holdUntilSec,",
    "ripplePart or dragTargetPart. ripplePart is mandatory for ripple or",
    "press-ripple feedback; dragTargetPart is mandatory for drag. Times are",
    "absolute composition seconds.",
    "Plan at most one cursor interaction per shot. targetPart names one unique",
    "component; optional 1-based item names its exact row. Use the SAME item on",
    "matching select/highlight/underline beats. ripplePart stays scene-unique.",
    "The aim is normalized inside the real target. Choose the target, approach,",
    "path, timing, ease, and restrained optical offset creatively; never choose canvas x/y.",
    "Keep pointer aim within the target's comfortable interior (normally 0.2-0.8",
    "on each axis), use an edge/third entry anchor rather than frame:center, and",
    "prefer a subtle human path with power2.out over a theatrical arc. The runtime owns the",
    "cursor actor, hotspot, endpoint, press, visibility lifecycle, and ripple.",
  ].filter(Boolean).join("\n");
  // The storyboard is a bounded artifact: when the model returns a plan that
  // deterministic validation rejects, retry only this stage with the exact
  // findings PLUS the rejected plan itself for a minimal edit — never fall
  // through to the safe fallback on a first creative miss, and never replay
  // the concept pass. (2026-07-06 probe lesson: findings-only retries made
  // both planner models redesign from scratch each attempt, minting fresh
  // violations — 4/5 probes exhausted all five rungs that way.) When the
  // primary model exhausts its attempts — validation rejections OR transient
  // route exhaustion — one independent rescue model gets the same brief, the
  // last rejected plan, and the accumulated findings before the caller may
  // ship the deterministic fallback: different model, same convergence seam.
  const rescue = storyboardRescueModel(provider, model);
  const rungs: Array<{
    label: string;
    model?: string;
    thinkingMode: CompleteOptions["thinkingMode"];
    maxAttempts: number;
  }> = [
    {
      label: "primary",
      ...(model ? { model } : {}),
      thinkingMode,
      maxAttempts: boundedCreate ? 2 : 3,
    },
    ...(!boundedCreate && rescue
      ? [{
          label: "rescue",
          model: rescue,
          thinkingMode: storyboardRescueThinkingMode(),
          maxAttempts: 2,
        }]
      : []),
  ];
  let totalAttempts = 0;
  let lastValidationError: Error | undefined;
  let lastRejectedPlan: DirectScene[] | undefined;
  let lastError: unknown;
  // One grace replay per RUN for a response carrying no storyboard artifact at
  // all: there was no plan to reject, so spending a scarce attempt on it is
  // pure waste (live probe audit-final-a1 died exactly here — the rescue
  // model's FINAL attempt returned prose with no <storyboard_json> and the
  // whole run fell through to the fallback path).
  let artifactGraceUsed = false;
  // One scene-scoped repair per run: the first rejection whose findings ALL map
  // to named shots re-plans only those shots in a bounded low-reasoning call
  // (repairStoryboardScenesForFindings) before spending a full re-plan attempt.
  let sceneRepairUsed = false;
  for (const rung of rungs) {
    let recoveringFromTruncation = false;
    let reasoningFloor: CompleteOptions["thinkingMode"] | undefined;
    const rungMaxTokens =
      rung.thinkingMode === "none" ? STORYBOARD_MAX_TOKENS : REASONING_STORYBOARD_MAX_TOKENS;
    attempts: for (let attempt = 1; attempt <= rung.maxAttempts; attempt += 1) {
      totalAttempts += 1;
      appendSentinelLedgerEvent({
        kind: "attempt-start",
        stage: "storyboard-plan",
        number: totalAttempts,
        mode: rung.label,
      });
      const endAttempt = (outcome: string, findings: string[] = []): void => {
        appendSentinelLedgerEvent({
          kind: "attempt-end",
          stage: "storyboard-plan",
          number: totalAttempts,
          outcome,
        });
        for (const signature of findings.map(findingSignature)) {
          appendSentinelLedgerEvent({ kind: "qa-finding", signature });
        }
      };
      const prompt = [
        basePrompt,
        ...(lastValidationError
          ? [
              "",
              "## Previous attempt rejected — fix it with the SMALLEST edit",
              ...(lastRejectedPlan
                ? [
                    "Deterministic validation rejected the storyboard below. Do NOT",
                    "redesign it: reproduce it FIELD-FOR-FIELD — every shot id,",
                    "duration, camera move (including its toRegion/toPart/zoom/ease),",
                    "beat, moment, worldLayout cell, and creative choice that no",
                    "finding names stays EXACTLY as written. Apply the smallest edit",
                    "that fixes each finding (each finding names its own fix), then",
                    "return the corrected COMPLETE storyboard. Dropping a field you",
                    "were not asked to change (a camera move's target, a beat's text)",
                    "creates NEW violations — surgical fixes converge, redesigns and",
                    "lossy copies do not.",
                    "<previous_storyboard_json>",
                    JSON.stringify(
                      lastRejectedPlan.map(
                        ({ sentinelNormalizations: _notes, layoutRepairs: _layoutRepairs, ...scene }) => scene,
                      ),
                    ),
                    "</previous_storyboard_json>",
                    "Findings to fix (each names its own fix):",
                  ]
                : [
                    "Deterministic validation rejected the previous storyboard. Fix every",
                    "finding below and return a corrected, complete storyboard:",
                  ]),
              ...lastValidationError.message
                .replace(/^invalid storyboard plan:\s*/i, "")
                .split("; ")
                .slice(0, 16)
                .map((finding) => `- ${finding}`),
            ]
          : []),
        ...(recoveringFromTruncation
          ? [
              "",
              "## Previous attempt exhausted its output budget",
              "The last response was truncated at the completion limit. Keep your",
              "reasoning, but return a SMALLER artifact: plan fewer shots (stay near",
              "the storyboard minimum), keep every title/purpose/idea string terse,",
              "declare only the moments/beats the contract requires, and emit the",
              "storyboard as compact single-line JSON with no prose around it.",
            ]
          : []),
      ].join("\n");
      let raw: string;
      try {
        // Truncation recovery NEVER strips reasoning: the 2026-07-03
        // experiment matrix showed reasoning-stripped GLM retries failing the
        // moment grid in 3 of 4 runs, and the improve-ws32-1 probe burned two
        // attempts on structurally broken reasoning-stripped recovery plans.
        // The budget is protected by demanding a smaller ARTIFACT (prompt
        // section above); a rung that keeps truncating hands over to the
        // independent rescue rung instead of degrading its own planning.
        const attemptThinkingMode =
          reasoningFloor && rung.thinkingMode === "none"
            ? reasoningFloor
            : rung.thinkingMode;
        process.stderr.write(
          `[storyboard] attempt ${totalAttempts} (${rung.label} ${attempt}/${rung.maxAttempts}) · ` +
            `${rung.model ? `model ${rung.model}` : "provider primary model"} · ` +
            `reasoning ${attemptThinkingMode} · max ${rungMaxTokens} tokens` +
            `${recoveringFromTruncation ? " · compact-artifact recovery" : ""}\n`,
        );
        raw = await completeReasoningWithRetry(provider, prompt, {
          ...args.options,
          // A reasoning storyboard pass on a loaded provider can run long; give it more
          // wall-clock headroom than a plain chat call, and let completeWithRetry absorb
          // a transient stall instead of failing the whole build on the first abort.
          timeoutMs: 360_000,
          maxTokens: rungMaxTokens,
          // GLM's budget includes reasoning plus the compact JSON artifact; use
          // nearly the full route ceiling while keeping the artifact bounded.
          thinkingMode: attemptThinkingMode,
          ...(structuredOutput ? { responseFormat: storyboardResponseFormat() } : {}),
          ...(rung.model ? { model: rung.model } : {}),
        }, "storyboard");
      } catch (error) {
        if (attempt < rung.maxAttempts && isOutputTruncation(error)) {
          recoveringFromTruncation = true;
          endAttempt("truncated");
          process.stderr.write(
            `[storyboard] ${rung.label} attempt ${attempt} exhausted its completion budget; ` +
              `retrying the bounded artifact with lower reasoning effort\n`,
          );
          continue;
        }
        if (attempt < rung.maxAttempts && isReasoningMandatoryError(error)) {
          reasoningFloor = "minimal";
          endAttempt("reasoning-mandatory-retry");
          process.stderr.write(
            `[storyboard] ${rung.label} attempt ${attempt}: this endpoint mandates reasoning; ` +
              `retrying with a minimal reasoning floor\n`,
          );
          continue;
        }
        // Provider-level failure (transient exhaustion, endpoint 4xx, final
        // truncation): move to the next rung — a different model usually
        // lands on a different upstream route and a different failure mode.
        lastError = error;
        endAttempt("provider-error");
        process.stderr.write(
          `[storyboard] ${rung.label} model unavailable: ` +
            `${error instanceof Error ? error.message.slice(0, 300) : String(error)}\n`,
        );
        break attempts;
      }
      let storyboard: DirectScene[];
      try {
        storyboard = parseStoryboardResponse(raw, requirements, {
          ...(args.frameMd ? { frameMd: args.frameMd } : {}),
          // Degrade only on the FINAL storyboard attempt of the FINAL rung: a
          // hopeless volunteered pair degraded on the primary rung's last
          // attempt would return immediately and the independent rescue model
          // (which might re-point the cut at rhyming endpoints and save the
          // premium morph) would never be consulted.
          degradeShapeHintMismatches:
            !boundedCreate &&
            rung === rungs[rungs.length - 1] && attempt === rung.maxAttempts,
          // Pacing pressure stays blocking for the first two primary
          // attempts, then degrades to advisory: from the primary rung's
          // final attempt onward (including every rescue attempt), a plan
          // clean except for pacing ships instead of falling back.
          degradePacingFindings:
            !boundedCreate && (rung !== rungs[0] || attempt === rung.maxAttempts),
          degradeAdvisoryFindings: boundedCreate,
        });
      } catch (error) {
        if (error instanceof Error && isOutputTruncation(error)) {
          // A truncated artifact detected at parse time (opened-but-unclosed
          // wrapper) is the same failure as a provider-reported truncation.
          persistStoryboardAttempt(args.projectDir, totalAttempts, "truncated", {
            rung: rung.label,
            raw,
            cacheKey,
          });
          endAttempt("truncated");
          if (attempt < rung.maxAttempts) {
            recoveringFromTruncation = true;
            process.stderr.write(
              `[storyboard] ${rung.label} attempt ${attempt} returned a truncated artifact; ` +
                `retrying with lower reasoning effort\n`,
            );
            continue;
          }
          lastError = error;
          break attempts;
        }
        if (error instanceof Error) {
          // A response with NO storyboard artifact is not a rejected plan —
          // the model glitched its output format. Replay the attempt once per
          // run instead of letting a formatting fault consume a rung's final
          // slot; the previous findings (if any) stay in the prompt untouched.
          if (
            !boundedCreate &&
            !artifactGraceUsed &&
            /missing <storyboard_json>/.test(error.message)
          ) {
            artifactGraceUsed = true;
            persistStoryboardAttempt(args.projectDir, totalAttempts, "artifact-missing", {
              rung: rung.label,
              raw,
              cacheKey,
            });
            endAttempt("artifact-missing");
            process.stderr.write(
              `[storyboard] ${rung.label} attempt ${attempt} returned no storyboard artifact; ` +
                `replaying the attempt once (formatting fault, not a plan rejection)\n`,
            );
            attempt -= 1;
            continue;
          }
          lastValidationError = error;
          // The retry baseline: the exact plan the findings describe (post any
          // committed normalization). Minimal-edit retries converge where
          // findings-only from-scratch retries whack-a-mole.
          lastRejectedPlan =
            error instanceof StoryboardValidationError ? error.storyboard : undefined;
          // Prefer the raw finding array (findings can contain "; " — see
          // StoryboardValidationError.findings). Splitting the message
          // over-fragments them and poisons the scene-repair's attribution.
          const rejectionFindings =
            error instanceof StoryboardValidationError
              ? error.findings
              : error.message.replace(/^invalid storyboard plan:\s*/i, "").split("; ");
          persistStoryboardAttempt(args.projectDir, totalAttempts, "rejected", {
            rung: rung.label,
            raw,
            findings: rejectionFindings,
            cacheKey,
          });
          endAttempt("rejected", rejectionFindings);
          // Scene-scoped repair rung (once per run): if EVERY blocking finding
          // maps to a named shot, re-plan ONLY those shots against the locked
          // remainder in one bounded low-reasoning call instead of gambling the
          // whole ~6-min re-plan. On convergence, adopt + cache and return; on
          // any miss it returns undefined and the full ladder continues below.
          if (!boundedCreate && !sceneRepairUsed && lastRejectedPlan) {
            sceneRepairUsed = true;
            let repaired = await repairStoryboardScenesForFindings(
              provider,
              {
                brief: args.brief,
                ...(args.frameMd ? { frameMd: args.frameMd } : {}),
                ...(args.options ? { options: args.options } : {}),
                requirements,
                ...(rung.model ? { model: rung.model } : {}),
              },
              lastRejectedPlan,
              rejectionFindings,
            );
            if (repaired) {
              repaired = autoDeclareRecipes(repaired);
              const repairDegradations = acceptedStoryboardDegradations.get(repaired) ?? [];
              for (const degradation of repairDegradations) {
                recordSentinelDegradation(degradation);
              }
              writePlanningArtifact(cacheFile, {
                version: 1,
                key: cacheKey,
                storyboard: repaired,
                degradations: repairDegradations,
                ...(expectedBasis ? { productionBasis: expectedBasis } : {}),
              });
              writePlanningArtifact(sharedFile, {
                version: 1,
                key: cacheKey,
                storyboard: repaired,
                degradations: repairDegradations,
                ...(expectedBasis ? { productionBasis: expectedBasis } : {}),
              });
              recordConversions(repaired);
              return repaired;
            }
          }
          process.stderr.write(
            `[storyboard] ${rung.label} attempt ${attempt} rejected: ` +
              `${error.message.slice(0, 600)} — ${
                attempt < rung.maxAttempts ? "retrying with findings" : "carrying findings forward"
              }\n`,
          );
          continue;
        }
        lastError = error;
        endAttempt("error");
        break attempts;
      }
      const degradations = acceptedStoryboardDegradations.get(storyboard) ?? [];
      storyboard = autoDeclareRecipes(storyboard);
      const productionBasis = storyboardProductionBasis(raw);
      for (const degradation of degradations) {
        recordSentinelDegradation(degradation);
      }
      const payload = {
        version: 1,
        key: cacheKey,
        storyboard,
        degradations,
        ...(productionBasis ? { productionBasis } : {}),
      };
      writePlanningArtifact(cacheFile, payload);
      writePlanningArtifact(sharedFile, payload);
      endAttempt("accepted");
      recordConversions(storyboard);
      return storyboard;
    }
  }
  if (!lastValidationError && isTransientProviderError(lastError)) {
    throw new Error(
      "the planning model kept timing out while drafting the storyboard — this is usually a " +
        "transient provider slowdown, not your brief. Run /sequences again in a moment.",
    );
  }
  throw lastValidationError ??
    (lastError instanceof Error ? lastError : new Error("storyboard planning failed"));
}




/**
 * Diagnostic persistence for the author chain: every rejected attempt's
 * document (or raw response when nothing parsed) lands under
 * `planning/attempts/` so a failed paid run can be diagnosed offline without
 * re-spending the model call. Best-effort only — a disk error must never
 * affect authoring, and nothing here re-enters the pipeline.
 */
function persistAuthorAttempt(
  projectDir: string,
  attempt: number,
  outcome: "static-rejected" | "browser-rejected" | "exception",
  details: {
    mode: "full" | "patch" | "rescue";
    findings?: string[];
    html?: string;
    raw?: string;
  },
): void {
  try {
    const dir = path.join(projectDir, "planning", "attempts");
    fs.mkdirSync(dir, { recursive: true });
    const stem = `author-${attempt}-${outcome}`;
    if (details.html) {
      fs.writeFileSync(path.join(dir, `${stem}.html`), details.html, "utf8");
    } else if (details.raw) {
      fs.writeFileSync(
        path.join(dir, `${stem}.raw.txt`),
        details.raw.slice(0, 400_000),
        "utf8",
      );
    }
    fs.writeFileSync(
      path.join(dir, `${stem}.json`),
      JSON.stringify(
        {
          attempt,
          outcome,
          mode: details.mode,
          at: new Date().toISOString(),
          findings: (details.findings ?? []).slice(0, 40),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Diagnostics only.
  }
}

/* --------------------------- author-loop reliability: signatures + strategy */



/** Per-attempt entry of the persisted author-run diagnostic summary. */
interface AuthorRunAttempt {
  number: number;
  mode: "full" | "patch" | "rescue";
  outcome: "static-rejected" | "browser-rejected" | "exception";
  findingSignatures: string[];
}

interface AuthorRunSummary {
  stage: "source-author";
  outcome?: "published" | "failed";
  attempts: AuthorRunAttempt[];
  strategyChanges: string[];
  failureReason?: string;
}

/**
 * Record one rejected author attempt: the ledger gets the typed attempt-end
 * (S1.1 — the ledger is the only counter) and author-run.json keeps its
 * diagnostic detail (mode + finding signatures) unchanged.
 */
function recordAuthorAttempt(summary: AuthorRunSummary, entry: AuthorRunAttempt): void {
  appendSentinelLedgerEvent({
    kind: "attempt-end",
    stage: "source-author",
    number: entry.number,
    outcome: entry.outcome,
  });
  for (const signature of entry.findingSignatures) {
    appendSentinelLedgerEvent({ kind: "qa-finding", signature });
  }
  summary.attempts.push(entry);
}

/**
 * One queryable JSON artifact per authoring run (`planning/author-run.json`):
 * attempt modes, normalized finding signatures, and strategy changes — enough
 * to group failed runs into classes offline without scraping log lines or
 * re-reading every persisted attempt document. Signatures only, never brief
 * content or model output; best-effort like every diagnostic.
 */
function persistAuthorRunSummary(projectDir: string, summary: AuthorRunSummary): void {
  try {
    const dir = path.join(projectDir, "planning");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "author-run.json"),
      JSON.stringify(
        {
          ...summary,
          terminalFindingSignatures:
            summary.attempts[summary.attempts.length - 1]?.findingSignatures ?? [],
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Diagnostics only.
  }
}

/** A stable, valid `data-composition-id` for a host-assembled slot document. */
function slotCompositionId(projectDir: string): string {
  const base = path.basename(projectDir).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "composition"}-slots`;
}

function recordSlotScriptRepairs(repairs: {
  bareFromTo: number;
  pseudoTimeline: number;
  arrowEnvelope: number;
  globalTween: number;
  timePosition: number;
  dataAttribute: number;
  localPosition: number;
}): void {
  const total = repairs.bareFromTo + repairs.pseudoTimeline + repairs.arrowEnvelope +
    repairs.globalTween + repairs.timePosition + repairs.dataAttribute + repairs.localPosition;
  if (!total) return;
  recordSentinelNormalization("slot-script-envelope", total);
  process.stderr.write(
    `[author] normalized ${total} invalid scene-slot timeline binding(s) ` +
      `(${repairs.bareFromTo} bare fromTo, ${repairs.pseudoTimeline} pseudo timeline, ` +
      `${repairs.arrowEnvelope} uninvoked arrow envelope, ${repairs.globalTween} global tween, ` +
      `${repairs.timePosition} misplaced time, ` +
      `${repairs.dataAttribute} data attribute, ${repairs.localPosition} local position)\n`,
  );
}



/**
 * Author one scene-slot composition (Sentinel Phase 2). Requests the shared
 * film style + per-scene interior/script slots in one call, recovers a
 * truncated tail by re-requesting only the missing scenes (keeping every
 * completed scene AND treating a scene whose <scene_script> is missing as
 * incomplete — an interior without a script assembles into a scene that never
 * moves), then enforces the scaffold contract with ONE scene-scoped repair
 * round (the bounded scene-scoped retry: a dropped component root or camera
 * station re-requests only the offending scenes at ~continuation cost instead
 * of burning a whole-document paid attempt). A response missing every scene,
 * or still missing interiors/scripts after continuation, throws so the loop
 * falls back to the whole-doc ladder.
 */
export async function authorSlotDraft(
  provider: AgentProvider,
  args: DirectCompositionArgs,
  initialPrompt: string,
  completeOptions: CompleteOptions,
): Promise<{ draft: DirectCompositionDraft; raw: string; slots: ParsedSceneSlots }> {
  const storyboard = args.lockedStoryboard!;
  let raw = await completeSourceWithContinuation(provider, initialPrompt, completeOptions);
  let slots = extractSceneSlots(raw);
  const missingOf = (parsed: ParsedSceneSlots): DirectScene[] =>
    storyboard.filter((scene) => {
      const slot = parsed.scenes.get(scene.id);
      return !slot?.html?.trim() || !slot?.script?.trim();
    });
  const requestScenes = async (
    scenes: DirectScene[],
    repairNotes?: Map<string, string[]>,
    callKind: "truncation-continuation" | "scaffold-repair" | "validation-repair" =
      "truncation-continuation",
  ): Promise<void> => {
    recordSentinelSlotCall(callKind, scenes.length);
    const contRaw = await completeSourceWithContinuation(
      provider,
      slotContinuationPrompt(args, slots.filmStyle, scenes, repairNotes, repairNotes ? slots : undefined),
      { ...completeOptions, maxTokens: Math.min(authorMaxTokens(), 8_192) },
    );
    const contSlots = extractSceneSlots(contRaw);
    for (const [id, slot] of contSlots.scenes) {
      slots.scenes.set(id, { ...slots.scenes.get(id), ...slot });
    }
    if (!slots.filmStyle && contSlots.filmStyle) slots = { ...slots, filmStyle: contSlots.filmStyle };
    raw = `${raw}\n<!-- slot continuation -->\n${contRaw}`;
  };
  let missing = missingOf(slots);
  const anyHtml = storyboard.some((scene) => slots.scenes.get(scene.id)?.html?.trim());
  if (missing.length && anyHtml) {
    process.stderr.write(
      `[author] slot response incomplete (${missing.length}/${storyboard.length} scenes missing ` +
        `an interior or script); re-requesting only those scenes: ` +
        `${missing.map((s) => s.id).join(", ")}\n`,
    );
    await requestScenes(missing);
    missing = missingOf(slots);
  }
  // Scaffold-contract enforcement (the scene-scoped retry): one bounded repair
  // round for scenes that dropped a host-guaranteed binding the L2 reconcilers
  // cannot restore. If the round does not converge, assemble anyway — the L3
  // static gate still owns the finding (gates are never loosened).
  const violations = slotScaffoldViolations(storyboard, slots);
  if (violations.size) {
    const offenders = storyboard.filter((scene) => violations.has(scene.id));
    process.stderr.write(
      `[author] slot scaffold repair: ${violations.size} scene(s) dropped host-contract ` +
        `bindings (${offenders.map((s) => s.id).join(", ")}); re-requesting only those scenes\n`,
    );
    const violationCount = [...violations.values()].reduce((sum, notes) => sum + notes.length, 0);
    await requestScenes(offenders, violations, "scaffold-repair");
    const remaining = slotScaffoldViolations(storyboard, slots);
    const remainingCount = [...remaining.values()].reduce((sum, notes) => sum + notes.length, 0);
    const restored = Math.max(0, violationCount - remainingCount);
    if (restored) recordSentinelScaffoldRestoration("scene-repair", restored);
    if (remaining.size) {
      process.stderr.write(
        `[author] slot scaffold repair left ${remaining.size} scene(s) unresolved; ` +
          `assembling for the unchanged L3 gate: ${[...remaining.keys()].join(", ")}\n`,
      );
    }
  }
  const { html, missingHtml, missingScript, scriptRepairs } = assembleSlotComposition({
    storyboard,
    slots,
    compositionId: slotCompositionId(args.projectDir),
  });
  recordSlotScriptRepairs(scriptRepairs);
  if (missingHtml.length === storyboard.length) {
    throw new Error("author response is missing every <scene_html> slot");
  }
  if (missingHtml.length) {
    throw new Error(
      `author slot response is missing scene interior(s) after continuation: ${missingHtml.join(", ")}` +
        " — the next attempt must emit every scene more compactly.",
    );
  }
  if (missingScript.length) {
    throw new Error(
      `author slot response is missing <scene_script> block(s) after continuation: ` +
        `${missingScript.join(", ")} — every scene needs its timeline statements ` +
        "(a scene without a script never moves).",
    );
  }
  return { draft: { storyboard, html }, raw, slots };
}

/**
 * One bounded scene-scoped validation retry. It repairs the scene-attributable
 * SUBSET of findings: findings that map to named scenes are re-authored per
 * scene, while any film/shared-level findings (eye-trace, cross-cut framing, a
 * bare interaction/moment id) ride the whole-document ladder untouched. It
 * declines only when NO finding maps to a scene. The atomic acceptance at each
 * call site (finding-class count for static, quality penalty for browser — both
 * measured over the WHOLE film) rejects any subset repair that leaves or worsens
 * a film-level finding, so fixing part is never a regression, and the improved
 * draft is banked as the next attempt's scratch. Both the previous HTML and
 * script are sent as the minimal-edit baseline, and untouched scenes stay
 * byte-stable. (This previously declined whenever ANY finding was film-level,
 * which made it inert on dense briefs — the s5-interactions probe class always
 * mixes one film-level finding into otherwise scene-local rejections, so the
 * repair never fired on exactly the runs it exists to rescue.)
 */
export async function repairSlotDraftForFindings(
  provider: AgentProvider,
  args: DirectCompositionArgs,
  slots: ParsedSceneSlots,
  findings: string[],
  completeOptions: CompleteOptions,
  options?: {
    callKind?: SentinelSlotCallKind;
    repairPurpose?: "scaffold" | "validation" | "critique";
  },
): Promise<
  | {
      draft: DirectCompositionDraft;
      slots: ParsedSceneSlots;
      raw: string;
      sceneIds: string[];
    }
  | undefined
> {
  const storyboard = args.lockedStoryboard;
  if (!storyboard?.length || !findings.length) return undefined;
  const attributed = attributeFindingsToScenes(
    findings,
    storyboard.map((scene) => scene.id),
  );
  // Repair the scene-attributable subset. Film/shared-level findings (the
  // "__film__" bucket) are never sent to the scene author — they stay on the
  // whole-document ladder — but their presence no longer cancels a scene repair
  // that CAN help: declining only when NOTHING maps to a scene keeps the repair
  // effective on dense briefs, where a lone film-level finding used to veto it.
  const sceneIds = storyboard
    .map((scene) => scene.id)
    .filter((id) => attributed.has(id));
  if (!sceneIds.length) return undefined;
  const scenes = storyboard.filter((scene) => sceneIds.includes(scene.id));
  recordSentinelSlotCall(options?.callKind ?? "validation-repair", scenes.length);
  const raw = await completeSourceWithContinuation(
    provider,
    slotContinuationPrompt(
      args,
      slots.filmStyle,
      scenes,
      attributed,
      slots,
      options?.repairPurpose ?? "validation",
    ),
    { ...completeOptions, maxTokens: Math.min(authorMaxTokens(), 8_192) },
  );
  const repaired = extractSceneSlots(raw);
  // A partial response must not look successful merely because merge fallback
  // retained the old half of a scene. Require both requested blocks explicitly.
  if (
    scenes.some((scene) =>
      !repaired.scenes.get(scene.id)?.html?.trim() ||
      !repaired.scenes.get(scene.id)?.script?.trim()
    )
  ) {
    process.stderr.write(
      `[author] scene validation repair returned incomplete slots; keeping the previous draft\n`,
    );
    return undefined;
  }
  const merged: ParsedSceneSlots = {
    filmStyle: slots.filmStyle,
    scenes: new Map(slots.scenes),
    order: [...slots.order],
    truncated: slots.truncated || repaired.truncated,
  };
  for (const scene of scenes) {
    merged.scenes.set(scene.id, {
      ...merged.scenes.get(scene.id),
      ...repaired.scenes.get(scene.id),
    });
  }
  const assembled = assembleSlotComposition({
    storyboard,
    slots: merged,
    compositionId: slotCompositionId(args.projectDir),
  });
  recordSlotScriptRepairs(assembled.scriptRepairs);
  if (assembled.missingHtml.length || assembled.missingScript.length) return undefined;
  return {
    draft: { storyboard, html: assembled.html },
    slots: merged,
    raw,
    sceneIds,
  };
}

/**
 * Slot-scoped validation attribution (Sentinel Phase 2): report which scene
 * each rejection finding belongs to, so the failure is diagnosed and the
 * scene-attributable findings are re-requested per scene (any film-level
 * remainder keeps the whole-document ladder) instead of as one opaque document
 * rejection.
 */
function logSlotFindingAttribution(findings: string[], storyboard: DirectScene[]): void {
  const byScene = attributeFindingsToScenes(
    findings,
    storyboard.map((scene) => scene.id),
  );
  const summary = [...byScene.entries()]
    .map(([scene, list]) => `${scene}:${list.length}`)
    .join(" ");
  if (summary) {
    process.stderr.write(`[author] slot findings by scene — ${summary}\n`);
  }
}

export async function authorComposition(
  provider: AgentProvider,
  args: DirectCompositionArgs,
): Promise<CompositionRunResult> {
  const summary: AuthorRunSummary = {
    stage: "source-author",
    attempts: [],
    strategyChanges: [],
  };
  try {
    const result = await authorCompositionLoop(provider, args, summary);
    summary.outcome = "published";
    // The shipped draft ends the LAST started logical attempt (an early-ship
    // may publish a draft banked by an earlier one — the attempt-end records
    // when the stage stopped spending, not which draft won).
    const lastStarted = (activeSentinelLedgerEvents() ?? []).reduce(
      (last, event) =>
        event.kind === "attempt-start" && event.stage === "source-author" ? event.number : last,
      1,
    );
    appendSentinelLedgerEvent({
      kind: "attempt-end",
      stage: "source-author",
      number: lastStarted,
      outcome: "published",
    });
    return result;
  } catch (error) {
    summary.outcome = "failed";
    summary.failureReason = (error instanceof Error ? error.message : String(error))
      .slice(0, 600);
    throw error;
  } finally {
    persistAuthorRunSummary(args.projectDir, summary);
    // Attribute each rejected author attempt's FINDINGS to the layer that
    // caught them — static (L3) vs browser (L4) — plus the paid re-authors the
    // rejections cost (L5). Counting findings, not attempts: one attempt that
    // died on six findings is six caught states, and the docs promised
    // findings-by-layer.
    for (const attempt of summary.attempts) {
      const findings = Math.max(1, attempt.findingSignatures.length);
      if (attempt.outcome === "static-rejected") recordSentinelLayerFinding("static", findings);
      else if (attempt.outcome === "browser-rejected") recordSentinelLayerFinding("browser", findings);
      if (attempt.number > 1) recordSentinelLayerFinding("model-retry");
    }
  }
}

async function authorCompositionLoop(
  provider: AgentProvider,
  args: DirectCompositionArgs,
  summary: AuthorRunSummary,
): Promise<CompositionRunResult> {
  if (!args.brief.trim()) throw new Error("brief is empty");
  const boundedCreate = boundedCreatePolicyActive();
  const maxSourceAttempts = boundedCreate ? 2 : 3;
  let validationFeedback: string[] | undefined;
  let scratch: DirectCompositionDraft | undefined;
  let compact = false;
  let lastError: unknown;
  // Requirement provenance for degradation decisions: a bridged cut style the
  // brief explicitly requested must never silently degrade, while one the
  // planner volunteered must never sink the film.
  const requirements = inferStoryboardPlanRequirements(args.brief);
  // Signatures of the previous static rejection — a signature present in two
  // consecutive rejections survived a repair that was told to fix it.
  let previousStaticSignatures: ReadonlySet<string> = new Set();
  // Signatures of the previous BROWSER rejection — an identical set on the
  // next attempt proves the paid patch between them moved nothing the gate
  // measures, so the banked least-bad draft ships early (see
  // stagnantPolishShipReason).
  let previousBrowserSignatures: ReadonlySet<string> = new Set();
  let lastRuntimeValid:
    | (CompositionRunResult & { qualityPenalty: number })
    | undefined;
  // Sentinel slot persistence (2026-07-07): the slot map that assembled the
  // current retry baseline (`scratch`). Attempt 1's scene-addressable state
  // used to die with its loop iteration — persisted ledgers showed slotCalls:0
  // on retry-heavy runs — so every recovery attempt re-gambled the whole
  // document. While the baseline is still slot-assembled, a rejected attempt
  // first re-authors ONLY the failing scenes (one bounded call) before any
  // whole-document patch; adopting a non-slot draft invalidates the map.
  let persistedSlots: ParsedSceneSlots | undefined;
  let slotRetryUsed = false;
  const publishRuntimeValidCandidate = (
    candidate: CompositionRunResult & { qualityPenalty: number },
    attempts: number,
    reason: string,
  ): CompositionRunResult => {
    process.stderr.write(
      `[author] ${reason}; publishing runtime-valid attempt ` +
        `${candidate.attempts}/${maxSourceAttempts} ` +
        `after ${attempts} attempt(s)\n`,
    );
    summary.strategyChanges.push(reason);
    recordSentinelDegradation(reason);
    const { qualityPenalty: _qualityPenalty, ...best } = candidate;
    // Carry the exit reason so the critic can skip a run that shipped because
    // two targeted patches provably moved nothing (stagnant-polish-early-ship).
    return { ...best, attempts, earlyShipReason: reason };
  };
  // The most recent draft whose ONLY static blockers were declared-moment
  // paperwork (`storyboard/moments:` findings) — the last-resort salvage
  // candidate if the whole ladder exhausts (see the pre-throw salvage below).
  let lastMomentBlocked: { draft: DirectCompositionDraft; raw: string } | undefined;
  const interactionFallbacks: Array<{
    draft: DirectCompositionDraft;
    raw: string;
    browserQa: DirectBrowserQaResult;
  }> = [];
  const structuredPatches = supportsStructuredOutputs(provider);
  const productionTier = productionModel(provider);
  let reasoningFloor: CompleteOptions["thinkingMode"] | undefined;
  // The normal create path spends one initial pass plus at most one paid
  // repair. Isolated legacy helpers retain their historical third rung.
  for (let attempt = 1; attempt <= maxSourceAttempts; attempt += 1) {
    // Never spend the FINAL attempt on a compact patch when nothing
    // publishable is banked: a patch that misapplies or breaks syntax there
    // guarantees the deterministic fallback (both recorded 2026-07-04
    // fallbacks died exactly this way), while a full-context re-author at
    // least rolls new dice with the complete findings list. When an earlier
    // attempt already produced a runtime-valid draft, a final patch stays
    // cheap and safe — its failure still publishes the banked draft.
    if (!boundedCreate && attempt === 3 && scratch && !lastRuntimeValid) {
      process.stderr.write(
        `[author] final attempt with no runtime-valid draft banked; ` +
          `forcing a full-context re-author instead of a compact patch\n`,
      );
      summary.strategyChanges.push("full-reauthor-final-attempt");
      scratch = undefined;
      compact = true;
    }
    const patchMode = Boolean(scratch);
    appendSentinelLedgerEvent({
      kind: "attempt-start",
      stage: "source-author",
      number: attempt,
      mode: patchMode ? "patch" : "full",
    });
    // Sentinel Phase 2: the initial full authoring pass is scene-addressable
    // (film_style + per-scene slots the host assembles). Recovery passes stay
    // whole-doc (patch / compact re-author) — the slot path owns first-pass
    // coherence + truncation recovery; the ladder owns bounded repair.
    const useSlots =
      sentinelSlotsEnabled() && Boolean(args.lockedStoryboard) && !patchMode && !compact;
    // Never downgrade a full-document recovery because of its attempt number.
    // A separately configured repair model is eligible only when a valid
    // scratch document exists and the task is a bounded exact patch.
    const repairTier = patchMode ? repairModel(provider) : undefined;
    const selectedTier = repairTier ?? productionTier;
    const baseThinking = patchMode ? repairThinkingMode(repairTier) : authorThinkingMode();
    const attemptThinking =
      reasoningFloor && baseThinking === "none" ? reasoningFloor : baseThinking;
    const prompt = creationPrompt({
      ...args,
      validationFeedback,
      scratch,
      compact,
      structuredPatches,
      slots: useSlots,
    });
    process.stderr.write(
      `[author] attempt ${attempt}/${maxSourceAttempts} · prompt ${prompt.length} chars · ` +
      `${patchMode ? "compact repair" : useSlots ? "scene slots" : compact ? "full re-author (compact context)" : "full context"} · ` +
      `${repairTier ? "explicit repair tier" : selectedTier ?? "provider primary tier"} · ` +
      `reasoning ${attemptThinking}\n`,
    );
    let attemptRaw: string | undefined;
    try {
      const completeOptions: CompleteOptions = {
        ...args.options,
        timeoutMs: 360_000,
        maxTokens: patchMode ? REPAIR_MAX_TOKENS : authorMaxTokens(),
        thinkingMode: attemptThinking,
        ...(patchMode && structuredPatches ? { responseFormat: PATCH_RESPONSE_FORMAT } : {}),
        ...(selectedTier ? { model: selectedTier } : {}),
      };
      let raw = "";
      let parsedDraft: DirectCompositionDraft | undefined;
      let activeSlots: ParsedSceneSlots | undefined;
      let sceneValidationRepairUsed = false;
      // True while THIS attempt's draft is a host assembly of `activeSlots` —
      // the precondition for every scene-scoped repair seam below.
      let draftFromSlots = false;
      if (
        patchMode &&
        !slotRetryUsed &&
        persistedSlots &&
        args.lockedStoryboard &&
        validationFeedback?.length
      ) {
        // Scene-slot retry rung: while the retry baseline is still the slot
        // assembly, repair ONLY the scenes the findings name (one bounded
        // call) instead of gambling a whole-document patch. Findings that
        // attribute to no scene fall through to the ladder unchanged.
        try {
          const sceneRepair = await repairSlotDraftForFindings(
            provider,
            args,
            persistedSlots,
            validationFeedback,
            completeOptions,
          );
          if (sceneRepair) {
            slotRetryUsed = true;
            raw = sceneRepair.raw;
            parsedDraft = sceneRepair.draft;
            activeSlots = sceneRepair.slots;
            draftFromSlots = true;
            summary.strategyChanges.push(`slot-retry:${sceneRepair.sceneIds.join(",")}`);
            process.stderr.write(
              `[author] attempt ${attempt}/${maxSourceAttempts} scene-slot retry re-authored only: ` +
                `${sceneRepair.sceneIds.join(", ")}\n`,
            );
          }
        } catch (slotRetryError) {
          process.stderr.write(
            `[author] scene-slot retry failed; falling back to the whole-document ladder: ${
              slotRetryError instanceof Error ? slotRetryError.message : String(slotRetryError)
            }\n`,
          );
        }
      }
      if (!parsedDraft) {
        if (useSlots) {
          const slotResult = await authorSlotDraft(provider, args, prompt, completeOptions);
          raw = slotResult.raw;
          parsedDraft = slotResult.draft;
          activeSlots = slotResult.slots;
          draftFromSlots = true;
        } else {
          raw = patchMode
            ? await completeWithRetry(provider, prompt, completeOptions, "author patch")
            : await completeSourceWithContinuation(provider, prompt, completeOptions);
          parsedDraft = patchMode
            ? applyCompositionRepair(raw, scratch!)
            : args.lockedStoryboard
              ? {
                  storyboard: args.lockedStoryboard,
                  html: extractIndexHtmlSource(raw),
                }
              : parseCompositionResponse(raw);
        }
      }
      attemptRaw = raw;
      process.stderr.write(
        `[author] attempt ${attempt}/${maxSourceAttempts} response ${raw.length} chars\n`,
      );
      let draft = applyDeterministicSourceRepairs(
        parsedDraft,
        args.projectDir,
        args.lockedStoryboard,
      );
      if (patchMode && args.lockedStoryboard) {
        const graphError = lockedSceneGraphError(draft.html, args.lockedStoryboard);
        if (graphError) {
          throw new Error(
            `repair changed the locked storyboard (${graphError}); the patch was rejected atomically`,
          );
        }
      }
      let validation = await validateDirectComposition(args.projectDir, draft);
      if (!boundedCreate && !validation.ok) {
        const recovered = quarantineStaticInteractionErrors(draft, validation.errors);
        if (recovered?.removedIds.length) {
          process.stderr.write(
            `[author] quarantining ${recovered.removedIds.length} statically invalid optional ` +
              `interaction(s): ${recovered.removedIds.join(", ")}\n`,
          );
          draft = recovered.draft;
          validation = await validateDirectComposition(args.projectDir, draft);
        }
      }
      if (!validation.ok && draftFromSlots && activeSlots && args.lockedStoryboard) {
        try {
          const sceneRepair = await repairSlotDraftForFindings(
            provider,
            args,
            activeSlots,
            validation.errors,
            completeOptions,
          );
          sceneValidationRepairUsed = Boolean(sceneRepair);
          if (sceneRepair) {
            const candidate = applyDeterministicSourceRepairs(
              sceneRepair.draft,
              args.projectDir,
              args.lockedStoryboard,
            );
            const candidateValidation = await validateDirectComposition(args.projectDir, candidate);
            const beforeCount = new Set(validation.errors.map(findingSignature)).size;
            const afterCount = new Set(candidateValidation.errors.map(findingSignature)).size;
            if (candidateValidation.ok || afterCount < beforeCount) {
              process.stderr.write(
                `[author] scene-scoped static repair improved ${sceneRepair.sceneIds.join(", ")}: ` +
                  `${beforeCount} -> ${afterCount} finding class(es)\n`,
              );
              summary.strategyChanges.push(
                `scene-static-repair:${sceneRepair.sceneIds.join(",")}`,
              );
              draft = candidate;
              validation = candidateValidation;
              activeSlots = sceneRepair.slots;
              raw = `${raw}\n<!-- scene validation repair -->\n${sceneRepair.raw}`;
              attemptRaw = raw;
            } else {
              process.stderr.write(
                `[author] scene-scoped static repair did not reduce findings; keeping the previous draft\n`,
              );
            }
          }
        } catch (sceneRepairError) {
          process.stderr.write(
            `[author] scene-scoped static repair failed; keeping the previous draft: ` +
              `${sceneRepairError instanceof Error ? sceneRepairError.message : String(sceneRepairError)}\n`,
          );
        }
      }
      // Degradation rung: a volunteered bridged cut whose endpoint binding
      // survived a model repair (same signature across consecutive static
      // rejections) is provably stuck — retire the boundary to a swipe
      // deterministically instead of burning the remaining budget on it. Only
      // a fully valid degraded draft is accepted (atomic, like every other
      // recovery); attempt 1 never degrades so the author always gets one
      // real chance to bind the declared focal parts.
      if (!boundedCreate && !validation.ok && (patchMode || attempt === 3)) {
        const degradation = degradeVolunteeredBridgedCuts({
          draft,
          errors: validation.errors,
          storyboard: args.lockedStoryboard ?? draft.storyboard,
          requirements,
          persistentSignatures: previousStaticSignatures,
          projectDir: args.projectDir,
        });
        if (degradation) {
          const revalidated = await validateDirectComposition(args.projectDir, degradation.draft);
          if (revalidated.ok) {
            process.stderr.write(
              `[author] degraded ${degradation.degraded.length} volunteered bridged cut(s) with ` +
                `persistently unbindable focal parts to swipe: ` +
                `${degradation.degraded.join(", ")}\n`,
            );
            summary.strategyChanges.push(
              `degraded-volunteered-cut:${degradation.degraded.join(",")}`,
            );
            recordSentinelDegradation(
              `degraded-volunteered-cut:${degradation.degraded.join(",")}`,
            );
            draft = degradation.draft;
            validation = revalidated;
            if (args.lockedStoryboard) {
              args = { ...args, lockedStoryboard: degradation.storyboard };
              persistUpgradedStoryboard(args.projectDir, degradation.storyboard);
            }
          } else {
            process.stderr.write(
              `[author] volunteered-cut degradation left the draft invalid ` +
                `(${(revalidated.errors[0] ?? "").slice(0, 200)}); keeping the finding blocking\n`,
            );
          }
        }
      }
      if (!validation.ok) {
        process.stderr.write(
          `[author] attempt ${attempt}/${maxSourceAttempts} static validation rejected: ` +
            `${validation.errors.slice(0, 8).join(" | ").slice(0, 1_500)}\n`,
        );
        if (useSlots && args.lockedStoryboard) {
          logSlotFindingAttribution(validation.errors, args.lockedStoryboard);
        }
        if (validation.errors.every((error) => error.startsWith("storyboard/moments:"))) {
          lastMomentBlocked = { draft, raw };
        }
        persistAuthorAttempt(args.projectDir, attempt, "static-rejected", {
          mode: patchMode ? "patch" : "full",
          findings: validation.errors,
          html: draft.html,
        });
        const signatures: ReadonlySet<string> = new Set(
          validation.errors.map(findingSignature),
        );
        recordAuthorAttempt(summary, {
          number: attempt,
          mode: patchMode ? "patch" : "full",
          outcome: "static-rejected",
          findingSignatures: [...signatures].slice(0, 24),
        });
        const previousFeedback = validationFeedback ?? [];
        validationFeedback = patchMode
          ? [
              ...previousFeedback,
              "The proposed patch was rejected atomically because it made the last valid scratch fail static validation:",
              ...dedupeFeedbackBySignature(validation.errors),
            ].slice(0, 20)
          : dedupeFeedbackBySignature(validation.errors).slice(0, 20);
        // Never compound a malformed patch. Retry from the last statically
        // valid scratch; a malformed initial document becomes the scratch
        // because there is no earlier authored candidate to preserve —
        // UNLESS it contradicts the locked scene graph (extra/missing/
        // renamed scenes): patches against such a scratch are rejected
        // atomically by lockedSceneGraphError on every attempt, so seeding
        // it dooms the whole repair loop (2026-07-04 live probe: DeepSeek
        // authored 6 scenes against a 5-scene plan and both bounded repairs
        // burned on a structurally unfixable patch). Force a full re-author
        // with the findings instead.
        const graphBroken = Boolean(
          args.lockedStoryboard &&
          lockedSceneGraphError(draft.html, args.lockedStoryboard),
        );
        if (!patchMode && !graphBroken) {
          scratch = draft;
          // Bank (or invalidate) the slot map alongside the baseline it built.
          persistedSlots = draftFromSlots ? activeSlots : undefined;
        }
        compact = true;
        // Non-convergence switch: a structural signature that survived the
        // very patch asked to fix it will not yield to a second identical
        // compact patch — abandon the scratch and spend the next attempt as
        // a full-context re-author carrying the findings.
        if (
          repairStrategyAfterStaticRejection({
            patchMode,
            signatures,
            previousSignatures: previousStaticSignatures,
            degradableBoundaries: volunteeredCutBoundaries(
              args.lockedStoryboard ?? draft.storyboard,
              requirements,
            ),
          }) === "full-reauthor"
        ) {
          process.stderr.write(
            `[author] compact repair is not converging (a structural finding survived the ` +
              `patch asked to fix it); switching to a full-context re-author\n`,
          );
          summary.strategyChanges.push("full-reauthor-after-stalled-patch");
          scratch = undefined;
          persistedSlots = undefined;
        }
        previousStaticSignatures = signatures;
        lastError = new Error(validationFeedback.join("; "));
        if (attempt === 2 && lastRuntimeValid) {
          const earlyReason = earlyLeastBadPublishReason(lastRuntimeValid);
          if (earlyReason) {
            return publishRuntimeValidCandidate(lastRuntimeValid, attempt, earlyReason);
          }
        }
        continue;
      }
      // Static validation passed, so every tracked structural binding is now
      // proven bindable; a later rejection would be a fresh patch regression,
      // not a persistent defect. Reset the persistence window accordingly.
      previousStaticSignatures = new Set();
      let browserQa = await inspectDirectComposition(args.projectDir, draft, {
        captureGuide: false,
      });
      if (browserQa.infraError) {
        process.stderr.write(
          `[author] browser QA infrastructure unavailable; publishing statically valid draft: ` +
            `${browserQa.infraError}\n`,
        );
        recordSentinelDegradation("browser-qa-infra-bypass");
        return { draft, raw, attempts: attempt, browserQa };
      }
      if (
        !boundedCreate &&
        !browserQa.strictOk &&
        draftFromSlots &&
        activeSlots &&
        args.lockedStoryboard &&
        !sceneValidationRepairUsed
      ) {
        const browserFindings = sourceRetryFeedbackForBrowserQa(browserQa, [
          ...validation.frameWarnings,
          ...validation.motionWarnings,
        ]);
        try {
          const sceneRepair = await repairSlotDraftForFindings(
            provider,
            args,
            activeSlots,
            browserFindings,
            completeOptions,
          );
          sceneValidationRepairUsed = Boolean(sceneRepair);
          if (sceneRepair) {
            const candidate = applyDeterministicSourceRepairs(
              sceneRepair.draft,
              args.projectDir,
              args.lockedStoryboard,
            );
            const candidateValidation = await validateDirectComposition(args.projectDir, candidate);
            if (candidateValidation.ok) {
              const candidateQa = await inspectDirectComposition(args.projectDir, candidate, {
                captureGuide: false,
              });
              const beforePenalty = browserQualityPenalty(browserQa, [
                ...validation.frameWarnings,
                ...validation.motionWarnings,
              ]);
              const afterPenalty = browserQualityPenalty(candidateQa, [
                ...candidateValidation.frameWarnings,
                ...candidateValidation.motionWarnings,
              ]);
              if (
                !candidateQa.infraError &&
                ((candidateQa.ok && !browserQa.ok) || afterPenalty < beforePenalty)
              ) {
                process.stderr.write(
                  `[author] scene-scoped browser repair improved ${sceneRepair.sceneIds.join(", ")}: ` +
                    `penalty ${beforePenalty} -> ${afterPenalty}\n`,
                );
                summary.strategyChanges.push(
                  `scene-browser-repair:${sceneRepair.sceneIds.join(",")}`,
                );
                draft = candidate;
                validation = candidateValidation;
                browserQa = candidateQa;
                activeSlots = sceneRepair.slots;
                raw = `${raw}\n<!-- scene validation repair -->\n${sceneRepair.raw}`;
                attemptRaw = raw;
              } else {
                process.stderr.write(
                  `[author] scene-scoped browser repair did not improve quality; keeping the previous draft\n`,
                );
              }
            } else {
              process.stderr.write(
                `[author] scene-scoped browser repair failed static validation; keeping the previous draft\n`,
              );
            }
          }
        } catch (sceneRepairError) {
          process.stderr.write(
            `[author] scene-scoped browser repair failed; keeping the previous draft: ` +
              `${sceneRepairError instanceof Error ? sceneRepairError.message : String(sceneRepairError)}\n`,
          );
        }
      }
      let staticRepairWarnings = [
        ...validation.frameWarnings,
        ...validation.motionWarnings,
      ];
      // S6.10: one typed load-bearing primary that measured below its hard
      // visibility floor gets one zero-call containment transaction in this
      // source attempt. Reinspection must prove the exact target improved to
      // the floor with no new runtime/containment failure; otherwise the
      // original authored candidate remains untouched for the normal hard-
      // failure decision. Occupancy/sparse/taste findings never enter here.
      if (browserQa.ok && args.lockedStoryboard) {
        const containmentFix = correctLoadBearingContainment(draft.storyboard, browserQa);
        const target = containmentFix.corrected[0];
        if (target) {
          const candidate = applyDeterministicSourceRepairs(
            { storyboard: containmentFix.storyboard, html: draft.html },
            args.projectDir,
            containmentFix.storyboard,
          );
          const candidateValidation = await validateDirectComposition(args.projectDir, candidate);
          if (candidateValidation.ok) {
            const candidateQa = await inspectDirectComposition(args.projectDir, candidate, {
              captureGuide: false,
            });
            const adoption = evaluateLoadBearingContainmentAdoption({
              before: browserQa,
              after: candidateQa,
              target,
            });
            if (adoption.accepted) {
              process.stderr.write(
                `[author] deterministically contained load-bearing ${target.sceneId}/${target.part}: ` +
                  `${(adoption.beforeVisibleFraction * 100).toFixed(1)}% -> ` +
                  `${((adoption.afterVisibleFraction ?? 0) * 100).toFixed(1)}% visible\n`,
              );
              recordSentinelNormalization("load-bearing-containment", 1);
              summary.strategyChanges.push(
                `load-bearing-containment:${target.sceneId}/${target.part}`,
              );
              draft = candidate;
              validation = candidateValidation;
              browserQa = candidateQa;
              staticRepairWarnings = [
                ...candidateValidation.frameWarnings,
                ...candidateValidation.motionWarnings,
              ];
              args = { ...args, lockedStoryboard: containmentFix.storyboard };
              persistUpgradedStoryboard(args.projectDir, containmentFix.storyboard);
            } else {
              process.stderr.write(
                `[author] deterministic load-bearing containment rejected ` +
                  `(${target.sceneId}/${target.part}; ${adoption.reason ?? "unknown"}); ` +
                  `keeping the authored candidate\n`,
              );
            }
          } else {
            process.stderr.write(
              `[author] deterministic load-bearing containment failed static validation; ` +
                `keeping the authored candidate\n`,
            );
          }
        }
      }
      if (boundedCreate) {
        const hardBrowserFindings = unresolvedHardBrowserFindings(browserQa).slice(0, 20);
        if (browserQa.ok && hardBrowserFindings.length === 0) {
          const advisoryResidue =
            !browserQa.strictOk ||
            browserQa.warnings.length > 0 ||
            staticRepairWarnings.length > 0;
          const earlyShipReason = advisoryResidue
            ? "runtime-valid-no-hard-bank"
            : undefined;
          if (earlyShipReason) {
            summary.strategyChanges.push(earlyShipReason);
            process.stderr.write(
              `[author] runtime-valid candidate has no unresolved hard finding; ` +
                `banking attempt ${attempt} with advisory QA intact\n`,
            );
          }
          return {
            draft,
            raw,
            attempts: attempt,
            browserQa,
            staticRepairWarnings,
            slots: draftFromSlots ? activeSlots : undefined,
            ...(earlyShipReason ? { earlyShipReason } : {}),
          };
        }

        validationFeedback = hardBrowserFindings.length
          ? hardBrowserFindings
          : ["browser runtime invalid without a classified diagnostic"];
        process.stderr.write(
          `[author] attempt ${attempt}/${maxSourceAttempts} has unresolved hard browser QA: ` +
            `${validationFeedback.slice(0, 8).join(" | ").slice(0, 1_500)}\n`,
        );
        persistAuthorAttempt(args.projectDir, attempt, "browser-rejected", {
          mode: patchMode ? "patch" : "full",
          findings: validationFeedback,
          html: draft.html,
        });
        recordAuthorAttempt(summary, {
          number: attempt,
          mode: patchMode ? "patch" : "full",
          outcome: "browser-rejected",
          findingSignatures: validationFeedback.map(findingSignature).slice(0, 24),
        });
        const structuralBrowserFailure = browserQa.errors.find((entry) =>
          entry.includes("runtime_bind_exception") || entry.startsWith("near_blank_film:")
        );
        if (structuralBrowserFailure) {
          summary.strategyChanges.push(
            structuralBrowserFailure.startsWith("near_blank_film:")
              ? "full-reauthor-after-blank-scene"
              : "full-reauthor-after-runtime-bind-exception",
          );
          scratch = undefined;
          persistedSlots = undefined;
          compact = false;
        } else {
          scratch = draft;
          persistedSlots = draftFromSlots ? activeSlots : undefined;
          compact = true;
        }
        lastError = new Error(validationFeedback.join("; "));
        continue;
      }
      // Contrast is sampled across stateful moments. Repairing the first
      // measured state can expose the same label against a later background,
      // so converge through a tiny bounded loop inside THIS source attempt.
      // Each pass must strictly lower the global quality penalty; otherwise it
      // stops atomically. ProofLine E needed two passes (entry + Ready state),
      // and previously carried the second advisory into publication.
      for (let contrastPass = 0; contrastPass < 3; contrastPass += 1) {
        if (!browserQa.ok || !browserQa.issues?.some((issue) => issue.code === "contrast_aa")) {
          break;
        }
        const contrastRepair = repairContrastAaIssues(draft, browserQa);
        if (!contrastRepair.repaired.length) break;
        const candidateValidation = await validateDirectComposition(
          args.projectDir,
          contrastRepair.draft,
        );
        if (!candidateValidation.ok) break;
        const candidateQa = await inspectDirectComposition(args.projectDir, contrastRepair.draft, {
          captureGuide: false,
        });
        const beforePenalty = browserQualityPenalty(browserQa, staticRepairWarnings);
        const afterStaticWarnings = [
          ...candidateValidation.frameWarnings,
          ...candidateValidation.motionWarnings,
        ];
        const afterPenalty = browserQualityPenalty(candidateQa, afterStaticWarnings);
        if (candidateQa.infraError || !candidateQa.ok || afterPenalty >= beforePenalty) break;
        process.stderr.write(
          `[author] deterministically repaired contrast pass ${contrastPass + 1} for ` +
            `${contrastRepair.repaired.join(", ")}: penalty ${beforePenalty} -> ${afterPenalty}\n`,
        );
        recordSentinelNormalization("contrast-aa", contrastRepair.repaired.length);
        summary.strategyChanges.push(`contrast-aa:${contrastRepair.repaired.join(",")}`);
        draft = contrastRepair.draft;
        validation = candidateValidation;
        browserQa = candidateQa;
        staticRepairWarnings = afterStaticWarnings;
      }
      // Rendered washout is taste evidence, not a paid-retry obligation. When
      // the browser proves that an exact declared focal collapses into a pale
      // high-key field, try one host-owned, selector-scoped contrast plate
      // inside this same source attempt. Adoption remains evidence gated: all
      // targeted findings clear, no diagnostics regress, and global penalty
      // strictly decreases. Otherwise the authored draft remains untouched.
      if (
        browserQa.ok &&
        browserQa.issues?.some((issue) => issue.code === "composition_washed_out")
      ) {
        const washoutRepair = repairCompositionWashoutIssues(draft, browserQa);
        if (washoutRepair.repaired.length) {
          const candidateValidation = await validateDirectComposition(
            args.projectDir,
            washoutRepair.draft,
          );
          if (candidateValidation.ok) {
            const candidateQa = await inspectDirectComposition(
              args.projectDir,
              washoutRepair.draft,
              { captureGuide: false },
            );
            const afterStaticWarnings = [
              ...candidateValidation.frameWarnings,
              ...candidateValidation.motionWarnings,
            ];
            const beforePenalty = browserQualityPenalty(browserQa, staticRepairWarnings);
            const afterPenalty = browserQualityPenalty(candidateQa, afterStaticWarnings);
            const repairedSelectors = new Set(washoutRepair.repaired);
            const targetCleared = !(candidateQa.issues ?? []).some((issue) =>
              issue.code === "composition_washed_out" &&
              issue.sceneId && issue.part &&
              repairedSelectors.has(
                `[data-scene="${issue.sceneId}"] [data-part="${issue.part}"]`,
              )
            );
            const staticWarningsOk = hasNoNewDiagnostics(
              staticRepairWarnings,
              afterStaticWarnings,
            );
            const runtimeErrorsOk = hasNoNewDiagnostics(
              browserQa.errors ?? [],
              candidateQa.errors ?? [],
            );
            if (
              !candidateQa.infraError &&
              candidateQa.ok &&
              targetCleared &&
              afterPenalty < beforePenalty &&
              staticWarningsOk &&
              runtimeErrorsOk
            ) {
              process.stderr.write(
                `[author] deterministically deepened ${washoutRepair.repaired.join(", ")}: ` +
                  `penalty ${beforePenalty} -> ${afterPenalty}\n`,
              );
              recordSentinelNormalization("composition-washout", washoutRepair.repaired.length);
              summary.strategyChanges.push(
                `composition-washout:${washoutRepair.repaired.join(",")}`,
              );
              draft = washoutRepair.draft;
              validation = candidateValidation;
              browserQa = candidateQa;
              staticRepairWarnings = afterStaticWarnings;
            } else {
              process.stderr.write(
                `[author] deterministic washout repair did not clear cleanly ` +
                  `(targetCleared=${targetCleared}, penalty ${beforePenalty}->${afterPenalty}); ` +
                  `keeping the previous draft\n`,
              );
            }
          }
        }
      }
      // Browser-measured within-scene gaze whiplash has a small deterministic
      // schedule repair when (and only when) moment/interaction bindings survive:
      // compress the pair into a <=200ms ensemble, else separate it beyond the
      // 1.2s audit window. Re-inspect atomically; any newly exposed neighboring
      // ping-pong or other quality regression rejects the candidate.
      if (browserQa.ok && browserQa.issues?.some((issue) => issue.code === "eye_trace_pingpong")) {
        const eyeTraceFix = correctEyeTracePingPong(draft.storyboard, browserQa);
        if (eyeTraceFix.corrected.length) {
          const candidate = applyDeterministicSourceRepairs(
            { storyboard: eyeTraceFix.storyboard, html: draft.html },
            args.projectDir,
            eyeTraceFix.storyboard,
          );
          const candidateValidation = await validateDirectComposition(args.projectDir, candidate);
          if (candidateValidation.ok) {
            const candidateQa = await inspectDirectComposition(args.projectDir, candidate, {
              captureGuide: false,
            });
            const afterStaticWarnings = [
              ...candidateValidation.frameWarnings,
              ...candidateValidation.motionWarnings,
            ];
            const beforePenalty = browserQualityPenalty(browserQa, staticRepairWarnings);
            const afterPenalty = browserQualityPenalty(candidateQa, afterStaticWarnings);
            const corrected = new Set(eyeTraceFix.corrected);
            const targetCleared = !(candidateQa.issues ?? []).some((issue) => {
              const evidence = issue.eyeTracePingPong;
              return issue.code === "eye_trace_pingpong" && evidence &&
                corrected.has(`${evidence.sceneId}:${evidence.firstBeatId}->${evidence.secondBeatId}`);
            });
            const staticWarningsOk = hasNoNewDiagnostics(staticRepairWarnings, afterStaticWarnings);
            const runtimeErrorsOk = hasNoNewDiagnostics(browserQa.errors ?? [], candidateQa.errors ?? []);
            if (
              !candidateQa.infraError &&
              candidateQa.ok &&
              targetCleared &&
              afterPenalty < beforePenalty &&
              staticWarningsOk &&
              runtimeErrorsOk
            ) {
              process.stderr.write(
                `[author] deterministic eye-trace schedule repair adjusted ` +
                  `${eyeTraceFix.corrected.join(", ")}: penalty ${beforePenalty} -> ${afterPenalty}\n`,
              );
              summary.strategyChanges.push(`eye-trace-schedule:${eyeTraceFix.corrected.join(",")}`);
              draft = candidate;
              validation = candidateValidation;
              browserQa = candidateQa;
              staticRepairWarnings = afterStaticWarnings;
              args = { ...args, lockedStoryboard: candidate.storyboard };
              persistUpgradedStoryboard(args.projectDir, candidate.storyboard);
            } else {
              process.stderr.write(
                `[author] deterministic eye-trace schedule repair did not clear cleanly ` +
                  `(targetCleared=${targetCleared}, penalty ${beforePenalty}->${afterPenalty}); ` +
                  `keeping the previous draft\n`,
              );
            }
          }
        }
      }
      if (
        browserQa.ok &&
        browserQa.issues?.some((issue) =>
          issue.code === "canvas_overflow" || issue.code === "important_safe_area"
        )
      ) {
        const attemptLayoutRepair = async (
          maxRepairs?: number,
        ): Promise<{ corrected: string[]; adopted: boolean }> => {
          const overflowFix = correctLayoutOverflow(
            draft.storyboard,
            browserQa,
            maxRepairs === undefined ? {} : { maxRepairs },
          );
          if (!overflowFix.corrected.length) return { corrected: [], adopted: false };
          const candidate = applyDeterministicSourceRepairs(
            { storyboard: overflowFix.storyboard, html: draft.html },
            args.projectDir,
            overflowFix.storyboard,
          );
          const candidateValidation = await validateDirectComposition(args.projectDir, candidate);
          if (!candidateValidation.ok) {
            process.stderr.write(
              `[author] deterministic layout overflow repair failed static validation; ` +
                `keeping the previous draft\n`,
            );
            return { corrected: overflowFix.corrected, adopted: false };
          }
          const candidateQa = await inspectDirectComposition(args.projectDir, candidate, {
            captureGuide: false,
          });
          const afterStaticWarnings = [
            ...candidateValidation.frameWarnings,
            ...candidateValidation.motionWarnings,
          ];
          const beforePenalty = browserQualityPenalty(browserQa, staticRepairWarnings);
          const afterPenalty = browserQualityPenalty(candidateQa, afterStaticWarnings);
          const beforeTarget = layoutRepairTargetScore(browserQa);
          const afterTarget = layoutRepairTargetScore(candidateQa);
          const beforeScore = layoutRepairIssueScore(browserQa);
          const afterScore = layoutRepairIssueScore(candidateQa);
          const protectedIncrease = protectedLayoutIssuesIncreased(browserQa, candidateQa);
          const staticWarningsOk = hasNoNewDiagnostics(staticRepairWarnings, afterStaticWarnings);
          const runtimeErrorsOk = hasNoNewDiagnostics(browserQa.errors ?? [], candidateQa.errors ?? []);
          if (
            !candidateQa.infraError &&
            candidateQa.ok &&
            afterTarget < beforeTarget &&
            afterScore <= beforeScore &&
            !protectedIncrease &&
            afterPenalty <= beforePenalty &&
            staticWarningsOk &&
            runtimeErrorsOk
          ) {
            process.stderr.write(
              `[author] deterministic layout overflow repair adjusted ` +
                `${overflowFix.corrected.join(", ")}: target ${beforeTarget} -> ${afterTarget}, ` +
                `layout score ${beforeScore} -> ${afterScore}, penalty ${beforePenalty} -> ${afterPenalty}\n`,
            );
            recordSentinelNormalization("layout-overflow-clamp", overflowFix.corrected.length);
            summary.strategyChanges.push(`layout-overflow-clamp:${overflowFix.corrected.join(",")}`);
            draft = candidate;
            validation = candidateValidation;
            browserQa = candidateQa;
            staticRepairWarnings = afterStaticWarnings;
            args = { ...args, lockedStoryboard: candidate.storyboard };
            persistUpgradedStoryboard(args.projectDir, candidate.storyboard);
            return { corrected: overflowFix.corrected, adopted: true };
          }
          process.stderr.write(
            `[author] deterministic layout overflow repair did not clear cleanly ` +
              `(target ${beforeTarget}->${afterTarget}, layout score ${beforeScore}->${afterScore}, ` +
              `protectedIncrease=${protectedIncrease}, penalty ${beforePenalty}->${afterPenalty}); ` +
              `keeping the previous draft\n`,
          );
          return { corrected: overflowFix.corrected, adopted: false };
        };
        const batch = await attemptLayoutRepair();
        if (!batch.adopted && batch.corrected.length > 1) {
          await attemptLayoutRepair(1);
        }
      }
      // Camera-sparse auto-framing (L2-at-L4): a landing the browser measured as
      // a tiny subject adrift is repaired by a bounded zoom-in on that exact
      // camera move — a storyboard mutation re-injected through the same seam
      // cut-discovery uses. Adopt only when the sparse finding clears, no new
      // camera_framed_clipped appears, and the quality penalty strictly drops.
      if (
        browserQa.ok &&
        args.lockedStoryboard &&
        browserQa.issues?.some((issue) => issue.code === "camera_framed_sparse")
      ) {
        const sparseFix = correctSparseFraming(draft.storyboard, browserQa);
        if (sparseFix.corrected.length) {
          const candidate = applyDeterministicSourceRepairs(
            { storyboard: sparseFix.storyboard, html: draft.html },
            args.projectDir,
            sparseFix.storyboard,
          );
          const candidateValidation = await validateDirectComposition(args.projectDir, candidate);
          if (candidateValidation.ok) {
            const candidateQa = await inspectDirectComposition(args.projectDir, candidate, {
              captureGuide: false,
            });
            const afterStaticWarnings = [
              ...candidateValidation.frameWarnings,
              ...candidateValidation.motionWarnings,
            ];
            const beforePenalty = browserQualityPenalty(browserQa, staticRepairWarnings);
            const afterPenalty = browserQualityPenalty(candidateQa, afterStaticWarnings);
            const correctedScenes = new Set(sparseFix.corrected);
            const sparseCleared = !(candidateQa.issues ?? []).some((issue) =>
              issue.code === "camera_framed_sparse" &&
              issue.framing !== undefined &&
              correctedScenes.has(issue.framing.sceneId)
            );
            const clippedBefore = (browserQa.issues ?? [])
              .filter((issue) => issue.code === "camera_framed_clipped").length;
            const clippedAfter = (candidateQa.issues ?? [])
              .filter((issue) => issue.code === "camera_framed_clipped").length;
            if (
              !candidateQa.infraError &&
              candidateQa.ok &&
              sparseCleared &&
              clippedAfter <= clippedBefore &&
              afterPenalty < beforePenalty
            ) {
              process.stderr.write(
                `[author] camera-sparse auto-framing corrected ${sparseFix.corrected.join(", ")}` +
                  `${sparseFix.stationSized.length
                    ? ` (tightened ${sparseFix.stationSized.join(", ")})`
                    : ""}: ` +
                  `penalty ${beforePenalty} -> ${afterPenalty}\n`,
              );
              if (sparseFix.stationSized.length) {
                recordSentinelNormalization("station-size-fit", sparseFix.stationSized.length);
              }
              if (sparseFix.stationSized.length < sparseFix.corrected.length) {
                recordSentinelNormalization(
                  "camera-sparse-zoom",
                  sparseFix.corrected.length - sparseFix.stationSized.length,
                );
              }
              summary.strategyChanges.push(
                `${sparseFix.stationSized.length ? "station-size-fit" : "camera-sparse-zoom"}:` +
                  sparseFix.corrected.join(","),
              );
              draft = candidate;
              validation = candidateValidation;
              browserQa = candidateQa;
              staticRepairWarnings = afterStaticWarnings;
              args = { ...args, lockedStoryboard: candidate.storyboard };
              persistUpgradedStoryboard(args.projectDir, candidate.storyboard);
            } else {
              process.stderr.write(
                `[author] camera-sparse auto-framing did not clear cleanly ` +
                  `(sparseCleared=${sparseCleared}, clipped ${clippedBefore}->${clippedAfter}, ` +
                  `penalty ${beforePenalty}->${afterPenalty}); keeping the previous draft\n`,
              );
            }
          }
        }
      }
      if (
        !browserQa.ok &&
        browserInteractionIssues(draft, browserQa).some((issue) =>
          issue.severity === "error" &&
          issue.code.startsWith("interaction_") &&
          Boolean(issue.interactionId)
        )
      ) {
        interactionFallbacks.push({ draft, raw, browserQa });
      }
      if (browserQa.ok) {
        const qualityPenalty = browserQualityPenalty(browserQa, staticRepairWarnings);
        if (!lastRuntimeValid || qualityPenalty < lastRuntimeValid.qualityPenalty) {
          lastRuntimeValid = {
            draft,
            raw,
            attempts: attempt,
            browserQa,
            qualityPenalty,
            staticRepairWarnings,
            // Bank the slot map that assembled this draft (when it came from the
            // slot path) so the continuity critic can route scene-named
            // directives through the scene-scoped repair. The map may be stale
            // vs contrast/sparse repairs applied to `draft` this attempt (those
            // mutate the html, not the slots) — harmless, because the critic
            // adopts a slot re-author only on a strict non-regression guard.
            slots: draftFromSlots ? activeSlots : undefined,
          };
        }
      }
      // Visual findings receive a repair opportunity, but they are heuristic:
      // failed polish must never discard a document that loaded and initialized
      // correctly in the browser. `browserQa.ok` represents that objective
      // runtime boundary; static validation remains the other hard gate.
      if (
        browserQa.strictOk &&
        validation.frameWarnings.length === 0 &&
        validation.motionWarnings.length === 0
      ) {
        // moment_static_frame no longer blocks strictOk (temporal-judge polish
        // is advisory), but a film shipping moments its own rendered frames
        // can't prove is not a CLEAN publish — keep the honesty ledger exact.
        const staticMomentCount = (browserQa.temporalJudge ?? [])
          .filter((entry) => entry.verdict === "static").length;
        if (staticMomentCount > 0) {
          recordSentinelDegradation(`moment_static_frame:${staticMomentCount}`);
        }
        return { draft, raw, attempts: attempt, browserQa };
      }
      if (attempt === 2 && lastRuntimeValid) {
        const earlyReason = earlyLeastBadPublishReason(lastRuntimeValid);
        if (earlyReason) {
          return publishRuntimeValidCandidate(lastRuntimeValid, attempt, earlyReason);
        }
      }
      if (attempt === 3 && browserQa.ok && lastRuntimeValid) {
        // The least-bad pick: runtime-valid but with open quality residue /
        // repair warnings — an honest publish, not a clean one.
        if (lastRuntimeValid.qualityPenalty > 0 || !lastRuntimeValid.browserQa?.strictOk) {
          recordSentinelDegradation(
            `least-bad-pick:penalty=${lastRuntimeValid.qualityPenalty}`,
          );
        }
        const { qualityPenalty: _qualityPenalty, ...best } = lastRuntimeValid;
        return { ...best, attempts: attempt };
      }
      validationFeedback = sourceRetryFeedbackForBrowserQa(browserQa, [
        ...validation.frameWarnings,
        ...validation.motionWarnings,
      ]).slice(0, 20);
      process.stderr.write(
        `[author] attempt ${attempt}/${maxSourceAttempts} browser QA requested repair: ` +
          `${validationFeedback.slice(0, 8).join(" | ").slice(0, 1_500)}\n`,
      );
      persistAuthorAttempt(args.projectDir, attempt, "browser-rejected", {
        mode: patchMode ? "patch" : "full",
        findings: validationFeedback,
        html: draft.html,
      });
      recordAuthorAttempt(summary, {
        number: attempt,
        mode: patchMode ? "patch" : "full",
        outcome: "browser-rejected",
        findingSignatures: validationFeedback.map(findingSignature).slice(0, 24),
      });
      const stagnationKeys = validationFeedback.map(stagnantPolishSignature);
      const stagnantReason = stagnantPolishShipReason({
        attempt,
        browserQaOk: browserQa.ok,
        currentSignatures: stagnationKeys,
        previousSignatures: previousBrowserSignatures,
        bankedPenalty: lastRuntimeValid?.qualityPenalty,
      });
      if (stagnantReason && lastRuntimeValid) {
        return publishRuntimeValidCandidate(lastRuntimeValid, attempt, stagnantReason);
      }
      previousBrowserSignatures = new Set(stagnationKeys);
      // A runtime bind exception means the compile aborted before the timeline
      // registered: the document's structure lied to static validation, so a
      // compact patch would repair blind against markup the DOM does not agree
      // with (the 2026-07-04 paid-run bottleneck — the patch fixed the chart
      // and broke the last scene). Escalate straight back to full-context
      // re-authoring with the named findings instead of seeding a scratch.
      // A scene rendering blank gets the same treatment: its content is
      // missing, off-world, or permanently hidden, and creating a visual
      // world is full-document work — a compact patch provably cannot do it
      // (probe-cutfix-2, 2026-07-04: two patches in a row left the same
      // near_blank_film finding untouched and the run fell back).
      const structuralBrowserFailure = browserQa.errors.find((entry) =>
        entry.includes("runtime_bind_exception") || entry.startsWith("near_blank_film:")
      );
      if (structuralBrowserFailure) {
        summary.strategyChanges.push(
          structuralBrowserFailure.startsWith("near_blank_film:")
            ? "full-reauthor-after-blank-scene"
            : "full-reauthor-after-runtime-bind-exception",
        );
        scratch = undefined;
        persistedSlots = undefined;
        compact = false;
      } else {
        scratch = draft;
        // Bank (or invalidate) the slot map alongside the baseline it built.
        persistedSlots = draftFromSlots ? activeSlots : undefined;
        compact = true;
      }
      lastError = new Error(validationFeedback.join("; "));
    } catch (error) {
      const truncated = isOutputTruncation(error);
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[author] attempt ${attempt}/${maxSourceAttempts} failed: ${message}\n`,
      );
      persistAuthorAttempt(args.projectDir, attempt, "exception", {
        mode: patchMode ? "patch" : "full",
        findings: [message],
        raw: attemptRaw,
      });
      recordAuthorAttempt(summary, {
        number: attempt,
        mode: patchMode ? "patch" : "full",
        outcome: "exception",
        findingSignatures: [findingSignature(message)],
      });
      // Prompt-budget failures happen before a provider call and cannot change
      // across content retries. Do not count the same deterministic preflight
      // defect three times or escalate it to an independent-model rescue.
      if (isAuthorPromptBudgetError(error)) {
        lastError = error;
        break;
      }
      if (isReasoningMandatoryError(error)) {
        // Endpoint rejects reasoning:none outright — retry the same work with
        // a minimal floor instead of burning attempts on identical 400s.
        reasoningFloor = "minimal";
        lastError = error;
        continue;
      }
      // A parse failure (bad wrapper/JSON, not a validation finding) gets one
      // structural reminder — Flash-tier authors drift on the envelope more
      // often than on the content.
      const parseFailure = !truncated &&
        /missing <index_html>|patches_json (?:is not valid JSON|must contain)|storyboard_json is not valid/i
          .test(message);
      validationFeedback = [
        truncated
          ? `The previous response exhausted its output budget. Return a complete document under ${COMPOSITION_SOURCE_BUDGET_CHARS.toLocaleString("en-US")} characters; simplify source, not the visual thesis.`
          : message,
        ...(parseFailure
          ? [
              patchMode
                ? "Structural reminder: emit exactly one JSON array of patch edits (patches_json) and nothing else — no prose, Markdown fences, or commentary."
                : "Structural reminder: emit exactly one <index_html>…</index_html> block containing the complete document and nothing else — no prose, Markdown fences, or commentary.",
            ]
          : []),
      ];
      if (truncated) {
        // A truncated full composition cannot be repaired because it never
        // parsed. A truncated patch can retry safely against the same scratch.
        if (!patchMode) {
          scratch = undefined;
          persistedSlots = undefined;
        }
        compact = true;
      }
      lastError = error;
      if (attempt === 2 && lastRuntimeValid) {
        const earlyReason = earlyLeastBadPublishReason(lastRuntimeValid);
        if (earlyReason) {
          return publishRuntimeValidCandidate(lastRuntimeValid, attempt, earlyReason);
        }
      }
    }
  }
  if (boundedCreate) {
    throw new Error(
      `direct HyperFrames authoring failed after ${maxSourceAttempts} source attempt(s): ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
  if (lastRuntimeValid) {
    process.stderr.write(
      `[author] final repair regressed; publishing runtime-valid attempt ` +
        `${lastRuntimeValid.attempts}/3 instead\n`,
    );
    // The other least-bad publish seam (the s5-slotrepair probe found it
    // unmarked): runtime-valid but carrying open quality residue / repair
    // warnings — an honest publish, not a clean one.
    if (lastRuntimeValid.qualityPenalty > 0 || !lastRuntimeValid.browserQa?.strictOk) {
      recordSentinelDegradation(
        `least-bad-pick:penalty=${lastRuntimeValid.qualityPenalty}`,
      );
    }
    const { qualityPenalty: _qualityPenalty, ...best } = lastRuntimeValid;
    return { ...best, attempts: 3 };
  }
  // Quarantine each statically valid interaction candidate, then keep the best
  // browser result. Optional interaction drift cannot erase a cleaner core
  // composition from an earlier attempt.
  let bestQuarantined:
    | { result: CompositionRunResult; qualityPenalty: number }
    | undefined;
  for (const candidate of interactionFallbacks) {
    const recovered = await recoverByQuarantiningInteractions(args.projectDir, candidate);
    if (!recovered) continue;
    const qualityPenalty = browserQualityPenalty(recovered.browserQa);
    if (!bestQuarantined || qualityPenalty < bestQuarantined.qualityPenalty) {
      bestQuarantined = { result: recovered.result, qualityPenalty };
    }
  }
  if (bestQuarantined) return bestQuarantined.result;
  // Source rescue rung (storyboard-stage parity): the primary author model
  // exhausted its attempts and nothing publishable exists — the exact path
  // that otherwise wastes every model call in the run on a deterministic
  // fallback. Spend ONE full-context attempt on an independent model with the
  // accumulated findings before the fallback is allowed.
  const rescueTier = sourceRescueModel(provider, productionTier);
  if (rescueTier && !isAuthorPromptBudgetError(lastError)) {
    process.stderr.write(
      `[author] primary model exhausted its attempts; rescue attempt on ${rescueTier}\n`,
    );
    summary.strategyChanges.push(`source-rescue:${rescueTier}`);
    appendSentinelLedgerEvent({
      kind: "attempt-start",
      stage: "source-author",
      number: 4,
      mode: "rescue",
    });
    try {
      const prompt = creationPrompt({
        ...args,
        validationFeedback,
        compact: true,
        structuredPatches,
      });
      const raw = await completeSourceWithContinuation(provider, prompt, {
        ...args.options,
        timeoutMs: 360_000,
        maxTokens: authorMaxTokens(),
        thinkingMode: sourceRescueThinkingMode(),
        model: rescueTier,
      });
      const parsed = args.lockedStoryboard
        ? { storyboard: args.lockedStoryboard, html: extractIndexHtmlSource(raw) }
        : parseCompositionResponse(raw);
      let draft = applyDeterministicSourceRepairs(parsed, args.projectDir, args.lockedStoryboard);
      let validation = await validateDirectComposition(args.projectDir, draft);
      if (!validation.ok) {
        const recovered = quarantineStaticInteractionErrors(draft, validation.errors);
        if (recovered?.removedIds.length) {
          draft = recovered.draft;
          validation = await validateDirectComposition(args.projectDir, draft);
        }
      }
      if (!validation.ok) {
        if (validation.errors.every((error) => error.startsWith("storyboard/moments:"))) {
          lastMomentBlocked = { draft, raw };
        }
        persistAuthorAttempt(args.projectDir, 4, "static-rejected", {
          mode: "rescue",
          findings: validation.errors,
          html: draft.html,
        });
        recordAuthorAttempt(summary, {
          number: 4,
          mode: "rescue",
          outcome: "static-rejected",
          findingSignatures: validation.errors.map(findingSignature).slice(0, 24),
        });
      } else {
        const browserQa = await inspectDirectComposition(args.projectDir, draft, {
          captureGuide: false,
        });
        // The rescue publishes on the objective runtime boundary (browser
        // ok), exactly like the least-bad pick at attempt 3 — polish
        // findings must not sink the run's only working draft.
        if (browserQa.ok || browserQa.infraError) {
          if (browserQa.infraError) recordSentinelDegradation("browser-qa-infra-bypass");
          else if (!browserQa.strictOk) recordSentinelDegradation("rescue-published-with-polish-findings");
          return { draft, raw, attempts: 4, browserQa };
        }
        persistAuthorAttempt(args.projectDir, 4, "browser-rejected", {
          mode: "rescue",
          findings: [...browserQa.errors, ...browserQa.warnings].slice(0, 20),
          html: draft.html,
        });
        recordAuthorAttempt(summary, {
          number: 4,
          mode: "rescue",
          outcome: "browser-rejected",
          findingSignatures: [...browserQa.errors, ...browserQa.warnings]
            .map(findingSignature)
            .slice(0, 24),
        });
      }
    } catch (rescueError) {
      const message = rescueError instanceof Error ? rescueError.message : String(rescueError);
      process.stderr.write(`[author] rescue attempt failed: ${message.slice(0, 300)}\n`);
      persistAuthorAttempt(args.projectDir, 4, "exception", {
        mode: "rescue",
        findings: [message],
      });
      recordAuthorAttempt(summary, {
        number: 4,
        mode: "rescue",
        outcome: "exception",
        findingSignatures: [findingSignature(message)],
      });
    }
  }
  // LAST RESORT (degrade-never-veto, the sentinel-p6-longcopy death class):
  // the whole ladder exhausted while a runnable draft was blocked SOLELY by
  // declared-moment paperwork — an unbound PRIMARY moment the author never
  // delivered evidence for, and the floor/interval math downstream of it.
  // Demote exactly the unbound primaries to supporting (they then re-anchor
  // onto authored evidence or drop with a warning — the same honest path
  // supporting moments already take) and re-validate: a film missing one
  // reviewable claim ships with its paperwork saying so, instead of no film
  // at all. Gates are not loosened — every demotion is logged, the moment
  // strip and STORYBOARD.md show the true bound set, and any OTHER finding
  // still fails this salvage.
  if (lastMomentBlocked && args.lockedStoryboard) {
    const scenes = args.lockedStoryboard;
    const filmEnd = scenes.length
      ? scenes[scenes.length - 1]!.startSec + scenes[scenes.length - 1]!.durationSec
      : undefined;
    const contract = resolveMomentContract(lastMomentBlocked.draft.html, scenes, filmEnd);
    const unboundPrimaryIds = new Set(
      contract.moments
        .filter((moment) =>
          !moment.evidence && moment.importance === "primary" && moment.origin !== "synthesized"
        )
        .map((moment) => moment.id),
    );
    if (unboundPrimaryIds.size) {
      const demoted = scenes.map((scene) => ({
        ...scene,
        ...(scene.moments
          ? {
              moments: scene.moments.map((moment) =>
                unboundPrimaryIds.has(moment.id)
                  ? { ...moment, importance: "supporting" as const }
                  : moment
              ),
            }
          : {}),
      }));
      const salvageDraft = { ...lastMomentBlocked.draft, storyboard: demoted };
      const salvageValidation = await validateDirectComposition(args.projectDir, salvageDraft);
      if (salvageValidation.ok) {
        const browserQa = await inspectDirectComposition(args.projectDir, salvageDraft, {
          captureGuide: false,
        });
        if (browserQa.ok || browserQa.infraError) {
          process.stderr.write(
            `[author] last-resort moment salvage: demoted ${unboundPrimaryIds.size} unbound ` +
              `primary moment(s) (${[...unboundPrimaryIds].join(", ")}) to supporting — the ` +
              `draft is runnable and browser-clean; shipping it minus the unprovable claim(s)\n`,
          );
          summary.strategyChanges.push(
            `moment-demote-last-resort:${[...unboundPrimaryIds].join(",")}`,
          );
          recordSentinelNormalization("moment-demote-last-resort", unboundPrimaryIds.size);
          recordSentinelDegradation(
            `moment-demote-last-resort:${[...unboundPrimaryIds].join(",")}`,
          );
          args = { ...args, lockedStoryboard: demoted };
          persistUpgradedStoryboard(args.projectDir, demoted);
          return { draft: salvageDraft, raw: lastMomentBlocked.raw, attempts: 4, browserQa };
        }
      }
      process.stderr.write(
        `[author] last-resort moment salvage did not converge ` +
          `(${(salvageValidation.errors[0] ?? "browser QA rejected").slice(0, 200)}); ` +
          `failing loud honestly\n`,
      );
    }
  }
  throw new Error(
    `direct HyperFrames authoring failed after two bounded repairs${
      rescueTier ? " and an independent-model rescue attempt" : ""
    }: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/* ------------------------------------------------- GLM job #3: the critic */


function cachedConcept(projectDir: string): ConceptDirection | undefined {
  try {
    const cached = JSON.parse(
      fs.readFileSync(path.join(projectDir, "planning", "concept.json"), "utf8"),
    ) as { concept?: ConceptDirection };
    return cached.concept;
  } catch {
    return undefined;
  }
}

/**
 * GLM job #3 — continuity critic. After DeepSeek authors source, GLM reviews
 * the *implemented* film through its deterministic evidence (moment bindings,
 * motion-density contact sheet) and returns a small list of creative repair
 * directives. DeepSeek applies them as bounded source patches; deterministic
 * QA accepts or rejects the result. The critic can only improve a film — any
 * failure in this stage keeps the pre-critique draft.
 */
async function requestContinuityCritique(
  provider: AgentProvider,
  args: DirectCompositionArgs & { lockedStoryboard: DirectScene[] },
  draft: DirectCompositionDraft,
  durationSec: number,
  browserQa?: DirectBrowserQaResult,
  requireVisualEvidence = false,
): Promise<string[]> {
  const report = analyzeMotionDensity(draft.html, args.lockedStoryboard, durationSec);
  const contract = resolveMomentContract(draft.html, args.lockedStoryboard, durationSec, report);
  const concept = cachedConcept(args.projectDir);
  const contactSheet = [
    ...report.sceneReports.map((scene) =>
      `- ${scene.sceneId}: ${scene.durationSec.toFixed(1)}s · ${scene.authoredBeatCount} authored beat(s) · ` +
      `${scene.backHalfBeatCount} in the back half · longest quiet ${scene.longestQuietGapSec.toFixed(1)}s`
    ),
    ...(report.quietGaps.length
      ? [`- quiet gaps: ${report.quietGaps.map((gap) =>
          `${gap.startSec.toFixed(1)}-${gap.endSec.toFixed(1)}s`).join(", ")}`]
      : []),
  ].join("\n");
  const momentSheet = contract.moments.map((moment) =>
    `- ${moment.atSec.toFixed(2)}s [${moment.importance}] ${moment.title}` +
    `${moment.evidence ? ` (${moment.evidence.detail})` : " (UNBOUND)"}`
  ).join("\n");
  const visualReview = visionCriticReviewInputs(provider, browserQa);
  if (requireVisualEvidence && visualReview.transport === "unavailable") {
    throw new Error(
      `provider ${provider.id} cannot consume the verified rendered PNG evidence`,
    );
  }
  const nativeVisionRoute = requireVisualEvidence && visualReview.transport === "native"
    ? visionCriticModelRoute(provider)
    : undefined;
  if (nativeVisionRoute && !nativeVisionRoute.available) {
    throw new Error(nativeVisionRoute.reason);
  }
  // Native image requests use only an explicitly audited multimodal route.
  // Text/read-file critics retain the established storyboard-model policy.
  const model = nativeVisionRoute?.model ?? storyboardModel(provider);
  const thinkingMode = nativeVisionRoute?.thinkingMode ??
    storyboardThinkingMode(provider, model);
  const structuredOutput = supportsStructuredOutputs(provider);
  const prompt = [
    "SYSTEM: You are the continuity critic reviewing an implemented",
    "motion-design storyboard before delivery. You see the locked plan, the",
    "resolved moment evidence, and the motion-density contact sheet — what the",
    "timeline actually does, not what was hoped. Judge like a creative",
    "director: does the motif survive the cuts, does the energy curve read,",
    "does every promised moment credibly land, is there hierarchy between loud",
    "and quiet, does the ending resolve rather than stop?",
    `Return at most ${CRITIC_MAX_DIRECTIVES} bounded repair directives. Each must be small, local,`,
    "and executable as a source patch: retime one beat, strengthen one weak",
    "reveal, remove one competing tween, shift a camera arrival, sharpen the",
    "resolve. Never restructure scenes, ids, or timing windows; never demand",
    "new scenes or assets. Prefix every directive that targets ONE shot with its",
    'exact id and a colon, e.g. "hero-cta: sharpen the logo lock at 11.2s"; a',
    'film-wide note needs no prefix. If the film ships as-is, return',
    '{"verdict":"ship","directives":[]}.',
    "",
    ...(concept
      ? ["## Locked creative direction", `<concept_json>${JSON.stringify(concept)}</concept_json>`, ""]
      : []),
    "## Locked storyboard (shots)",
    ...args.lockedStoryboard.map((scene) =>
      `- ${scene.id} (${scene.startSec.toFixed(1)}-${(scene.startSec + scene.durationSec).toFixed(1)}s): ` +
      `${scene.title} — ${scene.purpose}${scene.continuityAnchor ? ` · anchor: ${scene.continuityAnchor}` : ""}`
    ),
    "",
    "## Resolved moment evidence",
    momentSheet || "(no moments)",
    "",
    "## Motion-density contact sheet",
    contactSheet,
    "",
    ...visualReview.promptLines,
    "## Response contract",
    'Return only a JSON object: {"verdict":"ship"|"repair","directives":["..."]}.',
  ].join("\n");
  const raw = await completeReasoningWithRetry(provider, prompt, {
    ...args.options,
    timeoutMs: 120_000,
    maxTokens: thinkingMode === "none" ? 1_024 : 8_192,
    thinkingMode,
    ...(visualReview.images.length ? { images: visualReview.images } : {}),
    ...(structuredOutput ? { responseFormat: CRITIC_RESPONSE_FORMAT } : {}),
    ...(model ? { model } : {}),
  }, "critic");
  return parseCritique(raw);
}

export interface CriticCandidateAdoption {
  accepted: boolean;
  reason?: string;
  beforePenalty?: number;
  afterPenalty?: number;
  result?: CompositionRunResult;
}

/**
 * Adopt one fully validated critic candidate as a transaction. Numeric/browser
 * quality must not regress; when WS-I supplied a visual baseline, the candidate
 * must also carry a fresh immutable generation, and its operator-facing aliases
 * are published only after every guard accepts. The publisher validates bytes,
 * paths, and manifests and restores the baseline aliases if publication fails.
 */
export function adoptCriticCandidate(args: {
  projectDir: string;
  before: CompositionRunResult;
  draft: DirectCompositionDraft;
  browserQa: DirectBrowserQaResult;
  staticRepairWarnings: string[];
  requireVisualEvidence: boolean;
  slots?: ParsedSceneSlots;
}): CriticCandidateAdoption {
  const guard = browserQualityNonRegression({
    before: args.before.browserQa,
    beforeStaticWarnings: args.before.staticRepairWarnings ?? [],
    after: args.browserQa,
    afterStaticWarnings: args.staticRepairWarnings,
  });
  if (!guard.accepted) return guard;

  if (args.requireVisualEvidence) {
    const baselineEvidence = args.before.browserQa?.visionCriticEvidence;
    if (!baselineEvidence) {
      return {
        accepted: false,
        reason: "visual-baseline-missing",
        beforePenalty: guard.beforePenalty,
        afterPenalty: guard.afterPenalty,
      };
    }
    if (baselineEvidence.draftHash !== visionCriticDraftHash(args.projectDir, args.before.draft)) {
      return {
        accepted: false,
        reason: "visual-baseline-draft-mismatch",
        beforePenalty: guard.beforePenalty,
        afterPenalty: guard.afterPenalty,
      };
    }
    const candidateEvidence = args.browserQa.visionCriticEvidence;
    if (!candidateEvidence) {
      return {
        accepted: false,
        reason: "candidate-visual-evidence-missing",
        beforePenalty: guard.beforePenalty,
        afterPenalty: guard.afterPenalty,
      };
    }
    if (candidateEvidence.draftHash !== visionCriticDraftHash(args.projectDir, args.draft)) {
      return {
        accepted: false,
        reason: "candidate-visual-draft-mismatch",
        beforePenalty: guard.beforePenalty,
        afterPenalty: guard.afterPenalty,
      };
    }
    try {
      publishCanonicalVisionEvidence(args.projectDir, candidateEvidence);
    } catch (error) {
      return {
        accepted: false,
        reason: `visual-evidence-publication: ${
          error instanceof Error ? error.message : String(error)
        }`,
        beforePenalty: guard.beforePenalty,
        afterPenalty: guard.afterPenalty,
      };
    }
  }

  return {
    accepted: true,
    beforePenalty: guard.beforePenalty,
    afterPenalty: guard.afterPenalty,
    result: {
      ...args.before,
      draft: args.draft,
      browserQa: args.browserQa,
      staticRepairWarnings: args.staticRepairWarnings,
      ...(args.slots ? { slots: args.slots } : {}),
    },
  };
}

/**
 * Apply continuity-critic directives through the scene-scoped slot repair
 * (critic-economy, 2026-07-08). Every directive names a shot, so re-author only
 * those shots in one bounded call (`critic-scene-repair` telemetry) and adopt
 * the result ONLY on a strict non-regression guard: the merged draft must keep
 * the locked scene graph, pass static validation and browser QA, and never
 * RAISE the browser quality penalty vs the pre-critique draft. The guard is
 * what makes a possibly-stale slot map safe — a re-assembly that dropped a
 * post-author contrast/sparse repair would raise the penalty and be rejected,
 * keeping the pre-critique draft (the same outcome a failed whole-doc patch
 * has). Returns undefined on any miss.
 */
async function applyCriticSlotRepair(
  provider: AgentProvider,
  args: DirectCompositionArgs & { lockedStoryboard: DirectScene[] },
  result: CompositionRunResult,
  slots: ParsedSceneSlots,
  directives: string[],
  requireVisualEvidence: boolean,
): Promise<CompositionRunResult | undefined> {
  if (!result.browserQa) return undefined;
  const productionTier = productionModel(provider);
  const completeOptions: CompleteOptions = {
    ...args.options,
    timeoutMs: 240_000,
    maxTokens: authorMaxTokens(),
    thinkingMode: "none",
    ...(productionTier ? { model: productionTier } : {}),
  };
  let slotResult;
  try {
    slotResult = await repairSlotDraftForFindings(
      provider,
      args,
      slots,
      directives,
      completeOptions,
      { callKind: "critic-scene-repair", repairPurpose: "critique" },
    );
  } catch (error) {
    process.stderr.write(
      `[critic] scene-scoped repair failed (${
        error instanceof Error ? error.message : String(error)
      }); keeping pre-critique draft\n`,
    );
    return undefined;
  }
  if (!slotResult) return undefined;
  // Re-inject against the storyboard that actually SHIPPED (a sparse-zoom or an
  // interaction quarantine may have mutated it), exactly as the whole-document
  // critique path does.
  const candidate = applyDeterministicSourceRepairs(
    { storyboard: result.draft.storyboard, html: slotResult.draft.html },
    args.projectDir,
    result.draft.storyboard,
  );
  const graphError = lockedSceneGraphError(candidate.html, args.lockedStoryboard);
  if (graphError) {
    process.stderr.write(
      `[critic] scene-scoped repair changed the locked storyboard (${graphError}); keeping pre-critique draft\n`,
    );
    return undefined;
  }
  const validation = await validateDirectComposition(args.projectDir, candidate);
  if (!validation.ok) {
    process.stderr.write(
      "[critic] scene-scoped repair failed static validation; keeping pre-critique draft\n",
    );
    return undefined;
  }
  const browserQa = await inspectDirectComposition(args.projectDir, candidate, {
    captureGuide: false,
    ...(requireVisualEvidence
      ? { captureVisualReview: true, publishVisualReview: false }
      : {}),
  });
  const afterStaticWarnings = [...validation.frameWarnings, ...validation.motionWarnings];
  const adoption = adoptCriticCandidate({
    projectDir: args.projectDir,
    before: result,
    draft: candidate,
    browserQa,
    staticRepairWarnings: afterStaticWarnings,
    requireVisualEvidence,
    slots: slotResult.slots,
  });
  if (!adoption.accepted || !adoption.result) {
    const penalty = adoption.beforePenalty !== undefined && adoption.afterPenalty !== undefined
      ? ` (${adoption.beforePenalty} -> ${adoption.afterPenalty})`
      : "";
    process.stderr.write(
      `[critic] scene-scoped repair rejected: ${adoption.reason ?? "unknown"}${penalty}; ` +
        "keeping pre-critique draft\n",
    );
    return undefined;
  }
  process.stderr.write(
    `[critic] scene-scoped repair applied to ${slotResult.sceneIds.join(", ")} ` +
      `(penalty ${adoption.beforePenalty} -> ${adoption.afterPenalty})\n`,
  );
  return adoption.result;
}

export async function applyContinuityCritique(
  provider: AgentProvider,
  args: DirectCompositionArgs,
  result: CompositionRunResult,
): Promise<CompositionRunResult> {
  if (slackSequencesEnvRawValue("SLACK_SEQUENCES_CREATIVE_CRITIC") === "0") return result;
  const lockedStoryboard = args.lockedStoryboard;
  if (!lockedStoryboard?.length || args.revisionInstruction) return result;
  const last = lockedStoryboard[lockedStoryboard.length - 1]!;
  const durationSec = last.startSec + last.durationSec;
  if (durationSec < 10) return result;
  const runVisionCritic = visionCriticEnabled();
  if (
    result.earlyShipReason?.startsWith("runtime-valid-no-hard-bank") &&
    !browserQaHasUnresolvedHardFailure(result.browserQa)
  ) {
    process.stderr.write(
      "[critic] skipped: runtime-valid bank has advisory-only residue\n",
    );
    return result;
  }
  // Sentinel Phase 3 + critic-economy (2026-07-08): skip the critic when it
  // can't help (kill switch `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN=0` restores
  // always-run) — a pristine draft (nothing to repair) OR a run that shipped
  // under `stagnant-polish-early-ship` (a draft that resisted two targeted
  // patches will not absorb a third). Any other non-pristine draft still runs
  // the critic — that is exactly the draft it exists to improve.
  if (
    criticSkipCleanEnabled() &&
    cleanCriticSkipAllowed(runVisionCritic) &&
    criticSkippableCleanDraft(
      result.browserQa,
      result.staticRepairWarnings ?? [],
      result.earlyShipReason,
    )
  ) {
    process.stderr.write(
      result.earlyShipReason?.startsWith("stagnant-polish-early-ship")
        ? "[critic] skipped: run shipped stagnant (two patches moved nothing; a third won't either)\n"
        : "[critic] skipped: draft is already clean (strictOk, zero quality penalty)\n",
    );
    return result;
  }
  let preCritiqueResult = result;
  if (runVisionCritic) {
    let visualQa: DirectBrowserQaResult;
    try {
      visualQa = await inspectDirectComposition(args.projectDir, result.draft, {
        captureGuide: false,
        captureVisualReview: true,
      });
    } catch (error) {
      process.stderr.write(
        `[critic] visual evidence unavailable (${
          error instanceof Error ? error.message : String(error)
        }); keeping pre-critique draft\n`,
      );
      return result;
    }
    if (visualQa.infraError || !visualQa.ok || !visualQa.visionCriticEvidence) {
      process.stderr.write(
        `[critic] visual evidence unavailable (${
          visualQa.infraError ?? (!visualQa.ok ? "browser QA failed" : "capture produced no evidence")
        }); keeping pre-critique draft\n`,
      );
      return result;
    }
    preCritiqueResult = { ...result, browserQa: visualQa };
    if (visionCriticReviewInputs(provider, visualQa).transport === "unavailable") {
      process.stderr.write(
        `[critic] provider ${provider.id} cannot consume verified rendered PNG evidence; ` +
          "keeping pre-critique draft\n",
      );
      return preCritiqueResult;
    }
  }
  let directives: string[];
  try {
    directives = await requestContinuityCritique(
      provider,
      { ...args, lockedStoryboard },
      preCritiqueResult.draft,
      durationSec,
      preCritiqueResult.browserQa,
      runVisionCritic,
    );
  } catch (error) {
    process.stderr.write(
      `[critic] unavailable (${error instanceof Error ? error.message : String(error)}); shipping pre-critique draft\n`,
    );
    return preCritiqueResult;
  }
  if (!directives.length) {
    process.stderr.write("[critic] verdict: ship\n");
    return preCritiqueResult;
  }
  process.stderr.write(
    `[critic] ${directives.length} repair directive(s): ${directives.join(" | ").slice(0, 600)}\n`,
  );
  // Critic-economy (2026-07-08): when the shipped draft came from the slot path
  // and EVERY directive names a shot, re-author only those shots (one bounded
  // scene-scoped call) instead of a whole-document patch. Small per-scene
  // re-authors validate far more often than a find/replace patch against a
  // large document — the sequence-check-1783463306190 probe watched the
  // whole-doc critique patch fail static validation and 2 paid calls buy a
  // byte-identical pre-critique draft. Film-level directives keep the
  // whole-document path below.
  if (criticSlotRepairEnabled() && preCritiqueResult.slots) {
    const attributed = attributeFindingsToScenes(
      directives,
      lockedStoryboard.map((scene) => scene.id),
    );
    const filmLevel = attributed.get("__film__") ?? [];
    if (!filmLevel.length) {
      let slotResult: CompositionRunResult | undefined;
      try {
        slotResult = await applyCriticSlotRepair(
          provider,
          { ...args, lockedStoryboard },
          preCritiqueResult,
          preCritiqueResult.slots,
          directives,
          runVisionCritic,
        );
      } catch (error) {
        process.stderr.write(
          `[critic] scene-scoped adoption failed (${
            error instanceof Error ? error.message : String(error)
          }); keeping pre-critique draft\n`,
        );
      }
      // Either a guarded improvement or the pre-critique draft — never a second
      // (whole-document) paid call. A shot the scene author couldn't improve
      // will not yield to a find/replace patch either, and the whole point is
      // to stop paying twice for the same non-result.
      return slotResult ?? preCritiqueResult;
    }
  }
  try {
    const structuredPatches = supportsStructuredOutputs(provider);
    const productionTier = productionModel(provider);
    const prompt = creationPrompt({
      ...args,
      scratch: preCritiqueResult.draft,
      validationFeedback: directives.map((directive) => `creative critique: ${directive}`),
      compact: true,
      structuredPatches,
    });
    const raw = await completeWithRetry(provider, prompt, {
      ...args.options,
      timeoutMs: 240_000,
      maxTokens: REPAIR_MAX_TOKENS,
      thinkingMode: "none",
      ...(structuredPatches ? { responseFormat: PATCH_RESPONSE_FORMAT } : {}),
      ...(productionTier ? { model: productionTier } : {}),
    }, "critique patch");
    let draft = applyCompositionRepair(raw, preCritiqueResult.draft);
    // Re-inject from the storyboard that actually SHIPPED, not the original
    // locked plan: authoring may have quarantined an optional interaction,
    // and re-injecting the stale plan resurrects the proven-broken binding
    // (this exact mismatch rejected a healthy critic patch on 2026-07-04).
    draft = applyDeterministicSourceRepairs(
      draft,
      args.projectDir,
      preCritiqueResult.draft.storyboard,
    );
    const graphError = lockedSceneGraphError(draft.html, lockedStoryboard);
    if (graphError) throw new Error(`critique patch changed the locked storyboard (${graphError})`);
    const validation = await validateDirectComposition(args.projectDir, draft);
    if (!validation.ok) {
      throw new Error(`critique patch failed static validation: ${validation.errors[0] ?? ""}`);
    }
    const browserQa = await inspectDirectComposition(args.projectDir, draft, {
      captureGuide: false,
      ...(runVisionCritic
        ? { captureVisualReview: true, publishVisualReview: false }
        : {}),
    });
    const afterStaticWarnings = [...validation.frameWarnings, ...validation.motionWarnings];
    const adoption = adoptCriticCandidate({
      projectDir: args.projectDir,
      before: preCritiqueResult,
      draft,
      browserQa,
      staticRepairWarnings: afterStaticWarnings,
      requireVisualEvidence: runVisionCritic,
    });
    if (!adoption.accepted || !adoption.result) {
      const penalty = adoption.beforePenalty !== undefined && adoption.afterPenalty !== undefined
        ? ` (${adoption.beforePenalty} -> ${adoption.afterPenalty})`
        : "";
      throw new Error(
        `critique patch failed adoption guard: ${adoption.reason ?? "unknown"}${penalty}`,
      );
    }
    process.stderr.write(
      `[critic] repair directives applied and validated (penalty ${adoption.beforePenalty} -> ` +
        `${adoption.afterPenalty})\n`,
    );
    return adoption.result;
  } catch (error) {
    process.stderr.write(
      `[critic] patch rejected (${error instanceof Error ? error.message : String(error)}); keeping pre-critique draft\n`,
    );
    return preCritiqueResult;
  }
}

/* -------------------------------------- cut discovery: measure-then-upgrade */

/**
 * Rewrite the cached storyboard artifact so no persisted plan disagrees with
 * the shipped cut island — a stale `planning/storyboard.json` is the island
 * desync bug wearing a new hat. The cache key is preserved: a retried create
 * then plans with the upgraded cut from the start.
 */
export function persistUpgradedStoryboard(projectDir: string, storyboard: DirectScene[]): void {
  const cacheFile = path.join(projectDir, "planning", "storyboard.json");
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as Record<string, unknown>;
    if (!cached || typeof cached !== "object" || !Array.isArray(cached.storyboard)) return;
    const temporary = `${cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ ...cached, storyboard }, null, 2) + "\n",
      "utf8",
    );
    fs.renameSync(temporary, cacheFile);
  } catch {
    // No cached plan (fallback/demo paths) — nothing to reconcile.
  }
}
