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
  CUT_STYLES,
  normalizeStoryboardCutIntent,
  resolveCutPlan,
} from "./cutContract.ts";
import {
  CINEMA_KIT_FILE,
  CINEMA_KIT_VERSION,
  injectCinemaKit,
} from "./cinemaKit.ts";
import { readFrameMeta } from "./frameDesign.ts";
import {
  creativeModel,
  creativeThinkingMode,
  productionModel,
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
}

const COMPOSITION_SOURCE_BUDGET_CHARS = 32_000;
const COMPACT_SKILL_BUDGET_CHARS = 16_000;
const REPAIR_MAX_TOKENS = 4_096;
const MAX_REPAIR_PATCHES = 16;
const STORYBOARD_MAX_TOKENS = 4_096;
// GLM spends its budget on reasoning before the compact JSON artifact; its
// provider ceiling is ~33K output tokens, so give the reasoning storyboard
// enough room that a long think cannot truncate the artifact.
const REASONING_STORYBOARD_MAX_TOKENS = 16_384;
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
            maxItems: 5,
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
                  },
                  required: ["version", "style"],
                  additionalProperties: false,
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
                "capabilityIds", "continuityAnchor", "outgoingCut", "cut",
                "spatialIntent", "interactions",
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
  return Number.isFinite(parsed) && parsed >= 4096 ? Math.floor(parsed) : 10_240;
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
  return creativeThinkingMode(provider, model);
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
      const output = await completeWithRetry(provider, prompt, {
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

function applyDeterministicSourceRepairs(
  draft: DirectCompositionDraft,
  projectDir: string,
  lockedStoryboard?: DirectScene[],
): DirectCompositionDraft {
  let html = draft.html;
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
    const islandPattern =
      /(<script\b[^>]*\bid\s*=\s*(["'])sequences-interactions\2[^>]*>)([\s\S]*?)(<\/script>)/i;
    if (islandPattern.test(html)) {
      const updated = html.replace(islandPattern, `$1${payload}$4`);
      if (updated !== html) {
        html = updated;
        repairedBindings += 1;
      }
    } else {
      const timelineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
      if (timelineScript?.index !== undefined) {
        html = html.slice(0, timelineScript.index) +
          `<script type="application/json" id="sequences-interactions">${payload}</script>\n` +
          html.slice(timelineScript.index);
        repairedBindings += 1;
      }
    }
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
        const registration = new RegExp(
          `(window\\.__timelines\\s*\\[[^\\]]+\\]\\s*=\\s*${timelineName.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          )}\\s*;)`,
        );
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
        const registration = new RegExp(
          `(window\\.__timelines\\s*\\[[^\\]]+\\]\\s*=\\s*${regexpEscape(timelineName)}\\s*;)`,
        );
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
    /aborted due to timeout|operation was aborted|the operation timed out|idle timeout|upstream.*timeout|fetch failed|network|terminated|socket hang ?up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|503|502|429/i.test(
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

function compactSkillText(text: string): string {
  return text
    .replace(/<(blueprint|motion-rule)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, COMPACT_SKILL_BUDGET_CHARS);
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
    const interactions = normalizeStoryboardInteractionIntents(scene.interactions, {
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
      ...(spatialIntent ? { spatialIntent } : {}),
      ...(interactions.length ? { interactions } : {}),
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

export function validateStoryboardPlan(storyboard: DirectScene[]): string[] {
  const errors: string[] = [];
  if (storyboard.length < 3 || storyboard.length > 5) {
    errors.push("storyboard must contain 3-5 distinct shots");
  }
  const knownCapabilities = new Set(
    loadCapabilityIndex().capabilities.map((capability) => capability.id),
  );
  const ids = new Set<string>();
  const interactionIds = new Set<string>();
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
  const foregrounds = new Set(storyboard.map((scene) => scene.foreground?.toLowerCase()));
  const cameras = new Set(storyboard.map((scene) => scene.cameraIntent?.toLowerCase()));
  if (foregrounds.size < Math.min(3, storyboard.length)) {
    errors.push("storyboard repeats the same foreground composition across shots");
  }
  if (cameras.size < 2) {
    errors.push("storyboard needs at least two distinct camera/framing intentions");
  }
  return [...new Set(errors)];
}

export function parseStoryboardResponse(raw: string): DirectScene[] {
  const knownCapabilities = new Set(
    loadCapabilityIndex().capabilities.map((capability) => capability.id),
  );
  const storyboard = parseStoryboard(extractStoryboardSource(raw)).map((scene) => ({
    ...scene,
    ...(scene.capabilityIds
      ? { capabilityIds: scene.capabilityIds.filter((id) => knownCapabilities.has(id)) }
      : {}),
  }));
  const errors = validateStoryboardPlan(storyboard);
  if (errors.length) throw new Error(`invalid storyboard plan: ${errors.join("; ")}`);
  return storyboard;
}

export function parseCompositionResponse(raw: string): DirectCompositionDraft {
  return {
    storyboard: parseStoryboard(tagged(raw, "storyboard_json")),
    html: extractIndexHtmlSource(raw),
  };
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

export async function requestStoryboardPlan(
  provider: AgentProvider,
  args: {
    brief: string;
    projectDir: string;
    skills: RetrievedSkillContext;
    frameMd?: string;
    options?: CompleteOptions;
  },
): Promise<DirectScene[]> {
  const structuredOutput = supportsStructuredOutputs(provider);
  const model = storyboardModel(provider);
  const thinkingMode = storyboardThinkingMode(provider, model);
  const maxTokens =
    thinkingMode === "none" ? STORYBOARD_MAX_TOKENS : REASONING_STORYBOARD_MAX_TOKENS;
  const cacheKey = createHash("sha256").update(JSON.stringify({
    provider: provider.id,
    model: model ?? null,
    brief: args.brief,
    frameMd: args.frameMd ?? null,
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
        const errors = validateStoryboardPlan(cached.storyboard);
        if (!errors.length) return cached.storyboard;
      }
    } catch {
      // A partial cache from an interrupted write is ignored and replaced.
    }
  }
  const prompt = [
    "SYSTEM: You are the cut-first editor for a short SaaS launch film.",
    "Design the storyboard before any HTML is written. Make 3-5 distinct shots",
    "that form one visual argument, not a centered headline/stat/CTA parade.",
    "Each shot needs a different foreground composition and a purposeful camera",
    "or framing intention. Carry the eye across every cut through one explicit",
    "anchor: component, position, direction, color field, shape, or semantic idea.",
    "Every shot's boundary is a typed, machine-executed cut. Choose cut.style from:",
    "hard (intentional register break), cut-left/right/up/down (velocity-matched",
    "directional carry — the default for scene-to-scene motion), zoom-through",
    "(progressing deeper), inverse-zoom (arriving at a payoff), flash-white (one",
    "energetic reset at most), object-match (a focal element visibly travels to a",
    "matching element in the next shot; requires focalPartOut/focalPartIn data-part",
    "names the author will create). The host compiles the cut deterministically;",
    "the prose outgoingCut must describe the same editorial idea as cut.style.",
    "Name one frame.md flow scaffold in spatialIntent.composition for every shot:",
    "layout-center-stack, layout-split, layout-editorial-left, layout-meta-top,",
    "layout-corner-chrome, or layout-hero-band. Describe foreground groups as",
    "semantic zones within that scaffold, not as guessed canvas coordinates.",
    "Registry capabilities are a reuse-first vocabulary, not a mandatory quota.",
    "Use only capability ids that appear in the supplied synced index.",
    "",
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
    '"cut":{"version":1,"style":"cut-left|cut-right|cut-up|cut-down|zoom-through|inverse-zoom|flash-white|object-match|hard",',
    '"focalPartOut":"only for object-match","focalPartIn":"only for object-match"},',
    '"spatialIntent":{"version":1,"focalPart":"stable semantic part",',
    '"composition":"free-text compositional character","relationships":["important relationship"]},',
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
  let raw: string;
  try {
    process.stderr.write(
      `[storyboard] primary contract · ${model ? `model ${model}` : "provider primary model"} · ` +
        `reasoning ${thinkingMode} · max ${maxTokens} tokens\n`,
    );
    raw = await completeWithRetry(provider, prompt, {
      ...args.options,
      // A reasoning storyboard pass on a loaded provider can run long; give it more
      // wall-clock headroom than a plain chat call, and let completeWithRetry absorb
      // a transient stall instead of failing the whole build on the first abort.
      timeoutMs: 180_000,
      maxTokens,
      // GLM's budget includes reasoning plus the compact JSON artifact; give it
      // twice the non-reasoning budget while keeping the one-shot task bounded.
      thinkingMode,
      ...(structuredOutput ? { responseFormat: storyboardResponseFormat() } : {}),
      ...(model ? { model } : {}),
    }, "storyboard");
  } catch (error) {
    if (isTransientProviderError(error)) {
      throw new Error(
        "the planning model kept timing out while drafting the storyboard — this is usually a " +
          "transient provider slowdown, not your brief. Run /sequences again in a moment.",
      );
    }
    throw error;
  }
  const storyboard = parseStoryboardResponse(raw);
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
  const islandPattern =
    /(<script\b[^>]*\bid\s*=\s*(["'])sequences-interactions\2[^>]*>)([\s\S]*?)(<\/script>)/i;
  if (!islandPattern.test(draft.html)) {
    // Static validation will reject the unchanged mismatch; do not pretend the
    // enhancement was isolated when its canonical island was absent.
    return { draft, removedIds: [] };
  }
  let html = draft.html.replace(islandPattern, `$1${payload}$4`);
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
    candidate.browserQa.issues,
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
    },
    browserQa,
  };
}

function browserQualityPenalty(
  browserQa: DirectBrowserQaResult,
  frameWarnings: string[] = [],
): number {
  const runtimeWarnings = browserQa.warnings.filter((warning) =>
    warning.startsWith("browser_warning:")
  ).length;
  return frameWarnings.length * 2 + runtimeWarnings * 2 +
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
      "Never edit data-composition-id, data-scene values, scene element ids, or storyboard timing.",
      "Do not edit JavaScript unless a finding explicitly identifies script/source validation.",
      "",
      "## Deterministic findings to repair",
      ...(args.validationFeedback ?? []).map((issue) => `- ${issue}`),
      "",
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
  return [
    "SYSTEM:",
    DIRECTOR_PROMPT,
    "",
    args.compact ? compactSkillText(args.skills.text) : args.skills.text,
    "",
    "## Job brief and trusted evidence",
    args.brief,
    "",
    frame,
    "## Available project-local assets",
    availableAssets(args.projectDir),
    "",
    "## Output-size contract",
    `The entire response must stay under ${COMPOSITION_SOURCE_BUDGET_CHARS.toLocaleString("en-US")} characters.`,
    "Default to 3 scenes; use 4 only when the story truly needs it. Reuse CSS",
    "classes and shared primitives. No comments, duplicated per-scene styles,",
    "embedded data URLs, verbose SVG paths, or explanatory text. Completeness",
    "outranks ornamental source volume.",
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

export async function requestDirectComposition(
  provider: AgentProvider,
  args: {
    brief: string;
    projectDir: string;
    skills: RetrievedSkillContext;
    frameMd?: string;
    current?: DirectCompositionDraft;
    lockedStoryboard?: DirectScene[];
    revisionInstruction?: string;
    options?: CompleteOptions;
  },
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
  // One initial authoring pass plus at most two bounded repairs.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const patchMode = Boolean(scratch);
    // Never downgrade a full-document recovery because of its attempt number.
    // A separately configured repair model is eligible only when a valid
    // scratch document exists and the task is a bounded exact patch.
    const repairTier = patchMode ? repairModel(provider) : undefined;
    const selectedTier = repairTier ?? productionTier;
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
      `reasoning ${patchMode ? repairThinkingMode(repairTier) : "off"}\n`,
    );
    try {
      const completeOptions: CompleteOptions = {
        ...args.options,
        timeoutMs: 360_000,
        // Code emission does not benefit from DeepSeek's expensive high/xhigh
        // reasoning pass. Keeping it off reserves the whole budget for source.
        maxTokens: patchMode ? REPAIR_MAX_TOKENS : authorMaxTokens(),
        thinkingMode: patchMode ? repairThinkingMode(repairTier) : "none",
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
        return { draft, raw, attempts: attempt };
      }
      if (
        !browserQa.ok &&
        browserQa.issues.some((issue) =>
          issue.severity === "error" &&
          issue.code.startsWith("interaction_") &&
          Boolean(issue.interactionId)
        )
      ) {
        interactionFallbacks.push({ draft, raw, browserQa });
      }
      if (browserQa.ok) {
        const qualityPenalty = browserQualityPenalty(browserQa, validation.frameWarnings);
        if (!lastBrowserValid || qualityPenalty < lastBrowserValid.qualityPenalty) {
          lastBrowserValid = { draft, raw, attempts: attempt, qualityPenalty };
        }
      }
      // Visual findings receive a repair opportunity, but they are heuristic:
      // failed polish must never discard a document that loaded and initialized
      // correctly in the browser. `browserQa.ok` represents that objective
      // runtime boundary; static validation remains the other hard gate.
      if (
        browserQa.strictOk && validation.frameWarnings.length === 0
      ) {
        return { draft, raw, attempts: attempt };
      }
      if (attempt === 3 && browserQa.ok && lastBrowserValid) {
        const { qualityPenalty: _qualityPenalty, ...best } = lastBrowserValid;
        return { ...best, attempts: attempt };
      }
      validationFeedback = [
        ...validation.frameWarnings,
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
      process.stderr.write(
        `[author] attempt ${attempt}/3 failed: ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
      validationFeedback = [
        truncated
          ? `The previous response exhausted its output budget. Return a complete document under ${COMPOSITION_SOURCE_BUDGET_CHARS.toLocaleString("en-US")} characters; simplify source, not the visual thesis.`
          : error instanceof Error ? error.message : String(error),
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
