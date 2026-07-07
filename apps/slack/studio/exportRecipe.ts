/**
 * Recipe Studio — RecipeV2 export (plan §7.5, the mechanical half).
 *
 * "Export" turns a GREEN-gated workspace into a library recipe the live
 * agents retrieve and instantiate:
 *   1. hard-require a green gate whose fragmentHash still matches the
 *      workspace fragment (edit-after-gate re-arms the gate);
 *   2. write `skills/sequences-recipes/<id>/` — recipe.json (manifest draft +
 *      CURRENT engine fences + content-addressed fragmentHash + revision
 *      bump), recipe.md, fragment.html, demo.html (the gated composition),
 *      preview/ (the gate's thumbnail strip);
 *   3. refresh the library and run the retrieval sanity check: the recipe
 *      must score on the workspace's should-match briefs and stay silent on
 *      two canned negatives — a recipe that matches everything (or nothing)
 *      gets its triggerPatterns fixed NOW, not discovered broken in
 *      production.
 *
 * The agent-drafted describe pass (metadata suggestions from chat history)
 * is the follow-up agent's milestone; the export mechanics here are final.
 */
import fs from "node:fs";
import path from "node:path";
import {
  currentEngineFences,
  defaultRecipesRootDir,
  loadRecipeLibrary,
  recipeFragmentHash,
  recipeRetrievalScore,
  type RecipeManifest,
} from "../src/engine/recipeContract.ts";
import {
  loadWorkspace,
  workspaceFragment,
  workspaceProjectDir,
  workspaceRecipeMd,
} from "./workspaces.ts";

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

export function exportWorkspaceRecipe(id: string): RecipeExportResult {
  const workspace = loadWorkspace(id);
  const fragment = workspaceFragment(id);
  if (!workspace.gate?.ok) {
    throw new Error("export requires a green gate — generate first");
  }
  if (workspace.gate.fragmentHash !== recipeFragmentHash(fragment)) {
    throw new Error("fragment changed after the last green gate — re-generate first");
  }
  const projectDir = workspaceProjectDir(id);
  const demoFile = path.join(projectDir, "composition", "index.html");
  if (!fs.existsSync(demoFile)) {
    throw new Error("no committed demo composition found — generate first");
  }

  const targetDir = path.join(defaultRecipesRootDir(), workspace.recipeId);
  const existing = loadRecipeLibrary({ refresh: true }).recipes.get(workspace.recipeId);
  const manifest: RecipeManifest = {
    ...workspace.manifestDraft,
    id: workspace.recipeId,
    engine: {
      ...(workspace.manifestDraft.engine ?? {}),
      ...currentEngineFences(),
    },
    fragmentHash: recipeFragmentHash(fragment),
    revision: existing ? existing.manifest.revision + 1 : workspace.manifestDraft.revision,
  };

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "recipe.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(targetDir, "fragment.html"), fragment, "utf8");
  fs.writeFileSync(path.join(targetDir, "recipe.md"), workspaceRecipeMd(id), "utf8");
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
  const exported = library.recipes.get(workspace.recipeId);
  if (!exported || exported.stale) {
    throw new Error(
      `exported recipe failed to load back cleanly: ` +
        `${exported?.staleReasons.join(", ") ?? library.warnings.join("; ")}`,
    );
  }

  const shouldMatch = workspace.sanityBriefs.map((brief) => {
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
