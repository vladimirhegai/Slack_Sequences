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

function isOutputTruncation(error: unknown): boolean {
  return error instanceof ProviderOutputTruncatedError ||
    (error instanceof Error && /truncat|output-token limit|finish_reason.?length/i.test(error.message));
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
      startSec,
      durationSec,
      ...(typeof scene.blueprint === "string" ? { blueprint: scene.blueprint } : {}),
      ...(Array.isArray(scene.rules)
        ? { rules: scene.rules.filter((rule): rule is string => typeof rule === "string") }
        : {}),
      ...(typeof scene.outgoingCut === "string" ? { outgoingCut: scene.outgoingCut } : {}),
    };
  });
}

export function parseCompositionResponse(raw: string): DirectCompositionDraft {
  return {
    storyboard: parseStoryboard(tagged(raw, "storyboard_json")),
    html: tagged(raw, "index_html"),
  };
}

interface CompositionPatch {
  search: string;
  replace: string;
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
    const first = html.indexOf(patch.search);
    if (first < 0) throw new Error(`patches_json[${index}].search was not found in scratch HTML`);
    if (html.indexOf(patch.search, first + patch.search.length) >= 0) {
      throw new Error(`patches_json[${index}].search is not unique in scratch HTML`);
    }
    html = html.slice(0, first) + patch.replace + html.slice(first + patch.search.length);
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
    current,
    revision,
    feedback,
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
