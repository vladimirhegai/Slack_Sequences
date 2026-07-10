/** Replay current storyboard parsing/normalization against a persisted raw response. */
import fs from "node:fs";
import path from "node:path";
import { parseStoryboardResponse } from "../src/engine/compositionRunner.ts";

const sourceArg = process.argv[2];
if (!sourceArg) {
  console.error("usage: npm run storyboard:replay -- <raw-response-file>");
  process.exitCode = 2;
} else {
  const sourcePath = path.resolve(sourceArg);
  const raw = fs.readFileSync(sourcePath, "utf8");
  const scenes = parseStoryboardResponse(raw, {}, { degradePacingFindings: true });
  console.log(JSON.stringify({
    sourcePath,
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
