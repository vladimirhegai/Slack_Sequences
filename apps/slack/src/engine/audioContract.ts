/**
 * Sol-authored, host-mixed audio contract.
 *
 * The director chooses one of three approved music beds and optional semantic
 * SFX cue times. The trusted host owns file lookup, hashes, levels, fades,
 * staging, and FFmpeg muxing; model-authored paths or filter graphs never cross
 * this boundary.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AUDIO_CONTRACT_VERSION = 1;
export const AUDIO_PLAN_FILE = "audio-plan.v1.json";

export type SoundtrackId =
  | "confident-commercial"
  | "inspirational"
  | "fast-pop";
export type AudioCueKind = "typing" | "mouse-click" | "pop";

export type AudioCueV1 =
  | { kind: "typing"; startSec: number; endSec: number }
  | { kind: "mouse-click" | "pop"; atSec: number };

export interface AudioPlanV1 {
  version: 1;
  soundtrackId: SoundtrackId;
  cues: AudioCueV1[];
}

interface SoundtrackCatalogEntry {
  id: SoundtrackId;
  sourceFile: `vendor/royalty-free-music/${string}.mp3`;
  assetFile: `assets/audio/${string}.mp3`;
  sha256: string;
  durationSec: number;
  title: string;
  description: string;
  gainDb: number;
}

interface SfxCatalogEntry {
  kind: AudioCueKind;
  sourceFile: `vendor/sfx/${string}.wav`;
  assetFile: `assets/audio/${string}.wav`;
  sha256: string;
  durationSec: number;
  description: string;
  gainDb: number;
}

export const SOUNDTRACK_CATALOG: readonly SoundtrackCatalogEntry[] = Object.freeze([
  {
    id: "confident-commercial",
    sourceFile: "vendor/royalty-free-music/confident_commercial.mp3",
    assetFile: "assets/audio/confident_commercial.mp3",
    sha256: "a806b1676f0c806f32a44c6044f19b7bb88f1352c5fa34d43e17164446055ebe",
    durationSec: 30.0512,
    title: "Happy Tree",
    description: "Crisp, confident commercial momentum for a polished SaaS or product launch.",
    gainDb: -13,
  },
  {
    id: "inspirational",
    sourceFile: "vendor/royalty-free-music/inspirational.mp3",
    assetFile: "assets/audio/inspirational.mp3",
    sha256: "ab329ce7dd04c78ec8d3fc8c9fd438fddc6c3f37ca389f6c96a3ccf17a2076f7",
    durationSec: 30.0512,
    title: "Inspirational Advertising Music",
    description: "Warm, optimistic lift for a human startup story or emotionally resolved payoff.",
    gainDb: -13,
  },
  {
    id: "fast-pop",
    sourceFile: "vendor/royalty-free-music/fast_pop.mp3",
    assetFile: "assets/audio/fast_pop.mp3",
    sha256: "b99a5b91dd920a141f162a751b81b496a2658d74291e153f466efe1ecc7eec38",
    durationSec: 31.3501,
    title: "Slick Move",
    description: "Fast, bold pop energy for a punchy reveal or high-confidence launch statement.",
    gainDb: -13,
  },
] as const);

export const SFX_CATALOG: readonly SfxCatalogEntry[] = Object.freeze([
  {
    kind: "typing",
    sourceFile: "vendor/sfx/typing.wav",
    assetFile: "assets/audio/typing.wav",
    sha256: "7c5f971332f68f7d99dc78b801ed1f33d5c20b9758ee760f3742a44d753d1f71",
    durationSec: 31.123583,
    description: "Keyboard typing texture; declare a bounded start/end window while glyphs appear.",
    gainDb: -12,
  },
  {
    kind: "mouse-click",
    sourceFile: "vendor/sfx/mouse_click.wav",
    assetFile: "assets/audio/mouse_click.wav",
    sha256: "f6661b83afaf71c94586eabb00cda36caaf8f0961026b1ce0e552347fa06e6fe",
    durationSec: 0.209705,
    description: "One restrained mouse click at the declared control action.",
    gainDb: -4,
  },
  {
    kind: "pop",
    sourceFile: "vendor/sfx/mouth_pop.wav",
    assetFile: "assets/audio/mouth_pop.wav",
    sha256: "f0680e3bf936fb22b3606d1600716908a20ea24e0106ee4daa5f970e3114e154",
    durationSec: 0.128005,
    description: "Short pop accent for one meaningful reveal, state arrival, or brand punctuation.",
    gainDb: -6,
  },
] as const);

export const AUDIO_DIRECTOR_CATALOG = Object.freeze({
  version: 1,
  authority:
    "Choose one soundtrack and only useful semantic cues. The host owns paths, levels, fades, looping, limiting, and muxing; no beat synchronization is required.",
  soundtracks: SOUNDTRACK_CATALOG.map(({ id, title, description, durationSec }) => ({
    id,
    title,
    description,
    durationSec,
  })),
  sfx: SFX_CATALOG.map(({ kind, description, durationSec }) => ({
    kind,
    description,
    durationSec,
  })),
  schema: {
    version: 1,
    soundtrackId: "confident-commercial | inspirational | fast-pop",
    cues: [
      { kind: "typing", startSec: "number", endSec: "number" },
      { kind: "mouse-click | pop", atSec: "number" },
    ],
  },
});

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(ENGINE_DIR, "../..");
const MAX_AUDIO_CUES = 20;
const MAX_TYPING_CUES = 4;
const MAX_CLICK_CUES = 12;
const MAX_POP_CUES = 6;
const MAX_TYPING_WINDOW_SEC = 8;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function soundtrack(id: unknown): SoundtrackCatalogEntry | undefined {
  return SOUNDTRACK_CATALOG.find((entry) => entry.id === id);
}

function sfx(kind: AudioCueKind): SfxCatalogEntry {
  return SFX_CATALOG.find((entry) => entry.kind === kind)!;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`audio plan has invalid ${label}`);
  }
  return value;
}

export function validateAudioPlan(value: unknown, durationSec: number): AudioPlanV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("audio plan must be an object");
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("audio plan requires a positive film duration");
  }
  const plan = value as Partial<AudioPlanV1>;
  if (plan.version !== 1) throw new Error("audio plan must use version 1");
  const selected = soundtrack(plan.soundtrackId);
  if (!selected) throw new Error("audio plan must choose one catalog soundtrackId");
  if (!Array.isArray(plan.cues)) throw new Error("audio plan cues must be an array");
  if (plan.cues.length > MAX_AUDIO_CUES) {
    throw new Error(`audio plan may declare at most ${MAX_AUDIO_CUES} cues`);
  }
  const counts: Record<AudioCueKind, number> = {
    typing: 0,
    "mouse-click": 0,
    pop: 0,
  };
  const seen = new Set<string>();
  const cues = plan.cues.map((candidate, index): AudioCueV1 => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`audio cue ${index + 1} must be an object`);
    }
    const cue = candidate as Partial<AudioCueV1> & Record<string, unknown>;
    if (cue.kind !== "typing" && cue.kind !== "mouse-click" && cue.kind !== "pop") {
      throw new Error(`audio cue ${index + 1} has an unsupported kind`);
    }
    counts[cue.kind] += 1;
    if (cue.kind === "typing") {
      const startSec = finite(cue.startSec, `cues[${index}].startSec`);
      const endSec = finite(cue.endSec, `cues[${index}].endSec`);
      if (
        startSec < 0 || endSec <= startSec || endSec > durationSec ||
        endSec - startSec > MAX_TYPING_WINDOW_SEC
      ) {
        throw new Error(`audio typing cue ${index + 1} has an invalid bounded window`);
      }
      const key = `typing:${startSec}:${endSec}`;
      if (seen.has(key)) throw new Error(`audio cue ${index + 1} duplicates another cue`);
      seen.add(key);
      return { kind: "typing", startSec, endSec };
    }
    const atSec = finite(cue.atSec, `cues[${index}].atSec`);
    if (atSec < 0 || atSec >= durationSec) {
      throw new Error(`audio ${cue.kind} cue ${index + 1} is outside the film`);
    }
    const key = `${cue.kind}:${atSec}`;
    if (seen.has(key)) throw new Error(`audio cue ${index + 1} duplicates another cue`);
    seen.add(key);
    return { kind: cue.kind, atSec };
  });
  if (
    counts.typing > MAX_TYPING_CUES ||
    counts["mouse-click"] > MAX_CLICK_CUES ||
    counts.pop > MAX_POP_CUES
  ) {
    throw new Error("audio plan exceeds the per-kind cue budget");
  }
  return { version: 1, soundtrackId: selected.id, cues };
}

function catalogSource(relativePath: string): string {
  return path.join(APP_ROOT, ...relativePath.split("/"));
}

function copyVerified(entry: { sourceFile: string; assetFile: string; sha256: string }, targetDir: string): string {
  const source = catalogSource(entry.sourceFile);
  if (!fs.existsSync(source)) throw new Error(`audio catalog source is missing: ${entry.sourceFile}`);
  const bytes = fs.readFileSync(source);
  if (sha256(bytes) !== entry.sha256) {
    throw new Error(`audio catalog source failed SHA-256 verification: ${entry.sourceFile}`);
  }
  const basename = path.posix.basename(entry.assetFile);
  fs.writeFileSync(path.join(targetDir, basename), bytes);
  return entry.assetFile;
}

export function stageAudioAssets(
  projectDir: string,
  value: AudioPlanV1,
  durationSec: number,
): { soundtrackId: SoundtrackId; files: string[] } {
  const plan = validateAudioPlan(value, durationSec);
  const targetDir = path.join(path.resolve(projectDir), "assets", "audio");
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  const files = [copyVerified(soundtrack(plan.soundtrackId)!, targetDir)];
  const usedKinds = new Set(plan.cues.map((cue) => cue.kind));
  for (const entry of SFX_CATALOG) {
    if (usedKinds.has(entry.kind)) files.push(copyVerified(entry, targetDir));
  }
  const planFile = path.join(targetDir, AUDIO_PLAN_FILE);
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + "\n", "utf8");
  files.push(`assets/audio/${AUDIO_PLAN_FILE}`);
  return { soundtrackId: plan.soundtrackId, files };
}

function amplitude(db: number): string {
  return Math.pow(10, db / 20).toFixed(6);
}

function seconds(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function milliseconds(value: number): number {
  return Math.max(0, Math.round(value * 1000));
}

function stagedPath(compositionDir: string, assetFile: string, expectedHash: string): string {
  const file = path.join(compositionDir, ...assetFile.split("/"));
  if (!fs.existsSync(file)) throw new Error(`staged audio file is missing: ${assetFile}`);
  if (sha256(fs.readFileSync(file)) !== expectedHash) {
    throw new Error(`staged audio file failed SHA-256 verification: ${assetFile}`);
  }
  return file;
}

/** Add the staged Sol-authored sound plan to a silent producer MP4. */
export function mixAudioIntoVideo(input: {
  ffmpegPath: string;
  compositionDir: string;
  videoPath: string;
  durationSec: number;
}): boolean {
  const planPath = path.join(input.compositionDir, "assets", "audio", AUDIO_PLAN_FILE);
  if (!fs.existsSync(planPath)) return false;
  const plan = validateAudioPlan(
    JSON.parse(fs.readFileSync(planPath, "utf8")) as unknown,
    input.durationSec,
  );
  const selected = soundtrack(plan.soundtrackId)!;
  const args: string[] = ["-y", "-i", input.videoPath];
  args.push("-stream_loop", "-1", "-i", stagedPath(input.compositionDir, selected.assetFile, selected.sha256));
  const filters: string[] = [];
  const labels: string[] = [];
  const fadeOutDuration = Math.min(0.65, input.durationSec / 2);
  const fadeOutStart = Math.max(0, input.durationSec - fadeOutDuration);
  filters.push(
    `[1:a]atrim=start=0:end=${seconds(input.durationSec)},asetpts=PTS-STARTPTS,` +
      `aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
      `volume=${amplitude(selected.gainDb)},afade=t=in:st=0:d=${seconds(Math.min(0.25, input.durationSec / 3))},` +
      `afade=t=out:st=${seconds(fadeOutStart)}:d=${seconds(fadeOutDuration)}[audio0]`,
  );
  labels.push("[audio0]");
  let inputIndex = 2;
  for (const [cueIndex, cue] of plan.cues.entries()) {
    const entry = sfx(cue.kind);
    args.push("-i", stagedPath(input.compositionDir, entry.assetFile, entry.sha256));
    const label = `audio${cueIndex + 1}`;
    if (cue.kind === "typing") {
      const cueDuration = cue.endSec - cue.startSec;
      const edgeFade = Math.min(0.03, cueDuration / 4);
      filters.push(
        `[${inputIndex}:a]atrim=start=0:end=${seconds(cueDuration)},asetpts=PTS-STARTPTS,` +
          `aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
          `volume=${amplitude(entry.gainDb)},afade=t=in:st=0:d=${seconds(edgeFade)},` +
          `afade=t=out:st=${seconds(Math.max(0, cueDuration - edgeFade))}:d=${seconds(edgeFade)},` +
          `adelay=${milliseconds(cue.startSec)}:all=1[${label}]`,
      );
    } else {
      filters.push(
        `[${inputIndex}:a]atrim=start=0:end=${seconds(entry.durationSec)},asetpts=PTS-STARTPTS,` +
          `aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
          `volume=${amplitude(entry.gainDb)},adelay=${milliseconds(cue.atSec)}:all=1[${label}]`,
      );
    }
    labels.push(`[${label}]`);
    inputIndex += 1;
  }
  filters.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,` +
      `alimiter=limit=0.95,atrim=start=0:end=${seconds(input.durationSec)}[audio]`,
  );
  const temporary = `${input.videoPath}.${randomUUID()}.audio.mp4`;
  const backup = `${input.videoPath}.${randomUUID()}.silent.mp4`;
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "0:v:0",
    "-map", "[audio]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-t", seconds(input.durationSec),
    "-movflags", "+faststart",
    temporary,
  );
  try {
    execFileSync(input.ffmpegPath, args, { stdio: "pipe", maxBuffer: 16 * 1024 * 1024 });
    fs.renameSync(input.videoPath, backup);
    try {
      fs.renameSync(temporary, input.videoPath);
      fs.rmSync(backup, { force: true });
    } catch (error) {
      if (fs.existsSync(backup) && !fs.existsSync(input.videoPath)) fs.renameSync(backup, input.videoPath);
      throw error;
    }
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const detail = stderr ? String(stderr).trim().slice(-2_000) : String(error);
    throw new Error(`audio mix failed: ${detail}`, { cause: error });
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.rmSync(backup, { force: true });
  }
  return true;
}
