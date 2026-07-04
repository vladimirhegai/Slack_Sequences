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
import { resolveTimeRampPlan, warpInverseOf } from "./timeRamp.ts";
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
    // Spacing and dead-interval floors judge the VIEWER's experience, so
    // they run in output time: a speed-ramp dip stretches the seconds around
    // a moment. Moment atSec itself stays content time everywhere else
    // (evidence binding compares it against timeline activities).
    const viewerTimeOf = warpInverseOf(resolveTimeRampPlan(scenes));
    errors.push(...intervalErrors(
      moments.map((moment) => viewerTimeOf(moment.atSec)).sort((a, b) => a - b),
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
      // Viewer-time conversion, matching validatePlannedMoments: the dead-
      // interval contract is about watched seconds, not timeline seconds.
      const viewerTimeOf = warpInverseOf(resolveTimeRampPlan(scenes));
      errors.push(...intervalErrors(
        bound
          .filter((moment) => moment.origin !== "synthesized")
          .map((moment) => viewerTimeOf(moment.atSec))
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

/* --------------------------------------------------- plan-time moment top-up */

/**
 * A typed plan event the host can promise as a moment: cuts, full camera
 * moves, component beats, and cursor interactions are all compiled/enforced
 * deterministically from the locked storyboard, so a moment declared on one is
 * guaranteed to bind at publication.
 */
interface MomentAnchor {
  sceneId: string;
  /** Content (composition) seconds. */
  atSec: number;
  /** Viewer (output) seconds — what the interval contract judges. */
  viewerSec: number;
  title: string;
  visualState: string;
  change: string;
  motionIntent: string;
}

export interface MomentTopUpResult {
  storyboard: DirectScene[];
  /** Host-declared moments that were added (empty when the plan already complied). */
  added: StoryboardMomentV1[];
}

/** Minimum viewer-time separation between a filler and its predecessor. */
const TOP_UP_MIN_STEP_SEC = 0.15;
/** Fillers stay a hair under the ceiling so float drift can't re-trigger it. */
const TOP_UP_CEILING_MARGIN_SEC = 0.1;
/** Floor top-ups must be reviewably distinct from every existing moment. */
const TOP_UP_FLOOR_SEPARATION_SEC = 0.3;

function collectMomentAnchors(
  scenes: DirectScene[],
  viewerTimeOf: (contentSec: number) => number,
  fullCameraMoves: ReadonlySet<string>,
): MomentAnchor[] {
  const anchors: MomentAnchor[] = [];
  for (const [index, scene] of scenes.entries()) {
    const sceneEnd = scene.startSec + scene.durationSec;
    if (index > 0) {
      const style = scenes[index - 1]?.cut?.style ?? "hard";
      anchors.push({
        sceneId: scene.id,
        atSec: round(scene.startSec),
        viewerSec: viewerTimeOf(scene.startSec),
        title: `Cut lands: ${scene.title}`.slice(0, 120),
        visualState: `${scene.title} entry framing after the ${style} cut`.slice(0, 200),
        change: `cut (${style}) into ${scene.id}`.slice(0, 200),
        motionIntent: "cut",
      });
    }
    for (const move of scene.camera?.path ?? []) {
      if (!fullCameraMoves.has(move.move)) continue;
      const arrival = Math.min(move.startSec + move.durationSec, sceneEnd);
      const target = move.toRegion ?? move.toPart ?? "new framing";
      anchors.push({
        sceneId: scene.id,
        atSec: round(arrival),
        viewerSec: viewerTimeOf(arrival),
        title: `Camera ${move.move} lands on ${target}`.slice(0, 120),
        visualState:
          `camera framed on ${target} in ${scene.id} at ${arrival.toFixed(1)}s`.slice(0, 200),
        change: `camera ${move.move} arrival at ${target}`.slice(0, 200),
        motionIntent: "camera-arrival",
      });
    }
    for (const beat of scene.beats ?? []) {
      const intent =
        beat.kind === "type" || beat.kind === "stream" ? "type-on" :
        beat.kind === "morph" ? "morph" : "ui-state";
      anchors.push({
        sceneId: scene.id,
        atSec: round(Math.min(Math.max(beat.atSec, scene.startSec), sceneEnd)),
        viewerSec: viewerTimeOf(beat.atSec),
        title: `${beat.component}: ${beat.kind}`.slice(0, 120),
        visualState: `${beat.component} after its ${beat.kind} beat (${beat.id})`.slice(0, 200),
        change: `component beat ${beat.id} (${beat.kind}) fires on ${beat.component}`.slice(0, 200),
        motionIntent: intent,
      });
    }
    for (const interaction of scene.interactions ?? []) {
      const at = Math.min(Math.max(interaction.arriveSec, scene.startSec), sceneEnd);
      anchors.push({
        sceneId: scene.id,
        atSec: round(at),
        viewerSec: viewerTimeOf(at),
        title: `Cursor ${interaction.action} on ${interaction.targetPart}`.slice(0, 120),
        visualState: `cursor arrives on ${interaction.targetPart}`.slice(0, 200),
        change: `cursor ${interaction.action} reaches ${interaction.targetPart}`.slice(0, 200),
        motionIntent: "ui-state",
      });
    }
  }
  return anchors.sort((a, b) => a.viewerSec - b.viewerSec);
}

/**
 * Deterministically top up a storyboard's declared moments from its own typed
 * evidence, so a plan is never vetoed for missing moment *paperwork* the plan
 * itself already proves. This was the live 2026-07-04 fallback root cause:
 * GLM storyboards with rich typed beats/camera/cuts kept dying on marginal
 * `no planned moment between Xs and Ys` findings — each retry fixed one gap
 * and opened another until the ugly deterministic fallback shipped.
 *
 * Only host-compiled event kinds are used as anchors (cut landings, full
 * camera-move arrivals, component beats, cursor interactions), so every added
 * moment is guaranteed to bind to executable evidence at publication. Added
 * moments are regular declared moments — the author receives them like any
 * other and the publication interval contract counts them. The function is
 * additive and idempotent: a compliant plan comes back unchanged, and genuine
 * dead air (a gap with no typed evidence at all) is left for the findings
 * retry to solve creatively.
 */
export function topUpStoryboardMoments(
  scenes: DirectScene[],
  fullCameraMoves: ReadonlySet<string>,
): MomentTopUpResult {
  if (!scenes.length) return { storyboard: scenes, added: [] };
  const durationSec = scenes.reduce(
    (end, scene) => Math.max(end, scene.startSec + scene.durationSec),
    0,
  );
  const declared = scenes.flatMap((scene) => scene.moments ?? []);
  const applies = scenes.length >= 3 && durationSec >= 10;
  // Short films with zero declared moments are exempt from the whole contract;
  // adding moments there would only *create* a floor obligation.
  if (!applies && !declared.length) return { storyboard: scenes, added: [] };

  const viewerTimeOf = warpInverseOf(resolveTimeRampPlan(scenes));
  const anchors = collectMomentAnchors(scenes, viewerTimeOf, fullCameraMoves);
  const used = new Set<MomentAnchor>();
  const declaredViewerTimes = declared
    .map((moment) => viewerTimeOf(moment.atSec))
    .sort((a, b) => a - b);
  const chosen: MomentAnchor[] = [];
  const momentViewerTimes = (): number[] =>
    [...declaredViewerTimes, ...chosen.map((anchor) => anchor.viewerSec)]
      .sort((a, b) => a - b);

  const pickLatestBefore = (afterSec: number, beforeSec: number): MomentAnchor | undefined => {
    let best: MomentAnchor | undefined;
    for (const anchor of anchors) {
      if (used.has(anchor)) continue;
      if (anchor.viewerSec <= afterSec + TOP_UP_MIN_STEP_SEC) continue;
      if (anchor.viewerSec > beforeSec) break;
      best = anchor;
    }
    return best;
  };

  // 1. Interval contract: subdivide every dead gap with the latest usable
  //    anchor, exactly the walk intervalErrors performs.
  if (applies) {
    const step = MAX_MOMENT_INTERVAL_SEC - TOP_UP_CEILING_MARGIN_SEC;
    let cursor = 0;
    const targets = [...declaredViewerTimes, undefined];
    for (const target of targets) {
      const limit = target ?? durationSec;
      const allowance = target === undefined ? FINAL_RESOLVE_ALLOWANCE_SEC : MAX_MOMENT_INTERVAL_SEC;
      while (limit - cursor > allowance) {
        const anchor = pickLatestBefore(cursor, Math.min(cursor + step, limit - TOP_UP_MIN_STEP_SEC));
        if (!anchor) break; // genuine dead air — leave it to the findings retry
        used.add(anchor);
        chosen.push(anchor);
        cursor = anchor.viewerSec;
      }
      if (target !== undefined) cursor = Math.max(cursor, target);
    }
  }

  // 2. Entrance clustering: a 4s+ scene whose declared moments all sit in the
  //    front 35% gets one typed back-half anchor.
  if (applies) {
    for (const scene of scenes) {
      const sceneMoments = [
        ...(scene.moments ?? []).map((moment) => moment.atSec),
        ...chosen.filter((anchor) => anchor.sceneId === scene.id).map((anchor) => anchor.atSec),
      ];
      if (scene.durationSec < 4 || sceneMoments.length < 2) continue;
      const frontEdge = scene.startSec + scene.durationSec * 0.35;
      if (sceneMoments.some((atSec) => atSec > frontEdge)) continue;
      let best: MomentAnchor | undefined;
      for (const anchor of anchors) {
        if (used.has(anchor) || anchor.sceneId !== scene.id) continue;
        if (anchor.atSec <= frontEdge + 0.05) continue;
        if (!best || anchor.atSec > best.atSec) best = anchor;
      }
      if (best) {
        used.add(best);
        chosen.push(best);
      }
    }
  }

  // 3. Moment floor: add the anchors farthest from every existing moment until
  //    the plan floor is met or distinct anchors run out.
  const floor = plannedMomentFloor(durationSec);
  while (declared.length + chosen.length < floor) {
    const times = momentViewerTimes();
    let best: MomentAnchor | undefined;
    let bestDistance = 0;
    for (const anchor of anchors) {
      if (used.has(anchor)) continue;
      const distance = times.length
        ? Math.min(...times.map((time) => Math.abs(time - anchor.viewerSec)))
        : Number.POSITIVE_INFINITY;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = anchor;
      }
    }
    if (!best || bestDistance < TOP_UP_FLOOR_SEPARATION_SEC) break;
    used.add(best);
    chosen.push(best);
  }

  if (!chosen.length) return { storyboard: scenes, added: [] };

  const existingIds = new Set(declared.map((moment) => moment.id));
  const added: StoryboardMomentV1[] = [];
  const bySceneId = new Map<string, StoryboardMomentV1[]>();
  for (const anchor of chosen.sort((a, b) => a.atSec - b.atSec)) {
    const sceneSlug = /^[a-z][a-z0-9-]*$/.test(anchor.sceneId) ? anchor.sceneId : "shot";
    let serial = 1;
    let id = `${sceneSlug}-auto-${serial}`;
    while (existingIds.has(id)) {
      serial += 1;
      id = `${sceneSlug}-auto-${serial}`;
    }
    existingIds.add(id);
    const moment: StoryboardMomentV1 = {
      version: 1,
      id,
      sceneId: anchor.sceneId,
      atSec: anchor.atSec,
      title: anchor.title,
      visualState: anchor.visualState,
      change: anchor.change,
      motionIntent: anchor.motionIntent,
      importance: "supporting",
    };
    added.push(moment);
    const bucket = bySceneId.get(anchor.sceneId) ?? [];
    bucket.push(moment);
    bySceneId.set(anchor.sceneId, bucket);
  }
  const storyboard = scenes.map((scene) => {
    const additions = bySceneId.get(scene.id);
    if (!additions?.length) return scene;
    return {
      ...scene,
      moments: [...(scene.moments ?? []), ...additions].sort((a, b) => a.atSec - b.atSec),
    };
  });
  return { storyboard, added };
}
