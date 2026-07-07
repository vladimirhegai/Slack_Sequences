/**
 * Provider-agnostic direct HyperFrames authoring. The model writes the actual
 * composition source; deterministic validation owns the publication boundary.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ProviderOutputTruncatedError,
  type AgentProvider,
  type CompleteOptions,
} from "@sequences/platform/providers";
import type { RetrievedSkillContext } from "../agent/skillContext.ts";
import { loadCapabilityIndex } from "../agent/capabilityIndex.ts";
import {
  validateDirectComposition,
  type DirectCompositionDraft,
  type DirectScene,
  type WorldLayoutCellV1,
} from "./directComposition.ts";
import {
  inspectDirectComposition,
  type DirectBrowserQaResult,
  type DirectLayoutIssue,
} from "./layoutInspector.ts";
import {
  INTERACTION_RUNTIME_FILE,
  normalizeStoryboardInteractionIntents,
  normalizeStoryboardSpatialIntent,
} from "./interactionContract.ts";
import {
  CUT_RUNTIME_FILE,
  CUT_SHAPE_HINTS,
  CUT_STYLES,
  auditCutCoherence,
  canonicalCutStyle,
  normalizeStoryboardCutIntent,
  resolveCutPlan,
  shapeHintsRhyme,
  type CutAxis,
} from "./cutContract.ts";
import {
  CAMERA_FULL_MOVES,
  CAMERA_MOVES,
  CAMERA_RUNTIME_FILE,
  type CameraMoveIntentV1,
  DIVE_LEG_FRACTION,
  DIVE_LEG_MAX_SEC,
  SEQUENCES_EASES,
  auditCameraEnergy,
  injectCameraRuntimeTag,
  normalizeStoryboardCameraIntent,
  resolveCameraPlan,
  sceneScopes,
} from "./cameraContract.ts";
import {
  CINEMA_KIT_FILE,
  CINEMA_KIT_VERSION,
  injectCinemaKit,
} from "./cinemaKit.ts";
import {
  MAX_RAMPS_PER_FILM,
  TIME_RUNTIME_FILE,
  normalizeStoryboardTimeRamp,
  resolveTimeRampPlan,
  timeRampHoldWindow,
  warpInverseOf,
} from "./timeRamp.ts";
import { discoverShapeMatchUpgrade } from "./cutDiscovery.ts";
import { FX_RUNTIME_FILE, resolveFxPlan } from "./fxContract.ts";
import {
  COMPONENT_BEAT_KINDS,
  COMPONENT_KINDS,
  COMPONENT_KIT_FILE,
  COMPONENT_KIT_VERSION,
  COMPONENT_RUNTIME_FILE,
  auditComponentComplexity,
  auditSurfaceExits,
  autoStyleCompactPops,
  componentAuthoringReference,
  componentPlanningVocabulary,
  componentSkeletonMarkup,
  componentSupportsBeat,
  dedupeRedundantBeats,
  degradeExcessAssembles,
  degradeOpenPopStyles,
  injectComponentKit,
  injectComponentRuntimeTag,
  morphPartnerKinds,
  normalizeStoryboardComponentBeats,
  normalizeStoryboardComponents,
  resolveComponentPlan,
  type ComponentBeatKind,
  type ComponentKind,
} from "./componentContract.ts";
import {
  deriveGradeShifts,
  dropUnusableGradeShifts,
  normalizeStoryboardGradeShift,
} from "./gradeShift.ts";
import {
  normalizeStoryboardMoments,
  plannedMomentFloor,
  resolveMomentContract,
  topUpStoryboardMoments,
  validatePlannedMoments,
  type StoryboardMomentV1,
} from "./storyboardMoments.ts";
import { analyzeMotionDensity } from "./motionDensity.ts";
import {
  ASSEMBLE_HOLD_SEC,
  PACING_TOLERANCE_SEC,
  READING_MAX_SEC,
  READING_MIN_SEC,
  READING_SEC_PER_WORD,
  auditPacing,
  delayConflictingCameraMoves,
  framingChangeEvents,
  nextFramingChangeAfter,
  normalizeCameraBudget,
  stretchMarginalPacingMisses,
  withNormalizationNotes,
} from "./pacingAudit.ts";
import { frameCapsule, readFrameMeta } from "./frameDesign.ts";
import {
  claimSentinelHedge,
  recordSentinelDegradation,
  recordSentinelLayerFinding,
  recordSentinelModelCall,
  recordSentinelModelCallFailure,
  recordSentinelNormalization,
  recordSentinelScaffold,
  recordSentinelScaffoldRestoration,
  recordSentinelSlotCall,
} from "./sentinelTelemetry.ts";
import { criticSkipCleanEnabled, recipesEnabled, sentinelSkeletonEnabled, sentinelSlotsEnabled } from "./sentinelFlags.ts";
import {
  MAX_RECIPES_PER_FILM,
  injectRecipeContract,
  loadRecipeLibrary,
  normalizeStoryboardRecipeDeclarations,
  reconcileRecipeDeclarations,
} from "./recipeContract.ts";
import {
  SENTINEL_CONTRACT,
  type SentinelBlocking,
} from "./sentinel.ts";
import {
  assembleSlotComposition,
  attributeFindingsToScenes,
  extractSceneSlots,
  type ParsedSceneSlots,
} from "./sceneSlots.ts";
import {
  creativeModel,
  creativeThinkingMode,
  lightModel,
  productionModel,
  sourceRescueModel,
  sourceRescueThinkingMode,
  storyboardRescueModel,
  thinkingOverride,
} from "./modelPolicy.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIRECTOR_PROMPT = fs.readFileSync(
  path.join(APP_DIR, "prompts", "planning-director.md"),
  "utf8",
);

export interface CompositionRunResult {
  draft: DirectCompositionDraft;
  raw: string;
  attempts: number;
  /** Browser QA of the returned draft when a pass ran (feeds cut discovery). */
  browserQa?: DirectBrowserQaResult;
  /**
   * Static frame/motion repair warnings the returned draft still carries (the
   * least-bad pick weights these; the critic-skip predicate must too — a
   * repaired-but-pixel-pristine draft is exactly a draft the critic can help).
   */
  staticRepairWarnings?: string[];
}

const COMPOSITION_SOURCE_BUDGET_CHARS = 38_000;
const COMPACT_SKILL_BUDGET_CHARS = 16_000;
const SLOT_SKILL_BUDGET_CHARS = 5_000;
const REPAIR_MAX_TOKENS = 4_096;
const MAX_REPAIR_PATCHES = 16;
// Camera-era storyboards carry typed camera paths and more shots, so the
// compact JSON artifact needs more room than the pre-rig 4K ceiling.
const STORYBOARD_MAX_TOKENS = 6_144;
// GLM spends this shared budget on reasoning before the JSON artifact.
// OpenRouter currently exposes a 32,768-token completion ceiling for GLM 5.2;
// reserving almost all of it prevents a good long think from truncating the
// actual storyboard at the old 16K application cap.
const REASONING_STORYBOARD_MAX_TOKENS = 30_720;
const MAX_AUTHOR_SEGMENTS = 3;

function storyboardResponseFormat(): NonNullable<CompleteOptions["responseFormat"]> {
  const capabilityIds = loadCapabilityIndex().capabilities.map((capability) => capability.id);
  return {
    type: "json_schema",
    json_schema: {
      name: "sequences_storyboard",
      strict: true,
      schema: {
        type: "object",
        properties: {
          storyboard: {
            type: "array",
            minItems: 3,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                purpose: { type: "string" },
                incomingIdea: { type: "string" },
                foreground: { type: "string" },
                background: { type: "string" },
                cameraIntent: { type: "string" },
                startSec: { type: "number" },
                durationSec: { type: "number" },
                blueprint: { type: "string" },
                rules: { type: "array", items: { type: "string" } },
                capabilityIds: {
                  type: "array",
                  items: { type: "string", enum: capabilityIds },
                },
                continuityAnchor: { type: "string" },
                outgoingCut: { type: "string" },
                cut: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    style: { type: "string", enum: [...CUT_STYLES] },
                    travelPx: { type: "number" },
                    exitSec: { type: "number" },
                    entrySec: { type: "number" },
                    focalPartOut: { type: "string" },
                    focalPartIn: { type: "string" },
                    shapeOut: { type: "string", enum: [...CUT_SHAPE_HINTS] },
                    shapeIn: { type: "string", enum: [...CUT_SHAPE_HINTS] },
                  },
                  required: ["version", "style"],
                  additionalProperties: false,
                },
                timeRamp: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    atSec: { type: "number" },
                    slowTo: { type: "number" },
                    holdSec: { type: "number" },
                    recoverSec: { type: "number" },
                  },
                  required: ["version"],
                  additionalProperties: false,
                },
                camera: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    path: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          version: { type: "number", enum: [1] },
                          move: { type: "string", enum: [...CAMERA_MOVES] },
                          toRegion: { type: "string" },
                          toPart: { type: "string" },
                          fromRegion: { type: "string" },
                          fromPart: { type: "string" },
                          zoom: { type: "number" },
                          arcDeg: { type: "number" },
                          focus: {
                            type: "object",
                            properties: {
                              part: { type: "string" },
                              depth: { type: "number" },
                              blurMaxPx: { type: "number" },
                            },
                            additionalProperties: false,
                          },
                          startSec: { type: "number" },
                          durationSec: { type: "number" },
                          ease: {
                            type: "string",
                            enum: [
                              ...SEQUENCES_EASES,
                              "power2.inOut",
                              "power3.out",
                              "expo.out",
                              "sine.inOut",
                              "none",
                            ],
                          },
                        },
                        required: ["version", "move", "startSec", "durationSec"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["version", "path"],
                  additionalProperties: false,
                },
                components: {
                  type: "array",
                  maxItems: 6,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      kind: { type: "string", enum: [...COMPONENT_KINDS] },
                      region: { type: "string" },
                      role: { type: "string", enum: ["hero", "support"] },
                    },
                    required: ["version", "id", "kind"],
                    additionalProperties: false,
                  },
                },
                beats: {
                  type: "array",
                  maxItems: 10,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      component: { type: "string" },
                      kind: { type: "string", enum: [...COMPONENT_BEAT_KINDS] },
                      atSec: { type: "number" },
                      durationSec: { type: "number" },
                      text: { type: "string" },
                      value: { type: "number" },
                      item: { type: "number" },
                      toState: { type: "string" },
                      morphTo: { type: "string" },
                      ease: {
                        type: "string",
                        enum: [
                          ...SEQUENCES_EASES,
                          "power2.out",
                          "power3.out",
                          "expo.out",
                          "none",
                        ],
                      },
                    },
                    required: ["version", "id", "component", "kind", "atSec"],
                    additionalProperties: false,
                  },
                },
                recipes: {
                  type: "array",
                  maxItems: MAX_RECIPES_PER_FILM,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      region: { type: "string" },
                      params: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            value: { type: ["string", "number"] },
                          },
                          required: ["name", "value"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["version", "id", "params"],
                    additionalProperties: false,
                  },
                },
                spatialIntent: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    focalPart: { type: "string" },
                    composition: { type: "string" },
                    frameAnchor: {
                      type: "string",
                      enum: [
                        "frame:center",
                        "frame:top-left",
                        "frame:top-right",
                        "frame:bottom-left",
                        "frame:bottom-right",
                        "frame:left-third",
                        "frame:right-third",
                      ],
                    },
                    opticalBias: {
                      type: "object",
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                      required: ["x", "y"],
                      additionalProperties: false,
                    },
                    relationships: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["version", "focalPart", "composition", "relationships"],
                  additionalProperties: false,
                },
                moments: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      atSec: { type: "number" },
                      title: { type: "string" },
                      visualState: { type: "string" },
                      change: { type: "string" },
                      motionIntent: { type: "string" },
                      importance: { type: "string", enum: ["primary", "supporting"] },
                    },
                    required: [
                      "version", "id", "atSec", "title", "visualState", "change",
                      "motionIntent", "importance",
                    ],
                    additionalProperties: false,
                  },
                },
                interactions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      sceneId: { type: "string" },
                      cursorId: { type: "string" },
                      targetPart: { type: "string" },
                      action: {
                        type: "string",
                        enum: ["move", "hover", "click", "focus", "drag"],
                      },
                      startSec: { type: "number" },
                      arriveSec: { type: "number" },
                      pressSec: { type: "number" },
                      releaseSec: { type: "number" },
                      holdUntilSec: { type: "number" },
                      from: { type: "string" },
                      path: {
                        type: "string",
                        enum: ["direct", "arc", "human", "custom"],
                      },
                      bend: { type: "number" },
                      ease: { type: "string" },
                      aimX: { type: "number" },
                      aimY: { type: "number" },
                      offsetX: { type: "number" },
                      offsetY: { type: "number" },
                      hitInsetPx: { type: "number" },
                      feedback: {
                        type: "string",
                        enum: ["none", "press", "ripple", "press-ripple", "custom"],
                      },
                      ripplePart: { type: "string" },
                      dragTargetPart: { type: "string" },
                      cursorScale: { type: "number" },
                      targetScale: { type: "number" },
                      waypoints: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            x: { type: "number" },
                            y: { type: "number" },
                          },
                          required: ["x", "y"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: [
                      "version", "id", "sceneId", "cursorId", "targetPart", "action",
                      "startSec", "arriveSec", "from", "path", "aimX", "aimY", "feedback",
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: [
                "id", "title", "purpose", "incomingIdea", "foreground", "background",
                "cameraIntent", "startSec", "durationSec", "blueprint", "rules",
                "capabilityIds", "continuityAnchor", "outgoingCut", "cut", "timeRamp",
                "camera", "components", "beats", "recipes", "spatialIntent", "moments",
                "interactions",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["storyboard"],
        additionalProperties: false,
      },
    },
  };
}

const PATCH_RESPONSE_FORMAT: NonNullable<CompleteOptions["responseFormat"]> = {
  type: "json_schema",
  json_schema: {
    name: "sequences_composition_patches",
    strict: true,
    schema: {
      type: "object",
      properties: {
        patches: {
          type: "array",
          minItems: 1,
          maxItems: MAX_REPAIR_PATCHES,
          items: {
            type: "object",
            properties: {
              search: { type: "string" },
              replace: { type: "string" },
            },
            required: ["search", "replace"],
            additionalProperties: false,
          },
        },
      },
      required: ["patches"],
      additionalProperties: false,
    },
  },
};

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
  const configured = process.env.SLACK_SEQUENCES_REPAIR_MODEL?.trim();
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
    process.env.SLACK_SEQUENCES_STORYBOARD_MODEL,
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
 * Full-document source emission defaults to reasoning off — DeepSeek-style
 * models spend the whole budget on source, not deliberation. The override
 * exists so operators can measure whether a reasoning pass earns its latency.
 */
function authorThinkingMode(): CompleteOptions["thinkingMode"] {
  return thinkingOverride("SLACK_SEQUENCES_AUTHOR_THINKING") ?? "none";
}

function tagged(raw: string, name: string): string {
  const match = raw.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i"));
  if (!match?.[1]) {
    const hasOpen = new RegExp(`<${name}>`, "i").test(raw);
    const hasClose = new RegExp(`</${name}>`, "i").test(raw);
    if (hasOpen && !hasClose) {
      throw new Error(
        `author response truncated: <${name}> opened but never closed — the model likely hit its ` +
          `output token limit. The next attempt must emit a complete, more compact composition.`,
      );
    }
    throw new Error(`author response is missing <${name}>`);
  }
  return match[1].trim().replace(/^```(?:html|json)?\s*/i, "").replace(/\s*```$/, "");
}

/** First balanced top-level JSON array in free text (ignores brackets in strings). */
function firstJsonArray(text: string): string | undefined {
  const start = text.indexOf("[");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function structuredArray(raw: string, property: string): unknown[] | undefined {
  const source = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const value = JSON.parse(source) as unknown;
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = (value as Record<string, unknown>)[property];
      if (Array.isArray(nested)) return nested;
    }
  } catch {
    // Legacy tagged and bare-text responses continue through the existing parser.
  }
  return undefined;
}

/**
 * Extract the storyboard array source from a planner response. The contract asks
 * for a <storyboard_json> wrapper, but cheaper "Flash"-tier models routinely
 * ignore it and emit a bare or ```json-fenced array. Recover that array rather
 * than failing the whole build — while still reporting an opened-but-unclosed
 * tag as a genuine truncation (the array really is incomplete). Only used where
 * the response is storyboard-only; the combined create/revise response keeps the
 * strict tag boundary so a bare scan can't grab an array out of the HTML.
 */
function extractStoryboardSource(raw: string): string {
  const structured = structuredArray(raw, "storyboard");
  if (structured) return JSON.stringify(structured);
  const match = raw.match(/<storyboard_json>\s*([\s\S]*?)\s*<\/storyboard_json>/i);
  if (match?.[1]) {
    return match[1].trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  if (/<storyboard_json>/i.test(raw) && !/<\/storyboard_json>/i.test(raw)) {
    throw new Error(
      "author response truncated: <storyboard_json> opened but never closed — the model likely hit " +
        "its output token limit. The next attempt must emit a complete, more compact storyboard.",
    );
  }
  const bare = firstJsonArray(raw);
  if (bare) return bare;
  throw new Error("author response is missing <storyboard_json>");
}

/** First complete HTML document in free text: `<!doctype html>` or `<html …>` … `</html>`. */
function firstHtmlDocument(text: string): string | undefined {
  const open = text.search(/<!doctype\s+html|<html[\s>]/i);
  if (open < 0) return undefined;
  const close = /<\/html\s*>/i.exec(text.slice(open));
  if (!close) return undefined;
  return text.slice(open, open + close.index + close[0].length).trim();
}

/**
 * Extract the composition HTML from an author response. The contract asks for an
 * <index_html> wrapper, but after compact repairs cheaper "Flash"-tier models
 * routinely drop it and return the bare document (often inside a ```html fence).
 * Recover a complete <!doctype html>…</html> document rather than failing the
 * whole build — while still reporting an opened-but-unclosed wrapper as a genuine
 * truncation. An HTML document is unambiguous (unlike a bare JSON array), so this
 * recovery is safe even in the combined storyboard+html response.
 */
function extractIndexHtmlSource(raw: string): string {
  const match = raw.match(/<index_html>\s*([\s\S]*?)\s*<\/index_html>/i);
  if (match?.[1]) {
    return match[1].trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "");
  }
  if (/<index_html>/i.test(raw) && !/<\/index_html>/i.test(raw)) {
    throw new Error(
      "author response truncated: <index_html> opened but never closed — the model likely hit " +
        "its output token limit. The next attempt must emit a complete, more compact composition.",
    );
  }
  const bare = firstHtmlDocument(raw);
  if (bare) return bare;
  throw new Error("author response is missing <index_html>");
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

function htmlAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2];
}

function regexpEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function semanticPartTokens(value: string): string[] {
  const modifiers = new Set(["active", "current", "primary", "selected", "target"]);
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !modifiers.has(token));
}

function semanticPartScore(expected: string, candidate: string): number {
  const expectedTokens = new Set(semanticPartTokens(expected));
  const candidateTokens = new Set(semanticPartTokens(candidate));
  if (!expectedTokens.size || !candidateTokens.size) return 0;
  const shared = [...expectedTokens].filter((token) => candidateTokens.has(token)).length;
  return shared / Math.max(expectedTokens.size, candidateTokens.size);
}

function lockedSceneGraphError(html: string, storyboard: DirectScene[]): string | undefined {
  const authored = [...html.matchAll(
    /<[a-z][\w:-]*\b[^>]*\bdata-scene(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/gis,
  )].map((match) => ({
    id: htmlAttr(match[0], "data-scene") ?? htmlAttr(match[0], "id") ?? "",
    startSec: Number(htmlAttr(match[0], "data-start")),
    durationSec: Number(htmlAttr(match[0], "data-duration")),
  }));
  if (authored.length !== storyboard.length) {
    return `scene count changed from ${storyboard.length} to ${authored.length}`;
  }
  for (const expected of storyboard) {
    const match = authored.find((scene) => scene.id === expected.id);
    if (!match) return `scene "${expected.id}" was removed or renamed`;
    if (
      Math.abs(match.startSec - expected.startSec) > 0.01 ||
      Math.abs(match.durationSec - expected.durationSec) > 0.01
    ) {
      return `scene "${expected.id}" timing changed`;
    }
  }
  return undefined;
}

/** One scene-scoped `data-part` (or station) name a locked contract binds. */
interface ScenePartBinding {
  sceneId: string;
  part: string;
}

interface SceneScopeLocation {
  id: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
}

function matchingCloseTag(
  source: string,
  openStart: number,
  openTag: string,
  limit = source.length,
): { contentStart: number; closeStart: number; closeEnd: number } | undefined {
  const tagName = openTag.match(/^<([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase();
  if (!tagName || /\/\s*>$/.test(openTag)) return undefined;
  const contentStart = openStart + openTag.length;
  const walker = new RegExp(
    `<${regexpEscape(tagName)}\\b[^>]*>|</${regexpEscape(tagName)}\\s*>`,
    "gi",
  );
  walker.lastIndex = contentStart;
  let depth = 1;
  for (let step = walker.exec(source); step && step.index < limit; step = walker.exec(source)) {
    if (step[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return {
          contentStart,
          closeStart: step.index,
          closeEnd: step.index + step[0].length,
        };
      }
    } else if (!/\/\s*>$/.test(step[0])) {
      depth += 1;
    }
  }
  return undefined;
}

function sceneScopeLocations(source: string): SceneScopeLocation[] {
  const tags = [...source.matchAll(
    /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
  )];
  return tags.flatMap((match, index): SceneScopeLocation[] => {
    const tag = match[0];
    const openStart = match.index ?? 0;
    const tagName = tag.match(/^<([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase();
    const id = htmlAttr(tag, "data-scene") ?? "";
    if (!tagName || !id) return [];
    const close = matchingCloseTag(source, openStart, tag, tags[index + 1]?.index ?? source.length);
    if (!close) return [];
    return [{
      id,
      openStart,
      openEnd: close.contentStart,
      closeStart: close.closeStart,
      closeEnd: close.closeEnd,
    }];
  });
}

/**
 * Reconcile only scene-scoped part bindings whose intended element is
 * mechanically unambiguous. Exact element ids win; a semantic-name fallback is
 * allowed only when one globally unique part is the sole high-confidence
 * candidate. Ambiguity deliberately remains for quarantine/repair instead of
 * guessing.
 */
function reconcileScopedPartBindings(
  source: string,
  bindings: ScenePartBinding[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const desiredParts = [...new Map(bindings.flatMap((interaction) => [
    {
      sceneId: interaction.sceneId,
      part: interaction.part,
    },
  ]).map((entry) => [`${entry.sceneId}\u0000${entry.part}`, entry])).values()];

  for (const { sceneId, part: desired } of desiredParts) {
    const sceneTags = [...html.matchAll(
      /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
    )];
    const sceneIndex = sceneTags.findIndex((match) =>
      htmlAttr(match[0], "data-scene") === sceneId
    );
    if (sceneIndex < 0) continue;
    const scopeStart = sceneTags[sceneIndex]!.index;
    const scopeEnd = sceneTags[sceneIndex + 1]?.index ?? html.length;
    const scope = html.slice(scopeStart, scopeEnd);
    const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].map((match) => ({
      tag: match[0],
      id: htmlAttr(match[0], "id"),
      part: htmlAttr(match[0], "data-part"),
      index: scopeStart + match.index,
    }));
    const exact = tags.filter((entry) => entry.part === desired);
    const exactId = tags.filter((entry) => entry.id === desired);

    if (exact.length === 1) continue;
    if (exact.length > 1 && exactId.length === 1 && exactId[0]!.part === desired) {
      let duplicate = 0;
      const repairedScope = scope.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
        if (htmlAttr(tag, "data-part") !== desired || htmlAttr(tag, "id") === desired) {
          return tag;
        }
        duplicate += 1;
        repairs += 1;
        return tag.replace(
          new RegExp(`(\\bdata-part\\s*=\\s*)(["'])${regexpEscape(desired)}\\2`, "i"),
          `$1"${desired}-aux-${duplicate}"`,
        );
      });
      html = html.slice(0, scopeStart) + repairedScope + html.slice(scopeEnd);
      continue;
    }
    if (exact.length > 1) continue;

    let candidate = exactId.length === 1 ? exactId[0] : undefined;
    if (!candidate) {
      const partCounts = new Map<string, number>();
      for (const entry of tags) {
        if (entry.part) partCounts.set(entry.part, (partCounts.get(entry.part) ?? 0) + 1);
      }
      const scored = tags
        .filter((entry) =>
          Boolean(entry.part) &&
          partCounts.get(entry.part!) === 1 &&
          !entry.tag.includes("data-sequences-runtime-")
        )
        .map((entry) => ({
          entry,
          score: Math.max(
            semanticPartScore(desired, entry.part!),
            entry.id ? semanticPartScore(desired, entry.id) : 0,
          ),
        }))
        .filter((entry) => entry.score >= 0.8)
        .sort((a, b) => b.score - a.score);
      if (scored.length === 1 || (scored[0] && scored[0].score > (scored[1]?.score ?? 0))) {
        candidate = scored[0]?.entry;
      }
    }
    if (!candidate) continue;

    const replacement = candidate.part
      ? candidate.tag.replace(
          /(\bdata-part\s*=\s*)(["'])(.*?)\2/i,
          `$1"${desired}"`,
        )
      : candidate.tag.replace(/>$/, ` data-part="${desired}">`);
    if (replacement === candidate.tag) continue;
    html = html.slice(0, candidate.index) + replacement +
      html.slice(candidate.index + candidate.tag.length);
    repairs += 1;
  }
  return { html, repairs };
}

/**
 * Reconcile interaction targets whose intended element is mechanically
 * unambiguous (exact id, unique semantic candidate, or duplicate cleanup).
 */
export function reconcileInteractionTargets(
  source: string,
  interactions: NonNullable<DirectScene["interactions"]>,
): { html: string; repairs: number } {
  return reconcileScopedPartBindings(source, interactions.flatMap((interaction) => [
    { sceneId: interaction.sceneId, part: interaction.targetPart },
    ...(interaction.dragTargetPart
      ? [{ sceneId: interaction.sceneId, part: interaction.dragTargetPart }]
      : []),
  ]));
}

/**
 * Reconcile a missing `data-region` camera station onto the one element that
 * already carries the station's name as its id or data-part. Regions place
 * the camera, so only exact-name evidence is trusted here — no semantic
 * scoring, and any ambiguity stays a blocking finding.
 */
function reconcileCameraRegionStations(
  source: string,
  bindings: ScenePartBinding[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const desired = [...new Map(
    bindings.map((entry) => [`${entry.sceneId} ${entry.part}`, entry]),
  ).values()];
  for (const { sceneId, part: region } of desired) {
    const sceneTags = [...html.matchAll(
      /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
    )];
    const sceneIndex = sceneTags.findIndex((match) =>
      htmlAttr(match[0], "data-scene") === sceneId
    );
    if (sceneIndex < 0) continue;
    const scopeStart = sceneTags[sceneIndex]!.index;
    const scopeEnd = sceneTags[sceneIndex + 1]?.index ?? html.length;
    const scope = html.slice(scopeStart, scopeEnd);
    const regionPattern = new RegExp(
      `\\bdata-region\\s*=\\s*(["'])${regexpEscape(region)}\\1`,
      "i",
    );
    if (regionPattern.test(scope)) continue;
    const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].map((match) => ({
      tag: match[0],
      id: htmlAttr(match[0], "id"),
      part: htmlAttr(match[0], "data-part"),
      index: scopeStart + match.index,
    })).filter((entry) =>
      !entry.tag.includes("data-sequences-runtime-") &&
      !htmlAttr(entry.tag, "data-region")
    );
    const idMatches = tags.filter((entry) => entry.id === region);
    const partMatches = tags.filter((entry) => entry.part === region);
    const candidate = idMatches.length === 1
      ? idMatches[0]
      : idMatches.length === 0 && partMatches.length === 1
        ? partMatches[0]
        : undefined;
    if (!candidate) continue;
    const replacement = candidate.tag.replace(/>$/, ` data-region="${region}">`);
    if (replacement === candidate.tag) continue;
    html = html.slice(0, candidate.index) + replacement +
      html.slice(candidate.index + candidate.tag.length);
    repairs += 1;
  }
  return { html, repairs };
}

function cameraWorldStyle(scene: DirectScene | undefined): string {
  const cells = scene?.worldLayout ?? [];
  if (!cells.length) {
    return "position:absolute;inset:0;transform-origin:0 0";
  }
  const xs = cells.map((entry) => entry.cell[0]);
  const ys = cells.map((entry) => entry.cell[1]);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const width = (Math.max(...xs, 0) - minX + 1) * 1920;
  const height = (Math.max(...ys, 0) - minY + 1) * 1080;
  return `position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0`;
}

/**
 * A locked camera path means the scene must expose one transformable world
 * plane. When the author built the stations directly in the scene and omitted
 * only the wrapper, wrap that scene content in the canonical host plane.
 */
export function reconcileCameraWorldPlanes(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number } {
  const cameraSceneIds = new Set(resolveCameraPlan(scenes).scenes.map((scene) => scene.sceneId));
  if (!cameraSceneIds.size) return { html: source, repairs: 0 };
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  let html = source;
  let repairs = 0;
  for (const scope of [...sceneScopeLocations(html)].reverse()) {
    if (!cameraSceneIds.has(scope.id)) continue;
    const content = html.slice(scope.openEnd, scope.closeStart);
    if (/\bdata-camera-world\b/i.test(content)) continue;
    const wrapped =
      `\n<div data-camera-world style="${cameraWorldStyle(byId.get(scope.id))}">` +
      `${content}` +
      `\n</div>\n`;
    html = html.slice(0, scope.openEnd) + wrapped + html.slice(scope.closeStart);
    repairs += 1;
  }
  return { html, repairs };
}

/**
 * Deterministic binding reconciliation for the host-owned cut and camera
 * contracts. The author loop's most expensive failure class (the 2026-07-04
 * live fallback) was a locked-storyboard binding — a shape-match focal part or
 * a camera station — that the authored DOM carried under a near-miss name or
 * simply left unannotated on the intended element. Mechanically unambiguous
 * mismatches are reconciled here, before validation spends a paid repair on
 * binding paperwork; ambiguous targets deliberately stay blocking.
 */
export function reconcileContractBindings(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number; regionRepairs: number } {
  let html = source;
  let repairs = 0;
  let regionRepairs = 0;
  const partBindings: ScenePartBinding[] = [];
  for (const cut of resolveCutPlan(scenes).cuts) {
    if (cut.focalPartOut) partBindings.push({ sceneId: cut.fromScene, part: cut.focalPartOut });
    if (cut.focalPartIn) partBindings.push({ sceneId: cut.toScene, part: cut.focalPartIn });
  }
  // MD4: a gradeShift's fromPart is locked-storyboard paperwork like a cut focal
  // part — reconcile a near-miss id deterministically so a paid repair is never
  // spent on it (an absent/ambiguous fromPart just centers the wash — harmless).
  for (const scene of scenes) {
    if (scene.gradeShift?.fromPart) {
      partBindings.push({ sceneId: scene.id, part: scene.gradeShift.fromPart });
    }
  }
  const regionBindings: ScenePartBinding[] = [];
  for (const scenePlan of resolveCameraPlan(scenes).scenes) {
    for (const segment of scenePlan.segments) {
      for (const part of [segment.fromPart, segment.toPart, segment.focus?.part]) {
        if (part) partBindings.push({ sceneId: scenePlan.sceneId, part });
      }
      for (const region of [segment.fromRegion, segment.toRegion]) {
        if (region) regionBindings.push({ sceneId: scenePlan.sceneId, part: region });
      }
    }
  }
  if (partBindings.length) {
    const parts = reconcileScopedPartBindings(html, partBindings);
    html = parts.html;
    repairs += parts.repairs;
  }
  if (regionBindings.length) {
    const regions = reconcileCameraRegionStations(html, regionBindings);
    html = regions.html;
    repairs += regions.repairs;
    regionRepairs += regions.repairs;
  }
  return { html, repairs, regionRepairs };
}

/**
 * The model chooses interaction intent; the runtime owns the mechanical actors.
 * Retiring model-authored pointers/ripples prevents guessed hotspots, zero-size
 * ripples, duplicate visibility tweens, and inherited camera transforms from
 * leaking into an otherwise deterministic interaction.
 */
function normalizeInteractionActors(
  source: string,
  interactions: NonNullable<DirectScene["interactions"]>,
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const cursorIds = [...new Set(interactions.map((interaction) => interaction.cursorId))];
  // Authored CSS/JS selectors should keep addressing the retired decoration,
  // never accidentally grab the canonical actor injected below.
  html = html.replace(
    /\[data-cursor-id(?=[\]=])/gi,
    "[data-sequences-retired-cursor",
  );
  for (const cursorId of cursorIds) {
    const cursorAttribute = new RegExp(
      `\\bdata-cursor-id\\s*=\\s*(["'])${regexpEscape(cursorId)}\\1`,
      "i",
    );
    html = html.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
      if (
        tag.includes("data-sequences-runtime-cursor") ||
        !cursorAttribute.test(tag)
      ) {
        return tag;
      }
      repairs += 1;
      return tag.replace(
        cursorAttribute,
        `data-sequences-retired-cursor="${cursorId}"`,
      );
    });
  }
  const missingCursorIds = cursorIds.filter((cursorId) =>
    !new RegExp(
      `\\bdata-cursor-id\\s*=\\s*(["'])${regexpEscape(cursorId)}\\1`,
      "i",
    ).test(html)
  );
  if (missingCursorIds.length) {
    const actors = missingCursorIds.map((cursorId) =>
      `<svg aria-hidden="true" data-sequences-runtime-cursor ` +
      `data-cursor-id="${cursorId}" data-cursor-hotspot-x="0.1" ` +
      `data-cursor-hotspot-y="0.06" viewBox="0 0 32 32" ` +
      `style="position:absolute;left:0;top:0;width:32px;height:32px;opacity:0;` +
      `overflow:visible;pointer-events:none;z-index:2147483000;color:#fff;` +
      `filter:drop-shadow(0 1px 2px rgba(0,0,0,.72))">` +
      `<path d="M3 2.2 4.2 26l6.3-5.7 5.7 10.1 4.5-2.5-5.8-10.2 8.5-1.7Z" ` +
      `fill="currentColor" stroke="#090b0f" stroke-width="2" stroke-linejoin="round"/>` +
      `</svg>`
    ).join("");
    const overlay =
      `<div aria-hidden="true" data-camera-overlay data-sequences-interaction-layer ` +
      `style="position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:2147483000">` +
      `${actors}</div>`;
    const rootPattern =
      /<[a-z][\w:-]*\b(?=[^>]*\bdata-composition-id\s*=)[^>]*>/i;
    if (rootPattern.test(html)) {
      html = html.replace(rootPattern, (tag) => `${tag}\n${overlay}`);
      repairs += missingCursorIds.length;
    }
  }

  for (const interaction of interactions) {
    if (!interaction.ripplePart) continue;
    const rippleAttribute = new RegExp(
      `\\bdata-part\\s*=\\s*(["'])${regexpEscape(interaction.ripplePart)}\\1`,
      "i",
    );
    html = html.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
      if (
        tag.includes("data-sequences-runtime-ripple") ||
        !rippleAttribute.test(tag)
      ) {
        return tag;
      }
      repairs += 1;
      return tag.replace(
        rippleAttribute,
        `data-sequences-retired-ripple="${interaction.ripplePart}"`,
      );
    });
    if (rippleAttribute.test(html)) continue;
    const scenePattern = new RegExp(
      `<[a-z][\\w:-]*\\b(?=[^>]*\\bdata-scene\\s*=\\s*(["'])${
        regexpEscape(interaction.sceneId)
      }\\1)[^>]*>`,
      "i",
    );
    if (!scenePattern.test(html)) continue;
    const ripple =
      `<span aria-hidden="true" data-sequences-runtime-ripple ` +
      `data-part="${interaction.ripplePart}" style="position:absolute;left:0;top:0;` +
      `width:72px;height:72px;border:3px solid var(--accent,#3b82f6);` +
      `border-radius:999px;opacity:0;pointer-events:none;z-index:2147482999;` +
      `box-sizing:border-box;filter:drop-shadow(0 0 1px #000)"></span>`;
    html = html.replace(scenePattern, (tag) => `${tag}\n${ripple}`);
    repairs += 1;
  }
  if (
    repairs &&
    !html.includes("<style data-sequences-runtime-actors>")
  ) {
    html = html.replace(
      /<\/head>/i,
      `<style data-sequences-runtime-actors>` +
        `[data-sequences-retired-cursor],[data-sequences-retired-ripple]` +
        `{display:none!important}</style></head>`,
    );
  }
  return { html, repairs };
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

function inferVisibilityOpacity(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (
    normalized === "none" ||
    normalized === "hidden" ||
    normalized === "collapse" ||
    normalized === "0" ||
    normalized === "false"
  ) {
    return 0;
  }
  if (
    normalized === "block" ||
    normalized === "flex" ||
    normalized === "grid" ||
    normalized === "inline" ||
    normalized === "inline-block" ||
    normalized === "visible" ||
    normalized === "1" ||
    normalized === "true"
  ) {
    return 1;
  }
  return undefined;
}

function cleanGsapVarsObject(source: string): { source: string; changed: boolean } {
  const forbidden =
    /(["']?)(display|visibility)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$.-]*|-?\d+(?:\.\d+)?|true|false|null)\s*,?/gi;
  const values = [...source.matchAll(forbidden)].map((match) => match[3]);
  if (!values.length) return { source, changed: false };

  let body = source.slice(1, -1);
  body = body.replace(
    /,\s*(["']?)(display|visibility)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$.-]*|-?\d+(?:\.\d+)?|true|false|null)\s*/gi,
    "",
  );
  body = body.replace(
    /^\s*(["']?)(display|visibility)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$.-]*|-?\d+(?:\.\d+)?|true|false|null)\s*,?\s*/i,
    "",
  );
  body = body.replace(/,\s*}/g, "}").replace(/^\s*,\s*/, "");

  const cleaned = `{${body}}`;
  if (/\b(?:opacity|autoAlpha)\s*:/.test(cleaned)) {
    return { source: cleaned, changed: cleaned !== source };
  }
  const inferred = values
    .map(inferVisibilityOpacity)
    .find((opacity): opacity is number => opacity !== undefined);
  if (inferred === undefined) return { source: cleaned, changed: cleaned !== source };

  const trimmedBody = body.trim();
  const addition = `opacity: ${inferred}`;
  return {
    source: trimmedBody ? `{ ${addition}, ${trimmedBody} }` : `{ ${addition} }`,
    changed: true,
  };
}

function rewriteGsapCallVars(call: string): { call: string; repairs: number } {
  let output = "";
  let cursor = 0;
  let repairs = 0;
  for (let index = 0; index < call.length; index += 1) {
    if (call[index] !== "{") continue;
    let depth = 1;
    let quote: string | undefined;
    let escaped = false;
    let end = -1;
    for (let scan = index + 1; scan < call.length; scan += 1) {
      const next = call[scan]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (next === "\\") {
          escaped = true;
        } else if (next === quote) {
          quote = undefined;
        }
        continue;
      }
      if (next === "\"" || next === "'" || next === "`") {
        quote = next;
      } else if (next === "{") {
        depth += 1;
      } else if (next === "}") {
        depth -= 1;
        if (depth === 0) {
          end = scan;
          break;
        }
      }
    }
    if (end < 0) break;
    const objectSource = call.slice(index, end + 1);
    const cleaned = cleanGsapVarsObject(objectSource);
    if (cleaned.changed) {
      output += call.slice(cursor, index) + cleaned.source;
      cursor = end + 1;
      repairs += 1;
    }
    index = end;
  }
  if (!repairs) return { call, repairs };
  return { call: output + call.slice(cursor), repairs };
}

function normalizeGsapDisplayVisibilityTweens(source: string): { html: string; repairs: number } {
  const callStart = /\b(?:gsap|[A-Za-z_$][\w$]*)\s*\.\s*(?:to|from|fromTo|set)\s*\(/g;
  let html = "";
  let cursor = 0;
  let repairs = 0;
  for (const match of source.matchAll(callStart)) {
    const start = match.index ?? 0;
    const open = source.indexOf("(", start);
    if (open < 0) continue;
    let depth = 1;
    let quote: string | undefined;
    let escaped = false;
    let close = -1;
    for (let index = open + 1; index < source.length; index += 1) {
      const char = source[index]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        continue;
      }
      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close < 0) continue;
    const call = source.slice(start, close + 1);
    const rewritten = rewriteGsapCallVars(call);
    if (rewritten.repairs) {
      html += source.slice(cursor, start) + rewritten.call;
      cursor = close + 1;
      repairs += rewritten.repairs;
    }
  }
  if (!repairs) return { html: source, repairs };
  return { html: html + source.slice(cursor), repairs };
}

/** Kit child classes the component runtime's childItems() reveals. */
const REVEALABLE_CHILD_CLASS =
  /\bclass\s*=\s*(["'])[^"']*\bcmp-(?:row|item|card|msg)\b[^"']*\1/i;

/** The kind-appropriate revealable child class for a rows-markup top-up. */
function rowsChildMarkup(kind: string | undefined, index: number): string {
  // data-sequences-neutral marks host-invented placeholder copy so the
  // publish-time honesty scan can tell whether it actually SHIPPED (an
  // earlier attempt's injection may be superseded by a real re-author).
  const mark = ' data-sequences-neutral="1"';
  if (kind === "kanban") return `<div class="cmp-card material"${mark}>Card ${index}</div>`;
  if (kind === "chat") return `<div class="cmp-msg"${mark}>Message ${index}</div>`;
  if (kind === "table") {
    return `<div class="cmp-row"${mark}><span>Row ${index}</span><span class="cmp-chip">ok</span></div>`;
  }
  return `<div class="cmp-item"${mark}>Item ${index}</div>`;
}

/**
 * Deterministic rows-markup top-up (fallback-elimination lever): a `rows`
 * beat whose target root exists but has NO revealable children was the
 * single biggest waster of paid author attempts (3 of 5 recorded live runs)
 * — the runtime's childItems() finds nothing, the bind aborts the compile,
 * and a whole model retry is spent on paperwork the kit owns. Inject three
 * neutral kind-appropriate children host-side instead; the beat reveals
 * them, the author already styled the container. `select` beats have the
 * exact same childItems() bind requirement (live probe codexfix-probe-1:
 * a childless command-palette burned 3 attempts + the rescue rung on
 * `kit_markup_incomplete`) and the runtime clamps `item` into range, so
 * they take the same top-up. Only the mechanically certain case is
 * repaired: exactly one candidate root, zero revealable children anywhere
 * inside it. `kitMarkupAudit` keeps the same check for whatever this pass
 * cannot prove.
 */
export function topUpRowsMarkup(
  html: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  const repaired: string[] = [];
  const targets = new Map<string, string | undefined>();
  for (const scene of scenes) {
    const kinds = new Map((scene.components ?? []).map((entry) => [entry.id, entry.kind]));
    for (const beat of scene.beats ?? []) {
      if (beat.kind === "rows" || beat.kind === "select") {
        targets.set(beat.component, kinds.get(beat.component));
      }
    }
  }
  for (const [component, kind] of targets) {
    const openPattern = new RegExp(
      `<([a-z][\\w-]*)\\b[^>]*\\bdata-part\\s*=\\s*(["'])${regexpEscape(component)}\\2[^>]*>`,
      "gi",
    );
    const opens = [...html.matchAll(openPattern)];
    if (opens.length !== 1) continue;
    const open = opens[0]!;
    const tag = open[1]!.toLowerCase();
    const contentStart = (open.index ?? 0) + open[0].length;
    // Depth-scan for the matching close tag of the root element.
    const walker = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
    walker.lastIndex = contentStart;
    let depth = 1;
    let contentEnd = -1;
    for (let step = walker.exec(html); step; step = walker.exec(html)) {
      if (step[0].startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          contentEnd = step.index;
          break;
        }
      } else if (!/\/>$/.test(step[0])) {
        depth += 1;
      }
    }
    if (contentEnd < 0) continue;
    const content = html.slice(contentStart, contentEnd);
    if (REVEALABLE_CHILD_CLASS.test(content)) continue;
    const rows = [1, 2, 3].map((index) => rowsChildMarkup(kind, index)).join("\n");
    html = `${html.slice(0, contentEnd)}\n${rows}\n${html.slice(contentEnd)}`;
    repaired.push(component);
  }
  return { html, repaired };
}

/** The kit `.fx-underline` SVG the MD3 draw effect animates (a trim-path rule). */
const FX_UNDERLINE_MARKUP =
  `<span class="fx-underline" data-sequences-fx="underline" data-layout-ignore aria-hidden="true" ` +
  `style="display:block;height:0.14em;margin-top:0.12em;pointer-events:none">` +
  `<svg viewBox="0 0 100 4" preserveAspectRatio="none" ` +
  `style="display:block;width:100%;height:100%;overflow:visible">` +
  `<line x1="0" y1="2" x2="100" y2="2" stroke="var(--accent,#6ea8ff)" stroke-width="3" ` +
  `stroke-linecap="round"/></svg></span>`;

/**
 * MD3 deterministic underline top-up: a `highlight` beat with style "underline"
 * draws a trim-path rule under its target through the fx runtime's `.fx-underline`
 * SVG. When the author placed no such markup, inject the kit pattern host-side —
 * exactly the rows-style philosophy (a paid attempt must never die on fx
 * paperwork, and the effect is enhancement-only so a stray inject is harmless).
 * Only the mechanically certain case is repaired: exactly one target root with
 * no existing `.fx-underline` inside it.
 */
export function topUpUnderlineMarkup(
  html: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  const repaired: string[] = [];
  const targets = new Set<string>();
  for (const scene of scenes) {
    for (const beat of scene.beats ?? []) {
      if (beat.kind === "highlight" && beat.style === "underline") targets.add(beat.component);
    }
  }
  for (const component of targets) {
    const openPattern = new RegExp(
      `<([a-z][\\w-]*)\\b[^>]*\\bdata-part\\s*=\\s*(["'])${regexpEscape(component)}\\2[^>]*>`,
      "gi",
    );
    const opens = [...html.matchAll(openPattern)];
    if (opens.length !== 1) continue;
    const open = opens[0]!;
    const tag = open[1]!.toLowerCase();
    const contentStart = (open.index ?? 0) + open[0].length;
    const walker = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
    walker.lastIndex = contentStart;
    let depth = 1;
    let contentEnd = -1;
    for (let step = walker.exec(html); step; step = walker.exec(html)) {
      if (step[0].startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          contentEnd = step.index;
          break;
        }
      } else if (!/\/>$/.test(step[0])) {
        depth += 1;
      }
    }
    if (contentEnd < 0) continue;
    const content = html.slice(contentStart, contentEnd);
    if (/\bclass\s*=\s*(["'])[^"']*\bfx-underline\b/i.test(content)) continue;
    html = `${html.slice(0, contentEnd)}${FX_UNDERLINE_MARKUP}${html.slice(contentEnd)}`;
    repaired.push(component);
  }
  return { html, repaired };
}

function normalizeJsonIsland(
  source: string,
  id: string,
  payload: string,
): { html: string; repairs: number; found: boolean } {
  const pattern = new RegExp(
    `(<script\\b[^>]*\\bid\\s*=\\s*(["'])${regexpEscape(id)}\\2[^>]*>)([\\s\\S]*?)(<\\/script>)`,
    "gi",
  );
  let found = false;
  let repairs = 0;
  const html = source.replace(pattern, (match, open: string, _quote: string, body: string, close: string) => {
    if (!found) {
      found = true;
      // Stamp the host marker even when the payload already matches: from here
      // on this island's content is host truth, and a later repair pass must
      // not count re-stripping it as a model-authored island.
      const hostOpen = ensureTagAttr(open, "data-sequences-host", "1");
      if (body === payload && hostOpen === open) return match;
      if (body !== payload) repairs += 1;
      return `${hostOpen}${payload}${close}`;
    }
    repairs += 1;
    return "";
  });
  return { html, repairs, found };
}

function removeJsonIsland(
  source: string,
  id: string,
): { html: string; removed: number; removedModel: number } {
  let removed = 0;
  let removedModel = 0;
  const pattern = new RegExp(
    `\\n?[ \\t]*<script\\b[^>]*\\bid\\s*=\\s*(["'])${regexpEscape(id)}\\1[^>]*>[\\s\\S]*?<\\/script>`,
    "gi",
  );
  const html = source.replace(pattern, (match) => {
    removed += 1;
    // Islands the host injected/canonicalized carry data-sequences-host; a
    // repair pass re-stripping them is routine plumbing, not a model fault.
    if (!/\bdata-sequences-host\s*=\s*["']1["']/i.test(match)) removedModel += 1;
    return "";
  });
  return { html, removed, removedModel };
}

/**
 * Host-owned JSON islands are executable contracts, not author notes. When the
 * locked storyboard has no resolved plan for one of those runtimes, any island
 * the model wrote is stale or hallucinated and can only hurt: static validation
 * parses it, and browser compile would try to bind it. Remove it instead of
 * spending a repair attempt on making an unused plan syntactically valid.
 */
export function stripUnusedHostPlanIslands(
  source: string,
  scenes: DirectScene[],
): { html: string; removed: string[] } {
  let html = source;
  const removed: string[] = [];
  const interactions = scenes.flatMap((scene) => scene.interactions ?? []);
  if (interactions.length === 0) {
    const result = removeJsonIsland(html, "sequences-interactions");
    html = result.html;
    for (let index = 0; index < result.removed; index += 1) removed.push("sequences-interactions");
  }
  if (resolveCameraPlan(scenes).scenes.length === 0) {
    const result = removeJsonIsland(html, "sequences-camera");
    html = result.html;
    for (let index = 0; index < result.removed; index += 1) removed.push("sequences-camera");
  }
  if (resolveComponentPlan(scenes).scenes.length === 0) {
    const result = removeJsonIsland(html, "sequences-components");
    html = result.html;
    for (let index = 0; index < result.removed; index += 1) removed.push("sequences-components");
  }
  return { html, removed };
}

/** Every host-owned JSON island id. These are executable contracts injected
 * deterministically from the locked storyboard — never author notes. */
export const HOST_PLAN_ISLAND_IDS = [
  "sequences-interactions",
  "sequences-cuts",
  "sequences-camera",
  "sequences-components",
  "sequences-time",
  "sequences-fx",
] as const;

/**
 * Sentinel Phase 1 (SENTINEL_PLAN.md §3.1): host plan islands are host-owned,
 * always. `stripUnusedHostPlanIslands` only removed islands with NO matching
 * plan, so a model-authored island that *shadows* a real plan survived until
 * validation (the 2026-07-05 `sequences-interactions.version must be 1` /
 * `sequences-camera.scenes must be an array` incident). This removes EVERY
 * host island unconditionally; the per-plan injection that follows re-emits the
 * canonical island from the locked storyboard, so nothing the model hand-wrote
 * about an island can ever reach validation. Idempotent for a document with no
 * author islands (the post-prompt-deletion steady state — removed stays empty).
 */
export function stripAllHostPlanIslands(
  source: string,
): { html: string; removed: string[]; removedModel: string[] } {
  let html = source;
  const removed: string[] = [];
  // Only islands WITHOUT the host marker — the ones the model actually
  // hand-wrote. Host-injected islands from an earlier repair pass are
  // re-stripped as routine plumbing and must not inflate the L2 telemetry.
  const removedModel: string[] = [];
  for (const id of HOST_PLAN_ISLAND_IDS) {
    const result = removeJsonIsland(html, id);
    html = result.html;
    for (let index = 0; index < result.removed; index += 1) removed.push(id);
    for (let index = 0; index < result.removedModel; index += 1) removedModel.push(id);
  }
  return { html, removed, removedModel };
}

function ensureTagAttr(tag: string, name: string, value: string): string {
  const escaped = regexpEscape(name);
  const pattern = new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i");
  if (pattern.test(tag)) {
    return tag.replace(pattern, `${name}="${value}"`);
  }
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

// The intersection of the storyboard schema's `frameAnchor` enum and the
// anchors the layout QA's data-layout-anchor audit understands. The schema's
// corner anchors (frame:top-left/…) have no QA equivalent and are deliberately
// NOT forwarded — the focal part still gets data-layout-important, which
// satisfies layout_intent_missing without minting layout_anchor_invalid.
const SUPPORTED_LAYOUT_ANCHORS = new Set([
  "frame:center",
  "frame:left-third",
  "frame:right-third",
]);

/**
 * Tolerance (px) for a HOST-injected data-layout-anchor. The audit's 12px
 * default assumes the author placed the element while declaring the intent;
 * here the host forwards storyboard intent onto placement the author made
 * without knowing an anchor audit would run, so a repair meant to satisfy
 * layout_intent_missing must not mint layout_anchor_mismatch on a hand-placed
 * hero that honors the intent loosely.
 */
const INJECTED_ANCHOR_TOLERANCE = "48";

function hasDeclaredLayoutIntent(scope: string): boolean {
  return /\bdata-layout-(?:important|anchor|align|attach|gap)\b/i.test(scope);
}

function addLayoutAttrsToFirstTag(
  scope: string,
  pattern: RegExp,
  attrs: Record<string, string>,
): { scope: string; changed: boolean } {
  const match = pattern.exec(scope);
  if (!match?.[0] || match.index === undefined) return { scope, changed: false };
  let tag = match[0];
  for (const [name, value] of Object.entries(attrs)) {
    tag = ensureTagAttr(tag, name, value);
  }
  if (tag === match[0]) return { scope, changed: false };
  return {
    scope: scope.slice(0, match.index) + tag + scope.slice(match.index + match[0].length),
    changed: true,
  };
}

export function injectLayoutIntentHints(
  source: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  let html = source;
  const repaired: string[] = [];
  for (const scene of scenes) {
    const scopeMeta = sceneScopeLocations(html).find((entry) => entry.id === scene.id);
    if (!scopeMeta) continue;
    let scope = html.slice(scopeMeta.openStart, scopeMeta.closeEnd);
    if (hasDeclaredLayoutIntent(scope)) continue;

    let nextScope = scope;
    let changed = false;
    const anchor = scene.spatialIntent?.frameAnchor &&
        SUPPORTED_LAYOUT_ANCHORS.has(scene.spatialIntent.frameAnchor)
      ? scene.spatialIntent.frameAnchor
      : undefined;
    if (scene.spatialIntent?.focalPart) {
      const focalPattern = new RegExp(
        `<[a-z][\\w:-]*\\b[^>]*\\bdata-part\\s*=\\s*(["'])${
          regexpEscape(scene.spatialIntent.focalPart)
        }\\1[^>]*>`,
        "i",
      );
      const result = addLayoutAttrsToFirstTag(nextScope, focalPattern, {
        "data-layout-important": "1",
        ...(anchor
          ? {
              "data-layout-anchor": anchor,
              "data-layout-tolerance": INJECTED_ANCHOR_TOLERANCE,
            }
          : {}),
      });
      nextScope = result.scope;
      changed = result.changed;
    }
    if (!changed && scene.spatialIntent) {
      const sceneOpenPattern =
        /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/i;
      const result = addLayoutAttrsToFirstTag(nextScope, sceneOpenPattern, {
        "data-layout-anchor": anchor ?? "frame:center",
        "data-layout-tolerance": INJECTED_ANCHOR_TOLERANCE,
      });
      nextScope = result.scope;
      changed = result.changed;
    }
    if (!changed) {
      const knownLayoutPattern =
        /<[a-z][\w:-]*\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\b(?:zone|panel|card|hero|stack|grid|cluster|lockup|metric|surface|frame)\b[^"']*\1)(?![^>]*\bdata-scene\s*=)[^>]*>/i;
      const result = addLayoutAttrsToFirstTag(nextScope, knownLayoutPattern, {
        "data-layout-important": "1",
      });
      nextScope = result.scope;
      changed = result.changed;
    }
    if (!changed) continue;
    html = html.slice(0, scopeMeta.openStart) + nextScope + html.slice(scopeMeta.closeEnd);
    repaired.push(scene.id);
  }
  return { html, repaired };
}

/**
 * Bind a declared component whose `data-part` element is entirely missing from
 * the scene to the one unambiguous, still-unlabeled candidate the author left
 * behind — an element carrying this component's kind, an exact id match, or a
 * unique semantic-name match. This mirrors the cut/camera/interaction target
 * reconciler (exact / unique-candidate, ambiguity stays blocking): a dense
 * component brief where the model built the surface but forgot or mis-named its
 * `data-part` no longer sinks the whole run at `source-author`. A lone
 * kind-marked element whose `data-part` is a non-component alias can be claimed;
 * correctly-bound sibling components are never hijacked. Absent any safe
 * candidate the component stays unbound and the author re-authors honestly.
 */
function bindMissingComponentElement(
  scope: string,
  component: NonNullable<DirectScene["components"]>[number],
  sceneComponents: NonNullable<DirectScene["components"]>,
): { html: string; repairs: number } {
  const claimed = new Set(
    sceneComponents.filter((entry) => entry.id !== component.id).map((entry) => entry.id),
  );
  const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)]
    .map((match) => ({
      tag: match[0],
      id: htmlAttr(match[0], "id"),
      part: htmlAttr(match[0], "data-part"),
      kind: htmlAttr(match[0], "data-component"),
      index: match.index,
    }))
    .filter((entry) =>
      !entry.tag.includes("data-sequences-runtime-") &&
      !htmlAttr(entry.tag, "data-scene") &&
      // A non-component alias can move inside this root; another declared
      // component's part/id cannot.
      !(entry.part && claimed.has(entry.part)) &&
      !(entry.id && claimed.has(entry.id))
    );
  const pickUnique = <T,>(list: T[]): T | undefined => (list.length === 1 ? list[0] : undefined);
  // 1) the author put the intended name on `id` instead of data-part;
  // 2) a lone element already declaring this component's kind;
  // 3) a unique high-confidence semantic name match.
  let candidate = pickUnique(tags.filter((entry) => entry.id === component.id));
  if (!candidate) candidate = pickUnique(tags.filter((entry) => entry.kind === component.kind));
  if (!candidate) {
    const scored = tags
      .filter((entry) => entry.id || entry.kind)
      .map((entry) => ({
        entry,
        score: Math.max(
          entry.id ? semanticPartScore(component.id, entry.id) : 0,
          entry.kind === component.kind ? 1 : 0,
        ),
      }))
      .filter((entry) => entry.score >= 0.8)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 1 || (scored[0] && scored[0].score > (scored[1]?.score ?? 0))) {
      candidate = scored[0]?.entry;
    }
  }
  if (!candidate) return { html: scope, repairs: 0 };
  let replacement = ensureTagAttr(candidate.tag, "data-part", component.id);
  replacement = ensureTagAttr(replacement, "data-component", component.kind);
  if (
    component.region &&
    !new RegExp(`\\bdata-region\\s*=\\s*(["'])${regexpEscape(component.region)}\\1`, "i").test(scope)
  ) {
    replacement = ensureTagAttr(replacement, "data-region", component.region);
  }
  if (replacement === candidate.tag) return { html: scope, repairs: 0 };
  const html = scope.slice(0, candidate.index) + replacement +
    scope.slice(candidate.index + candidate.tag.length);
  return { html, repairs: 1 };
}

export function reconcileComponentBindings(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  for (const scene of scenes) {
    if (!scene.components?.length) continue;
    const sceneTags = [...html.matchAll(
      /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
    )];
    const sceneIndex = sceneTags.findIndex((match) =>
      htmlAttr(match[0], "data-scene") === scene.id
    );
    if (sceneIndex < 0) continue;
    const scopeStart = sceneTags[sceneIndex]!.index;
    const scopeEnd = sceneTags[sceneIndex + 1]?.index ?? html.length;
    let scope = html.slice(scopeStart, scopeEnd);
    for (const component of scene.components) {
      const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)]
        .map((match) => match[0])
        .filter((tag) => htmlAttr(tag, "data-part") === component.id);
      if (!tags.length) {
        // The declared element is absent: try to bind an unambiguous
        // candidate the author left unlabeled instead of losing the attempt.
        const bound = bindMissingComponentElement(scope, component, scene.components);
        if (bound.repairs) {
          scope = bound.html;
          repairs += bound.repairs;
        }
        continue;
      }
      const canonicalOccurrence = Math.max(
        0,
        tags.findIndex((tag) => htmlAttr(tag, "data-component") === component.kind),
      );
      const needsRegion = Boolean(
        component.region &&
        !new RegExp(
          `\\bdata-region\\s*=\\s*(["'])${regexpEscape(component.region)}\\1`,
          "i",
        ).test(scope),
      );
      let occurrence = 0;
      let duplicate = 0;
      scope = scope.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
        if (htmlAttr(tag, "data-part") !== component.id) return tag;
        const isCanonical = occurrence === canonicalOccurrence;
        occurrence += 1;
        if (isCanonical) {
          let next = ensureTagAttr(tag, "data-component", component.kind);
          if (component.region && needsRegion) {
            next = ensureTagAttr(next, "data-region", component.region);
          }
          if (next !== tag) repairs += 1;
          return next;
        }
        duplicate += 1;
        repairs += 1;
        return ensureTagAttr(tag, "data-part", `${component.id}-aux-${duplicate}`);
      });
    }
    html = html.slice(0, scopeStart) + scope + html.slice(scopeEnd);
  }
  return { html, repairs };
}

type InternalPartAlias = {
  className: string;
  markup: (part: string, component: string) => string;
};

function internalPartAliasFor(
  kind: ComponentKind,
  part: string,
): InternalPartAlias | undefined {
  const tokens = new Set(semanticPartTokens(part));
  const namesInput = tokens.has("input") || tokens.has("query") || tokens.has("search");
  if (kind === "command-palette" && namesInput) {
    return {
      className: "cmp-input",
      markup: (alias, component) =>
        `<div class="cmp-input inset-well" data-part="${alias}" ` +
        `data-sequences-part-alias="${component}"><span class="cmp-text"></span></div>`,
    };
  }
  if (kind === "search" && (namesInput || tokens.has("pill"))) {
    return {
      className: "cmp-text",
      markup: (alias, component) =>
        `<span class="cmp-text" data-cmp-text data-part="${alias}" ` +
        `data-sequences-part-alias="${component}"></span>`,
    };
  }
  return undefined;
}

function scenePartBindingsFromContracts(scenes: DirectScene[]): ScenePartBinding[] {
  const bindings: ScenePartBinding[] = [];
  for (const cut of resolveCutPlan(scenes).cuts) {
    if (cut.focalPartOut) bindings.push({ sceneId: cut.fromScene, part: cut.focalPartOut });
    if (cut.focalPartIn) bindings.push({ sceneId: cut.toScene, part: cut.focalPartIn });
  }
  for (const scenePlan of resolveCameraPlan(scenes).scenes) {
    for (const segment of scenePlan.segments) {
      for (const part of [segment.fromPart, segment.toPart, segment.focus?.part]) {
        if (part) bindings.push({ sceneId: scenePlan.sceneId, part });
      }
    }
  }
  return [...new Map(bindings.map((entry) => [`${entry.sceneId}\u0000${entry.part}`, entry])).values()];
}

/**
 * Component roots and bridged cuts sometimes name different layers of the same
 * surface: e.g. `cmd-palette` is the command-palette root for component beats,
 * while `palette-input` is the shape-match focal element inside it. Once the
 * root is bound, materialize a known kit subpart for missing cut/camera aliases
 * instead of renaming the root back and breaking component beats.
 */
export function reconcileComponentInternalPartAliases(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const bindingsByScene = new Map<string, Set<string>>();
  for (const binding of scenePartBindingsFromContracts(scenes)) {
    const set = bindingsByScene.get(binding.sceneId) ?? new Set<string>();
    set.add(binding.part);
    bindingsByScene.set(binding.sceneId, set);
  }
  if (!bindingsByScene.size) return { html, repairs };

  for (const scene of scenes) {
    const desired = bindingsByScene.get(scene.id);
    if (!desired?.size || !scene.components?.length) continue;
    const scopeMeta = sceneScopeLocations(html).find((entry) => entry.id === scene.id);
    if (!scopeMeta) continue;
    let scope = html.slice(scopeMeta.openStart, scopeMeta.closeEnd);
    for (const part of desired) {
      if (new RegExp(`\\bdata-part\\s*=\\s*(["'])${regexpEscape(part)}\\1`, "i").test(scope)) {
        continue;
      }
      const candidates = scene.components.flatMap((component) => {
        if (component.id === part) return [];
        const alias = internalPartAliasFor(component.kind, part);
        if (!alias) return [];
        const rootPattern = new RegExp(
          `<([a-z][\\w:-]*)\\b[^>]*\\bdata-part\\s*=\\s*(["'])${
            regexpEscape(component.id)
          }\\2[^>]*>`,
          "gi",
        );
        const roots = [...scope.matchAll(rootPattern)];
        return roots.length === 1 ? [{ component, alias, root: roots[0]! }] : [];
      });
      if (candidates.length !== 1) continue;
      const { component, alias, root } = candidates[0]!;
      const rootOpen = root.index ?? 0;
      const close = matchingCloseTag(scope, rootOpen, root[0]);
      if (!close) continue;
      const body = scope.slice(close.contentStart, close.closeStart);
      const childPattern = new RegExp(
        `<[a-z][\\w:-]*\\b(?=[^>]*\\bclass\\s*=\\s*(["'])[^"']*\\b${
          regexpEscape(alias.className)
        }\\b[^"']*\\1)[^>]*>`,
        "i",
      );
      const child = childPattern.exec(body);
      if (child && !htmlAttr(child[0], "data-part")) {
        const childStart = close.contentStart + child.index;
        let replacement = ensureTagAttr(child[0], "data-part", part);
        replacement = ensureTagAttr(replacement, "data-sequences-part-alias", component.id);
        scope = scope.slice(0, childStart) + replacement +
          scope.slice(childStart + child[0].length);
        repairs += 1;
      } else {
        scope = scope.slice(0, close.contentStart) +
          `\n${alias.markup(part, component.id)}` +
          scope.slice(close.contentStart);
        repairs += 1;
      }
    }
    html = html.slice(0, scopeMeta.openStart) + scope + html.slice(scopeMeta.closeEnd);
  }
  return { html, repairs };
}

function rootDurationSec(source: string): number | undefined {
  const tag = source.match(/<[^>]+\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/is)?.[0];
  if (!tag) return undefined;
  const parsed = Number(htmlAttr(tag, "data-duration"));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cssCommentSafe(value: string): string {
  // `*/` would close the comment; `<`/`>` could smuggle `</style>` past the
  // HTML parser (a style element ends at the literal tag regardless of CSS
  // comment state); `$` is special in String.replace replacement strings.
  return value.replace(/\*\//g, "* /").replace(/[<>$]/g, "");
}

function safeContrastSelector(selector: string): boolean {
  return /^(?:#[A-Za-z_][\w-]*|[a-z][\w-]*(?:\.[A-Za-z_][\w-]*){1,3})$/.test(selector);
}

function safeCssColor(value: string | undefined): value is string {
  return typeof value === "string" &&
    /^rgb\(\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\s*,\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\s*,\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\s*\)$/i
      .test(value);
}

export function repairContrastAaIssues(
  draft: DirectCompositionDraft,
  browserQa: DirectBrowserQaResult,
): { draft: DirectCompositionDraft; repaired: string[] } {
  const bySelector = new Map<string, DirectLayoutIssue>();
  for (const issue of browserQa.issues ?? []) {
    if (
      issue.code !== "contrast_aa" ||
      !safeContrastSelector(issue.selector) ||
      !safeCssColor(issue.contrast?.suggestedColor)
    ) {
      continue;
    }
    const existing = bySelector.get(issue.selector);
    if (!existing || (issue.contrast?.ratio ?? 999) < (existing.contrast?.ratio ?? 999)) {
      bySelector.set(issue.selector, issue);
    }
  }
  if (!bySelector.size) return { draft, repaired: [] };

  const rules = [...bySelector.values()].map((issue) =>
    `${issue.selector}{color:${issue.contrast!.suggestedColor} !important;}` +
    `/* contrast ${issue.contrast!.ratio}:1 -> ${issue.contrast!.required}:1` +
    `${issue.text ? ` ${cssCommentSafe(issue.text.slice(0, 32))}` : ""} */`
  );
  const style = `<style data-sequences-contrast-repair>\n${rules.join("\n")}\n</style>`;
  let html = draft.html.replace(
    /\n?\s*<style\b[^>]*\bdata-sequences-contrast-repair\b[^>]*>[\s\S]*?<\/style>/gi,
    "",
  );
  // Function replacer: the style block carries audited on-screen text, and a
  // string replacement would interpret `$&`/`$'`-style patterns inside it.
  html = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, () => `${style}</head>`)
    : `${style}\n${html}`;
  return html === draft.html
    ? { draft, repaired: [] }
    : { draft: { ...draft, html }, repaired: [...bySelector.keys()] };
}

/** Coverage floor the sparse framing audit enforces (layoutInspector SPARSE_COVERAGE_MIN). */
const SPARSE_FRAMING_TARGET_COVERAGE = 0.18;
/** Never magnify a sparse landing past this fit multiplier (well under camera ZOOM_MAX 2.8). */
const SPARSE_FRAMING_ZOOM_MAX = 1.8;
/** A correction must clear the audit's 1.05 zoom-skip threshold to actually take effect. */
const SPARSE_FRAMING_ZOOM_FLOOR = 1.08;

/**
 * Choose the camera move a sparse finding should zoom in on. A finding that
 * names a station gets the LAST full move that lands on exactly that station; a
 * scene-level (`[data-scene]`) finding with no station gets the scene's last
 * targeted full move. `-1` = nothing bumpable (drift/hold-only or camera-less):
 * a storyboard zoom cannot invent content there, so the model / least-bad pick
 * keeps ownership.
 */
function pickSparseMoveIndex(
  path: CameraMoveIntentV1[],
  finding: { part?: string; region?: string },
): number {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const move = path[index]!;
    if (!CAMERA_FULL_MOVES.has(move.move)) continue;
    if (finding.part) {
      if (move.toPart === finding.part) return index;
    } else if (finding.region) {
      if (move.toRegion === finding.region) return index;
    } else if (move.toRegion || move.toPart) {
      return index;
    }
  }
  return -1;
}

/**
 * Deterministic L2-at-L4 framing correction (the camera analogue of
 * `repairContrastAaIssues`): browser QA measured a camera landing — or a
 * camera-less mid-window — as a tiny subject adrift, so raise its coverage to
 * the audit floor with a bounded zoom-in on exactly the move that frames it.
 * The zoom factor `sqrt(0.18 / fraction)` (clamped 1.0..1.8) magnifies the
 * measured coverage back toward the 18% floor without ever cropping past it.
 * Pure: returns the mutated storyboard + the scene ids corrected. The caller
 * re-injects the camera island from the mutated storyboard (the
 * `persistUpgradedStoryboard` seam cut-discovery uses), re-inspects, and adopts
 * the result ONLY when the sparse finding clears, no new `camera_framed_clipped`
 * appears, and the quality penalty strictly decreases (enhancement-never-veto).
 */
export function correctSparseFraming(
  storyboard: DirectScene[],
  browserQa: DirectBrowserQaResult,
): { storyboard: DirectScene[]; corrected: string[] } {
  // Smallest measured coverage per (scene, station) → one bump per framing move.
  const wanted = new Map<string, { fraction: number; part?: string; region?: string }>();
  for (const issue of browserQa.issues ?? []) {
    if (issue.code !== "camera_framed_sparse" || !issue.framing) continue;
    const { sceneId, fraction, part, region } = issue.framing;
    if (!(fraction > 0)) continue;
    const key = `${sceneId} ${part ?? ""} ${region ?? ""}`;
    const existing = wanted.get(key);
    if (!existing || fraction < existing.fraction) {
      wanted.set(key, { fraction, part, region });
    }
  }
  if (!wanted.size) return { storyboard, corrected: [] };

  const corrected: string[] = [];
  const mutated = storyboard.map((scene) => {
    const path = scene.camera?.path;
    if (!path?.length) return scene;
    const findings = [...wanted.entries()]
      .filter(([key]) => key.startsWith(`${scene.id} `))
      .map(([, value]) => value)
      .sort((a, b) => a.fraction - b.fraction);
    if (!findings.length) return scene;
    const nextPath = path.map((move) => ({ ...move }));
    let changed = false;
    for (const finding of findings) {
      const index = pickSparseMoveIndex(nextPath, finding);
      if (index < 0) continue;
      const move = nextPath[index]!;
      const factor = Math.min(
        Math.max(Math.sqrt(SPARSE_FRAMING_TARGET_COVERAGE / finding.fraction), 1),
        SPARSE_FRAMING_ZOOM_MAX,
      );
      if (factor <= 1.0001) continue;
      const base = move.zoom ?? 1;
      const nextZoom = Math.round(
        Math.min(
          Math.max(base * factor, SPARSE_FRAMING_ZOOM_FLOOR),
          SPARSE_FRAMING_ZOOM_MAX,
        ) * 1000,
      ) / 1000;
      if (nextZoom <= base + 0.0001) continue;
      move.zoom = nextZoom;
      changed = true;
    }
    if (!changed) return scene;
    corrected.push(scene.id);
    return { ...scene, camera: { ...scene.camera!, path: nextPath } };
  });
  return corrected.length ? { storyboard: mutated, corrected } : { storyboard, corrected: [] };
}

function decorativeLivenessName(value: string): boolean {
  return /(?:^|[#.\s_\[\]-])(?:accent-?)?(?:underline|rule|divider|hairline|bloom|glow|grain|vignette|keylight|atmosphere|ambient|decor(?:ation|ative)?|particle|spark|noise)(?:$|[#.\s_\[\]-])/i
    .test(value);
}

function livenessBeatCandidate(scope: string): { tag: string; index: number } | undefined {
  const blockedTag = /^(?:script|style|link|meta|main|section)$/i;
  const candidates = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)]
    .map((match) => {
      const tag = match[0];
      const tagName = tag.match(/^<([a-z][\w:-]*)\b/i)?.[1] ?? "";
      const id = htmlAttr(tag, "id") ?? "";
      const part = htmlAttr(tag, "data-part") ?? "";
      const className = htmlAttr(tag, "class") ?? "";
      let score = 0;
      if (part) score += 40;
      if (id) score += 24;
      if (/\bdata-layout-important\b/i.test(tag)) score += 18;
      if (/^(?:h1|h2|h3|p|button|li|article|aside)$/i.test(tagName)) score += 12;
      if (/\b(?:cmp|card|panel|metric|stat|row|item|title|headline|copy)\b/i.test(className)) {
        score += 8;
      }
      if (decorativeLivenessName(`${id} ${part} ${className}`)) score -= 100;
      return { tag, index: match.index ?? 0, score, tagName };
    })
    .filter((entry) =>
      entry.score > 0 &&
      !blockedTag.test(entry.tagName) &&
      !/\/\s*>$/.test(entry.tag) &&
      !/\b(?:data-scene|data-camera-world|data-camera-overlay|data-sequences-runtime-|aria-hidden\s*=\s*(["'])true\1)\b/i
        .test(entry.tag)
    )
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0] ? { tag: candidates[0].tag, index: candidates[0].index } : undefined;
}

function livenessBeatTimes(scene: DirectScene, count: number): number[] {
  if (count <= 0) return [];
  const fractions = count === 1
    ? [0.58]
    : Array.from({ length: count }, (_value, index) =>
      0.32 + (0.42 * index) / Math.max(1, count - 1)
    );
  return fractions.map((fraction) => {
    const min = scene.startSec + 0.12;
    const max = scene.startSec + Math.max(0.14, scene.durationSec - 0.12);
    return Math.round(Math.min(max, Math.max(min, scene.startSec + scene.durationSec * fraction)) * 1000) /
      1000;
  });
}

/**
 * Keep the liveness gate strict while recovering its most mechanical failure:
 * a short scene with visible authored content but no timed child beat. We mark
 * one real content element and add a tiny seek-safe transform/opacity beat at
 * an explicit timeline time; `validateMotionDensity` then re-runs unchanged.
 */
export function injectMissingLivenessBeats(
  source: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  const durationSec = rootDurationSec(source);
  if (durationSec === undefined) return { html: source, repaired: [] };
  const report = analyzeMotionDensity(source, scenes, durationSec);
  const needs = new Map<string, number>();
  for (const error of report.errors) {
    const match = error.match(
      /^motion\/liveness: scene "([^"]+)" has (\d+) authored component\/camera beat\(s\).*use at least (\d+) non-wrapper beat/,
    );
    if (!match) continue;
    const sceneId = match[1]!;
    const current = Number(match[2]);
    const minimum = Number(match[3]);
    if (Number.isFinite(current) && Number.isFinite(minimum) && minimum > current) {
      needs.set(sceneId, Math.max(needs.get(sceneId) ?? 0, minimum - current));
    }
  }
  if (!needs.size) return { html: source, repaired: [] };

  const timelineName = source.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
  )?.[1];
  if (!timelineName) return { html: source, repaired: [] };
  const registration = timelineRegistrationAnchor(timelineName);
  if (!registration.exec(source)) return { html: source, repaired: [] };

  let html = source;
  const tweens: string[] = [];
  const repaired: string[] = [];
  for (const scene of scenes) {
    const count = needs.get(scene.id) ?? 0;
    if (!count) continue;
    const scopeMeta = sceneScopeLocations(html).find((entry) => entry.id === scene.id);
    if (!scopeMeta) continue;
    let scope = html.slice(scopeMeta.openStart, scopeMeta.closeEnd);
    const selector = `[data-sequences-liveness-beat="${cssString(scene.id)}"]`;
    const selectorLiteral = JSON.stringify(selector);
    if (!new RegExp(`\\bdata-sequences-liveness-beat\\s*=\\s*(["'])${regexpEscape(scene.id)}\\1`, "i")
      .test(scope)) {
      const candidate = livenessBeatCandidate(scope);
      if (!candidate) continue;
      const replacement = ensureTagAttr(candidate.tag, "data-sequences-liveness-beat", scene.id);
      scope = scope.slice(0, candidate.index) + replacement +
        scope.slice(candidate.index + candidate.tag.length);
      html = html.slice(0, scopeMeta.openStart) + scope + html.slice(scopeMeta.closeEnd);
    }
    for (const atSec of livenessBeatTimes(scene, count)) {
      tweens.push(
        `${timelineName}.fromTo(${selectorLiteral}, { y: 16, opacity: 0.72, scale: 0.985 }, ` +
          `{ y: 0, opacity: 1, scale: 1, duration: 0.42, ease: "power3.out", ` +
          `immediateRender: false }, ${atSec});`,
      );
    }
    repaired.push(scene.id);
  }
  if (!tweens.length) return { html, repaired: [] };
  const updatedRegistration = registration.exec(html);
  if (!updatedRegistration) return { html, repaired: [] };
  html = html.slice(0, updatedRegistration.index) +
    tweens.join("\n") + "\n" +
    html.slice(updatedRegistration.index);
  return { html, repaired };
}

/**
 * The `window.__timelines[...] = <timeline>;` line every compile-call
 * injection anchors on. When the film ramps, the time-wrap step (the LAST
 * injection) rewrites that line to register the wrapped master, so on
 * re-entry (critic patches, cut-discovery upgrades) the anchor must also
 * match the wrapped form — the compile call is then inserted before the
 * whole wrap statement.
 */
function timelineRegistrationAnchor(timelineName: string): RegExp {
  const escaped = regexpEscape(timelineName);
  return new RegExp(
    `((?:var\\s+__seqWarped\\s*=\\s*SequencesTime\\.wrap\\(${escaped}\\);\\s*)?` +
      `window\\.__timelines\\s*\\[[^\\]]+\\]\\s*=\\s*(?:${escaped}|__seqWarped)\\s*;)`,
  );
}

/**
 * The five runtime `.js` files the host stages next to the composition and
 * references with a real `<script src>`; every other `sequences-*.vN.(js|css)`
 * is a kit the host injects INLINE (`sequences-cinema.v1.css`,
 * `sequences-components.v1.css`) or does not exist at all.
 */
const HOST_STAGED_RUNTIME_FILES = new Set<string>([
  INTERACTION_RUNTIME_FILE,
  CUT_RUNTIME_FILE,
  CAMERA_RUNTIME_FILE,
  COMPONENT_RUNTIME_FILE,
  TIME_RUNTIME_FILE,
  FX_RUNTIME_FILE,
]);

/**
 * Strip author `<script src>`/`<link href>` references to host-owned kit assets
 * the host injects inline (the CSS kits) or that never exist (the recurring
 * `sequences-cinema.v1.js` hallucination — the cinema kit is CSS-only, so the
 * model invents a `.v1.js` sibling of the real component/camera runtimes). Such
 * a reference resolves to a missing staged file and fails the whole build with
 * `referenced local asset does not exist`; it is never valid, so removing it is
 * mechanical paperwork recovery, not a content change. The five genuinely
 * staged runtime `.js` files are preserved.
 */
export function stripHostKitAssetReferences(source: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  const isSpuriousKitRef = (ref: string): boolean => {
    const base = ref.replace(/^\\+|\\+$/g, "").split(/[?#]/, 1)[0]!.split(/[\\/]/).pop() ?? "";
    if (!/^sequences-[\w.-]+\.v\d+\.(?:js|css)$/i.test(base)) return false;
    return !HOST_STAGED_RUNTIME_FILES.has(base);
  };
  const html = source
    .replace(
      /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>\s*<\/script>/gi,
      (tag, _quote, ref: string) => {
        if (!isSpuriousKitRef(ref)) return tag;
        removed.push(ref);
        return "";
      },
    )
    .replace(
      /<link\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi,
      (tag, _quote, ref: string) => {
        if (!isSpuriousKitRef(ref)) return tag;
        removed.push(ref);
        return "";
      },
    );
  return { html, removed };
}

/** Each host runtime `.js` file paired with the global its `<script src>` defines. */
const RUNTIME_SCRIPT_GLOBALS: ReadonlyArray<{ file: string; global: string }> = [
  { file: INTERACTION_RUNTIME_FILE, global: "SequencesInteractions" },
  { file: CUT_RUNTIME_FILE, global: "SequencesCuts" },
  { file: CAMERA_RUNTIME_FILE, global: "SequencesCamera" },
  { file: COMPONENT_RUNTIME_FILE, global: "SequencesComponents" },
  { file: TIME_RUNTIME_FILE, global: "SequencesTime" },
  { file: FX_RUNTIME_FILE, global: "SequencesFx" },
];

/** Match a runtime `<script src="…vN.js">` tag plus one leading newline/indent (so
 * removal-then-reinsert is byte-idempotent). */
function runtimeScriptTagSource(file: string): string {
  return (
    `\\n?[ \\t]*<script\\b[^>]*\\bsrc\\s*=\\s*(["'])${regexpEscape(file)}\\1[^>]*>\\s*<\\/script>`
  );
}

/**
 * Guarantee that every host runtime whose global an inline script uses is loaded
 * by a real `<script src>` that runs BEFORE that inline script.
 *
 * The five per-runtime injectors above each anchor their `<script src>` on the
 * host GSAP tag and are individually *idempotent* (`if the tag is already
 * present, skip`). That means a runtime tag the AUTHOR wrote in the wrong place —
 * after the inline timeline `<script>`, or before GSAP — is left mis-ordered, and
 * the compile call (injected on a *different* anchor, the timeline registration)
 * then executes against an undefined global: `SequencesInteractions is not
 * defined`, an opaque browser bind failure that burns a paid repair attempt and
 * can end in the deterministic fallback. This normalizes all five deterministically:
 * any present-or-referenced runtime `<script src>` is collapsed to a single tag,
 * in canonical order, in one contiguous block immediately after the GSAP tag
 * (runtimes load after GSAP — which they may depend on — and before the
 * composition's inline timeline). A referenced-but-missing runtime is injected.
 *
 * No-op and byte-idempotent for an already-correct composition. If the GSAP tag
 * is absent there is no safe anchor and static validation already rejects the
 * draft, so we leave it untouched.
 */
export function ensureRuntimeScriptOrdering(source: string): { html: string; changed: boolean } {
  const gsapPattern = /<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\1[^>]*>\s*<\/script>/i;
  if (!gsapPattern.test(source)) return { html: source, changed: false };

  // Inline (executed) script bodies only — exclude `src` scripts and JSON islands,
  // whose plan payloads never contain a runtime global name.
  const inlineBlob = [
    ...source.matchAll(
      /<script\b(?![^>]*\bsrc\s*=)(?![^>]*\btype\s*=\s*(["'])application\/json\1)[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((match) => match[2] ?? "")
    .join("\n");

  const needed = RUNTIME_SCRIPT_GLOBALS.filter(
    ({ file, global }) =>
      new RegExp(runtimeScriptTagSource(file), "i").test(source) ||
      new RegExp(`\\b${regexpEscape(global)}\\b`).test(inlineBlob),
  ).map((entry) => entry.file);
  if (!needed.length) return { html: source, changed: false };

  // Strip every existing runtime tag (any count, any position) …
  let html = source;
  for (const { file } of RUNTIME_SCRIPT_GLOBALS) {
    html = html.replace(new RegExp(runtimeScriptTagSource(file), "gi"), "");
  }
  // … then re-insert exactly one tag per needed runtime, canonical order, after GSAP.
  const anchor = gsapPattern.exec(html);
  if (!anchor) return { html: source, changed: false };
  const insertAt = anchor.index + anchor[0].length;
  const block = needed.map((file) => `\n<script src="${file}"></script>`).join("");
  const rebuilt = html.slice(0, insertAt) + block + html.slice(insertAt);
  return { html: rebuilt, changed: rebuilt !== source };
}

/**
 * `.fromTo(target, vars, <number>)` is never valid GSAP — fromTo takes
 * (target, fromVars, toVars, position). When the model omits toVars, GSAP
 * receives the position NUMBER as the to-object and the compile throws
 * "Cannot create property 'parent' on number '…'" — a runtime_bind_exception
 * (and the whole paid attempt) spent on a call-shape typo (the
 * sentinel-s5-interactions probe class, 2026-07-06). The remaining vars do not
 * reveal which object was omitted. The only safe rewrite currently proven is
 * `.to`: visible/settled vars after the same selector was explicitly initialized
 * to an opposite state. Hidden/off-position could be either an entrance `.from`
 * or an exit `.to`, so it stays blocking too. Only a string-literal target and
 * a flat vars object are considered.
 */
export function repairMalformedFromToCalls(
  source: string,
): { html: string; repairs: number; fromRepairs: number; toRepairs: number; ambiguous: number } {
  let repairs = 0;
  let fromRepairs = 0;
  let toRepairs = 0;
  let ambiguous = 0;
  const classifyState = (vars: string): "from" | "to" | undefined => {
    const cues: Array<"from" | "to"> = [];
    const body = vars.slice(1, -1);
    const numericCue = (
      property: string,
      classify: (value: number) => "from" | "to" | undefined,
    ): void => {
      const match = new RegExp(`(?:^|[,\\s])${property}\\s*:\\s*(-?\\d*\\.?\\d+)`, "i")
        .exec(body);
      if (!match) return;
      const cue = classify(Number(match[1]));
      if (cue) cues.push(cue);
    };
    numericCue("(?:opacity|autoAlpha)", (value) =>
      value <= 0.05 ? "from" : value >= 0.95 ? "to" : undefined
    );
    for (const property of ["scale", "scaleX", "scaleY"]) {
      numericCue(property, (value) =>
        Math.abs(value - 1) <= 0.02 ? "to" : Math.abs(value - 1) >= 0.08 ? "from" : undefined
      );
    }
    for (const property of ["x", "y", "xPercent", "yPercent", "rotation", "rotationX", "rotationY"]) {
      numericCue(property, (value) =>
        Math.abs(value) <= 0.01 ? "to" : Math.abs(value) >= 1 ? "from" : undefined
      );
    }
    const visibility = /(?:^|[,\s])visibility\s*:\s*["'](visible|hidden)["']/i.exec(body)
      ?.[1]?.toLowerCase();
    if (visibility) cues.push(visibility === "visible" ? "to" : "from");
    const display = /(?:^|[,\s])display\s*:\s*["']([^"']+)["']/i.exec(body)
      ?.[1]?.toLowerCase();
    if (display) cues.push(display === "none" ? "from" : "to");
    return cues.length && cues.every((cue) => cue === cues[0]) ? cues[0] : undefined;
  };
  const pattern =
    /\.fromTo\(\s*((["'])(?:\\.|(?!\2).)*\2)\s*,\s*(\{[^{}]*\})\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
  const html = source.replace(
    pattern,
    (
      _match,
      target: string,
      _quote: string,
      vars: string,
      position: string,
      offset: number,
    ) => {
      const state = classifyState(vars);
      let direction: "from" | "to" | undefined;
      if (state === "to") {
        // A settled state is safe as `.to` only when this same selector was
        // explicitly initialized earlier to an opposite state. This is the
        // exact s5 failure shape; a lone opacity:1 object remains ambiguous.
        const before = source.slice(0, offset);
        const escapedTarget = regexpEscape(target);
        const candidates: Array<{ index: number; vars: string }> = [];
        for (const match of before.matchAll(
          new RegExp(`\\.(?:set|to)\\(\\s*${escapedTarget}\\s*,\\s*(\\{[^{}]*\\})`, "g"),
        )) {
          candidates.push({ index: match.index, vars: match[1]! });
        }
        for (const match of before.matchAll(
          new RegExp(
            `\\.fromTo\\(\\s*${escapedTarget}\\s*,\\s*\\{[^{}]*\\}\\s*,\\s*(\\{[^{}]*\\})`,
            "g",
          ),
        )) {
          candidates.push({ index: match.index, vars: match[1]! });
        }
        const prior = candidates.sort((a, b) => b.index - a.index)[0];
        if (prior && classifyState(prior.vars) === "from") direction = "to";
      }
      if (!direction) {
        ambiguous += 1;
        return _match;
      }
      repairs += 1;
      if (direction === "from") fromRepairs += 1;
      else toRepairs += 1;
      return `.${direction}(${target}, ${vars}, ${position})`;
    },
  );
  return { html, repairs, fromRepairs, toRepairs, ambiguous };
}

export function applyDeterministicSourceRepairs(
  draft: DirectCompositionDraft,
  projectDir: string,
  lockedStoryboard?: DirectScene[],
): DirectCompositionDraft {
  let html = draft.html;
  const visibilityTweens = normalizeGsapDisplayVisibilityTweens(html);
  if (visibilityTweens.repairs) {
    html = visibilityTweens.html;
    process.stderr.write(
      `[author] normalized ${visibilityTweens.repairs} GSAP display/visibility tween(s)\n`,
    );
  }
  const fromToShape = repairMalformedFromToCalls(html);
  if (fromToShape.repairs) {
    html = fromToShape.html;
    recordSentinelNormalization("gsap-call-shape", fromToShape.repairs);
    process.stderr.write(
      `[author] rewrote ${fromToShape.repairs} malformed fromTo(target, vars, <position>) ` +
        `call(s) (${fromToShape.fromRepairs} to from, ${fromToShape.toRepairs} to to) — ` +
        `a missing vars object crashes GSAP compile\n`,
    );
  }
  if (fromToShape.ambiguous) {
    process.stderr.write(
      `[author] left ${fromToShape.ambiguous} malformed fromTo call(s) blocking because ` +
        `their intended from/to direction is ambiguous\n`,
    );
  }
  if (lockedStoryboard?.length) {
    const authoredScenes = [...html.matchAll(
      /<([a-z][\w:-]*)\b[^>]*\bdata-scene(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/gis,
    )].map((match) => {
      const tag = match[0];
      const id = htmlAttr(tag, "id") ?? "";
      return {
        id,
        scene: htmlAttr(tag, "data-scene") ?? id,
        startSec: Number(htmlAttr(tag, "data-start")),
        durationSec: Number(htmlAttr(tag, "data-duration")),
      };
    });
    let repairedIds = 0;
    for (const expected of lockedStoryboard) {
      const matches = authoredScenes.filter((scene) =>
        Math.abs(scene.startSec - expected.startSec) <= 0.01 &&
        Math.abs(scene.durationSec - expected.durationSec) <= 0.01
      );
      if (matches.length !== 1) continue;
      const authored = matches[0]!;
      for (const current of new Set([authored.id, authored.scene])) {
        if (!current || current === expected.id) continue;
        html = html.replaceAll(current, expected.id);
        repairedIds += 1;
      }
    }
    if (repairedIds) {
      process.stderr.write(
        `[author] reconciled ${repairedIds} scene id reference(s) to the locked storyboard\n`,
      );
    }
  }
  let removedFontFaces = 0;
  html = html.replace(/@font-face\s*\{[^{}]*\}/gi, (block) => {
    const refs = [...block.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)]
      .map((match) => match[2]!.trim());
    const invalid = refs.some((ref) => {
      if (/^data:/i.test(ref)) {
        return /^data:font\/[^;,]+;base64,\s*$/i.test(ref);
      }
      if (/^(?:https?:)?\/\//i.test(ref)) return true;
      const clean = ref.split(/[?#]/, 1)[0]!;
      const fromProject = path.resolve(projectDir, clean);
      const fromComposition = path.resolve(projectDir, "composition", clean);
      return !fs.existsSync(fromProject) && !fs.existsSync(fromComposition);
    });
    if (!invalid) return block;
    removedFontFaces += 1;
    return "";
  });
  if (removedFontFaces) {
    process.stderr.write(
      `[author] removed ${removedFontFaces} unavailable or empty @font-face declaration(s)\n`,
    );
  }
  const strippedKitRefs = stripHostKitAssetReferences(html);
  if (strippedKitRefs.removed.length) {
    html = strippedKitRefs.html;
    process.stderr.write(
      `[author] stripped ${strippedKitRefs.removed.length} spurious host-kit asset ` +
        `reference(s) — the host injects these inline: ` +
        `${[...new Set(strippedKitRefs.removed)].join(", ")}\n`,
    );
  }
  if (/\bMath\.random\s*\(\s*\)/.test(html)) {
    const generator = [
      "let __sequencesSeed = 0x6d2b79f5;",
      "const __sequencesRandom = () => {",
      "  __sequencesSeed = (__sequencesSeed * 1664525 + 1013904223) >>> 0;",
      "  return __sequencesSeed / 4294967296;",
      "};",
    ].join("\n");
    html = html
      .replace(/\bMath\.random\s*\(\s*\)/g, "__sequencesRandom()")
      .replace(
        /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i,
        (tag) => `${tag}\n${generator}`,
      );
    process.stderr.write(
      "[author] deterministically replaced Math.random() with a fixed seeded PRNG\n",
    );
  }
  const compositionId = html.match(
    /<[^>]+\bdata-composition-id\s*=\s*(["'])(.*?)\1[^>]*>/is,
  )?.[2];
  if (compositionId) {
    const escapedId = compositionId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const normalized = html.replace(
      /window\.__timelines\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*=\s*([^;]+);/g,
      `window.__timelines["${escapedId}"] = $1;`,
    );
    if (normalized !== html) {
      html = normalized;
      process.stderr.write(
        "[author] normalized computed timeline registration to the canonical composition id\n",
      );
    }
  }
  {
    // Host plan islands are host-owned, always: delete every model-authored
    // island unconditionally so the per-plan injection below is the single
    // authority. A shadow island can no longer reach validation, and after the
    // prompt stopped teaching island syntax this strips nothing on a clean run.
    const strippedPlans = stripAllHostPlanIslands(html);
    if (strippedPlans.removed.length) {
      html = strippedPlans.html;
      // Count only genuinely model-authored islands (no host marker); islands
      // the host injected on an earlier pass re-strip as routine plumbing.
      recordSentinelNormalization("island-strip", strippedPlans.removedModel.length);
      const modelAuthored = strippedPlans.removedModel.length;
      process.stderr.write(
        `[author] stripped ${strippedPlans.removed.length} host plan island(s) ` +
          `(${modelAuthored} model-authored, re-injected canonically): ` +
          `${[...new Set(strippedPlans.removed)].join(", ")}\n`,
      );
    }
  }
  {
    const layoutHints = injectLayoutIntentHints(html, lockedStoryboard ?? draft.storyboard);
    if (layoutHints.repaired.length) {
      html = layoutHints.html;
      recordSentinelNormalization("layout-intent", layoutHints.repaired.length);
      process.stderr.write(
        `[author] injected minimal layout intent hint(s) for scene(s): ` +
          `${layoutHints.repaired.join(", ")}\n`,
      );
    }
  }
  const interactions = lockedStoryboard?.flatMap((scene) => scene.interactions ?? []) ?? [];
  if (interactions.length) {
    let repairedBindings = 0;
    const targets = reconcileInteractionTargets(html, interactions);
    html = targets.html;
    repairedBindings += targets.repairs;
    const actors = normalizeInteractionActors(html, interactions);
    html = actors.html;
    repairedBindings += actors.repairs;
    if (
      !html.includes(`src="${INTERACTION_RUNTIME_FILE}"`) &&
      !html.includes(`src='${INTERACTION_RUNTIME_FILE}'`)
    ) {
      html = html.replace(
        /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
        `$1\n<script src="${INTERACTION_RUNTIME_FILE}"></script>`,
      );
      repairedBindings += 1;
    }
    const payload = JSON.stringify({ version: 1, interactions });
    const normalizedIsland = normalizeJsonIsland(html, "sequences-interactions", payload);
    if (normalizedIsland.found) {
      html = normalizedIsland.html;
      repairedBindings += normalizedIsland.repairs;
    } else {
      const timelineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
      if (timelineScript?.index !== undefined) {
        html = html.slice(0, timelineScript.index) +
          `<script type="application/json" data-sequences-host="1" id="sequences-interactions">${payload}</script>\n` +
          html.slice(timelineScript.index);
        repairedBindings += 1;
      }
    }
    const islandPattern =
      /(<script\b[^>]*\bid\s*=\s*(["'])sequences-interactions\2[^>]*>)([\s\S]*?)(<\/script>)/i;
    const timelineName = html.match(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
    )?.[1];
    if (timelineName) {
      const compileWithInlinePlan = new RegExp(
        `(SequencesInteractions\\.compile\\(\\s*${regexpEscape(timelineName)}\\s*,\\s*` +
          `[A-Za-z_$][\\w$]*\\s*),\\s*[A-Za-z_$][\\w$]*\\s*\\)`,
        "g",
      );
      const normalizedCompile = html.replace(compileWithInlinePlan, "$1)");
      if (normalizedCompile !== html) {
        html = normalizedCompile;
        repairedBindings += 1;
      }
    }
    const island = islandPattern.exec(html);
    const timelineScript =
      /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
    if (
      island?.index !== undefined &&
      timelineScript?.index !== undefined &&
      island.index > timelineScript.index
    ) {
      const islandSource = island[0];
      html = html.slice(0, island.index) +
        html.slice(island.index + islandSource.length);
      const insertion = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i
        .exec(html)?.index;
      if (insertion !== undefined) {
        html = html.slice(0, insertion) + islandSource + "\n" + html.slice(insertion);
        repairedBindings += 1;
      }
    }
    if (!/\bSequencesInteractions\.compile\s*\(/.test(html)) {
      if (timelineName) {
        const registration = timelineRegistrationAnchor(timelineName);
        if (registration.test(html)) {
          html = html.replace(
            registration,
            `SequencesInteractions.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
          );
          repairedBindings += 1;
        }
      }
    }
    if (repairedBindings) {
      recordSentinelNormalization("interaction-binding", repairedBindings);
      process.stderr.write(
        `[author] normalized ${repairedBindings} deterministic interaction binding(s)\n`,
      );
    }
  }
  // Cut focal parts and camera stations/parts get the same mechanical
  // reconciliation as interaction targets: an unambiguous near-miss (exact id,
  // unique semantic candidate, or an unannotated exact-name element) is fixed
  // here instead of consuming a paid repair attempt on binding paperwork.
  {
    const contractBindings = reconcileContractBindings(
      html,
      lockedStoryboard ?? draft.storyboard,
    );
    if (contractBindings.repairs) {
      html = contractBindings.html;
      recordSentinelNormalization("contract-binding", contractBindings.repairs);
      recordSentinelScaffoldRestoration("l2-normalize", contractBindings.regionRepairs);
      process.stderr.write(
        `[author] reconciled ${contractBindings.repairs} cut/camera contract binding(s)\n`,
      );
    }
  }
  {
    const cameraWorlds = reconcileCameraWorldPlanes(html, lockedStoryboard ?? draft.storyboard);
    if (cameraWorlds.repairs) {
      html = cameraWorlds.html;
      recordSentinelNormalization("camera-world-plane", cameraWorlds.repairs);
      recordSentinelScaffoldRestoration("l2-normalize", cameraWorlds.repairs);
      process.stderr.write(
        `[author] wrapped ${cameraWorlds.repairs} scene(s) in deterministic camera world plane(s)\n`,
      );
    }
  }
  {
    const componentBindings = reconcileComponentBindings(
      html,
      lockedStoryboard ?? draft.storyboard,
    );
    if (componentBindings.repairs) {
      html = componentBindings.html;
      recordSentinelNormalization("component-binding", componentBindings.repairs);
      recordSentinelScaffoldRestoration("l2-normalize", componentBindings.repairs);
      process.stderr.write(
        `[author] reconciled ${componentBindings.repairs} component binding(s)\n`,
      );
    }
  }
  {
    const componentAliases = reconcileComponentInternalPartAliases(
      html,
      lockedStoryboard ?? draft.storyboard,
    );
    if (componentAliases.repairs) {
      html = componentAliases.html;
      recordSentinelNormalization("component-alias", componentAliases.repairs);
      process.stderr.write(
        `[author] materialized ${componentAliases.repairs} component-internal cut/camera alias part(s)\n`,
      );
    }
  }
  // A rows beat with nothing to reveal is mechanically recoverable paperwork:
  // the kit owns component structure, so childless rows targets get neutral
  // kit children injected instead of consuming a paid repair attempt.
  {
    const rowsTopUp = topUpRowsMarkup(html, lockedStoryboard ?? draft.storyboard);
    if (rowsTopUp.repaired.length) {
      html = rowsTopUp.html;
      process.stderr.write(
        `[author] injected neutral revealable children for childless rows target(s): ` +
          `${rowsTopUp.repaired.join(", ")}\n`,
      );
    }
  }
  // MD3 underline paperwork: a style:"underline" highlight draws the kit
  // `.fx-underline` SVG; inject it when the author left the slot empty so the
  // paid attempt never dies on fx markup (enhancement-only, like rows).
  {
    const underlineTopUp = topUpUnderlineMarkup(html, lockedStoryboard ?? draft.storyboard);
    if (underlineTopUp.repaired.length) {
      html = underlineTopUp.html;
      process.stderr.write(
        `[author] injected kit fx-underline markup for highlight underline target(s): ` +
          `${underlineTopUp.repaired.join(", ")}\n`,
      );
    }
  }
  // Typed cuts are compiled by a host-owned runtime, so their bindings are
  // injected deterministically from the storyboard: the author never spends
  // output budget on boundary mechanics and can never silently drop a cut.
  const cutPlan = resolveCutPlan(lockedStoryboard ?? draft.storyboard);
  if (cutPlan.cuts.length) {
    let repairedCuts = 0;
    if (
      !html.includes(`src="${CUT_RUNTIME_FILE}"`) &&
      !html.includes(`src='${CUT_RUNTIME_FILE}'`)
    ) {
      const withRuntime = html.replace(
        /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
        `$1\n<script src="${CUT_RUNTIME_FILE}"></script>`,
      );
      if (withRuntime !== html) {
        html = withRuntime;
        repairedCuts += 1;
      }
    }
    const payload = JSON.stringify(cutPlan);
    const cutIslandPattern =
      /(<script\b[^>]*\bid\s*=\s*(["'])sequences-cuts\2[^>]*>)([\s\S]*?)(<\/script>)/i;
    if (cutIslandPattern.test(html)) {
      const updated = html.replace(cutIslandPattern, `$1${payload}$4`);
      if (updated !== html) {
        html = updated;
        repairedCuts += 1;
      }
    } else {
      const timelineScript =
        /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
      if (timelineScript?.index !== undefined) {
        html = html.slice(0, timelineScript.index) +
          `<script type="application/json" data-sequences-host="1" id="sequences-cuts">${payload}</script>\n` +
          html.slice(timelineScript.index);
        repairedCuts += 1;
      }
    }
    if (!/\bSequencesCuts\.compile\s*\(/.test(html)) {
      const timelineName = html.match(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
      )?.[1];
      if (timelineName) {
        const registration = timelineRegistrationAnchor(timelineName);
        if (registration.test(html)) {
          html = html.replace(
            registration,
            `SequencesCuts.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
          );
          repairedCuts += 1;
        }
      }
    }
    if (repairedCuts) {
      process.stderr.write(
        `[author] injected ${repairedCuts} deterministic cut binding(s) for ` +
          `${cutPlan.cuts.length} typed boundary cut(s)\n`,
      );
    }
  }
  // The camera rig runtime registers the curated motion-graphics ease library
  // (seqSwoosh, seqWhip, seqImpulse, …) at script load, so it is injected into
  // every composition — authored beats may cite those eases even when no scene
  // declares a typed camera path.
  {
    const withRuntime = injectCameraRuntimeTag(html);
    if (withRuntime !== html) {
      html = withRuntime;
      process.stderr.write(
        `[author] injected camera/ease runtime ${CAMERA_RUNTIME_FILE}\n`,
      );
    }
  }
  // Typed camera paths are compiled by the host-owned camera rig, so their
  // bindings are injected deterministically from the storyboard: the author
  // never spends output budget on camera mechanics and can never silently
  // drop a planned camera move.
  const cameraPlan = resolveCameraPlan(lockedStoryboard ?? draft.storyboard);
  if (cameraPlan.scenes.length) {
    let repairedCamera = 0;
    const payload = JSON.stringify(cameraPlan);
    const cameraIslandPattern =
      /(<script\b[^>]*\bid\s*=\s*(["'])sequences-camera\2[^>]*>)([\s\S]*?)(<\/script>)/i;
    if (cameraIslandPattern.test(html)) {
      const updated = html.replace(cameraIslandPattern, `$1${payload}$4`);
      if (updated !== html) {
        html = updated;
        repairedCamera += 1;
      }
    } else {
      const timelineScript =
        /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
      if (timelineScript?.index !== undefined) {
        html = html.slice(0, timelineScript.index) +
          `<script type="application/json" data-sequences-host="1" id="sequences-camera">${payload}</script>\n` +
          html.slice(timelineScript.index);
        repairedCamera += 1;
      }
    }
    if (!/\bSequencesCamera\.compile\s*\(/.test(html)) {
      const timelineName = html.match(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
      )?.[1];
      if (timelineName) {
        const registration = timelineRegistrationAnchor(timelineName);
        if (registration.test(html)) {
          html = html.replace(
            registration,
            `SequencesCamera.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
          );
          repairedCamera += 1;
        }
      }
    }
    if (repairedCamera) {
      process.stderr.write(
        `[author] injected ${repairedCamera} deterministic camera binding(s) for ` +
          `${cameraPlan.scenes.length} scene camera path(s)\n`,
      );
    }
  }
  // Typed component beats are compiled by the host-owned component runtime,
  // so their bindings are injected deterministically from the locked
  // storyboard: the author never spends output budget on state mechanics and
  // can never silently drop a planned beat.
  {
    const componentBindings = reconcileComponentBindings(
      html,
      lockedStoryboard ?? draft.storyboard,
    );
    if (componentBindings.repairs) {
      html = componentBindings.html;
      recordSentinelNormalization("component-binding", componentBindings.repairs);
      recordSentinelScaffoldRestoration("l2-normalize", componentBindings.repairs);
      process.stderr.write(
        `[author] reconciled ${componentBindings.repairs} component binding(s)\n`,
      );
    }
  }
  const componentPlan = resolveComponentPlan(lockedStoryboard ?? draft.storyboard);
  if (componentPlan.scenes.length) {
    let repairedComponents = 0;
    const withRuntime = injectComponentRuntimeTag(html);
    if (withRuntime !== html) {
      html = withRuntime;
      repairedComponents += 1;
    }
    const payload = JSON.stringify(componentPlan);
    const componentIslandPattern =
      /(<script\b[^>]*\bid\s*=\s*(["'])sequences-components\2[^>]*>)([\s\S]*?)(<\/script>)/i;
    if (componentIslandPattern.test(html)) {
      const updated = html.replace(componentIslandPattern, `$1${payload}$4`);
      if (updated !== html) {
        html = updated;
        repairedComponents += 1;
      }
    } else {
      const timelineScript =
        /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
      if (timelineScript?.index !== undefined) {
        html = html.slice(0, timelineScript.index) +
          `<script type="application/json" data-sequences-host="1" id="sequences-components">${payload}</script>\n` +
          html.slice(timelineScript.index);
        repairedComponents += 1;
      }
    }
    if (!/\bSequencesComponents\.compile\s*\(/.test(html)) {
      const timelineName = html.match(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
      )?.[1];
      if (timelineName) {
        const registration = timelineRegistrationAnchor(timelineName);
        if (registration.test(html)) {
          html = html.replace(
            registration,
            `SequencesComponents.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
          );
          repairedComponents += 1;
        }
      }
    }
    if (repairedComponents) {
      process.stderr.write(
        `[author] injected ${repairedComponents} deterministic component binding(s) for ` +
          `${componentPlan.scenes.reduce((count, scene) => count + scene.beats.length, 0)} typed beat(s)\n`,
      );
    }
  }
  // The FX plan (MD2) is host-derived garnish — sweeps at payoffs, glow
  // pulses, connector draws — injected exactly like the other contracts and
  // BEFORE the time-wrap (which must stay the last injection).
  {
    const fxPlan = resolveFxPlan(lockedStoryboard ?? draft.storyboard);
    if (fxPlan.effects.length) {
      let repairedFx = 0;
      if (
        !html.includes(`src="${FX_RUNTIME_FILE}"`) &&
        !html.includes(`src='${FX_RUNTIME_FILE}'`)
      ) {
        const withRuntime = html.replace(
          /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
          `$1\n<script src="${FX_RUNTIME_FILE}"></script>`,
        );
        if (withRuntime !== html) {
          html = withRuntime;
          repairedFx += 1;
        }
      }
      const payload = JSON.stringify(fxPlan);
      const fxIslandPattern =
        /(<script\b[^>]*\bid\s*=\s*(["'])sequences-fx\2[^>]*>)([\s\S]*?)(<\/script>)/i;
      if (fxIslandPattern.test(html)) {
        const updated = html.replace(fxIslandPattern, `$1${payload}$4`);
        if (updated !== html) {
          html = updated;
          repairedFx += 1;
        }
      } else {
        const timelineScript =
          /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
        if (timelineScript?.index !== undefined) {
          html = html.slice(0, timelineScript.index) +
            `<script type="application/json" data-sequences-host="1" id="sequences-fx">${payload}</script>\n` +
            html.slice(timelineScript.index);
          repairedFx += 1;
        }
      }
      if (!/\bSequencesFx\.compile\s*\(/.test(html)) {
        const timelineName = html.match(
          /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
        )?.[1];
        if (timelineName) {
          const registration = timelineRegistrationAnchor(timelineName);
          if (registration.test(html)) {
            html = html.replace(
              registration,
              `SequencesFx.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
            );
            repairedFx += 1;
          }
        }
      }
      if (repairedFx) {
        process.stderr.write(
          `[author] injected ${repairedFx} deterministic fx binding(s) for ` +
            `${fxPlan.effects.length} host-derived effect(s)\n`,
        );
      }
    }
  }
  // Declared library recipes are the sixth host-owned contract (Recipe
  // Studio, Level-1 instantiation): the proven fragment markup/style/motion
  // is stripped and re-injected VERBATIM from the library on every pass, so
  // the author model can never edit the mechanism — only author around it.
  // Runs after the contract islands (tween order on a paused timeline is
  // irrelevant) and BEFORE the time-wrap rewrite, which must stay LAST.
  if (recipesEnabled()) {
    const recipeInjection = injectRecipeContract(
      html,
      lockedStoryboard ?? draft.storyboard,
    );
    if (recipeInjection.html !== html) {
      html = recipeInjection.html;
      recordSentinelNormalization("recipe-inject", recipeInjection.injected.length || 1);
      process.stderr.write(
        `[author] injected ${recipeInjection.injected.length} host-instantiated ` +
          `recipe fragment(s): ${recipeInjection.injected.join(", ")}\n`,
      );
    }
  }
  {
    const liveness = injectMissingLivenessBeats(html, lockedStoryboard ?? draft.storyboard);
    if (liveness.repaired.length) {
      html = liveness.html;
      process.stderr.write(
        `[author] injected deterministic liveness beat(s) for slide-like scene(s): ` +
          `${liveness.repaired.join(", ")}\n`,
      );
    }
  }
  // The component kit (SaaS surfaces: windows, search, tables, charts, chat,
  // toasts …) is host-owned static CSS like the cinematography kit. Injecting
  // it inline means kit markup always resolves — components cost the author
  // structure, not styling budget.
  {
    const withKit = injectComponentKit(html);
    if (withKit !== html) {
      html = withKit;
      process.stderr.write(
        `[author] injected host component kit ${COMPONENT_KIT_FILE} v${COMPONENT_KIT_VERSION}\n`,
      );
    }
  }
  // The cinematography kit (grain/vignette, key lights, materials, grades) is
  // host-owned static CSS. Injecting it inline means every live film gets the
  // baseline filmic floor and the author's kit classes always resolve.
  {
    const withKit = injectCinemaKit(html);
    if (withKit !== html) {
      html = withKit;
      process.stderr.write(
        `[author] injected host cinematography kit ${CINEMA_KIT_FILE} v${CINEMA_KIT_VERSION}\n`,
      );
    }
  }
  if (readFrameMeta(projectDir)?.basis === "light" && !/\bcinema-light\b/.test(html)) {
    const rootTag = /<[a-z][\w:-]*\b[^>]*\bdata-composition-id\s*=[^>]*>/i.exec(html);
    if (rootTag) {
      const tag = rootTag[0];
      const withClass = /\bclass\s*=\s*(["'])/i.test(tag)
        ? tag.replace(/\bclass\s*=\s*(["'])/i, 'class=$1cinema-light ')
        : tag.replace(/>$/, ' class="cinema-light">');
      if (withClass !== tag) {
        html = html.slice(0, rootTag.index) + withClass +
          html.slice(rootTag.index + tag.length);
        process.stderr.write("[author] applied light-basis cinematography overrides\n");
      }
    }
  }
  // Speed ramping wraps the registered timeline in a host-owned master that
  // warps time (sequences-time). ⚠️ The registration rewrite MUST stay the
  // LAST injection step in this function: every compile-call injection above
  // anchors on the `window.__timelines[...] = <timeline>;` line, which this
  // step rewrites to register the wrapped master instead.
  const timePlan = resolveTimeRampPlan(lockedStoryboard ?? draft.storyboard);
  if (timePlan.ramps.length) {
    let repairedTime = 0;
    if (
      !html.includes(`src="${TIME_RUNTIME_FILE}"`) &&
      !html.includes(`src='${TIME_RUNTIME_FILE}'`)
    ) {
      const withRuntime = html.replace(
        /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
        `$1\n<script src="${TIME_RUNTIME_FILE}"></script>`,
      );
      if (withRuntime !== html) {
        html = withRuntime;
        repairedTime += 1;
      }
    }
    const payload = JSON.stringify(timePlan);
    const timeIslandPattern =
      /(<script\b[^>]*\bid\s*=\s*(["'])sequences-time\2[^>]*>)([\s\S]*?)(<\/script>)/i;
    if (timeIslandPattern.test(html)) {
      const updated = html.replace(timeIslandPattern, `$1${payload}$4`);
      if (updated !== html) {
        html = updated;
        repairedTime += 1;
      }
    } else {
      const timelineScript =
        /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
      if (timelineScript?.index !== undefined) {
        html = html.slice(0, timelineScript.index) +
          `<script type="application/json" data-sequences-host="1" id="sequences-time">${payload}</script>\n` +
          html.slice(timelineScript.index);
        repairedTime += 1;
      }
    }
    if (!/\bSequencesTime\.wrap\s*\(/.test(html)) {
      // The RHS stays a bare identifier (the producer's registration lint
      // matches `window.__timelines[...] = <identifier>`); the child content
      // timeline is never registered.
      const registration = /window\.__timelines\s*\[([^\]]+)\]\s*=\s*([A-Za-z_$][\w$]*)\s*;/;
      const match = registration.exec(html);
      if (match) {
        html = html.slice(0, match.index) +
          `var __seqWarped = SequencesTime.wrap(${match[2]}); ` +
          `window.__timelines[${match[1]}] = __seqWarped;` +
          html.slice(match.index + match[0].length);
        repairedTime += 1;
      }
    }
    if (repairedTime) {
      process.stderr.write(
        `[author] injected ${repairedTime} deterministic time-warp binding(s) for ` +
          `${timePlan.ramps.length} speed ramp(s)\n`,
      );
    }
  }
  // Final ordering guard: with every runtime `<script src>` and compile call now
  // injected, ensure each referenced runtime global is defined before the inline
  // script that uses it — a mis-ordered/absent runtime tag is otherwise an opaque
  // `SequencesX is not defined` browser failure that burns a paid repair attempt.
  // Only re-orders `<script src>` head tags, never the timeline registration line,
  // so it is safe to run after the time-warp rewrite above.
  const orderedRuntimes = ensureRuntimeScriptOrdering(html);
  if (orderedRuntimes.changed) {
    html = orderedRuntimes.html;
    recordSentinelNormalization("runtime-order");
    process.stderr.write(
      "[author] normalized host runtime <script> ordering (runtimes load after GSAP, before the inline timeline)\n",
    );
  }
  return html === draft.html ? draft : { ...draft, html };
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
  const raw = Number(process.env.SLACK_SEQUENCES_STREAM_IDLE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 10_000 ? raw : 90_000;
})();

const HEDGE_DELAY_MS = (() => {
  const raw = Number(process.env.SLACK_SEQUENCES_HEDGE_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 25_000;
})();

const HEDGE_MAX_PER_RUN = (() => {
  const raw = Number(process.env.SLACK_SEQUENCES_HEDGE_MAX_PER_RUN);
  return Number.isInteger(raw) && raw >= 0 ? raw : 2;
})();

export function hedgingEnabled(provider: AgentProvider): boolean {
  return provider.id === "openrouter-api" &&
    process.env.SLACK_SEQUENCES_HEDGED_REQUESTS !== "0";
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
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
  if (!provider.streamComplete) {
    return completeWithRetry(provider, prompt, options, label, attempts);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
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

function compactSkillText(text: string, budgetChars = COMPACT_SKILL_BUDGET_CHARS): string {
  const compacted = text
    .replace(/<(blueprint|motion-rule)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
  if (compacted.length <= budgetChars) return compacted;
  const paragraphEnd = compacted.lastIndexOf("\n\n", budgetChars);
  return compacted.slice(0, paragraphEnd >= Math.floor(budgetChars * 0.8) ? paragraphEnd : budgetChars);
}

/**
 * Normalize a scene's optional world-layout station map. Kept only when the
 * scene declares a camera path (a station map without a camera is dead
 * weight); junk regions, non-integer or out-of-range cells, and duplicate
 * regions/cells are dropped entry-by-entry — layout guidance degrades to
 * free placement rather than failing the storyboard.
 */
export function normalizeWorldLayout(
  value: unknown,
  hasCameraPath: boolean,
): WorldLayoutCellV1[] {
  if (!hasCameraPath || !Array.isArray(value)) return [];
  const seenRegions = new Set<string>();
  const seenCells = new Set<string>();
  const entries: WorldLayoutCellV1[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const region = typeof item.region === "string" &&
        /^[a-z][a-z0-9-]{0,63}$/.test(item.region.trim())
      ? item.region.trim()
      : "";
    const cell = Array.isArray(item.cell) && item.cell.length === 2 ? item.cell : undefined;
    const cx = Number(cell?.[0]);
    const cy = Number(cell?.[1]);
    if (
      !region || seenRegions.has(region) ||
      !Number.isInteger(cx) || !Number.isInteger(cy) ||
      Math.abs(cx) > 2 || Math.abs(cy) > 2 ||
      seenCells.has(`${cx},${cy}`)
    ) {
      continue;
    }
    seenRegions.add(region);
    seenCells.add(`${cx},${cy}`);
    entries.push({ region, cell: [cx, cy] });
  }
  return entries;
}

function parseStoryboard(raw: string): DirectScene[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`storyboard_json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(value)) throw new Error("storyboard_json must be an array");
  // Host-owned scene-timing arithmetic: shots are contiguous BY CONSTRUCTION.
  // Models routinely fumble the startSec addition (a live rescue attempt died
  // solely on "shot must start at 2.70s" findings), so every startSec is
  // re-based sequentially from the accumulated durations and each duration is
  // clamped into the contract range — a model never spends a paid attempt on
  // addition the host can do.
  let rebasedCursor = 0;
  const scenes = value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`storyboard_json[${index}] must be an object`);
    const scene = item as Record<string, unknown>;
    const id = typeof scene.id === "string" ? scene.id.trim() : "";
    const title = typeof scene.title === "string" ? scene.title.trim() : "";
    const purpose = typeof scene.purpose === "string" ? scene.purpose.trim() : "";
    const authoredStart = Number(scene.startSec);
    const authoredDuration = Number(scene.durationSec);
    if (!id || !title || !purpose || !Number.isFinite(authoredStart) || !Number.isFinite(authoredDuration)) {
      throw new Error(`storyboard_json[${index}] is missing id/title/purpose/finite timing`);
    }
    const durationSec = Math.round(Math.min(15, Math.max(1.5, authoredDuration)) * 100) / 100;
    const startSec = rebasedCursor;
    rebasedCursor = Math.round((rebasedCursor + durationSec) * 100) / 100;
    if (
      Math.abs(authoredStart - startSec) > 0.05 ||
      Math.abs(authoredDuration - durationSec) > 0.001
    ) {
      process.stderr.write(
        `[storyboard] re-based shot "${id}" timing: ` +
          `${authoredStart.toFixed(2)}s/${authoredDuration.toFixed(2)}s -> ` +
          `${startSec.toFixed(2)}s/${durationSec.toFixed(2)}s (host-owned arithmetic)\n`,
      );
    }
    const spatialIntent = normalizeStoryboardSpatialIntent(scene.spatialIntent);
    const cut = normalizeStoryboardCutIntent(scene.cut);
    // Nested beat/camera/interaction/moment/ramp times were authored against
    // the model's OWN startSec. Normalize them in that frame — so each
    // normalizer's scene-relative recovery heuristic judges the model's
    // numbers, not the host's — then shift every absolute time by the
    // re-basing delta below, so repairing the scene's arithmetic never
    // silently re-times the choreography inside it.
    const authoredFrame = { startSec: authoredStart, durationSec };
    const timeRamp = normalizeStoryboardTimeRamp(scene.timeRamp, authoredFrame);
    const gradeShift = normalizeStoryboardGradeShift(scene.gradeShift, authoredFrame);
    const camera = normalizeStoryboardCameraIntent(scene.camera, authoredFrame);
    const worldLayout = normalizeWorldLayout(scene.worldLayout, Boolean(camera?.path.length));
    const components = normalizeStoryboardComponents(scene.components);
    const beats = normalizeStoryboardComponentBeats(
      scene.beats,
      { sceneId: id, ...authoredFrame },
      components,
    );
    const interactions = normalizeStoryboardInteractionIntents(scene.interactions, {
      sceneId: id,
      ...authoredFrame,
    });
    const moments = normalizeStoryboardMoments(scene.moments, {
      sceneId: id,
      ...authoredFrame,
    });
    // Recipe declarations carry no absolute times (fragment motion is
    // scene-relative by construction), so they need no re-base shift below.
    const recipes = recipesEnabled()
      ? normalizeStoryboardRecipeDeclarations(scene.recipes)
      : [];
    // The authored and rebased windows have identical length (duration is
    // clamped once, above), so a pure shift keeps every time in-window and
    // preserves relative ordering within each intent.
    const rebaseDelta = Math.round((startSec - authoredStart) * 1000) / 1000;
    if (Math.abs(rebaseDelta) > 0.0005) {
      const shift = (value: number): number =>
        Math.round((value + rebaseDelta) * 1000) / 1000;
      if (timeRamp) timeRamp.atSec = shift(timeRamp.atSec);
      if (gradeShift) gradeShift.atSec = shift(gradeShift.atSec);
      for (const move of camera?.path ?? []) move.startSec = shift(move.startSec);
      for (const beat of beats) beat.atSec = shift(beat.atSec);
      for (const interaction of interactions) {
        interaction.startSec = shift(interaction.startSec);
        interaction.arriveSec = shift(interaction.arriveSec);
        if (interaction.pressSec !== undefined) interaction.pressSec = shift(interaction.pressSec);
        if (interaction.releaseSec !== undefined) {
          interaction.releaseSec = shift(interaction.releaseSec);
        }
        if (interaction.holdUntilSec !== undefined) {
          interaction.holdUntilSec = shift(interaction.holdUntilSec);
        }
      }
      for (const moment of moments) moment.atSec = shift(moment.atSec);
    }
    return {
      id,
      title,
      purpose,
      ...(typeof scene.incomingIdea === "string"
        ? { incomingIdea: scene.incomingIdea.trim() }
        : {}),
      ...(typeof scene.foreground === "string"
        ? { foreground: scene.foreground.trim() }
        : {}),
      ...(typeof scene.background === "string"
        ? { background: scene.background.trim() }
        : {}),
      ...(typeof scene.cameraIntent === "string"
        ? { cameraIntent: scene.cameraIntent.trim() }
        : {}),
      ...(typeof scene.continuityAnchor === "string"
        ? { continuityAnchor: scene.continuityAnchor.trim() }
        : {}),
      startSec,
      durationSec,
      ...(typeof scene.blueprint === "string" ? { blueprint: scene.blueprint } : {}),
      ...(Array.isArray(scene.rules)
        ? { rules: scene.rules.filter((rule): rule is string => typeof rule === "string") }
        : {}),
      ...(Array.isArray(scene.capabilityIds)
        ? {
            capabilityIds: scene.capabilityIds
              .filter((capability): capability is string => typeof capability === "string")
              .map((capability) => capability.trim())
              .filter(Boolean),
          }
        : {}),
      ...(typeof scene.outgoingCut === "string" ? { outgoingCut: scene.outgoingCut } : {}),
      ...(cut ? { cut } : {}),
      ...(timeRamp ? { timeRamp } : {}),
      ...(gradeShift ? { gradeShift } : {}),
      ...(camera ? { camera } : {}),
      ...(worldLayout.length ? { worldLayout } : {}),
      ...(components.length ? { components } : {}),
      ...(beats.length ? { beats } : {}),
      ...(recipes.length ? { recipes } : {}),
      ...(spatialIntent ? { spatialIntent } : {}),
      ...(interactions.length ? { interactions } : {}),
      ...(moments.length ? { moments } : {}),
    };
  });
  const usedInteractionIds = new Set<string>();
  const deduped = scenes.map((scene) => ({
    ...scene,
    ...(scene.interactions?.length
      ? {
          interactions: scene.interactions.map((interaction) => {
            let id = interaction.id;
            let suffix = 2;
            while (usedInteractionIds.has(id)) {
              id = `${interaction.id}-${suffix}`;
              suffix += 1;
            }
            usedInteractionIds.add(id);
            return id === interaction.id ? interaction : { ...interaction, id };
          }),
        }
      : {}),
  }));
  // Dive legs are host arithmetic (MD5, lever-10 philosophy): the model
  // declares only the intent + total window; the in/hold/out split is derived
  // here from the overlapping beat windows and stored on the move.
  const dives = deriveDiveWindows(deduped);
  for (const line of dives.normalized) {
    process.stderr.write(`[storyboard] dive-window derived: ${line}\n`);
  }
  if (dives.normalized.length) {
    recordSentinelNormalization("dive-window", dives.normalized.length);
  }
  // MD6 + MD3 + MD4 host auto-derivations, then their taste governors — all
  // deterministic degrade-never-veto normalizers (SENTINEL L2), run last at
  // parse so the shipped plan already carries the styled fields AND obeys the
  // caps. Each derivation FILLS the optional field a production planner (GLM)
  // under-reaches for, from data the storyboard already carries; the governor
  // that runs immediately after stays the single owner of the discipline. This
  // is the fix for the md-audit-probe gap: GLM lays down the structure
  // (headline, compact opens, "world turns warm" moments) but never the styles.
  const autoPops = autoStyleCompactPops(dives.storyboard);
  for (const line of autoPops.applied) {
    process.stderr.write(`[storyboard] auto-pop styled: ${line}\n`);
  }
  if (autoPops.applied.length) recordSentinelNormalization("auto-pop-style", autoPops.applied.length);
  const pops = degradeOpenPopStyles(autoPops.scenes);
  for (const line of pops.dropped) {
    process.stderr.write(`[storyboard] open-pop degraded: ${line}\n`);
  }
  if (pops.dropped.length) recordSentinelNormalization("open-pop", pops.dropped.length);
  const autoHeadlines = autoStyleHeadlineReveals(pops.scenes);
  for (const line of autoHeadlines.applied) {
    process.stderr.write(`[storyboard] auto-headline styled: ${line}\n`);
  }
  if (autoHeadlines.applied.length) {
    recordSentinelNormalization("auto-headline-style", autoHeadlines.applied.length);
  }
  const assembles = degradeExcessAssembles(autoHeadlines.storyboard);
  for (const line of assembles.dropped) {
    process.stderr.write(`[storyboard] assemble degraded: ${line}\n`);
  }
  if (assembles.dropped.length) {
    recordSentinelNormalization("assemble-cap", assembles.dropped.length);
  }
  const autoGrades = deriveGradeShifts(assembles.scenes);
  for (const line of autoGrades.derived) {
    process.stderr.write(`[storyboard] ${line}\n`);
  }
  if (autoGrades.derived.length) {
    recordSentinelNormalization("auto-grade-shift", autoGrades.derived.length);
  }
  const grades = dropUnusableGradeShifts(autoGrades.storyboard);
  for (const line of grades.dropped) {
    process.stderr.write(`[storyboard] ${line}\n`);
  }
  if (grades.dropped.length) recordSentinelNormalization("grade-shift", grades.dropped.length);
  // Recipe declarations are governed by the same L2 discipline: unknown/stale
  // ids drop, params default/clamp/drop, the per-film budget trims — a bad
  // declaration degrades to the Level-0 knowledge the planner already
  // retrieved, never a paid retry (degrade-never-veto).
  if (!recipesEnabled()) return grades.storyboard;
  const recipeReconcile = reconcileRecipeDeclarations(grades.storyboard);
  for (const line of recipeReconcile.notes) {
    process.stderr.write(`[storyboard] recipe-reconcile: ${line}\n`);
  }
  if (recipeReconcile.notes.length) {
    recordSentinelNormalization("recipe-reconcile", recipeReconcile.notes.length);
  }
  return recipeReconcile.scenes;
}

/** Content time at which the viewer has experienced `span` seconds past `fromSec`
 * (identity without a time ramp; monotone binary search through the warp). */
function contentTimeAfterViewerSpan(
  toViewer: (time: number) => number,
  fromSec: number,
  span: number,
  capSec: number,
): number {
  const target = toViewer(fromSec) + span;
  if (toViewer(capSec) <= target) return capSec;
  let low = fromSec;
  let high = capSec;
  for (let index = 0; index < 24; index += 1) {
    const mid = (low + high) / 2;
    if (toViewer(mid) < target) low = mid;
    else high = mid;
  }
  return high;
}

/**
 * MD5 L2 normalizer: derive each dive's push-in/pull-back legs so the held
 * window exactly covers the beats/interactions acting on the dive's target —
 * plus the reading floor for any typed/swapped copy among them (judged in
 * viewer time, like `auditPacing`). The clamp guaranteeing a real hold
 * (`diveWindows`) is shared with the resolver, so audits, island, and runtime
 * all see one arithmetic. A dive with NOTHING acting on its target during the
 * window is a zoom to a surface where nothing happens — it degrades to a
 * plain push-in with a warning (degrade-never-veto), never a rejection.
 */
export function deriveDiveWindows(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  if (!storyboard.some((scene) => scene.camera?.path.some((move) => move.move === "dive"))) {
    return { storyboard, normalized };
  }
  const toViewer = warpInverseOf(resolveTimeRampPlan(storyboard));
  const resolvedBeats = new Map(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const scenes = storyboard.map((scene) => {
    const path = scene.camera?.path;
    if (!path?.some((move) => move.move === "dive")) return scene;
    const beats = resolvedBeats.get(scene.id) ?? [];
    const notes: string[] = [];
    const newPath = path.map((move) => {
      if (move.move !== "dive" || !move.toPart) return move;
      const start = move.startSec;
      const end = move.startSec + move.durationSec;
      const overlappingBeats = beats.filter((beat) =>
        beat.component === move.toPart &&
        beat.endSec > start + 0.01 && beat.startSec < end - 0.01
      );
      const interactionEnd = (interaction: NonNullable<DirectScene["interactions"]>[number]): number =>
        interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
      const overlappingInteractions = (scene.interactions ?? []).filter((interaction) =>
        interaction.targetPart === move.toPart &&
        interactionEnd(interaction) > start + 0.01 && interaction.startSec < end - 0.01
      );
      if (!overlappingBeats.length && !overlappingInteractions.length) {
        const note =
          `dive at ${start.toFixed(2)}s targets "${move.toPart}" but no beat/interaction ` +
          `acts on it inside the window — degraded to push-in`;
        notes.push(note);
        normalized.push(`scene "${scene.id}": ${note}`);
        const { inSec: _inSec, outSec: _outSec, ...rest } = move;
        return { ...rest, move: "push-in" as const };
      }
      let holdStart = Math.min(
        ...overlappingBeats.map((beat) => beat.startSec),
        ...overlappingInteractions.map((interaction) => interaction.startSec),
      );
      let holdEnd = Math.max(
        ...overlappingBeats.map((beat) => beat.endSec),
        ...overlappingInteractions.map(interactionEnd),
      );
      // Typed/swapped copy inside the dive needs its reading floor before the
      // pull-back — the whole reason the operator wanted the camera to wait.
      for (const beat of overlappingBeats) {
        if ((beat.kind === "type" || beat.kind === "swap") && beat.text) {
          const wordCount = beat.text.trim() ? beat.text.trim().split(/\s+/).length : 0;
          const floor = Math.min(
            READING_MAX_SEC,
            Math.max(READING_MIN_SEC, READING_SEC_PER_WORD * wordCount),
          );
          holdEnd = Math.max(
            holdEnd,
            contentTimeAfterViewerSpan(toViewer, beat.endSec, floor, end),
          );
        }
      }
      holdStart = Math.max(start, Math.min(holdStart, end));
      holdEnd = Math.max(holdStart, Math.min(holdEnd, end));
      const legCap = Math.min(DIVE_LEG_MAX_SEC, move.durationSec * DIVE_LEG_FRACTION);
      const inSec = Math.round(Math.max(0.15, Math.min(legCap, holdStart - start)) * 1000) / 1000;
      const outSec = Math.round(Math.max(0.15, Math.min(legCap, end - holdEnd)) * 1000) / 1000;
      const note =
        `dive on "${move.toPart}": in ${inSec.toFixed(2)}s / hold ` +
        `${(move.durationSec - inSec - outSec).toFixed(2)}s / out ${outSec.toFixed(2)}s ` +
        `covering ${overlappingBeats.length} beat(s) + ${overlappingInteractions.length} interaction(s)`;
      notes.push(note);
      normalized.push(`scene "${scene.id}": ${note}`);
      return { ...move, inSec, outSec };
    });
    return withNormalizationNotes(
      { ...scene, camera: { ...scene.camera!, path: newPath } },
      notes,
    );
  });
  return { storyboard: scenes, normalized };
}

/**
 * True when a headline `assemble` at `resolvedEndSec` would clear auditPacing's
 * `pacing/assemble` lock-hold — computed with the EXACT gate arithmetic
 * (framing-change events + viewer-time warp) so the host only ever promotes to
 * assemble when it can prove the hold, never minting a pacing finding the model
 * cannot fix (it did not author the style).
 */
function assembleHoldSatisfied(
  scene: DirectScene,
  resolvedEndSec: number,
  toViewer: (time: number) => number,
): boolean {
  const sceneEnd = scene.startSec + scene.durationSec;
  const fullMoves = (scene.camera?.path ?? []).filter((move) => CAMERA_FULL_MOVES.has(move.move));
  const holdUntil = nextFramingChangeAfter(framingChangeEvents(fullMoves), resolvedEndSec, sceneEnd);
  const hold = Math.max(0, toViewer(holdUntil) - toViewer(resolvedEndSec));
  return hold + PACING_TOLERANCE_SEC >= ASSEMBLE_HOLD_SEC;
}

/**
 * MD3 host auto-derivation (the taste ladder, MOTION_DESIGN_PLAN §0): hero copy
 * on a `headline` component wants a refined reveal, but a production planner
 * (GLM z-ai/glm-5.2) declares the `headline` + its `type` beat and leaves the
 * OPTIONAL `style` blank, so the wordmark always arrives as a plain typewriter
 * (md-audit-probe-4). The HOST fills it from data the storyboard already
 * carries: every style-less headline `type` beat defaults to `rise` (the
 * refined staggered reveal), and the SINGLE strongest resolve — the latest
 * headline type beat that coincides with a `primary` moment AND can prove the
 * assemble lock-hold ([[assembleHoldSatisfied]]) — is promoted to `assemble`,
 * the film's loudest text gesture. The 1-per-film / headline-only / on-primary
 * cap stays owned by [[degradeExcessAssembles]], which runs immediately after
 * (SENTINEL L2, degrade-never-veto). Never overrides an explicit style; adds
 * zero planner surface.
 */
export function autoStyleHeadlineReveals(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; applied: string[] } {
  const applied: string[] = [];
  const headlineIdsByScene = storyboard.map(
    (scene) =>
      new Set(
        (scene.components ?? [])
          .filter((component) => component.kind === "headline")
          .map((component) => component.id),
      ),
  );
  const isCandidate = (
    beat: NonNullable<DirectScene["beats"]>[number],
    sceneIndex: number,
  ): boolean =>
    beat.kind === "type" && !beat.style && headlineIdsByScene[sceneIndex]!.has(beat.component);
  if (!storyboard.some((scene, index) => (scene.beats ?? []).some((beat) => isCandidate(beat, index)))) {
    return { storyboard, applied };
  }

  const resolvedBeats = new Map(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const toViewer = warpInverseOf(resolveTimeRampPlan(storyboard));

  // First pass: the single strongest assemble candidate across the film — the
  // latest lock among headline type beats on a primary moment with a provable hold.
  let best: { sceneIndex: number; beatId: string; endSec: number } | undefined;
  storyboard.forEach((scene, index) => {
    const resolved = resolvedBeats.get(scene.id) ?? [];
    const primaries = (scene.moments ?? []).filter((moment) => moment.importance === "primary");
    for (const beat of scene.beats ?? []) {
      if (!isCandidate(beat, index)) continue;
      const window = resolved.find((entry) => entry.id === beat.id);
      if (!window) continue;
      const onPrimary = primaries.some(
        (moment) => moment.atSec >= window.startSec - 0.6 && moment.atSec <= window.endSec + 0.6,
      );
      if (!onPrimary || !assembleHoldSatisfied(scene, window.endSec, toViewer)) continue;
      if (!best || window.endSec > best.endSec) {
        best = { sceneIndex: index, beatId: beat.id, endSec: window.endSec };
      }
    }
  });

  // Second pass: style every style-less headline type beat — `assemble` for the
  // one winner, `rise` for the rest.
  const scenes = storyboard.map((scene, index) => {
    if (!(scene.beats ?? []).some((beat) => isCandidate(beat, index))) return scene;
    const beats = scene.beats!.map((beat) => {
      if (!isCandidate(beat, index)) return beat;
      const style =
        best && best.sceneIndex === index && best.beatId === beat.id ? "assemble" : "rise";
      applied.push(`scene "${scene.id}": headline type "${beat.id}" on "${beat.component}" → ${style}`);
      return { ...beat, style };
    });
    return { ...scene, beats };
  });
  return { storyboard: scenes, applied };
}

export interface StoryboardPlanRequirements {
  targetDurationSec?: number;
  requestedComponentKinds?: ComponentKind[];
  minRequestedComponentKinds?: number;
  minComponentBeats?: number;
  minCameraMoves?: number;
  requireMultiStationWorld?: boolean;
  requireObjectMatch?: boolean;
  requireShapeMatch?: boolean;
  requireRackFocus?: boolean;
  requireTimeRamp?: boolean;
}

export function validateStoryboardPlan(
  storyboard: DirectScene[],
  requirements: StoryboardPlanRequirements = {},
): string[] {
  const errors: string[] = [];
  if (storyboard.length < 3 || storyboard.length > 10) {
    errors.push("storyboard must contain 3-10 distinct shots");
  }
  const knownCapabilities = new Set(
    loadCapabilityIndex().capabilities.map((capability) => capability.id),
  );
  const ids = new Set<string>();
  const interactionIds = new Set<string>();
  const beatIds = new Set<string>();
  let expectedStart = 0;
  for (const [index, scene] of storyboard.entries()) {
    if (!/^[a-z][a-z0-9-]*$/.test(scene.id)) {
      errors.push(`shot ${index + 1} id must be stable kebab-case`);
    }
    if (ids.has(scene.id)) errors.push(`shot id "${scene.id}" is duplicated`);
    ids.add(scene.id);
    if (Math.abs(scene.startSec - expectedStart) > 0.05) {
      errors.push(`shot "${scene.id}" must start at ${expectedStart.toFixed(2)}s`);
    }
    if (scene.durationSec < 1.5 || scene.durationSec > 15) {
      errors.push(`shot "${scene.id}" duration must be 1.5-15 seconds`);
    }
    for (const field of [
      "incomingIdea",
      "foreground",
      "background",
      "cameraIntent",
      "continuityAnchor",
      "outgoingCut",
    ] as const) {
      if (!scene[field]?.trim()) errors.push(`shot "${scene.id}" is missing ${field}`);
    }
    for (const capability of scene.capabilityIds ?? []) {
      if (!knownCapabilities.has(capability)) {
        errors.push(`shot "${scene.id}" cites unknown capability "${capability}"`);
      }
    }
    if (scene.spatialIntent && !scene.spatialIntent.focalPart.trim()) {
      errors.push(`shot "${scene.id}" needs a stable focalPart`);
    }
    const componentKinds = new Map(
      (scene.components ?? []).map((component) => [component.id, component.kind]),
    );
    for (const beat of scene.beats ?? []) {
      if (beatIds.has(beat.id)) {
        errors.push(`component beat id "${beat.id}" is duplicated`);
      }
      beatIds.add(beat.id);
      const kind = componentKinds.get(beat.component);
      if (kind && !componentSupportsBeat(kind, beat.kind)) {
        errors.push(
          `beat "${beat.id}" uses "${beat.kind}" on a ${kind} component, which does not ` +
            `support it — pick a supported beat or a different component kind`,
        );
      }
      if (beat.morphTo && !componentKinds.has(beat.morphTo)) {
        errors.push(
          `beat "${beat.id}" morphs to undeclared component "${beat.morphTo}" — declare the ` +
            `twin component in the same shot`,
        );
      }
    }
    for (const interaction of scene.interactions ?? []) {
      if (interactionIds.has(interaction.id)) {
        errors.push(`interaction id "${interaction.id}" is duplicated`);
      }
      interactionIds.add(interaction.id);
      if (interaction.sceneId !== scene.id) {
        errors.push(`interaction "${interaction.id}" must use sceneId "${scene.id}"`);
      }
      const sceneEnd = scene.startSec + scene.durationSec;
      const interactionEnd =
        interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
      if (interaction.startSec < scene.startSec || interactionEnd > sceneEnd) {
        errors.push(`interaction "${interaction.id}" timing escapes shot "${scene.id}"`);
      }
      if (
        interaction.pressSec !== undefined &&
        interaction.pressSec - interaction.arriveSec < 0.08
      ) {
        errors.push(`interaction "${interaction.id}" needs at least 80ms settle before press`);
      }
    }
    expectedStart = scene.startSec + scene.durationSec;
  }
  if (expectedStart < 6 || expectedStart > 60) {
    errors.push("storyboard total duration must be 6-60 seconds");
  }
  // Camera-era density floor: a framing is a shot or a full camera move
  // (pan/whip/push-in/pull-back/track-to-anchor/parallax-pass/orbit-lite/orbit).
  // The viewer must get a new framing roughly every 3.5 seconds — either by
  // cutting or by moving the camera across the scene's spatial world.
  const cameraMoves = storyboard.reduce(
    (count, scene) =>
      count +
      (scene.camera?.path.filter((move) => CAMERA_FULL_MOVES.has(move.move)).length ?? 0),
    0,
  );
  const framings = storyboard.length + cameraMoves;
  const requiredFramings = Math.min(12, Math.max(3, Math.round(expectedStart / 3.5)));
  if (expectedStart >= 10 && framings < requiredFramings) {
    errors.push(
      `a ${expectedStart.toFixed(0)}s film needs at least ${requiredFramings} distinct framings ` +
        `(shots plus typed camera moves); it has ${framings} — add shots or give scenes ` +
        `camera paths over a larger data-camera-world`,
    );
  }
  if (requirements.minCameraMoves && cameraMoves < requirements.minCameraMoves) {
    errors.push(
      `the brief explicitly requests spatial camera choreography; plan at least ` +
        `${requirements.minCameraMoves} FULL typed camera moves ` +
        `(pan/whip/push-in/pull-back/track-to-anchor/parallax-pass/orbit/dive — drift and ` +
        `hold do NOT count), not ${cameraMoves}`,
    );
  }
  if (
    requirements.requireMultiStationWorld &&
    !storyboard.some((scene) =>
      (scene.camera?.path.filter((move) => CAMERA_FULL_MOVES.has(move.move)).length ?? 0) >= 2
    )
  ) {
    errors.push(
      "the brief requests one large spatial UI world; at least one shot must travel through " +
        "multiple stations with two or more FULL typed camera moves in its own path. " +
        "Full moves are pan/whip/push-in/pull-back/track-to-anchor/parallax-pass/orbit/dive — " +
        "drift and hold are connective and do NOT count. Recipe: give one 5s+ shot " +
        "worldLayout cells for 2-3 regions, then pan to the second region at ~1s and " +
        "track-to-anchor a part in the third at ~3s",
    );
  }
  if (
    requirements.requireObjectMatch &&
    !storyboard.some((scene) =>
      scene.cut?.style === "match" && scene.cut.focalPartOut && scene.cut.focalPartIn
    )
  ) {
    errors.push(
      "the brief explicitly requests a match cut that carries an object across the " +
        "boundary, but none is planned with both focal part names",
    );
  }
  if (
    requirements.requireShapeMatch &&
    !storyboard.some((scene) => scene.cut?.style === "morph")
  ) {
    errors.push("the brief explicitly requests a morph transition, but none is planned");
  }
  if (
    requirements.requireRackFocus &&
    !storyboard.some((scene) => scene.camera?.path.some((move) => move.focus))
  ) {
    errors.push(
      "the brief explicitly requests a rack-focus pull, but no camera move carries a " +
        '"focus" modifier — attach focus:{part|depth, blurMaxPx} to the move that lands on the payoff',
    );
  }
  // Speed-ramp discipline: dips are rhythm, not chaos. Never shot 1, max 2 per
  // film, every declared dip must solve inside its shot's identity margins,
  // and the slow-motion hold must be *motivated* by a declared moment.
  const rampScenes = storyboard.filter((scene) => scene.timeRamp);
  if (storyboard[0]?.timeRamp) {
    errors.push("shot 1 must open at native speed — move the timeRamp dip to a later shot");
  }
  if (rampScenes.length > MAX_RAMPS_PER_FILM) {
    errors.push(
      `at most ${MAX_RAMPS_PER_FILM} timeRamp dips per film — keep the one or two most ` +
        `important resolves and drop the rest`,
    );
  }
  const rampPlan = resolveTimeRampPlan(storyboard);
  for (const [rampIndex, scene] of rampScenes.entries()) {
    if (scene === storyboard[0]) continue;
    const resolved = rampPlan.ramps.find((ramp) => ramp.sceneId === scene.id);
    if (!resolved) {
      // Ramps past the per-film cap are unresolved by design; the cap error
      // above already names the real problem.
      if (rampIndex >= MAX_RAMPS_PER_FILM) continue;
      errors.push(
        `shot "${scene.id}" declares a timeRamp that cannot be solved inside the shot: the dip ` +
          `plus recovery must fit between ${(scene.startSec + 0.3).toFixed(1)}s and the shot's ` +
          `cut window with a 0.6s identity margin, and the catch-up must stay under 2.5× — ` +
          `move atSec earlier, shorten holdSec, or lengthen the shot`,
      );
      continue;
    }
    const hold = timeRampHoldWindow(resolved);
    const motivated = (scene.moments ?? []).some((moment) =>
      moment.atSec >= hold.contentStartSec - 0.35 &&
      moment.atSec <= hold.contentEndSec + 0.35
    );
    if (!motivated) {
      errors.push(
        `shot "${scene.id}" timeRamp dip must be motivated: declare a storyboard moment whose ` +
          `atSec falls inside the slow-motion hold (${hold.contentStartSec.toFixed(2)}–` +
          `${hold.contentEndSec.toFixed(2)}s) — slow motion without a subject reads as a stall`,
      );
    }
  }
  if (requirements.requireTimeRamp && !rampScenes.length) {
    errors.push(
      "the brief explicitly requests a speed ramp / slow-motion dip, but no shot declares a " +
        "timeRamp — add one on the film's most important resolve (never shot 1)",
    );
  }
  const presentComponentKinds = new Set(
    storyboard.flatMap((scene) => (scene.components ?? []).map((component) => component.kind)),
  );
  const requestedComponentKinds = requirements.requestedComponentKinds ?? [];
  const coveredRequestedKinds = requestedComponentKinds.filter((kind) =>
    presentComponentKinds.has(kind)
  );
  if (
    requirements.minRequestedComponentKinds &&
    coveredRequestedKinds.length < requirements.minRequestedComponentKinds
  ) {
    const missing = requestedComponentKinds.filter((kind) => !presentComponentKinds.has(kind));
    errors.push(
      `the brief explicitly requests motion-native product components; plan at least ` +
        `${requirements.minRequestedComponentKinds} requested kinds, but only ` +
        `${coveredRequestedKinds.length} are present (missing: ${missing.join(", ")})`,
    );
  }
  const componentBeats = storyboard.reduce(
    (count, scene) => count + (scene.beats?.length ?? 0),
    0,
  );
  if (requirements.minComponentBeats && componentBeats < requirements.minComponentBeats) {
    errors.push(
      `the brief explicitly requests component choreography; plan at least ` +
        `${requirements.minComponentBeats} typed component beats, not ${componentBeats}`,
    );
  }
  const foregrounds = new Set(storyboard.map((scene) => scene.foreground?.toLowerCase()));
  const cameras = new Set(storyboard.map((scene) => scene.cameraIntent?.toLowerCase()));
  if (foregrounds.size < Math.min(3, storyboard.length)) {
    errors.push("storyboard repeats the same foreground composition across shots");
  }
  if (cameras.size < 2) {
    errors.push("storyboard needs at least two distinct camera/framing intentions");
  }
  // Moments are the real review contract: scenes are containers, moments are
  // what the viewer gets. Reject plans that miss the floor, cluster at
  // entrances, repeat visual states, or leave dead intervals — before any
  // source budget is spent.
  errors.push(...validatePlannedMoments(storyboard, expectedStart));
  // Plan-time silhouette sanity: a shape-match declared with cross-family
  // hints is known-hopeless (the runtime would degrade it at bind time), so
  // it gets fixed in a cheap storyboard findings-retry instead of burning
  // author attempts on a cut that can never compile.
  errors.push(...auditShapeMatchHints(storyboard));
  // Camera-energy audit: every 12s+ film needs at least one high-energy
  // element, and four-plus full moves may not share one HIGH-ENERGY verb.
  errors.push(...auditCameraEnergy(storyboard));
  // Transition-language coherence (WS6): a style zoo — a different cut per
  // seam — reads as "messy"; a launch film reuses 1-2 signature transitions.
  errors.push(...auditCutCoherence(storyboard));
  // Complexity governor: a plan the author cannot build (too many component
  // surfaces for the duration) fails HERE, where a retry costs one storyboard
  // call, not downstream where it burns every author attempt.
  errors.push(...auditComponentComplexity(storyboard));
  // Hold-what-matters pacing (WS3): introduced surfaces need development
  // time, typed copy needs reading time, payoffs need outcome holds, and
  // camera density has a ceiling as well as a floor.
  errors.push(...auditPacing(storyboard));
  // MD5: a dive re-frames twice inside its window; a cursor working a
  // DIFFERENT surface through that window aims at a moving frame. Both
  // windows are typed, so refuse the combination here where a retry costs
  // one storyboard call (the dive-on-its-own-target pattern is designed-for
  // and never flagged).
  errors.push(...auditDiveInteractions(storyboard));
  // Exit discipline (WS4): a scene that opens a second content surface over a
  // still-live one in the same station stacks clutter — retire the outgoing
  // surface or give the incoming one its own station.
  errors.push(...auditSurfaceExits(storyboard));
  return [...new Set(errors)];
}

/**
 * Plan-time silhouette sanity for declared shape-match cuts (WS1). The
 * storyboard's shapeOut/shapeIn hints carry no runtime geometry, but a
 * cross-family pair (pill→card, circle→bar) provably cannot survive the
 * runtime's 2.5× aspect audit — the declared morph would silently ship as
 * zoom-through while every artifact still advertises it. Surface the
 * mismatch as a validation finding so a cheap storyboard retry fixes the
 * pair while the plan is still paper.
 */
export function auditShapeMatchHints(storyboard: DirectScene[]): string[] {
  const findings: string[] = [];
  for (const [index, scene] of storyboard.entries()) {
    const next = storyboard[index + 1];
    const cut = scene.cut;
    // Canonicalize so cached storyboards still carrying "shape-match" get the
    // same plan-time sanity as fresh morph declarations.
    const style = cut ? canonicalCutStyle(cut.style).style : undefined;
    if (!next || !cut || style !== "morph" || !cut.shapeOut || !cut.shapeIn) continue;
    if (shapeHintsRhyme(cut.shapeOut, cut.shapeIn)) continue;
    findings.push(
      `morph ${scene.id}->${next.id} declares silhouette hints ` +
        `${cut.shapeOut}->${cut.shapeIn}, which cannot rhyme (a ${cut.shapeOut} and a ` +
        `${cut.shapeIn} differ beyond the runtime's 2.5x aspect cap at any plausible size, ` +
        `so the cut would degrade to a swipe at bind time) — re-point the morph at ` +
        `endpoints whose silhouettes match (pill<->bar, or card<->window<->circle), fix the ` +
        `hints if the real parts do rhyme, or declare a swipe instead`,
    );
  }
  return findings;
}

/**
 * MD5 plan-stage guard: a dive window may not overlap a cursor interaction's
 * screen-space approach unless the interaction targets the dived surface —
 * the hold then covers the interaction window by construction
 * (`deriveDiveWindows` includes interaction windows on the dive target).
 */
export function auditDiveInteractions(storyboard: DirectScene[]): string[] {
  const findings: string[] = [];
  for (const scene of storyboard) {
    const dives = (scene.camera?.path ?? []).filter((move) => move.move === "dive");
    if (!dives.length || !scene.interactions?.length) continue;
    for (const interaction of scene.interactions) {
      const end =
        interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
      for (const dive of dives) {
        if (dive.toPart === interaction.targetPart) continue;
        if (
          interaction.startSec < dive.startSec + dive.durationSec + 0.001 &&
          end > dive.startSec - 0.001
        ) {
          findings.push(
            `interaction "${interaction.id}" overlaps the dive on "${dive.toPart}" in scene ` +
              `"${scene.id}" (${dive.startSec.toFixed(1)}s-` +
              `${(dive.startSec + dive.durationSec).toFixed(1)}s) while targeting ` +
              `"${interaction.targetPart}" — a cursor cannot work one surface while the camera ` +
              `dives into another; aim the interaction at the dived surface, or retime one of them`,
          );
        }
      }
    }
  }
  return findings;
}

/**
 * Degrade-never-veto rung for the hint audit above: on the final storyboard
 * attempt a still-mismatched volunteered shape-match downgrades to
 * zoom-through with honest prose instead of blocking the film. Brief-required
 * shape-match never lands here — its finding stays blocking so the retry
 * loop (and the rescue rung) remain the delivery mechanism.
 */
export function degradeMismatchedShapeHintCuts(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; degraded: string[] } {
  const degraded: string[] = [];
  const scenes = storyboard.map((scene, index) => {
    const next = storyboard[index + 1];
    const cut = scene.cut;
    const style = cut ? canonicalCutStyle(cut.style).style : undefined;
    if (!next || !cut || style !== "morph" || !cut.shapeOut || !cut.shapeIn) return scene;
    if (shapeHintsRhyme(cut.shapeOut, cut.shapeIn)) return scene;
    degraded.push(`${scene.id}->${next.id} (${cut.shapeOut}->${cut.shapeIn})`);
    return {
      ...scene,
      // Keep any authored boundary timing so the executed window stays put —
      // the same policy as the QA-time rewrite (rewriteDegradedCutStoryboard);
      // only the style and its focal/hint paperwork change. The degrade target
      // is a swipe (MD1): no focal geometry exists at plan time, so the axis
      // falls back to right-travel — the shipped film stays inside the
      // 3-transition language either way.
      cut: {
        version: 1 as const,
        style: "swipe" as const,
        axis: "right" as const,
        ...(cut.travelPx !== undefined ? { travelPx: cut.travelPx } : {}),
        ...(cut.exitSec !== undefined ? { exitSec: cut.exitSec } : {}),
        ...(cut.entrySec !== undefined ? { entrySec: cut.entrySec } : {}),
      },
      outgoingCut:
        `Swipe into the next shot (a declared morph with non-rhyming ` +
        `silhouette hints ${cut.shapeOut}->${cut.shapeIn} was degraded at plan time).`,
    };
  });
  return { scenes, degraded };
}

/**
 * Degrade support-map beat violations at parse instead of vetoing the plan
 * (fallback-elimination lever): the planner keeps reaching for a reasonable
 * beat on the wrong component kind (`type` on a list, `rows` on a stat-card)
 * and two live attempts burned SOLELY on those findings. Convert the beat to
 * the nearest supported analog — text arrivals become a universal `swap`,
 * `rows` becomes `count` where the kind counts, anything else becomes a
 * universal `highlight` pulse — mechanically recoverable paperwork never
 * consumes a paid retry. A LOAD-BEARING beat (a declared moment anchors
 * inside its window) keeps the blocking finding instead: silently changing
 * evidence a moment binds to would corrupt the review contract.
 */
export function degradeUnsupportedComponentBeats(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; degraded: string[] } {
  const degraded: string[] = [];
  const scenes = storyboard.map((scene) => {
    const kinds = new Map((scene.components ?? []).map((entry) => [entry.id, entry.kind]));
    if (!scene.beats?.length || !kinds.size) return scene;
    const beats = scene.beats.map((beat) => {
      const kind = kinds.get(beat.component);
      if (!kind || componentSupportsBeat(kind, beat.kind)) return beat;
      const windowEnd = beat.atSec + (beat.durationSec ?? 1.2) + 0.35;
      const loadBearing = (scene.moments ?? []).some((moment) =>
        moment.atSec >= beat.atSec - 0.35 && moment.atSec <= windowEnd
      );
      // A text arrival degrades to `swap` — the SAME text on the SAME
      // component at the SAME second — so a moment anchored on it keeps its
      // evidence beat and its claim: this one is safe even load-bearing (the
      // 2026-07-06 probe set repeatedly died on load-bearing `type` on an
      // app-window). A numeric fill (`progress`/`rows` carrying a value) on a
      // kind that counts degrades to `count` the same way — same number, same
      // second, same numeric-development claim (`sentinel-p6-camera-r2`'s
      // rescue died on a load-bearing `progress` on a stat-card). Every other
      // analog changes the visual channel, so a load-bearing beat there keeps
      // its blocking finding.
      const isTextAnalog = (beat.kind === "type" || beat.kind === "stream") && beat.text;
      const isNumericAnalog =
        (beat.kind === "progress" || beat.kind === "rows") &&
        typeof beat.value === "number" &&
        componentSupportsBeat(kind, "count");
      if (loadBearing && !isTextAnalog && !isNumericAnalog) return beat;
      const analog: ComponentBeatKind =
        isTextAnalog
          ? "swap"
          : isNumericAnalog
            ? "count"
            : "highlight";
      degraded.push(
        `scene "${scene.id}" beat "${beat.id}": "${beat.kind}" is unsupported on a ` +
          `${kind} component — degraded to "${analog}"`,
      );
      return { ...beat, kind: analog };
    });
    return { ...scene, beats };
  });
  return { scenes, degraded };
}

/**
 * Reconcile morph beats whose twin component was never declared (Phase-5
 * hardening: the 2026-07-06 `sentinel-p5-camera-b` rescue attempt died SOLELY
 * on `morphs to undeclared component`). Same conservative ladder as
 * interaction-target reconciliation:
 * 1. The source kind has exactly ONE legal catalog morph partner → DECLARE the
 *    twin with that kind (id and pairing are both the model's own; only the
 *    kind is filled from a one-choice table). The morph the model asked for
 *    actually happens.
 * 2. Ambiguous partner and the beat is not load-bearing → degrade the beat to
 *    a `highlight` pulse (delete/degrade, never invent).
 * 3. Ambiguous AND load-bearing → keep the blocking finding (silently changing
 *    evidence a moment binds to would corrupt the review contract).
 */
export function reconcileUndeclaredMorphTargets(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; changed: string[] } {
  const changed: string[] = [];
  const scenes = storyboard.map((scene) => {
    if (!scene.beats?.length) return scene;
    const declared = new Map((scene.components ?? []).map((entry) => [entry.id, entry]));
    let components = scene.components ?? [];
    const notes: string[] = [];
    const beats = scene.beats.map((beat) => {
      if (beat.kind !== "morph" || !beat.morphTo || declared.has(beat.morphTo)) return beat;
      const source = declared.get(beat.component);
      const partners = source ? morphPartnerKinds(source.kind) : [];
      if (source && partners.length === 1) {
        const twin: (typeof components)[number] = {
          version: 1,
          id: beat.morphTo,
          kind: partners[0]!,
          ...(source.region ? { region: source.region } : {}),
        };
        components = [...components, twin];
        declared.set(twin.id, twin);
        const note =
          `beat "${beat.id}": declared the missing morph twin "${beat.morphTo}" as the ` +
          `${source.kind} kind's only legal partner (${partners[0]})`;
        notes.push(note);
        changed.push(`scene "${scene.id}" ${note}`);
        return beat;
      }
      const windowEnd = beat.atSec + (beat.durationSec ?? 1.2) + 0.35;
      const loadBearing = (scene.moments ?? []).some((moment) =>
        moment.atSec >= beat.atSec - 0.35 && moment.atSec <= windowEnd
      );
      if (loadBearing) return beat;
      const note =
        `beat "${beat.id}": morph targets undeclared twin "${beat.morphTo}" with no ` +
        `unique catalog partner — degraded to "highlight" (declare BOTH twins to keep a morph)`;
      notes.push(note);
      changed.push(`scene "${scene.id}" ${note}`);
      const { morphTo: _twin, ...rest } = beat;
      return { ...rest, kind: "highlight" as ComponentBeatKind };
    });
    if (!notes.length) return scene;
    return withNormalizationNotes({ ...scene, components, beats }, notes);
  });
  return { scenes, changed };
}

/**
 * Retime an unmotivated or unsolvable timeRamp dip onto the scene's own
 * declared moments instead of vetoing the plan (Phase-5 hardening: the
 * 2026-07-06 `sentinel-p5-longcopy` probe burned three attempts on "declare a
 * moment whose atSec falls inside the slow-motion hold (23.62–23.94s)" — a
 * sub-second target the model must hit blind against the solver's own
 * geometry, which is host arithmetic, not creative judgment). Scans candidate
 * atSec values across the scene window (0.1s grid, nearest-to-declared first)
 * and commits the FIRST candidate whose ramp both resolves and covers a
 * declared moment; a scene with no moments, or no working candidate, is left
 * untouched (the volunteered drop / required finding path is unchanged).
 * Retiming only ever moves the dip the model already declared — it never
 * invents a dip or a moment.
 */
export function retimeUnmotivatedTimeRamps(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  let scenes = [...storyboard];
  const motivatedBy = (
    ramp: ReturnType<typeof resolveTimeRampPlan>["ramps"][number],
    moments: StoryboardMomentV1[],
  ): boolean => {
    const hold = timeRampHoldWindow(ramp);
    return moments.some((moment) =>
      moment.atSec >= hold.contentStartSec - 0.35 && moment.atSec <= hold.contentEndSec + 0.35
    );
  };
  for (const [index, scene] of scenes.entries()) {
    if (index === 0 || !scene.timeRamp || typeof scene.timeRamp.atSec !== "number") continue;
    const moments = scene.moments ?? [];
    if (!moments.length) continue;
    const plan = resolveTimeRampPlan(scenes);
    const resolved = plan.ramps.find((ramp) => ramp.sceneId === scene.id);
    if (resolved && motivatedBy(resolved, moments)) continue;
    const declaredAt = scene.timeRamp.atSec;
    const windowStart = scene.startSec + 0.3;
    const windowEnd = scene.startSec + scene.durationSec - 0.9;
    const candidates: number[] = [];
    for (let t = windowStart; t <= windowEnd + 1e-9; t += 0.1) {
      candidates.push(Math.round(t * 100) / 100);
    }
    candidates.sort((a, b) => Math.abs(a - declaredAt) - Math.abs(b - declaredAt));
    for (const candidate of candidates) {
      const trial = scenes.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, timeRamp: { ...entry.timeRamp!, atSec: candidate } }
          : entry
      );
      const trialResolved = resolveTimeRampPlan(trial).ramps.find(
        (ramp) => ramp.sceneId === scene.id,
      );
      if (!trialResolved || !motivatedBy(trialResolved, moments)) continue;
      const note =
        `retimed the timeRamp dip from ${declaredAt.toFixed(2)}s to ${candidate.toFixed(2)}s ` +
        `so its slow-motion hold covers a declared moment`;
      scenes = trial.map((entry, entryIndex) =>
        entryIndex === index ? withNormalizationNotes(entry, [note]) : entry
      );
      normalized.push(`scene "${scene.id}": ${note}`);
      break;
    }
  }
  return { scenes, normalized };
}

/**
 * Drop VOLUNTEERED timeRamp dips that break the ramp contract instead of
 * letting them veto the whole plan. GLM reaches for the vocabulary even when
 * the brief never asks for slow motion, and a mis-placed dip (unsolvable
 * window, no motivating moment, shot 1, over the per-film cap) used to burn
 * all three storyboard attempts on findings about an optional enhancement —
 * the 2026-07-04 live incident. When the brief explicitly demands a ramp
 * (`requireTimeRamp`), the blocking findings stay: the retry loop is the
 * delivery mechanism there.
 */
export function dropUnusableVolunteeredTimeRamps(storyboard: DirectScene[]): DirectScene[] {
  const scenes = [...storyboard];
  for (let pass = 0; pass < scenes.length; pass += 1) {
    const plan = resolveTimeRampPlan(scenes);
    let dropped = false;
    for (const [index, scene] of scenes.entries()) {
      if (!scene.timeRamp) continue;
      let reason = "";
      if (index === 0) {
        reason = "shot 1 opens at native speed";
      } else {
        const resolved = plan.ramps.find((ramp) => ramp.sceneId === scene.id);
        if (!resolved) {
          reason = "the dip cannot be solved inside the shot (window or per-film cap)";
        } else {
          const hold = timeRampHoldWindow(resolved);
          const motivated = (scene.moments ?? []).some((moment) =>
            moment.atSec >= hold.contentStartSec - 0.35 &&
            moment.atSec <= hold.contentEndSec + 0.35
          );
          if (!motivated) reason = "no declared moment inside the slow-motion hold";
        }
      }
      if (reason) {
        const { timeRamp: _dropped, ...rest } = scene;
        scenes[index] = rest;
        dropped = true;
        process.stderr.write(
          `[storyboard] dropped volunteered timeRamp on "${scene.id}": ${reason}\n`,
        );
      }
    }
    if (!dropped) break;
  }
  return scenes;
}

/**
 * A storyboard rejection that carries the exact plan the findings describe
 * (post any committed normalization), so the findings-retry can hand the model
 * its own artifact back for a MINIMAL edit instead of a from-scratch redesign
 * — the 2026-07-06 probe set showed every from-scratch retry minting fresh
 * violations (whack-a-mole) across both planner models.
 */
export class StoryboardValidationError extends Error {
  readonly storyboard: DirectScene[];
  constructor(errors: string[], storyboard: DirectScene[]) {
    super(`invalid storyboard plan: ${errors.join("; ")}`);
    this.name = "StoryboardValidationError";
    this.storyboard = storyboard;
  }
}

const acceptedStoryboardDegradations = new WeakMap<DirectScene[], string[]>();

export function parseStoryboardResponse(
  raw: string,
  requirements: StoryboardPlanRequirements = {},
  options: {
    degradeShapeHintMismatches?: boolean;
    /** Accept pacing/* findings as advisories instead of vetoes (late attempts). */
    degradePacingFindings?: boolean;
  } = {},
): DirectScene[] {
  const degradations: string[] = [];
  const knownCapabilities = new Set(
    loadCapabilityIndex().capabilities.map((capability) => capability.id),
  );
  let storyboard = parseStoryboard(extractStoryboardSource(raw)).map((scene) => ({
    ...scene,
    ...(scene.capabilityIds
      ? { capabilityIds: scene.capabilityIds.filter((id) => knownCapabilities.has(id)) }
      : {}),
  }));
  // Ramp arithmetic is host-owned: an unmotivated or unsolvable dip first gets
  // retimed onto the scene's own declared moments (commits only when the
  // retimed ramp provably resolves + motivates — a per-scene convergence
  // check). Only then are still-broken VOLUNTEERED dips dropped; brief-demanded
  // ramps that no retime can save keep their blocking findings.
  const rampRetime = retimeUnmotivatedTimeRamps(storyboard);
  if (rampRetime.normalized.length) {
    storyboard = rampRetime.scenes;
    for (const line of rampRetime.normalized) {
      process.stderr.write(`[storyboard] sentinel-normalized: ${line}\n`);
    }
    recordSentinelNormalization("timeramp-retime", rampRetime.normalized.length);
  }
  if (!requirements.requireTimeRamp) {
    const beforeRampScenes = new Set(
      storyboard.filter((scene) => scene.timeRamp).map((scene) => scene.id),
    );
    storyboard = dropUnusableVolunteeredTimeRamps(storyboard);
    for (const sceneId of beforeRampScenes) {
      if (!storyboard.find((scene) => scene.id === sceneId)?.timeRamp) {
        degradations.push(`storyboard-time-ramp-dropped:${sceneId}`);
      }
    }
  }
  // Support-map beat violations degrade to the nearest supported analog
  // (load-bearing beats keep their blocking finding) — see
  // degradeUnsupportedComponentBeats.
  const beatDegradation = degradeUnsupportedComponentBeats(storyboard);
  if (beatDegradation.degraded.length) {
    storyboard = beatDegradation.scenes;
    for (const line of beatDegradation.degraded) {
      process.stderr.write(`[storyboard] ${line}\n`);
      degradations.push(`storyboard-component-beat-degraded:${findingSignature(line)}`);
    }
  }
  // Early attempts keep the hint-mismatch finding blocking so a cheap
  // findings-retry fixes the pair; the FINAL attempt degrades a volunteered
  // hopeless morph to a swipe instead of blocking the film
  // (degrade-never-veto). Brief-required morph never degrades here.
  if (options.degradeShapeHintMismatches && !requirements.requireShapeMatch) {
    const degradation = degradeMismatchedShapeHintCuts(storyboard);
    if (degradation.degraded.length) {
      storyboard = degradation.scenes;
      for (const line of degradation.degraded) {
        process.stderr.write(
          `[storyboard] degraded hint-mismatched morph to swipe: ${line}\n`,
        );
        degradations.push(`storyboard-shape-cut-degraded:${findingSignature(line)}`);
      }
    }
  }
  // Double-triggered motion (repeated pulses, overlapping same-channel beats,
  // press beats under a cursor press) degrades to single triggers before
  // moments bind to beat evidence.
  const deduped = dedupeRedundantBeats(storyboard);
  if (deduped.dropped.length) {
    storyboard = deduped.scenes;
    for (const line of deduped.dropped) {
      process.stderr.write(`[storyboard] ${line}\n`);
      degradations.push(`storyboard-redundant-beat-dropped:${findingSignature(line)}`);
    }
  }
  // Sentinel Phase 3: mechanical pacing fixes (delete/degrade/retime, never
  // invent content) run before the pacing gate sees the plan, so arithmetic
  // the host can already do never burns a paid storyboard retry. Camera
  // budget first (drops moves, which changes which beats even hit the
  // reading/outcome checks), then the marginal-miss stretch. They run BEFORE
  // the moment top-up so topped-up moments anchor only on surviving camera
  // moves and final (post-stretch) timing, and they commit ATOMICALLY below:
  // the normalized plan is kept only when it validates clean — a fix for the
  // pacing arithmetic that mints a DIFFERENT blocking finding (the
  // framing-density floor, an explicit brief requirement like minCameraMoves,
  // moment spacing, the 60s film cap) reverts to the model's own artifact so
  // the findings-retry describes what the model actually wrote (the
  // degradeVolunteeredBridgedCuts commit-only-if-clean precedent).
  const preNormalization = storyboard;
  const morphFix = reconcileUndeclaredMorphTargets(storyboard);
  const cameraBudget = normalizeCameraBudget(morphFix.scenes);
  const moveDelay = delayConflictingCameraMoves(cameraBudget.storyboard);
  const pacingStretch = stretchMarginalPacingMisses(moveDelay.storyboard);
  const normalizationLines = [
    ...morphFix.changed,
    ...cameraBudget.normalized,
    ...moveDelay.normalized,
    ...pacingStretch.normalized,
  ];
  if (normalizationLines.length) storyboard = pacingStretch.storyboard;

  // Moment paperwork the plan already proves is filled in by the host, not
  // retried: a marginal dead interval that has a typed beat/camera/cut in it
  // was the dominant live storyboard-stage veto (2026-07-04 incident).
  const topUpMoments = (plan: DirectScene[]): DirectScene[] => {
    const topped = topUpStoryboardMoments(plan, CAMERA_FULL_MOVES);
    if (!topped.added.length) return plan;
    process.stderr.write(
      `[storyboard] topped up ${topped.added.length} moment(s) from typed evidence: ` +
        `${topped.added.map((moment) => `${moment.id}@${moment.atSec.toFixed(1)}s`).join(", ")}\n`,
    );
    return topped.storyboard;
  };
  // Degrade-never-veto for pacing on LATE attempts: pacing findings are
  // polish-grade (they never abort a compile or ship a dead film), and two
  // live probes (2026-07-05) showed both planner models playing whack-a-mole
  // with marginal holds across every retry — each attempt redesigns the
  // storyboard, fixes the old findings, and mints new marginal ones, until
  // the run dies at plan time over a rushed toast while triggering the far
  // worse deterministic fallback. Attempts 1-2 keep full blocking pressure
  // (the findings-retry is still the delivery mechanism); from the primary
  // rung's final attempt onward a plan that is clean EXCEPT for pacing ships
  // with the findings logged as advisories.
  const resolveErrors = (plan: DirectScene[]): string[] => {
    let errors = validateStoryboardPlan(plan, requirements);
    if (options.degradePacingFindings) {
      // Exit-discipline (WS4) and cut-coherence (WS6) findings are polish-grade
      // in exactly the same sense as pacing — a stacked overlay or a style zoo
      // never aborts a compile or ships a dead film — so they ride the same
      // late-attempt demotion to keep a plan clean except for polish from
      // triggering the far worse fallback.
      const isPolish = (finding: string): boolean =>
        finding.startsWith("pacing/") ||
        finding.startsWith("components/exit:") ||
        finding.startsWith("cuts/coherence:");
      const polish = errors.filter(isPolish);
      if (polish.length) {
        errors = errors.filter((finding) => !isPolish(finding));
        for (const line of polish) {
          process.stderr.write(
            `[storyboard] polish finding accepted as advisory on a final attempt: ${line}\n`,
          );
          degradations.push(`storyboard-polish-advisory:${findingSignature(line)}`);
        }
      }
    }
    return errors;
  };

  storyboard = topUpMoments(storyboard);
  let errors = resolveErrors(storyboard);
  if (normalizationLines.length && errors.length) {
    // The normalized plan still fails validation. COMMIT anyway when every
    // remaining finding belongs to a class the model's OWN plan already had
    // (digit-stripped comparison, so re-timed instances of the same class
    // match): the arithmetic fixes stand, the retry list shrinks to the real
    // deficits, and the findings describe the plan the retry baseline carries.
    // REVERT when the normalization MINTED a finding class the model never
    // earned (minCameraMoves after a clamp, moment spacing after a stretch…)
    // — the model's own findings are the honest retry input then. This is the
    // 2026-07-06 probe lesson: the old commit-only-if-fully-clean rule meant
    // normalizations never committed (every probe plan also carried a moments
    // deficit) and the model had to re-fix host-fixable arithmetic each retry.
    const classKey = (finding: string): string => finding.replace(/\d+(?:\.\d+)?/g, "#");
    const originalPlan = topUpMoments(preNormalization);
    const originalErrors = resolveErrors(originalPlan);
    const originalKeys = new Set(originalErrors.map(classKey));
    const introduced = errors.filter((finding) => !originalKeys.has(classKey(finding)));
    if (introduced.length) {
      process.stderr.write(
        `[storyboard] sentinel-normalization reverted (it would mint a new finding ` +
          `class: ${introduced[0]})\n`,
      );
      storyboard = originalPlan;
      errors = originalErrors;
      normalizationLines.length = 0;
    }
  }
  if (normalizationLines.length) {
    for (const line of normalizationLines) {
      process.stderr.write(`[storyboard] sentinel-normalized: ${line}\n`);
    }
    if (morphFix.changed.length) {
      recordSentinelNormalization("morph-twin-reconcile", morphFix.changed.length);
    }
    if (cameraBudget.normalized.length) {
      recordSentinelNormalization("camera-budget-clamp", cameraBudget.normalized.length);
    }
    if (moveDelay.normalized.length) {
      recordSentinelNormalization("camera-move-delay", moveDelay.normalized.length);
    }
    if (pacingStretch.normalized.length) {
      recordSentinelNormalization("pacing-stretch", pacingStretch.normalized.length);
    }
  }
  if (errors.length) throw new StoryboardValidationError(errors, storyboard);
  acceptedStoryboardDegradations.set(storyboard, [...new Set(degradations)]);
  return storyboard;
}

export function parseCompositionResponse(raw: string): DirectCompositionDraft {
  return {
    storyboard: parseStoryboard(tagged(raw, "storyboard_json")),
    html: extractIndexHtmlSource(raw),
  };
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
  if (process.env.SLACK_SEQUENCES_CONCEPT_PASS === "0") return undefined;
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
  if (process.env.SLACK_SEQUENCES_SHARED_PLANNING_CACHE === "0") return undefined;
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

export interface StoryboardShape {
  id: string;
  /** Segment skeleton, human-readable. */
  label: string;
  /** What kind of brief this shape serves. */
  best: string;
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
  },
  {
    id: "hook-demo-payoff",
    label: "cold hook (short) → guided product demo (long, held & developed) → payoff metric + CTA (medium)",
    best: "feature launches whose UI walkthrough is the star",
  },
  {
    id: "stat-proof-tour",
    label: "hero stat (medium) → proof tour across product surfaces (long, one held framing per surface) → brand resolve (short)",
    best: "metric- or performance-led stories",
  },
  {
    id: "feature-triptych",
    label: "three feature vignettes (equal, medium) → unifying claim + CTA (medium)",
    best: "multi-feature releases with no single hero feature",
  },
  {
    id: "before-after",
    label: "before state (medium) → transformation beat (short) → after state (medium) → CTA (short)",
    best: "workflow-transformation stories with a clear old-way/new-way contrast",
  },
  {
    id: "crescendo-reveal",
    label: "quiet claim (short) → building evidence (medium) → energetic peak reveal (medium) → still resolve (short)",
    best: "brand-forward launches built around one big reveal",
  },
];

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
  if (process.env.SLACK_SEQUENCES_SHAPE_HINT === "0") return undefined;
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
          minCameraMoves: 2,
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
  details: { rung: string; findings?: string[]; raw?: string },
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

export async function requestStoryboardPlan(
  provider: AgentProvider,
  args: {
    brief: string;
    projectDir: string;
    skills: RetrievedSkillContext;
    frameMd?: string;
    targetDurationSec?: number;
    options?: CompleteOptions;
    /** Out-param: written each attempt so stage receipts can report retries. */
    attempts?: { count: number };
  },
): Promise<DirectScene[]> {
  const structuredOutput = supportsStructuredOutputs(provider);
  const model = storyboardModel(provider);
  const thinkingMode = storyboardThinkingMode(provider, model);
  const requirements = inferStoryboardPlanRequirements(
    args.brief,
    args.targetDurationSec,
  );
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
    // invalidates plans that could now use it.
    contract: 14,
    provider: provider.id,
    model: model ?? null,
    brief: args.brief,
    frameMd: args.frameMd ?? null,
    concept: concept ?? null,
    shape: shapeHint?.shape.id ?? null,
    requirements,
    registryVersion: args.skills.registryVersion,
    blueprints: args.skills.blueprintIds,
    recipesVersion: recipesEnabled() ? loadRecipeLibrary().version : "off",
    recipeIds: args.skills.recipeIds ?? [],
  })).digest("hex");
  const planningDir = path.join(args.projectDir, "planning");
  const cacheFile = path.join(planningDir, "storyboard.json");
  const sharedFile = sharedPlanningCacheFile(args.projectDir, "storyboard", cacheKey);
  for (const candidate of [cacheFile, sharedFile]) {
    const cached = readPlanningArtifact(candidate, cacheKey) as
      | { storyboard?: DirectScene[]; degradations?: string[] }
      | undefined;
    if (cached?.storyboard) {
      const errors = validateStoryboardPlan(cached.storyboard, requirements);
      if (!errors.length) {
        for (const degradation of cached.degradations ?? []) {
          recordSentinelDegradation(degradation);
        }
        if (candidate === sharedFile) {
          process.stderr.write(
            "[storyboard] reusing already-paid storyboard from the shared planning cache\n",
          );
          writePlanningArtifact(cacheFile, {
            version: 1,
            key: cacheKey,
            storyboard: cached.storyboard,
            degradations: cached.degradations ?? [],
          });
        }
        return cached.storyboard;
      }
    }
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
    "ONE focal element at a time: secondary detail may coexist, but only one",
    "thing commands motion at any moment; two beats that yank the eye across",
    "the frame within ~1.2s read as noise, not richness.",
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
    "(subtle 2.5D arc), orbit (a true 3D arc around the framed subject,",
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
    "film's showpiece transitions: search→command-palette, card→modal,",
    "table→list. Use 1-2 morphs per film where the story earns them, never",
    "decoratively. A morph beat's morphTo must name a component DECLARED in",
    "the same shot's components array — always declare BOTH twins (e.g. the",
    "search AND the command-palette) or the plan is rejected.",
    "Beats are host-compiled, so declaring them costs the source",
    "budget nothing — prefer typed beats over prose asks for UI motion.",
    "COMPONENT BUDGET — components are the expensive resource (the author must",
    "build full product markup for every one, and the viewer must read it):",
    "at most 1 component per ~1.2s of its scene (never more than 4 per scene)",
    "and about 1 per 2s of film overall. One component carrying three beats is",
    "ALWAYS better than three components carrying one beat each. Never declare",
    "a component that exists only as set dressing.",
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
    "- morph (one thing BECOMES another): two DIFFERENT elements whose",
    "  silhouettes rhyme — a search pill lands as a status bar, a window becomes",
    "  a card — swap across the boundary through a crossfading bridge. Requires",
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
    ...(shapeHint
      ? [
          "## Narrative shape (template-selected pacing skeleton)",
          `A structural pre-pass chose "${shapeHint.shape.id}" for this brief` +
            `${shapeHint.why ? ` (${shapeHint.why})` : ""}:`,
          `  ${shapeHint.shape.label}`,
          "Use it as the DEFAULT segment order and duration weighting when you",
          "distribute shots. It is pacing scaffolding, not creative direction:",
          "deviate whenever the brief evidence or the concept demands a",
          "different structure, and it never overrides the moments, density,",
          "or energy contracts.",
          "",
        ]
      : []),
    storyboardReference(args.skills.text),
    "",
    "## Brief and trusted evidence",
    args.brief,
    "",
    args.frameMd
      ? `## Job frame capsule\nUse its visual thesis, palette/type constraints, and spatial character without constraining motion.\n<frame_capsule>\n${frameCapsule(args.frameMd)}\n</frame_capsule>`
      : "",
    "",
    "## Available project-local assets",
    availableAssets(args.projectDir),
    "",
    "## Response contract",
    structuredOutput
      ? 'Return only a JSON object with one "storyboard" array. No tags, Markdown, or prose.'
      : "Return only <storyboard_json> containing a JSON array. No Markdown or prose.",
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
    '"region":"optional camera region it lives at","role":"hero|support"}],',
    '"beats":[{"version":1,"id":"kebab-case","component":"declared component id","kind":"type|open|close|select|press|set-state|count|progress|chart|rows|stream|highlight|morph|swap",',
    '"atSec":2.4,"durationSec":1.1,"text":"for type/stream/swap","value":40,"item":2,',
    '"toState":"for set-state/press","morphTo":"for morph","ease":"optional",',
    '"style":"optional: type→typewriter|rise|pop|assemble, open→pop (compact kinds), highlight→ring|sweep|underline"}],',
    "Beat atSec values are absolute composition seconds inside the shot window.",
    'Use "components":[] and "beats":[] when a shot has no product surface.',
    '"recipes":[{"version":1,"id":"library recipe id","params":[{"name":"slot","value":"…"}]}]',
    "— declare a retrieved proven recipe (see the recipe section above when",
    "present) on the shot it belongs to; the host injects its proven",
    "markup+motion verbatim with your param values, costing zero authoring",
    'budget. Use "recipes":[] when no library recipe fits the shot.',
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
    "version,id,sceneId,cursorId,targetPart,action,startSec,arriveSec,from,path,",
    "aimX,aimY,feedback and action-specific pressSec/releaseSec/holdUntilSec,",
    "ripplePart or dragTargetPart. ripplePart is mandatory for ripple or",
    "press-ripple feedback; dragTargetPart is mandatory for drag. Times are",
    "absolute composition seconds.",
    "Plan at most one cursor interaction per shot. Its targetPart (and ripplePart",
    "when present) must be a unique semantic name that the author can bind",
    "verbatim to exactly one element; never target a repeated collection item.",
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
    { label: "primary", ...(model ? { model } : {}), thinkingMode, maxAttempts: 3 },
    ...(rescue
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
  for (const rung of rungs) {
    let recoveringFromTruncation = false;
    let reasoningFloor: CompleteOptions["thinkingMode"] | undefined;
    const rungMaxTokens =
      rung.thinkingMode === "none" ? STORYBOARD_MAX_TOKENS : REASONING_STORYBOARD_MAX_TOKENS;
    attempts: for (let attempt = 1; attempt <= rung.maxAttempts; attempt += 1) {
      totalAttempts += 1;
      if (args.attempts) args.attempts.count = totalAttempts;
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
                        ({ sentinelNormalizations: _notes, ...scene }) => scene,
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
          process.stderr.write(
            `[storyboard] ${rung.label} attempt ${attempt} exhausted its completion budget; ` +
              `retrying the bounded artifact with lower reasoning effort\n`,
          );
          continue;
        }
        if (attempt < rung.maxAttempts && isReasoningMandatoryError(error)) {
          reasoningFloor = "minimal";
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
        process.stderr.write(
          `[storyboard] ${rung.label} model unavailable: ` +
            `${error instanceof Error ? error.message.slice(0, 300) : String(error)}\n`,
        );
        break attempts;
      }
      let storyboard: DirectScene[];
      try {
        storyboard = parseStoryboardResponse(raw, requirements, {
          // Degrade only on the FINAL storyboard attempt of the FINAL rung: a
          // hopeless volunteered pair degraded on the primary rung's last
          // attempt would return immediately and the independent rescue model
          // (which might re-point the cut at rhyming endpoints and save the
          // premium morph) would never be consulted.
          degradeShapeHintMismatches:
            rung === rungs[rungs.length - 1] && attempt === rung.maxAttempts,
          // Pacing pressure stays blocking for the first two primary
          // attempts, then degrades to advisory: from the primary rung's
          // final attempt onward (including every rescue attempt), a plan
          // clean except for pacing ships instead of falling back.
          degradePacingFindings:
            rung !== rungs[0] || attempt === rung.maxAttempts,
        });
      } catch (error) {
        if (error instanceof Error && isOutputTruncation(error)) {
          // A truncated artifact detected at parse time (opened-but-unclosed
          // wrapper) is the same failure as a provider-reported truncation.
          persistStoryboardAttempt(args.projectDir, totalAttempts, "truncated", {
            rung: rung.label,
            raw,
          });
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
            !artifactGraceUsed &&
            /missing <storyboard_json>/.test(error.message)
          ) {
            artifactGraceUsed = true;
            persistStoryboardAttempt(args.projectDir, totalAttempts, "artifact-missing", {
              rung: rung.label,
              raw,
            });
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
          persistStoryboardAttempt(args.projectDir, totalAttempts, "rejected", {
            rung: rung.label,
            raw,
            findings: error.message
              .replace(/^invalid storyboard plan:\s*/i, "")
              .split("; "),
          });
          process.stderr.write(
            `[storyboard] ${rung.label} attempt ${attempt} rejected: ` +
              `${error.message.slice(0, 600)} — ${
                attempt < rung.maxAttempts ? "retrying with findings" : "carrying findings forward"
              }\n`,
          );
          continue;
        }
        lastError = error;
        break attempts;
      }
      const degradations = acceptedStoryboardDegradations.get(storyboard) ?? [];
      for (const degradation of degradations) {
        recordSentinelDegradation(degradation);
      }
      writePlanningArtifact(cacheFile, { version: 1, key: cacheKey, storyboard, degradations });
      writePlanningArtifact(sharedFile, { version: 1, key: cacheKey, storyboard, degradations });
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

interface CompositionPatch {
  search: string;
  replace: string;
}

type PatchLocation =
  | { kind: "ok"; start: number; end: number }
  | { kind: "missing" }
  | { kind: "ambiguous" };

/**
 * Find where a repair patch applies. Exact byte match wins. When that misses —
 * overwhelmingly because the model reflowed indentation or newlines in the search
 * snippet while keeping the substantive characters right — fall back to a
 * whitespace-flexible match: every run of whitespace in the search matches any run
 * in the source. The exactness guarantees are preserved: a fallback only applies
 * when it resolves to exactly one span, so we never silently edit the wrong place.
 */
function locatePatch(html: string, search: string): PatchLocation {
  const first = html.indexOf(search);
  if (first >= 0) {
    return html.indexOf(search, first + search.length) >= 0
      ? { kind: "ambiguous" }
      : { kind: "ok", start: first, end: first + search.length };
  }
  const trimmed = search.trim();
  if (!trimmed) return { kind: "missing" };
  const pattern = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  let matches: RegExpMatchArray[];
  try {
    matches = [...html.matchAll(new RegExp(pattern, "g"))];
  } catch {
    return { kind: "missing" };
  }
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "ambiguous" };
  const match = matches[0]!;
  return { kind: "ok", start: match.index!, end: match.index! + match[0].length };
}

/**
 * First inline-script syntax error in a document, mirroring the vendored
 * lint's `invalid_inline_script_syntax` rule (same script filter, same
 * `new Function` parse) so the per-patch gate below never disagrees with the
 * gate that would later reject the whole attempt.
 */
function inlineScriptSyntaxError(html: string): string | undefined {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] ?? "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (
      /\btype\s*=\s*["'](?:application\/json|application\/hyperframes-slideshow\+json|importmap|module)["']/
        .test(attrs)
    ) {
      continue;
    }
    const content = match[2] ?? "";
    if (!content.trim()) continue;
    try {
      // eslint-disable-next-line no-new-func — parse-only, never executed.
      new Function(content);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return undefined;
}

export function applyCompositionRepair(
  raw: string,
  scratch: DirectCompositionDraft,
): DirectCompositionDraft {
  // Some models ignore patch mode and return a complete replacement document.
  // It is still safe to recover: the normal static and browser validation gates
  // run immediately after this function, and the prior scratch stays available.
  const replacementHtml = firstHtmlDocument(raw);
  if (replacementHtml) {
    process.stderr.write(
      "[author] repair returned a complete document; recovered it for validation\n",
    );
    return { storyboard: scratch.storyboard, html: replacementHtml };
  }
  let value: unknown;
  try {
    const bareArray = firstJsonArray(raw);
    value =
      structuredArray(raw, "patches") ??
      (bareArray ? JSON.parse(bareArray) : JSON.parse(tagged(raw, "patches_json")));
  } catch (error) {
    throw new Error(
      `patches_json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REPAIR_PATCHES) {
    throw new Error(`patches_json must contain 1-${MAX_REPAIR_PATCHES} exact edits`);
  }
  const patches = value as CompositionPatch[];
  let html = scratch.html;
  let applied = 0;
  const rejected: string[] = [];
  // Per-patch syntax gate: a single edit that breaks an inline script's parse
  // reverts THAT edit instead of costing the whole attempt atomically (a
  // partial repair that fixes 3 findings is strictly better than a lost
  // attempt — the verify-ws1ws5-2 fallback ended exactly on this class). A
  // scratch that already fails the parse cannot be gated against itself.
  const gateScriptSyntax = inlineScriptSyntaxError(html) === undefined;
  for (const [index, patch] of patches.entries()) {
    if (
      !patch ||
      typeof patch.search !== "string" ||
      typeof patch.replace !== "string" ||
      !patch.search
    ) {
      rejected.push(
        `patches_json[${index}] must contain non-empty search and string replace`,
      );
      continue;
    }
    const located = locatePatch(html, patch.search);
    if (located.kind === "missing") {
      rejected.push(`patches_json[${index}].search was not found in scratch HTML`);
      continue;
    }
    if (located.kind === "ambiguous") {
      rejected.push(`patches_json[${index}].search is not unique in scratch HTML`);
      continue;
    }
    const candidate = html.slice(0, located.start) + patch.replace + html.slice(located.end);
    if (gateScriptSyntax) {
      const syntaxError = inlineScriptSyntaxError(candidate);
      if (syntaxError) {
        rejected.push(
          `patches_json[${index}] would break an inline script's syntax ` +
            `(${syntaxError.slice(0, 120)}) — reverted`,
        );
        continue;
      }
    }
    html = candidate;
    applied += 1;
  }
  if (applied === 0) {
    throw new Error(rejected[0] ?? "patches_json contained no applicable edits");
  }
  if (rejected.length) {
    process.stderr.write(
      `[author] applied ${applied}/${patches.length} safe patches; skipped ` +
        `${rejected.length}: ${rejected.slice(0, 3).join(" | ")}\n`,
    );
  }
  return { storyboard: scratch.storyboard, html };
}

/**
 * Optional interaction choreography must not be able to veto a healthy film.
 *
 * The model still gets bounded attempts to repair authored target/cursor
 * geometry. If browser evidence proves that a particular interaction remains
 * invalid, remove only that typed enhancement from both canonical stores. The
 * visual composition, timeline, spatial intent, and every healthy interaction
 * remain byte-for-byte unchanged and are validated again before publication.
 */
export function quarantineFailedInteractions(
  draft: DirectCompositionDraft,
  issues: DirectLayoutIssue[],
): { draft: DirectCompositionDraft; removedIds: string[] } {
  const removedIds = [...new Set(
    issues
      .filter((issue) =>
        issue.severity === "error" &&
        issue.code.startsWith("interaction_") &&
        Boolean(issue.interactionId)
      )
      .map((issue) => issue.interactionId!),
  )].sort();
  if (!removedIds.length) return { draft, removedIds: [] };

  const removed = new Set(removedIds);
  const storyboard: DirectScene[] = draft.storyboard.map((scene): DirectScene => {
    if (!scene.interactions?.some((interaction) => removed.has(interaction.id))) {
      return scene;
    }
    const interactions = scene.interactions.filter(
      (interaction) => !removed.has(interaction.id),
    );
    const { interactions: _discarded, ...withoutInteractions } = scene;
    return interactions.length ? { ...scene, interactions } : withoutInteractions;
  });
  const interactions = storyboard.flatMap((scene) => scene.interactions ?? []);
  const payload = JSON.stringify({ version: 1, interactions });
  const island = normalizeJsonIsland(draft.html, "sequences-interactions", payload);
  if (!island.found) {
    // Static validation will reject the unchanged mismatch; do not pretend the
    // enhancement was isolated when its canonical island was absent.
    return { draft, removedIds: [] };
  }
  let html = island.html;
  const liveCursorIds = new Set(interactions.map((interaction) => interaction.cursorId));
  const orphanCursorIds = draft.storyboard
    .flatMap((scene) => scene.interactions ?? [])
    .filter((interaction) => removed.has(interaction.id))
    .map((interaction) => interaction.cursorId)
    .filter((cursorId) => !liveCursorIds.has(cursorId));
  if (orphanCursorIds.length) {
    const selectors = [...new Set(orphanCursorIds)]
      .map((cursorId) =>
        `[data-cursor-id="${cursorId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
      )
      .join(",");
    html = html.replace(
      /<\/head>/i,
      `<style data-sequences-quarantine>${selectors}{display:none!important}</style></head>`,
    );
  }
  return { draft: { storyboard, html }, removedIds };
}

function browserInteractionIssues(
  draft: DirectCompositionDraft,
  browserQa: DirectBrowserQaResult,
): DirectLayoutIssue[] {
  const issues = [...browserQa.issues];
  if (
    !browserQa.errors.some((error) =>
      /unsupported sequences interaction plan|could not bind interaction|cursor "[^"]+" must be inside data-camera-overlay/i
        .test(error)
    )
  ) {
    return issues;
  }
  const alreadyScoped = new Set(
    issues
      .filter((issue) => issue.code.startsWith("interaction_") && issue.interactionId)
      .map((issue) => issue.interactionId!),
  );
  for (const interaction of draft.storyboard.flatMap((scene) => scene.interactions ?? [])) {
    if (alreadyScoped.has(interaction.id)) continue;
    issues.push({
      code: "interaction_runtime_plan",
      severity: "error",
      time: interaction.startSec,
      interactionId: interaction.id,
      selector: `[interaction="${interaction.id}"]`,
      message: "Optional interaction plan failed browser runtime compilation.",
      fixHint: "Publish the film without this optional cursor choreography.",
      source: "sequences",
    });
  }
  return issues;
}

function quarantineStaticInteractionErrors(
  draft: DirectCompositionDraft,
  errors: string[],
): { draft: DirectCompositionDraft; removedIds: string[] } | undefined {
  const interactions = draft.storyboard.flatMap((scene) => scene.interactions ?? []);
  if (!interactions.length || !errors.length) return undefined;
  const interactionError = (error: string): boolean =>
    /^(?:interaction\b|storyboard declares .*interactions|HTML bind(?:s|ing)\b|duplicate interaction id\b|sequences-interactions\b|interaction composition must\b)/i
      .test(error);
  if (!errors.every(interactionError)) return undefined;
  const knownIds = new Set(interactions.map((interaction) => interaction.id));
  const mentionedIds = new Set<string>();
  let hasGeneralContractError = false;
  for (const error of errors) {
    const id = error.match(
      /(?:interaction|HTML binds undeclared interaction|HTML binding for interaction)\s+"([^"]+)"/i,
    )?.[1];
    if (id && knownIds.has(id)) mentionedIds.add(id);
    else hasGeneralContractError = true;
  }
  const removeIds = hasGeneralContractError || !mentionedIds.size
    ? [...knownIds]
    : [...mentionedIds];
  return quarantineFailedInteractions(
    draft,
    removeIds.map((interactionId): DirectLayoutIssue => ({
      code: "interaction_static_contract",
      severity: "error",
      time: 0,
      interactionId,
      selector: `[interaction="${interactionId}"]`,
      message: "Optional interaction failed the static publication contract.",
      fixHint: "Publish the visual film without this optional interaction.",
      source: "sequences",
    })),
  );
}

async function recoverByQuarantiningInteractions(
  projectDir: string,
  candidate: {
    draft: DirectCompositionDraft;
    raw: string;
    browserQa: DirectBrowserQaResult;
  },
): Promise<
  | { result: CompositionRunResult; browserQa: DirectBrowserQaResult }
  | undefined
> {
  const quarantined = quarantineFailedInteractions(
    candidate.draft,
    browserInteractionIssues(candidate.draft, candidate.browserQa),
  );
  if (!quarantined.removedIds.length) return undefined;
  process.stderr.write(
    `[author] quarantining ${quarantined.removedIds.length} persistently invalid optional ` +
      `interaction(s): ${quarantined.removedIds.join(", ")}\n`,
  );
  const validation = await validateDirectComposition(projectDir, quarantined.draft);
  if (!validation.ok) return undefined;
  const browserQa = await inspectDirectComposition(projectDir, quarantined.draft, {
    captureGuide: false,
  });
  if (!browserQa.ok && !browserQa.infraError) return undefined;
  return {
    result: {
      draft: quarantined.draft,
      raw: candidate.raw,
      attempts: 3,
      browserQa,
    },
    browserQa,
  };
}

/**
 * Codes the operator reads as "messy" on the shipped film (WS6 shipping
 * policy): a clipped or near-empty camera landing, a degraded declared morph,
 * or an eye-trace jump. They outweigh a handful of minor warnings so the
 * least-bad-draft pick at attempt 3 strongly prefers a film without them —
 * never unpublishable (fallback pressure is worse), just heavily dispreferred.
 */
const HIGH_VISIBILITY_ISSUE_WEIGHTS: Record<string, number> = {
  camera_framed_clipped: 10,
  camera_framed_sparse: 6,
  cut_degraded: 6,
  eye_trace_jump: 6,
};

function browserQualityPenalty(
  browserQa: DirectBrowserQaResult,
  staticRepairWarnings: string[] = [],
): number {
  const runtimeWarnings = browserQa.warnings.filter((warning) =>
    warning.startsWith("browser_warning:")
  ).length;
  return staticRepairWarnings.length * 2 + runtimeWarnings * 2 +
    browserQa.issues.reduce(
      (total, issue) =>
        total + (
          HIGH_VISIBILITY_ISSUE_WEIGHTS[issue.code] ??
          (issue.severity === "error" ? 4 : issue.severity === "warning" ? 1 : 0)
        ),
      0,
    );
}

const SENTINEL_BLOCKING_BY_PREFIX = SENTINEL_CONTRACT.flatMap((row) =>
  row.findingPrefixes.map((prefix) => ({ prefix, blocking: row.blocking }))
);

const EARLY_LEAST_BAD_MAX_PENALTY = (() => {
  const raw = Number(process.env.SLACK_SEQUENCES_EARLY_LEAST_BAD_MAX_PENALTY);
  return Number.isFinite(raw) && raw >= 0 ? raw : 4;
})();

function sentinelBlockingForFinding(finding: string): SentinelBlocking | undefined {
  const normalized = finding.trim();
  return SENTINEL_BLOCKING_BY_PREFIX.find((entry) =>
    normalized.startsWith(entry.prefix)
  )?.blocking;
}

function isMomentStaticFrameFinding(finding: string): boolean {
  return finding.trim().startsWith("moment_static_frame");
}

function hasHardLivenessOrBlankIssue(browserQa: DirectBrowserQaResult): boolean {
  return (browserQa.errors ?? []).some((entry) =>
    entry.startsWith("near_blank_film:") ||
    entry.startsWith("motion/liveness") ||
    entry.includes("motion/liveness")
  );
}

/**
 * Browser feedback for paid source retries. `moment_static_frame` is rendered
 * temporal-judge polish: useful operator evidence, but not a source retry
 * cause unless the same draft has a hard liveness/blank-frame defect.
 */
export function sourceRetryFeedbackForBrowserQa(
  browserQa: DirectBrowserQaResult,
  staticRepairWarnings: string[] = [],
): string[] {
  const keepMomentStatic = hasHardLivenessOrBlankIssue(browserQa);
  return dedupeFeedbackBySignature([
    ...staticRepairWarnings,
    ...(browserQa.errors ?? []),
    ...(browserQa.warnings ?? []).filter((warning) =>
      keepMomentStatic || !isMomentStaticFrameFinding(warning)
    ),
  ]);
}

function staticWarningBlocksEarlyLeastBad(warning: string): boolean {
  const blocking = sentinelBlockingForFinding(warning);
  return blocking !== "advisory" && blocking !== "advisory-late";
}

function browserIssueBlocksEarlyLeastBad(issue: DirectLayoutIssue): boolean {
  if (issue.severity === "info") return false;
  if (issue.code === "moment_static_frame") return false;
  if (HIGH_VISIBILITY_ISSUE_WEIGHTS[issue.code] !== undefined) return true;
  const blocking = sentinelBlockingForFinding(issue.code);
  if (blocking === "advisory" || blocking === "advisory-late") return false;
  return true;
}

/**
 * Attempt-2 budget broker: publish a banked browser-valid draft early only
 * when the remaining findings are low-penalty advisory/polish classes. This
 * saves the third paid author pass without weakening hard runtime, blank-film,
 * interaction, or high-visibility visual gates.
 */
export function earlyLeastBadPublishReason(
  candidate: CompositionRunResult & { qualityPenalty: number },
): string | undefined {
  const browserQa = candidate.browserQa;
  if (!browserQa || !browserQa.ok || browserQa.infraError) return undefined;
  if (candidate.qualityPenalty > EARLY_LEAST_BAD_MAX_PENALTY) return undefined;
  if ((browserQa.warnings ?? []).some((warning) => warning.startsWith("browser_warning:"))) {
    return undefined;
  }
  if ((candidate.staticRepairWarnings ?? []).some(staticWarningBlocksEarlyLeastBad)) {
    return undefined;
  }
  if ((browserQa.issues ?? []).some(browserIssueBlocksEarlyLeastBad)) return undefined;
  const codes = [
    ...new Set([
      ...(browserQa.issues ?? []).map((issue) => issue.code),
      ...(candidate.staticRepairWarnings ?? []).map((warning) =>
        warning.split(/\s+/, 1)[0] ?? "static-warning"
      ),
    ]),
  ];
  return `early-least-bad-pick:penalty=${candidate.qualityPenalty};findings=${
    codes.length ? codes.join(",") : "polish"
  }`;
}

/**
 * Sentinel Phase 3 critic gating: a draft the deterministic gates already
 * love has nothing for the continuity critic to repair, so its 1-2 paid
 * calls (~1-2 min) are pure latency. "Already loved" = a browser-QA pass ran
 * (not an infra outage), it is `strictOk` (no polish finding requested a
 * repair), and its quality penalty is zero (no weighted issue, no browser
 * console warning). Every declared moment is necessarily bound too — an
 * unbound moment fails `validateDirectComposition` upstream, so any draft that
 * reaches the critic has already cleared the moment contract. Conservative by
 * construction: anything less than pristine still runs the critic.
 */
export function criticSkippableCleanDraft(
  browserQa: DirectBrowserQaResult | undefined,
  staticRepairWarnings: string[] = [],
): boolean {
  if (!browserQa || browserQa.infraError) return false;
  return browserQa.strictOk && browserQualityPenalty(browserQa, staticRepairWarnings) === 0;
}

function availableAssets(projectDir: string): string {
  const assetsDir = path.join(projectDir, "assets");
  if (!fs.existsSync(assetsDir)) return "No project assets are available.";
  const files = fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `- assets/${entry.name}`);
  return files.length ? files.join("\n") : "No project assets are available.";
}

/**
 * The markup contract for exactly the component kinds these scenes declare.
 * Empty when no scene declares components, so plain films pay no prompt cost.
 */
function componentReferenceFor(scenes: DirectScene[] | undefined): string {
  const kinds = new Set<ComponentKind>();
  for (const scene of scenes ?? []) {
    for (const component of scene.components ?? []) kinds.add(component.kind);
  }
  return kinds.size ? componentAuthoringReference(kinds) : "";
}

/**
 * Deterministic placement text for scenes whose storyboard pinned camera
 * stations to world grid cells. Free placement is the main source of
 * clipping and off-camera stations; exact rects remove the guesswork
 * without any schema change on the author's side.
 */
function worldLayoutGuidance(scenes: DirectScene[]): string {
  const blocks = scenes
    .filter((scene) => scene.worldLayout?.length)
    .map((scene) => {
      const cells = scene.worldLayout!;
      const xs = cells.map((entry) => entry.cell[0]);
      const ys = cells.map((entry) => entry.cell[1]);
      // Cell [0,0] is the entry framing and always part of the plane.
      const minX = Math.min(...xs, 0);
      const minY = Math.min(...ys, 0);
      const planeW = (Math.max(...xs, 0) - minX + 1) * 1920;
      const planeH = (Math.max(...ys, 0) - minY + 1) * 1080;
      const rows = cells.map(({ region, cell }) => {
        const left = (cell[0] - minX) * 1920 + 260;
        const top = (cell[1] - minY) * 1080 + 140;
        return `  - data-region="${region}": position:absolute; left:${left}px; top:${top}px; ` +
          `width:1400px; height:800px — keep its content inside with at least an 8% inner margin`;
      });
      return [
        `- scene "${scene.id}": size its data-camera-world plane exactly ` +
          `${planeW}x${planeH}px and place each station at these rects:`,
        ...rows,
      ].join("\n");
    });
  if (!blocks.length) return "";
  return [
    "## World-layout station map (deterministic placement)",
    "The locked storyboard pinned each camera station to a viewport-sized grid",
    "cell. Use these exact plane sizes and station rects verbatim — they",
    "guarantee stations never clip each other or drift half out of frame:",
    ...blocks,
  ].join("\n");
}

/**
 * Small always-on layout reminders derived from the locked storyboard —
 * the cheap deterministic guardrails that otherwise cost a repair round.
 */
function lockedLayoutGuidance(scenes: DirectScene[]): string {
  const lines = [
    "## Layout guidance (derived from the locked storyboard)",
    "- Keep primary content inside the 5% safe area of its framing. Content at",
    "  a camera station must fit that station's box; never let two stations'",
    "  content overlap on the plane.",
  ];
  const morphPairs = scenes.flatMap((scene) =>
    (scene.beats ?? [])
      .filter((beat) => beat.kind === "morph" && beat.morphTo)
      .map((beat) => `${beat.component}→${beat.morphTo}`)
  );
  if (morphPairs.length) {
    lines.push(
      `- Morph twins (${[...new Set(morphPairs)].join(", ")}) need comparable box`,
      "  shapes, corner radii, and visual weight so the FLIP reads as one object",
      "  transforming rather than a jump.",
    );
  }
  const shapePairs = scenes.flatMap((scene) =>
    (scene.cut?.style === "morph" || scene.cut?.style === "shape-match") &&
      scene.cut.focalPartOut && scene.cut.focalPartIn
      ? [`${scene.cut.focalPartOut}→${scene.cut.focalPartIn}`]
      : []
  );
  if (shapePairs.length) {
    lines.push(
      `- Morph focal parts (${[...new Set(shapePairs)].join(", ")}) must keep`,
      "  comparable aspect ratios and border radii (within ~2.5×) and light",
      "  subtrees (≤60 nodes) or the boundary degrades to a swipe at bind",
      "  time. Keep both parts on-frame at their scene's entry framing.",
    );
  }
  const focusScenes = scenes.filter((scene) =>
    scene.camera?.path.some((move) => move.focus)
  );
  if (focusScenes.length) {
    lines.push(
      `- Scenes ${focusScenes.map((scene) => `"${scene.id}"`).join(", ")} plan a rack-focus`,
      "  pull: build each with 2+ data-depth layers (context plane ~0.3, payoff",
      "  on the world plane) and author any focus.part as a scene-scoped",
      "  data-part. The rig owns all blur.",
    );
  }
  const orbitScenes = scenes.filter((scene) =>
    scene.camera?.path.some((move) => move.move === "orbit")
  );
  if (orbitScenes.length) {
    lines.push(
      `- Scenes ${orbitScenes.map((scene) => `"${scene.id}"`).join(", ")} orbit in 3D:`,
      "  keep them graphic (logo, hero UI, marks) rather than long copy, and",
      "  author no perspective/rotateY/transform-style of your own.",
    );
  }
  const hasSimultaneousBeats = scenes.some((scene) => {
    const times = (scene.beats ?? []).map((beat) => beat.atSec).sort((a, b) => a - b);
    return times.some((time, index) => index >= 2 && time - times[index - 2]! <= 0.1);
  });
  if (hasSimultaneousBeats) {
    lines.push(
      "- Three or more component beats land together: lay their components on a",
      "  shared grid with one consistent gap, so the cascade settles as a set.",
    );
  }
  return lines.join("\n");
}

/**
 * A machine-readable endpoint checklist for bridged-cut findings. A compact
 * patch shown only the failing side routinely edits the wrong scene or
 * deletes the healthy endpoint while "fixing" the broken one (the 2026-07-04
 * stall): show both endpoints with live present/missing status and the one
 * required action.
 */
function bridgedCutRepairChecklist(
  findings: string[],
  scenes: DirectScene[],
  html: string,
): string {
  const failing = new Set(
    findings
      .map((finding) => cutSignatureBoundary(findingSignature(finding)))
      .filter((boundary): boundary is string => Boolean(boundary)),
  );
  if (!failing.size) return "";
  const scopes = new Map(sceneScopes(html).map((scene) => [scene.id, scene.scope]));
  const status = (part: string, sceneId: string): string => {
    const pattern = new RegExp(
      `\\bdata-part\\s*=\\s*(["'])${regexpEscape(part)}\\1`,
      "i",
    );
    return pattern.test(scopes.get(sceneId) ?? "") ? "present" : "MISSING";
  };
  const rows = resolveCutPlan(scenes).cuts.flatMap((cut) => {
    if (!failing.has(`${cut.fromScene}->${cut.toScene}`)) return [];
    if (!cut.focalPartOut || !cut.focalPartIn) return [];
    return [
      `- ${cut.style} ${cut.fromScene} -> ${cut.toScene}`,
      `  outgoing: data-part="${cut.focalPartOut}" in scene "${cut.fromScene}" ` +
        `[${status(cut.focalPartOut, cut.fromScene)}]`,
      `  incoming: data-part="${cut.focalPartIn}" in scene "${cut.toScene}" ` +
        `[${status(cut.focalPartIn, cut.toScene)}]`,
    ];
  });
  if (!rows.length) return "";
  return [
    "## Bridged-cut endpoint checklist",
    "Each cut below carries one focal element across its boundary and binds",
    "scene-scoped on BOTH sides. Add the missing data-part attribute to exactly",
    "one existing focal element already inside the named scene — the element",
    "that visually plays that role. Never create a new element for it, never",
    "edit the side marked present, and never remove any other data-part,",
    "data-region, or data-component attribute while doing so.",
    ...rows,
  ].join("\n");
}

/**
 * Exact per-region station rects derived from a scene's world-layout cells —
 * the same math `worldLayoutGuidance` renders as prose, here as inline styles
 * the skeleton stamps directly so the author copies coordinates instead of
 * inventing them.
 */
function worldStationRects(scene: DirectScene): Map<string, string> {
  const map = new Map<string, string>();
  const cells = scene.worldLayout ?? [];
  if (!cells.length) return map;
  const xs = cells.map((entry) => entry.cell[0]);
  const ys = cells.map((entry) => entry.cell[1]);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  for (const { region, cell } of cells) {
    const left = (cell[0] - minX) * 1920 + 260;
    const top = (cell[1] - minY) * 1080 + 140;
    map.set(region, `position:absolute;left:${left}px;top:${top}px;width:1400px;height:800px`);
  }
  return map;
}

type SkeletonComponent = NonNullable<DirectScene["components"]>[number];
type ResolvedCameraScene = ReturnType<typeof resolveCameraPlan>["scenes"][number];

/**
 * Sentinel Phase 1 scaffold (SENTINEL_PLAN.md §3.1 items 2-3): the host-owned
 * shell for one scene. For a camera scene it emits the `data-camera-world`
 * plane sized from the world layout, each `data-region` station at its exact
 * rect, every declared component root inside its station (or on the plane),
 * cut/camera focal-part carriers, and a screen-space `data-camera-overlay` for
 * cursors. For a plain scene it emits the component roots and carriers in the
 * scene body. The author fills interiors; the paperwork bindings
 * (`data-camera-world`, `data-region`, component `data-part`, focal carriers)
 * are present by construction, so `reconcileCameraWorldPlanes`,
 * `reconcileComponentBindings`, and `reconcileContractBindings` become no-ops.
 */
/** The host-owned opening `<section>` tag for a scene (id/timing/track). */
export function sceneSkeletonOpenTag(scene: DirectScene): string {
  return (
    `<section id="${scene.id}" class="scene clip" data-scene="${scene.id}" ` +
    `data-start="${scene.startSec}" data-duration="${scene.durationSec}" data-track-index="1">`
  );
}

/**
 * The interior of a scene's shell (everything between the `<section>` tags) —
 * the camera-world plane + stations + component roots + focal carriers the
 * storyboard implies. Shared by the whole-doc skeleton (wrapped in the section)
 * and the slot path (shown as the `<scene_html>` template, assembled into the
 * host-owned section wrapper).
 */
function buildSceneSkeletonInterior(
  scene: DirectScene,
  cameraScene: ResolvedCameraScene | undefined,
  cutFocalParts: ReadonlySet<string>,
): string {
  const components = scene.components ?? [];
  const componentIds = new Set(components.map((component) => component.id));

  const regions = new Set<string>();
  for (const cell of scene.worldLayout ?? []) regions.add(cell.region);
  for (const component of components) if (component.region) regions.add(component.region);

  const requiredParts = new Set<string>(cutFocalParts);
  if (cameraScene) {
    for (const segment of cameraScene.segments) {
      if (segment.fromRegion) regions.add(segment.fromRegion);
      if (segment.toRegion) regions.add(segment.toRegion);
      for (const part of [segment.fromPart, segment.toPart, segment.focus?.part]) {
        if (part) requiredParts.add(part);
      }
    }
  }
  // A component root and a station already carry their name as a binding; only
  // truly free focal parts need a bare carrier.
  for (const id of componentIds) requiredParts.delete(id);
  for (const region of regions) requiredParts.delete(region);

  const rects = worldStationRects(scene);
  const componentsByRegion = new Map<string, SkeletonComponent[]>();
  const looseComponents: SkeletonComponent[] = [];
  for (const component of components) {
    if (component.region && regions.has(component.region)) {
      const bucket = componentsByRegion.get(component.region);
      if (bucket) bucket.push(component);
      else componentsByRegion.set(component.region, [component]);
    } else {
      looseComponents.push(component);
    }
  }

  const carrier = (part: string): string => `<div data-part="${part}">…focal subject: style and fill…</div>`;

  if (cameraScene) {
    const stations = [...regions].map((region) => {
      const style = rects.get(region);
      const styleAttr = style ? ` style="${style}"` : "";
      const inner = (componentsByRegion.get(region) ?? [])
        .map(componentSkeletonMarkup)
        .join("");
      return `  <div data-region="${region}"${styleAttr}>${inner}…fill ${region}…</div>`;
    });
    const loose = [
      ...looseComponents.map((component) => `  ${componentSkeletonMarkup(component)}`),
      ...[...requiredParts].map((part) => `  ${carrier(part)}`),
    ];
    // Positioned inline so an author who copies the shell verbatim never
    // leaves the overlay in static flow pushing the world plane off-frame.
    const overlay = (scene.interactions?.length ?? 0) > 0
      ? '\n<div data-camera-overlay style="position:absolute;inset:0;pointer-events:none">' +
        "…cursors/labels in screen space…</div>"
      : "";
    return [
      `<div data-camera-world style="${cameraWorldStyle(scene)}">`,
      ...stations,
      ...loose,
      `</div>${overlay}`,
    ].join("\n");
  }

  return [
    ...components.map((component) => `  ${componentSkeletonMarkup(component)}`),
    ...[...requiredParts].map((part) => `  ${carrier(part)}`),
    "  …compose this scene's interior…",
  ].join("\n");
}

function buildSceneSkeleton(
  scene: DirectScene,
  cameraScene: ResolvedCameraScene | undefined,
  cutFocalParts: ReadonlySet<string>,
): string {
  const interior = buildSceneSkeletonInterior(scene, cameraScene, cutFocalParts);
  return `${sceneSkeletonOpenTag(scene)}\n${interior}\n</section>`;
}

/** Resolve per-scene camera plans + cut focal parts once for a storyboard. */
function skeletonContext(scenes: DirectScene[]): {
  cameraById: Map<string, ResolvedCameraScene>;
  focalByScene: Map<string, Set<string>>;
} {
  const cameraById = new Map(
    resolveCameraPlan(scenes).scenes.map((scenePlan) => [scenePlan.sceneId, scenePlan]),
  );
  const focalByScene = new Map<string, Set<string>>();
  const addFocal = (sceneId: string, part: string | undefined): void => {
    if (!part) return;
    const bucket = focalByScene.get(sceneId);
    if (bucket) bucket.add(part);
    else focalByScene.set(sceneId, new Set([part]));
  };
  for (const cut of resolveCutPlan(scenes).cuts) {
    addFocal(cut.fromScene, cut.focalPartOut);
    addFocal(cut.toScene, cut.focalPartIn);
  }
  return { cameraById, focalByScene };
}

/**
 * Full-fidelity skeletons for every scene (Sentinel Phase 1). Camera plans, cut
 * focal parts, and component roots are resolved once for the whole storyboard so
 * cross-scene cut endpoints land in the right scene.
 */
export function buildSceneSkeletons(scenes: DirectScene[]): string[] {
  const { cameraById, focalByScene } = skeletonContext(scenes);
  return scenes.map((scene) =>
    buildSceneSkeleton(scene, cameraById.get(scene.id), focalByScene.get(scene.id) ?? new Set()),
  );
}

/**
 * Count the illegal states the scaffold makes unrepresentable for a storyboard:
 * the host-guaranteed bindings (a camera-world plane + its data-region stations
 * per camera scene, a component root per declared component) that the model no
 * longer authors and so cannot omit. This is the L1 metric — see
 * `recordSentinelScaffold`. Kept in sync with what `buildSceneSkeletons` /
 * `componentSkeletonMarkup` actually stamp.
 */
export function countScaffoldedBindings(scenes: DirectScene[]): number {
  let count = 0;
  for (const scene of scenes) {
    if (scene.camera?.path?.length) count += 1 + worldStationRects(scene).size;
    count += scene.components?.length ?? 0;
  }
  return count;
}

/**
 * The HONEST L1 figure: how many of the storyboard's host-guaranteed bindings
 * (camera-world plane, stations, component roots) are actually PRESENT in the
 * document that ships. The skeleton/slot templates emit these, but the model
 * returns the interiors — a binding it dropped that no reconciler restored is
 * not "unrepresentable", so counting planned bindings (the old behavior)
 * overstated L1. Scanned per scene scope over the final html.
 */
export function countScaffoldBindingsPresent(
  scenes: DirectScene[],
  html: string,
): number {
  const scopes = new Map(
    [...sceneScopeLocations(html)].map((scope) => [
      scope.id,
      html.slice(scope.openEnd, scope.closeStart),
    ]),
  );
  let count = 0;
  for (const scene of scenes) {
    const content = scopes.get(scene.id);
    if (!content) continue;
    if (scene.camera?.path?.length) {
      if (/\bdata-camera-world\b/i.test(content)) count += 1;
      for (const region of worldStationRects(scene).keys()) {
        if (
          new RegExp(`\\bdata-region\\s*=\\s*["']${regexpEscape(region)}["']`, "i").test(content)
        ) {
          count += 1;
        }
      }
    }
    for (const component of scene.components ?? []) {
      if (
        new RegExp(`\\bdata-part\\s*=\\s*["']${regexpEscape(component.id)}["']`, "i").test(content)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Per-scene interior templates (Sentinel Phase 2 slots): the inner HTML the
 * author fills for each `<scene_html id>` slot. The host owns the `<section>`
 * wrapper at assembly time, so the model only sees and returns the interior.
 */
export function buildSceneSlotInteriors(scenes: DirectScene[]): Map<string, string> {
  const { cameraById, focalByScene } = skeletonContext(scenes);
  return new Map(
    scenes.map((scene) => [
      scene.id,
      buildSceneSkeletonInterior(
        scene,
        cameraById.get(scene.id),
        focalByScene.get(scene.id) ?? new Set(),
      ),
    ]),
  );
}

/** Prompt lines showing each scene's interior template for the slot path. */
function slotSceneTemplates(storyboard: DirectScene[]): string[] {
  const interiors = buildSceneSlotInteriors(storyboard);
  const lines = [
    "## Scene interior templates (fill each; the host owns the wrappers)",
    "The host owns the document chassis, every <section> wrapper (its id, timing,",
    "and track), the paused GSAP timeline, its registration, and every runtime,",
    "JSON island, and compile seam. You author only the shared film style, each",
    "scene's INTERIOR html, and each scene's timeline statements. For each scene",
    "the template below is the host contract: keep its data-camera-world plane,",
    "data-region stations, component roots (data-part/data-component), and focal",
    "carriers; fill and restyle the … placeholders and placeholder copy. Never",
    "author a <section>, <html>, <head>, <body>, a gsap.timeline, a",
    "window.__timelines registration, or a JSON island.",
  ];
  for (const scene of storyboard) {
    lines.push(
      "",
      `<scene_html id="${scene.id}">`,
      interiors.get(scene.id) ?? "…compose this scene's interior…",
      "</scene_html>",
    );
  }
  return lines;
}

/** The scene-slot response contract (replaces the single <index_html>). */
function slotResponseContract(storyboard: DirectScene[]): string {
  const ids = storyboard.map((scene) => scene.id).join(", ");
  return [
    "## Response contract (scene slots)",
    "Return these tags and nothing else — no <index_html>, no storyboard_json,",
    "no <html>/<head>/<body>, no prose or Markdown fences:",
    "- exactly one <film_style>…</film_style>: the shared <style> payload (design",
    "  tokens, shared classes) used across every scene. Do not repeat per-scene",
    "  styles the film style already covers.",
    "- one <scene_html id=\"<scene-id>\">…</scene_html> per scene: the INTERIOR of",
    "  that scene only (no <section> wrapper). Fill its template.",
    "- one <scene_script id=\"<scene-id>\">…</scene_script> per scene: the GSAP",
    "  statements for that scene, appended into a host-owned (tl) => { … } function.",
    "  Use absolute composition times inside the scene's window. Include the scene's",
    "  entrances and information beats on INTERIOR elements. The host owns the",
    "  stage (root sizing, absolute scene stacking) and scene-window visibility",
    "  (each scene is revealed at its start and cleared at its end) — do NOT",
    "  author opacity sets on the scene wrapper itself, and do NOT create a",
    "  timeline, register it, seek it, or call any SequencesX.compile.",
    "  Each scene's statements run in their own function scope, so never rely on a",
    "  variable declared in another scene.",
    `Author every scene, in order: ${ids}.`,
    "Keep each scene's html + script focused; the whole response must stay under",
    "the output-size limit above.",
  ].join("\n");
}

/**
 * The director prompt's whole-document bullets, each with its slot-mode
 * replacement. In slot mode the host owns the chassis, section wrappers, the
 * paused timeline, and scene-window visibility — the base prompt telling the
 * author to build exactly those things is what produced the documented
 * "slot-envelope drift" (and the p7-denseui attempt that returned no slots at
 * all). Exact-match surgery, not prose appended after a contradiction: the
 * model must never see both instructions.
 *
 * Every entry MUST keep matching `prompts/planning-director.md` byte-for-byte —
 * `test/promptBudget.test.ts` fails if an anchor goes stale, so a prompt edit
 * that would silently resurrect the contradiction fails CI instead.
 */
export const SLOT_MODE_DIRECTOR_REWRITES: ReadonlyArray<{ find: string; replace: string }> = [
  {
    find:
      "- Return a complete HTML document with one root carrying\n" +
      "  `data-composition-id`, `data-width`, `data-height`, and finite\n" +
      "  `data-duration`.",
    replace:
      "- The host owns the document chassis: the root element and its\n" +
      "  `data-composition-id`, `data-width`, `data-height`, and `data-duration`\n" +
      "  are assembled deterministically. Author only the requested scene slots.",
  },
  {
    find:
      "- Use one paused GSAP timeline, initialized synchronously and registered as\n" +
      '  `window.__timelines["<composition-id>"]` after all tweens are authored.',
    replace:
      "- The host creates, registers, and seeks the single paused GSAP timeline;\n" +
      "  your `<scene_script>` statements are appended into it. Never create or\n" +
      "  register a timeline yourself.",
  },
  {
    find:
      '- Mark each storyboard scene with `class="scene clip"`, a stable `id`,\n' +
      "  `data-scene`, `data-start`, `data-duration`, and `data-track-index`.",
    replace:
      "- The host emits every scene `<section>` wrapper with its `id`,\n" +
      "  `data-scene`, timing, and track attributes. Never author a `<section>`\n" +
      "  wrapper yourself.",
  },
  {
    find:
      "- The paused timeline must own scene-window opacity so exactly the intended\n" +
      "  scene(s) are visible at every seeked time. Initialize all scene wrappers\n" +
      "  explicitly, reveal them at their `data-start`, and clear them at the end of\n" +
      "  their window; never rely on DOM order to cover inactive scenes.",
    replace:
      "- The host owns scene-window visibility: each scene is revealed at its\n" +
      "  start and cleared at the end of its window deterministically. Never\n" +
      "  author opacity sets on a scene wrapper; animate interior elements only.",
  },
  {
    find:
      "Return exactly these two tags and nothing else when no locked storyboard is\n" +
      "provided. When `<locked_storyboard_json>` is present, the job prompt overrides\n" +
      "this contract and requests only `<index_html>`.",
    replace:
      "The job prompt's scene-slot response contract overrides this section:\n" +
      "return one `<film_style>` plus per-scene `<scene_html>`/`<scene_script>`\n" +
      "tags — never `<index_html>` or a complete document.",
  },
];

/**
 * Rewrite the whole-document contract bullets for slot mode. A stale anchor
 * must never sink a live paid call, so a miss degrades to an explicit
 * precedence block appended after the director text (weaker than surgery, but
 * unambiguous) plus a stderr warning; `test/promptBudget.test.ts` asserts zero
 * misses so the drift is caught in CI, not in production.
 */
export function adaptDirectorPromptForSlots(
  prompt: string,
  misses?: string[],
): string {
  let adapted = prompt;
  let missed = false;
  for (const { find, replace } of SLOT_MODE_DIRECTOR_REWRITES) {
    if (!adapted.includes(find)) {
      missed = true;
      misses?.push(find);
      process.stderr.write(
        `[author] slot-mode director rewrite anchor no longer matches ` +
          `planning-director.md: "${find.slice(0, 60)}…" — update ` +
          `SLOT_MODE_DIRECTOR_REWRITES with the edit\n`,
      );
      continue;
    }
    adapted = adapted.replace(find, replace);
  }
  if (missed) {
    recordSentinelDegradation("slot-director-rewrite-fallback");
    adapted += [
      "",
      "",
      "## SLOT-MODE PRECEDENCE (overrides any contradicting rule above)",
      "The host owns the document chassis, every scene <section> wrapper, the",
      "single paused registered timeline, and scene-window visibility. Return",
      "ONLY <film_style> plus per-scene <scene_html>/<scene_script> tags —",
      "never <index_html>, a complete document, a timeline registration, or",
      "opacity sets on a scene wrapper.",
    ].join("\n");
  }
  return adapted;
}

/**
 * Slot mode does not need the base prompt's whole-document architecture/runtime
 * chapters: the host emits and validates that machinery. Remove those chapters
 * after anchor-checked contradiction surgery, retaining all creative, motion,
 * camera, component, cut, typography, color, and spatial-direction guidance.
 */
export function slotDirectorPrompt(prompt: string, misses?: string[]): string {
  const adapted = adaptDirectorPromptForSlots(prompt, misses);
  const precedenceMarker = "## SLOT-MODE PRECEDENCE";
  const precedenceAt = adapted.indexOf(precedenceMarker);
  const precedence = precedenceAt >= 0 ? adapted.slice(precedenceAt) : "";
  const body = precedenceAt >= 0 ? adapted.slice(0, precedenceAt) : adapted;
  const compact = body
    .replace(
      /## Storyboard moments[\s\S]*?(?=## Typed boundary cuts)/,
      [
        "## Storyboard moments",
        "Make every locked moment visibly true at its exact atSec using an interior",
        "state change, typed component beat, camera arrival, or cut. Do not retime it.",
        "",
      ].join("\n"),
    )
    .replace(
      /## Typed boundary cuts[\s\S]*?(?=## Continuous spatial world)/,
      [
        "## Typed boundary cuts",
        "The host compiles the locked cut graph. Preserve every named data-part",
        "endpoint and design matched silhouettes when the cut style asks for one.",
        "",
      ].join("\n"),
    )
    .replace(
      /## The Sequences ease library[\s\S]*?(?=## Cinematography)/,
      [
        "## Sequences easing",
        "Use the supplied seq* eases or standard GSAP eases; never invent an ease name.",
        "",
      ].join("\n"),
    )
    .replace(
      /## Architecture laws[\s\S]*?(?=## Spatial intent)/,
      "",
    )
    .replace(
      /## Spatial intent[\s\S]*?(?=## Hard runtime contract)/,
      [
        "## Spatial intent",
        "Treat locked worldLayout cells and camera stations as composition guides.",
        "Keep named data-region/data-part/data-component bindings intact. Animate",
        "interior elements only; the host owns camera, cuts, components, interactions,",
        "scene windows, runtime compilation, and the shared timeline.",
        "",
      ].join("\n"),
    )
    .replace(
      /## Hard runtime contract[\s\S]*$/,
      "",
    )
    .trim();
  return precedence ? `${compact}\n\n${precedence}` : compact;
}

export function creationPrompt(args: {
  brief: string;
  projectDir: string;
  skills: RetrievedSkillContext;
  frameMd?: string;
  current?: DirectCompositionDraft;
  revisionInstruction?: string;
  validationFeedback?: string[];
  scratch?: DirectCompositionDraft;
  lockedStoryboard?: DirectScene[];
  compact?: boolean;
  structuredPatches?: boolean;
  /** Sentinel Phase 2: request scene-addressable slots, not one <index_html>. */
  slots?: boolean;
}): string {
  if (args.scratch) {
    const scratchComponents = componentReferenceFor(
      args.lockedStoryboard ?? args.scratch.storyboard,
    );
    const cutChecklist = bridgedCutRepairChecklist(
      args.validationFeedback ?? [],
      args.lockedStoryboard ?? args.scratch.storyboard,
      args.scratch.html,
    );
    return [
      "SYSTEM: You are a precise HTML/CSS/GSAP repair engineer.",
      "Repair the supplied scratch composition with the fewest local edits. Preserve its art",
      "direction, copy, timing, scene structure, and all unrelated source exactly.",
      "For deliberate entrance/exit overflow or decorative overlap, add the narrowest matching",
      "data-layout-allow-* annotation to the moving wrapper. Hard clipped_text/text_box_overflow",
      "must be reflowed or resized; never annotate away load-bearing clipped text.",
      "For overlap, clipping, container overflow, or safe-area findings, move the affected",
      "semantic groups into .zone children of the existing .layout-split,",
      ".layout-editorial-left, .layout-meta-top, .layout-hero-band, or",
      ".layout-center-stack flow container. Prefer that structural repair over offsets.",
      "For camera_framed_clipped findings, the named element hangs outside the station",
      "rect the camera frames: move it fully inside its data-region box (keep an ~8%",
      "inner margin) or shrink it — never move the region itself or edit the camera plan.",
      "For camera_framed_sparse findings, the framed content is a small subject adrift",
      "in an empty frame: enlarge the station's content, tighten its data-region rect so",
      "the fit zoom lands closer, or move more of that scene's content into the framed",
      "station — the viewer should never study a mostly-empty frame.",
      "For cut_degraded findings, a declared morph/match compiled as a plain",
      "swipe because the endpoint silhouettes do not rhyme. Use the measured",
      "numbers in the finding: restyle one endpoint, or move its data-part attribute",
      "onto a sub-element whose box does rhyme (e.g. a condensed header band matching",
      "the outgoing pill), so both parts sit within a 2.5x aspect ratio, under 60 nodes,",
      "and on frame at the boundary. Never rename the parts or edit the cut plan JSON.",
      "For eye_trace_jump findings, the viewer's gaze is on the outgoing focal element",
      "when the cut lands but the incoming subject appears across the frame: move the",
      "incoming scene's opening subject (or its station rect) so it appears near the",
      "measured outgoing position — the finding carries both viewport coordinates.",
      "Never retime the cut, change scene timing, or edit the cut plan JSON for it.",
      "For eye_trace_pingpong findings, consecutive beats yank the eye across the frame:",
      "bring the two beat targets closer together in the layout — never delete beats.",
      "For motion/liveness findings, add seek-safe GSAP beats on child elements,",
      "semantic component parts, or data-camera-world wrappers at explicit",
      "composition times. Do not animate scene wrappers to fake activity.",
      "For storyboard/moments findings, the named moment's changed state must",
      "actually happen at its atSec: author a visible, explicitly positioned",
      "beat on that scene's content there. Never delete or retime the moment;",
      "make the timeline honor it.",
      "Never edit data-composition-id, data-scene values, scene element ids, or storyboard timing.",
      "Do not edit JavaScript unless a finding explicitly identifies script/source validation.",
      "While repairing one finding, never remove or rename other data-part, data-region,",
      "or data-component attributes and never delete a component root — destroying a valid",
      "binding creates new blocking findings and rejects the whole patch atomically.",
      "",
      "## Deterministic findings to repair",
      ...(args.validationFeedback ?? []).map((issue) => `- ${issue}`),
      "",
      ...(cutChecklist ? [cutChecklist, ""] : []),
      ...(scratchComponents ? [scratchComponents, ""] : []),
      "## Scratch HTML",
      "<scratch_index_html>",
      args.scratch.html,
      "</scratch_index_html>",
      "",
      "## Response contract",
      args.structuredPatches
        ? `Return only a JSON object with a "patches" array of 1-${MAX_REPAIR_PATCHES} edits.`
        : `Return only <patches_json> containing a JSON array of 1-${MAX_REPAIR_PATCHES} edits.`,
      'Each edit is {"search":"exact unique substring from the current scratch","replace":"replacement"}.',
      "Edits run sequentially. Keep each search as short as possible while still unique.",
      "Use JSON escaping correctly. Do not return storyboard_json, index_html, Markdown, comments,",
      "explanations, or a rewritten document. The complete response must stay under 12,000 characters.",
    ].join("\n");
  }
  const current = args.current
    ? [
        "## Current canonical composition",
        "<current_storyboard>",
        JSON.stringify(args.current.storyboard, null, 2),
        "</current_storyboard>",
        "<current_index_html>",
        args.current.html,
        "</current_index_html>",
      ].join("\n")
    : "";
  const revision = args.revisionInstruction
    ? `## Revision request\n${args.revisionInstruction}\nPreserve what works and make this one coherent transactional revision.`
    : "";
  const feedback = args.validationFeedback?.length
    ? [
        "## Deterministic validation feedback",
        "The previous scratch draft was not published. Repair every item below while preserving its visual thesis:",
        "For a deliberate entrance/exit or decorative overlap, add the narrowest",
        "matching data-layout-allow-* annotation to its moving wrapper. Hard",
        "clipped_text/text_box_overflow findings must be reflowed or resized;",
        "do not merely annotate load-bearing text.",
        "For motion/liveness findings, add a real mid-shot or back-half",
        "information beat with explicit timeline timing on a child/component or",
        "data-camera-world wrapper. Do not animate the scene wrapper itself.",
        "For storyboard/moments findings, author the promised changed state at",
        "the named atSec (a cut, camera arrival, interaction, or positioned",
        "component beat) instead of removing or retiming the moment.",
        ...args.validationFeedback.map((issue) => `- ${issue}`),
      ].join("\n")
    : "";
  const lockedStoryboard = args.lockedStoryboard
    ? [
        "## Locked storyboard and cut graph",
        "This plan was created and deterministically validated in a prior pass.",
        "Author every shot as a distinct scene. Match its ids and timings exactly;",
        "do not merge shots or redesign the cut graph while writing source.",
        "<locked_storyboard_json>",
        // Host-normalization notes are operator paperwork (STORYBOARD.md),
        // not authoring instructions — keep them out of the paid prompt.
        JSON.stringify(
          args.lockedStoryboard.map(
            ({ sentinelNormalizations: _normalizations, ...scene }) => scene,
          ),
          null,
          2,
        ),
        "</locked_storyboard_json>",
        "",
        // The host already knows the exact scene shells; handing them over
        // verbatim removes the whole authored-N-scenes-against-an-M-scene-plan
        // failure class (a live run burned a full paid attempt on 10 scenes
        // vs a 5-scene plan). The author spends budget on interiors only.
        // Sentinel Phase 2 (slots): the host owns the section wrapper, chassis,
        // and timeline; the author fills each scene's interior template.
        // Phase 1 (skeleton): full shells copied verbatim. Else: bare shells.
        ...(args.slots
          ? slotSceneTemplates(args.lockedStoryboard)
          : sentinelSkeletonEnabled()
          ? [
              "## Mandatory scene skeleton (copy verbatim; fill the interiors)",
              "Your <body> must contain EXACTLY these scene shells, in this order,",
              "with these exact tags. Copy each shell verbatim — its section",
              "wrapper, any data-camera-world plane, data-region stations,",
              "component roots (data-part/data-component), and focal-part carriers",
              "are the host contract. Fill and restyle the interiors (the … marks",
              "and placeholder copy); never add, remove, split, merge, or retime a",
              "scene, and never delete a data-camera-world, data-region, data-part,",
              "or data-component attribute the shell already carries:",
              ...buildSceneSkeletons(args.lockedStoryboard),
            ]
          : [
              "## Mandatory scene skeleton (copy verbatim)",
              "Your <body> must contain EXACTLY these scene shells, in this order, with",
              "these exact id/data-scene/data-start/data-duration values — copy each tag",
              "verbatim (you may add layout classes and fill the interior), and never",
              "add, remove, split, merge, or retime a scene:",
              ...args.lockedStoryboard.map((scene) =>
                `<section id="${scene.id}" class="scene clip" data-scene="${scene.id}" ` +
                `data-start="${scene.startSec}" data-duration="${scene.durationSec}" ` +
                `data-track-index="1">…your scene content…</section>`
              ),
            ]),
        ...[worldLayoutGuidance(args.lockedStoryboard)].filter(Boolean),
        lockedLayoutGuidance(args.lockedStoryboard),
      ].join("\n")
    : "";
  const lockedResponse = args.lockedStoryboard
    ? args.slots
      ? slotResponseContract(args.lockedStoryboard)
      : [
          "## Builder response override",
          "The storyboard already exists. Return exactly one <index_html> tag with",
          "the complete document and nothing else. Do not repeat storyboard_json.",
        ].join("\n")
    : "";
  const frame = args.frameMd
    ? [
        "## Frame design capsule (art direction + deterministic constraints)",
        "Start from this capsule. Preserve its committed brand hue/font families,",
        "embedded-font requirement, contrast thresholds, and one-accent hierarchy.",
        "Its recommended tints and spatial tokens may be adjusted deliberately as",
        "the document allows; your motion, composition, and rhythm stay free.",
        "<frame_capsule>",
        frameCapsule(args.frameMd),
        "</frame_capsule>",
      ].join("\n")
    : "";
  const componentReference = componentReferenceFor(
    args.lockedStoryboard ?? args.current?.storyboard,
  );
  return [
    "SYSTEM:",
    args.slots ? slotDirectorPrompt(DIRECTOR_PROMPT) : DIRECTOR_PROMPT,
    "",
    args.slots
      ? compactSkillText(args.skills.text, SLOT_SKILL_BUDGET_CHARS)
      : args.compact
      ? compactSkillText(args.skills.text)
      : args.skills.text,
    "",
    componentReference,
    "## Job brief and trusted evidence",
    args.brief,
    "",
    frame,
    "## Available project-local assets",
    availableAssets(args.projectDir),
    "",
    "## Output-size contract",
    `The entire response must stay under ${COMPOSITION_SOURCE_BUDGET_CHARS.toLocaleString("en-US")} characters.`,
    "Match the locked storyboard's scene count exactly when one is supplied;",
    "otherwise default to 4-6 scenes and lean on camera worlds for density.",
    "Scenes sharing one data-camera-world with several data-region stations are",
    "cheaper than extra full scenes — reuse CSS classes and shared primitives.",
    "Do not paste brief paragraphs into the frame. Product facts are evidence;",
    "turn them into terse labels, values, UI states, and short claims. A product",
    "beat requested in the brief must become visible component behavior, not a",
    "sentence describing that behavior.",
    "Spend the motion budget on information change: component state, camera",
    "arrival, object continuity, chart/trace resolution, cursor action, and",
    "kinetic type. Underlines, dividers, fades, glows, and ambient drift are",
    "supporting polish and never the main event of a storyboard moment.",
    "No comments, duplicated per-scene styles, embedded data URLs, verbose SVG",
    "paths, or explanatory text. Completeness outranks ornamental source volume.",
    args.compact
      ? "This is a compact recovery pass: finish the complete document well before the limit."
      : "",
    lockedStoryboard,
    current,
    revision,
    feedback,
    lockedResponse,
  ].filter(Boolean).join("\n\n");
}

interface DirectCompositionArgs {
  brief: string;
  projectDir: string;
  skills: RetrievedSkillContext;
  frameMd?: string;
  current?: DirectCompositionDraft;
  lockedStoryboard?: DirectScene[];
  revisionInstruction?: string;
  options?: CompleteOptions;
  /** Out-param: written each attempt so stage receipts can report retries. */
  attempts?: { count: number };
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

const CUT_ENDPOINT_STATIC_FINDING =
  /^cut ([\w-]+)->([\w-]+) (outgoing|incoming) part "([^"]+)" must exist as a data-part inside scene/;
const CUT_ENDPOINT_KIT_FINDING =
  /^kit_markup_incomplete: cut ([\w-]+)->([\w-]+) \([\w-]+\) needs data-part="([^"]+)" in scene "([\w-]+)"/;

/**
 * Normalize one deterministic validation finding into a stable structural
 * signature. Two purposes: (a) the author loop compares signatures across
 * attempts to detect a repair that is not converging, so equivalent findings
 * from different validators (the cut contract's regex gate and the kit markup
 * audit's DOM gate emit differently worded messages for the same defect) must
 * collapse to ONE signature; (b) the persisted run summary reports signatures
 * instead of raw messages, so failed runs can be grouped offline without
 * scraping log lines. Unknown findings keep a truncated `other:` prefix —
 * never raise here.
 */
export function findingSignature(finding: string): string {
  const text = finding.trim();
  const cutStatic = text.match(CUT_ENDPOINT_STATIC_FINDING);
  if (cutStatic) {
    return `cut_missing_${cutStatic[3]}_part:${cutStatic[1]}->${cutStatic[2]}:${cutStatic[4]}`;
  }
  const cutKit = text.match(CUT_ENDPOINT_KIT_FINDING);
  if (cutKit) {
    const side = cutKit[4] === cutKit[2] ? "incoming" : "outgoing";
    return `cut_missing_${side}_part:${cutKit[1]}->${cutKit[2]}:${cutKit[3]}`;
  }
  const cameraRegion = text.match(
    /^scene "([\w-]+)" camera targets region "([^"]+)"/,
  ) ?? text.match(
    /^kit_markup_incomplete: camera path in scene "([\w-]+)" frames data-region="([^"]+)"/,
  );
  if (cameraRegion) {
    return `camera_region_missing:${cameraRegion[1]}:${cameraRegion[2]}`;
  }
  const cameraPart = text.match(
    /^scene "([\w-]+)" camera targets part "([^"]+)"/,
  ) ?? text.match(
    /^kit_markup_incomplete: camera path in scene "([\w-]+)" frames data-part="([^"]+)"/,
  );
  if (cameraPart) {
    return `camera_part_missing:${cameraPart[1]}:${cameraPart[2]}`;
  }
  const componentRoot = text.match(
    /^scene "([\w-]+)" declares component "([^"]+)"/,
  );
  if (componentRoot) {
    return `component_root_missing:${componentRoot[1]}:${componentRoot[2]}`;
  }
  const componentBeat = text.match(
    /beat "([^"]+)" targets component "([^"]+)" but scene "([\w-]+)"/,
  );
  if (componentBeat) {
    return `component_beat_unbound:${componentBeat[3]}:${componentBeat[2]}`;
  }
  const moment = /storyboard\/moments/.test(text)
    ? text.match(/moment "([^"]+)"/)
    : undefined;
  if (moment) return `moment_unbound:${moment[1]}`;
  // Both encodings of one degraded boundary — the raw runtime warning
  // ("cut_degraded: shape-match a->b compiled …") and the measured polish
  // finding ("cut_degraded [data-part=…] (t=…): The storyboard declares a
  // shape-match cut a->b …") — collapse to one signature per boundary.
  if (text.startsWith("cut_degraded")) {
    const boundary = text.match(/\b([\w-]+->[\w-]+)\b/);
    return `cut_degraded:${boundary?.[1] ?? "unknown"}`;
  }
  if (text.startsWith("dom_markup_broken:")) return "dom_markup_broken";
  if (text.startsWith("runtime_bind_exception")) return "runtime_bind_exception";
  if (text.startsWith("kit_markup_incomplete:")) {
    return `kit_markup_incomplete:${text.match(/"([^"]+)"/)?.[1] ?? "unknown"}`;
  }
  if (text.startsWith("browser_warning:")) {
    return `browser_warning:${text.slice(16, 136).trim()}`;
  }
  return `other:${text.slice(0, 120)}`;
}

/**
 * Dedupe merged repair feedback by finding signature BEFORE the 20-item
 * slice: one defect often carries two encodings (a degraded boundary's raw
 * runtime warning + its measured polish finding; an interaction miss repeated
 * across samples), and duplicates crowd geometry findings out of the compact
 * repair prompt. Keeps the longest (most detailed) encoding per signature in
 * first-seen order.
 */
export function dedupeFeedbackBySignature(findings: string[]): string[] {
  const bySignature = new Map<string, string>();
  for (const finding of findings) {
    const signature = findingSignature(finding);
    const existing = bySignature.get(signature);
    if (existing === undefined || finding.length > existing.length) {
      bySignature.set(signature, finding);
    }
  }
  return [...bySignature.values()];
}

/** Boundary key ("from->to") when a signature names a bridged-cut endpoint. */
function cutSignatureBoundary(signature: string): string | undefined {
  return signature.match(
    /^cut_missing_(?:incoming|outgoing)_part:([\w-]+->[\w-]+):/,
  )?.[1];
}

/**
 * Bridged-cut boundaries the planner volunteered as enhancements: the brief
 * never asked for that cut style, so the film must not die for it. A style the
 * brief explicitly requested is never in this set — explicit requirements do
 * not silently degrade.
 */
export function volunteeredCutBoundaries(
  storyboard: DirectScene[],
  requirements: Pick<StoryboardPlanRequirements, "requireObjectMatch" | "requireShapeMatch">,
): Set<string> {
  const boundaries = new Set<string>();
  for (const [index, scene] of storyboard.entries()) {
    const next = storyboard[index + 1];
    if (!next || !scene.cut) continue;
    const volunteered =
      (scene.cut.style === "morph" && !requirements.requireShapeMatch) ||
      (scene.cut.style === "match" &&
        Boolean(scene.cut.focalPartOut && scene.cut.focalPartIn) &&
        !requirements.requireObjectMatch) ||
      // Legacy names survive in cached storyboards.
      (scene.cut.style === "shape-match" && !requirements.requireShapeMatch) ||
      (scene.cut.style === "object-match" && !requirements.requireObjectMatch);
    if (volunteered) boundaries.add(`${scene.id}->${next.id}`);
  }
  return boundaries;
}

/**
 * Strategy selection after a compact patch is statically rejected. A patch
 * whose candidate still carries a structural signature it was asked to fix is
 * not converging — repeating another compact patch against the same scratch
 * was exactly the 2026-07-04 stall, so the loop abandons the scratch and
 * spends its final attempt as a full-context re-author instead. Survivors
 * that volunteered-cut degradation can resolve deterministically do NOT
 * trigger the switch: the compact patch keeps its chance to repair everything
 * else, and the degradation rung retires the stuck boundary.
 */
export function repairStrategyAfterStaticRejection(args: {
  patchMode: boolean;
  signatures: ReadonlySet<string>;
  previousSignatures: ReadonlySet<string>;
  degradableBoundaries: ReadonlySet<string>;
}): "compact-repair" | "full-reauthor" {
  if (!args.patchMode) return "compact-repair";
  for (const signature of args.signatures) {
    if (!args.previousSignatures.has(signature)) continue;
    const boundary = cutSignatureBoundary(signature);
    if (boundary && args.degradableBoundaries.has(boundary)) continue;
    return "full-reauthor";
  }
  return "compact-repair";
}

interface CutDegradationResult {
  draft: DirectCompositionDraft;
  storyboard: DirectScene[];
  degraded: string[];
}

/**
 * Volunteered bridged cuts must never sink an otherwise valid film. When a
 * morph/match endpoint binding persists across two consecutive
 * static rejections (so it survived at least one model repair that was told
 * to fix it) and the brief did not explicitly request that cut style, degrade
 * the boundary to a swipe — a typed, non-bridged cut that preserves the
 * boundary beat and every moment bound to the cut landing — then re-run the
 * deterministic injections so the shipped island matches the shipped
 * storyboard. Explicitly requested bridged cuts are never degraded here; they
 * stay blocking and fall back honestly.
 */
export function degradeVolunteeredBridgedCuts(args: {
  draft: DirectCompositionDraft;
  errors: string[];
  storyboard: DirectScene[];
  requirements: Pick<StoryboardPlanRequirements, "requireObjectMatch" | "requireShapeMatch">;
  persistentSignatures: ReadonlySet<string>;
  projectDir: string;
}): CutDegradationResult | undefined {
  const volunteered = volunteeredCutBoundaries(args.storyboard, args.requirements);
  const stuck = new Set<string>();
  for (const error of args.errors) {
    const signature = findingSignature(error);
    const boundary = cutSignatureBoundary(signature);
    if (!boundary || !volunteered.has(boundary)) continue;
    if (!args.persistentSignatures.has(signature)) continue;
    stuck.add(boundary);
  }
  if (!stuck.size) return undefined;
  const degraded: string[] = [];
  const storyboard = args.storyboard.map((scene, index) => {
    const next = args.storyboard[index + 1];
    if (!next || !scene.cut || !stuck.has(`${scene.id}->${next.id}`)) return scene;
    degraded.push(`${scene.id}->${next.id} (${scene.cut.style})`);
    // MD1 retarget: the degrade target is a swipe (right-travel — the static
    // gate has no measured focal geometry to derive an axis from), keeping the
    // boundary typed, energetic enough to hold the beat, and inside the
    // 3-transition language.
    return {
      ...scene,
      cut: { version: 1 as const, style: "swipe" as const, axis: "right" as const },
      outgoingCut:
        `Swipe into "${next.title}" (a volunteered ${scene.cut.style} with persistently ` +
        `unbindable focal parts was retired at repair time).`,
    };
  });
  if (!degraded.length) return undefined;
  const draft = applyDeterministicSourceRepairs(
    { storyboard, html: args.draft.html },
    args.projectDir,
    storyboard,
  );
  return { draft, storyboard, degraded };
}

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

/**
 * A compact continuation prompt for a truncated or contract-violating slot
 * response: keep every completed scene, re-request only the named scenes.
 * Carries the shared film style already produced (so the tail matches) and
 * only those scenes' interior templates — far cheaper than re-authoring the
 * whole film. When `repairNotes` is set this is a scaffold repair, not a
 * truncation: the defective scene's own html/script ride along as the
 * minimal-edit baseline (the storyboard findings-retry lesson — carrying the
 * artifact forward converges where re-draws whack-a-mole).
 */
function slotContinuationPrompt(
  args: DirectCompositionArgs,
  filmStyle: string | undefined,
  missing: DirectScene[],
  repairNotes?: Map<string, string[]>,
  previousSlots?: ParsedSceneSlots,
  repairPurpose: "scaffold" | "validation" = "scaffold",
): string {
  const interiors = buildSceneSlotInteriors(args.lockedStoryboard ?? []);
  const templates = missing.flatMap((scene) => {
    const notes = repairNotes?.get(scene.id) ?? [];
    const previous = previousSlots?.scenes.get(scene.id);
    return [
      "",
      ...(notes.length
        ? [
            repairPurpose === "scaffold"
              ? `Host-contract findings for scene "${scene.id}" (restore these bindings):`
              : `Validation findings for scene "${scene.id}" (make the smallest correction):`,
            ...notes.map((note) => `- ${note}`),
          ]
        : []),
      ...(previous?.html?.trim()
        ? [
            "Your previous interior for this scene (keep its content and copy;",
            "change ONLY what the findings above require):",
            `<previous_scene_html id="${scene.id}">`,
            previous.html,
            "</previous_scene_html>",
          ]
        : []),
      ...(previous?.script?.trim()
        ? [
            "Your previous scene script (keep its motion unless a finding requires a change):",
            `<previous_scene_script id="${scene.id}">`,
            previous.script,
            "</previous_scene_script>",
          ]
        : []),
      `<scene_html id="${scene.id}">`,
      interiors.get(scene.id) ?? "…compose this scene's interior…",
      "</scene_html>",
    ];
  });
  const intro = repairNotes
    ? repairPurpose === "scaffold"
      ? "Some scenes came back without host-contract bindings the template carried. The" +
        "\nother scenes are kept; re-author ONLY the scenes below, keeping each template's" +
        "\ndata-camera-world plane, data-region stations, and component roots" +
        "\n(data-part/data-component) exactly as given."
      : "The assembled film has scene-local validation findings. Every unlisted scene is" +
        "\nlocked and kept byte-for-byte. Re-author ONLY the listed scenes as minimal edits;" +
        "\npreserve their copy, visual thesis, host bindings, and motion unless a finding" +
        "\nexplicitly requires a change."
    : "The previous response was cut off. The completed scenes are kept; author ONLY" +
      "\nthe missing scenes below, matching the established film style exactly.";
  return [
    "SYSTEM: You are the HyperFrames author finishing a partly-written launch film.",
    intro,
    "",
    "## Job brief and trusted evidence",
    args.brief,
    "",
    ...(filmStyle
      ? ["## Established film style (already applied; reuse its classes/tokens)", "<film_style>", filmStyle, "</film_style>", ""]
      : []),
    "## Missing scene interior templates",
    ...templates,
    "",
    "## Response contract",
    "Return ONLY these tags, nothing else:",
    ...missing.flatMap((scene) => [
      `- one <scene_html id="${scene.id}">…interior…</scene_html>`,
      `- one <scene_script id="${scene.id}">…GSAP statements for a host-owned (tl) => { … }…</scene_script>`,
    ]),
    "Absolute times inside each scene window, beats on interior elements only —",
    "the host owns the stage and scene-window visibility. Do not author opacity",
    "sets on the scene wrapper, create/register a timeline, or call any compile.",
  ].join("\n");
}

/**
 * The scaffold-contract violations the L2 reconcilers CANNOT mechanically fix:
 * a required camera station or declared component root COMPLETELY absent from
 * a returned scene interior. Near-misses stay out deliberately —
 * `reconcileContractBindings` claims an exact-name/unique-candidate station and
 * `reconcileComponentBindings` claims a kind-marked or semantically unique
 * element for free — so this only names the states that would otherwise burn a
 * whole-document paid retry (`component_root_missing` / `camera_region_missing`).
 * The missing camera-world plane is likewise excluded: `reconcileCameraWorldPlanes`
 * wraps the interior deterministically.
 */
export function slotScaffoldViolations(
  storyboard: DirectScene[],
  slots: ParsedSceneSlots,
): Map<string, string[]> {
  const { cameraById } = skeletonContext(storyboard);
  const out = new Map<string, string[]>();
  for (const scene of storyboard) {
    const html = slots.scenes.get(scene.id)?.html?.trim();
    if (!html) continue; // a wholly missing interior is the truncation path
    const notes: string[] = [];
    const cameraScene = scene.camera?.path?.length ? cameraById.get(scene.id) : undefined;
    if (cameraScene) {
      const required = new Set<string>();
      for (const segment of cameraScene.segments) {
        if (segment.fromRegion) required.add(segment.fromRegion);
        if (segment.toRegion) required.add(segment.toRegion);
      }
      const present = new Set(
        [...html.matchAll(/\bdata-region\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!),
      );
      // Count tolerance: with as many stations as required, a renamed station
      // is a near-miss the L2 reconciler owns; fewer stations than required is
      // a true omission no reconciler can invent.
      if (present.size < required.size) {
        for (const region of required) {
          if (!present.has(region)) {
            notes.push(`camera station data-region="${region}" is missing from this scene`);
          }
        }
      }
    }
    const componentsByKind = new Map<string, NonNullable<DirectScene["components"]>>();
    for (const component of scene.components ?? []) {
      const group = componentsByKind.get(component.kind) ?? [];
      group.push(component);
      componentsByKind.set(component.kind, group);
    }
    for (const component of scene.components ?? []) {
      const rootRe = new RegExp(
        `\\bdata-part\\s*=\\s*["']${regexpEscape(component.id)}["']`,
        "i",
      );
      const kindRe = new RegExp(
        `\\bdata-component\\s*=\\s*["']${regexpEscape(component.kind)}["']`,
        "i",
      );
      // A kind-marked element is a safe L2 near-miss only when the storyboard
      // declares exactly ONE component of that kind. With repeated buttons,
      // cards, etc. the kind marker cannot identify which missing id it meant;
      // guessing there can bind motion to the wrong object.
      const uniqueKindCandidate =
        (componentsByKind.get(component.kind)?.length ?? 0) === 1 && kindRe.test(html);
      if (!rootRe.test(html) && !uniqueKindCandidate) {
        notes.push(
          `component root data-part="${component.id}" data-component="${component.kind}" ` +
            "is missing from this scene",
        );
      }
    }
    if (notes.length) out.set(scene.id, notes);
  }
  return out;
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
  const { html, missingHtml, missingScript } = assembleSlotComposition({
    storyboard,
    slots,
    compositionId: slotCompositionId(args.projectDir),
  });
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
  recordSentinelSlotCall("validation-repair", scenes.length);
  const raw = await completeSourceWithContinuation(
    provider,
    slotContinuationPrompt(
      args,
      slots.filmStyle,
      scenes,
      attributed,
      slots,
      "validation",
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

async function authorComposition(
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
  let lastBrowserValid:
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
  const publishBrowserValidCandidate = (
    candidate: CompositionRunResult & { qualityPenalty: number },
    attempts: number,
    reason: string,
  ): CompositionRunResult => {
    process.stderr.write(
      `[author] ${reason}; publishing browser-valid attempt ${candidate.attempts}/3 ` +
        `after ${attempts} attempt(s)\n`,
    );
    summary.strategyChanges.push(reason);
    recordSentinelDegradation(reason);
    const { qualityPenalty: _qualityPenalty, ...best } = candidate;
    return { ...best, attempts };
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
  // One initial authoring pass plus at most two bounded repairs.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (args.attempts) args.attempts.count = attempt;
    // Never spend the FINAL attempt on a compact patch when nothing
    // publishable is banked: a patch that misapplies or breaks syntax there
    // guarantees the deterministic fallback (both recorded 2026-07-04
    // fallbacks died exactly this way), while a full-context re-author at
    // least rolls new dice with the complete findings list. When an earlier
    // attempt already produced a browser-valid draft, a final patch stays
    // cheap and safe — its failure still publishes the banked draft.
    if (attempt === 3 && scratch && !lastBrowserValid) {
      process.stderr.write(
        `[author] final attempt with no browser-valid draft banked; ` +
          `forcing a full-context re-author instead of a compact patch\n`,
      );
      summary.strategyChanges.push("full-reauthor-final-attempt");
      scratch = undefined;
      compact = true;
    }
    const patchMode = Boolean(scratch);
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
      `[author] attempt ${attempt}/3 · prompt ${prompt.length} chars · ` +
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
              `[author] attempt ${attempt}/3 scene-slot retry re-authored only: ` +
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
      process.stderr.write(`[author] attempt ${attempt}/3 response ${raw.length} chars\n`);
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
      if (!validation.ok) {
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
      if (!validation.ok && (patchMode || attempt === 3)) {
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
          `[author] attempt ${attempt}/3 static validation rejected: ` +
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
        summary.attempts.push({
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
        if (attempt === 2 && lastBrowserValid) {
          const earlyReason = earlyLeastBadPublishReason(lastBrowserValid);
          if (earlyReason) {
            return publishBrowserValidCandidate(lastBrowserValid, attempt, earlyReason);
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
      if (browserQa.ok && browserQa.issues?.some((issue) => issue.code === "contrast_aa")) {
        const contrastRepair = repairContrastAaIssues(draft, browserQa);
        if (contrastRepair.repaired.length) {
          const candidateValidation = await validateDirectComposition(
            args.projectDir,
            contrastRepair.draft,
          );
          if (candidateValidation.ok) {
            const candidateQa = await inspectDirectComposition(args.projectDir, contrastRepair.draft, {
              captureGuide: false,
            });
            const beforePenalty = browserQualityPenalty(browserQa, staticRepairWarnings);
            const afterStaticWarnings = [
              ...candidateValidation.frameWarnings,
              ...candidateValidation.motionWarnings,
            ];
            const afterPenalty = browserQualityPenalty(candidateQa, afterStaticWarnings);
            if (!candidateQa.infraError && candidateQa.ok && afterPenalty < beforePenalty) {
              process.stderr.write(
                `[author] deterministically repaired contrast for ` +
                  `${contrastRepair.repaired.join(", ")}: penalty ${beforePenalty} -> ${afterPenalty}\n`,
              );
              recordSentinelNormalization("contrast-aa", contrastRepair.repaired.length);
              summary.strategyChanges.push(`contrast-aa:${contrastRepair.repaired.join(",")}`);
              draft = contrastRepair.draft;
              validation = candidateValidation;
              browserQa = candidateQa;
              staticRepairWarnings = afterStaticWarnings;
            }
          }
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
                `[author] camera-sparse auto-framing zoomed ${sparseFix.corrected.join(", ")}: ` +
                  `penalty ${beforePenalty} -> ${afterPenalty}\n`,
              );
              recordSentinelNormalization("camera-sparse-zoom", sparseFix.corrected.length);
              summary.strategyChanges.push(`camera-sparse-zoom:${sparseFix.corrected.join(",")}`);
              draft = candidate;
              validation = candidateValidation;
              browserQa = candidateQa;
              staticRepairWarnings = afterStaticWarnings;
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
        if (!lastBrowserValid || qualityPenalty < lastBrowserValid.qualityPenalty) {
          lastBrowserValid = {
            draft,
            raw,
            attempts: attempt,
            browserQa,
            qualityPenalty,
            staticRepairWarnings,
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
      if (attempt === 2 && lastBrowserValid) {
        const earlyReason = earlyLeastBadPublishReason(lastBrowserValid);
        if (earlyReason) {
          return publishBrowserValidCandidate(lastBrowserValid, attempt, earlyReason);
        }
      }
      if (attempt === 3 && browserQa.ok && lastBrowserValid) {
        // The least-bad pick: browser-valid but with open polish findings /
        // repair warnings — an honest publish, not a clean one.
        if (lastBrowserValid.qualityPenalty > 0 || !lastBrowserValid.browserQa?.strictOk) {
          recordSentinelDegradation(
            `least-bad-pick:penalty=${lastBrowserValid.qualityPenalty}`,
          );
        }
        const { qualityPenalty: _qualityPenalty, ...best } = lastBrowserValid;
        return { ...best, attempts: attempt };
      }
      validationFeedback = sourceRetryFeedbackForBrowserQa(browserQa, [
        ...validation.frameWarnings,
        ...validation.motionWarnings,
      ]).slice(0, 20);
      process.stderr.write(
        `[author] attempt ${attempt}/3 browser QA requested repair: ` +
          `${validationFeedback.slice(0, 8).join(" | ").slice(0, 1_500)}\n`,
      );
      persistAuthorAttempt(args.projectDir, attempt, "browser-rejected", {
        mode: patchMode ? "patch" : "full",
        findings: validationFeedback,
        html: draft.html,
      });
      summary.attempts.push({
        number: attempt,
        mode: patchMode ? "patch" : "full",
        outcome: "browser-rejected",
        findingSignatures: validationFeedback.map(findingSignature).slice(0, 24),
      });
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
      process.stderr.write(`[author] attempt ${attempt}/3 failed: ${message}\n`);
      persistAuthorAttempt(args.projectDir, attempt, "exception", {
        mode: patchMode ? "patch" : "full",
        findings: [message],
        raw: attemptRaw,
      });
      summary.attempts.push({
        number: attempt,
        mode: patchMode ? "patch" : "full",
        outcome: "exception",
        findingSignatures: [findingSignature(message)],
      });
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
      if (attempt === 2 && lastBrowserValid) {
        const earlyReason = earlyLeastBadPublishReason(lastBrowserValid);
        if (earlyReason) {
          return publishBrowserValidCandidate(lastBrowserValid, attempt, earlyReason);
        }
      }
    }
  }
  if (lastBrowserValid) {
    process.stderr.write(
      `[author] final repair regressed; publishing browser-valid attempt ` +
        `${lastBrowserValid.attempts}/3 instead\n`,
    );
    // The other least-bad publish seam (the s5-slotrepair probe found it
    // unmarked): browser-valid but carrying open polish findings / repair
    // warnings — an honest publish, not a clean one.
    if (lastBrowserValid.qualityPenalty > 0 || !lastBrowserValid.browserQa?.strictOk) {
      recordSentinelDegradation(
        `least-bad-pick:penalty=${lastBrowserValid.qualityPenalty}`,
      );
    }
    const { qualityPenalty: _qualityPenalty, ...best } = lastBrowserValid;
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
  if (rescueTier) {
    process.stderr.write(
      `[author] primary model exhausted its attempts; rescue attempt on ${rescueTier}\n`,
    );
    summary.strategyChanges.push(`source-rescue:${rescueTier}`);
    if (args.attempts) args.attempts.count = 4;
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
        summary.attempts.push({
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
        summary.attempts.push({
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
      summary.attempts.push({
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

const CRITIC_MAX_DIRECTIVES = 5;

const CRITIC_RESPONSE_FORMAT: NonNullable<CompleteOptions["responseFormat"]> = {
  type: "json_schema",
  json_schema: {
    name: "sequences_critique",
    strict: true,
    schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["ship", "repair"] },
        directives: {
          type: "array",
          maxItems: CRITIC_MAX_DIRECTIVES,
          items: { type: "string" },
        },
      },
      required: ["verdict", "directives"],
      additionalProperties: false,
    },
  },
};

function parseCritique(raw: string): string[] {
  const source = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  if (start < 0) return [];
  let value: unknown;
  try {
    value = JSON.parse(source.slice(start, source.lastIndexOf("}") + 1));
  } catch {
    return [];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const object = value as Record<string, unknown>;
  if (object.verdict !== "repair" || !Array.isArray(object.directives)) return [];
  return object.directives
    .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    .map((entry) => entry.trim().slice(0, 300))
    .slice(0, CRITIC_MAX_DIRECTIVES);
}

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
): Promise<string[]> {
  const model = storyboardModel(provider);
  const thinkingMode = storyboardThinkingMode(provider, model);
  const structuredOutput = supportsStructuredOutputs(provider);
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
    'new scenes or assets. If the film ships as-is, return {"verdict":"ship","directives":[]}.',
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
    "## Response contract",
    'Return only a JSON object: {"verdict":"ship"|"repair","directives":["..."]}.',
  ].join("\n");
  const raw = await completeReasoningWithRetry(provider, prompt, {
    ...args.options,
    timeoutMs: 120_000,
    maxTokens: thinkingMode === "none" ? 1_024 : 8_192,
    thinkingMode,
    ...(structuredOutput ? { responseFormat: CRITIC_RESPONSE_FORMAT } : {}),
    ...(model ? { model } : {}),
  }, "critic");
  return parseCritique(raw);
}

async function applyContinuityCritique(
  provider: AgentProvider,
  args: DirectCompositionArgs,
  result: CompositionRunResult,
): Promise<CompositionRunResult> {
  if (process.env.SLACK_SEQUENCES_CREATIVE_CRITIC === "0") return result;
  const lockedStoryboard = args.lockedStoryboard;
  if (!lockedStoryboard?.length || args.revisionInstruction) return result;
  const last = lockedStoryboard[lockedStoryboard.length - 1]!;
  const durationSec = last.startSec + last.durationSec;
  if (durationSec < 10) return result;
  // Sentinel Phase 3: skip the critic on a pristine draft (kill switch
  // `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN=0` restores always-run). Always run it
  // when any polish finding shipped — that is exactly the draft the critic
  // exists to improve.
  if (
    criticSkipCleanEnabled() &&
    criticSkippableCleanDraft(result.browserQa, result.staticRepairWarnings ?? [])
  ) {
    process.stderr.write(
      "[critic] skipped: draft is already clean (strictOk, zero quality penalty)\n",
    );
    return result;
  }
  let directives: string[];
  try {
    directives = await requestContinuityCritique(
      provider,
      { ...args, lockedStoryboard },
      result.draft,
      durationSec,
    );
  } catch (error) {
    process.stderr.write(
      `[critic] unavailable (${error instanceof Error ? error.message : String(error)}); shipping pre-critique draft\n`,
    );
    return result;
  }
  if (!directives.length) {
    process.stderr.write("[critic] verdict: ship\n");
    return result;
  }
  process.stderr.write(
    `[critic] ${directives.length} repair directive(s): ${directives.join(" | ").slice(0, 600)}\n`,
  );
  try {
    const structuredPatches = supportsStructuredOutputs(provider);
    const productionTier = productionModel(provider);
    const prompt = creationPrompt({
      ...args,
      scratch: result.draft,
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
    let draft = applyCompositionRepair(raw, result.draft);
    // Re-inject from the storyboard that actually SHIPPED, not the original
    // locked plan: authoring may have quarantined an optional interaction,
    // and re-injecting the stale plan resurrects the proven-broken binding
    // (this exact mismatch rejected a healthy critic patch on 2026-07-04).
    draft = applyDeterministicSourceRepairs(draft, args.projectDir, result.draft.storyboard);
    const graphError = lockedSceneGraphError(draft.html, lockedStoryboard);
    if (graphError) throw new Error(`critique patch changed the locked storyboard (${graphError})`);
    const validation = await validateDirectComposition(args.projectDir, draft);
    if (!validation.ok) {
      throw new Error(`critique patch failed static validation: ${validation.errors[0] ?? ""}`);
    }
    const browserQa = await inspectDirectComposition(args.projectDir, draft, {
      captureGuide: false,
    });
    if (!browserQa.ok && !browserQa.infraError) {
      throw new Error(`critique patch failed browser QA: ${browserQa.errors[0] ?? ""}`);
    }
    process.stderr.write("[critic] repair directives applied and validated\n");
    return { ...result, draft, browserQa };
  } catch (error) {
    process.stderr.write(
      `[critic] patch rejected (${error instanceof Error ? error.message : String(error)}); keeping pre-critique draft\n`,
    );
    return result;
  }
}

/* -------------------------------------- cut discovery: measure-then-upgrade */

/**
 * Rewrite the cached storyboard artifact so no persisted plan disagrees with
 * the shipped cut island — a stale `planning/storyboard.json` is the island
 * desync bug wearing a new hat. The cache key is preserved: a retried create
 * then plans with the upgraded cut from the start.
 */
function persistUpgradedStoryboard(projectDir: string, storyboard: DirectScene[]): void {
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

/**
 * Deterministic host-side shape-match upgrade (no model in the loop). Browser
 * QA measured every boundary's focal-part geometry; if exactly one
 * `hard`/directional boundary *provably* rhymes, mutate that scene's cut to
 * shape-match, re-run the deterministic injections + full validation with the
 * mutated storyboard, and ship it only when QA stays healthy — the mutated
 * storyboard then flows to everything downstream (critic, moments,
 * motion-plan.json, STORYBOARD.md, the persisted plan). Any regression keeps
 * the pre-upgrade draft: enhancement-never-veto, same as every contract.
 */
async function applyShapeMatchUpgrade(
  args: DirectCompositionArgs,
  result: CompositionRunResult,
): Promise<{ result: CompositionRunResult; storyboard: DirectScene[] } | undefined> {
  if (process.env.SLACK_SEQUENCES_CUT_DISCOVERY === "0") return undefined;
  if (!args.lockedStoryboard?.length || args.revisionInstruction) return undefined;
  const boundaries = result.browserQa?.boundaries;
  if (!boundaries?.length) return undefined;
  // Mutate the storyboard that actually SHIPPED (authoring may have
  // quarantined optional interactions out of the locked plan); re-injecting
  // from the stale locked storyboard would resurrect exactly what the
  // authoring loop proved broken (2026-07-04 live run).
  const shipped = result.draft.storyboard;
  const upgrade = discoverShapeMatchUpgrade(shipped, boundaries);
  if (!upgrade) return undefined;
  const cut = normalizeStoryboardCutIntent({
    version: 1,
    style: "shape-match",
    focalPartOut: upgrade.focalPartOut,
    focalPartIn: upgrade.focalPartIn,
  });
  if (!cut) return undefined;
  const storyboard = shipped.map((scene) =>
    scene.id === upgrade.fromScene
      ? {
          ...scene,
          cut,
          // The artifacts (STORYBOARD.md, Slack outline, manifest) advertise
          // outgoingCut prose — rewrite it so paperwork matches the executed
          // boundary instead of describing the pre-upgrade cut.
          outgoingCut:
            `Morph: "${upgrade.focalPartOut}" becomes ` +
            `"${upgrade.focalPartIn}" (measured silhouette rhyme, discovered at QA).`,
        }
      : scene
  );
  process.stderr.write(
    `[cut-discovery] upgrading ${upgrade.fromScene}->${upgrade.toScene} to morph ` +
      `(${upgrade.focalPartOut} → ${upgrade.focalPartIn}, score ${upgrade.score.toFixed(2)})\n`,
  );
  try {
    const draft = applyDeterministicSourceRepairs(
      { storyboard, html: result.draft.html },
      args.projectDir,
      storyboard,
    );
    const validation = await validateDirectComposition(args.projectDir, draft);
    if (!validation.ok) {
      throw new Error(`static validation rejected the upgrade: ${validation.errors[0] ?? ""}`);
    }
    const browserQa = await inspectDirectComposition(args.projectDir, draft, {
      captureGuide: false,
    });
    if (!browserQa.ok && !browserQa.infraError) {
      throw new Error(`browser QA rejected the upgrade: ${browserQa.errors[0] ?? ""}`);
    }
    // The runtime's bind-time audit stays the final safety net; if it chose
    // to degrade our upgraded boundary, the measured rhyme was not real —
    // keep the honest directional cut instead of shipping a zoom-through.
    const degraded = browserQa.warnings.some((warning) =>
      warning.startsWith("cut_degraded:") &&
      warning.includes(`${upgrade.fromScene}->${upgrade.toScene}`)
    );
    if (degraded) {
      throw new Error("the runtime bind-time audit degraded the upgraded boundary");
    }
    persistUpgradedStoryboard(args.projectDir, storyboard);
    process.stderr.write("[cut-discovery] upgrade validated; shipping the morph boundary\n");
    return { result: { ...result, draft, browserQa }, storyboard };
  } catch (error) {
    process.stderr.write(
      `[cut-discovery] upgrade rejected (${
        error instanceof Error ? error.message : String(error)
      }); keeping the pre-upgrade draft\n`,
    );
    return undefined;
  }
}

/** The raw runtime-degradation warning emitted by browser QA. The degrade
 * target is measured at bind time: `swipe-<axis>` for a retargeted morph
 * (MD1), `zoom-through` for legacy runtimes replaying cached islands. */
const RAW_DEGRADED_CUT_WARNING =
  /^cut_degraded: \S+ ([\w-]+)->([\w-]+) compiled as ([\w-]+): (.*)$/;

/**
 * Pure half of the paperwork reconciler: rewrite every runtime-degraded
 * declared bridged cut in the SHIPPED storyboard as the cut that actually
 * executed (an axis-derived swipe, or zoom-through on legacy runtimes), with
 * honest advertising prose. Exported for tests.
 */
export function rewriteDegradedCutStoryboard(
  shipped: DirectScene[],
  qaWarnings: string[],
): { storyboard: DirectScene[]; rewritten: string[] } {
  const degraded = new Map<string, { target: string; reason: string }>();
  for (const warning of qaWarnings) {
    const match = warning.match(RAW_DEGRADED_CUT_WARNING);
    if (match) {
      degraded.set(`${match[1]}->${match[2]}`, {
        target: match[3] ?? "zoom-through",
        reason: match[4] ?? "",
      });
    }
  }
  const rewritten: string[] = [];
  if (!degraded.size) return { storyboard: shipped, rewritten };
  const storyboard = shipped.map((scene, index) => {
    const next = shipped[index + 1];
    const cut = scene.cut;
    if (!next || !cut) return scene;
    if (
      cut.style !== "morph" && cut.style !== "match" &&
      cut.style !== "shape-match" && cut.style !== "object-match"
    ) return scene;
    const outcome = degraded.get(`${scene.id}->${next.id}`);
    if (outcome === undefined) return scene;
    rewritten.push(`${scene.id}->${next.id} (${cut.style})`);
    const swipeAxis = outcome.target.match(/^swipe-(left|right|up|down)$/)?.[1] as
      | CutAxis
      | undefined;
    const executed = swipeAxis
      ? { style: "swipe" as const, axis: swipeAxis }
      : { style: "zoom-through" as const };
    return {
      ...scene,
      cut: {
        version: 1 as const,
        ...executed,
        // Keep any authored boundary timing so the executed window stays put.
        ...(cut.travelPx !== undefined ? { travelPx: cut.travelPx } : {}),
        ...(cut.exitSec !== undefined ? { exitSec: cut.exitSec } : {}),
        ...(cut.entrySec !== undefined ? { entrySec: cut.entrySec } : {}),
      },
      outgoingCut:
        `${swipeAxis ? `Swipe ${swipeAxis}` : "Zoom-through"} into "${next.title}" ` +
        `(a declared ${cut.style} was degraded at bind time: ${outcome.reason}).`,
    };
  });
  return { storyboard, rewritten };
}

/**
 * Honest paperwork for boundaries the runtime degraded (WS1). When a declared
 * bridged cut survived every repair opportunity and still compiled as
 * zoom-through, the shipped artifacts — STORYBOARD.md, the Slack outline,
 * manifest.json, the cut island — must record the cut that actually executed,
 * never the morph that did not. Rewrite the shipped storyboard from the QA
 * result, re-inject deterministically, and accept the rewrite only when full
 * validation stays healthy; the executed motion is already a zoom-through, so
 * this changes records, not the film. Any regression keeps the pre-reconcile
 * draft (enhancement-never-veto).
 */
async function reconcileDegradedCutPaperwork(
  args: DirectCompositionArgs,
  result: CompositionRunResult,
): Promise<CompositionRunResult> {
  // Rewrite from the storyboard that actually SHIPPED (gotcha #10).
  const { storyboard, rewritten } = rewriteDegradedCutStoryboard(
    result.draft.storyboard,
    result.browserQa?.warnings ?? [],
  );
  if (!rewritten.length) return result;
  try {
    const draft = applyDeterministicSourceRepairs(
      { storyboard, html: result.draft.html },
      args.projectDir,
      storyboard,
    );
    const validation = await validateDirectComposition(args.projectDir, draft);
    if (!validation.ok) {
      throw new Error(`static validation rejected the rewrite: ${validation.errors[0] ?? ""}`);
    }
    const browserQa = await inspectDirectComposition(args.projectDir, draft, {
      captureGuide: false,
    });
    if (!browserQa.ok && !browserQa.infraError) {
      throw new Error(`browser QA rejected the rewrite: ${browserQa.errors[0] ?? ""}`);
    }
    persistUpgradedStoryboard(args.projectDir, storyboard);
    process.stderr.write(
      `[cut-honesty] rewrote ${rewritten.length} runtime-degraded boundary/ies as the cut ` +
        `that actually executed in the shipped storyboard: ${rewritten.join(", ")}\n`,
    );
    recordSentinelDegradation(`cut-degraded-shipped:${rewritten.join(",")}`);
    return { ...result, draft, browserQa };
  } catch (error) {
    process.stderr.write(
      `[cut-honesty] paperwork reconcile rejected (${
        error instanceof Error ? error.message : String(error)
      }); keeping the shipped draft as-is\n`,
    );
    return result;
  }
}

export async function requestDirectComposition(
  provider: AgentProvider,
  args: DirectCompositionArgs,
): Promise<CompositionRunResult> {
  let result = await authorComposition(provider, args);
  // Upgrade BEFORE the critic, so the critic reviews the film that will
  // actually ship; the mutated storyboard flows into its evidence pack and
  // its repair re-injections.
  let critiqueArgs = args;
  const upgraded = await applyShapeMatchUpgrade(args, result);
  if (upgraded) {
    result = upgraded.result;
    critiqueArgs = { ...args, lockedStoryboard: upgraded.storyboard };
  }
  const critiqued = await applyContinuityCritique(provider, critiqueArgs, result);
  // LAST: whatever ships, its paperwork tells the truth about every boundary.
  const final = await reconcileDegradedCutPaperwork(args, critiqued);
  // L1 telemetry measured against the document that SHIPS: how many
  // host-guaranteed bindings the skeleton/slots path actually preserved, not
  // how many the templates planned (idempotent-by-max across revisions).
  if (sentinelSkeletonEnabled() || sentinelSlotsEnabled()) {
    recordSentinelScaffold(
      countScaffoldBindingsPresent(final.draft.storyboard, final.draft.html),
      countScaffoldedBindings(final.draft.storyboard),
    );
  }
  // Publish-time honesty scan: host-invented neutral placeholder children
  // (`topUpRowsMarkup`) that survived into the SHIPPING document mean the
  // film shows literal "Item 1…" copy (the s5-slotrepair probe's terminal did,
  // on frame). Detected here — not at injection — because an earlier attempt's
  // injection may be superseded by a real re-author.
  if (/\bdata-sequences-neutral\s*=\s*["']1["']/i.test(final.draft.html)) {
    recordSentinelDegradation("rows-neutral-children-shipped");
  }
  // Quarantined interactions likewise leave a detectable style tag; scanning
  // the shipping document (not the quarantine helpers, which also run on
  // attempts that later lose) keeps the ledger exact.
  if (/<style\s+data-sequences-quarantine\b/i.test(final.draft.html)) {
    recordSentinelDegradation("interaction-quarantine-shipped");
  }
  return final;
}
