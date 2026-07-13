/** Strict, model-free replay of an exact persisted source artifact. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyDeterministicSourceRepairs } from "../src/engine/compositionRunner.ts";
import {
  validateDirectComposition,
  type DirectCompositionDraft,
  type DirectScene,
} from "../src/engine/directComposition.ts";
import { resolveCliInputPath } from "../src/engine/cliPaths.ts";

export interface SourceReplayResult {
  projectDir: string;
  sourcePath: string;
  repairedHtml: string;
  storyboard: DirectScene[];
  validation: Awaited<ReturnType<typeof validateDirectComposition>>;
}

function loadStoryboard(projectDir: string): DirectScene[] {
  const file = path.join(projectDir, "planning", "storyboard.json");
  if (!fs.existsSync(file)) throw new Error(`missing storyboard fixture: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { storyboard?: DirectScene[] };
  if (!Array.isArray(parsed.storyboard)) throw new Error(`storyboard fixture has no storyboard array: ${file}`);
  return parsed.storyboard;
}

export async function replaySourceArtifact(
  projectDir: string,
  sourcePath: string,
): Promise<SourceReplayResult> {
  const storyboard = loadStoryboard(projectDir);
  const draft: DirectCompositionDraft = {
    html: fs.readFileSync(sourcePath, "utf8"),
    storyboard,
  };
  const repaired = applyDeterministicSourceRepairs(draft, projectDir, storyboard);
  const validation = await validateDirectComposition(projectDir, repaired);
  if (!validation.ok) {
    throw new Error(
      `strict source replay rejected ${sourcePath}:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  return {
    projectDir,
    sourcePath,
    repairedHtml: repaired.html,
    storyboard: repaired.storyboard,
    validation,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceArg = process.argv[2];
  if (!sourceArg) {
    console.error("usage: npm run source:replay -- <author-artifact.html> [project-dir]");
    process.exitCode = 2;
  } else {
    try {
      const sourcePath = resolveCliInputPath(sourceArg, path.resolve(import.meta.dirname, ".."));
      const projectDir = process.argv[3]
        ? resolveCliInputPath(process.argv[3], path.resolve(import.meta.dirname, ".."))
        : path.resolve(sourcePath, "..", "..", "..");
      const result = await replaySourceArtifact(projectDir, sourcePath);
      console.log(JSON.stringify({
        sourcePath: result.sourcePath,
        projectDir: result.projectDir,
        storyboardScenes: result.storyboard.length,
        repairedHtmlBytes: Buffer.byteLength(result.repairedHtml),
        warnings: result.validation.warnings,
      }, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
