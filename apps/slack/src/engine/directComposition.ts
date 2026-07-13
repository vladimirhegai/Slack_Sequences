/**
 * Canonical direct-HyperFrames authoring store and deterministic publication
 * gate. Authored HTML is kept separate from derived thumbnails/renders while
 * the legacy project.json remains available for the curated demo path.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  lintHyperframeHtml,
  type HyperframeLintFinding,
} from "@hyperframes/core";
import type { RenderQuality, SupersamplePlan } from "./render.ts";
import {
  downscaleSupersampledRender,
  ensureFfmpegOnPath,
  findBrowserExecutable,
  renderProducerOverrides,
  resolveSupersamplePlan,
  supersampleJobFields,
} from "./render.ts";
import { inspectDirectComposition } from "./layoutInspector.ts";
import { launchHeadlessBrowser } from "./browserLifecycle.ts";
import {
  type InteractionIntentV1,
  type SpatialIntentV1,
} from "./interactionContract.ts";
import {
  resolveCutPlan,
  type SceneCutIntentV1,
} from "./cutContract.ts";
import {
  resolveCameraPlan,
  type SceneCameraIntentV1,
} from "./cameraContract.ts";
import {
  continuityGraphEnabled,
  resolveContinuityGraph,
  type SceneContinuityAppearanceV1,
} from "./continuityGraph.ts";
import {
  HOST_CONTRACTS,
  hostContract,
  runHostContractLifecycle,
} from "./hostContract.ts";
import { resolveCameraBlockingPlan } from "./cameraBlocking.ts";
import {
  parseEnvironmentPlan,
} from "./environmentContract.ts";
import {
  parseTimeRampPlan,
  resolveTimeRampPlan,
  type SceneTimeRampIntentV1,
} from "./timeRamp.ts";
import { sourceTime, timeConversionService } from "./time.ts";
import type { SceneGradeShiftV1 } from "./gradeShift.ts";
import {
  resolveComponentPlan,
  type ComponentBeatIntentV1,
  type ComponentEntranceFamily,
  type SceneComponentSpecV1,
} from "./componentContract.ts";
import {
  validateRecipeContract,
  type RecipeDeclarationV1,
} from "./recipeContract.ts";
import {
  validatePluginContract,
  type PluginDeclarationV1,
} from "./pluginContract.ts";
import { validateCompositionAgainstFrame } from "./frameValidation.ts";
import { auditKitMarkupCompleteness } from "./kitMarkupAudit.ts";
import { auditDeadGsapDataflow } from "./deadTweenRepair.ts";
import {
  validateMotionDensity,
  type MotionDensityReport,
} from "./motionDensity.ts";
import {
  resolveMomentContract,
  type StoryboardMomentV1,
} from "./storyboardMoments.ts";
import {
  directionScoreConsumersEnabled,
  resolveFilmDirectionScore,
} from "./directionScore.ts";

const DIRECT_DIR = "composition";
const MANIFEST_FILE = "manifest.json";
const REVISIONS_DIR = "revisions";
const MAX_SOURCE_CHARS = 500_000;

/**
 * One camera station pinned to a viewport-sized grid cell of the scene's
 * data-camera-world plane. `[0,0]` is the entry framing; `[1,0]` is one full
 * viewport to the right, `[0,-1]` one up. Declared by the storyboard for
 * multi-station shots so the author receives deterministic pixel rects
 * instead of free placement (the source of clipping/off-camera stations).
 */
export interface WorldLayoutCellV1 {
  region: string;
  cell: [number, number];
  /**
   * Host-derived station-box scale. Browser-measured sparse landings may
   * tighten a viewport-sized cell around a small content union so the camera's
   * ordinary fit operation lands composed. Kept bounded and optional for
   * replay compatibility; authors never need to choose it.
   */
  fitScale?: number;
}

export interface LayoutRepairRectV1 {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Host-only deterministic layout repair. This is never requested from the
 * author model; `applyDeterministicSourceRepairs` materializes it as CSS after
 * browser QA proves the measured geometry can be corrected safely.
 */
export interface SceneLayoutRepairV1 {
  version: 1;
  id: string;
  kind: "overflow-clamp";
  selector: string;
  issueCode: "canvas_overflow" | "important_safe_area" | "load_bearing_containment";
  dx: number;
  dy: number;
  scale: number;
  origin: "center center";
  before: {
    rect: LayoutRepairRectV1;
    safeRect: LayoutRepairRectV1;
  };
}

export interface DirectScene {
  id: string;
  title: string;
  purpose: string;
  incomingIdea?: string;
  foreground?: string;
  background?: string;
  cameraIntent?: string;
  continuityAnchor?: string;
  /** Stable product-object representations carried into the continuity graph. */
  continuity?: SceneContinuityAppearanceV1[];
  startSec: number;
  durationSec: number;
  blueprint?: string;
  rules?: string[];
  capabilityIds?: string[];
  outgoingCut?: string;
  /** One host-budgeted oversized display-type moment for the whole film. */
  displayType?: {
    version: 1;
    kind: "ghost-word";
    text: string;
    atSec: number;
    /** Optional part whose scale/hierarchy this display type supports. */
    focalPart?: string;
  };
  /** Typed, mechanically executable form of outgoingCut (this scene's boundary). */
  cut?: SceneCutIntentV1;
  /** Typed camera path over this scene's data-camera-world plane. */
  camera?: SceneCameraIntentV1;
  /** Typed net-zero speed-ramp dip inside this scene (time remapping). */
  timeRamp?: SceneTimeRampIntentV1;
  /** Typed mid-scene animated grade shift (background temperature turn). */
  gradeShift?: SceneGradeShiftV1;
  /** Optional station map: which data-region sits in which world grid cell. */
  worldLayout?: WorldLayoutCellV1[];
  /** Declared motion-native components (each authored as one data-part element). */
  components?: SceneComponentSpecV1[];
  /** One host-compiled root-entrance grammar for this scene's free components. */
  componentEntranceFamily?: ComponentEntranceFamily;
  /** Typed state-change beats on declared components (times are absolute). */
  beats?: ComponentBeatIntentV1[];
  /**
   * Declared library recipes (Recipe Studio, Level-1 host instantiation):
   * the host injects each recipe's proven fragment verbatim with these param
   * values — the author model never owns the mechanism.
   */
  recipes?: RecipeDeclarationV1[];
  /**
   * Declared host plugins (seventh contract): typed generator forms the host
   * lowered into this scene's components/beats at parse and injects as one
   * verbatim markup unit per declaration — the author model never owns them.
   */
  plugins?: PluginDeclarationV1[];
  /**
   * Part names whose free component declarations the plugin reconciler
   * absorbed as duplicates of a declared plugin unit. The injector hides any
   * author-drawn markup still carrying these parts (the plugin-live-1 lesson:
   * the storyboard-level absorber can't stop the source author hand-drawing
   * the same content beside the injected unit).
   */
  pluginAbsorbedParts?: string[];
  spatialIntent?: SpatialIntentV1;
  interactions?: InteractionIntentV1[];
  /** Ordered reviewable changed states this scene promises (the moment contract). */
  moments?: StoryboardMomentV1[];
  /** Host-only deterministic layout repairs, stripped from author prompts. */
  layoutRepairs?: SceneLayoutRepairV1[];
  /**
   * Host-applied Sentinel normalization notes (delete/degrade/retime fixes the
   * host made to this scene at parse — never model-authored). Rendered in
   * STORYBOARD.md so every normalization stays visible (SENTINEL_PLAN §3
   * Phase 3.1); stripped from the author prompt.
   */
  sentinelNormalizations?: string[];
}

export interface DirectCompositionDraft {
  html: string;
  storyboard: DirectScene[];
}

export interface DirectCompositionManifest {
  version: 1;
  mode: "hyperframes-direct";
  title: string;
  compositionId: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  revision: number;
  createdAt: string;
  sourceHash: string;
  provenance: {
    source: "agent";
    operation: "create" | "revise";
    previousRevision: number | null;
  };
  qa?: {
    browserValidated: boolean;
    layoutSamples: number;
    warningCount: number;
    interactionCount?: number;
    interactionRuntime?: {
      version: number;
      sha256: string;
    };
  };
  scenes: DirectScene[];
}

export interface DirectValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  frameErrors: string[];
  frameWarnings: string[];
  /** Blocking liveness/moment findings (also included in errors). */
  motionErrors: string[];
  /** Advisory motion findings — repair hints, never a veto. */
  motionWarnings: string[];
  motionReport?: MotionDensityReport;
  /** Evidence-bound storyboard moments (declared or synthesized). */
  moments: StoryboardMomentV1[];
  findings: HyperframeLintFinding[];
  compositionId?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface DirectThumbsResult {
  files: Record<string, string>;
  elapsedMs: number;
}

export interface DirectRenderResult {
  outputPath: string;
  durationSec: number;
  elapsedMs: number;
}

interface ProducerModule {
  createConsoleLogger?: (level: "info") => unknown;
  createRenderJob: (config: Record<string, unknown>) => unknown;
  executeRenderJob: (
    job: unknown,
    projectDir: string,
    outputPath: string,
    onProgress?: (job: { progress: number }, message: string) => void,
  ) => Promise<void>;
  resolveConfig: (config: Record<string, unknown>) => unknown;
}

function compositionDir(projectDir: string): string {
  return path.join(path.resolve(projectDir), DIRECT_DIR);
}

function manifestPath(projectDir: string): string {
  return path.join(compositionDir(projectDir), MANIFEST_FILE);
}

function revisionsDir(projectDir: string): string {
  return path.join(path.resolve(projectDir), REVISIONS_DIR);
}

export function hasDirectComposition(projectDir: string): boolean {
  return fs.existsSync(path.join(compositionDir(projectDir), "index.html")) &&
    fs.existsSync(manifestPath(projectDir));
}

export function loadDirectComposition(projectDir: string): {
  html: string;
  manifest: DirectCompositionManifest;
} {
  if (!hasDirectComposition(projectDir)) {
    throw new Error(`no direct HyperFrames composition in ${projectDir}`);
  }
  return {
    html: fs.readFileSync(path.join(compositionDir(projectDir), "index.html"), "utf8"),
    manifest: JSON.parse(
      fs.readFileSync(manifestPath(projectDir), "utf8"),
    ) as DirectCompositionManifest,
  };
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rootTag(html: string): string | undefined {
  return html.match(/<[^>]+\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/is)?.[0];
}

function sceneTags(html: string): string[] {
  return [...html.matchAll(/<([a-z][\w:-]*)\b[^>]*\bdata-scene(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/gis)]
    .map((match) => match[0]);
}

// Inline SVG patterns (e.g. Hero-Patterns backgrounds) arrive as `data:` URIs and
// are self-contained, deterministic, and offline-safe — they are NOT local files.
// A nested or backslash-escaped quote can leave a stray `"`/`'`/`\` clinging to the
// captured value, which defeats a bare `startsWith("data:")` skip, so strip any
// wrapping quote/backslash/whitespace before classifying the reference.
function unwrapRef(value: string): string {
  return value.trim().replace(/^[\s"'\\]+/, "").replace(/[\s"'\\]+$/, "");
}

function isInlineDataUri(value: string): boolean {
  return /^data:/i.test(unwrapRef(value));
}

function referencedLocalPaths(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) {
    const value = unwrapRef(match[2]!);
    if (!value || value.startsWith("#") || isInlineDataUri(value)) continue;
    refs.push(value.split(/[?#]/, 1)[0]!);
  }
  for (const match of html.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const value = unwrapRef(match[2]!);
    if (!value || isInlineDataUri(value)) continue;
    refs.push(value.split(/[?#]/, 1)[0]!);
  }
  return [...new Set(refs)];
}

function normalizeStoryboard(
  storyboard: DirectScene[],
  html: string,
): { scenes: DirectScene[]; errors: string[] } {
  const errors: string[] = [];
  const tags = sceneTags(html);
  const byId = new Map(storyboard.map((scene) => [scene.id, scene]));
  const scenes = tags.map((tag, index): DirectScene => {
    const elementId = attr(tag, "id")?.trim() ?? "";
    const id = attr(tag, "data-scene")?.trim() ?? "";
    const startSec = finiteNumber(attr(tag, "data-start"));
    const durationSec = finiteNumber(attr(tag, "data-duration"));
    if (!elementId) errors.push(`scene ${index + 1} is missing a stable id`);
    if (!id) errors.push(`scene ${index + 1} is missing a data-scene binding`);
    if (startSec === undefined || startSec < 0) errors.push(`scene "${id || index + 1}" has invalid data-start`);
    if (durationSec === undefined || durationSec <= 0) errors.push(`scene "${id || index + 1}" has invalid data-duration`);
    const proposed = byId.get(id);
    if (!proposed) errors.push(`scene "${id}" is missing from storyboard_json`);
    if (proposed && (
      Math.abs(proposed.startSec - (startSec ?? 0)) > 0.01 ||
      Math.abs(proposed.durationSec - (durationSec ?? 0)) > 0.01
    )) {
      errors.push(`storyboard timing for "${id}" does not match its HTML scene window`);
    }
    return {
      id,
      title: proposed?.title?.trim() || `Scene ${index + 1}`,
      purpose: proposed?.purpose?.trim() || "Advance the launch story",
      ...(proposed?.incomingIdea ? { incomingIdea: proposed.incomingIdea } : {}),
      ...(proposed?.foreground ? { foreground: proposed.foreground } : {}),
      ...(proposed?.background ? { background: proposed.background } : {}),
      ...(proposed?.cameraIntent ? { cameraIntent: proposed.cameraIntent } : {}),
      ...(proposed?.continuityAnchor
        ? { continuityAnchor: proposed.continuityAnchor }
        : {}),
      ...(proposed?.continuity?.length ? { continuity: proposed.continuity } : {}),
      startSec: startSec ?? 0,
      durationSec: durationSec ?? 0,
      ...(proposed?.blueprint ? { blueprint: proposed.blueprint } : {}),
      ...(proposed?.rules?.length ? { rules: proposed.rules } : {}),
      ...(proposed?.capabilityIds?.length ? { capabilityIds: proposed.capabilityIds } : {}),
      ...(proposed?.outgoingCut ? { outgoingCut: proposed.outgoingCut } : {}),
      ...(proposed?.displayType?.version === 1 &&
          proposed.displayType.kind === "ghost-word" &&
          typeof proposed.displayType.text === "string" &&
          Number.isFinite(proposed.displayType.atSec)
        ? {
            displayType: {
              version: 1 as const,
              kind: "ghost-word" as const,
              text: proposed.displayType.text.trim().slice(0, 40),
              atSec: proposed.displayType.atSec,
              ...(proposed.displayType.focalPart?.trim()
                ? { focalPart: proposed.displayType.focalPart.trim() }
                : {}),
            },
          }
        : {}),
      ...(proposed?.cut ? { cut: proposed.cut } : {}),
      ...(proposed?.camera ? { camera: proposed.camera } : {}),
      ...(proposed?.worldLayout?.length ? { worldLayout: proposed.worldLayout } : {}),
      ...(proposed?.timeRamp ? { timeRamp: proposed.timeRamp } : {}),
      ...(proposed?.gradeShift ? { gradeShift: proposed.gradeShift } : {}),
      ...(proposed?.components?.length ? { components: proposed.components } : {}),
      ...(proposed?.componentEntranceFamily
        ? { componentEntranceFamily: proposed.componentEntranceFamily }
        : {}),
      ...(proposed?.beats?.length ? { beats: proposed.beats } : {}),
      ...(proposed?.recipes?.length ? { recipes: proposed.recipes } : {}),
      ...(proposed?.plugins?.length ? { plugins: proposed.plugins } : {}),
      ...(proposed?.spatialIntent ? { spatialIntent: proposed.spatialIntent } : {}),
      ...(proposed?.interactions?.length ? { interactions: proposed.interactions } : {}),
      ...(proposed?.moments?.length ? { moments: proposed.moments } : {}),
      ...(proposed?.layoutRepairs?.length ? { layoutRepairs: proposed.layoutRepairs } : {}),
      ...(proposed?.sentinelNormalizations?.length
        ? { sentinelNormalizations: proposed.sentinelNormalizations }
        : {}),
    };
  });
  if (tags.length < 2) errors.push("composition needs at least two elements marked data-scene");
  if (storyboard.length !== tags.length) {
    errors.push(`storyboard has ${storyboard.length} scenes but HTML declares ${tags.length}`);
  }
  return { scenes, errors };
}

/**
 * Does the source create a paused `gsap.timeline({ … paused: true … })`?
 *
 * A prior gate used `gsap\.timeline\(\s*\{[^}]*paused\s*:\s*true`, whose
 * `[^}]*` terminates at the first `}` — so a valid config with a nested object
 * before `paused`, e.g. `gsap.timeline({ defaults: { ease: "none" }, paused:
 * true })`, false-rejected a correct composition (SENTINEL.md fallback
 * incident). This scans the timeline's config object with brace balancing so
 * arbitrary nesting is handled; `paused: true` anywhere inside that object
 * (top-level in practice) satisfies the invariant.
 */
export function hasPausedTimeline(html: string): boolean {
  const callPattern = /gsap\.timeline\s*\(\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(html)) !== null) {
    const braceStart = match.index + match[0].length - 1; // index of the `{`
    let depth = 0;
    for (let i = braceStart; i < html.length; i += 1) {
      const ch = html[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          if (/\bpaused\s*:\s*true\b/.test(html.slice(braceStart, i + 1))) return true;
          break;
        }
      }
    }
  }
  return false;
}

function invariantErrors(
  html: string,
  durationSec: number | undefined,
  compositionId: string | undefined,
): string[] {
  const errors: string[] = [];
  const forbidden: Array<[RegExp, string]> = [
    [
      /(?:\b(?:src|href)\s*=\s*(["'])(?:https?:)?\/\/.*?\1|url\(\s*(["']?)(?:https?:)?\/\/|@import\s+(?:url\()?\s*(["']?)(?:https?:)?\/\/)/i,
      "network URLs are not allowed; use project-local assets",
    ],
    [/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/, "render-time network calls are not allowed"],
    [/\b(?:Date\.now|new\s+Date|performance\.now)\s*\(/, "wall-clock time is not seek-safe"],
    [/\bMath\.random\s*\(/, "Math.random is not deterministic"],
    [/\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/, "timer-driven visual state is not seek-safe"],
    [/\brepeat\s*:\s*-1\b/, "infinite repeats are not finite timelines"],
    [/\.play\s*\(/, "render-critical timelines must stay paused"],
    [
      /(?:\.(?:to|from|fromTo|set)|gsap\.(?:to|from|fromTo|set))\s*\([^;]{0,1000}\b(?:display|visibility)\s*:/is,
      "do not animate display/visibility; use scene windows and opacity",
    ],
  ];
  for (const [pattern, message] of forbidden) {
    if (pattern.test(html)) errors.push(message);
  }
  if (!/<!doctype\s+html/i.test(html) || !/<html\b/i.test(html) || !/<body\b/i.test(html)) {
    errors.push("index_html must be a complete HTML document");
  }
  if (!/<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\1[^>]*>\s*<\/script>/i.test(html)) {
    errors.push('load the host-provided GSAP exactly as <script src="gsap.min.js"></script>');
  }
  if (!hasPausedTimeline(html)) {
    errors.push("create one synchronous gsap.timeline({ paused: true })");
  }
  if (compositionId) {
    const escaped = compositionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const literalRegistration = new RegExp(
      `window\\.__timelines\\s*\\[\\s*(["'])${escaped}\\1\\s*\\]\\s*=`,
      "s",
    ).test(html);
    const boundIds = [...html.matchAll(
      new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(["'])${escaped}\\2\\s*;?`,
        "g",
      ),
    )].map((match) => match[1]!);
    const boundRegistration = boundIds.some((name) =>
      new RegExp(
        `window\\.__timelines\\s*\\[\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]\\s*=`,
        "s",
      ).test(html)
    );
    if (!literalRegistration && !boundRegistration) {
      errors.push(`register the paused timeline as window.__timelines["${compositionId}"]`);
    }
  }
  if (durationSec === undefined || durationSec < 6 || durationSec > 60) {
    errors.push("root data-duration must be a finite value from 6 to 60 seconds");
  }
  return errors;
}

/** Overlaps shorter than this are floating-point artifacts, not authoring bugs. */
const CLIP_OVERLAP_EPSILON_SEC = 0.001;

/**
 * True when an `overlapping_clips_same_track` finding reports a sub-epsilon
 * overlap — the linter's `data-start + data-duration` sum picking up IEEE-754
 * noise on contiguous scene windows (e.g. 7.4 + 4.2 = 11.600000000000001).
 * The finding message carries both timestamps at full precision, so the
 * artifact is detectable without re-parsing the document.
 */
export function isFloatingPointClipOverlap(finding: HyperframeLintFinding): boolean {
  if (finding.code !== "overlapping_clips_same_track") return false;
  const match = finding.message.match(
    /ending at ([\d.eE+-]+)s overlaps with clip starting at ([\d.eE+-]+)s/,
  );
  if (!match) return false;
  const end = Number(match[1]);
  const start = Number(match[2]);
  return Number.isFinite(end) && Number.isFinite(start) &&
    end - start < CLIP_OVERLAP_EPSILON_SEC;
}

/**
 * The pinned GSAP linter also compares floating-point tween endpoints with no
 * epsilon. Its message rounds both overlap timestamps to centiseconds, so a
 * contiguous `13.3 + 0.4 -> 13.7` pair is reported as overlapping from
 * `13.70s` to `13.70s`. Equal displayed endpoints prove the alleged overlap
 * is below the linter's own 10ms reporting precision and therefore below one
 * rendered frame; keep every warning with a measurable displayed interval.
 */
export function isFloatingPointGsapTweenOverlap(
  finding: HyperframeLintFinding,
): boolean {
  if (finding.code !== "overlapping_gsap_tweens") return false;
  const match = finding.message.match(/between ([\d.eE+-]+)s and ([\d.eE+-]+)s/);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isFinite(start) && Number.isFinite(end) && end === start;
}

/**
 * True when a `font_family_without_font_face` finding names only var()-split
 * artifacts. The pinned linter splits `font-family` stacks on commas, so the
 * kit CSS's token indirection (`font-family: var(--font-display, inherit)`)
 * fabricates "families" like `var(--font-display` and `inherit)` — never real
 * font names (real families never carry parentheses). A finding that still
 * names at least one paren-free family is a genuine missing font and is kept.
 */
export function isCssVarFontFamilyArtifact(finding: HyperframeLintFinding): boolean {
  if (finding.code !== "font_family_without_font_face") return false;
  const list = finding.message.match(/@font-face declaration:\s*(.+?)\.\s/)?.[1];
  if (!list) return false;
  const families = list.split(/,\s*/).map((token: string) => token.trim()).filter(Boolean);
  return families.length > 0 &&
    families.every((token: string) => token.includes("(") || token.includes(")"));
}

export async function validateDirectComposition(
  projectDir: string,
  draft: DirectCompositionDraft,
): Promise<DirectValidationResult> {
  const html = draft.html.trim();
  const errors: string[] = [];
  if (!html) errors.push("index_html is empty");
  if (html.length > MAX_SOURCE_CHARS) errors.push(`index_html exceeds ${MAX_SOURCE_CHARS} characters`);

  const root = rootTag(html);
  const compositionId = root ? attr(root, "data-composition-id") : undefined;
  const width = root ? finiteNumber(attr(root, "data-width")) : undefined;
  const height = root ? finiteNumber(attr(root, "data-height")) : undefined;
  const durationSec = root ? finiteNumber(attr(root, "data-duration")) : undefined;
  if (!root) errors.push("missing root data-composition-id element");
  if (!compositionId) errors.push("root composition id is missing");
  if (!width || !height || width < 320 || height < 320 || width > 4096 || height > 4096) {
    errors.push("root data-width/data-height must be finite canvas dimensions");
  }
  errors.push(...invariantErrors(html, durationSec, compositionId));

  const normalized = normalizeStoryboard(draft.storyboard, html);
  errors.push(...normalized.errors);
  if (durationSec !== undefined) {
    for (const scene of normalized.scenes) {
      if (scene.startSec + scene.durationSec > durationSec + 0.01) {
        errors.push(`scene "${scene.id}" extends past the ${durationSec}s composition`);
      }
    }
  }
  // WS-F3: every host-owned contract follows one parse/validate lifecycle.
  // This id order preserves the legacy finding order byte-for-byte; runtime
  // staging has its own registry order and remains independent.
  const hostContractWarnings: string[] = [];
  for (const id of [
    "interaction",
    "cut",
    "camera",
    "time",
    "component",
    "fx",
  ] as const) {
    const { validation } = runHostContractLifecycle(id, {
      html,
      scenes: normalized.scenes,
      ...(durationSec !== undefined ? { durationSec } : {}),
    });
    errors.push(...validation.findings);
    if (id === "cut" || id === "camera" || id === "time" || id === "component") {
      hostContractWarnings.push(...validation.warnings);
    }
  }
  // Recipe islands are host-injected from the library (Level-1
  // instantiation); like fx, these errors are host-plumbing self-checks —
  // reachable only if the injection seam breaks.
  const recipeValidation = validateRecipeContract(html, normalized.scenes);
  errors.push(...recipeValidation.errors);
  // Plugin units are host-injected from the catalog (lowered typed forms);
  // like recipes, these errors are host-plumbing self-checks.
  const pluginValidation = validatePluginContract(html, normalized.scenes);
  errors.push(...pluginValidation.errors);
  for (const id of ["asset", "environment", "continuity"] as const) {
    const { validation } = runHostContractLifecycle(id, {
      html,
      scenes: normalized.scenes,
      ...(durationSec !== undefined ? { durationSec } : {}),
    });
    errors.push(...validation.findings);
  }
  // Bind failures abort the whole browser compile behind an opaque timeout;
  // re-run the runtimes' bind queries against a parsed DOM here so they
  // surface as named findings the repair loop can act on.
  const kitMarkupAudit = auditKitMarkupCompleteness(html, normalized.scenes);
  errors.push(...kitMarkupAudit.errors);
  // L3 catches the shallow query-result -> GSAP-target dataflow before a
  // browser ever evaluates a null target or an invalid pseudo-element target.
  errors.push(...auditDeadGsapDataflow(html).findings);
  const motionValidation = validateMotionDensity(
    html,
    normalized.scenes,
    durationSec,
  );
  // Liveness is a publication contract: a film that goes dead or reads as a
  // slide deck is rejected, not merely warned about.
  errors.push(...motionValidation.errors);
  const momentContract = resolveMomentContract(
    html,
    normalized.scenes,
    durationSec,
    motionValidation.report,
  );
  errors.push(...momentContract.errors);

  const rootDir = compositionDir(projectDir);
  for (const ref of referencedLocalPaths(html)) {
    if (isInlineDataUri(ref)) continue; // self-contained inline data: URI, not a file
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) {
      errors.push(`asset reference must be local: ${ref}`);
      continue;
    }
    const resolved = path.resolve(rootDir, ref);
    if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
      errors.push(`asset reference escapes the composition: ${ref}`);
      continue;
    }
    if (
      ref !== "gsap.min.js" &&
      !HOST_CONTRACTS.some((contract) => contract.file === ref) &&
      !fs.existsSync(resolved)
    ) {
      const staged = path.resolve(projectDir, ref);
      if (!fs.existsSync(staged)) errors.push(`referenced local asset does not exist: ${ref}`);
    }
  }

  // The pinned linter compares clip end (data-start + data-duration, summed
  // in floating point) against the next clip's start with zero tolerance, so
  // contiguous storyboard windows like 7.4s + 4.2s "overlap" the 11.6s scene
  // by 1e-15s and burn the whole bounded repair loop on a phantom the model
  // cannot see. A sub-millisecond overlap is unrenderable and unfixable —
  // drop it before it reaches the gate (2026-07-03 live-create incident).
  let findings: HyperframeLintFinding[] = [];
  try {
    const lint = await lintHyperframeHtml(html, { filePath: "index.html" });
    findings = lint.findings.filter(
      (finding: HyperframeLintFinding) =>
        !isFloatingPointClipOverlap(finding) &&
        !isFloatingPointGsapTweenOverlap(finding) &&
        !isCssVarFontFamilyArtifact(finding),
    );
    errors.push(...findings
      .filter((finding: HyperframeLintFinding) => finding.severity === "error")
      .map((finding: HyperframeLintFinding) => `${finding.code}: ${finding.message}`));
  } catch (error) {
    errors.push(`HyperFrames lint failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const frameFile = path.join(path.resolve(projectDir), "frame.md");
  const frameValidation = fs.existsSync(frameFile)
    ? validateCompositionAgainstFrame(html, fs.readFileSync(frameFile, "utf8"))
    : { errors: [], warnings: [] };
  errors.push(...frameValidation.errors);

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set([
      ...findings
      .filter((finding) => finding.severity === "warning")
      .map((finding) => `${finding.code}: ${finding.message}`),
      ...frameValidation.warnings,
      ...hostContractWarnings,
      ...recipeValidation.warnings,
      ...kitMarkupAudit.warnings,
      ...motionValidation.warnings,
      ...momentContract.warnings,
    ])],
    frameErrors: frameValidation.errors,
    frameWarnings: frameValidation.warnings,
    motionErrors: [...new Set([...motionValidation.errors, ...momentContract.errors])],
    motionWarnings: [...new Set([...motionValidation.warnings, ...momentContract.warnings])],
    ...(motionValidation.report ? { motionReport: motionValidation.report } : {}),
    moments: momentContract.moments,
    findings,
    compositionId,
    width,
    height,
    durationSec,
  };
}

function copyRuntimeAndAssets(projectDir: string, targetDir: string): void {
  const require = createRequire(import.meta.url);
  fs.copyFileSync(
    require.resolve("gsap/dist/gsap.min.js"),
    path.join(targetDir, "gsap.min.js"),
  );
  for (const contract of HOST_CONTRACTS) {
    fs.writeFileSync(
      path.join(targetDir, contract.file),
      contract.source(),
      "utf8",
    );
  }
  const sourceAssets = path.join(projectDir, "assets");
  if (fs.existsSync(sourceAssets)) {
    fs.cpSync(sourceAssets, path.join(targetDir, "assets"), { recursive: true });
  }
}

function revisionName(revision: number): string {
  return String(revision).padStart(4, "0");
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function storyboardMarkdown(title: string, scenes: DirectScene[]): string {
  const directionByScene = new Map(
    resolveFilmDirectionScore(scenes).scenes.map((scene) => [scene.sceneId, scene]),
  );
  return [
    `# STORYBOARD.md — ${title}`,
    "",
    ...scenes.flatMap((scene, index) => [
      `## ${index + 1}. ${scene.title} (${scene.startSec.toFixed(1)}–${
        (scene.startSec + scene.durationSec).toFixed(1)
      }s)`,
      "",
      scene.purpose,
      "",
      scene.incomingIdea ? `- Incoming idea: ${scene.incomingIdea}` : "",
      scene.foreground ? `- Foreground: ${scene.foreground}` : "",
      scene.background ? `- Background: ${scene.background}` : "",
      scene.cameraIntent ? `- Camera: ${scene.cameraIntent}` : "",
      scene.capabilityIds?.length
        ? `- Capabilities: ${scene.capabilityIds.join(", ")}`
        : "",
      scene.continuityAnchor ? `- Eye trace: ${scene.continuityAnchor}` : "",
      scene.outgoingCut ? `- Outgoing cut: ${scene.outgoingCut}` : "",
      scene.cut
        ? `- Executable cut: ${scene.cut.style}${
          scene.cut.style === "object-match" || scene.cut.style === "shape-match"
            ? ` (${scene.cut.focalPartOut} → ${scene.cut.focalPartIn})`
            : ""
        }`
        : "",
      scene.camera?.path.length
        ? `- Camera path: ${scene.camera.path
          .map((move) => `${move.move}${move.toPart ? `→${move.toPart}` : move.toRegion ? `→${move.toRegion}` : ""}`)
          .join(", ")}`
        : "",
      directionByScene.get(scene.id)?.phrases.length
        ? `- Direction: ${directionByScene.get(scene.id)!.entryRelationship} entry · ${
          directionByScene.get(scene.id)!.phrases.map((phrase) =>
            `${phrase.role}:${phrase.dominant.system}${
              phrase.attention?.part
                ? `→${phrase.attention.part}`
                : phrase.attention?.region
                  ? `→${phrase.attention.region}`
                  : phrase.attention?.selector
                    ? `→${phrase.attention.selector}`
                    : ""
            }`
          ).join(", ")
        }`
        : "",
      scene.timeRamp
        ? `- Speed ramp: dip to ${scene.timeRamp.slowTo}× at ${scene.timeRamp.atSec.toFixed(2)}s` +
          ` (net-zero inside the shot)`
        : "",
      ...(scene.sentinelNormalizations ?? []).map((note) => `- Sentinel normalized: ${note}`),
      ...(scene.plugins ?? []).map((declaration) => {
        const details = Object.entries(declaration.params).map(
          ([name, value]) => `${name}=${value}`,
        );
        if (declaration.region) details.push(`station=${declaration.region}`);
        return (
          `- plugin: ${declaration.kind} "${declaration.id}"` +
          `${details.length ? ` (${details.join(", ")})` : ""} — host-generated`
        );
      }),
      scene.components?.length
        ? `- Components: ${scene.components
          .map((component) => `${component.id} (${component.kind})`)
          .join(", ")}`
        : "",
      ...(scene.beats ?? []).map((beat) =>
        `- Beat: ${beat.kind} on ${beat.component} @ ${beat.atSec.toFixed(2)}s` +
        `${beat.morphTo ? ` → ${beat.morphTo}` : ""}${beat.text ? ` ("${beat.text.slice(0, 48)}")` : ""}`
      ),
      scene.spatialIntent
        ? `- Focal part: ${scene.spatialIntent.focalPart} Â· ${scene.spatialIntent.composition}`
        : "",
      ...(scene.interactions ?? []).map((interaction) =>
        `- Interaction: ${interaction.action} ${interaction.cursorId} â†’ ` +
        `${interaction.targetPart}${interaction.item ? ` item ${interaction.item}` : ""} ` +
        `(${interaction.startSec.toFixed(2)}–${
          (interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec).toFixed(2)
        }s, ${interaction.path})`
      ),
      ...(scene.moments?.length
        ? [
            "",
            "Moments:",
            ...scene.moments.map((moment) =>
              `- ${moment.atSec.toFixed(2)}s [${moment.importance}] ${moment.title}` +
              `${moment.change && moment.visualState ? ` — ${moment.change}` : ""}` +
              `${moment.evidence ? ` (${moment.evidence.detail})` : " (UNBOUND)"}`
            ),
          ]
        : []),
      "",
    ].filter(Boolean)),
  ].join("\n").trimEnd() + "\n";
}

export async function commitDirectComposition(
  projectDir: string,
  title: string,
  draft: DirectCompositionDraft,
  fps = 30,
): Promise<{ manifest: DirectCompositionManifest; validation: DirectValidationResult }> {
  const dir = path.resolve(projectDir);
  const target = compositionDir(dir);
  const validation = await validateDirectComposition(dir, draft);
  if (!validation.ok) {
    throw new Error(`composition failed validation:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const browserQa = await inspectDirectComposition(dir, draft);
  if (!browserQa.ok && !browserQa.infraError) {
    throw new Error(
      `composition failed browser runtime validation:\n${
        browserQa.errors.map((error) => `- ${error}`).join("\n")
      }`,
    );
  }

  const normalized = normalizeStoryboard(draft.storyboard, draft.html);
  // Persist evidence-bound moments (declared or synthesized) on their scenes so
  // the manifest, Slack outline, and thumbnails all review the same contract.
  const momentsByScene = new Map<string, StoryboardMomentV1[]>();
  for (const moment of validation.moments) {
    const list = momentsByScene.get(moment.sceneId) ?? [];
    list.push(moment);
    momentsByScene.set(moment.sceneId, list);
  }
  for (const scene of normalized.scenes) {
    const bound = momentsByScene.get(scene.id);
    if (bound?.length) scene.moments = bound;
  }
  const interactionEvidence = browserQa.interactions ?? [];
  const interactionCount = normalized.scenes.reduce(
    (count, scene) => count + (scene.interactions?.length ?? 0),
    0,
  );
  const previous = hasDirectComposition(dir) ? loadDirectComposition(dir).manifest : undefined;
  const revision = (previous?.revision ?? 0) + 1;
  const manifest: DirectCompositionManifest = {
    version: 1,
    mode: "hyperframes-direct",
    title,
    compositionId: validation.compositionId!,
    width: validation.width!,
    height: validation.height!,
    durationSec: validation.durationSec!,
    fps,
    revision,
    createdAt: new Date().toISOString(),
    sourceHash: createHash("sha256").update(draft.html).digest("hex"),
    provenance: {
      source: "agent",
      operation: previous ? "revise" : "create",
      previousRevision: previous?.revision ?? null,
    },
    qa: {
      browserValidated: !browserQa.infraError,
      layoutSamples: browserQa.samples.length,
      warningCount: browserQa.warnings.length + (browserQa.infraError ? 1 : 0),
      ...(interactionCount
        ? {
            interactionCount,
            interactionRuntime: {
              version: hostContract("interaction").version,
              sha256: hostContract("interaction").hash(),
            },
          }
        : {}),
    },
    scenes: normalized.scenes,
  };

  const staged = path.join(dir, `.composition-${randomUUID()}`);
  const backup = path.join(dir, `.composition-previous-${randomUUID()}`);
  fs.mkdirSync(staged, { recursive: true });
  let movedPrevious = false;
  try {
    fs.writeFileSync(path.join(staged, "index.html"), draft.html.trim() + "\n");
    writeJson(path.join(staged, MANIFEST_FILE), manifest);
    fs.writeFileSync(
      path.join(staged, "STORYBOARD.md"),
      storyboardMarkdown(title, normalized.scenes),
      "utf8",
    );
    const continuity = continuityGraphEnabled()
      ? resolveContinuityGraph(normalized.scenes)
      : undefined;
    const cameraBlocking = continuity
      ? resolveCameraBlockingPlan(normalized.scenes, continuity)
      : undefined;
    const environment = parseEnvironmentPlan(draft.html).plan;
    writeJson(path.join(staged, "motion-plan.json"), {
      version: 1,
      compositionId: manifest.compositionId,
      durationSec: manifest.durationSec,
      shots: normalized.scenes.map((scene) => ({
        ...scene,
        interactions: scene.interactions ?? [],
      })),
      interactions: normalized.scenes.flatMap((scene) => scene.interactions ?? []),
      interactionRuntime: {
        version: hostContract("interaction").version,
        sha256: hostContract("interaction").hash(),
      },
      cuts: resolveCutPlan(normalized.scenes).cuts,
      cutRuntime: {
        version: hostContract("cut").version,
        sha256: hostContract("cut").hash(),
      },
      camera: resolveCameraPlan(normalized.scenes).scenes,
      cameraRuntime: {
        version: hostContract("camera").version,
        sha256: hostContract("camera").hash(),
      },
      ...(continuity
        ? {
            continuity,
            continuityRuntime: {
              version: hostContract("continuity").version,
              sha256: hostContract("continuity").hash(),
            },
            cameraBlocking,
          }
        : {}),
      timeRamps: resolveTimeRampPlan(normalized.scenes).ramps,
      timeRuntime: {
        version: hostContract("time").version,
        sha256: hostContract("time").hash(),
      },
      components: normalized.scenes.flatMap((scene) => scene.components ?? []),
      componentBeats: resolveComponentPlan(normalized.scenes).scenes,
      componentRuntime: {
        version: hostContract("component").version,
        sha256: hostContract("component").hash(),
      },
      direction: resolveFilmDirectionScore(normalized.scenes),
      directionConsumersEnabled: directionScoreConsumersEnabled(),
      ...(environment
        ? {
            environment,
            environmentRuntime: {
              version: hostContract("environment").version,
              sha256: hostContract("environment").hash(),
            },
          }
        : {}),
      ...(browserQa.continuousMotion
        ? { continuousMotion: browserQa.continuousMotion }
        : {}),
      ...(browserQa.cameraBlockingEvidence
        ? { cameraBlockingEvidence: browserQa.cameraBlockingEvidence }
        : {}),
      ...(browserQa.transitionOutgoing?.length
        ? { transitionOutgoing: browserQa.transitionOutgoing }
        : {}),
      ...(browserQa.washoutEvidence?.length
        ? { washoutEvidence: browserQa.washoutEvidence }
        : {}),
      moments: validation.moments,
      ...(validation.motionReport
        ? {
            motionDensity: {
              applies: validation.motionReport.applies,
              maxQuietGapSec: validation.motionReport.maxQuietGapSec,
              quietGaps: validation.motionReport.quietGaps,
              sceneReports: validation.motionReport.sceneReports,
              warnings: validation.motionReport.warnings,
            },
          }
        : {}),
    });
    const qaDir = path.join(staged, "qa");
    fs.mkdirSync(qaDir, { recursive: true });
    writeJson(path.join(qaDir, "spatial.json"), {
      version: 1,
      samples: browserQa.samples,
      issues: browserQa.issues,
      interactions: interactionEvidence,
      ...(browserQa.continuousMotion
        ? { continuousMotion: browserQa.continuousMotion }
        : {}),
      ...(browserQa.cameraBlockingEvidence
        ? { cameraBlockingEvidence: browserQa.cameraBlockingEvidence }
        : {}),
      ...(browserQa.transitionOutgoing?.length
        ? { transitionOutgoing: browserQa.transitionOutgoing }
        : {}),
      ...(browserQa.washoutEvidence?.length
        ? { washoutEvidence: browserQa.washoutEvidence }
        : {}),
      ...(browserQa.infraError ? { infraError: browserQa.infraError } : {}),
      runtime: {
        version: hostContract("interaction").version,
        sha256: hostContract("interaction").hash(),
      },
    });
    if (browserQa.guidePngBase64) {
      fs.writeFileSync(
        path.join(qaDir, "spatial-guide.png"),
        Buffer.from(browserQa.guidePngBase64, "base64"),
      );
    }
    copyRuntimeAndAssets(dir, staged);
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedPrevious = true;
    }
    fs.renameSync(staged, target);
    if (movedPrevious) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(target) && movedPrevious && fs.existsSync(backup)) {
      fs.renameSync(backup, target);
    }
    throw error;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }

  const checkpoint = path.join(revisionsDir(dir), revisionName(revision));
  fs.mkdirSync(checkpoint, { recursive: true });
  fs.copyFileSync(path.join(target, "index.html"), path.join(checkpoint, "index.html"));
  writeJson(path.join(checkpoint, MANIFEST_FILE), manifest);
  fs.copyFileSync(path.join(target, "STORYBOARD.md"), path.join(checkpoint, "STORYBOARD.md"));
  fs.copyFileSync(path.join(target, "motion-plan.json"), path.join(checkpoint, "motion-plan.json"));
  for (const contract of HOST_CONTRACTS) {
    fs.copyFileSync(
      path.join(target, contract.file),
      path.join(checkpoint, contract.file),
    );
  }
  if (fs.existsSync(path.join(target, "assets"))) {
    fs.cpSync(path.join(target, "assets"), path.join(checkpoint, "assets"), { recursive: true });
  }
  fs.cpSync(path.join(target, "qa"), path.join(checkpoint, "qa"), { recursive: true });
  return { manifest, validation };
}

export function undoDirectComposition(projectDir: string): boolean {
  const current = loadDirectComposition(projectDir).manifest;
  if (current.revision <= 1) return false;
  const targetRevision = current.revision - 1;
  const checkpoint = path.join(revisionsDir(projectDir), revisionName(targetRevision));
  if (!fs.existsSync(path.join(checkpoint, "index.html"))) {
    throw new Error(`missing direct composition checkpoint ${targetRevision}`);
  }
  const target = compositionDir(projectDir);
  fs.copyFileSync(path.join(checkpoint, "index.html"), path.join(target, "index.html"));
  fs.copyFileSync(path.join(checkpoint, MANIFEST_FILE), path.join(target, MANIFEST_FILE));
  for (const sidecar of [
    "STORYBOARD.md",
    "motion-plan.json",
    ...HOST_CONTRACTS.map((contract) => contract.file),
  ]) {
    const source = path.join(checkpoint, sidecar);
    const destination = path.join(target, sidecar);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, destination);
    } else {
      fs.rmSync(destination, { force: true });
    }
  }
  const assetsSource = path.join(checkpoint, "assets");
  const assetsTarget = path.join(target, "assets");
  if (fs.existsSync(assetsSource)) {
    fs.rmSync(assetsTarget, { recursive: true, force: true });
    fs.cpSync(assetsSource, assetsTarget, { recursive: true });
  } else {
    fs.rmSync(assetsTarget, { recursive: true, force: true });
  }
  const qaSource = path.join(checkpoint, "qa");
  if (fs.existsSync(qaSource)) {
    fs.rmSync(path.join(target, "qa"), { recursive: true, force: true });
    fs.cpSync(qaSource, path.join(target, "qa"), { recursive: true });
  } else {
    fs.rmSync(path.join(target, "qa"), { recursive: true, force: true });
  }
  return true;
}

/**
 * The Slack-facing storyboard. Leads with what visibly changes at each moment
 * (timestamped rows grouped under their parent scene); scene wrappers and
 * blueprint metadata are secondary. A 15s film reads as 7-10 reviewable rows,
 * not three containers.
 */
export function directOutline(manifest: DirectCompositionManifest): string {
  return manifest.scenes
    .map((scene, index) => {
      const recipe = scene.blueprint ? ` · ${scene.blueprint}` : "";
      const cut = scene.outgoingCut ? ` · cut: ${scene.outgoingCut}` : "";
      const plugins = scene.plugins?.length
        ? ` · plugins: ${scene.plugins.map((declaration) => declaration.kind).join(", ")}`
        : "";
      const header = `${index + 1}. ${scene.title} · ${scene.startSec.toFixed(1)}–${(
        scene.startSec + scene.durationSec
      ).toFixed(1)}s${recipe}${cut}${plugins}`;
      const moments = (scene.moments ?? []).map((moment) => {
        const marker = moment.importance === "primary" ? "◆" : "◇";
        // Declared moments carry an authored change description; synthesized
        // ones repeat their mechanical evidence, so the title alone reads best.
        const what = moment.visualState && moment.change
          ? `${moment.title} — ${moment.change}`
          : moment.title;
        return `   ${moment.atSec.toFixed(1).padStart(5)}s ${marker} ${what.slice(0, 96)}`;
      });
      return [header, ...moments].join("\n");
    })
    .join("\n");
}

export async function directLintText(projectDir: string): Promise<string> {
  const current = loadDirectComposition(projectDir);
  const validation = await validateDirectComposition(projectDir, {
    html: current.html,
    storyboard: current.manifest.scenes,
  });
  if (!validation.ok) return `lint: ${validation.errors.length} error(s)`;
  const staticText = validation.warnings.length
    ? `lint: clean · ${validation.warnings.length} static warning(s)`
    : "lint: clean";
  const qa = current.manifest.qa;
  if (!qa?.browserValidated) return `${staticText} · browser QA: legacy revision`;
  return `${staticText} · browser QA: ${qa.layoutSamples} samples${
    qa.interactionCount ? ` · ${qa.interactionCount} interaction(s)` : ""
  }${
    qa.warningCount ? ` · ${qa.warningCount} warning(s)` : " clean"
  }`;
}

function serveDir(dir: string): Promise<{ url: string; close: () => void }> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dir, "." + pathname.replace(/\/$/, "/index.html"));
      const root = path.resolve(dir);
      if (
        (file !== root && !file.startsWith(root + path.sep)) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": mime[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("could not bind composition server"));
      resolve({ url: `http://127.0.0.1:${address.port}`, close: () => server.close() });
    });
  });
}

interface ThumbnailCapture {
  key: string;
  atSec: number;
  /** Scene the moment lives in — the WS7 walk-forward stays inside it. */
  sceneId: string;
  /** Cut-safe upper bound: the walk-forward never crosses the outgoing cut. */
  latestSec: number;
  /** Cut-safe lower bound for recovering a subject that has already departed. */
  earliestSec: number;
  /** The moment's bound data-part when it is a component/interaction subject. */
  subjectPart?: string;
}

const MAX_MOMENT_THUMBNAILS = 10;

/** WS7 walk-forward: total budget past the chosen capture time (clamped to the
 *  cut-safe latest). A title card's copy can reveal ~1s after its scene opens. */
const MOMENT_WALK_MAX_SEC = 1.0;
/** Backward recovery budget when a settled subject has already left frame. */
const MOMENT_WALK_BACK_MAX_SEC = 1.0;
/** Step for the opacity walk when the moment names a specific subject part. */
const MOMENT_WALK_STEP_SEC = 0.1;
/** Coarser step for the pixel walk (each step is a screenshot). */
const MOMENT_PIXEL_STEP_SEC = 0.2;
/**
 * A no-subject moment (scene-start cut, camera arrival, text tween) is rescued
 * only when a LATER frame paints meaningfully more than the capture frame — a
 * relative test, so a soft bloom that sits in every frame cancels out and does
 * not fool an absolute coverage threshold (the lockup title-card lesson: its
 * container box carries opacity the whole scene while the glyphs clip-reveal
 * ~1s in, so only painted pixels — and only their INCREASE — reveal the copy).
 */
const MOMENT_PAINTED_IMPROVEMENT = 1.25;

/**
 * The data-part a moment is about, when it is one — a `component` or
 * `interaction` moment's evidence detail is `source→<data-part>` (WS7 checks
 * that exact element is visible at capture time). Camera/cut/tween moments
 * have no single data-part subject, so they fall back to scene coverage.
 */
export function momentSubjectPart(moment: StoryboardMomentV1): string | undefined {
  const evidence = moment.evidence;
  if (!evidence || (evidence.kind !== "component" && evidence.kind !== "interaction")) {
    return undefined;
  }
  const arrow = evidence.detail.indexOf("→");
  if (arrow < 0) return undefined;
  const target = evidence.detail.slice(arrow + 1).trim();
  // A data-part is a stable kebab id; reject selector punctuation (# . [ ]).
  return /^[a-z0-9][a-z0-9-]*$/i.test(target) ? target : undefined;
}

/**
 * The thumbnail strip is the storyboard contact sheet. When the manifest
 * carries evidence-bound moments, capture one frame per reviewable moment
 * (primary moments win when the cap bites); legacy manifests keep the
 * one-frame-per-scene behavior.
 */
function thumbnailCaptures(manifest: DirectCompositionManifest): ThumbnailCapture[] {
  const moments = manifest.scenes.flatMap((scene) =>
    (scene.moments ?? []).map((moment) => ({ moment, scene }))
  );
  if (!moments.length) {
    return manifest.scenes.map((scene) => ({
      key: scene.id,
      atSec: scene.startSec + scene.durationSec * 0.58,
      sceneId: scene.id,
      earliestSec: scene.startSec,
      latestSec: Math.max(scene.startSec, scene.startSec + scene.durationSec - 0.05),
    }));
  }
  const selected = moments.length <= MAX_MOMENT_THUMBNAILS
    ? moments
    : [
        ...moments.filter((entry) => entry.moment.importance === "primary"),
        ...moments.filter((entry) => entry.moment.importance !== "primary"),
      ].slice(0, MAX_MOMENT_THUMBNAILS);
  // The outgoing cut's exit window animates the scene wrapper off; capturing
  // inside it produces a mid-transition frame.
  const resolvedCuts = resolveCutPlan(manifest.scenes).cuts;
  const cutExitByScene = new Map(
    resolvedCuts.map((cut) => [cut.fromScene, cut.exitSec]),
  );
  // A cover swipe's panel is still wiping off through the incoming scene's
  // entry window — a capture there shows the palette panel, not the moment.
  const entryCoverByScene = new Map(
    resolvedCuts
      .filter((cut) => cut.style === "swipe" && cut.cover)
      .map((cut) => [cut.toScene, cut.entrySec]),
  );
  return selected
    .map(({ moment, scene }, index) => {
      // Capture the SETTLED state: just after the bound evidence finishes
      // (typing done, camera arrived, chart drawn) rather than mid-animation.
      // Unbound/legacy moments keep the old post-atSec offset.
      const settledSec = moment.evidence
        ? moment.evidence.endSec + 0.08
        : moment.atSec + 0.42;
      const latestSec = Math.max(
        scene.startSec,
        scene.startSec + scene.durationSec - 0.05 - (cutExitByScene.get(scene.id) ?? 0),
      );
      const earliestSec = Math.min(
        latestSec,
        scene.startSec + (entryCoverByScene.get(scene.id) ?? 0),
      );
      const subjectPart = momentSubjectPart(moment);
      return {
        key: `m${String(index + 1).padStart(2, "0")}-${moment.id}`,
        atSec: Math.min(Math.max(settledSec, earliestSec), latestSec),
        sceneId: scene.id,
        earliestSec,
        latestSec,
        ...(subjectPart ? { subjectPart } : {}),
      };
    })
    .sort((a, b) => a.atSec - b.atSec)
    .map((capture, index) => ({
      ...capture,
      key: `m${String(index + 1).padStart(2, "0")}-${capture.key.replace(/^m\d+-/, "")}`,
    }));
}

export async function generateDirectThumbnails(
  projectDir: string,
  options: { width?: number; browserPath?: string } = {},
): Promise<DirectThumbsResult> {
  const current = loadDirectComposition(projectDir);
  const targetDir = path.join(projectDir, "build", "thumbs");
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-direct-thumbs-"));
  fs.mkdirSync(targetDir, { recursive: true });
  const browserPath = options.browserPath ?? findBrowserExecutable();
  if (!browserPath) throw new Error("no Chrome/Edge found for thumbnail capture");
  const scale = (options.width ?? 480) / current.manifest.width;
  const started = Date.now();
  const server = await serveDir(compositionDir(projectDir));
  let browser: import("puppeteer-core").Browser | undefined;
  try {
    browser = await launchHeadlessBrowser({
      executablePath: browserPath,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.setViewport({
      width: current.manifest.width,
      height: current.manifest.height,
      deviceScaleFactor: scale,
    });
    const consoleErrors: string[] = [];
    page.on("pageerror", (error: unknown) =>
      consoleErrors.push(error instanceof Error ? error.message : String(error)),
    );
    await page.goto(`${server.url}/index.html`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForFunction(
      (id: string) => Boolean(
        (window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.[id],
      ),
      { timeout: 15_000 },
      current.manifest.compositionId,
    );
    if (consoleErrors.length) throw new Error(`composition runtime error: ${consoleErrors.join("; ")}`);

    // Captured moment times are content (timeline) time; the registered
    // timeline is the warped master (output time) when the film ramps, so
    // convert before the physical seek. The scene-visibility toggle below is
    // safe with the converted time: the warp maps each scene window onto
    // itself monotonically, so the output time stays inside the same scene.
    const conversion = timeConversionService(parseTimeRampPlan(current.html).plan);
    const toOutputTime = (value: number): number => conversion.toViewer(sourceTime(value));
    const compositionId = current.manifest.compositionId;
    const seekTo = (contentTime: number): Promise<void> =>
      page.evaluate(
        (time: number, id: string) => {
          const win = window as unknown as {
            __timelines: Record<string, { seek(t: number, suppress?: boolean): void }>;
          };
          win.__timelines[id]!.seek(time, false);
          document.querySelectorAll<HTMLElement>("[data-scene]").forEach((element) => {
            const start = Number(element.dataset.start ?? 0);
            const duration = Number(element.dataset.duration ?? 0);
            element.style.visibility = time >= start && time < start + duration ? "visible" : "hidden";
          });
        },
        toOutputTime(contentTime),
        compositionId,
      );
    // WS7: is the moment's subject actually on screen at this frame? A
    // scene-start-anchored moment can settle its capture time before its own
    // entrance finishes, producing an empty "gray circle" thumbnail
    // (probe-cutfix-3 m03). Check the bound data-part (or, when the moment has
    // no single subject, the scene's visible content coverage).
    // NOTE: the page.evaluate callbacks below run inside puppeteer's page
    // context. Do NOT introduce named nested functions in them — under
    // `node --import tsx` the MCP-server transform wraps named functions with
    // an esbuild `__name(...)` helper that is undefined in the browser, so the
    // callback crashes ("__name is not defined"). Keep the math inline.

    // Is the moment's named subject visibly present? "absent" when the part is
    // not in the scene DOM (fall back to the pixel path). Cheap — no screenshot.
    const subjectState = (sceneId: string, subjectPart: string): Promise<"visible" | "hidden" | "absent"> =>
      page.evaluate((payload: { sceneId: string; subjectPart: string }) => {
        const root = document.querySelector<HTMLElement>(
          "[data-composition-id][data-width][data-height]",
        );
        const scene = root?.querySelector<HTMLElement>(
          `[data-scene="${CSS.escape(payload.sceneId)}"]`,
        );
        // A bridge clone lives outside the scene subtree, so scoping avoids it.
        const element = scene?.querySelector<HTMLElement>(
          `[data-part="${CSS.escape(payload.subjectPart)}"]`,
        );
        if (!root || !element) return "absent" as const;
        const rootRect = root.getBoundingClientRect();
        let opacity = 1;
        let node: Element | null = element;
        while (node) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") { opacity = 0; break; }
          opacity *= Number.parseFloat(style.opacity) || 0;
          node = node.parentElement;
        }
        const rect = element.getBoundingClientRect();
        const w = Math.max(0, Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left));
        const h = Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top));
        const area = rect.width * rect.height;
        const onFrame = area > 0 ? (w * h) / area : 0;
        const insetX = rootRect.width * 0.025;
        const insetY = rootRect.height * 0.025;
        const safeX = rect.width >= rootRect.width * 0.94 ||
          (rect.left >= rootRect.left + insetX && rect.right <= rootRect.right - insetX);
        const safeY = rect.height >= rootRect.height * 0.94 ||
          (rect.top >= rootRect.top + insetY && rect.bottom <= rootRect.bottom - insetY);
        // Moment thumbs are review artifacts, not playback frames: even a
        // technically visible subject reads as broken when 3-5% is clipped.
        return opacity >= 0.5 && onFrame >= 0.98 && safeX && safeY
          ? ("visible" as const)
          : ("hidden" as const);
      }, { sceneId, subjectPart });

    // Fraction of frame pixels that deviate from the four-corner background —
    // painted content, glyphs included (a clip-revealed title reads here even
    // though its box is present the whole scene). Screenshot + canvas read.
    const paintedFraction = async (): Promise<number> => {
      const b64 = (await page.screenshot({ encoding: "base64", type: "png" })) as string;
      return page.evaluate(async (encodedPng: string) => {
        // Decode the host-owned screenshot without navigating an <img>. Luna
        // compositions deliberately use `img-src 'self'`; a temporary data URL
        // would violate that policy and turn an internal QA probe into a false
        // browser-runtime failure. createImageBitmap decodes inert bytes
        // directly and does not expand the authored page's CSP.
        const binary = atob(encodedPng);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const w = image.width;
        const h = image.height;
        if (!w || !h) {
          image.close();
          return 0;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        image.close();
        const data = context.getImageData(0, 0, w, h).data;
        const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
        let br = 0;
        let bg = 0;
        let bb = 0;
        for (const c of corners) { br += data[c]!; bg += data[c + 1]!; bb += data[c + 2]!; }
        br /= 4; bg /= 4; bb /= 4;
        let painted = 0;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          total += 1;
          if (Math.abs(data[i]! - br) + Math.abs(data[i + 1]! - bg) + Math.abs(data[i + 2]! - bb) > 60) {
            painted += 1;
          }
        }
        return total ? painted / total : 0;
      }, b64);
    };

    const files: Record<string, string> = {};
    for (const capture of thumbnailCaptures(current.manifest)) {
      let chosen = capture.atSec;
      const walkEnd = Math.min(capture.atSec + MOMENT_WALK_MAX_SEC, capture.latestSec);
      await seekTo(chosen);
      const state = capture.subjectPart
        ? await subjectState(capture.sceneId, capture.subjectPart)
        : "absent";
      if (state === "hidden") {
        // Named subject present but not yet revealed (probe-cutfix-3 m03: the
        // palette is opacity-0 mid-entrance) — walk to the first frame it shows.
        const walkStart = Math.max(
          capture.earliestSec,
          capture.atSec - MOMENT_WALK_BACK_MAX_SEC,
        );
        for (let t = capture.atSec - MOMENT_WALK_STEP_SEC;
          t >= walkStart - 1e-6;
          t -= MOMENT_WALK_STEP_SEC) {
          await seekTo(t);
          if (await subjectState(capture.sceneId, capture.subjectPart!) === "visible") {
            chosen = t;
            break;
          }
        }
        for (let t = capture.atSec + MOMENT_WALK_STEP_SEC;
          chosen === capture.atSec && t <= walkEnd + 1e-6;
          t += MOMENT_WALK_STEP_SEC) {
          await seekTo(t);
          if (await subjectState(capture.sceneId, capture.subjectPart!) === "visible") {
            chosen = t;
            break;
          }
        }
        if (chosen === capture.atSec) await seekTo(chosen);
      } else if (state === "absent") {
        // No single subject (scene-start cut, camera arrival, text tween): walk
        // to the first frame that paints meaningfully more than the capture
        // frame — the lockup title card reveals its copy ~1s after it opens.
        const base = await paintedFraction();
        for (let t = capture.atSec + MOMENT_PIXEL_STEP_SEC; t <= walkEnd + 1e-6; t += MOMENT_PIXEL_STEP_SEC) {
          await seekTo(t);
          if (await paintedFraction() > base * MOMENT_PAINTED_IMPROVEMENT) {
            chosen = t;
            break;
          }
        }
        if (chosen === capture.atSec) await seekTo(chosen);
      }
      const safeId = capture.key.replace(/[^a-z0-9_-]/gi, "-");
      const staged = path.join(staging, `${safeId}.png`);
      await page.screenshot({ path: staged as `${string}.png` });
      const target = path.join(targetDir, `${safeId}.png`);
      fs.copyFileSync(staged, target);
      files[capture.key] = `thumbs/${safeId}.png`;
    }
    return { files, elapsedMs: Date.now() - started };
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function renderName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "render";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return `${slug}-${stamp}.mp4`;
}

export async function renderDirectComposition(
  projectDir: string,
  options: { quality?: RenderQuality; browserPath?: string; quiet?: boolean } = {},
): Promise<DirectRenderResult> {
  const current = loadDirectComposition(projectDir);
  const ffmpegPath = ensureFfmpegOnPath();
  const browserPath = options.browserPath ?? findBrowserExecutable();
  const quality = options.quality ?? "draft";
  const outputPath = path.join(projectDir, "renders", renderName(current.manifest.title));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const started = Date.now();
  (globalThis as { require?: NodeRequire }).require ??= createRequire(import.meta.url);
  const producerSpecifier: string = "@hyperframes/producer";
  const producer = (await import(producerSpecifier)) as ProducerModule;
  const makeJob = (supersample?: SupersamplePlan): unknown =>
    producer.createRenderJob({
      fps: current.manifest.fps,
      quality,
      format: "mp4",
      entryFile: "index.html",
      logger: options.quiet ? undefined : producer.createConsoleLogger?.("info"),
      ...(supersample ? supersampleJobFields(supersample) : {}),
      producerConfig: producer.resolveConfig(renderProducerOverrides(browserPath)),
    });
  const onProgress = options.quiet
    ? undefined
    : (progressJob: { progress: number }, message: string): void => {
        const percent = Math.round(progressJob.progress);
        process.stdout.write(`\rrender ${percent}% ${message.padEnd(40).slice(0, 40)}`);
        if (percent >= 100) process.stdout.write("\n");
      };
  // HD tier: capture the film at an integer 2× DPR and lanczos-downscale back
  // to composition dimensions, so slow sub-pixel motion stops stair-stepping
  // in the MP4 (see resolveSupersamplePlan). Any failure falls back to the
  // plain 1× render.
  const supersample = resolveSupersamplePlan(
    current.manifest.width,
    current.manifest.height,
    quality,
  );
  let rendered = false;
  if (supersample) {
    const masterPath = `${outputPath}.supersample-master.mp4`;
    try {
      await producer.executeRenderJob(makeJob(supersample), compositionDir(projectDir), masterPath, onProgress);
      downscaleSupersampledRender(ffmpegPath, masterPath, outputPath, supersample);
      rendered = true;
    } catch (error) {
      process.stderr.write(
        `[render] supersampled render failed, falling back to 1x: ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
    } finally {
      fs.rmSync(masterPath, { force: true });
    }
  }
  if (!rendered) {
    await producer.executeRenderJob(makeJob(), compositionDir(projectDir), outputPath, onProgress);
  }
  return {
    outputPath,
    durationSec: current.manifest.durationSec,
    elapsedMs: Date.now() - started,
  };
}
