/**
 * Provider-agnostic direct HyperFrames authoring. The model writes the actual
 * composition source; deterministic validation owns the publication boundary.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProvider, CompleteOptions } from "@sequences/platform/providers";
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

/**
 * Output-token budget for the authoring call. A full composition (storyboard +
 * a complete index.html with rich scenes and GSAP) far exceeds the ~4096-token
 * default that DeepSeek-style chat models apply when none is requested — without
 * this the response truncates mid-document and the tag parse fails. Override with
 * SEQUENCES_MAX_OUTPUT_TOKENS if the model supports (and a composition needs) more.
 */
function authorMaxTokens(): number {
  const parsed = Number(process.env.SEQUENCES_MAX_OUTPUT_TOKENS);
  return Number.isFinite(parsed) && parsed >= 4096 ? Math.floor(parsed) : 16_384;
}

function tagged(raw: string, name: string): string {
  const match = raw.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i"));
  if (!match?.[1]) {
    const hasOpen = new RegExp(`<${name}>`, "i").test(raw);
    const hasClose = new RegExp(`</${name}>`, "i").test(raw);
    if (hasOpen && !hasClose) {
      throw new Error(
        `author response truncated: <${name}> opened but never closed — the model likely hit its ` +
          `output token limit. Raise SEQUENCES_MAX_OUTPUT_TOKENS or request a more compact composition.`,
      );
    }
    throw new Error(`author response is missing <${name}>`);
  }
  return match[1].trim().replace(/^```(?:html|json)?\s*/i, "").replace(/\s*```$/, "");
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
}): string {
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
    args.skills.text,
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
  let lastError: unknown;
  // One initial authoring pass plus at most two bounded repairs.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const prompt = creationPrompt({ ...args, validationFeedback });
    const raw = await provider.complete(prompt, {
      timeoutMs: 360_000,
      // Enough room for a complete composition; bounded reasoning keeps a
      // "-pro" reasoning model from spending minutes thinking before it answers.
      maxTokens: authorMaxTokens(),
      thinkingMode: "medium",
      ...args.options,
    });
    try {
      const draft = parseCompositionResponse(raw);
      const validation = await validateDirectComposition(args.projectDir, draft);
      if (!validation.ok) {
        validationFeedback = validation.errors.slice(0, 20);
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
      lastError = new Error(validationFeedback.join("; "));
    } catch (error) {
      validationFeedback = [error instanceof Error ? error.message : String(error)];
      lastError = error;
    }
  }
  throw new Error(
    `direct HyperFrames authoring failed after two bounded repairs: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
