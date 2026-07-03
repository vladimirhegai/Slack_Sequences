/**
 * Storyboard moments — the review contract for motion density.
 *
 * Scenes remain the render containers; a `StoryboardMomentV1` is one
 * *reviewable changed state* the film promises the viewer: a typed phrase, a
 * UI state change, a metric completing, a camera arrival, a cut landing, a
 * logo resolving. The planner declares them, the author realizes them, and
 * publication only succeeds when every moment binds to executable timeline
 * evidence (a cut, a typed camera move, an interaction, or an explicitly
 * positioned non-wrapper tween). Ambient drift alone can never mint a moment.
 *
 * Legacy storyboards without declared moments stay publishable: moments are
 * synthesized from the same activity evidence so the Slack review surface and
 * the density floor apply uniformly. The moment floor and interval contract
 * follow motion-density applicability (3+ scenes, 10s+ films).
 */
import { analyzeMotionDensity, type MotionActivity, type MotionDensityReport } from "./motionDensity.ts";
import type { DirectScene } from "./directComposition.ts";

export type MomentImportance = "primary" | "supporting";

export type MomentEvidenceKind = "cut" | "camera" | "interaction" | "component" | "tween";

export interface StoryboardMomentV1 {
  version: 1;
  id: string;
  sceneId: string;
  /** Absolute composition seconds at which the changed state is reviewable. */
  atSec: number;
  title: string;
  /** What the review frame shows at atSec. */
  visualState: string;
  /** What became meaningfully different at this moment. */
  change: string;
  /** type-on, ui-state, camera-arrival, cut, reveal, morph, resolve, ... */
  motionIntent: string;
  importance: MomentImportance;
  /**
   * Synthesized moments were derived from timeline evidence for a storyboard
   * that declared none. Absent means planner-declared. The strict interval
   * contract only holds *declared* plans to their promised grid, including
   * after the manifest round-trips.
   */
  origin?: "synthesized";
  /** Populated after authoring: the executable evidence this moment bound to. */
  evidence?: MomentEvidence;
}

export interface MomentEvidence {
  kind: MomentEvidenceKind;
  /** Safe mechanical detail, e.g. "cut:flash-white", "camera:pan→proof-panel". */
  detail: string;
  startSec: number;
  endSec: number;
}

export interface MomentContractResult {
  /** Ordered, evidence-bound moments (declared where given, synthesized otherwise). */
  moments: StoryboardMomentV1[];
  /** True when the moment floor/interval contract gates this film. */
  applies: boolean;
  synthesizedCount: number;
  errors: string[];
  warnings: string[];
}

/** Internal beats must land at least this often (plus a short final resolve). */
export const MAX_MOMENT_INTERVAL_SEC = 2.6;
export const FINAL_RESOLVE_ALLOWANCE_SEC = 3.25;
/** Evidence search window around a declared moment's atSec. */
const EVIDENCE_BEFORE_SEC = 0.45;
const EVIDENCE_AFTER_SEC = 0.75;
/** Synthesized moments closer than this merge into one reviewable state. */
const SYNTH_DEDUPE_SEC = 0.35;
const MAX_MOMENTS = 32;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Plan-time floor: roughly one reviewable moment per 2.25 seconds, with an
 * explicit minimum of 7 for 12s+ films. Short films scale down; sub-10s films
 * still need a skeleton of three declared moments.
 */
export function plannedMomentFloor(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  if (durationSec < 10) return 3;
  return Math.max(Math.round(durationSec / 2.25), durationSec >= 12 ? 7 : 4);
}

/**
 * Publication floor: slightly softer than the plan floor (evidence binding and
 * the interval contract carry the rest), but a 12–18s film can never publish
 * with fewer than 7 evidence-bound moments.
 */
export function publicationMomentFloor(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec < 10) return 0;
  return Math.max(durationSec >= 12 ? 7 : 4, Math.floor(durationSec / 3));
}

export function normalizeStoryboardMoments(
  value: unknown,
  scene: { sceneId: string; startSec: number; durationSec: number },
): StoryboardMomentV1[] {
  if (!Array.isArray(value)) return [];
  const sceneEnd = scene.startSec + scene.durationSec;
  const moments = value.flatMap((entry): StoryboardMomentV1[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const visualState = typeof item.visualState === "string" ? item.visualState.trim() : "";
    const change = typeof item.change === "string" ? item.change.trim() : "";
    const motionIntent = typeof item.motionIntent === "string" ? item.motionIntent.trim() : "";
    const importance = item.importance === "primary" ? "primary" : "supporting";
    const rawAtSec = Number(item.atSec);
    if (!id || !title || !change || !Number.isFinite(rawAtSec)) return [];
    // Models frequently restart timing at zero inside each scene even though
    // the schema asks for composition time. Treat an otherwise valid offset
    // before a later scene's start as scene-relative instead of clamping every
    // moment to the entrance (which fabricated dead zones and clustering).
    const atSec =
      scene.startSec > 0 &&
      rawAtSec >= 0 &&
      rawAtSec < scene.startSec &&
      rawAtSec <= scene.durationSec
        ? scene.startSec + rawAtSec
        : rawAtSec;
    return [{
      version: 1,
      id: /^[a-z][a-z0-9-]{0,63}$/.test(id) ? id : "",
      sceneId: scene.sceneId,
      atSec: round(Math.min(Math.max(atSec, scene.startSec), sceneEnd)),
      title: title.slice(0, 120),
      visualState: visualState.slice(0, 200),
      change: change.slice(0, 200),
      motionIntent: (motionIntent || "reveal").slice(0, 48),
      importance,
    }];
  }).filter((moment) => moment.id);
  return moments.sort((a, b) => a.atSec - b.atSec);
}

/**
 * Plan-time gate: reject storyboards that miss the moment floor, cluster all
 * of a scene's development at its entrance, repeat the same visual state, or
 * leave a long interval with no planned development. Runs before any source
 * is authored so a failed plan is cheap to retry.
 */
export function validatePlannedMoments(
  scenes: DirectScene[],
  durationSec: number,
): string[] {
  const errors: string[] = [];
  const applies = scenes.length >= 3 && durationSec >= 10;
  const moments = scenes.flatMap((scene) => scene.moments ?? []);
  const floor = plannedMomentFloor(durationSec);
  if (!applies && !moments.length) return errors;
  if (moments.length < floor) {
    errors.push(
      `storyboard/moments: a ${durationSec.toFixed(0)}s film must plan at least ${floor} ` +
        `storyboard moments (typed word, UI state change, metric completion, camera arrival, ` +
        `cut landing, or logo resolve); it plans ${moments.length}`,
    );
  }
  const ids = new Set<string>();
  for (const scene of scenes) {
    const sceneMoments = scene.moments ?? [];
    const sceneEnd = scene.startSec + scene.durationSec;
    for (const moment of sceneMoments) {
      if (ids.has(moment.id)) errors.push(`storyboard/moments: moment id "${moment.id}" is duplicated`);
      ids.add(moment.id);
      if (moment.atSec < scene.startSec - 0.01 || moment.atSec > sceneEnd + 0.01) {
        errors.push(
          `storyboard/moments: moment "${moment.id}" (${moment.atSec.toFixed(2)}s) escapes ` +
            `scene "${scene.id}" (${scene.startSec.toFixed(2)}–${sceneEnd.toFixed(2)}s)`,
        );
      }
    }
    if (
      applies &&
      scene.durationSec >= 4 &&
      sceneMoments.length >= 2 &&
      sceneMoments.every((moment) =>
        moment.atSec <= scene.startSec + scene.durationSec * 0.35
      )
    ) {
      errors.push(
        `storyboard/moments: scene "${scene.id}" clusters all its moments at the entrance; ` +
          `spread development across the shot (one moment in the back half)`,
      );
    }
  }
  const states = moments
    .map((moment) => moment.visualState.toLowerCase().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (let index = 1; index < states.length; index += 1) {
    if (states[index] && states[index] === states[index - 1]) {
      errors.push(
        "storyboard/moments: consecutive moments describe the same visualState; " +
          "each moment must show a meaningfully different frame",
      );
      break;
    }
  }
  if (applies && moments.length >= 2) {
    errors.push(...intervalErrors(
      moments.map((moment) => moment.atSec).sort((a, b) => a - b),
      durationSec,
      "planned",
    ));
  }
  return [...new Set(errors)];
}

function intervalErrors(
  times: number[],
  durationSec: number,
  label: string,
): string[] {
  const errors: string[] = [];
  let cursor = 0;
  for (const time of times) {
    if (time - cursor > MAX_MOMENT_INTERVAL_SEC) {
      errors.push(
        `storyboard/moments: no ${label} moment between ${cursor.toFixed(1)}s and ` +
          `${time.toFixed(1)}s (${(time - cursor).toFixed(1)}s) — the viewer gets no ` +
          `reviewable development; add a typed beat, UI state change, or camera arrival there`,
      );
    }
    cursor = Math.max(cursor, time);
  }
  if (durationSec - cursor > FINAL_RESOLVE_ALLOWANCE_SEC) {
    errors.push(
      `storyboard/moments: the final ${(durationSec - cursor).toFixed(1)}s after the last ` +
        `moment exceeds the short-resolve allowance (${FINAL_RESOLVE_ALLOWANCE_SEC}s); ` +
        `plan a late beat or shorten the resolve`,
    );
  }
  return errors;
}

function evidenceKind(activity: MotionActivity): MomentEvidenceKind {
  if (activity.source.startsWith("cut:") || activity.source === "scene-start") return "cut";
  if (activity.source.startsWith("camera:")) return "camera";
  if (activity.source.startsWith("interaction:")) return "interaction";
  if (activity.source.startsWith("component:")) return "component";
  return "tween";
}

function evidenceDetail(activity: MotionActivity): string {
  return activity.target ? `${activity.source}→${activity.target}` : activity.source;
}

function evidenceOf(activity: MotionActivity): MomentEvidence {
  return {
    kind: evidenceKind(activity),
    detail: evidenceDetail(activity).slice(0, 96),
    startSec: activity.startSec,
    endSec: activity.endSec,
  };
}

/** Activities that can prove a moment: anything but small connective motion. */
function evidenceActivities(report: MotionDensityReport): MotionActivity[] {
  return report.activities.filter((activity) => activity.kind !== "small");
}

function bindEvidence(
  moment: StoryboardMomentV1,
  activities: MotionActivity[],
): MomentEvidence | undefined {
  const windowStart = moment.atSec - EVIDENCE_BEFORE_SEC;
  const windowEnd = moment.atSec + EVIDENCE_AFTER_SEC;
  const overlapping = activities.filter((activity) =>
    activity.endSec >= windowStart && activity.startSec <= windowEnd
  );
  if (!overlapping.length) return undefined;
  const best = overlapping.sort((a, b) => {
    const rank = (activity: MotionActivity): number => (activity.kind === "major" ? 0 : 1);
    return rank(a) - rank(b) ||
      Math.abs(a.startSec - moment.atSec) - Math.abs(b.startSec - moment.atSec);
  })[0]!;
  return evidenceOf(best);
}

function synthesizedTitle(activity: MotionActivity, scene: DirectScene): string {
  if (activity.source === "scene-start") return `${scene.title} opens`;
  if (activity.source.startsWith("cut:")) {
    return `Cut (${activity.source.slice(4)})`;
  }
  if (activity.source.startsWith("camera:")) {
    const move = activity.source.slice(7);
    return activity.target ? `Camera ${move} → ${activity.target}` : `Camera ${move}`;
  }
  if (activity.source.startsWith("interaction:")) {
    const action = activity.source.slice(12);
    return activity.target ? `Cursor ${action} on ${activity.target}` : `Cursor ${action}`;
  }
  if (activity.source.startsWith("component:")) {
    const beat = activity.source.slice(10);
    return activity.target ? `Component ${beat}: ${activity.target}` : `Component ${beat}`;
  }
  const target = activity.target?.replace(/^[#.]/, "").replace(/[[\]"'=]/g, " ").trim();
  return target ? `Reveal: ${target}` : "Authored beat";
}

function synthesizeSceneMoments(
  scene: DirectScene,
  activities: MotionActivity[],
): StoryboardMomentV1[] {
  const sceneEnd = scene.startSec + scene.durationSec;
  const candidates = activities
    .filter((activity) =>
      activity.startSec >= scene.startSec - 0.05 && activity.startSec < sceneEnd - 0.02
    )
    .sort((a, b) => a.startSec - b.startSec ||
      (a.kind === "major" ? 0 : 1) - (b.kind === "major" ? 0 : 1));
  const moments: StoryboardMomentV1[] = [];
  for (const activity of candidates) {
    const last = moments[moments.length - 1];
    if (last && activity.startSec - last.atSec < SYNTH_DEDUPE_SEC) continue;
    moments.push({
      version: 1,
      id: `${scene.id}-m${moments.length + 1}`,
      sceneId: scene.id,
      atSec: round(Math.max(scene.startSec, activity.startSec)),
      title: synthesizedTitle(activity, scene).slice(0, 120),
      visualState: "",
      change: evidenceDetail(activity).slice(0, 200),
      motionIntent: evidenceKind(activity),
      importance: activity.kind === "major" ? "primary" : "supporting",
      origin: "synthesized",
      evidence: evidenceOf(activity),
    });
  }
  return moments;
}

/**
 * Publication gate + review artifact. Declared moments are bound to executable
 * evidence (unbound moments are blocking errors); scenes without declared
 * moments synthesize theirs from the same activity analysis so legacy films
 * remain publishable and every film exposes a real moment strip.
 */
export function resolveMomentContract(
  html: string,
  scenes: DirectScene[],
  durationSec: number | undefined,
  report?: MotionDensityReport,
): MomentContractResult {
  if (!Number.isFinite(durationSec) || durationSec === undefined || !scenes.length) {
    return { moments: [], applies: false, synthesizedCount: 0, errors: [], warnings: [] };
  }
  const density = report ?? analyzeMotionDensity(html, scenes, durationSec);
  const activities = evidenceActivities(density);
  const applies = scenes.length >= 3 && durationSec >= 10;
  const errors: string[] = [];
  const warnings: string[] = [];
  let synthesizedCount = 0;
  const moments: StoryboardMomentV1[] = [];
  for (const scene of scenes) {
    if (scene.moments?.length) {
      for (const moment of scene.moments) {
        const evidence = bindEvidence(moment, activities);
        if (!evidence) {
          errors.push(
            `storyboard/moments: moment "${moment.id}" (${moment.atSec.toFixed(2)}s, ` +
              `"${moment.title}") has no executable timeline evidence within ` +
              `${EVIDENCE_BEFORE_SEC}s/${EVIDENCE_AFTER_SEC}s — bind it to a typed cut, camera ` +
              `move, interaction, or an explicitly positioned non-wrapper tween at that time`,
          );
          moments.push(moment);
          continue;
        }
        moments.push({ ...moment, evidence });
      }
    } else {
      const synthesized = synthesizeSceneMoments(scene, activities);
      synthesizedCount += synthesized.length;
      moments.push(...synthesized);
    }
  }
  moments.sort((a, b) => a.atSec - b.atSec);
  const bounded = moments.slice(0, MAX_MOMENTS);
  if (applies) {
    const floor = publicationMomentFloor(durationSec);
    const bound = bounded.filter((moment) => moment.evidence);
    if (bound.length < floor) {
      errors.push(
        `storyboard/moments: a ${durationSec.toFixed(0)}s film must expose at least ${floor} ` +
          `evidence-bound storyboard moments; it exposes ${bound.length} — add mid-shot ` +
          `reveals, UI state changes, typed camera moves, or interactions with explicit times`,
      );
    }
    // The strict interval contract holds declared plans to their promised
    // moment grid. Synthesized moments come from static tween extraction,
    // which collapses loop-staggered beats and long covering tweens to their
    // start time — for those films the blocking activity-level quiet-gap
    // check in motionDensity owns the "nothing happens" contract instead.
    const allDeclared = scenes.every((scene) =>
      scene.moments?.some((moment) => moment.origin !== "synthesized")
    );
    if (allDeclared && bound.length >= 2) {
      errors.push(...intervalErrors(
        bound
          .filter((moment) => moment.origin !== "synthesized")
          .map((moment) => moment.atSec)
          .sort((a, b) => a - b),
        durationSec,
        "evidence-bound",
      ));
    }
    for (const scene of scenes) {
      const sceneMoments = bounded.filter((moment) =>
        moment.sceneId === scene.id && moment.evidence
      );
      if (
        scene.durationSec >= 4 &&
        sceneMoments.length >= 2 &&
        sceneMoments.every((moment) =>
          moment.atSec <= scene.startSec + scene.durationSec * 0.35
        )
      ) {
        warnings.push(
          `storyboard/moments: scene "${scene.id}" front-loads all its moments; ` +
            `move one reviewable state into the back half`,
        );
      }
    }
  }
  return {
    moments: bounded,
    applies,
    synthesizedCount,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}
