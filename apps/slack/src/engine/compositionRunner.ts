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
  normalizeStoryboardCutIntent,
  resolveCutPlan,
} from "./cutContract.ts";
import {
  CAMERA_FULL_MOVES,
  CAMERA_MOVES,
  CAMERA_RUNTIME_FILE,
  SEQUENCES_EASES,
  auditCameraEnergy,
  injectCameraRuntimeTag,
  normalizeStoryboardCameraIntent,
  resolveCameraPlan,
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
} from "./timeRamp.ts";
import { discoverShapeMatchUpgrade } from "./cutDiscovery.ts";
import {
  COMPONENT_BEAT_KINDS,
  COMPONENT_KINDS,
  COMPONENT_KIT_FILE,
  COMPONENT_KIT_VERSION,
  COMPONENT_RUNTIME_FILE,
  componentAuthoringReference,
  componentPlanningVocabulary,
  componentSupportsBeat,
  injectComponentKit,
  injectComponentRuntimeTag,
  normalizeStoryboardComponentBeats,
  normalizeStoryboardComponents,
  resolveComponentPlan,
  type ComponentKind,
} from "./componentContract.ts";
import {
  normalizeStoryboardMoments,
  plannedMomentFloor,
  resolveMomentContract,
  validatePlannedMoments,
} from "./storyboardMoments.ts";
import { analyzeMotionDensity } from "./motionDensity.ts";
import { readFrameMeta } from "./frameDesign.ts";
import {
  creativeModel,
  creativeThinkingMode,
  productionModel,
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
}

const COMPOSITION_SOURCE_BUDGET_CHARS = 38_000;
const COMPACT_SKILL_BUDGET_CHARS = 16_000;
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
                "camera", "components", "beats", "spatialIntent", "moments", "interactions",
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

/**
 * Reconcile only interaction targets whose intended element is mechanically
 * unambiguous. Exact element ids win; a semantic-name fallback is allowed only
 * when one globally unique part is the sole high-confidence candidate.
 * Ambiguity deliberately remains for quarantine/repair instead of guessing.
 */
export function reconcileInteractionTargets(
  source: string,
  interactions: NonNullable<DirectScene["interactions"]>,
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const desiredParts = [...new Map(interactions.flatMap((interaction) => [
    {
      sceneId: interaction.sceneId,
      part: interaction.targetPart,
    },
    ...(interaction.dragTargetPart
      ? [{ sceneId: interaction.sceneId, part: interaction.dragTargetPart }]
      : []),
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
      if (body === payload) return match;
      repairs += 1;
      return `${open}${payload}${close}`;
    }
    repairs += 1;
    return "";
  });
  return { html, repairs, found };
}

function ensureTagAttr(tag: string, name: string, value: string): string {
  const escaped = regexpEscape(name);
  const pattern = new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i");
  if (pattern.test(tag)) {
    return tag.replace(pattern, `${name}="${value}"`);
  }
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

function reconcileComponentBindings(
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
      if (!tags.length) continue;
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
          `<script type="application/json" id="sequences-interactions">${payload}</script>\n` +
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
      process.stderr.write(
        `[author] normalized ${repairedBindings} deterministic interaction binding(s)\n`,
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
          `<script type="application/json" id="sequences-cuts">${payload}</script>\n` +
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
          `<script type="application/json" id="sequences-camera">${payload}</script>\n` +
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
          `<script type="application/json" id="sequences-components">${payload}</script>\n` +
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
          `<script type="application/json" id="sequences-time">${payload}</script>\n` +
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
      return await provider.complete(prompt, options);
    } catch (error) {
      lastError = error;
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
      return await provider.streamComplete(prompt, options, () => {}, () => {});
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || isOutputTruncation(error) || !isTransientProviderError(error)) {
        throw error;
      }
      process.stderr.write(
        `[${label}] attempt ${attempt}/${attempts} transient streaming fault: ` +
          `${error instanceof Error ? error.message : String(error)} â€” retrying\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    }
  }
  throw lastError;
}

function compactSkillText(text: string): string {
  return text
    .replace(/<(blueprint|motion-rule)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, COMPACT_SKILL_BUDGET_CHARS);
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
  const scenes = value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`storyboard_json[${index}] must be an object`);
    const scene = item as Record<string, unknown>;
    const id = typeof scene.id === "string" ? scene.id.trim() : "";
    const title = typeof scene.title === "string" ? scene.title.trim() : "";
    const purpose = typeof scene.purpose === "string" ? scene.purpose.trim() : "";
    const startSec = Number(scene.startSec);
    const durationSec = Number(scene.durationSec);
    if (!id || !title || !purpose || !Number.isFinite(startSec) || !Number.isFinite(durationSec)) {
      throw new Error(`storyboard_json[${index}] is missing id/title/purpose/finite timing`);
    }
    const spatialIntent = normalizeStoryboardSpatialIntent(scene.spatialIntent);
    const cut = normalizeStoryboardCutIntent(scene.cut);
    const timeRamp = normalizeStoryboardTimeRamp(scene.timeRamp, { startSec, durationSec });
    const camera = normalizeStoryboardCameraIntent(scene.camera, { startSec, durationSec });
    const worldLayout = normalizeWorldLayout(scene.worldLayout, Boolean(camera?.path.length));
    const components = normalizeStoryboardComponents(scene.components);
    const beats = normalizeStoryboardComponentBeats(
      scene.beats,
      { sceneId: id, startSec, durationSec },
      components,
    );
    const interactions = normalizeStoryboardInteractionIntents(scene.interactions, {
      sceneId: id,
      startSec,
      durationSec,
    });
    const moments = normalizeStoryboardMoments(scene.moments, {
      sceneId: id,
      startSec,
      durationSec,
    });
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
      ...(camera ? { camera } : {}),
      ...(worldLayout.length ? { worldLayout } : {}),
      ...(components.length ? { components } : {}),
      ...(beats.length ? { beats } : {}),
      ...(spatialIntent ? { spatialIntent } : {}),
      ...(interactions.length ? { interactions } : {}),
      ...(moments.length ? { moments } : {}),
    };
  });
  const usedInteractionIds = new Set<string>();
  return scenes.map((scene) => ({
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
        `${requirements.minCameraMoves} typed camera moves, not ${cameraMoves}`,
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
        "multiple stations with two or more typed camera moves",
    );
  }
  if (
    requirements.requireObjectMatch &&
    !storyboard.some((scene) => scene.cut?.style === "object-match")
  ) {
    errors.push("the brief explicitly requests an object-match cut, but none is planned");
  }
  if (
    requirements.requireShapeMatch &&
    !storyboard.some((scene) => scene.cut?.style === "shape-match")
  ) {
    errors.push("the brief explicitly requests a shape-match cut, but none is planned");
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
  // Camera-energy audit: every 12s+ film needs at least one high-energy
  // element, and four-plus full moves may not share one verb.
  errors.push(...auditCameraEnergy(storyboard));
  return [...new Set(errors)];
}

export function parseStoryboardResponse(
  raw: string,
  requirements: StoryboardPlanRequirements = {},
): DirectScene[] {
  const knownCapabilities = new Set(
    loadCapabilityIndex().capabilities.map((capability) => capability.id),
  );
  const storyboard = parseStoryboard(extractStoryboardSource(raw)).map((scene) => ({
    ...scene,
    ...(scene.capabilityIds
      ? { capabilityIds: scene.capabilityIds.filter((id) => knownCapabilities.has(id)) }
      : {}),
  }));
  const errors = validateStoryboardPlan(storyboard, requirements);
  if (errors.length) throw new Error(`invalid storyboard plan: ${errors.join("; ")}`);
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
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as {
        version?: number;
        key?: string;
        concept?: ConceptDirection;
      };
      if (cached.version === 1 && cached.key === cacheKey && cached.concept) {
        return cached.concept;
      }
    } catch {
      // A partial cache from an interrupted write is ignored and replaced.
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
      ? `## Job frame.md (art direction system)\n${args.frameMd.slice(0, 4_000)}`
      : "",
    "",
    "## Response contract",
    "Return only a JSON object with exactly those six string fields. No prose.",
  ].filter(Boolean).join("\n");
  try {
    const raw = await completeWithRetry(provider, prompt, {
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
    fs.mkdirSync(planningDir, { recursive: true });
    const temporary = `${cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: 1, key: cacheKey, concept }, null, 2) + "\n",
      "utf8",
    );
    fs.renameSync(temporary, cacheFile);
    return concept;
  } catch (error) {
    process.stderr.write(
      `[concept] pass unavailable (${error instanceof Error ? error.message : String(error)}); ` +
        "continuing without a concept artifact\n",
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
  const explicitCamera =
    /\blarge spatial\b|\bspatial ui world\b|\bcamera (?:push|pan|whip|move|travel)/i.test(brief);
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
      ? { minCameraMoves: 2, requireMultiStationWorld: true }
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
  const maxTokens =
    thinkingMode === "none" ? STORYBOARD_MAX_TOKENS : REASONING_STORYBOARD_MAX_TOKENS;
  const requirements = inferStoryboardPlanRequirements(
    args.brief,
    args.targetDurationSec,
  );
  // GLM job #1: the concept pass. Its artifact is cached independently, so a
  // storyboard retry never re-spends the concept call.
  const concept = await requestConceptDirection(provider, {
    brief: args.brief,
    projectDir: args.projectDir,
    frameMd: args.frameMd,
    options: args.options,
  });
  const cacheKey = createHash("sha256").update(JSON.stringify({
    // Bump when the storyboard contract changes shape (v2: StoryboardMomentV1,
    // v3: typed components + beats; v4: brief-derived coverage requirements;
    // v5: shape-match cuts + orbit/rack-focus camera vocabulary; v6: timeRamp
    // speed-ramping dips).
    contract: 6,
    provider: provider.id,
    model: model ?? null,
    brief: args.brief,
    frameMd: args.frameMd ?? null,
    concept: concept ?? null,
    requirements,
    registryVersion: args.skills.registryVersion,
    blueprints: args.skills.blueprintIds,
  })).digest("hex");
  const planningDir = path.join(args.projectDir, "planning");
  const cacheFile = path.join(planningDir, "storyboard.json");
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as {
        version?: number;
        key?: string;
        storyboard?: DirectScene[];
      };
      if (cached.version === 1 && cached.key === cacheKey && cached.storyboard) {
        const errors = validateStoryboardPlan(cached.storyboard, requirements);
        if (!errors.length) return cached.storyboard;
      }
    } catch {
      // A partial cache from an interrupted write is ignored and replaced.
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
    "RACK FOCUS — any camera move may carry a",
    '"focus":{"part":"data-part","blurMaxPx":6} (or {"depth":0..1}) modifier:',
    "the rig pulls a focal plane between the scene's data-depth layers,",
    "blurring the others in proportion to depth distance. Two consecutive",
    "moves with different focus targets stage a cinematic focus pull",
    "(defocus the background context, then land focus on the payoff detail).",
    "Use it only in scenes the author will build with 2+ depth layers.",
    "CAMERA ENERGY — camera verbs must track the film's energy curve, never",
    "distribute one verb evenly. Peak scenes get a whip, a hard push-in",
    '("zoom":1.35+), or a zoom-through/inverse-zoom cut INTO them; valleys get',
    "a short hold or slow drift so the claim can breathe. A 12s+ film with no",
    "whip, no 1.3+ push-in, and no energetic cut is rejected deterministically.",
    "Rhythm pattern that works: whip to a region, drift while its content",
    "reveals, then whip onward — alternate loud and quiet camera energy.",
    "Give a camera path to any shot longer than ~4 seconds; name 2-4 regions",
    "per world using stable kebab-case (hero-claim, metric-wall, ui-demo,",
    "cta-station). track-to-anchor requires a toPart the author will create.",
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
    "Every shot's boundary is a typed, machine-executed cut. Choose cut.style from:",
    "hard (intentional register break), cut-left/right/up/down (velocity-matched",
    "directional carry — the default for scene-to-scene motion), zoom-through",
    "(progressing deeper), inverse-zoom (arriving at a payoff), flash-white (one",
    "energetic reset at most), object-match (a focal element visibly travels to a",
    "matching element in the next shot; requires focalPartOut/focalPartIn data-part",
    "names the author will create), shape-match (two DIFFERENT elements whose",
    "silhouettes rhyme — a search pill lands as a status bar, a window becomes a",
    "card, an avatar circle becomes a chart dot — swap across the boundary through",
    "a crossfading bridge; requires focalPartOut/focalPartIn, plus optional",
    'shapeOut/shapeIn hints from pill|bar|card|circle|window as your own',
    "silhouette self-check. Declare shape-match only when the two silhouettes",
    "genuinely rhyme; a >2.5x aspect mismatch degrades to zoom-through at bind",
    "time). The host compiles the cut deterministically;",
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
          "BRIEF-SPECIFIC COMPONENT COVERAGE â€” this brief explicitly asks for",
          `motion-native ${requirements.requestedComponentKinds?.join(", ")} components.`,
          `Plan at least ${requirements.minRequestedComponentKinds} of those distinct kinds and at least`,
          `${requirements.minComponentBeats} typed component beats. Product beats must become`,
          "visible UI state changes; mentioning them only in foreground prose does not count.",
        ]
      : []),
    ...(requirements.minCameraMoves
      ? [
          "",
          "BRIEF-SPECIFIC CAMERA COVERAGE â€” this brief explicitly asks for a",
          `spatial camera world. Plan at least ${requirements.minCameraMoves} full typed camera`,
          "moves, with one shot traveling through multiple named stations. A set of",
          "static shots or a single minor pan does not satisfy the request.",
        ]
      : []),
    ...(requirements.requireObjectMatch
      ? [
          "The brief explicitly asks for object-match cuts; plan at least one typed",
          "object-match boundary with both focal part names.",
        ]
      : []),
    ...(requirements.requireShapeMatch
      ? [
          "The brief explicitly asks for a shape-match transition; plan at least one",
          "typed shape-match boundary with both focal part names and shapeOut/shapeIn",
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
    storyboardReference(args.skills.text),
    "",
    "## Brief and trusted evidence",
    args.brief,
    "",
    args.frameMd
      ? `## Job frame.md\nUse its visual thesis, palette/type constraints, and spatial character without constraining motion.\n<frame_md>\n${args.frameMd}\n</frame_md>`
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
    '"cut":{"version":1,"style":"cut-left|cut-right|cut-up|cut-down|zoom-through|inverse-zoom|flash-white|object-match|shape-match|hard",',
    '"focalPartOut":"for object-match/shape-match","focalPartIn":"for object-match/shape-match",',
    '"shapeOut":"optional shape-match hint: pill|bar|card|circle|window","shapeIn":"same"},',
    '"timeRamp":{"version":1,"atSec":17.2,"slowTo":0.35,"holdSec":0.6,"recoverSec":0.9} for the',
    'one motivated slow-motion dip; use "timeRamp":{"version":1} for no ramp (the default).',
    "timeRamp atSec is absolute composition seconds where the dip begins.",
    '"camera":{"version":1,"path":[{"version":1,"move":"hold|drift|pan|whip|push-in|pull-back|track-to-anchor|parallax-pass|orbit-lite|orbit",',
    '"toRegion":"region name (or toPart for track-to-anchor)","zoom":1,"startSec":0,"durationSec":1.2,',
    '"arcDeg":28,"focus":{"part":"data-part to pull focus onto","depth":0.35,"blurMaxPx":6},',
    "arcDeg only for orbit; focus is an optional rack-focus modifier on any move,",
    "with either part or depth (not both).",
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
    '"toState":"for set-state/press","morphTo":"for morph","ease":"optional"}],',
    "Beat atSec values are absolute composition seconds inside the shot window.",
    'Use "components":[] and "beats":[] when a shot has no product surface.',
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
  // deterministic validation rejects, retry only this stage with the
  // exact findings — never fall through to the safe fallback on a first
  // creative miss, and never replay the concept pass.
  let lastValidationError: Error | undefined;
  let recoveringFromTruncation = false;
  let reasoningFloor: CompleteOptions["thinkingMode"] | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (args.attempts) args.attempts.count = attempt;
    const prompt = attempt === 1 || !lastValidationError
      ? basePrompt
      : [
          basePrompt,
          "",
          "## Previous attempt rejected",
          "Deterministic validation rejected the previous storyboard. Fix every",
          "finding below and return a corrected, complete storyboard:",
          ...lastValidationError.message
            .replace(/^invalid storyboard plan:\s*/i, "")
            .split("; ")
            .slice(0, 16)
            .map((finding) => `- ${finding}`),
        ].join("\n");
    let raw: string;
    try {
      // Only TRUNCATION recovery strips reasoning to protect the completion
      // budget. Validation-rejection retries keep the configured reasoning:
      // the 2026-07-03 experiment matrix showed reasoning-stripped GLM retries
      // failing the moment grid in 3 of 4 runs, while every passing storyboard
      // landed on a full-reasoning attempt.
      const recoveryPass = recoveringFromTruncation;
      const downgraded: CompleteOptions["thinkingMode"] =
        recoveryPass && thinkingMode !== "none"
          ? "none"
          : thinkingMode;
      const attemptThinkingMode =
        reasoningFloor && downgraded === "none" ? reasoningFloor : downgraded;
      const attemptMaxTokens = recoveryPass && thinkingMode !== "none"
        ? Math.min(maxTokens, 8_192)
        : maxTokens;
      process.stderr.write(
        `[storyboard] attempt ${attempt}/3 · ${model ? `model ${model}` : "provider primary model"} · ` +
          `reasoning ${attemptThinkingMode} · max ${attemptMaxTokens} tokens\n`,
      );
      raw = await completeReasoningWithRetry(provider, prompt, {
        ...args.options,
        // A reasoning storyboard pass on a loaded provider can run long; give it more
        // wall-clock headroom than a plain chat call, and let completeWithRetry absorb
        // a transient stall instead of failing the whole build on the first abort.
        timeoutMs: recoveryPass ? 120_000 : 360_000,
        maxTokens: attemptMaxTokens,
        // GLM's budget includes reasoning plus the compact JSON artifact; use
        // nearly the full route ceiling while keeping the artifact bounded.
        thinkingMode: attemptThinkingMode,
        ...(structuredOutput ? { responseFormat: storyboardResponseFormat() } : {}),
        ...(model ? { model } : {}),
      }, "storyboard");
    } catch (error) {
      if (attempt < 3 && isOutputTruncation(error)) {
        recoveringFromTruncation = true;
        process.stderr.write(
          `[storyboard] attempt ${attempt}/3 exhausted its completion budget; ` +
            `retrying the bounded artifact with lower reasoning effort\n`,
        );
        continue;
      }
      if (attempt < 3 && isReasoningMandatoryError(error)) {
        reasoningFloor = "minimal";
        process.stderr.write(
          `[storyboard] attempt ${attempt}/3: this endpoint mandates reasoning; ` +
            `retrying with a minimal reasoning floor\n`,
        );
        continue;
      }
      if (isTransientProviderError(error)) {
        throw new Error(
          "the planning model kept timing out while drafting the storyboard — this is usually a " +
            "transient provider slowdown, not your brief. Run /sequences again in a moment.",
        );
      }
      throw error;
    }
    let storyboard: DirectScene[];
    try {
      storyboard = parseStoryboardResponse(raw, requirements);
    } catch (error) {
      if (attempt < 3 && error instanceof Error && !isOutputTruncation(error)) {
        process.stderr.write(
          `[storyboard] attempt ${attempt}/3 rejected: ${error.message.slice(0, 600)} — retrying with findings\n`,
        );
        lastValidationError = error;
        continue;
      }
      throw error;
    }
    fs.mkdirSync(planningDir, { recursive: true });
    const temporary = `${cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: 1, key: cacheKey, storyboard }, null, 2) + "\n",
      "utf8",
    );
    fs.renameSync(temporary, cacheFile);
    return storyboard;
  }
  throw lastValidationError ?? new Error("storyboard planning failed");
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
    html = html.slice(0, located.start) + patch.replace + html.slice(located.end);
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
        total + (issue.severity === "error" ? 4 : issue.severity === "warning" ? 1 : 0),
      0,
    );
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
    scene.cut?.style === "shape-match" && scene.cut.focalPartOut && scene.cut.focalPartIn
      ? [`${scene.cut.focalPartOut}→${scene.cut.focalPartIn}`]
      : []
  );
  if (shapePairs.length) {
    lines.push(
      `- Shape-match focal parts (${[...new Set(shapePairs)].join(", ")}) must keep`,
      "  comparable aspect ratios and border radii (within ~2.5×) and light",
      "  subtrees (≤60 nodes) or the boundary degrades to zoom-through at bind",
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

function creationPrompt(args: {
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
}): string {
  if (args.scratch) {
    const scratchComponents = componentReferenceFor(
      args.lockedStoryboard ?? args.scratch.storyboard,
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
      "For motion/liveness findings, add seek-safe GSAP beats on child elements,",
      "semantic component parts, or data-camera-world wrappers at explicit",
      "composition times. Do not animate scene wrappers to fake activity.",
      "For storyboard/moments findings, the named moment's changed state must",
      "actually happen at its atSec: author a visible, explicitly positioned",
      "beat on that scene's content there. Never delete or retime the moment;",
      "make the timeline honor it.",
      "Never edit data-composition-id, data-scene values, scene element ids, or storyboard timing.",
      "Do not edit JavaScript unless a finding explicitly identifies script/source validation.",
      "",
      "## Deterministic findings to repair",
      ...(args.validationFeedback ?? []).map((issue) => `- ${issue}`),
      "",
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
        JSON.stringify(args.lockedStoryboard, null, 2),
        "</locked_storyboard_json>",
        ...[worldLayoutGuidance(args.lockedStoryboard)].filter(Boolean),
        lockedLayoutGuidance(args.lockedStoryboard),
      ].join("\n")
    : "";
  const lockedResponse = args.lockedStoryboard
    ? [
        "## Builder response override",
        "The storyboard already exists. Return exactly one <index_html> tag with",
        "the complete document and nothing else. Do not repeat storyboard_json.",
      ].join("\n")
    : "";
  const frame = args.frameMd
    ? [
        "## Frame design system (art direction + deterministic constraints)",
        "Start from this system. Preserve its committed brand hue/font families,",
        "embedded-font requirement, contrast thresholds, and one-accent hierarchy.",
        "Its recommended tints and spatial tokens may be adjusted deliberately as",
        "the document allows; your motion, composition, and rhythm stay free.",
        "<frame_md>",
        args.frameMd,
        "</frame_md>",
      ].join("\n")
    : "";
  const componentReference = componentReferenceFor(
    args.lockedStoryboard ?? args.current?.storyboard,
  );
  return [
    "SYSTEM:",
    DIRECTOR_PROMPT,
    "",
    args.compact ? compactSkillText(args.skills.text) : args.skills.text,
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

async function authorComposition(
  provider: AgentProvider,
  args: DirectCompositionArgs,
): Promise<CompositionRunResult> {
  if (!args.brief.trim()) throw new Error("brief is empty");
  let validationFeedback: string[] | undefined;
  let scratch: DirectCompositionDraft | undefined;
  let compact = false;
  let lastError: unknown;
  let lastBrowserValid:
    | (CompositionRunResult & { qualityPenalty: number })
    | undefined;
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
    const patchMode = Boolean(scratch);
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
    });
    process.stderr.write(
      `[author] attempt ${attempt}/3 · prompt ${prompt.length} chars · ` +
      `${compact ? "compact repair" : "full context"} · ` +
      `${repairTier ? "explicit repair tier" : selectedTier ?? "provider primary tier"} · ` +
      `reasoning ${attemptThinking}\n`,
    );
    try {
      const completeOptions: CompleteOptions = {
        ...args.options,
        timeoutMs: 360_000,
        maxTokens: patchMode ? REPAIR_MAX_TOKENS : authorMaxTokens(),
        thinkingMode: attemptThinking,
        ...(patchMode && structuredPatches ? { responseFormat: PATCH_RESPONSE_FORMAT } : {}),
        ...(selectedTier ? { model: selectedTier } : {}),
      };
      const raw = patchMode
        ? await completeWithRetry(provider, prompt, completeOptions, "author patch")
        : await completeSourceWithContinuation(provider, prompt, completeOptions);
      process.stderr.write(`[author] attempt ${attempt}/3 response ${raw.length} chars\n`);
      const parsedDraft = patchMode
        ? applyCompositionRepair(raw, scratch!)
        : args.lockedStoryboard
          ? {
              storyboard: args.lockedStoryboard,
              html: extractIndexHtmlSource(raw),
            }
          : parseCompositionResponse(raw);
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
      if (!validation.ok) {
        process.stderr.write(
          `[author] attempt ${attempt}/3 static validation rejected: ` +
            `${validation.errors.slice(0, 8).join(" | ").slice(0, 1_500)}\n`,
        );
        const previousFeedback = validationFeedback ?? [];
        validationFeedback = patchMode
          ? [
              ...previousFeedback,
              "The proposed patch was rejected atomically because it made the last valid scratch fail static validation:",
              ...validation.errors,
            ].slice(0, 20)
          : validation.errors.slice(0, 20);
        // Never compound a malformed patch. Retry from the last statically
        // valid scratch; a malformed initial document becomes the scratch
        // because there is no earlier authored candidate to preserve.
        if (!patchMode) scratch = draft;
        compact = true;
        lastError = new Error(validationFeedback.join("; "));
        continue;
      }
      const browserQa = await inspectDirectComposition(args.projectDir, draft, {
        captureGuide: false,
      });
      if (browserQa.infraError) {
        process.stderr.write(
          `[author] browser QA infrastructure unavailable; publishing statically valid draft: ` +
            `${browserQa.infraError}\n`,
        );
        return { draft, raw, attempts: attempt, browserQa };
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
        const staticRepairWarnings = [
          ...validation.frameWarnings,
          ...validation.motionWarnings,
        ];
        const qualityPenalty = browserQualityPenalty(browserQa, staticRepairWarnings);
        if (!lastBrowserValid || qualityPenalty < lastBrowserValid.qualityPenalty) {
          lastBrowserValid = { draft, raw, attempts: attempt, browserQa, qualityPenalty };
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
        return { draft, raw, attempts: attempt, browserQa };
      }
      if (attempt === 3 && browserQa.ok && lastBrowserValid) {
        const { qualityPenalty: _qualityPenalty, ...best } = lastBrowserValid;
        return { ...best, attempts: attempt };
      }
      validationFeedback = [
        ...validation.frameWarnings,
        ...validation.motionWarnings,
        ...browserQa.errors,
        ...browserQa.warnings,
      ].slice(0, 20);
      process.stderr.write(
        `[author] attempt ${attempt}/3 browser QA requested repair: ` +
          `${validationFeedback.slice(0, 8).join(" | ").slice(0, 1_500)}\n`,
      );
      scratch = draft;
      compact = true;
      lastError = new Error(validationFeedback.join("; "));
    } catch (error) {
      const truncated = isOutputTruncation(error);
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[author] attempt ${attempt}/3 failed: ${message}\n`);
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
        if (!patchMode) scratch = undefined;
        compact = true;
      }
      lastError = error;
    }
  }
  if (lastBrowserValid) {
    process.stderr.write(
      `[author] final repair regressed; publishing browser-valid attempt ` +
        `${lastBrowserValid.attempts}/3 instead\n`,
    );
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
  throw new Error(
    `direct HyperFrames authoring failed after two bounded repairs: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
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
    scene.id === upgrade.fromScene ? { ...scene, cut } : scene
  );
  process.stderr.write(
    `[cut-discovery] upgrading ${upgrade.fromScene}->${upgrade.toScene} to shape-match ` +
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
    process.stderr.write("[cut-discovery] upgrade validated; shipping the shape-match boundary\n");
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
  return applyContinuityCritique(provider, critiqueArgs, result);
}
