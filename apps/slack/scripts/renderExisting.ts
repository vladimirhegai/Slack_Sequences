/** Render an already-published direct composition without any model calls. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDirectComposition } from "../src/engine/directComposition.ts";
import { resolveCliInputPath } from "../src/engine/cliPaths.ts";

const projectArg = process.argv[2];
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!projectArg) {
  console.error("usage: npm run render:existing -- <project-dir>");
  process.exitCode = 2;
} else {
  const projectDir = resolveCliInputPath(projectArg, appDir);
  const result = await renderDirectComposition(projectDir, { quality: "draft" });
  console.log(JSON.stringify(result, null, 2));
}
