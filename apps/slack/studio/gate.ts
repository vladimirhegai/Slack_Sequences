/**
 * Recipe Studio — the referee.
 *
 * Gating a workspace = staging its (possibly unexported) recipe into a
 * temporary library dir, pointing `SLACK_SEQUENCES_RECIPES_DIR` at it, and
 * running the EXACT production pipeline: scaffold → applyDeterministicSource-
 * Repairs (fragment injection) → validateDirectComposition →
 * commitDirectComposition (static gate + real browser QA + checkpoint) →
 * generateDirectThumbnails. A red gate never overwrites the last committed
 * green composition (commit throws before writing), and the workspace's gate
 * record binds to the fragment hash so post-gate edits re-arm the gate.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  commitDirectComposition,
  generateDirectThumbnails,
  validateDirectComposition,
} from "../src/engine/directComposition.ts";
import {
  loadRecipeLibrary,
  recipeFragmentHash,
  validateRecipeManifest,
} from "../src/engine/recipeContract.ts";
import { buildRecipeDemoDraft } from "./scaffold.ts";
import { compileCanvasFilm } from "./compileCanvas.ts";
import { validateCanvasFilm } from "./canvasModel.ts";
import {
  loadWorkspace,
  saveWorkspace,
  workspaceFragment,
  workspaceProjectDir,
  workspaceRecipeMd,
  type StudioWorkspace,
  type WorkspaceGateResult,
} from "./workspaces.ts";

export interface GateOutcome {
  workspace: StudioWorkspace;
  gate: WorkspaceGateResult;
}

/** Write the workspace recipe into a staging library dir the gate points at. */
export function stageWorkspaceLibrary(workspace: StudioWorkspace): string {
  const stagingRoot = path.join(workspaceProjectDir(workspace.id), ".library-staging");
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  const recipeDir = path.join(stagingRoot, workspace.recipeId);
  fs.mkdirSync(recipeDir, { recursive: true });
  const fragment = workspaceFragment(workspace.id);
  // The staged manifest carries no fragmentHash: the fragment IS the source
  // being proven, so a stale-hash skip here would be self-defeating.
  const { fragmentHash: _omit, ...manifest } = workspace.manifestDraft;
  fs.writeFileSync(path.join(recipeDir, "recipe.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(recipeDir, "fragment.html"), fragment, "utf8");
  fs.writeFileSync(path.join(recipeDir, "recipe.md"), workspaceRecipeMd(workspace.id), "utf8");
  return stagingRoot;
}

/**
 * Run library staging + the full production gate. The env override is scoped
 * to the call (the studio serves requests sequentially) and the library cache
 * is refreshed on both edges so the bot-side default library is never
 * polluted.
 */
/**
 * Gate a canvas workspace: compile the typed `CanvasFilm` deterministically
 * into a composition and run the EXACT production gate (validate → commit +
 * browser QA → thumbnails). No recipe staging — a canvas film is judged as any
 * live `/sequences` create would be. Proves the plan's "click-together valid
 * film" promise (§3.3) with zero tokens.
 */
export async function gateCanvasWorkspace(id: string): Promise<GateOutcome> {
  const workspace = loadWorkspace(id);
  if (workspace.kind !== "canvas" || !workspace.canvas) {
    throw new Error(`workspace "${id}" is not a canvas workspace`);
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  errors.push(...validateCanvasFilm(workspace.canvas).map((error) => `canvas: ${error}`));
  let thumbnails: string[] = [];
  if (!errors.length) {
    const projectDir = workspaceProjectDir(id);
    try {
      const draft = compileCanvasFilm(projectDir, workspace.canvas);
      const validation = await validateDirectComposition(projectDir, draft);
      warnings.push(...validation.warnings);
      if (!validation.ok) {
        errors.push(...validation.errors);
      } else {
        await commitDirectComposition(projectDir, workspace.title, draft);
        const thumbs = await generateDirectThumbnails(projectDir);
        thumbnails = Object.keys(thumbs.files);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const gate: WorkspaceGateResult = {
    ok: errors.length === 0,
    errors,
    warnings,
    gatedAt: new Date().toISOString(),
    fragmentHash: createHash("sha256").update(JSON.stringify(workspace.canvas)).digest("hex"),
    thumbnails,
  };
  workspace.gate = gate;
  saveWorkspace(workspace);
  return { workspace, gate };
}

export async function gateWorkspace(id: string): Promise<GateOutcome> {
  const workspace = loadWorkspace(id);
  if (workspace.kind === "canvas") return gateCanvasWorkspace(id);
  const fragment = workspaceFragment(id);
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifestErrors = validateRecipeManifest(workspace.manifestDraft);
  errors.push(...manifestErrors.map((error) => `recipe.json draft: ${error}`));
  let thumbnails: string[] = [];
  if (!errors.length) {
    const stagingRoot = stageWorkspaceLibrary(workspace);
    const previousOverride = process.env.SLACK_SEQUENCES_RECIPES_DIR;
    process.env.SLACK_SEQUENCES_RECIPES_DIR = stagingRoot;
    try {
      const staged = loadRecipeLibrary({ refresh: true });
      const stagedRecipe = staged.recipes.get(workspace.recipeId);
      if (!stagedRecipe) {
        errors.push(...staged.warnings.map((warning) => `staging: ${warning}`));
        if (!errors.length) errors.push("staging: recipe did not load (unknown reason)");
      } else if (stagedRecipe.stale) {
        errors.push(`staging: recipe is stale — ${stagedRecipe.staleReasons.join(", ")}`);
      } else {
        const projectDir = workspaceProjectDir(id);
        const draft = buildRecipeDemoDraft(projectDir, {
          recipeId: workspace.recipeId,
          params: workspace.params,
          title: workspace.title,
          durationSec: workspace.demoDurationSec,
        });
        const validation = await validateDirectComposition(projectDir, draft);
        warnings.push(...validation.warnings);
        if (!validation.ok) {
          errors.push(...validation.errors);
        } else {
          try {
            await commitDirectComposition(projectDir, workspace.title, draft);
            const thumbs = await generateDirectThumbnails(projectDir);
            thumbnails = Object.keys(thumbs.files);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
    } finally {
      if (previousOverride === undefined) delete process.env.SLACK_SEQUENCES_RECIPES_DIR;
      else process.env.SLACK_SEQUENCES_RECIPES_DIR = previousOverride;
      loadRecipeLibrary({ refresh: true });
    }
  }
  const gate: WorkspaceGateResult = {
    ok: errors.length === 0,
    errors,
    warnings,
    gatedAt: new Date().toISOString(),
    fragmentHash: recipeFragmentHash(fragment),
    thumbnails,
  };
  workspace.gate = gate;
  saveWorkspace(workspace);
  return { workspace, gate };
}
