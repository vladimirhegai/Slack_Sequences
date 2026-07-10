/**
 * RecipeV2 export — from an agent-authored source to the live library.
 *
 * "Export" turns a GREEN-gated recipe source into the library recipe the live
 * agents retrieve and instantiate:
 *   1. hard-require a green gate whose fragmentHash still matches the source
 *      fragment (edit-after-gate re-arms the gate);
 *   2. write `skills/sequences-recipes/<id>/` — recipe.json (source manifest +
 *      CURRENT engine fences + content-addressed fragmentHash + revision
 *      bump), recipe.md (the source's doc block), fragment.html, demo.html
 *      (the gated composition), preview/ (the gate's thumbnail strip);
 *   3. refresh the library and run the retrieval sanity check: the recipe
 *      must score on the source's should-match briefs and stay silent on two
 *      canned negatives — a recipe that matches everything (or nothing) gets
 *      its triggerPatterns fixed NOW, not discovered broken in production.
 *
 * The EXPORT FORMAT IS UNCHANGED from the operator-era studio — retrieval,
 * Level-1 instantiation, and version fencing in `recipeContract.ts` are
 * untouched consumers.
 */
import fs from "node:fs";
import path from "node:path";
import {
  currentEngineFences,
  defaultRecipesRootDir,
  loadRecipeLibrary,
  recipeRetrievalScore,
  type RecipeManifest,
} from "../src/engine/recipeContract.ts";
import { loadGateRecord, recipeGateDir } from "./gate.ts";
import { loadRecipeSource } from "./recipeSource.ts";

/** Briefs an exported recipe must NOT match (over-matching detector). */
const NEGATIVE_BRIEFS = [
  "A calm dashboard walkthrough: open the analytics table, filter a row, and export a CSV report.",
  "An onboarding tour of the settings page with a cursor clicking through three toggles.",
];

export interface RecipeExportResult {
  dir: string;
  manifest: RecipeManifest;
  retrievalSanity: {
    shouldMatch: Array<{ brief: string; score: number; ok: boolean }>;
    shouldNotMatch: Array<{ brief: string; score: number; ok: boolean }>;
    ok: boolean;
  };
  libraryWarnings: string[];
}

export function exportRecipe(id: string): RecipeExportResult {
  const source = loadRecipeSource(id);
  const gate = loadGateRecord(id);
  if (!gate?.ok) {
    throw new Error(`export requires a green gate — run \`npm run recipes -- gate ${id}\` first`);
  }
  if (gate.fragmentHash !== source.fragmentHash) {
    throw new Error(`source changed after the last green gate — re-gate ${id} first`);
  }
  const projectDir = recipeGateDir(id);
  const demoFile = path.join(projectDir, "composition", "index.html");
  if (!fs.existsSync(demoFile)) {
    throw new Error("no committed demo composition found — re-gate first");
  }

  const targetDir = path.join(defaultRecipesRootDir(), source.id);
  const existing = loadRecipeLibrary({ refresh: true }).recipes.get(source.id);
  const manifest: RecipeManifest = {
    ...source.manifest,
    engine: currentEngineFences(),
    fragmentHash: source.fragmentHash,
    revision: existing ? existing.manifest.revision + 1 : source.manifest.revision,
  };

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "recipe.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(targetDir, "fragment.html"), source.fragment, "utf8");
  fs.writeFileSync(path.join(targetDir, "recipe.md"), source.doc, "utf8");
  fs.copyFileSync(demoFile, path.join(targetDir, "demo.html"));
  const previewDir = path.join(targetDir, "preview");
  fs.rmSync(previewDir, { recursive: true, force: true });
  fs.mkdirSync(previewDir, { recursive: true });
  const thumbsDir = path.join(projectDir, "build", "thumbs");
  if (fs.existsSync(thumbsDir)) {
    for (const file of fs.readdirSync(thumbsDir).filter((name) => name.endsWith(".png"))) {
      fs.copyFileSync(path.join(thumbsDir, file), path.join(previewDir, file));
    }
  }

  const library = loadRecipeLibrary({ refresh: true });
  const exported = library.recipes.get(source.id);
  if (!exported || exported.stale) {
    throw new Error(
      `exported recipe failed to load back cleanly: ` +
        `${exported?.staleReasons.join(", ") ?? library.warnings.join("; ")}`,
    );
  }

  const shouldMatch = source.sanityBriefs.map((brief) => {
    const score = recipeRetrievalScore(manifest, brief);
    return { brief, score, ok: score > 0 };
  });
  const shouldNotMatch = NEGATIVE_BRIEFS.map((brief) => {
    const score = recipeRetrievalScore(manifest, brief);
    return { brief, score, ok: score === 0 };
  });
  return {
    dir: targetDir,
    manifest,
    retrievalSanity: {
      shouldMatch,
      shouldNotMatch,
      ok: shouldMatch.every((entry) => entry.ok) && shouldNotMatch.every((entry) => entry.ok),
    },
    libraryWarnings: library.warnings,
  };
}
