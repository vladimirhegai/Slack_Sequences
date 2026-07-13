import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUDIO_PLAN_FILE,
  mixAudioIntoVideo,
  SOUNDTRACK_CATALOG,
  stageAudioAssets,
  validateAudioPlan,
} from "../src/engine/audioContract.ts";
import { findFfmpeg } from "../src/engine/render.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Sol audio contract", () => {
  it("exposes exactly the three approved music beds and only semantic cues", () => {
    expect(SOUNDTRACK_CATALOG.map((track) => track.id)).toEqual([
      "confident-commercial",
      "inspirational",
      "fast-pop",
    ]);
    expect(validateAudioPlan({
      version: 1,
      soundtrackId: "fast-pop",
      cues: [
        { kind: "typing", startSec: 0.1, endSec: 0.6 },
        { kind: "mouse-click", atSec: 0.7 },
        { kind: "pop", atSec: 0.8 },
      ],
    }, 1)).toMatchObject({ soundtrackId: "fast-pop" });
    expect(() => validateAudioPlan({
      version: 1,
      soundtrackId: "fast-pop",
      cues: [{ kind: "whoosh", atSec: 0.5 }],
    }, 1)).toThrow(/unsupported kind/);
  });

  it("stages the selected bed and cues, then muxes a real AAC stream", () => {
    const ffmpeg = findFfmpeg();
    expect(ffmpeg).toBeTruthy();
    if (!ffmpeg) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-audio-"));
    roots.push(root);
    const video = path.join(root, "film.mp4");
    execFileSync(ffmpeg, [
      "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
    ], { stdio: "pipe" });
    const plan = {
      version: 1 as const,
      soundtrackId: "confident-commercial" as const,
      cues: [
        { kind: "typing" as const, startSec: 0.1, endSec: 0.45 },
        { kind: "mouse-click" as const, atSec: 0.25 },
        { kind: "pop" as const, atSec: 0.65 },
      ],
    };
    const staged = stageAudioAssets(root, plan, 1);
    expect(staged.files).toEqual(expect.arrayContaining([
      "assets/audio/confident_commercial.mp3",
      "assets/audio/typing.wav",
      "assets/audio/mouse_click.wav",
      "assets/audio/mouth_pop.wav",
      `assets/audio/${AUDIO_PLAN_FILE}`,
    ]));
    expect(mixAudioIntoVideo({
      ffmpegPath: ffmpeg,
      compositionDir: root,
      videoPath: video,
      durationSec: 1,
    })).toBe(true);
    expect(() => execFileSync(ffmpeg, [
      "-v", "error", "-i", video, "-map", "0:a:0", "-f", "null", "-",
    ], { stdio: "pipe" })).not.toThrow();
  });
});
