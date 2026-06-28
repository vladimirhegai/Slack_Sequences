/**
 * The video lifecycle — the seam between Slack and the Sequences engine.
 *
 *   createVideo()  messy brief  → plan → applied project → thumbnails → MP4
 *   reviseVideo()  NL revision  → commands → re-applied → thumbnails → MP4
 *
 * Live work routes through the Sequences MCP server (mcpClient) by default —
 * the bot acting as a real MCP client — and falls back to the copied in-process
 * glue if the subprocess can't start. Planning is still the brain's job: it
 * selects named building blocks from the catalog; the solver + linter own every
 * motion decision (the 9 laws).
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
import { retrieveHyperframesSkillContext } from "./agent/skillContext.ts";

/* ----------------------------------------------------------- provider choice */

/** Default planning brain: a key-free CLI login, else the Anthropic API. */
export function resolveProvider(explicit?: ProviderId): ProviderId {
  if (explicit) return explicit;
  const env = process.env.SLACK_SEQUENCES_PROVIDER as ProviderId | undefined;
  if (env && PROVIDERS[env]) return env;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic-api";
  return "claude-code-cli";
}

/** MCP is opt-out: set SLACK_SEQUENCES_USE_MCP=0 only for local diagnosis. */
export function mcpEnabled(prefer?: boolean): boolean {
  if (prefer !== undefined) return prefer;
  return process.env.SLACK_SEQUENCES_USE_MCP !== "0";
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
  /** Whether this lifecycle requested MCP (as opposed to an explicit local run). */
  mcpRequested: boolean;
  /** Safe, argument-free evidence of the tools actually called. */
  toolCalls: ToolCallReceipt[];
  /** HyperFrames skills retrieved into the planning/revision prompt. */
  skillsUsed: string[];
  /** True when the plan came from a curated preset rather than a planning brain. */
  usedPreset: boolean;
  provider: ProviderId;
}

export type McpToolName = "submit_plan" | "apply_commands" | "render_preview" | "render" | "undo";
export type ToolCallStatus = "succeeded" | "fallback" | "failed";

export interface ToolCallReceipt {
  tool: McpToolName;
  status: ToolCallStatus;
  durationMs: number;
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
  tool: McpToolName,
  args: Record<string, unknown>,
): Promise<string> {
  const client = await McpClient.connect(dir);
  try {
    return await client.callTool(tool, args);
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

/** In-process undo (the fallback for the MCP `undo` tool). Returns whether the
 * journal actually moved — "nothing to undo" is a no-op, not an error. */
function undoInProcess(dir: string): boolean {
  const project = loadProject(dir);
  const events: EventEntry[] = [];
  const store = new ProjectStore(project, (entry) => events.push(entry), readEventSequence(dir));
  const moved = store.undo("agent");
  if (moved) {
    commitProject(dir, store.project, events);
    buildProject(dir, store.project);
  }
  return moved;
}

/**
 * Apply a mutation, preferring MCP and falling back to in-process. `command` is
 * the typed command for the local path; `mcp` describes the equivalent tool call.
 */
async function applyMutation(
  dir: string,
  command: Command,
  mcp: { tool: "submit_plan" | "apply_commands"; args: Record<string, unknown> },
  preferMcp?: boolean,
): Promise<{ usedMcp: boolean; receipt?: ToolCallReceipt }> {
  if (mcpEnabled(preferMcp)) {
    const started = performance.now();
    try {
      await applyViaMcp(dir, mcp.tool, mcp.args);
      return {
        usedMcp: true,
        receipt: {
          tool: mcp.tool,
          status: "succeeded",
          durationMs: Math.round(performance.now() - started),
        },
      };
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP path failed, falling back in-process: ${String(error)}\n`);
      applyInProcess(dir, command);
      return {
        usedMcp: false,
        receipt: {
          tool: mcp.tool,
          status: "fallback",
          durationMs: Math.round(performance.now() - started),
        },
      };
    }
  }
  applyInProcess(dir, command);
  return { usedMcp: false };
}

/* --------------------------------------------------------------- previews */

/**
 * Tier 2 of two-tier delivery: render the draft MP4 for an already-applied
 * project directory. Returns `{}` (no `mp4Path`) instead of throwing when the
 * render host is unavailable (FFmpeg/Chrome missing or a render failure), so the
 * thumbnails-only tier-1 result still stands. Deterministic plumbing: same
 * applied project in, same frames out — no model. MCP is only the transport.
 */
export async function renderVideo(
  dir: string,
  options: { preferMcp?: boolean } = {},
): Promise<{ mp4Path?: string; toolCalls: ToolCallReceipt[]; usedMcp: boolean }> {
  if (mcpEnabled(options.preferMcp)) {
    const started = performance.now();
    try {
      const text = await applyViaMcp(dir, "render", { quality: "draft" });
      const payload = JSON.parse(text) as { outputPath?: unknown };
      if (typeof payload.outputPath !== "string" || !payload.outputPath) {
        throw new Error("render tool returned no outputPath");
      }
      return {
        mp4Path: payload.outputPath,
        usedMcp: true,
        toolCalls: [{
          tool: "render",
          status: "succeeded",
          durationMs: Math.round(performance.now() - started),
        }],
      };
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP render failed, falling back in-process: ${String(error)}\n`);
      const project = loadProject(dir);
      try {
        const result = await renderProject(dir, project, { quality: "draft", quiet: true });
        return {
          mp4Path: result.outputPath,
          usedMcp: false,
          toolCalls: [{
            tool: "render",
            status: "fallback",
            durationMs: Math.round(performance.now() - started),
          }],
        };
      } catch (fallbackError) {
        process.stderr.write(`[orchestrator] render skipped: ${String(fallbackError)}\n`);
        return {
          usedMcp: false,
          toolCalls: [{
            tool: "render",
            status: "failed",
            durationMs: Math.round(performance.now() - started),
          }],
        };
      }
    }
  }

  const project = loadProject(dir);
  try {
    const result = await renderProject(dir, project, { quality: "draft", quiet: true });
    return { mp4Path: result.outputPath, toolCalls: [], usedMcp: false };
  } catch (error) {
    process.stderr.write(`[orchestrator] render skipped: ${String(error)}\n`);
    return { toolCalls: [], usedMcp: false };
  }
}

async function buildPreviews(
  dir: string,
  options: { render: boolean; preferMcp?: boolean },
): Promise<{
  thumbnailPaths: string[];
  mp4Path?: string;
  toolCalls: ToolCallReceipt[];
  usedMcp: boolean;
}> {
  const project = loadProject(dir);
  let thumbnailPaths: string[];
  let usedMcp = false;
  const toolCalls: ToolCallReceipt[] = [];

  if (mcpEnabled(options.preferMcp)) {
    const started = performance.now();
    try {
      const text = await applyViaMcp(dir, "render_preview", {});
      const payload = JSON.parse(text) as { files?: unknown };
      if (!Array.isArray(payload.files) || !payload.files.every((file) => typeof file === "string")) {
        throw new Error("render_preview tool returned invalid files");
      }
      thumbnailPaths = payload.files.map((file) => path.join(dir, "build", file));
      usedMcp = true;
      toolCalls.push({
        tool: "render_preview",
        status: "succeeded",
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP preview failed, falling back in-process: ${String(error)}\n`);
      const thumbs = await generateSceneThumbnails(dir, project);
      thumbnailPaths = Object.values(thumbs.files).map((file) => path.join(dir, "build", file));
      toolCalls.push({
        tool: "render_preview",
        status: "fallback",
        durationMs: Math.round(performance.now() - started),
      });
    }
  } else {
    const thumbs = await generateSceneThumbnails(dir, project);
    thumbnailPaths = Object.values(thumbs.files).map((file) => path.join(dir, "build", file));
  }

  if (!options.render) return { thumbnailPaths, toolCalls, usedMcp };
  // MP4 needs FFmpeg + Chrome; renderVideo degrades to thumbnails-only on failure.
  const rendered = await renderVideo(dir, { preferMcp: options.preferMcp });
  return {
    thumbnailPaths,
    mp4Path: rendered.mp4Path,
    toolCalls: [...toolCalls, ...rendered.toolCalls],
    usedMcp: usedMcp || rendered.usedMcp,
  };
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
  let skillsUsed: string[] = [];
  let plan: Plan;
  if (options.presetPlan !== undefined) {
    plan = typeof options.presetPlan === "function" ? options.presetPlan(project) : options.presetPlan;
  } else {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`unknown provider "${providerId}"`);
    const brief = assembleBrief(options);
    const skills = retrieveHyperframesSkillContext("create", brief);
    skillsUsed = skills.skillNames;
    ({ plan } = await requestPlanWith(provider, brief, project, {}, skills.text));
  }

  const mutation = await applyMutation(
    dir,
    planToCommands(project, plan),
    { tool: "submit_plan", args: { plan: plan as unknown as Record<string, unknown> } },
    options.preferMcp,
  );

  const previews = await buildPreviews(dir, {
    render: options.render ?? true,
    preferMcp: options.preferMcp,
  });
  const applied = loadProject(dir);
  return {
    ...previews,
    projectDir: dir,
    outline: outlineText(applied),
    lint: lintText(applied),
    usedMcp: mutation.usedMcp || previews.usedMcp,
    mcpRequested: mcpEnabled(options.preferMcp),
    toolCalls: [...(mutation.receipt ? [mutation.receipt] : []), ...previews.toolCalls],
    skillsUsed,
    usedPreset,
    provider: providerId,
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
  const skills = retrieveHyperframesSkillContext("revise", options.instruction);
  const tweak = await requestTweak(providerId, options.instruction, project, {}, {}, skills.text);
  const command: Command =
    tweak.commands.length === 1 ? tweak.commands[0]! : { type: "Batch", commands: tweak.commands };

  const mutation = await applyMutation(
    dir,
    command,
    { tool: "apply_commands", args: { commands: tweak.commands as unknown as Record<string, unknown>[] } },
    options.preferMcp,
  );

  const previews = await buildPreviews(dir, {
    render: options.render ?? true,
    preferMcp: options.preferMcp,
  });
  const applied = loadProject(dir);
  return {
    ...previews,
    projectDir: dir,
    outline: outlineText(applied),
    lint: lintText(applied),
    usedMcp: mutation.usedMcp || previews.usedMcp,
    mcpRequested: mcpEnabled(options.preferMcp),
    toolCalls: [...(mutation.receipt ? [mutation.receipt] : []), ...previews.toolCalls],
    skillsUsed: skills.skillNames,
    usedPreset: false,
    provider: providerId,
    mode: tweak.mode,
  };
}

/* ------------------------------------------------------------------- undo */

/**
 * Revert the most recent change (journaled, source "agent" — law 1), preferring
 * the MCP `undo` tool and falling back to the in-process store. Re-runs previews
 * so the caller can re-deliver the reverted storyboard through the same two-tier
 * path. Deterministic: undo replays the journal, the model is never consulted.
 */
export async function undoVideo(
  dir: string,
  options: { render?: boolean; preferMcp?: boolean } = {},
): Promise<VideoResult> {
  const providerId = resolveProvider();
  const toolCalls: ToolCallReceipt[] = [];
  let usedMcp = false;

  if (mcpEnabled(options.preferMcp)) {
    const started = performance.now();
    try {
      await applyViaMcp(dir, "undo", {});
      usedMcp = true;
      toolCalls.push({ tool: "undo", status: "succeeded", durationMs: Math.round(performance.now() - started) });
    } catch (error) {
      process.stderr.write(`[orchestrator] MCP undo failed, falling back in-process: ${String(error)}\n`);
      undoInProcess(dir);
      toolCalls.push({ tool: "undo", status: "fallback", durationMs: Math.round(performance.now() - started) });
    }
  } else {
    undoInProcess(dir);
  }

  const previews = await buildPreviews(dir, {
    render: options.render ?? false,
    preferMcp: options.preferMcp,
  });
  const applied = loadProject(dir);
  return {
    ...previews,
    projectDir: dir,
    outline: outlineText(applied),
    lint: lintText(applied),
    usedMcp: usedMcp || previews.usedMcp,
    mcpRequested: mcpEnabled(options.preferMcp),
    toolCalls: [...toolCalls, ...previews.toolCalls],
    skillsUsed: [],
    usedPreset: false,
    provider: providerId,
  };
}
