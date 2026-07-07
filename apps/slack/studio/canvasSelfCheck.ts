/**
 * Recipe Studio — canvas builder smoke (plan §11).
 *
 * Compiles the starter canvas film and runs it through the EXACT production
 * gate (validate → commit + browser QA → thumbnails). Proves the plan's core
 * promise: a click-together film is valid, seek-safe, and fully gated with zero
 * tokens. Run: `npm run studio:canvas --workspace @sequences/slack`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitDirectComposition,
  generateDirectThumbnails,
  validateDirectComposition,
} from "../src/engine/directComposition.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { compileCanvasFilm } from "./compileCanvas.ts";
import { starterCanvasFilm, validateCanvasFilm } from "./canvasModel.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const projectDir = path.join(APP_DIR, ".data", "studio", "__canvas-smoke");
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(projectDir, { recursive: true });
  initializeProject(projectDir, { name: "canvas-smoke", seedScreenshot: false });

  const film = starterCanvasFilm();
  const modelErrors = validateCanvasFilm(film);
  if (modelErrors.length) {
    for (const error of modelErrors) process.stdout.write(`  ✗ model: ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write("→ compile starter canvas film\n");
  const draft = compileCanvasFilm(projectDir, film);

  process.stdout.write("→ validate (static gate)\n");
  const validation = await validateDirectComposition(projectDir, draft);
  for (const error of validation.errors) process.stdout.write(`  ✗ ${error}\n`);
  for (const warning of validation.warnings.slice(0, 20)) process.stdout.write(`  ⚠ ${warning}\n`);
  if (!validation.ok) {
    process.stdout.write("STATIC GATE RED\n");
    process.exitCode = 1;
    return;
  }

  process.stdout.write("→ commit + browser QA\n");
  await commitDirectComposition(projectDir, "Canvas smoke", draft);
  const thumbs = await generateDirectThumbnails(projectDir);
  process.stdout.write(`  ✓ gate green · ${Object.keys(thumbs.files).length} thumbnails\n`);
  process.stdout.write(`  thumbs dir: ${path.join(projectDir, "build", "thumbs")}\n`);
}

await main();
