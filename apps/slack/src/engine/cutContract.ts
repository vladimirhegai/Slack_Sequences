/**
 * Typed, executable cut contract between scenes.
 *
 * The storyboard's `outgoingCut` prose used to be the only record of how one
 * shot hands off to the next, and authored HTML routinely ignored it — every
 * boundary degenerated into a hard opacity swap. This contract mirrors the
 * interaction architecture: the planner declares a bounded typed intent, a
 * deterministic local runtime (`sequences-cuts.v1.js`) compiles it into
 * velocity-matched, seek-safe tweens on the scene wrappers, and validation
 * proves the binding before publication. A cut that cannot be normalized
 * simply degrades to `hard` — cuts are enhancements, never a veto.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sceneScopes } from "./cameraContract.ts";
import type { DirectScene } from "./directComposition.ts";

export const CUT_RUNTIME_VERSION = 1;
export const CUT_RUNTIME_FILE = "sequences-cuts.v1.js";

const RUNTIME_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
  CUT_RUNTIME_FILE,
);

/**
 * The planner-facing transition language is THREE named transitions plus
 * `hard` (MD1, 2026-07-06): `swipe` (directional family, optional full-frame
 * `cover` wipe), `morph` (the shape-match dual bridge), and `match`
 * (object-match when both focal parts bind; otherwise a disciplined hard cut
 * whose eye-trace budget QA tightens). Every legacy name stays *executable* —
 * old cached storyboards, the fallback film, and degrade paths keep compiling
 * — but is canonicalized at parse/resolve, so the shipped film speaks the
 * 3-transition language and the planner schema never sees ten styles again.
 */
export type CutStyle =
  | "hard"
  | "swipe"
  | "morph"
  | "match"
  // Legacy executable styles: compile targets and degrade paths only — they
  // left the planner prompt and schema enum with the 3-transition language.
  | "zoom-through"
  | "inverse-zoom"
  | "flash-white"
  // Legacy aliases, canonicalized away at parse/resolve (never seen post-parse).
  | "cut-left"
  | "cut-right"
  | "cut-up"
  | "cut-down"
  | "object-match"
  | "shape-match";

export type CutAxis = "left" | "right" | "up" | "down";

export const CUT_AXES: ReadonlySet<CutAxis> = new Set<CutAxis>([
  "left",
  "right",
  "up",
  "down",
]);

export const CUT_STYLES: ReadonlySet<CutStyle> = new Set<CutStyle>([
  "hard",
  "swipe",
  "morph",
  "match",
  "zoom-through",
  "inverse-zoom",
  "flash-white",
  "cut-left",
  "cut-right",
  "cut-up",
  "cut-down",
  "object-match",
  "shape-match",
]);

/** Directional legacy names → their canonical swipe axis. */
const LEGACY_DIRECTIONAL_AXIS: Partial<Record<CutStyle, CutAxis>> = {
  "cut-left": "left",
  "cut-right": "right",
  "cut-up": "up",
  "cut-down": "down",
};

/**
 * Canonicalize a cut style into the 3-transition language. Legacy directional
 * names become `swipe` + axis, `shape-match` becomes `morph`, `object-match`
 * becomes `match`; zoom/flash styles stay as-is (accepted-but-undocumented
 * compile targets). Also applied at resolve time so cached storyboards and
 * code-built scenes (fallback film, golden film) speak one language downstream.
 */
export function canonicalCutStyle(
  style: CutStyle,
  axis?: CutAxis,
): { style: CutStyle; axis?: CutAxis } {
  const legacyAxis = LEGACY_DIRECTIONAL_AXIS[style];
  if (legacyAxis) return { style: "swipe", axis: legacyAxis };
  if (style === "shape-match") return { style: "morph" };
  if (style === "object-match") return { style: "match" };
  if (style === "swipe") return { style: "swipe", axis: axis ?? "right" };
  return { style };
}

/**
 * Planner-side silhouette hints for shape-match. They carry no runtime
 * geometry — the runtime measures live rects — and exist purely so the model
 * self-checks that the two focal parts genuinely rhyme as silhouettes.
 */
export type CutShapeHint = "pill" | "bar" | "card" | "circle" | "window" | "list" | "table";

export const CUT_SHAPE_HINTS: ReadonlySet<CutShapeHint> = new Set<CutShapeHint>([
  "pill",
  "bar",
  "card",
  "circle",
  "window",
  "list",
  "table",
]);

/** Cut styles that carry a focal element across the boundary via a bridge.
 * `match` is bridged only when BOTH focal parts are declared — with one or
 * zero it compiles as a disciplined hard cut whose eye-trace budget QA
 * tightens (the "match promise"). */
const BRIDGED_STYLES: ReadonlySet<CutStyle> = new Set<CutStyle>([
  "morph",
  "object-match",
  "shape-match",
]);

/** Whether an intent resolves to a real bridge flight across its boundary. */
export function isBridgedCutIntent(
  cut: Pick<SceneCutIntentV1, "style" | "focalPartOut" | "focalPartIn"> | undefined,
): boolean {
  if (!cut) return false;
  const { style } = canonicalCutStyle(cut.style);
  if (style === "morph") return true;
  return style === "match" && Boolean(cut.focalPartOut && cut.focalPartIn);
}

/**
 * Cut intents that count as an energetic boundary for the camera-energy
 * audit: a real bridge flight, a full-frame cover wipe, or one of the legacy
 * zoom/flash registers. A plain swipe and a hard-form match are quiet seams.
 */
export function isEnergeticCutIntent(cut: SceneCutIntentV1 | undefined): boolean {
  if (!cut) return false;
  if (isBridgedCutIntent(cut)) return true;
  const canonical = canonicalCutStyle(cut.style);
  if (canonical.style === "swipe") return cut.cover === true;
  return (
    canonical.style === "zoom-through" ||
    canonical.style === "inverse-zoom" ||
    canonical.style === "flash-white"
  );
}

/**
 * Silhouette families for plan-time sanity: strips (pill, bar) rhyme with
 * strips, blocks (card, circle, window) rhyme with blocks, and grids (list,
 * table) rhyme with grids. A cross-family pair — a pill landing as a card, a
 * circle as a bar, a row list becoming an app window (probe-audit-03) — cannot
 * stay inside the runtime's 2.5x aspect / structure cap at any plausible size,
 * so a shape-match declared with such hints is known-hopeless before any source
 * is authored. A `list`/`table` (a multi-row grid) is deliberately a DIFFERENT
 * family from a `window`/`card` (a chrome surface): a morph between them is the
 * smearing case the bind-time structure audit catches when hints are absent.
 */
const SHAPE_HINT_FAMILY: Record<CutShapeHint, "strip" | "block" | "grid"> = {
  pill: "strip",
  bar: "strip",
  card: "block",
  circle: "block",
  window: "block",
  list: "grid",
  table: "grid",
};

/** Whether two silhouette hints can plausibly rhyme as shape-match endpoints. */
export function shapeHintsRhyme(shapeOut: CutShapeHint, shapeIn: CutShapeHint): boolean {
  return SHAPE_HINT_FAMILY[shapeOut] === SHAPE_HINT_FAMILY[shapeIn];
}

/**
 * Transition-language coherence (WS6), plan stage. A launch film has one or
 * two signature transitions repeated — premium cuts read premium because they
 * are RARE and consistent. probe-cutfix-3 read "messy" in part because every
 * seam spoke a different language. This flags a style ZOO — more distinct
 * non-`hard` cut styles than a film that length can motivate — as a cheap
 * storyboard findings-retry (it degrades to advisory on late attempts, never a
 * veto), so the planner reuses a language instead of inventing a novelty per
 * seam. The `hard` cut is the neutral default and never counts.
 *
 * The floor is FIVE distinct styles, not four: the golden film runs four
 * premium cuts (cut-left, flash-white, object-match, inverse-zoom) across four
 * boundaries and reads clean, so four signatures is the ceiling of "good", not
 * a defect (verification law: an audit that fires on the golden film is
 * wrong). Longer films earn proportionally more variety before it is a zoo.
 */
export function auditCutCoherence(scenes: Array<Pick<DirectScene, "cut">>): string[] {
  // Only inter-scene boundaries carry a cut; the final scene declares none.
  // Count canonical names so the whole swipe family (four axes, cover or not)
  // is ONE language, and legacy names in cached plans dedupe with their
  // canonical successors.
  const styles = scenes
    .map((scene) =>
      scene.cut?.style ? canonicalCutStyle(scene.cut.style, scene.cut.axis).style : undefined
    )
    .filter((style): style is CutStyle => Boolean(style));
  const distinctNonHard = new Set(styles.filter((style) => style !== "hard"));
  // Signature budget: four is always fine (the golden film's own count);
  // beyond that, ~0.6 distinct styles per boundary, so a 6-boundary film may
  // reach four before the fifth reads as a zoo and a long film earns more.
  const cap = Math.max(4, Math.round(styles.length * 0.6));
  if (distinctNonHard.size <= cap) return [];
  return [
    `cuts/coherence: the film uses ${distinctNonHard.size} distinct non-hard cut styles ` +
      `(${[...distinctNonHard].join(", ")}) across ${styles.length} boundaries — pick a ` +
      `transition language. A launch film has 1-2 signature transitions repeated: reuse one ` +
      `directional axis and one zoom register instead of a different style per seam, and spend ` +
      `a premium object-match/shape-match once so it reads premium.`,
  ];
}

/** A scene's declaration of its own outgoing boundary. */
export interface SceneCutIntentV1 {
  version: 1;
  style: CutStyle;
  /** swipe: travel direction (required; legacy directional names imply it). */
  axis?: CutAxis;
  /** swipe: a palette panel wipes the frame, hiding the cut under full cover. */
  cover?: true;
  /** Wrapper travel for directional cuts, px. */
  travelPx?: number;
  /** Exit acceleration window before the boundary, seconds. */
  exitSec?: number;
  /** Entry deceleration window after the boundary, seconds. */
  entrySec?: number;
  /** morph/match: data-part carried out of this scene. */
  focalPartOut?: string;
  /** morph/match: data-part it lands on in the next scene. */
  focalPartIn?: string;
  /** morph: silhouette hint for the outgoing part (planner self-check). */
  shapeOut?: CutShapeHint;
  /** morph: silhouette hint for the incoming part (planner self-check). */
  shapeIn?: CutShapeHint;
}

/** A fully resolved boundary the runtime can bind mechanically. */
export interface CutIntentV1 extends Required<Pick<SceneCutIntentV1, "version" | "style">> {
  fromScene: string;
  toScene: string;
  atSec: number;
  travelPx: number;
  exitSec: number;
  entrySec: number;
  axis?: CutAxis;
  cover?: true;
  focalPartOut?: string;
  focalPartIn?: string;
  shapeOut?: CutShapeHint;
  shapeIn?: CutShapeHint;
}

export interface CutPlanV1 {
  version: 1;
  cuts: CutIntentV1[];
}

const STYLE_DEFAULTS: Record<Exclude<CutStyle, "hard">, { exitSec: number; entrySec: number }> = {
  swipe: { exitSec: 0.3, entrySec: 0.42 },
  morph: { exitSec: 0.22, entrySec: 0.5 },
  match: { exitSec: 0.22, entrySec: 0.5 },
  "cut-left": { exitSec: 0.3, entrySec: 0.42 },
  "cut-right": { exitSec: 0.3, entrySec: 0.42 },
  "cut-up": { exitSec: 0.3, entrySec: 0.42 },
  "cut-down": { exitSec: 0.3, entrySec: 0.42 },
  "zoom-through": { exitSec: 0.24, entrySec: 0.5 },
  "inverse-zoom": { exitSec: 0.24, entrySec: 0.5 },
  "flash-white": { exitSec: 0.18, entrySec: 0.4 },
  "object-match": { exitSec: 0.22, entrySec: 0.5 },
  "shape-match": { exitSec: 0.22, entrySec: 0.5 },
};

/**
 * The swipe axis that carries the eye from the outgoing focal center toward
 * the incoming one: a target to the RIGHT means the incoming scene should
 * enter from the right, which is leftward content travel (`axis: "left"`),
 * and so on. Screen coordinates (y grows downward). Fallback: right-travel.
 */
export function swipeAxisTowards(
  outCenter: { x: number; y: number } | undefined,
  inCenter: { x: number; y: number } | undefined,
): CutAxis {
  if (!outCenter || !inCenter) return "right";
  const dx = inCenter.x - outCenter.x;
  const dy = inCenter.y - outCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "left" : "right";
  return dy >= 0 ? "up" : "down";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stablePart(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{0,63}$/.test(raw) ? raw : "";
}

function shapeHint(value: unknown): CutShapeHint | "" {
  const raw = typeof value === "string" ? value.trim() as CutShapeHint : "";
  return raw && CUT_SHAPE_HINTS.has(raw) ? raw : "";
}

/**
 * Normalize a storyboard scene's typed cut declaration into the canonical
 * 3-transition language. Unknown styles, malformed params, or a morph without
 * both parts degrade to no cut rather than failing the storyboard — the film
 * stays buildable. Legacy names (cut-right, shape-match, object-match) are
 * accepted and canonicalized, so cached storyboards keep parsing.
 *
 * `match` is the one style that survives with incomplete focal parts: with
 * both it bridges like object-match; with one/zero it compiles as a hard cut
 * whose incoming target must land where the eye already is (QA enforces the
 * tightened eye-trace budget), so the declaration is a promise, not paperwork.
 */
export function normalizeStoryboardCutIntent(value: unknown): SceneCutIntentV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const rawStyle = typeof object.style === "string" ? object.style.trim() as CutStyle : "";
  if (!rawStyle || !CUT_STYLES.has(rawStyle)) return undefined;
  const declaredAxis = typeof object.axis === "string" &&
      CUT_AXES.has(object.axis.trim() as CutAxis)
    ? object.axis.trim() as CutAxis
    : undefined;
  const canonical = canonicalCutStyle(rawStyle, declaredAxis);
  const style = canonical.style;
  if (style === "hard") return { version: 1, style };
  const focalPartOut = stablePart(object.focalPartOut);
  const focalPartIn = stablePart(object.focalPartIn);
  if (style === "morph" && (!focalPartOut || !focalPartIn)) return undefined;
  const shapeOut = shapeHint(object.shapeOut);
  const shapeIn = shapeHint(object.shapeIn);
  return {
    version: 1,
    style,
    ...(style === "swipe" ? { axis: canonical.axis ?? "right" } : {}),
    ...(style === "swipe" && object.cover === true ? { cover: true as const } : {}),
    ...(finite(object.travelPx) ? { travelPx: clamp(object.travelPx, 80, 420) } : {}),
    ...(finite(object.exitSec) ? { exitSec: clamp(object.exitSec, 0.12, 0.6) } : {}),
    ...(finite(object.entrySec) ? { entrySec: clamp(object.entrySec, 0.2, 0.9) } : {}),
    ...(style === "morph" ? { focalPartOut, focalPartIn } : {}),
    ...(style === "match" && focalPartOut ? { focalPartOut } : {}),
    ...(style === "match" && focalPartIn ? { focalPartIn } : {}),
    ...(style === "morph" && shapeOut ? { shapeOut } : {}),
    ...(style === "morph" && shapeIn ? { shapeIn } : {}),
  };
}

/**
 * Resolve per-scene declarations into the concrete boundary plan. The last
 * scene's declaration is ignored (there is no incoming side), `hard` produces
 * no runtime work, and windows are clamped so exit/entry never escape the
 * scenes they animate.
 */
export function resolveCutPlan(scenes: DirectScene[]): CutPlanV1 {
  const cuts: CutIntentV1[] = [];
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const scene = scenes[index]!;
    const next = scenes[index + 1]!;
    const intent = scene.cut;
    if (!intent || intent.style === "hard") continue;
    // Canonicalize here too: cached plans and code-built scenes (fallback
    // film, golden film) may still carry legacy names, and the runtime speaks
    // only the canonical language.
    const canonical = canonicalCutStyle(intent.style, intent.axis);
    // A hard-form match (either focal part missing) IS a hard cut at runtime;
    // its promise is enforced by the tightened eye-trace budget, not motion.
    if (canonical.style === "match" && !(intent.focalPartOut && intent.focalPartIn)) {
      continue;
    }
    const defaults = STYLE_DEFAULTS[canonical.style as Exclude<CutStyle, "hard">];
    const atSec = scene.startSec + scene.durationSec;
    const exitSec = clamp(
      intent.exitSec ?? defaults.exitSec,
      0.12,
      Math.max(0.12, scene.durationSec * 0.4),
    );
    const entrySec = clamp(
      intent.entrySec ?? defaults.entrySec,
      0.2,
      Math.max(0.2, next.durationSec * 0.5),
    );
    cuts.push({
      version: 1,
      style: canonical.style,
      fromScene: scene.id,
      toScene: next.id,
      atSec,
      travelPx: clamp(intent.travelPx ?? 230, 80, 420),
      exitSec,
      entrySec,
      ...(canonical.style === "swipe" ? { axis: canonical.axis ?? "right" } : {}),
      ...(canonical.style === "swipe" && intent.cover ? { cover: true as const } : {}),
      ...(intent.focalPartOut ? { focalPartOut: intent.focalPartOut } : {}),
      ...(intent.focalPartIn ? { focalPartIn: intent.focalPartIn } : {}),
      ...(intent.shapeOut ? { shapeOut: intent.shapeOut } : {}),
      ...(intent.shapeIn ? { shapeIn: intent.shapeIn } : {}),
    });
  }
  return { version: 1, cuts };
}

export function cutRuntimeSource(): string {
  return fs.readFileSync(RUNTIME_SOURCE_PATH, "utf8");
}

export function cutRuntimeHash(): string {
  return createHash("sha256").update(cutRuntimeSource()).digest("hex");
}

export interface CutContractResult {
  plan?: CutPlanV1;
  errors: string[];
  warnings: string[];
}

export function parseCutPlan(html: string): { plan?: CutPlanV1; errors: string[] } {
  const match = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-cuts\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return { errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(match[2]!.trim());
  } catch (error) {
    return {
      errors: [
        `sequences-cuts JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["sequences-cuts must be an object"] };
  }
  const object = value as Record<string, unknown>;
  const errors: string[] = [];
  if (object.version !== 1) errors.push("sequences-cuts.version must be 1");
  if (!Array.isArray(object.cuts)) {
    errors.push("sequences-cuts.cuts must be an array");
    return { errors };
  }
  const cuts = object.cuts.flatMap((entry, index): CutIntentV1[] => {
    const errorsBefore = errors.length;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`cut[${index}] must be an object`);
      return [];
    }
    const cut = entry as Record<string, unknown>;
    const style = typeof cut.style === "string" ? cut.style as CutStyle : "hard";
    const fromScene = typeof cut.fromScene === "string" ? cut.fromScene.trim() : "";
    const toScene = typeof cut.toScene === "string" ? cut.toScene.trim() : "";
    if (!CUT_STYLES.has(style)) errors.push(`cut[${index}].style "${String(cut.style)}" is unsupported`);
    if (!fromScene || !toScene) errors.push(`cut[${index}] needs fromScene and toScene`);
    if (!finite(cut.atSec) || !finite(cut.travelPx) || !finite(cut.exitSec) || !finite(cut.entrySec)) {
      errors.push(`cut[${index}] needs finite atSec/travelPx/exitSec/entrySec`);
    }
    const axis = typeof cut.axis === "string" && CUT_AXES.has(cut.axis as CutAxis)
      ? cut.axis as CutAxis
      : undefined;
    if (style === "swipe" && !axis) {
      errors.push(`cut[${index}] swipe needs an axis (left|right|up|down)`);
    }
    const focalPartOut = stablePart(cut.focalPartOut);
    const focalPartIn = stablePart(cut.focalPartIn);
    // Every match in a resolved island is bridged (hard-form matches resolve
    // to no runtime cut), so both parts are required exactly like morph.
    if (
      (BRIDGED_STYLES.has(style) || style === "match") &&
      (!focalPartOut || !focalPartIn)
    ) {
      errors.push(`cut[${index}] ${style} needs focalPartOut and focalPartIn`);
    }
    const shapeOut = shapeHint(cut.shapeOut);
    const shapeIn = shapeHint(cut.shapeIn);
    const hintStyle = style === "shape-match" || style === "morph";
    // Compare counts, not prefixes: `cut[1]` is a prefix of `cut[10]`, so a
    // startsWith check would drop cut 1 whenever a later entry erred.
    if (errors.length > errorsBefore) return [];
    return [{
      version: 1,
      style,
      fromScene,
      toScene,
      atSec: cut.atSec as number,
      travelPx: cut.travelPx as number,
      exitSec: cut.exitSec as number,
      entrySec: cut.entrySec as number,
      ...(style === "swipe" && axis ? { axis } : {}),
      ...(style === "swipe" && cut.cover === true ? { cover: true as const } : {}),
      ...(focalPartOut ? { focalPartOut } : {}),
      ...(focalPartIn ? { focalPartIn } : {}),
      ...(hintStyle && shapeOut ? { shapeOut } : {}),
      ...(hintStyle && shapeIn ? { shapeIn } : {}),
    }];
  });
  return errors.length ? { errors } : { plan: { version: 1, cuts }, errors: [] };
}

function partPattern(part: string): RegExp {
  const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bdata-part\\s*=\\s*(["'])${escaped}\\1`, "i");
}

/**
 * Static publication gate for the cut plan. Errors block publication (the
 * island exists but cannot bind); warnings flag probable double ownership of a
 * wrapper property so the repair pass can resolve it deliberately.
 */
export function validateCutContract(
  html: string,
  scenes: DirectScene[],
): CutContractResult {
  const parsed = parseCutPlan(html);
  const errors = [...parsed.errors];
  const warnings: string[] = [];
  const expected = resolveCutPlan(scenes);
  if (!parsed.plan && expected.cuts.length === 0) return { errors, warnings };
  if (!parsed.plan) {
    errors.push("storyboard declares typed cuts but index_html has no sequences-cuts JSON island");
    return { errors, warnings };
  }
  if (!html.includes(`src="${CUT_RUNTIME_FILE}"`) && !html.includes(`src='${CUT_RUNTIME_FILE}'`)) {
    errors.push(`cut composition must load local ${CUT_RUNTIME_FILE}`);
  }
  if (!/\bSequencesCuts\.compile\s*\(/.test(html)) {
    errors.push("cut composition must call SequencesCuts.compile(timeline, root)");
  }
  if (JSON.stringify(parsed.plan) !== JSON.stringify(expected)) {
    errors.push("sequences-cuts island differs from the storyboard's resolved cut plan");
  }
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  // The runtime binds focal parts scene-scoped (outgoing in fromScene,
  // incoming in toScene), so the static gate must check the same scope — a
  // part that exists only in the other scene would pass a whole-document
  // check and then fail cut compilation in the browser.
  const scopes = new Map(sceneScopes(html).map((scene) => [scene.id, scene.scope]));
  for (const cut of parsed.plan.cuts) {
    if (!sceneIds.has(cut.fromScene) || !sceneIds.has(cut.toScene)) {
      errors.push(`cut ${cut.fromScene}->${cut.toScene} references an unknown scene`);
      continue;
    }
    // A bridge that flies toward a station the incoming camera has not framed
    // is the likeliest field failure for bridged cuts: the flight lands on a
    // point outside the viewport. Both sides are typed (component region vs
    // the first camera segment's entry framing), so warn deterministically.
    if ((BRIDGED_STYLES.has(cut.style) || cut.style === "match") && cut.focalPartIn) {
      const toScene = scenesById.get(cut.toScene);
      const firstMove = toScene?.camera?.path[0];
      const entryFraming =
        firstMove?.fromPart ?? firstMove?.fromRegion ?? firstMove?.toPart ?? firstMove?.toRegion;
      const station = toScene?.components?.find(
        (component) => component.id === cut.focalPartIn,
      )?.region;
      if (
        entryFraming && station &&
        entryFraming !== station && entryFraming !== cut.focalPartIn
      ) {
        warnings.push(
          `cut ${cut.fromScene}->${cut.toScene} lands its bridge on "${cut.focalPartIn}" at station ` +
            `"${station}", but scene "${cut.toScene}" opens framed on "${entryFraming}" — the flight ` +
            `may land outside the entry framing; open the camera path on "${station}" or move the part`,
        );
      }
    }
    if (cut.focalPartOut && !partPattern(cut.focalPartOut).test(scopes.get(cut.fromScene) ?? html)) {
      errors.push(
        `cut ${cut.fromScene}->${cut.toScene} outgoing part "${cut.focalPartOut}" must exist as a ` +
          `data-part inside scene "${cut.fromScene}"`,
      );
    }
    if (cut.focalPartIn && !partPattern(cut.focalPartIn).test(scopes.get(cut.toScene) ?? html)) {
      errors.push(
        `cut ${cut.fromScene}->${cut.toScene} incoming part "${cut.focalPartIn}" must exist as a ` +
          `data-part inside scene "${cut.toScene}"`,
      );
    }
    // The runtime owns the scene wrapper's transform/filter/opacity around this
    // boundary. An authored tween on the same wrapper is the classic
    // two-owners bug; surface it rather than letting the timelines fight.
    for (const sceneId of [cut.fromScene, cut.toScene]) {
      const wrapperTween = new RegExp(
        `\\.(?:to|from|fromTo)\\(\\s*(["'])#${sceneId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`,
      );
      if (wrapperTween.test(html)) {
        warnings.push(
          `scene wrapper "#${sceneId}" has an authored tween while a typed cut owns its boundary; ` +
            `move that motion to an inner wrapper (e.g. data-camera-world) so one system owns each transform`,
        );
      }
    }
  }
  return { plan: parsed.plan, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

/** Windows (start, end) during which boundary motion is intentional. */
export function cutMotionWindows(plan: CutPlanV1 | undefined): Array<{ start: number; end: number }> {
  if (!plan) return [];
  return plan.cuts.map((cut) => ({
    start: cut.atSec - cut.exitSec - 0.05,
    end: cut.atSec + cut.entrySec + 0.05,
  }));
}
