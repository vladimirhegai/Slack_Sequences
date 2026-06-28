/**
 * The plan layer (T4) — the contract between any planning brain (Anthropic
 * API, OpenAI API, a local Codex/Claude Code CLI session, or a human typing
 * JSON) and the deterministic core.
 *
 * A Plan is a beat sheet: profile + ordered scenes with archetype/slots. It
 * deliberately contains NO motion decisions — deterministic fill (the profile
 * selection table + solver) makes those. Quality enforcement is identical no
 * matter which brain plans, because the schema + validator + fill do the work.
 *
 * `planToCommands` converts a validated plan into one atomic Batch through
 * the ONE mutation pathway, so an agent plan is logged, undoable, and
 * revertible exactly like a UI edit.
 */
import { z } from "zod";
import { CameraSchema, SlotValueSchema, type Project } from "./schema.ts";
import {
  ARCHETYPES,
  CAMERA_MOVES,
  enabledExtensionIds,
  PROFILES,
  promptCatalog,
} from "./registry/index.ts";
import type { Command } from "./commands.ts";
import { scaleFrames30 } from "./tokens.ts";

export interface PlanningContextOptions {
  /** Override the project's enabled extension set. Mostly useful for tests. */
  enabledExtensionIds?: Iterable<string> | null;
}

export interface ParsePlanOptions {
  /** Optional project whose enabled extension list gates agent-selected ids. */
  project?: Project;
  /** Override the project's enabled extension set. Mostly useful for tests. */
  enabledExtensionIds?: Iterable<string> | null;
}

/**
 * Versioned Phase-1 system instruction for every planning brain. Keep this
 * close to PlanSchema: the model should choose from Sequences' lattice, not
 * invent motion syntax the current compiler cannot express.
 */
export const SEQUENCES_AGENT_SYSTEM_PROMPT = [
  "## Sequences agent system prompt (Phase 1)",
  "",
  "You are the Sequences SaaS product motion planner.",
  "Your job is to translate human intent into a compact JSON beat sheet that Sequences can compile.",
  "Sequences handles motion quality deterministically through motion profiles, archetypes, tokens, primitives, a choreography solver, and a linter.",
  "",
  "### Hard contract",
  "- Output only the requested JSON plan. Do not output prose, markdown, HTML, CSS, GSAP, JavaScript, keyframes, timeline code, or raw cubic-bezier values.",
  "- Select catalog ids exactly as listed: motionProfile, archetype, layout, assetId, and optional camera.move.",
  "- Fill archetype slots with concise content. Respect required slots, slot value types, max word budgets, and listed asset ids.",
  "- Do not invent off-lattice motion values, manual easing formulas, layer coordinates, 3D parallax, cursor/ripple systems, dynamic blur, match cuts, or custom micro-interactions.",
  "- If the brief asks for unsupported motion, approximate it with the nearest Phase-1 controls: profile choice, archetype order, layout choice, short copy, scene duration, and optional scene camera.",
  "",
  "### Phase-1 motion controls you may use",
  "- motionProfile chooses the overall feel. Use only enabled profile ids from the catalog below.",
  "- archetype and layout choose the scene structure. Prefer feature-reveal or ui-walkthrough when the user wants to show the product.",
  "- durationFrames may tune pacing inside each archetype's range; omit it when the ideal duration is fine.",
  "- camera is optional and scene-level only. Use only enabled camera move ids from the catalog below, on at most two important scenes, never as constant decoration.",
  "- The solver already enforces rank order, deterministic staggers, about 65% entrance overlap, settle gaps, and the one-loud-motion rule. Do not try to schedule these yourself.",
  "",
  "### SaaS motion design judgment",
  "- Build a 3-6 beat arc: hook, product proof, workflow or metric, trust if useful, CTA.",
  "- Keep one idea per scene. Give the rank-1 idea the loudest treatment by choosing the right archetype/profile; let support copy stay quiet.",
  "- Prefer real product media over abstract claims when assets exist. Use listed asset ids directly in media slots.",
  "- Write short, scannable copy. Product videos read at a glance; avoid paragraphs and generic filler.",
  "- Choose the enabled profile whose summary best matches the brand and brief.",
  "- Use the enabled opener and CTA archetypes when available. If they are disabled, build the closest coherent arc from enabled scene types.",
].join("\n");

export const PlanSceneSchema = z.object({
  /** Optional stable id; generated from the archetype when omitted. */
  id: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
    .max(64)
    .optional(),
  archetype: z.string(),
  layout: z.string().optional(),
  /** Defaults to the archetype's ideal duration. */
  durationFrames: z.number().int().min(15).max(1800).optional(),
  slots: z.record(z.string(), SlotValueSchema).default({}),
  camera: CameraSchema.optional(),
});
export type PlanScene = z.infer<typeof PlanSceneSchema>;

export const PlanSchema = z.object({
  motionProfile: z.string(),
  scenes: z.array(PlanSceneSchema).min(1).max(12),
});
export type Plan = z.infer<typeof PlanSchema>;

export class PlanError extends Error {}

export function tightenPlanCopy(plan: Plan): Plan {
  const next = structuredClone(plan);
  for (const scene of next.scenes) {
    const archetype = ARCHETYPES[scene.archetype];
    if (!archetype) continue;
    for (const [slot, spec] of Object.entries(archetype.slots)) {
      const value = scene.slots[slot];
      if (spec.maxWords === undefined) continue;
      if (typeof value === "string") {
        scene.slots[slot] = value.trim().split(/\s+/).slice(0, spec.maxWords).join(" ");
      } else if (Array.isArray(value)) {
        scene.slots[slot] = value.map((item) =>
          item.trim().split(/\s+/).slice(0, spec.maxWords).join(" "),
        );
      }
    }
  }
  return next;
}

function parseEnabledSet(options: ParsePlanOptions): Set<string> | null {
  if (options.enabledExtensionIds !== undefined) {
    return options.enabledExtensionIds === null ? null : new Set(options.enabledExtensionIds);
  }
  return options.project ? enabledExtensionIds(options.project) : null;
}

function enabledIds<T extends Record<string, unknown>>(record: T, enabled: Set<string> | null): string[] {
  return Object.keys(record).filter((id) => enabled === null || enabled.has(id));
}

function idList(ids: string[]): string {
  return ids.length === 0 ? "none enabled" : ids.join(", ");
}

/**
 * Parse + referentially pre-check a plan (clear errors an external agent can
 * self-correct from; the store's validator is the final gate either way).
 */
export function parsePlan(input: unknown, options: ParsePlanOptions = {}): Plan {
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new PlanError(`plan does not match the plan schema — ${issues}`);
  }
  const plan = parsed.data;
  const enabled = parseEnabledSet(options);
  const validProfiles = enabledIds(PROFILES, enabled);
  const validArchetypes = enabledIds(ARCHETYPES, enabled);
  const validCameraMoves = enabledIds(CAMERA_MOVES, enabled);

  if (!PROFILES[plan.motionProfile]) {
    throw new PlanError(
      `unknown motionProfile "${plan.motionProfile}" (valid: ${Object.keys(PROFILES).join(", ")})`,
    );
  }
  if (!validProfiles.includes(plan.motionProfile)) {
    throw new PlanError(
      `motionProfile "${plan.motionProfile}" is disabled for this project (enabled: ${idList(validProfiles)})`,
    );
  }
  for (const [i, scene] of plan.scenes.entries()) {
    const archetype = ARCHETYPES[scene.archetype];
    if (!archetype) {
      throw new PlanError(
        `scenes[${i}]: unknown archetype "${scene.archetype}" (valid: ${Object.keys(ARCHETYPES).join(", ")})`,
      );
    }
    if (!validArchetypes.includes(scene.archetype)) {
      throw new PlanError(
        `scenes[${i}]: archetype "${scene.archetype}" is disabled for this project (enabled: ${idList(validArchetypes)})`,
      );
    }
    if (scene.layout && !archetype.layouts.includes(scene.layout)) {
      throw new PlanError(
        `scenes[${i}]: archetype ${archetype.id} has layouts ${archetype.layouts.join("/")}, not "${scene.layout}"`,
      );
    }
    if (scene.camera && !validCameraMoves.includes(scene.camera.move)) {
      throw new PlanError(
        `scenes[${i}]: camera move "${scene.camera.move}" is disabled for this project (enabled: ${idList(validCameraMoves)})`,
      );
    }
  }
  return plan;
}

/**
 * One atomic Batch that replaces the project's scenes with the plan's beats.
 * Brand, assets, and meta are untouched — planning restyles the story, not
 * the identity. Apply through a ProjectStore so validation gates it.
 */
export function planToCommands(project: Project, plan: Plan): Command {
  const used = new Set<string>();
  const sceneIds = plan.scenes.map((scene) => {
    const base = scene.id ?? scene.archetype.split("-")[0] ?? "scene";
    let id = base;
    let n = 1;
    while (used.has(id)) id = `${base}${++n}`;
    used.add(id);
    return id;
  });

  const commands: Command[] = [{ type: "SetMotionProfile", profile: plan.motionProfile }];
  for (const scene of project.scenes) {
    commands.push({ type: "RemoveScene", sceneId: scene.id });
  }
  plan.scenes.forEach((scene, i) => {
    const archetype = ARCHETYPES[scene.archetype]!;
    commands.push({
      type: "AddScene",
      scene: {
        id: sceneIds[i]!,
        archetype: scene.archetype,
        ...(scene.layout ? { layout: scene.layout } : {}),
        durationFrames:
          scene.durationFrames ?? scaleFrames30(archetype.duration.ideal, project.meta.fps),
        slots: scene.slots,
        choreography: {},
        overrides: {},
        ...(scene.camera ? { camera: scene.camera } : {}),
      },
    });
  });
  return { type: "Batch", commands };
}

/** The context a planning brain needs — same content for every provider. */
export function planningContext(project: Project, options: PlanningContextOptions = {}): string {
  const enabledIds =
    options.enabledExtensionIds === undefined ? enabledExtensionIds(project) : options.enabledExtensionIds;
  const assets =
    project.assets.length === 0
      ? "(none — archetypes needing media are unavailable)"
      : project.assets
          .map((asset) => {
            const metadata = [
              asset.metadata.width && asset.metadata.height
                ? `${asset.metadata.width}x${asset.metadata.height}`
                : "",
              asset.metadata.durationSec !== undefined
                ? `${asset.metadata.durationSec.toFixed(2)}s`
                : "",
              asset.metadata.dominantColors.length
                ? `colors ${asset.metadata.dominantColors.join(",")}`
                : "",
              asset.metadata.ocrText ? `OCR "${asset.metadata.ocrText.slice(0, 160)}"` : "",
              asset.metadata.cacheHint ? `cache ${asset.metadata.cacheHint}` : "",
            ].filter(Boolean);
            return `- ${asset.id} (${asset.kind}): ${asset.path}${metadata.length ? ` [${metadata.join("; ")}]` : ""}`;
          })
          .join("\n");
  const lines = [
    "# Sequences planning context",
    "",
    SEQUENCES_AGENT_SYSTEM_PROMPT,
    "",
    "## Enabled extensions for this project",
    "Only use the extension ids shown in the catalog below. Disabled extensions are not available to you.",
    "",
    promptCatalog({ enabledIds, fps: project.meta.fps }),
    "",
    "## Project",
    `- title: ${project.meta.title}`,
    `- brand: ${project.brand.name}`,
    `- canvas: ${project.meta.width}x${project.meta.height} @ ${project.meta.fps}fps`,
    "## Available assets (the ONLY valid assetId values)",
    assets,
  ];
  return lines.join("\n");
}

/** The full prompt for a one-shot plan call against any text-completion brain. */
export function buildPlanPrompt(brief: string, project: Project): string {
  const enabled = enabledExtensionIds(project);
  const cameraIds = enabledIds(CAMERA_MOVES, enabled);
  const hasHookOpener = enabled.has("hook-opener");
  const hasCta = enabled.has("logo-sting-cta");
  const arcRule =
    hasHookOpener && hasCta
      ? "Rules: 3-6 scenes; open with hook-opener and close with logo-sting-cta;"
      : "Rules: 3-6 scenes; use only enabled archetype ids and build a clear beginning, proof beat, and ending;";
  const cameraRule =
    cameraIds.length > 0
      ? `      "camera": { "move": ${cameraIds.map((id) => `"${id}"`).join("|")}, "scale": "subtle" } (optional, max 2 scenes) }`
      : '      "camera": omit camera because no camera moves are enabled }';
  return [
    planningContext(project),
    "",
    "## Brief",
    brief.trim(),
    "",
    "## Output format",
    "Respond with ONE JSON object and nothing else (no prose, no markdown fences):",
    "{",
    '  "motionProfile": "<profile id>",',
    '  "scenes": [',
    '    { "archetype": "<archetype id>", "layout": "<optional layout id>",',
    '      "durationFrames": <optional int, omit to use the archetype ideal>,',
    '      "slots": { "<slot name>": <string | string[] | {"value":N,"prefix":"","suffix":""} | {"assetId":"<id>"}> },',
    cameraRule,
    "  ]",
    "}",
    arcRule,
    "respect every slot's word budget; required slots must be filled;",
    "media slots may only reference the asset ids listed above.",
  ].join("\n");
}

/** Extract the first balanced top-level JSON object from model/CLI output. */
export function extractJsonObject(text: string): unknown {
  let sawObjectStart = false;
  let lastParseError: unknown;
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    sawObjectStart = true;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch (err) {
            lastParseError = err;
            break;
          }
        }
      }
    }
  }
  if (!sawObjectStart) throw new PlanError("no JSON object found in the response");
  if (lastParseError) {
    throw new PlanError(`response contained malformed JSON: ${String(lastParseError)}`);
  }
  throw new PlanError("no complete JSON object found in the response");
}
