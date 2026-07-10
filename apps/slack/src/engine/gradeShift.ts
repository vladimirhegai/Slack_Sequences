/**
 * Animated grade shift (MD4) — the background color morph, narrowed to a
 * motivated turn of the film's temperature.
 *
 * A scene starts on its authored grade class; at `atSec` the fx runtime fades
 * in a full-frame panel wearing the TARGET grade class (its ::after paints
 * exactly that grade's steady wash), and at full cover swaps the scene's
 * grade class to `toGrade` while the panel drops out on identical pixels —
 * pure grading, held at the settled wash's own strength, no wipe geometry,
 * opacity only, no filter on the world. The turn CARRIES across cuts: later
 * scenes still wearing the pre-shift tone are re-classed at cover time until
 * the first deliberately re-graded scene. (`fromPart` survives in the schema
 * as a no-op anchor hint — the wash no longer expands from a point.)
 *
 * This module owns the typed declaration, its deterministic normalization, and
 * the always-drop-invalid governor (a volunteered garnish that fails the
 * discipline is dropped, never a veto — the `dropUnusableVolunteeredTimeRamps`
 * precedent). The compile lives in `fxContract.ts` + `sequences-fx.v1.js`; the
 * per-grade panel wash colors live in the cinema kit CSS.
 */
import type { DirectScene } from "./directComposition.ts";

export type GradeTone = "cold" | "neutral" | "warm" | "noir";

export const GRADE_TONES: readonly GradeTone[] = ["cold", "neutral", "warm", "noir"];

/** The panel scales to full cover over this window (seqSwoosh). */
export const GRADE_SHIFT_DURATION_SEC = 0.9;
/** After cover the new wash needs room to read before the scene ends. */
export const GRADE_SHIFT_MIN_AFTERMATH_SEC = 1.2;
/** How far a declared moment may sit from the shift and still motivate it. */
export const GRADE_SHIFT_MOMENT_TOLERANCE_SEC = 0.5;
export const MAX_GRADE_SHIFTS_PER_FILM = 2;

/** One typed mid-scene grade transition (times are absolute composition sec). */
export interface SceneGradeShiftV1 {
  version: 1;
  atSec: number;
  toGrade: GradeTone;
  /** Optional data-part the wash expands from (default: frame center). */
  fromPart?: string;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stableName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{0,63}$/.test(raw) ? raw : "";
}

/**
 * Shape-normalize a declared grade shift in the model's OWN scene frame (like
 * `normalizeStoryboardTimeRamp`): a finite atSec and a known toGrade are
 * required; a scene-relative atSec (authored from zero) is lifted into
 * composition time; fromPart is kept only when it is a stable id. The absolute
 * atSec is shifted by the re-basing delta by the caller.
 */
export function normalizeStoryboardGradeShift(
  value: unknown,
  scene: { startSec: number; durationSec: number },
): SceneGradeShiftV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const toGrade = typeof item.toGrade === "string" ? item.toGrade.trim().toLowerCase() : "";
  if (!GRADE_TONES.includes(toGrade as GradeTone)) return undefined;
  const rawAtSec = Number(item.atSec);
  if (!Number.isFinite(rawAtSec)) return undefined;
  const sceneEnd = scene.startSec + scene.durationSec;
  const atSec =
    scene.startSec > 0 && rawAtSec >= 0 && rawAtSec < scene.startSec && rawAtSec <= scene.durationSec
      ? scene.startSec + rawAtSec
      : rawAtSec;
  const fromPart = stableName(item.fromPart);
  return {
    version: 1,
    atSec: round(Math.min(Math.max(atSec, scene.startSec), sceneEnd)),
    toGrade: toGrade as GradeTone,
    ...(fromPart ? { fromPart } : {}),
  };
}

/**
 * Temperatures the film's OWN words can name for an animated grade turn.
 * warm/cold/noir are the visually meaningful shifts; a "neutral" turn is too
 * subtle to animate, so it is never auto-derived. Patterns are deliberately
 * specific (no bare "dark"/"glow") so an incidental word never mints a shift.
 */
const GRADE_WORD_PATTERNS: ReadonlyArray<[RegExp, GradeTone]> = [
  [/\b(?:warm(?:er|s|th|ing|ed)?|thaw(?:s|ed|ing)?|golden|amber|sunrise)\b/i, "warm"],
  [
    // Bare "cool" is everyday SaaS copy ("cool insights", "keep your team
    // cool") — only the inflected turn verbs (cools/cooling/cooled/cooler)
    // count as naming a temperature TURN.
    /\b(?:cold(?:er)?|cool(?:s|er|ing|ed)|chill(?:s|ed|ing|y)?|frost(?:y|ed)?|freez(?:e|es|ing)?|frozen|icy)\b/i,
    "cold",
  ],
  [/\b(?:noir|blackout|black-?out)\b/i, "noir"],
];

/** The tone a moment's own copy names, if any (first pattern in order wins). */
function momentGradeTone(text: string): GradeTone | undefined {
  for (const [pattern, tone] of GRADE_WORD_PATTERNS) {
    if (pattern.test(text)) return tone;
  }
  return undefined;
}

/**
 * MD4 host auto-derivation (the taste ladder, MOTION_DESIGN_PLAN §0): the
 * animated grade shift is the film's temperature turning at a payoff, but a
 * production planner (GLM z-ai/glm-5.2) narrates that turn in a MOMENT ("world
 * turns warm") while leaving the OPTIONAL scene `gradeShift` field blank — so
 * no shift ever ships even when the brief demanded one (md-audit-probe-4
 * declared the moment, omitted the field). The HOST mechanizes the planner's
 * OWN stated intent: when a scene declares no gradeShift and one of its
 * `primary` moments names a temperature (warm/cold/noir) in its
 * title/change/visualState AND has room for the new wash to read, inject a
 * gradeShift AT that moment turning to the named tone. This invents no color
 * decision — the tone is the model's own word, staying inside the color-arc
 * doctrine — and adds zero planner surface. The full discipline (window,
 * aftermath, <=1/scene, <=2/film, moment coincidence) remains owned by
 * [[dropUnusableGradeShifts]], which runs immediately after; pre-filtering the
 * aftermath here only picks an anchor that will survive it (SENTINEL L2,
 * degrade-never-veto).
 *
 * Auto-derivation is deliberately capped at ONE shift per film — a
 * problem→solution film turns temperature ONCE, at the payoff (MD4 §1.6: "the
 * story's temperature turning at a payoff"). A warm-naming moment in an
 * already-warm late scene would only re-wash to the same tone. The 2/film
 * budget stays available for a SECOND shift a planner explicitly declares.
 */
export function deriveGradeShifts(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; derived: string[] } {
  const derived: string[] = [];
  const scenes = storyboard.map((scene) => {
    if (scene.gradeShift || derived.length > 0) return scene; // one auto shift/film; never overwrite a declared one
    const sceneEnd = scene.startSec + scene.durationSec;
    const primaries = (scene.moments ?? []).filter((moment) => moment.importance === "primary");
    for (const moment of primaries) {
      // A shift needs aftermath to read — skip a temperature moment with no
      // room and let a later one anchor it (dropUnusableGradeShifts is the
      // authoritative governor; this just avoids deriving a doomed anchor).
      if (sceneEnd - moment.atSec < GRADE_SHIFT_MIN_AFTERMATH_SEC) continue;
      const tone = momentGradeTone(
        [moment.title, moment.change, moment.visualState].filter(Boolean).join(" "),
      );
      if (!tone) continue;
      derived.push(
        `scene "${scene.id}": derived gradeShift → ${tone} at ${round(moment.atSec)}s ` +
          `(primary moment "${moment.id}" names the temperature turn)`,
      );
      return {
        ...scene,
        gradeShift: { version: 1 as const, atSec: round(moment.atSec), toGrade: tone },
      };
    }
    return scene;
  });
  return { storyboard: scenes, derived };
}

/**
 * Deterministic discipline governor (SENTINEL L2, degrade-never-veto): a grade
 * shift is a volunteered garnish, so an undisciplined one is dropped with a
 * note rather than vetoing a paid attempt. Rules (plan §MD4): atSec inside the
 * scene with >= GRADE_SHIFT_MIN_AFTERMATH_SEC of aftermath, at most one per
 * scene, at most MAX_GRADE_SHIFTS_PER_FILM per film, and it must coincide
 * (+/-GRADE_SHIFT_MOMENT_TOLERANCE_SEC) with a declared moment — a shift IS a
 * story state change, so an unmotivated one has no reason to fire.
 */
export function dropUnusableGradeShifts(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; dropped: string[] } {
  const dropped: string[] = [];
  let filmShifts = 0;
  const scenes = storyboard.map((scene) => {
    if (!scene.gradeShift) return scene;
    const shift = scene.gradeShift;
    const sceneEnd = scene.startSec + scene.durationSec;
    let reason = "";
    if (shift.atSec < scene.startSec - 0.01 || shift.atSec > sceneEnd + 0.01) {
      reason = "atSec is outside the scene window";
    } else if (sceneEnd - shift.atSec < GRADE_SHIFT_MIN_AFTERMATH_SEC) {
      reason =
        `only ${(sceneEnd - shift.atSec).toFixed(1)}s of aftermath (needs ` +
        `>=${GRADE_SHIFT_MIN_AFTERMATH_SEC}s for the new wash to read)`;
    } else if (
      !(scene.moments ?? []).some((moment) =>
        Math.abs(moment.atSec - shift.atSec) <= GRADE_SHIFT_MOMENT_TOLERANCE_SEC
      )
    ) {
      reason = "no declared moment within +/-0.5s to motivate the temperature turn";
    } else if (filmShifts >= MAX_GRADE_SHIFTS_PER_FILM) {
      reason = `over the ${MAX_GRADE_SHIFTS_PER_FILM}-per-film cap`;
    }
    if (reason) {
      dropped.push(`scene "${scene.id}": dropped gradeShift → ${shift.toGrade} (${reason})`);
      const { gradeShift: _dropped, ...rest } = scene;
      return rest;
    }
    filmShifts += 1;
    return scene;
  });
  return { storyboard: scenes, dropped };
}
