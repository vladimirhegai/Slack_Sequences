/** Replay current storyboard parsing/normalization against a persisted raw response. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStoryboardResponse } from "../src/engine/compositionRunner.ts";
import { resolveCliInputPath } from "../src/engine/cliPaths.ts";

const sourceArg = process.argv[2];
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
if (!sourceArg) {
  console.error("usage: npm run storyboard:replay -- <raw-response-file> [--strict]");
  process.exitCode = 2;
} else {
  const sourcePath = resolveCliInputPath(sourceArg, appDir);
  const raw = fs.readFileSync(sourcePath, "utf8");
  const scenes = parseStoryboardResponse(raw, {}, { degradePacingFindings: !strict });
  console.log(JSON.stringify({
    sourcePath,
    strict,
    durationSec: scenes.at(-1)
      ? scenes.at(-1)!.startSec + scenes.at(-1)!.durationSec
      : 0,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      startSec: scene.startSec,
      durationSec: scene.durationSec,
      beats: scene.beats?.map((beat) => `${beat.id}@${beat.atSec}`) ?? [],
      moments: scene.moments?.map((moment) => `${moment.id}@${moment.atSec}`) ?? [],
      normalizations: scene.sentinelNormalizations ?? [],
    })),
  }, null, 2));
}
