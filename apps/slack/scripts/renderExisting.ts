/** Render an already-published direct composition without any model calls. */
import path from "node:path";
import { renderDirectComposition } from "../src/engine/directComposition.ts";

const projectArg = process.argv[2];
if (!projectArg) {
  console.error("usage: npm run render:existing -- <project-dir>");
  process.exitCode = 2;
} else {
  const projectDir = path.resolve(projectArg);
  const result = await renderDirectComposition(projectDir, { quality: "draft" });
  console.log(JSON.stringify(result, null, 2));
}
