/**
 * Recipe Studio agents — shared context + AGENT.md + re-gate (plan §6).
 *
 * The context composed here is IDENTICAL across providers (OpenRouter, Claude
 * CLI) so switching mid-conversation is seamless (plan §6.1): the workspace
 * state, the last gate findings, and the authoring contract (determinism
 * rules + catalog vocabulary). AGENT.md is that same contract written to disk
 * so a file-first CLI agent reads it in the workspace.
 */
import fs from "node:fs";
import path from "node:path";
import {
  hasDirectComposition,
  loadDirectComposition,
  validateDirectComposition,
  commitDirectComposition,
  generateDirectThumbnails,
} from "../../src/engine/directComposition.ts";
import { COMPONENT_CATALOG } from "../../src/engine/componentContract.ts";
import {
  loadWorkspace,
  workspaceFragment,
  workspaceProjectDir,
  type StudioWorkspace,
} from "../workspaces.ts";

/** The determinism + contract rules an agent must respect (both providers). */
export const AUTHORING_RULES = [
  "Determinism is non-negotiable: no wall-clock, no requestAnimationFrame-owned",
  "state, no Math.random, no repeat:-1. Every animation is a pure function of",
  "timeline time so the composition is seek-safe (the gate seeks out of order).",
  "The composition has ONE paused GSAP timeline registered on window.__timelines.",
  "Host-owned islands (sequences-camera / -components / -cuts / -interactions /",
  "-time / -fx) and their compile calls are INJECTED by the host — never author,",
  "duplicate, or edit them; edit scene interiors, copy, and entrance tweens only.",
  "Components come from the catalog (data-component + data-part); the kit CSS",
  "owns their structure. Keep the world element free of CSS filters.",
].join(" ");

function canvasSummary(workspace: StudioWorkspace): string {
  const film = workspace.canvas;
  if (!film) return "(no canvas)";
  const lines = film.scenes.map((scene) => {
    const stations = scene.stations
      .map((st) => `${st.region}[${st.components.map((c) => `${c.kind}#${c.id}`).join(", ") || "empty"}]`)
      .join(" · ");
    const cam = scene.camera.length
      ? ` camera: ${scene.camera.map((m) => `${m.move}→${m.toRegion}@${m.startSec}s`).join(", ")}`
      : "";
    return `- ${scene.id} (${scene.durationSec}s): ${stations}${cam}`;
  });
  return lines.join("\n");
}

/** The per-message context, composed identically for every provider. */
export function composeAgentContext(id: string): string {
  const workspace = loadWorkspace(id);
  const briefFile = path.join(workspaceProjectDir(id), "BRIEF.md");
  const brief = fs.existsSync(briefFile) ? fs.readFileSync(briefFile, "utf8").trim() : "";
  const gate = workspace.gate;
  const gateLines = gate
    ? [
        `Last gate: ${gate.ok ? "GREEN" : "RED"} at ${gate.gatedAt}`,
        ...gate.errors.slice(0, 12).map((e) => `  ✗ ${e}`),
        ...gate.warnings.slice(0, 6).map((w) => `  ⚠ ${w}`),
      ].join("\n")
    : "Not gated yet.";
  const state =
    workspace.kind === "canvas"
      ? `Canvas film "${workspace.title}":\n${canvasSummary(workspace)}`
      : `Recipe fragment "${workspace.recipeId}" (${workspaceFragment(id).length} bytes).`;
  return [
    brief ? `## Brief\n${brief}\n` : "",
    `## Workspace state\n${state}\n`,
    `## Latest referee (the deterministic gate)\n${gateLines}\n`,
    `## Authoring rules\n${AUTHORING_RULES}`,
  ].filter(Boolean).join("\n");
}

/** Write AGENT.md into the workspace so a file-first CLI agent reads it. */
export function writeAgentMd(id: string): string {
  const workspace = loadWorkspace(id);
  const projectDir = workspaceProjectDir(id);
  const target =
    workspace.kind === "canvas"
      ? "composition/index.html (the gated film — edit scene interiors only)"
      : "fragment.html (the recipe unit — three host-instantiated sections)";
  const kinds = COMPONENT_CATALOG.map((s) => s.kind).join(", ");
  const md = [
    `# AGENT.md — Recipe Studio workspace "${id}"`,
    "",
    "You are authoring inside a Recipe Studio workspace. The studio is your",
    "REFEREE: every time you save, it re-runs the real production gate",
    "(static validation + real browser QA + thumbnails) and posts the findings",
    "back to the chat. Your job is to make the gate green AND the film look good.",
    "",
    `## What to edit\n${target}`,
    "",
    "## Hard rules (the gate enforces these)",
    AUTHORING_RULES,
    "",
    `## Component catalog kinds\n${kinds}`,
    "",
    "## The loop",
    "1. Read the current file and the gate findings below.",
    "2. Make ONE focused change (a scene interior, copy, an entrance tween).",
    "3. Save. The studio re-gates and appends findings here. Iterate.",
    "",
    "## Current context",
    composeAgentContext(id),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(projectDir, "AGENT.md"), md, "utf8");
  return md;
}

export interface RegateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  thumbnails: number;
}

/**
 * Re-gate whatever composition is on disk (an agent may have hand-edited
 * composition/index.html). Validate → commit + browser QA → thumbnails, the
 * exact production referee — no laxer studio-only path (invariant #4).
 */
export async function regateComposition(id: string): Promise<RegateResult> {
  const projectDir = workspaceProjectDir(id);
  if (!hasDirectComposition(projectDir)) {
    return { ok: false, errors: ["no composition on disk — generate first"], warnings: [], thumbnails: 0 };
  }
  const current = loadDirectComposition(projectDir);
  const draft = { html: current.html, storyboard: current.manifest.scenes };
  const validation = await validateDirectComposition(projectDir, draft);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings, thumbnails: 0 };
  }
  await commitDirectComposition(projectDir, current.manifest.title, draft);
  const thumbs = await generateDirectThumbnails(projectDir);
  return { ok: true, errors: [], warnings: validation.warnings, thumbnails: Object.keys(thumbs.files).length };
}
