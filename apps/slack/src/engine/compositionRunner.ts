/**
 * Provider-agnostic direct HyperFrames authoring. The model writes the actual
 * composition source; deterministic validation owns the publication boundary.
 */
import fs from "node:fs";
import path from "node:path";
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
import { inspectDirectComposition } from "./layoutInspector.ts";

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
const STORYBOARD_MAX_TOKENS = 3_072;

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
function repairModel(provider: AgentProvider, attempt: number): string | undefined {
  const configured = process.env.SLACK_SEQUENCES_REPAIR_MODEL?.trim();
  if (configured) return configured;
  // Keep the first targeted repair on Pro for fidelity. Flash is the final,
  // cheap fallback only if a second repair is actually necessary.
  return provider.id === "openrouter-api" && attempt >= 3
    ? "deepseek/deepseek-v4-flash"
    : undefined;
}

function storyboardModel(provider: AgentProvider): string | undefined {
  const configured = process.env.SLACK_SEQUENCES_STORYBOARD_MODEL?.trim();
  if (configured) return configured;
  return provider.id === "openrouter-api" ? "deepseek/deepseek-v4-flash" : undefined;
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

function isOutputTruncation(error: unknown): boolean {
  return error instanceof ProviderOutputTruncatedError ||
    (error instanceof Error && /truncat|output-token limit|finish_reason.?length/i.test(error.message));
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
    /aborted due to timeout|operation was aborted|the operation timed out|fetch failed|network|terminated|socket hang ?up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|503|502|429/i.test(
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
  return value.map((item, index) => {
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
    };
  });
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
  const storyboard = parseStoryboard(extractStoryboardSource(raw));
  const errors = validateStoryboardPlan(storyboard);
  if (errors.length) throw new Error(`invalid storyboard plan: ${errors.join("; ")}`);
  return storyboard;
}

export function parseCompositionResponse(raw: string): DirectCompositionDraft {
  return {
    storyboard: parseStoryboard(tagged(raw, "storyboard_json")),
    html: tagged(raw, "index_html"),
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
  const prompt = [
    "SYSTEM: You are the cut-first editor for a short SaaS launch film.",
    "Design the storyboard before any HTML is written. Make 3-5 distinct shots",
    "that form one visual argument, not a centered headline/stat/CTA parade.",
    "Each shot needs a different foreground composition and a purposeful camera",
    "or framing intention. Carry the eye across every cut through one explicit",
    "anchor: component, position, direction, color field, shape, or semantic idea.",
    "Registry capabilities are a reuse-first vocabulary, not a mandatory quota.",
    "Use only capability ids that appear in the supplied synced index.",
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
    storyboardReference(args.skills.text),
    "",
    "## Response contract",
    "Return only <storyboard_json> containing a JSON array. No Markdown or prose.",
    "Shots must be contiguous, start at 0, total 6-60 seconds, and last 1.5-15 seconds each.",
    "Use this exact shape for every shot:",
    '{"id":"kebab-case","title":"human title","purpose":"viewer change",',
    '"incomingIdea":"idea entering this shot","foreground":"specific hero composition",',
    '"background":"specific atmospheric/set layer","cameraIntent":"framing or camera move",',
    '"startSec":0,"durationSec":4,"blueprint":"known blueprint or compose",',
    '"rules":["known rule"],"capabilityIds":["zero or more exact index ids"],',
    '"continuityAnchor":"what the eye tracks across this boundary",',
    '"outgoingCut":"cut mechanism and destination"}.',
  ].filter(Boolean).join("\n");
  let raw: string;
  try {
    raw = await completeWithRetry(provider, prompt, {
      ...args.options,
      // A reasoning storyboard pass on a loaded provider can run long; give it more
      // wall-clock headroom than a plain chat call, and let completeWithRetry absorb
      // a transient stall instead of failing the whole build on the first abort.
      timeoutMs: 180_000,
      maxTokens: STORYBOARD_MAX_TOKENS,
      // A small Flash thinking pass makes the edit/cut graph before Pro spends
      // its larger budget on source. Code emission and repairs remain reasoning-off.
      thinkingMode: provider.id === "openrouter-api" || provider.id === "deepseek-api"
        ? "medium"
        : "none",
      ...(storyboardModel(provider) ? { model: storyboardModel(provider) } : {}),
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
  return parseStoryboardResponse(raw);
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
  let value: unknown;
  try {
    value = JSON.parse(tagged(raw, "patches_json"));
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
  for (const [index, patch] of patches.entries()) {
    if (
      !patch ||
      typeof patch.search !== "string" ||
      typeof patch.replace !== "string" ||
      !patch.search
    ) {
      throw new Error(`patches_json[${index}] must contain non-empty search and string replace`);
    }
    const located = locatePatch(html, patch.search);
    if (located.kind === "missing") {
      throw new Error(`patches_json[${index}].search was not found in scratch HTML`);
    }
    if (located.kind === "ambiguous") {
      throw new Error(`patches_json[${index}].search is not unique in scratch HTML`);
    }
    html = html.slice(0, located.start) + patch.replace + html.slice(located.end);
  }
  return { storyboard: scratch.storyboard, html };
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
}): string {
  if (args.scratch) {
    return [
      "SYSTEM: You are a precise HTML/CSS/GSAP repair engineer.",
      "Repair the supplied scratch composition with the fewest local edits. Preserve its art",
      "direction, copy, timing, scene structure, and all unrelated source exactly.",
      "For deliberate entrance/exit overflow or decorative overlap, add the narrowest matching",
      "data-layout-allow-* annotation to the moving wrapper. Hard clipped_text/text_box_overflow",
      "must be reflowed or resized; never annotate away load-bearing clipped text.",
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
      `Return only <patches_json> containing a JSON array of 1-${MAX_REPAIR_PATCHES} edits.`,
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
    args.compact ? compactSkillText(args.skills.text) : args.skills.text,
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
  // One initial authoring pass plus at most two bounded repairs.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const patchMode = Boolean(scratch);
    const prompt = creationPrompt({ ...args, validationFeedback, scratch, compact });
    process.stderr.write(
      `[author] attempt ${attempt}/3 · prompt ${prompt.length} chars · ` +
      `${compact ? "compact repair" : "full context"} · ` +
      `${repairModel(provider, attempt) ? "repair tier" : "primary tier"} · reasoning off\n`,
    );
    try {
      const repairTier = attempt > 1 ? repairModel(provider, attempt) : undefined;
      const raw = await provider.complete(prompt, {
        ...args.options,
        timeoutMs: 360_000,
        // Code emission does not benefit from DeepSeek's expensive high/xhigh
        // reasoning pass. Keeping it off reserves the whole budget for source.
        maxTokens: patchMode ? REPAIR_MAX_TOKENS : authorMaxTokens(),
        thinkingMode: "none",
        ...(repairTier ? { model: repairTier } : {}),
      });
      process.stderr.write(`[author] attempt ${attempt}/3 response ${raw.length} chars\n`);
      const draft = patchMode
        ? applyCompositionRepair(raw, scratch!)
        : args.lockedStoryboard
          ? {
              storyboard: args.lockedStoryboard,
              html: tagged(raw, "index_html"),
            }
          : parseCompositionResponse(raw);
      const validation = await validateDirectComposition(args.projectDir, draft);
      if (!validation.ok) {
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
      if (validation.frameWarnings.length && attempt < 3) {
        validationFeedback = validation.frameWarnings.slice(0, 12);
        scratch = draft;
        compact = true;
        lastError = new Error(validationFeedback.join("; "));
        continue;
      }
      const browserQa = await inspectDirectComposition(args.projectDir, draft);
      // Warnings receive a repair opportunity, but the final pass may preserve
      // an intentional aesthetic choice. Hard browser/layout errors never pass.
      if (browserQa.strictOk || (attempt === 3 && browserQa.ok)) {
        return { draft, raw, attempts: attempt };
      }
      validationFeedback = [...browserQa.errors, ...browserQa.warnings].slice(0, 20);
      scratch = draft;
      compact = true;
      lastError = new Error(validationFeedback.join("; "));
    } catch (error) {
      const truncated = isOutputTruncation(error);
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
  throw new Error(
    `direct HyperFrames authoring failed after two bounded repairs: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
