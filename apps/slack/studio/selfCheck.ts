/**
 * Recipe Studio self-check — the scripted end-to-end proof (plan §11).
 *
 * Headless: create (or reuse) a workspace seeded from a library recipe, run
 * the full gate (scaffold → injection → static validation → browser QA →
 * thumbnails), and — with `--export` — write the RecipeV2 export back into
 * `skills/sequences-recipes/` and re-load it through retrieval.
 *
 * The golden path (run after any engine change that touches a recipe seam):
 *   npm run studio:golden --workspace @sequences/slack
 * is exactly `selfCheck.ts --recipe last-word-roulette --export`: it re-proves
 * the golden recipe against the CURRENT engine and re-stamps its demo.html,
 * preview strip, fragment hash, and engine version fences.
 */
import fs from "node:fs";
import path from "node:path";
import { loadRecipeLibrary, recipeRetrievalScore } from "../src/engine/recipeContract.ts";
import { retrieveHyperframesSkillContext } from "../src/agent/skillContext.ts";
import { gateWorkspace } from "./gate.ts";
import { exportWorkspaceRecipe } from "./exportRecipe.ts";
import {
  createWorkspace,
  listWorkspaces,
  loadWorkspace,
  updateWorkspaceSources,
  STUDIO_ROOT,
} from "./workspaces.ts";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const recipeId = argValue("--recipe") ?? "last-word-roulette";
const workspaceId = argValue("--workspace-id") ?? `${recipeId}`;
const doExport = process.argv.includes("--export");

const GOLDEN_PARAMS: Record<string, Record<string, string | number>> = {
  "last-word-roulette": {
    lead: "Your launch becomes",
    word1: "a thread",
    word2: "a task",
    word3: "a demo",
    payoff: "a film.",
    accent: "var(--cinema-key)",
    settleSec: 3.2,
  },
};

const GOLDEN_BRIEFS: Record<string, string[]> = {
  "last-word-roulette": [
    "Hook shot: the headline cycles through words and lands on the last word 'shipped' — a word roulette payoff.",
    "Launch film where the hero copy spins through options like a slot machine before the final word locks in.",
  ],
};

async function main(): Promise<void> {
  process.stdout.write(`Recipe Studio self-check — recipe "${recipeId}"\n`);

  const exists = listWorkspaces().some((workspace) => workspace.id === workspaceId);
  if (!exists) {
    const library = loadRecipeLibrary({ refresh: true });
    createWorkspace({
      id: workspaceId,
      ...(library.recipes.has(recipeId) ? { fromRecipe: recipeId } : {}),
    });
    process.stdout.write(`→ created workspace ${path.join(STUDIO_ROOT, workspaceId)}\n`);
  }
  const params = GOLDEN_PARAMS[recipeId];
  const briefs = GOLDEN_BRIEFS[recipeId];
  if (params || briefs) {
    updateWorkspaceSources(workspaceId, {
      ...(params ? { params } : {}),
      ...(briefs ? { sanityBriefs: briefs } : {}),
    });
  }

  process.stdout.write("→ gate (scaffold + injection + static + browser QA + thumbnails)\n");
  const { gate } = await gateWorkspace(workspaceId);
  for (const error of gate.errors) process.stdout.write(`  ✗ ${error}\n`);
  for (const warning of gate.warnings.slice(0, 10)) process.stdout.write(`  ⚠ ${warning}\n`);
  if (!gate.ok) {
    process.stdout.write("GATE RED — not exportable.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`  ✓ gate green (${gate.thumbnails.length} thumbnails)\n`);

  if (!doExport) {
    process.stdout.write("Skipping export (pass --export to write the library).\n");
    return;
  }

  process.stdout.write("→ export RecipeV2\n");
  const result = exportWorkspaceRecipe(workspaceId);
  process.stdout.write(`  ✓ wrote ${result.dir} (revision ${result.manifest.revision})\n`);
  process.stdout.write(
    `  retrieval sanity: ${result.retrievalSanity.ok ? "OK" : "CHECK TRIGGER PATTERNS"}\n`,
  );
  for (const entry of result.retrievalSanity.shouldMatch) {
    process.stdout.write(`    should-match [${entry.ok ? "✓" : "✗"} score ${entry.score}] ${entry.brief.slice(0, 70)}…\n`);
  }
  for (const entry of result.retrievalSanity.shouldNotMatch) {
    process.stdout.write(`    should-NOT   [${entry.ok ? "✓" : "✗"} score ${entry.score}] ${entry.brief.slice(0, 70)}…\n`);
  }

  // Close the loop the way a live create would: retrieval over a matching
  // brief must surface the recipe, and the exported demo must exist.
  const brief = briefs?.[0] ?? recipeId;
  const skills = retrieveHyperframesSkillContext("create", brief);
  const surfaced = skills.recipeIds?.includes(recipeId);
  process.stdout.write(
    `  live retrieval: ${surfaced ? "✓ surfaced" : "✗ NOT surfaced"} for the golden brief ` +
      `(score ${recipeRetrievalScore(result.manifest, brief)})\n`,
  );
  const demo = path.join(result.dir, "demo.html");
  process.stdout.write(`  demo artifact: ${fs.existsSync(demo) ? "✓" : "✗"} ${demo}\n`);
  if (!surfaced) process.exitCode = 1;
}

await main();
