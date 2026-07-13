/**
 * Recipe gate — the referee over agent-authored recipe sources.
 *
 * Gating a recipe = parsing its committed source file
 * (`recipes/<id>.recipe.html`), staging it into a temporary library dir,
 * pointing `SLACK_SEQUENCES_RECIPES_DIR` at it, and running the EXACT
 * production pipeline: scaffold demo → applyDeterministicSourceRepairs
 * (fragment injection) → validateDirectComposition → commitDirectComposition
 * (static gate + real browser QA + checkpoint) → generateDirectThumbnails.
 *
 * The work dir `.data/studio/<id>/` is derived and gitignored — the source
 * file is the only thing an agent edits. A red gate never overwrites the last
 * committed green composition (commit throws before writing), and the gate
 * record binds to the fragment hash so post-gate edits re-arm the gate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitDirectComposition,
  generateDirectThumbnails,
  validateDirectComposition,
} from "../src/engine/directComposition.ts";
import { loadRecipeLibrary } from "../src/engine/recipeContract.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { runRecipeGatePublication } from "./gatePublication.ts";
import { buildRecipeDemoDraft } from "./scaffold.ts";
import { loadRecipeSource, type RecipeSource } from "./recipeSource.ts";
import { recipeThumbnailQualityErrors } from "./thumbnailQuality.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STUDIO_ROOT = path.join(APP_DIR, ".data", "studio");

export interface RecipeGateRecord {
  ok: boolean;
  errors: string[];
  warnings: string[];
  gatedAt: string;
  /** Hash of the source fragment at gate time — editing after a green gate re-arms it. */
  fragmentHash: string;
  thumbnails: string[];
}

export interface RecipeGateOutcome {
  source: RecipeSource;
  gate: RecipeGateRecord;
}

/** The derived, mutable work dir for one recipe (gate target + previews). */
export function recipeGateDir(id: string): string {
  return path.join(STUDIO_ROOT, id.replace(/[^a-zA-Z0-9_-]/g, "-"));
}

function gateRecordFile(id: string): string {
  return path.join(recipeGateDir(id), "gate.json");
}

export function loadGateRecord(id: string): RecipeGateRecord | undefined {
  const file = gateRecordFile(id);
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as RecipeGateRecord;
  } catch {
    return undefined;
  }
}

/** Stage the source's recipe into a temp library dir the gate points at. */
function stageSourceLibrary(source: RecipeSource): string {
  const stagingRoot = path.join(recipeGateDir(source.id), ".library-staging");
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  const recipeDir = path.join(stagingRoot, source.id);
  fs.mkdirSync(recipeDir, { recursive: true });
  // The staged manifest carries no fragmentHash/engine fences: the fragment IS
  // the source being proven — a stale-hash skip here would be self-defeating.
  fs.writeFileSync(
    path.join(recipeDir, "recipe.json"),
    JSON.stringify(source.manifest, null, 2),
    "utf8",
  );
  fs.writeFileSync(path.join(recipeDir, "fragment.html"), source.fragment, "utf8");
  fs.writeFileSync(path.join(recipeDir, "recipe.md"), source.doc, "utf8");
  return stagingRoot;
}

/**
 * Run library staging + the full production gate over one recipe source.
 * The env override is scoped to the call (gates run sequentially) and the
 * library cache is refreshed on both edges so the bot-side default library is
 * never polluted.
 */
export async function gateRecipe(id: string): Promise<RecipeGateOutcome> {
  const source = loadRecipeSource(id);
  const projectDir = recipeGateDir(id);
  fs.mkdirSync(projectDir, { recursive: true });
  if (!fs.existsSync(path.join(projectDir, "project.json"))) {
    initializeProject(projectDir, { name: `studio-${id}`, seedScreenshot: false });
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  let thumbnails: string[] = [];
  const stagingRoot = stageSourceLibrary(source);
  const previousOverride = process.env.SLACK_SEQUENCES_RECIPES_DIR;
  process.env.SLACK_SEQUENCES_RECIPES_DIR = stagingRoot;
  try {
    const staged = loadRecipeLibrary({ refresh: true });
    const stagedRecipe = staged.recipes.get(source.id);
    if (!stagedRecipe) {
      errors.push(...staged.warnings.map((warning) => `staging: ${warning}`));
      if (!errors.length) errors.push("staging: recipe did not load (unknown reason)");
    } else if (stagedRecipe.stale) {
      errors.push(`staging: recipe is stale — ${stagedRecipe.staleReasons.join(", ")}`);
    } else {
      const draft = buildRecipeDemoDraft(projectDir, {
        recipeId: source.id,
        params: source.demo.params ?? {},
        title: source.demo.title ?? source.manifest.title,
        durationSec: Math.min(20, Math.max(3, source.demo.durationSec ?? 6)),
      });
      const validation = await validateDirectComposition(projectDir, draft);
      warnings.push(...validation.warnings);
      if (!validation.ok) {
        errors.push(...validation.errors);
      } else {
        try {
          const publication = await runRecipeGatePublication(
            projectDir,
            async () => {
              await commitDirectComposition(projectDir, source.manifest.title, draft);
              return generateDirectThumbnails(projectDir);
            },
            (thumbs) => recipeThumbnailQualityErrors(
              Object.values(thumbs.files).map((file) => path.join(projectDir, "build", file)),
            ),
          );
          errors.push(...publication.errors);
          // A red candidate has been rolled back; do not advertise its capture
          // keys against the restored last-green preview directory.
          thumbnails = publication.errors.length ? [] : Object.keys(publication.value.files);
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
  const gate: RecipeGateRecord = {
    ok: errors.length === 0,
    errors,
    warnings,
    gatedAt: new Date().toISOString(),
    fragmentHash: source.fragmentHash,
    thumbnails,
  };
  fs.writeFileSync(gateRecordFile(id), JSON.stringify(gate, null, 2) + "\n", "utf8");
  return { source, gate };
}
