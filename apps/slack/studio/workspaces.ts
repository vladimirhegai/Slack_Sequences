/**
 * Recipe Studio — workspace store.
 *
 * Workspaces are MUTABLE and live under `apps/slack/.data/studio/<id>/` —
 * never inside `.data/projects/` (job dirs are immutable by design). Each
 * workspace is itself a valid engine project dir (frame-less), so the gate,
 * thumbnails, and previews run against it with zero adapters:
 *
 *   .data/studio/<id>/
 *     workspace.json      # typed state: params, manifest draft, gate result
 *     fragment.html       # THE recipe unit being authored (operator/agent edits)
 *     recipe.md           # retrieval knowledge draft
 *     composition/        # generated demo composition (gate target)
 *     revisions/          # checkpoint per accepted change
 *     build/thumbs/       # gate-produced preview strip
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import {
  loadRecipeLibrary,
  recipeFragmentHash,
  validateRecipeManifest,
  type RecipeManifest,
} from "../src/engine/recipeContract.ts";
import {
  starterCanvasFilm,
  validateCanvasFilm,
  type CanvasFilm,
} from "./canvasModel.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STUDIO_ROOT = path.join(APP_DIR, ".data", "studio");

export interface WorkspaceGateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  gatedAt: string;
  /** Hash of fragment.html at gate time — editing after a green gate re-arms it. */
  fragmentHash: string;
  thumbnails: string[];
}

export interface StudioWorkspace {
  version: 1;
  id: string;
  /**
   * "recipe" (default, backward-compatible) authors a single recipe fragment;
   * "canvas" is the direct-manipulation film builder (plan §4). A canvas
   * workspace ignores the recipe-specific fields below and carries `canvas`.
   */
  kind?: "recipe" | "canvas";
  /** Direct-manipulation canvas state (canvas workspaces only). */
  canvas?: CanvasFilm;
  recipeId: string;
  title: string;
  /** Demo params fed to the gate scaffold (double as the export's suggested defaults). */
  params: Record<string, string | number>;
  demoDurationSec: number;
  /** The recipe.json draft the export wizard finalizes. */
  manifestDraft: RecipeManifest;
  /** Briefs the exported recipe SHOULD match (retrieval sanity check). */
  sanityBriefs: string[];
  gate?: WorkspaceGateResult;
  createdAt: string;
  updatedAt: string;
}

const BLANK_FRAGMENT = `<!-- New recipe fragment.
  Three sections, all host-instantiated (see src/engine/recipeContract.ts):
  - <style data-recipe-style>     injected once into <head>
  - <template data-recipe-markup> injected inside the declared scene ({{param}} slots)
  - <script data-recipe-motion>   runs as (tl, root, start, duration, uid) on the ONE paused timeline
  Determinism is non-negotiable: no clocks, no rAF, no Math.random, no repeat:-1.
-->
<style data-recipe-style>
  .rcp-new { position: relative; display: block; font-size: 96px; font-weight: 800; }
</style>
<template data-recipe-markup>
  <div class="rcp-new" data-part="{{uid}}-hero" data-layout-important data-layout-anchor="frame:center">{{headline}}</div>
</template>
<script data-recipe-motion>
  var sel = '[data-part="' + uid + '-hero"]';
  tl.fromTo(sel, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, start + 0.3);
</script>
`;

function workspaceDir(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  return path.join(STUDIO_ROOT, safe);
}

function workspaceFile(id: string): string {
  return path.join(workspaceDir(id), "workspace.json");
}

export function fragmentFile(id: string): string {
  return path.join(workspaceDir(id), "fragment.html");
}

export function recipeMdFile(id: string): string {
  return path.join(workspaceDir(id), "recipe.md");
}

export function workspaceProjectDir(id: string): string {
  return workspaceDir(id);
}

export function listWorkspaces(): StudioWorkspace[] {
  if (!fs.existsSync(STUDIO_ROOT)) return [];
  return fs.readdirSync(STUDIO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return loadWorkspace(entry.name);
      } catch {
        return undefined;
      }
    })
    .filter((workspace): workspace is StudioWorkspace => Boolean(workspace))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadWorkspace(id: string): StudioWorkspace {
  const file = workspaceFile(id);
  if (!fs.existsSync(file)) throw new Error(`workspace "${id}" does not exist`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as StudioWorkspace;
}

export function workspaceFragment(id: string): string {
  const file = fragmentFile(id);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export function workspaceRecipeMd(id: string): string {
  const file = recipeMdFile(id);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function defaultManifestDraft(recipeId: string): RecipeManifest {
  return {
    format: 2,
    id: recipeId,
    title: recipeId,
    tags: [],
    triggerPatterns: [recipeId.replace(/-/g, "[ -]?")],
    params: [{ name: "headline", kind: "text", maxChars: 60, default: "Hello, recipe" }],
    revision: 1,
  };
}

export function createWorkspace(options: {
  id: string;
  fromRecipe?: string;
  title?: string;
  /** "canvas" seeds a direct-manipulation film; default "recipe". */
  kind?: "recipe" | "canvas";
}): StudioWorkspace {
  const id = options.id.trim();
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error("workspace id must be kebab-case (it becomes the recipe id)");
  }
  const dir = workspaceDir(id);
  if (fs.existsSync(workspaceFile(id))) throw new Error(`workspace "${id}" already exists`);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, "project.json"))) {
    initializeProject(dir, { name: `studio-${id}`, seedScreenshot: false });
  }
  if (options.kind === "canvas") {
    const now = new Date().toISOString();
    const canvasWorkspace: StudioWorkspace = {
      version: 1,
      id,
      kind: "canvas",
      canvas: starterCanvasFilm(),
      recipeId: id,
      title: options.title ?? id,
      params: {},
      demoDurationSec: 6,
      manifestDraft: defaultManifestDraft(id),
      sanityBriefs: [],
      createdAt: now,
      updatedAt: now,
    };
    // Canvas workspaces still keep the fragment/recipe.md files so the store's
    // getters never throw; they are unused until a scene is promoted to a recipe.
    fs.writeFileSync(fragmentFile(id), BLANK_FRAGMENT, "utf8");
    fs.writeFileSync(recipeMdFile(id), `# ${id}\n\nA canvas film built in the studio.\n`, "utf8");
    saveWorkspace(canvasWorkspace);
    return canvasWorkspace;
  }
  let manifestDraft = defaultManifestDraft(id);
  let fragment = BLANK_FRAGMENT;
  let recipeMd = `# ${id}\n\nDescribe what this recipe is and when a planner should declare it.\n`;
  let params: Record<string, string | number> = { headline: "Hello, recipe" };
  if (options.fromRecipe) {
    const source = loadRecipeLibrary({ refresh: true }).recipes.get(options.fromRecipe);
    if (!source) throw new Error(`library recipe "${options.fromRecipe}" not found`);
    manifestDraft = { ...source.manifest, id, revision: source.manifest.revision };
    fragment = fs.readFileSync(path.join(source.dir, "fragment.html"), "utf8");
    recipeMd = source.markdown;
    params = Object.fromEntries(
      source.manifest.params
        .filter((param) => param.default !== undefined)
        .map((param) => [param.name, param.default!] as const),
    );
  }
  const now = new Date().toISOString();
  const workspace: StudioWorkspace = {
    version: 1,
    id,
    recipeId: id,
    title: options.title ?? manifestDraft.title,
    params,
    demoDurationSec: 6,
    manifestDraft,
    sanityBriefs: [],
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(fragmentFile(id), fragment, "utf8");
  fs.writeFileSync(recipeMdFile(id), recipeMd, "utf8");
  saveWorkspace(workspace);
  return workspace;
}

export function saveWorkspace(workspace: StudioWorkspace): void {
  workspace.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    workspaceFile(workspace.id),
    JSON.stringify(workspace, null, 2) + "\n",
    "utf8",
  );
}

/** Checkpoint the mutable sources before an accepted change (undo = replay). */
export function checkpointWorkspace(id: string, label: string): void {
  const dir = workspaceDir(id);
  const revisionsDir = path.join(dir, "revisions");
  fs.mkdirSync(revisionsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(revisionsDir, `${stamp}-${label.replace(/[^a-z0-9-]/gi, "-")}`);
  fs.mkdirSync(target, { recursive: true });
  for (const file of ["workspace.json", "fragment.html", "recipe.md"]) {
    const source = path.join(dir, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, file));
  }
}

export function updateWorkspaceSources(
  id: string,
  updates: {
    fragment?: string;
    recipeMd?: string;
    title?: string;
    params?: Record<string, string | number>;
    demoDurationSec?: number;
    manifestDraft?: RecipeManifest;
    sanityBriefs?: string[];
  },
): StudioWorkspace {
  const workspace = loadWorkspace(id);
  checkpointWorkspace(id, "edit");
  if (updates.manifestDraft) {
    const errors = validateRecipeManifest({ ...updates.manifestDraft, id: workspace.recipeId });
    if (errors.length) throw new Error(`invalid recipe manifest: ${errors.join("; ")}`);
    workspace.manifestDraft = { ...updates.manifestDraft, id: workspace.recipeId };
  }
  if (updates.fragment !== undefined) {
    fs.writeFileSync(fragmentFile(id), updates.fragment, "utf8");
  }
  if (updates.recipeMd !== undefined) {
    fs.writeFileSync(recipeMdFile(id), updates.recipeMd, "utf8");
  }
  if (updates.title !== undefined) workspace.title = updates.title;
  if (updates.params) workspace.params = updates.params;
  if (updates.demoDurationSec) {
    workspace.demoDurationSec = Math.min(20, Math.max(3, updates.demoDurationSec));
  }
  if (updates.sanityBriefs) workspace.sanityBriefs = updates.sanityBriefs.slice(0, 5);
  // Any source edit invalidates a previous green gate.
  const fragment = workspaceFragment(id);
  if (workspace.gate && workspace.gate.fragmentHash !== recipeFragmentHash(fragment)) {
    workspace.gate = { ...workspace.gate, ok: false, warnings: [
      ...workspace.gate.warnings,
      "sources changed after this gate ran — re-generate before exporting",
    ] };
  }
  saveWorkspace(workspace);
  return workspace;
}

/** Replace a canvas workspace's typed canvas state (checkpointing first). */
export function updateWorkspaceCanvas(id: string, canvas: CanvasFilm): StudioWorkspace {
  const workspace = loadWorkspace(id);
  if (workspace.kind !== "canvas") throw new Error(`workspace "${id}" is not a canvas workspace`);
  const errors = validateCanvasFilm(canvas);
  if (errors.length) throw new Error(`invalid canvas: ${errors.join("; ")}`);
  checkpointWorkspace(id, "canvas-edit");
  workspace.canvas = canvas;
  // A canvas edit invalidates a previous green gate.
  if (workspace.gate) {
    workspace.gate = {
      ...workspace.gate,
      ok: false,
      warnings: [...workspace.gate.warnings, "canvas changed after this gate ran — re-generate"],
    };
  }
  saveWorkspace(workspace);
  return workspace;
}

export function workspaceSourceHash(id: string): string {
  return createHash("sha256")
    .update(workspaceFragment(id))
    .update(JSON.stringify(loadWorkspace(id).params))
    .digest("hex");
}
