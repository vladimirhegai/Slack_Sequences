/**
 * The video lifecycle — the seam between Slack and the Sequences engine.
 *
 *   createVideo()  messy brief  → plan → applied project → thumbnails → MP4
 *   reviseVideo()  NL revision  → commands → re-applied → thumbnails → MP4
 *
 * Mutations route through the Sequences MCP server (mcpClient) when MCP is
 * enabled — the bot acting as a real MCP client — and fall back to the copied
 * in-process glue if the subprocess can't start, so a flaky host never breaks a
 * demo. Thumbnails + render run in-process (deterministic plumbing). Planning is
 * still the brain's job: it selects named building blocks from the catalog; the
 * solver + linter own every motion decision (the 9 laws).
 */
import path from "node:path";
import {
  lintProject,
  planToCommands,
  ProjectStore,
  type Command,
  type EventEntry,
  type Plan,
  type Project,
} from "@sequences/core";
import { PROVIDERS, type ProviderId } from "@sequences/platform/providers";
import {
  buildProject,
  commitProject,
  loadProject,
  readEventSequence,
} from "./engine/projectIo.ts";
import { initializeProject, projectDirFor } from "./engine/projectTemplates.ts";
import { requestPlanWith } from "./engine/planRunner.ts";
import { requestTweak } from "./engine/tweakRunner.ts";
import { generateSceneThumbnails } from "./engine/thumbs.ts";
import { renderProject } from "./engine/render.ts";
import { McpClient } from "./engine/mcpClient.ts";

/* ----------------------------------------------------------- provider choice */

/** Default planning brain: a key-free CLI login, else the Anthropic API. */
export function resolveProvider(explicit?: ProviderId): ProviderId {
  if (explicit) return explicit;
  const env = process.env.SLACK_SEQUENCES_PROVIDER as ProviderId | undefined;
  if (env && PROVIDERS[env]) return env;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic-api";
  return "claude-code-cli";
}

function mcpEnabled(prefer?: boolean): boolean {
  if (prefer !== undefined) return prefer;
  return process.env.SLACK_SEQUENCES_USE_MCP === "1";
}

/* ------------------------------------------------------------------- briefs */

export type Tone = "crisp-saas" | "warm-startup" | "bold-launch";

export interface BriefFields {
  product: string;
  whatShipped: string;
  audience?: string;
  tone?: Tone;
  lengthSec?: number;
  context?: string;
}

const TONE_HINT: Record<Tone, string> = {
  "crisp-saas": "crisp and precise (dev tools / B2B)",
  "warm-startup": "warm and friendly (startup)",
  "bold-launch": "bold and high-energy (launch)",
};

/** Assemble the modal/thread fields into one brief string for the planner. */
export function assembleBrief(fields: BriefFields): string {
  const lines = [
    `Product: ${fields.product}`,
    `What shipped / the launch: ${fields.whatShipped}`,
  ];
  if (fields.audience) lines.push(`Audience: ${fields.audience}`);
  if (fields.tone) {
    lines.push(`Preferred motion profile: ${fields.tone} — a ${TONE_HINT[fields.tone]} feel.`);
  }
  if (fields.lengthSec) lines.push(`Target length: about ${fields.lengthSec} seconds.`);
  if (fields.context) lines.push(`Extra context: ${fields.context}`);
  lines.push(
    "Build a launch reel: a hook, the product/feature in action, the metric that matters, optional proof, and a CTA close.",
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ outputs */

export interface VideoResult {
  projectDir: string;
  outline: string;
  lint: string;
  thumbnailPaths: string[];
  mp4Path?: string;
  usedMcp: boolean;
  /** True when the plan came from a curated preset rather than a planning brain. */
  usedPreset: boolean;
  provider: ProviderId;
}

function outlineText(project: Project): string {
  return project.scenes
    .map(
      (scene, i) =>
        `${i + 1}. ${scene.archetype}${scene.layout ? `/${scene.layout}` : ""} · ${Math.round(
          scene.durationFrames / project.meta.fps,
        )}s${scene.camera ? ` · camera:${scene.camera.move}` : ""}`,
    )
    .join("\n");
}

function lintText(project: Project): string {
  const findings = lintProject(project);
  if (findings.length === 0) return "lint: clean";
  return findings
    .map((f) => `${f.severity} [${f.rule}] ${[f.sceneId, f.layerId].filter(Boolean).join("/")}: ${f.message}`)
    .join("\n");
}

/* ------------------------------------------------------- apply (MCP / local) */

async function applyViaMcp(
  dir: string,
  tool: "submit_plan" | "apply_commands",
  args: Record<string, unknown>,
): Promise<void> {
  const client = await McpClient.connect(dir);
  try {
    await client.callTool(tool, args);
  } finally {
    client.close();
  }
}

function applyInProcess(dir: string, command: Command): void {
  const project = loadProject(dir);
  const events: EventEntry[] = [];
  const store = new ProjectStore(project, (entry) => events.push(entry), readEventSequence(dir));
  const outcome = store.apply(command, "agent");
  if (!outcome.ok) {
    throw new Error(outcome.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
  }
  commitProject(dir, store.project, events);
  buildProject(dir, store.project);
}

/**
 * Apply a mutation, preferring MCP and falling back to in-process. `command` is
 * the typed command for the local path; `mcp` describes the equivalent tool call.
 */
async function applyMutation(
  dir: string,
  command: Command,
  mcp: { tool: "submit_plan" | "apply_commands"; args: Record<string, unknown> },
  preferMcp: boolean,
): Promise<boolean> {
  if (mcpEnabled(preferMcp)) {
    try {
      await applyViaMcp(dir, mcp.tool, mcp.args);
      return true;
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP path failed, falling back in-process: ${String(error)}\n`);
    }
  }
  applyInProcess(dir, command);
  return false;
}

/* --------------------------------------------------------------- previews */

async function buildPreviews(
  dir: string,
  options: { render: boolean },
): Promise<{ thumbnailPaths: string[]; mp4Path?: string }> {
  const project = loadProject(dir);
  const thumbs = await generateSceneThumbnails(dir, project);
  const thumbnailPaths = Object.values(thumbs.files).map((file) => path.join(dir, "build", file));
  if (!options.render) return { thumbnailPaths };
  try {
    const result = await renderProject(dir, project, { quality: "draft", quiet: true });
    return { thumbnailPaths, mp4Path: result.outputPath };
  } catch (error) {
    // MP4 needs FFmpeg + Chrome; degrade to thumbnails-only rather than fail the
    // whole job (the two-tier preview the plan calls for).
    process.stderr.write(`[orchestrator] render skipped: ${String(error)}\n`);
    return { thumbnailPaths };
  }
}

/* ----------------------------------------------------------------- create */

export interface CreateVideoOptions extends BriefFields {
  jobId: string;
  brandName?: string;
  provider?: ProviderId;
  render?: boolean;
  preferMcp?: boolean;
  /**
   * Skip the planning brain and apply this plan directly. A function receives the
   * freshly-initialized project so it can reference seeded asset ids. This is the
   * deterministic `/sequences demo` path — instant, key-free, and known-good.
   */
  presetPlan?: Plan | ((project: Project) => Plan);
}

export async function createVideo(options: CreateVideoOptions): Promise<VideoResult> {
  const providerId = resolveProvider(options.provider);

  const dir = projectDirFor(options.jobId);
  initializeProject(dir, {
    name: options.product,
    brandName: options.brandName ?? options.product,
    seedScreenshot: true,
  });

  const project = loadProject(dir);
  const usedPreset = options.presetPlan !== undefined;
  let plan: Plan;
  if (options.presetPlan !== undefined) {
    plan = typeof options.presetPlan === "function" ? options.presetPlan(project) : options.presetPlan;
  } else {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`unknown provider "${providerId}"`);
    const brief = assembleBrief(options);
    ({ plan } = await requestPlanWith(provider, brief, project));
  }

  const usedMcp = await applyMutation(
    dir,
    planToCommands(project, plan),
    { tool: "submit_plan", args: { plan: plan as unknown as Record<string, unknown> } },
    options.preferMcp ?? false,
  );

  const previews = await buildPreviews(dir, { render: options.render ?? true });
  const applied = loadProject(dir);
  return {
    projectDir: dir,
    outline: outlineText(applied),
    lint: lintText(applied),
    usedMcp,
    usedPreset,
    provider: providerId,
    ...previews,
  };
}

/* ----------------------------------------------------------------- revise */

export interface ReviseVideoOptions {
  projectDir: string;
  instruction: string;
  provider?: ProviderId;
  render?: boolean;
  preferMcp?: boolean;
}

export async function reviseVideo(options: ReviseVideoOptions): Promise<VideoResult & { mode: string }> {
  const dir = options.projectDir;
  const providerId = resolveProvider(options.provider);
  const project = loadProject(dir);

  // Zero-token matcher resolves common edits ("shorter", "warmer") with no model
  // call; otherwise the provider translates the instruction into commands.
  const tweak = await requestTweak(providerId, options.instruction, project);
  const command: Command =
    tweak.commands.length === 1 ? tweak.commands[0]! : { type: "Batch", commands: tweak.commands };

  const usedMcp = await applyMutation(
    dir,
    command,
    { tool: "apply_commands", args: { commands: tweak.commands as unknown as Record<string, unknown>[] } },
    options.preferMcp ?? false,
  );

  const previews = await buildPreviews(dir, { render: options.render ?? true });
  const applied = loadProject(dir);
  return {
    projectDir: dir,
    outline: outlineText(applied),
    lint: lintText(applied),
    usedMcp,
    usedPreset: false,
    provider: providerId,
    mode: tweak.mode,
    ...previews,
  };
}
