/**
 * Environment contract -- the host-owned composition layer for WS-A1/A1b/B1.
 *
 * A film receives exactly one production-cleared wallpaper selection. Each
 * scene then receives one deterministic staging shape: desktop, a framed
 * screen, a near-full app pedestal, or a token-tinted generated field. The
 * island is decoration for layout QA (`data-layout-ignore`) but deliberate
 * composition for the whole-frame floor (`data-composition-credit`).
 *
 * Camera ownership is intentionally disjoint: the environment is injected as
 * a direct scene child, outside `data-camera-world`. A static wrapper may carry
 * `data-depth`; the living-canvas runtime transforms only its child imagery,
 * furniture, and light, so it never overwrites camera transforms or filters.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKGROUND_CATALOG,
  backgroundById,
  type BackgroundMotionMode,
  type BackgroundOverlayMode,
  type BackgroundTextSafeSide,
} from "./backgroundCatalog.ts";
import type { DirectScene } from "./directComposition.ts";
import type { CameraBlockingPlanV1 } from "./cameraBlocking.ts";
import { readFrameMeta, type FrameMeta } from "./frameDesign.ts";
import { slackSequencesEnvRawValue } from "./featureFlags.ts";

export const ENVIRONMENT_CONTRACT_VERSION = 1;
export const ENVIRONMENT_RUNTIME_VERSION = 1;
export const ENVIRONMENT_KIT_VERSION = 1;
export const ENVIRONMENT_RUNTIME_FILE = "sequences-environment.v1.js";
export const ENVIRONMENT_KIT_FILE = "sequences-environment.v1.css";
export const ENVIRONMENT_KIT_STYLE_ID = "sequences-environment-kit";
export const ENVIRONMENT_PLAN_ID = "sequences-environment";

/** Default-on living canvas; explicit operator rollback remains available. */
export function environmentsEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_ENVIRONMENT") !== "0";
}

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(ENGINE_DIR, "../..");
const WALLPAPERS_ROOT = path.join(APP_ROOT, "vendor", "wallpapers");
const WALLPAPER_LICENSE_FILE = "LICENSE";
const RUNTIME_SOURCE_PATH = path.join(ENGINE_DIR, "templates", ENVIRONMENT_RUNTIME_FILE);
const KIT_SOURCE_PATH = path.join(ENGINE_DIR, "templates", ENVIRONMENT_KIT_FILE);

export type EnvironmentShape =
  | "desktop-stage"
  | "screen-over-wallpaper"
  | "full-app-view"
  | "generated-field";

export interface EnvironmentSettleWindowV1 {
  startSec: number;
  endSec: number;
  /** Ambient amplitude multiplier while the viewer is reading/landing. */
  amplitudeScale: number;
}

export type EnvironmentSettleWindowInput =
  Partial<Pick<EnvironmentSettleWindowV1, "amplitudeScale">> &
  Pick<EnvironmentSettleWindowV1, "startSec" | "endSec">;

export interface EnvironmentReadingWindowV1 {
  startSec: number;
  endSec: number;
}

/**
 * Convert the director's primary landing dwells into the living canvas's
 * stable-wallpaper windows. Supporting beats may keep the full ambient field;
 * primary evidence gets a motionless image plane while edge furniture and
 * light continue to breathe. The environment normalizer clips/merges these
 * absolute windows against each scene.
 */
export function primaryReadingWindowsByScene(
  blocking: CameraBlockingPlanV1,
): Record<string, EnvironmentReadingWindowV1[]> {
  return Object.fromEntries(
    blocking.scenes.flatMap((scene) => {
      const windows = scene.phrases
        .filter((phrase) => phrase.importance === "primary")
        .map((phrase) => ({
          startSec: phrase.dwell.startSec,
          endSec: phrase.dwell.endSec,
        }))
        .filter((window) => window.endSec > window.startSec);
      return windows.length ? [[scene.sceneId, windows] as const] : [];
    }),
  );
}

export interface EnvironmentWallpaperPlanV1 {
  id: string;
  /** Repository-relative source. Never emitted as an HTML URL. */
  sourceFile: `vendor/wallpapers/${string}.jpg`;
  /** Project-relative URL emitted into the composition. */
  assetFile: `assets/wallpapers/${string}.jpg`;
  objectPosition: string;
  textSafeSide: BackgroundTextSafeSide;
  overlay: {
    mode: BackgroundOverlayMode;
    opacity: number;
  };
  motion: {
    mode: BackgroundMotionMode;
    maxTravelPercent: number;
    maxScale: number;
  };
}

export interface EnvironmentScenePlanV1 {
  sceneId: string;
  startSec: number;
  endSec: number;
  shape: EnvironmentShape;
  basis: "light" | "dark";
  /** 0 = reading pose, 1 = decisive travel. Motion remains below catalog caps. */
  directionScore: number;
  /** Stable phase keeps simultaneous ambient layers from moving in lockstep. */
  phaseRad: number;
  /** One slow cycle; finite scene-local motion, never an infinite loop. */
  periodSec: number;
  furnitureMaxPx: number;
  lightMaxPx: number;
  settleWindows: EnvironmentSettleWindowV1[];
  /** Wallpaper freezes behind primary copy while edge furniture/light may live. */
  readingWindows: EnvironmentReadingWindowV1[];
}

export interface EnvironmentPlanV1 {
  version: 1;
  compositionId: string;
  frame: {
    dialectId?: string;
    backgroundPolicyId?: string;
    basis: "light" | "dark";
  };
  /** The sole wallpaper selection for the film. */
  wallpaper: EnvironmentWallpaperPlanV1;
  scenes: EnvironmentScenePlanV1[];
}

export interface EnvironmentPlanOptions {
  compositionId: string;
  frame?: Pick<FrameMeta, "dialectId" | "backgroundPolicyId" | "basis"> | null;
  /** Test/operator override; production normally leaves deterministic selection alone. */
  wallpaperId?: string;
  shapeByScene?: Readonly<Record<string, EnvironmentShape>>;
  directionScoreByScene?: Readonly<Record<string, number>>;
  /** Additional absolute-time reading/settle windows. */
  settleWindowsByScene?: Readonly<
    Record<string, ReadonlyArray<EnvironmentSettleWindowInput>>
  >;
  /** Primary blocking/read dwells whose screen field must remain visually stable. */
  readingWindowsByScene?: Readonly<
    Record<string, ReadonlyArray<EnvironmentReadingWindowV1>>
  >;
}

export interface EnvironmentInjectionResult {
  html: string;
  injectedScenes: string[];
  skippedScenes: string[];
}

export interface EnvironmentStageResult {
  wallpaperId: string;
  /** Project-relative files suitable for manifest/checkpoint registration. */
  files: string[];
}

const SHAPES: readonly EnvironmentShape[] = [
  "desktop-stage",
  "screen-over-wallpaper",
  "full-app-view",
  "generated-field",
] as const;

function round(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Small dependency-free stable hash; identical across Node versions. */
export function environmentSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function wallpaperPlan(id: string): EnvironmentWallpaperPlanV1 {
  const entry = backgroundById(id);
  if (!entry) throw new Error(`unknown environment wallpaper "${id}"`);
  const basename = path.posix.basename(entry.file);
  return {
    id: entry.id,
    sourceFile: entry.file,
    assetFile: `assets/wallpapers/${basename}` as `assets/wallpapers/${string}.jpg`,
    objectPosition: entry.crop.objectPosition,
    textSafeSide: entry.textSafeSide,
    overlay: {
      mode: entry.overlay.mode,
      opacity: entry.overlay.opacity,
    },
    motion: {
      mode: entry.motion.mode,
      maxTravelPercent: entry.motion.maxTravelPercent,
      maxScale: entry.motion.maxScale,
    },
  };
}

export function selectEnvironmentWallpaper(
  compositionId: string,
  frame?: EnvironmentPlanOptions["frame"],
  wallpaperId?: string,
): EnvironmentWallpaperPlanV1 {
  if (wallpaperId) return wallpaperPlan(wallpaperId);
  const key = [
    compositionId,
    frame?.dialectId ?? "no-dialect",
    frame?.backgroundPolicyId ?? "no-policy",
    frame?.basis ?? "dark",
  ].join("|");
  return wallpaperPlan(BACKGROUND_CATALOG[environmentSeed(key) % BACKGROUND_CATALOG.length]!.id);
}

function sceneDirectionScore(scene: DirectScene): number {
  const moveScore: Record<string, number> = {
    hold: 0.2,
    drift: 0.35,
    pan: 0.58,
    "push-in": 0.58,
    "pull-back": 0.58,
    "track-to-anchor": 0.66,
    "parallax-pass": 0.72,
    "orbit-lite": 0.76,
    orbit: 0.84,
    dive: 0.88,
    whip: 1,
  };
  const path = scene.camera?.path ?? [];
  if (!path.length) return 0.45;
  return path.reduce((score, move) => Math.max(score, moveScore[move.move] ?? 0.45), 0.2);
}

function sceneWords(scene: DirectScene): string {
  return [
    scene.id,
    scene.title,
    scene.purpose,
    scene.foreground,
    scene.background,
    scene.blueprint,
  ].filter(Boolean).join(" ").toLowerCase();
}

function inferShape(scene: DirectScene, index: number, compositionId: string): EnvironmentShape {
  const words = sceneWords(scene);
  if (/\b(desktop|workspace|dock|taskbar|launcher|operating system)\b/.test(words)) {
    return "desktop-stage";
  }
  if (/\b(full[- ]?(?:app|screen|bleed)|immersive app|edge-to-edge app)\b/.test(words)) {
    return "full-app-view";
  }
  if (/\b(screen|browser|app window|modal|dashboard|product ui|interface)\b/.test(words)) {
    return "screen-over-wallpaper";
  }
  if (/\b(abstract|atmosphere|wordmark|logo resolve|title card|end card)\b/.test(words)) {
    return index === 0 ? "screen-over-wallpaper" : "generated-field";
  }
  const seed = environmentSeed(`${compositionId}|${scene.id}|shape`);
  // The first frame always demonstrates the selected production wallpaper.
  if (index === 0) return SHAPES[seed % 3]!;
  return SHAPES[(seed + index) % SHAPES.length]!;
}

function normalizeSettleWindows(
  scene: DirectScene,
  additions: ReadonlyArray<EnvironmentSettleWindowInput> | undefined,
): EnvironmentSettleWindowV1[] {
  const sceneStart = scene.startSec;
  const sceneEnd = scene.startSec + scene.durationSec;
  const windows: EnvironmentSettleWindowV1[] = [];
  const add = (startSec: number, endSec: number, amplitudeScale: number): void => {
    const start = clamp(startSec, sceneStart, sceneEnd);
    const end = clamp(endSec, sceneStart, sceneEnd);
    if (end - start < 0.05) return;
    windows.push({
      startSec: round(start),
      endSec: round(end),
      amplitudeScale: round(clamp(amplitudeScale, 0.08, 0.6)),
    });
  };
  for (const move of scene.camera?.path ?? []) {
    if (move.move === "hold") add(move.startSec, move.startSec + move.durationSec, 0.2);
  }
  for (const window of additions ?? []) {
    add(window.startSec, window.endSec, window.amplitudeScale ?? 0.22);
  }
  // Every cut gets a quiet arrival pose without freezing the environment.
  add(Math.max(sceneStart, sceneEnd - 0.55), sceneEnd, 0.3);
  windows.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const merged: EnvironmentSettleWindowV1[] = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.startSec <= previous.endSec + 0.001) {
      previous.endSec = Math.max(previous.endSec, window.endSec);
      previous.amplitudeScale = Math.min(previous.amplitudeScale, window.amplitudeScale);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function normalizeReadingWindows(
  scene: DirectScene,
  additions: ReadonlyArray<EnvironmentReadingWindowV1> | undefined,
): EnvironmentReadingWindowV1[] {
  const sceneStart = scene.startSec;
  const sceneEnd = scene.startSec + scene.durationSec;
  const windows = (additions ?? []).flatMap((window) => {
    const startSec = round(clamp(window.startSec, sceneStart, sceneEnd));
    const endSec = round(clamp(window.endSec, sceneStart, sceneEnd));
    return endSec - startSec >= 0.05 ? [{ startSec, endSec }] : [];
  }).sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const merged: EnvironmentReadingWindowV1[] = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.startSec <= previous.endSec + 0.001) {
      previous.endSec = Math.max(previous.endSec, window.endSec);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** Pure, deterministic environment plan. No files are touched here. */
export function resolveEnvironmentPlan(
  scenes: readonly DirectScene[],
  options: EnvironmentPlanOptions,
): EnvironmentPlanV1 {
  const basis = options.frame?.basis ?? "dark";
  const wallpaper = selectEnvironmentWallpaper(
    options.compositionId,
    options.frame,
    options.wallpaperId,
  );
  const planScenes = scenes.map((scene, index): EnvironmentScenePlanV1 => {
    const requestedShape = options.shapeByScene?.[scene.id];
    const shape = requestedShape && SHAPES.includes(requestedShape)
      ? requestedShape
      : inferShape(scene, index, options.compositionId);
    const directionScore = clamp(
      options.directionScoreByScene?.[scene.id] ?? sceneDirectionScore(scene),
      0,
      1,
    );
    const seed = environmentSeed(`${options.compositionId}|${scene.id}|ambient`);
    return {
      sceneId: scene.id,
      startSec: round(scene.startSec),
      endSec: round(scene.startSec + scene.durationSec),
      shape,
      basis,
      directionScore: round(directionScore),
      phaseRad: round((seed / 0xffffffff) * Math.PI * 2, 6),
      periodSec: 14 + (seed % 9),
      furnitureMaxPx: round(2 + directionScore * 2),
      lightMaxPx: round(2.5 + directionScore * 1.5),
      settleWindows: normalizeSettleWindows(
        scene,
        options.settleWindowsByScene?.[scene.id],
      ),
      readingWindows: normalizeReadingWindows(
        scene,
        options.readingWindowsByScene?.[scene.id],
      ),
    };
  });
  return {
    version: 1,
    compositionId: options.compositionId,
    frame: {
      ...(options.frame?.dialectId ? { dialectId: options.frame.dialectId } : {}),
      ...(options.frame?.backgroundPolicyId
        ? { backgroundPolicyId: options.frame.backgroundPolicyId }
        : {}),
      basis,
    },
    wallpaper,
    scenes: planScenes,
  };
}

/** Convenience seam for compositionRunner: frame.md remains the authority. */
export function resolveProjectEnvironmentPlan(
  projectDir: string,
  scenes: readonly DirectScene[],
  options: Omit<EnvironmentPlanOptions, "frame">,
): EnvironmentPlanV1 {
  return resolveEnvironmentPlan(scenes, {
    ...options,
    frame: readFrameMeta(projectDir),
  });
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wallpaperMarkup(wallpaper: EnvironmentWallpaperPlanV1, sceneId: string): string {
  // HyperFrames discovers media by src+start. Reusing one literal URL for the
  // same staged wallpaper in several scene-local <img> nodes looks like a
  // duplicate asset even though only one scene is visible. A query fragment
  // keeps the physical asset singular while giving every semantic media node
  // a stable discovery identity; the static server ignores the query.
  const sceneSource = `${wallpaper.assetFile}?seq-scene=${encodeURIComponent(sceneId)}`;
  return [
    '<div class="seq-env__depth" data-depth="0.05">',
    `<img class="seq-env__wallpaper" data-env-wallpaper data-sequences-ambient="wallpaper" src="${escapeAttribute(sceneSource)}" alt="" draggable="false" style="object-position:${escapeAttribute(wallpaper.objectPosition)}">`,
    "</div>",
    `<div class="seq-env__scrim seq-env__scrim--${wallpaper.overlay.mode}" data-env-scrim></div>`,
  ].join("\n");
}

function desktopFurnitureMarkup(): string {
  return [
    '<div class="seq-env__desktop-menubar"><span></span><span></span><span></span></div>',
    '<div class="seq-env__desktop-window seq-env__desktop-window--back" data-env-float data-sequences-ambient="furniture"><i></i><i></i><i></i></div>',
    '<div class="seq-env__desktop-window seq-env__desktop-window--front" data-env-float data-sequences-ambient="furniture"><i></i><i></i><i></i></div>',
    '<div class="seq-env__dock" data-env-float data-sequences-ambient="furniture"><i></i><i></i><i></i><i></i><i></i></div>',
  ].join("\n");
}

function screenPedestalMarkup(kind: "screen" | "app"): string {
  return [
    `<div class="seq-env__pedestal seq-env__pedestal--${kind}">`,
    '  <div class="seq-env__pedestal-chrome"><i></i><i></i><i></i></div>',
    '  <div class="seq-env__pedestal-surface"></div>',
    "</div>",
  ].join("\n");
}

function generatedFieldMarkup(): string {
  return [
    '<div class="seq-env__generated-field"></div>',
    '<div class="seq-env__light seq-env__light--a" data-env-light data-sequences-ambient="light"></div>',
    '<div class="seq-env__light seq-env__light--b" data-env-light data-sequences-ambient="light"></div>',
    '<div class="seq-env__field-card seq-env__field-card--a" data-env-float data-sequences-ambient="furniture"></div>',
    '<div class="seq-env__field-card seq-env__field-card--b" data-env-float data-sequences-ambient="furniture"></div>',
  ].join("\n");
}

export function renderEnvironmentScene(
  scene: EnvironmentScenePlanV1,
  wallpaper: EnvironmentWallpaperPlanV1,
  frame: EnvironmentPlanV1["frame"],
): string {
  const usesWallpaper = scene.shape !== "generated-field";
  const furniture = scene.shape === "desktop-stage"
    ? desktopFurnitureMarkup()
    : scene.shape === "screen-over-wallpaper"
      ? screenPedestalMarkup("screen")
      : scene.shape === "full-app-view"
        ? screenPedestalMarkup("app")
        : generatedFieldMarkup();
  return [
    "<!-- sequences-environment:start -->",
    `<div class="seq-env seq-env--${scene.shape}" data-sequences-environment="${scene.shape}" data-sequences-host="1" data-layout-ignore data-composition-credit="1" data-sequences-ambient="environment" data-env-scene="${escapeAttribute(scene.sceneId)}" data-env-basis="${scene.basis}" data-env-safe-side="${wallpaper.textSafeSide}"${frame.dialectId ? ` data-env-dialect="${escapeAttribute(frame.dialectId)}"` : ""}${frame.backgroundPolicyId ? ` data-env-policy="${escapeAttribute(frame.backgroundPolicyId)}"` : ""} style="--seq-env-scrim-opacity:${round(wallpaper.overlay.opacity, 4)}">`,
    usesWallpaper ? wallpaperMarkup(wallpaper, scene.sceneId) : "",
    furniture,
    usesWallpaper
      ? '<div class="seq-env__light seq-env__light--wallpaper" data-env-light data-sequences-ambient="light"></div>'
      : "",
    "</div>",
    "<!-- sequences-environment:end -->",
  ].filter(Boolean).join("\n");
}

const ENVIRONMENT_BLOCK =
  /(?:\r?\n)?[ \t]*<!--\s*sequences-environment:start\s*-->[\s\S]*?<!--\s*sequences-environment:end\s*-->[ \t]*(?:\r?\n)?/gi;
const ENVIRONMENT_PLAN_BLOCK = new RegExp(
  `<script\\b[^>]*\\bid\\s*=\\s*(["'])${ENVIRONMENT_PLAN_ID}\\1[^>]*>[\\s\\S]*?<\\/script>\\s*`,
  "gi",
);

/** Strip only host-owned environment markup/island; runtime and kit are separate seams. */
export function stripEnvironmentContract(html: string): string {
  return html.replace(ENVIRONMENT_BLOCK, "").replace(ENVIRONMENT_PLAN_BLOCK, "");
}

function sceneOpenTag(html: string, sceneId: string): { index: number; end: number } | null {
  const escaped = sceneId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<[a-z][\\w:-]*\\b[^>]*\\bdata-scene\\s*=\\s*(["'])${escaped}\\1[^>]*>`,
    "i",
  ).exec(html);
  if (!match || match.index === undefined) return null;
  return { index: match.index, end: match.index + match[0].length };
}

export function environmentPlanTag(plan: EnvironmentPlanV1): string {
  const payload = JSON.stringify(plan).replace(/</g, "\\u003c");
  return `<script type="application/json" data-sequences-host="1" id="${ENVIRONMENT_PLAN_ID}">${payload}</script>`;
}

/**
 * Canonical strip-and-reinject pass. Missing authored scene roots degrade to a
 * reported skip; they never cause this visual enhancement to consume a retry.
 */
export function injectEnvironmentContract(
  html: string,
  plan: EnvironmentPlanV1,
): EnvironmentInjectionResult {
  let next = stripEnvironmentContract(html);
  const injectedScenes: string[] = [];
  const skippedScenes: string[] = [];
  for (const scene of plan.scenes) {
    const open = sceneOpenTag(next, scene.sceneId);
    if (!open) {
      skippedScenes.push(scene.sceneId);
      continue;
    }
    const markup = renderEnvironmentScene(scene, plan.wallpaper, plan.frame);
    next = next.slice(0, open.end) + "\n" + markup + "\n" + next.slice(open.end);
    injectedScenes.push(scene.sceneId);
  }
  const tag = environmentPlanTag(plan);
  const bodyClose = /<\/body>/i.exec(next);
  if (bodyClose?.index !== undefined) {
    next = next.slice(0, bodyClose.index) + tag + "\n" + next.slice(bodyClose.index);
  } else {
    next = next.trimEnd() + "\n" + tag + "\n";
  }
  return { html: next, injectedScenes, skippedScenes };
}

export function parseEnvironmentPlan(
  html: string,
): { plan?: EnvironmentPlanV1; errors: string[] } {
  const match = html.match(
    new RegExp(
      `<script\\b[^>]*\\bid\\s*=\\s*(["'])${ENVIRONMENT_PLAN_ID}\\1[^>]*>([\\s\\S]*?)<\\/script>`,
      "i",
    ),
  );
  if (!match) return { errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(match[2]!.trim());
  } catch (error) {
    return {
      errors: [
        `sequences-environment JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["sequences-environment must be an object"] };
  }
  const object = value as Partial<EnvironmentPlanV1>;
  const errors: string[] = [];
  if (object.version !== 1) errors.push("sequences-environment.version must be 1");
  if (typeof object.compositionId !== "string" || !object.compositionId) {
    errors.push("sequences-environment.compositionId must be a non-empty string");
  }
  if (!object.wallpaper || !backgroundById(object.wallpaper.id)) {
    errors.push("sequences-environment.wallpaper must reference a catalog id");
  }
  if (!Array.isArray(object.scenes)) {
    errors.push("sequences-environment.scenes must be an array");
  } else {
    const ids = new Set<string>();
    for (const [index, scene] of object.scenes.entries()) {
      if (!scene || typeof scene.sceneId !== "string" || !scene.sceneId) {
        errors.push(`environment scene[${index}].sceneId must be a non-empty string`);
        continue;
      }
      if (ids.has(scene.sceneId)) errors.push(`environment scene "${scene.sceneId}" is duplicated`);
      ids.add(scene.sceneId);
      if (!SHAPES.includes(scene.shape)) {
        errors.push(`environment scene "${scene.sceneId}" has an unsupported shape`);
      }
    }
  }
  return errors.length ? { errors } : { plan: value as EnvironmentPlanV1, errors: [] };
}

export function environmentRuntimeSource(): string {
  return fs.readFileSync(RUNTIME_SOURCE_PATH, "utf8");
}

export function environmentRuntimeHash(): string {
  return createHash("sha256").update(environmentRuntimeSource()).digest("hex");
}

export function environmentKitSource(): string {
  return fs.readFileSync(KIT_SOURCE_PATH, "utf8");
}

export function environmentKitHash(): string {
  return createHash("sha256").update(environmentKitSource()).digest("hex");
}

export function environmentKitStyleTag(): string {
  return `<style id="${ENVIRONMENT_KIT_STYLE_ID}" data-version="${ENVIRONMENT_KIT_VERSION}">\n${environmentKitSource()}</style>`;
}

const ENVIRONMENT_KIT_BLOCK = new RegExp(
  `<style\\b[^>]*\\bid\\s*=\\s*(["'])${ENVIRONMENT_KIT_STYLE_ID}\\1[^>]*>[\\s\\S]*?<\\/style>`,
  "i",
);

/** Canonical kit injection before authored CSS. */
export function injectEnvironmentKit(html: string): string {
  const tag = environmentKitStyleTag();
  if (ENVIRONMENT_KIT_BLOCK.test(html)) {
    return html.replace(ENVIRONMENT_KIT_BLOCK, tag.replace(/\$/g, "$$$$"));
  }
  const style = /<style\b/i.exec(html);
  if (style?.index !== undefined) {
    return html.slice(0, style.index) + tag + "\n" + html.slice(style.index);
  }
  const headClose = /<\/head>/i.exec(html);
  if (headClose?.index !== undefined) {
    return html.slice(0, headClose.index) + tag + "\n" + html.slice(headClose.index);
  }
  return html;
}

/** Runtime load tag only; root integration owns compile ordering. */
export function injectEnvironmentRuntimeTag(html: string): string {
  if (
    html.includes(`src="${ENVIRONMENT_RUNTIME_FILE}"`) ||
    html.includes(`src='${ENVIRONMENT_RUNTIME_FILE}'`)
  ) {
    return html;
  }
  return html.replace(
    /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
    `$1\n<script src="${ENVIRONMENT_RUNTIME_FILE}"></script>`,
  );
}

/** Bind the living-canvas runtime to the authored paused master timeline. */
export function injectEnvironmentRuntimeCall(html: string): string {
  if (/\bSequencesEnvironment\.compile\s*\(/.test(html)) return html;
  const timelineName = html.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
  )?.[1];
  if (!timelineName) return html;
  const escaped = timelineName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const registration = new RegExp(
    `((?:var\\s+__seqWarped\\s*=\\s*SequencesTime\\.wrap\\(${escaped}\\);\\s*)?` +
      `window\\.__timelines\\s*\\[[^\\]]+\\]\\s*=\\s*(?:${escaped}|__seqWarped)\\s*;)`,
  );
  return html.replace(
    registration,
    `SequencesEnvironment.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
  );
}

/**
 * Copy only the film's selected JPEG plus its license notice. Catalog lookup,
 * rather than serialized paths, is the path authority.
 */
export function stageEnvironmentAssets(
  projectDir: string,
  plan: EnvironmentPlanV1,
): EnvironmentStageResult {
  const entry = backgroundById(plan.wallpaper.id);
  if (!entry) throw new Error(`cannot stage unknown environment wallpaper "${plan.wallpaper.id}"`);
  const source = path.join(APP_ROOT, ...entry.file.split("/"));
  const licenseSource = path.join(WALLPAPERS_ROOT, WALLPAPER_LICENSE_FILE);
  if (!fs.existsSync(source)) throw new Error(`environment wallpaper source is missing: ${entry.file}`);
  if (!fs.existsSync(licenseSource)) throw new Error("environment wallpaper LICENSE is missing");
  const targetDir = path.join(path.resolve(projectDir), "assets", "wallpapers");
  fs.mkdirSync(targetDir, { recursive: true });
  const basename = path.basename(source);
  fs.copyFileSync(source, path.join(targetDir, basename));
  fs.copyFileSync(licenseSource, path.join(targetDir, WALLPAPER_LICENSE_FILE));
  return {
    wallpaperId: entry.id,
    files: [
      `assets/wallpapers/${basename}`,
      `assets/wallpapers/${WALLPAPER_LICENSE_FILE}`,
    ],
  };
}
