/**
 * Recipe library CLI — the coding agent's (and operator's) terminal loop.
 *
 *   npm run recipes -- list                 sources + export status
 *   npm run recipes -- gate <id> [--all]    full production gate (browser QA + thumbnails)
 *   npm run recipes -- export <id> [--all]  gate, then write skills/sequences-recipes/<id>/
 *
 * `npm run studio:golden` is `export last-word-roulette` — the golden re-proof
 * to run after any engine change that touches a recipe seam.
 *
 * Authoring guide: apps/slack/recipes/README.md. Exit code is non-zero on a
 * red gate, a failed export, or a retrieval sanity miss, so agents can chain
 * on success.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRecipeLibrary, recipeRetrievalScore } from "../src/engine/recipeContract.ts";
import { retrieveHyperframesSkillContext } from "../src/agent/skillContext.ts";
import { gateRecipe, loadGateRecord, recipeGateDir } from "./gate.ts";
import { exportRecipe } from "./exportRecipe.ts";
import { listRecipeSources, recipeSourceStatuses } from "./recipeSource.ts";
import { buildCatalogScaffold, writeCatalogScaffold } from "./catalogScaffold.ts";

const [command, ...rest] = process.argv.slice(2);
const all = rest.includes("--all");
const ids = rest.filter((arg) => !arg.startsWith("--"));

function targetIds(): string[] {
  if (all) return listRecipeSources().sources.map((source) => source.id);
  if (!ids.length) {
    process.stderr.write("pass a recipe id (or --all)\n");
    process.exit(2);
  }
  return ids;
}

function printList(): void {
  const { statuses, issues } = recipeSourceStatuses();
  if (!statuses.length && !issues.length) {
    process.stdout.write("No recipe sources yet — see apps/slack/recipes/README.md\n");
    return;
  }
  for (const { source, exported } of statuses) {
    const gate = loadGateRecord(source.id);
    const gateLabel = !gate
      ? "not gated"
      : gate.fragmentHash !== source.fragmentHash
        ? "gate stale (source edited)"
        : gate.ok
          ? "gate GREEN"
          : "gate RED";
    const exportLabel = !exported
      ? "not exported"
      : !exported.inSync
        ? `exported r${exported.revision} (OUT OF SYNC — re-export)`
        : exported.stale
          ? `exported r${exported.revision} (STALE: ${exported.staleReasons.join(", ")})`
          : `exported r${exported.revision}`;
    process.stdout.write(`${source.id}\n  ${source.manifest.title}\n  ${gateLabel} · ${exportLabel}\n`);
  }
  for (const issue of issues) {
    process.stdout.write(`✗ ${path.basename(issue.file)}\n  ${issue.errors.join("\n  ")}\n`);
    process.exitCode = 1;
  }
}

async function runGate(id: string): Promise<boolean> {
  process.stdout.write(`→ gate ${id} (scaffold + injection + static + browser QA + thumbnails)\n`);
  const { gate } = await gateRecipe(id);
  for (const error of gate.errors) process.stdout.write(`  ✗ ${error}\n`);
  for (const warning of gate.warnings.slice(0, 10)) process.stdout.write(`  ⚠ ${warning}\n`);
  if (!gate.ok) {
    process.stdout.write(`GATE RED — fix the source and re-run. Work dir: ${recipeGateDir(id)}\n`);
    return false;
  }
  process.stdout.write(`  ✓ gate green (${gate.thumbnails.length} thumbnails in ${path.join(recipeGateDir(id), "build", "thumbs")})\n`);
  return true;
}

async function runExport(id: string): Promise<boolean> {
  if (!(await runGate(id))) return false;
  const result = exportRecipe(id);
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
  const library = loadRecipeLibrary({ refresh: true });
  const manifest = library.recipes.get(id)?.manifest;
  const brief = result.retrievalSanity.shouldMatch[0]?.brief ?? id;
  const skills = retrieveHyperframesSkillContext("create", brief);
  const surfaced = skills.recipeIds?.includes(id);
  process.stdout.write(
    `  live retrieval: ${surfaced ? "✓ surfaced" : "✗ NOT surfaced"} for the first sanity brief` +
      `${manifest ? ` (score ${recipeRetrievalScore(manifest, brief)})` : ""}\n`,
  );
  const demo = path.join(result.dir, "demo.html");
  process.stdout.write(`  demo artifact: ${fs.existsSync(demo) ? "✓" : "✗"} ${demo}\n`);
  return Boolean(surfaced) && result.retrievalSanity.ok;
}

async function main(): Promise<void> {
  switch (command) {
    case "list":
    case undefined:
      printList();
      return;
    case "new": {
      const id = ids[0];
      if (!id) {
        process.stderr.write("pass a recipe id\n");
        process.exit(2);
      }
      const target = writeCatalogScaffold(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
        buildCatalogScaffold("recipes", id),
      );
      process.stdout.write(`created ${target}\nread studio/skills/studio-recipes/SKILL.md before implementation\n`);
      return;
    }
    case "gate": {
      for (const id of targetIds()) {
        if (!(await runGate(id))) process.exitCode = 1;
      }
      return;
    }
    case "export": {
      for (const id of targetIds()) {
        if (!(await runExport(id))) process.exitCode = 1;
      }
      return;
    }
    default:
      process.stderr.write(`unknown command "${command}" — use list | new <id> | gate <id> | export <id>\n`);
      process.exit(2);
  }
}

await main();
