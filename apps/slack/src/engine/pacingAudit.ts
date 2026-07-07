/**
 * Hold-what-matters pacing audits (WS3) — deterministic, plan-stage findings
 * run at storyboard validation beside `auditCameraEnergy` and
 * `auditComponentComplexity` (same findings-retry plumbing: a violation costs
 * one cheap storyboard retry, never an author attempt).
 *
 * The craft model these rules encode (operator verdict on probe-cutfix-3,
 * 2026-07-04: "important frames should stay on screen longer after
 * introducing many assets … not built for the eyes"):
 *
 * 1. Introduced surfaces need development time — a scene that keeps
 *    introducing until its cut gives the viewer nothing to read. This holds
 *    from ONE introduction up (a lone dense window opened at 90% of the scene
 *    is unreadable too); the only exemption is a short final resolve card.
 * 2. Text must stay readable for its length before the frame cuts or whips
 *    away — typed AND swapped-in copy get the word-count floor, and a primary
 *    moment promising headline copy without a typed beat gets the minimum
 *    floor. A camera move already in flight when the copy lands counts as an
 *    immediate framing change (hold = 0), not a free pass.
 * 3. Hold on outcomes longer than actions — the result of a press matters
 *    more than the press.
 * 4. Camera density has a ceiling as well as a floor: today only
 *    under-movement blocks, so the system structurally rewards churn.
 *
 * Every finding asks for a fix (extend, move, or drop) rather than vetoing a
 * creative addition, and every fix hint carries the "hold ≠ freeze" language
 * so the model does not thrash between these gates and the liveness gate
 * (quiet gap > ~2.5-3s is blocking): a held framing developed by a
 * count/progress/highlight beat satisfies both.
 *
 * All windows are judged in VIEWER (output) time: a timeRamp dip stretches
 * the content seconds it covers, so spans convert through `warpInverseOf`
 * before comparison, like the temporal judge and motion-density passes.
 */
import {
  CAMERA_FULL_MOVES,
  HIGH_ENERGY_PUSH_ZOOM,
  cameraMoveZoom,
  diveWindows,
  type CameraMoveIntentV1,
} from "./cameraContract.ts";
import { resolveComponentPlan, type ResolvedComponentBeatV1 } from "./componentContract.ts";
import {
  EVIDENCE_AFTER_SEC,
  EVIDENCE_BEFORE_SEC,
  FINAL_RESOLVE_ALLOWANCE_SEC,
} from "./storyboardMoments.ts";
import { resolveTimeRampPlan, warpInverseOf } from "./timeRamp.ts";
import type { DirectScene } from "./directComposition.ts";

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Seconds of post-introduction development each introduced surface needs. */
export const DEVELOPMENT_SEC_PER_INTRODUCTION = 0.9;
/** The last introduction must land by this fraction of the scene window. */
export const LAST_INTRODUCTION_MAX_FRACTION = 0.65;
/** Reading floor per word for typed copy, and its clamp bounds. */
export const READING_SEC_PER_WORD = 0.3;
export const READING_MIN_SEC = 1.2;
export const READING_MAX_SEC = 4;
/** Minimum hold after a payoff beat before the next framing change. */
export const OUTCOME_HOLD_SEC = 0.8;
/** An `assemble` headline is a resolve gesture — its lock holds at least this. */
export const ASSEMBLE_HOLD_SEC = 1.2;
/** Full camera moves allowed per scene: 1 + floor(duration / this). */
export const CAMERA_BUDGET_WINDOW_SEC = 3.5;
/** Whips allowed per film. */
export const MAX_WHIPS_PER_FILM = 2;
/**
 * Shortfall below which a time-window finding stays silent. A paid storyboard
 * attempt must never be vetoed over a marginal miss (live probe
 * `improve-ws32-1`: a rescue-rung plan died SOLELY on a 0.2s reading-time
 * shortfall) — the finding text still demands the full window, but only a
 * meaningful violation blocks.
 */
export const PACING_TOLERANCE_SEC = 0.35;
/**
 * Largest reading/outcome-hold shortfall that gets closed by stretching the
 * scene's own cut boundary (and cascade-shifting every later scene) instead
 * of being reported to the model as a findings-retry. A miss this size is
 * mechanical arithmetic (extend a cut by under a second); a larger one is a
 * genuine creative deficit and stays blocking, per Sentinel's decision rule
 * (SENTINEL_PLAN.md §3 Phase 3.1: normalize what deletes/degrades/retimes,
 * send content deficits back to the model).
 */
export const MAX_PACING_STRETCH_SEC = 1.0;

/** Beat kinds that put a NEW surface (or new content) in front of the viewer. */
const ENTRANCE_BEAT_KINDS = new Set(["open", "rows", "swap"]);
/**
 * Component kinds compact enough to land late in a short final resolve (a
 * logo / CTA / metric end card is read in one glance). Dense surfaces —
 * windows, tables, terminals, charts, palettes — never qualify: one of those
 * introduced at 90% of the last scene is exactly the unreadable ending the
 * holds rule exists for.
 */
const COMPACT_RESOLVE_KINDS = new Set([
  "button", "stat-card", "toast", "toggle", "progress", "progress-ring", "avatar-stack",
]);
/** Beat kinds whose landing is a payoff the viewer must see resolve. */
const PAYOFF_BEAT_KINDS = new Set(["press", "set-state"]);

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** One instant at which the framing visibly changes, and how long that change
 * stays in flight. Ordinary full moves contribute one event; a `dive` (MD5)
 * contributes two — the push-in and the pull-back — because its HELD middle is
 * development time, not churn: a beat settling inside the hold is framed and
 * readable until the pull-back starts. */
export interface FramingChangeEvent {
  changeAt: number;
  activeUntil: number;
}

export function framingChangeEvents(fullMoves: CameraMoveIntentV1[]): FramingChangeEvent[] {
  return fullMoves.flatMap((move): FramingChangeEvent[] => {
    if (move.move === "dive") {
      const legs = diveWindows(move);
      const end = move.startSec + move.durationSec;
      return [
        { changeAt: move.startSec, activeUntil: move.startSec + legs.inSec },
        { changeAt: end - legs.outSec, activeUntil: end },
      ];
    }
    return [{
      changeAt: move.startSec,
      activeUntil: move.startSec + move.durationSec,
    }];
  });
}

/** The framing-change resolver shared by the audit and both normalizers. */
export function nextFramingChangeAfter(
  events: FramingChangeEvent[],
  afterSec: number,
  sceneEnd: number,
): number {
  let next = sceneEnd;
  for (const event of events) {
    if (event.activeUntil <= afterSec - 0.05) continue;
    next = Math.min(next, Math.max(afterSec, event.changeAt));
  }
  return Math.min(sceneEnd, next);
}

/**
 * Introduction events for one scene: each declared component appears once (at
 * its first entrance-class beat, else at the scene start where the author
 * entrances it), and each additional swap beat re-fills an existing surface
 * with new content the viewer must re-read.
 */
export function sceneIntroductionTimes(scene: DirectScene): number[] {
  const components = scene.components ?? [];
  if (!components.length) return [];
  const beats = scene.beats ?? [];
  const events: number[] = [];
  const usedBeatIds = new Set<string>();
  for (const component of components) {
    const entrance = beats
      .filter((beat) => beat.component === component.id && ENTRANCE_BEAT_KINDS.has(beat.kind))
      .sort((a, b) => a.atSec - b.atSec)[0];
    if (entrance) usedBeatIds.add(entrance.id);
    events.push(entrance ? entrance.atSec : scene.startSec);
  }
  for (const beat of beats) {
    if (beat.kind === "swap" && !usedBeatIds.has(beat.id)) events.push(beat.atSec);
  }
  return events.sort((a, b) => a - b);
}

/**
 * Deterministic pacing audit over a parsed (post top-up) storyboard. Returns
 * blocking storyboard-validation findings, one per violation, phrased so a
 * findings-retry can fix them precisely.
 */
export function auditPacing(storyboard: DirectScene[]): string[] {
  const findings: string[] = [];
  // Content seconds → viewer seconds (identity when no timeRamp is declared).
  const toViewer = warpInverseOf(resolveTimeRampPlan(storyboard));
  const viewerSpan = (fromSec: number, toSec: number): number =>
    Math.max(0, toViewer(toSec) - toViewer(fromSec));
  const resolvedBeats = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );

  let whipCount = 0;
  for (const scene of storyboard) {
    const sceneEnd = scene.startSec + scene.durationSec;
    const path = scene.camera?.path ?? [];
    const fullMoves = path.filter((move) => CAMERA_FULL_MOVES.has(move.move));
    whipCount += path.filter((move) => move.move === "whip").length;

    // 4. Camera-segment budget: the counterweight to the density floor. The
    // parsed path is already compound-merged, so a pan+push pair the resolver
    // fuses counts as one move here too.
    const moveCap = 1 + Math.floor(scene.durationSec / CAMERA_BUDGET_WINDOW_SEC);
    if (fullMoves.length > moveCap) {
      findings.push(
        `pacing/camera-budget: scene "${scene.id}" (${scene.durationSec.toFixed(1)}s) declares ` +
          `${fullMoves.length} full camera moves — a window that length supports at most ` +
          `${moveCap} reframes before the film reads as churn. Cut the least motivated ` +
          `move(s); a drift or hold develops the current framing without spending a new one`,
      );
    }

    // 1. Introduction → development ratio. The contract is per scene, not
    // only multi-surface scenes: ONE dense window opened at 90% of the scene
    // still needs time to be read. The single narrow exemption is a short
    // final resolve (a logo/CTA-class COMPACT surface inside the moment
    // contract's final-resolve allowance, introducing one surface) — that
    // landing late is the genre's signature, not a defect. A dense kind in
    // the same slot stays judged.
    const introductions = sceneIntroductionTimes(scene);
    const isShortFinalResolve =
      scene === storyboard[storyboard.length - 1] &&
      scene.durationSec <= FINAL_RESOLVE_ALLOWANCE_SEC &&
      introductions.length === 1 &&
      COMPACT_RESOLVE_KINDS.has(scene.components?.[0]?.kind ?? "");
    if (introductions.length >= 1 && !isShortFinalResolve) {
      const lastIntro = introductions[introductions.length - 1]!;
      // The 65% deadline is a viewer-time promise: under a slow-motion ramp
      // 65% of content time is not 65% of what the viewer experiences, so
      // both sides of the comparison convert through the warp.
      const viewerStart = toViewer(scene.startSec);
      const viewerLength = viewerSpan(scene.startSec, sceneEnd);
      const viewerIntro = toViewer(lastIntro);
      const lateCap = viewerStart + viewerLength * LAST_INTRODUCTION_MAX_FRACTION;
      const introFraction = viewerLength > 0 ? (viewerIntro - viewerStart) / viewerLength : 0;
      const development = viewerSpan(lastIntro, sceneEnd);
      const needed = DEVELOPMENT_SEC_PER_INTRODUCTION * introductions.length;
      if (
        viewerIntro > lateCap + PACING_TOLERANCE_SEC ||
        development + PACING_TOLERANCE_SEC < needed
      ) {
        findings.push(
          `pacing/holds: scene "${scene.id}" introduces ${introductions.length} surface(s) with ` +
            `the last landing at ${lastIntro.toFixed(1)}s ` +
            `(${Math.round(introFraction * 100)}% into the ` +
            `scene) and only ${development.toFixed(1)}s of development after it — a viewer ` +
            `needs ~${needed.toFixed(1)}s to read them. Extend the scene, move an ` +
            `introduction earlier (or out), or drop a surface. A hold is not a freeze: ` +
            `develop the held surfaces with count/progress/highlight beats instead of ` +
            `introducing more`,
        );
      }
    }

    const beats = resolvedBeats.get(scene.id) ?? [];
    const componentKinds = new Map(
      (scene.components ?? []).map((component) => [component.id, component.kind]),
    );
    // The next framing change after a content beat: the scene's own cut, or
    // the first framing-change EVENT after the beat settles. A move already
    // IN FLIGHT when the beat settles is an immediate framing conflict
    // (available hold = 0) — except a dive's held middle, which is exactly
    // the "hold ≠ freeze" pattern: the typed beat develops the held frame
    // until the pull-back leg begins.
    const changeEvents = framingChangeEvents(fullMoves);
    const nextFramingChange = (afterSec: number): number =>
      nextFramingChangeAfter(changeEvents, afterSec, sceneEnd);

    for (const beat of beats) {
      // 2. Reading-time floor for typed/swapped copy — swap re-fills a live
      // surface with new text the viewer must re-read, so it gets the same
      // floor as type.
      if ((beat.kind === "type" || beat.kind === "swap") && beat.text) {
        const wordCount = words(beat.text);
        const needed = Math.min(
          READING_MAX_SEC,
          Math.max(READING_MIN_SEC, READING_SEC_PER_WORD * wordCount),
        );
        const visibleUntil = nextFramingChange(beat.endSec);
        const available = viewerSpan(beat.endSec, visibleUntil);
        if (available + PACING_TOLERANCE_SEC < needed) {
          findings.push(
            `pacing/reading: scene "${scene.id}" beat "${beat.id}" ` +
              `${beat.kind === "swap" ? "swaps in" : "finishes typing"} ` +
              `${wordCount} word(s) at ${beat.endSec.toFixed(1)}s but the framing changes ` +
              `${available.toFixed(1)}s later — that line needs ~${needed.toFixed(1)}s of ` +
              `reading time. Type it earlier, shorten the copy, or push the next ` +
              `cut/camera move later (hold ≠ freeze: a count/progress beat may develop the ` +
              `frame while the text stays readable)`,
          );
        }
      }
      // 2c. Assemble lock hold (MD3): the film's loudest text gesture is a
      // resolve, not a drive-by — its word must hold on screen >=1.2s after the
      // letters lock before the frame reframes or cuts (judged in viewer time).
      if (beat.kind === "type" && beat.style === "assemble") {
        const holdUntil = nextFramingChange(beat.endSec);
        const hold = viewerSpan(beat.endSec, holdUntil);
        if (hold + PACING_TOLERANCE_SEC < ASSEMBLE_HOLD_SEC) {
          findings.push(
            `pacing/assemble: scene "${scene.id}" beat "${beat.id}" assembles "${beat.component}" ` +
              `at ${beat.endSec.toFixed(1)}s but the framing changes ${hold.toFixed(1)}s later — ` +
              `an assemble is a thesis resolve; leave >=${ASSEMBLE_HOLD_SEC}s after the lock ` +
              `before the next cut or camera move (land it earlier or push the reframe later)`,
          );
        }
      }
      // 3. Outcome holds (headline-class moments get their own floor below).
      const isToastOpen = beat.kind === "open" && componentKinds.get(beat.component) === "toast";
      if (PAYOFF_BEAT_KINDS.has(beat.kind) || isToastOpen) {
        const holdUntil = nextFramingChange(beat.endSec);
        const hold = viewerSpan(beat.endSec, holdUntil);
        if (hold + PACING_TOLERANCE_SEC < OUTCOME_HOLD_SEC) {
          findings.push(
            `pacing/outcome: scene "${scene.id}" beat "${beat.id}" (${beat.kind} on ` +
              `"${beat.component}") lands its payoff at ${beat.endSec.toFixed(1)}s but the ` +
              `framing changes only ${hold.toFixed(1)}s later — hold on outcomes longer than ` +
              `actions: leave >=${OUTCOME_HOLD_SEC}s before the next cut or camera move ` +
              `(move the beat earlier, or delay the reframe), so the viewer sees the result ` +
              `settle`,
          );
        }
      }
    }

    // 2b. Headline-class moments: a primary moment that PROMISES on-screen
    // copy (type-on / headline motion intent) but has no typed/swap beat
    // carrying it — a statically-authored headline — still needs the minimum
    // reading window before the frame reframes or cuts. Word count is
    // unknowable at plan time (the copy lives in the authored HTML), so the
    // floor is READING_MIN_SEC, judged in viewer time like everything else.
    const copyBeatWindows = beats
      .filter((beat) => (beat.kind === "type" || beat.kind === "swap") && beat.text)
      .map((beat) => ({ from: beat.startSec - 0.3, to: beat.endSec + 0.3 }));
    for (const moment of scene.moments ?? []) {
      if (moment.importance !== "primary") continue;
      const intent = moment.motionIntent.toLowerCase();
      // Word-start match: "type-on"/"typed"/"typewriter" promise copy;
      // "prototype reveal" does not.
      if (!/\btype/.test(intent) && !intent.includes("headline")) continue;
      // A moment riding a typed beat already got the word-count floor above.
      if (copyBeatWindows.some((window) => moment.atSec >= window.from && moment.atSec <= window.to)) {
        continue;
      }
      const visibleUntil = nextFramingChange(moment.atSec);
      const available = viewerSpan(moment.atSec, visibleUntil);
      if (available + PACING_TOLERANCE_SEC < READING_MIN_SEC) {
        findings.push(
          `pacing/reading: scene "${scene.id}" moment "${moment.id}" promises headline copy ` +
            `("${moment.title}") at ${moment.atSec.toFixed(1)}s but the framing changes ` +
            `${available.toFixed(1)}s later — a headline needs >=${READING_MIN_SEC.toFixed(1)}s ` +
            `on screen. Land it earlier or push the next cut/camera move later (hold ≠ ` +
            `freeze: a count/progress beat may develop the frame while the copy stays ` +
            `readable)`,
        );
      }
    }
  }

  if (whipCount > MAX_WHIPS_PER_FILM) {
    findings.push(
      `pacing/camera-budget: the film declares ${whipCount} whips — at most ` +
        `${MAX_WHIPS_PER_FILM} per film. Keep the two that mark real energy peaks and let ` +
        `pans/drifts do the connective travel; whip everywhere reads as noise, not energy`,
    );
  }
  return findings;
}

/**
 * Energy rank for a full camera move — higher survives a per-scene budget
 * clamp. Mirrors `auditCameraEnergy`'s own high-energy test (whip/orbit, or a
 * push/pull that commits to `HIGH_ENERGY_PUSH_ZOOM`+) so a clamp never
 * sacrifices the film's one required peak to satisfy a budget.
 */
function cameraMoveEnergyRank(move: CameraMoveIntentV1): number {
  if (move.move === "whip" || move.move === "orbit") return 2;
  if (cameraMoveZoom(move) >= HIGH_ENERGY_PUSH_ZOOM) return 2;
  // A dive exists to serve a typed beat — it outranks connective reframes so
  // a budget clamp never sacrifices the move the beat depends on.
  if (move.move === "push-in" || move.move === "pull-back" || move.move === "dive") return 1;
  return 0;
}

/**
 * A camera move is LOAD-BEARING when a declared moment's evidence-search
 * window (storyboardMoments.ts) overlaps it: publication may bind that moment
 * to this move's arrival, so silently dropping the move could orphan the
 * moment at publication time and burn a paid author attempt — the same
 * "never silently change evidence a moment binds to" rule as
 * degradeUnsupportedComponentBeats. Load-bearing moves survive every clamp;
 * when a budget cannot be met without dropping one, the scene keeps its
 * blocking finding (the parse-side convergence check then reverts the whole
 * normalization).
 */
export function isLoadBearingMove(scene: DirectScene, move: CameraMoveIntentV1): boolean {
  const moveEnd = move.startSec + move.durationSec;
  return (scene.moments ?? []).some((moment) =>
    moveEnd >= moment.atSec - EVIDENCE_BEFORE_SEC &&
    move.startSec <= moment.atSec + EVIDENCE_AFTER_SEC
  );
}

/** Append host-normalization notes a scene carries into STORYBOARD.md. */
export function withNormalizationNotes(scene: DirectScene, notes: string[]): DirectScene {
  if (!notes.length) return scene;
  return {
    ...scene,
    sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), ...notes],
  };
}

/**
 * Sentinel Phase 3 normalize-before-retry: mechanically clamp camera-move
 * counts to `auditPacing`'s own ceilings instead of sending an over-dense
 * storyboard back to the model for a findings-retry. This deletes/degrades
 * only — it never invents a move, a target, or a timing the model didn't
 * already declare, so it is a normalization (L2), not a creative rewrite.
 *
 * 1. Per-scene full-move budget: drop the lowest-energy extra move(s) down to
 *    `1 + floor(durationSec / CAMERA_BUDGET_WINDOW_SEC)` (auditPacing's own
 *    cap). A dropped move leaves a gap the downstream camera resolver already
 *    auto-fills with a drift/creep segment (see cameraContract.ts) — exactly
 *    the finding's own suggested fix ("a drift or hold develops the current
 *    framing without spending a new one").
 * 2. Film-wide whip budget: keep the earliest `MAX_WHIPS_PER_FILM` whips
 *    chronologically, drop the rest — "drop the 3rd+ whip" per the plan.
 *
 * A scene's `camera` is dropped entirely (never left with an empty `path`)
 * if a clamp would otherwise empty it — camera is an enhancement, never a
 * veto, matching the rest of this contract's degrade philosophy.
 */
export function normalizeCameraBudget(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  let scenes = storyboard.map((scene) => ({ ...scene }));

  scenes = scenes.map((scene) => {
    const path = scene.camera?.path;
    if (!path || !path.length) return scene;
    const moveCap = 1 + Math.floor(scene.durationSec / CAMERA_BUDGET_WINDOW_SEC);
    const fullMoveEntries = path
      .map((move, index) => ({ move, index }))
      .filter((entry) => CAMERA_FULL_MOVES.has(entry.move.move));
    if (fullMoveEntries.length <= moveCap) return scene;
    const toDrop = fullMoveEntries.length - moveCap;
    // Moves a declared moment may bind to as evidence are never dropped; if
    // the budget cannot be met from the rest, leave the blocking finding for
    // the model — silently orphaning moment evidence is worse than a retry.
    const droppable = fullMoveEntries.filter((entry) => !isLoadBearingMove(scene, entry.move));
    if (droppable.length < toDrop) return scene;
    const dropIndexes = new Set(
      [...droppable]
        .sort((a, b) => cameraMoveEnergyRank(a.move) - cameraMoveEnergyRank(b.move) || a.index - b.index)
        .slice(0, toDrop)
        .map((entry) => entry.index),
    );
    const newPath = path.filter((_, index) => !dropIndexes.has(index));
    const note =
      `dropped ${toDrop} lowest-energy camera move(s) to fit the ` +
      `${moveCap}-move budget for a ${scene.durationSec.toFixed(1)}s window`;
    normalized.push(`scene "${scene.id}": ${note}`);
    if (!newPath.length) {
      const { camera: _camera, ...rest } = scene;
      return withNormalizationNotes(rest, [note]);
    }
    return withNormalizationNotes({ ...scene, camera: { ...scene.camera!, path: newPath } }, [note]);
  });

  // move.startSec is already absolute (per CameraMoveIntentV1) — no
  // scene.startSec offset to add.
  const whipRefs: Array<{
    sceneIndex: number;
    moveIndex: number;
    move: CameraMoveIntentV1;
  }> = [];
  scenes.forEach((scene, sceneIndex) => {
    (scene.camera?.path ?? []).forEach((move, moveIndex) => {
      if (move.move === "whip") whipRefs.push({ sceneIndex, moveIndex, move });
    });
  });
  if (whipRefs.length > MAX_WHIPS_PER_FILM) {
    // Keep the earliest MAX whips; drop the rest — except load-bearing whips
    // (a declared moment binds inside their window), which are never dropped:
    // if one keeps the film over budget, the finding stays blocking and the
    // parse-side convergence check reverts this normalization.
    const dropRefs = [...whipRefs]
      .sort((a, b) => a.move.startSec - b.move.startSec)
      .slice(MAX_WHIPS_PER_FILM)
      .filter((ref) => !isLoadBearingMove(scenes[ref.sceneIndex]!, ref.move));
    const dropBySceneIndex = new Map<number, Set<number>>();
    for (const ref of dropRefs) {
      if (!dropBySceneIndex.has(ref.sceneIndex)) dropBySceneIndex.set(ref.sceneIndex, new Set());
      dropBySceneIndex.get(ref.sceneIndex)!.add(ref.moveIndex);
    }
    scenes = scenes.map((scene, sceneIndex) => {
      const drop = dropBySceneIndex.get(sceneIndex);
      if (!drop || !scene.camera) return scene;
      const newPath = scene.camera.path.filter((_, moveIndex) => !drop.has(moveIndex));
      const note =
        `dropped ${drop.size} whip(s) beyond the ${MAX_WHIPS_PER_FILM}-per-film budget ` +
        `(keeping the film's earliest ${MAX_WHIPS_PER_FILM})`;
      if (!newPath.length) {
        const { camera: _camera, ...rest } = scene;
        return withNormalizationNotes(rest, [note]);
      }
      return withNormalizationNotes({ ...scene, camera: { ...scene.camera, path: newPath } }, [note]);
    });
    if (dropRefs.length) {
      normalized.push(
        `film: dropped ${dropRefs.length} whip(s) beyond the ${MAX_WHIPS_PER_FILM}-per-film budget, ` +
          `keeping the earliest ${MAX_WHIPS_PER_FILM}`,
      );
    }
  }

  return { storyboard: scenes, normalized };
}

/**
 * Sentinel normalize-before-retry (Phase-5 hardening): a payoff/typed-copy
 * beat whose hold is cut short by a camera move that starts right after it is
 * the single most repeated `pacing/outcome` shape in the 2026-07-06 probe set
 * ("lands its payoff at Ns but the framing changes 0.0s later"). The finding's
 * own fix hint is "delay the reframe" — pure arithmetic the host can do:
 * delay the conflicting move so the payoff gets its hold, when
 *  - the move starts AT/after the beat settles (a move already in flight when
 *    the beat lands is the model's own arrival choreography — left alone),
 *  - the delay is <= MAX_PACING_STRETCH_SEC,
 *  - the delayed move still fits inside the scene and does not pass the next
 *    full move, and
 *  - the move is not load-bearing (no declared moment binds to its window).
 * Runs inside the same parse-side atomic commit-or-revert as the clamp/stretch.
 */
export function delayConflictingCameraMoves(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const rampSceneIds = new Set(resolveTimeRampPlan(storyboard).ramps.map((ramp) => ramp.sceneId));
  const resolvedBeatsByScene = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const scenes = storyboard.map((scene) => {
    if (rampSceneIds.has(scene.id)) return scene;
    const path = scene.camera?.path;
    if (!path?.length) return scene;
    const sceneEnd = scene.startSec + scene.durationSec;
    const fullMoves = path
      .map((move, index) => ({ move, index }))
      .filter((entry) => CAMERA_FULL_MOVES.has(entry.move.move));
    if (!fullMoves.length) return scene;
    const componentKinds = new Map(
      (scene.components ?? []).map((component) => [component.id, component.kind]),
    );
    const beats = resolvedBeatsByScene.get(scene.id) ?? [];
    // The latest hold each too-early move must clear, from every beat it cuts.
    const requiredStart = new Map<number, number>();
    for (const beat of beats) {
      let needed = 0;
      if ((beat.kind === "type" || beat.kind === "swap") && beat.text) {
        needed = Math.min(
          READING_MAX_SEC,
          Math.max(READING_MIN_SEC, READING_SEC_PER_WORD * words(beat.text)),
        );
      }
      const isToastOpen = beat.kind === "open" && componentKinds.get(beat.component) === "toast";
      if (PAYOFF_BEAT_KINDS.has(beat.kind) || isToastOpen) {
        needed = Math.max(needed, OUTCOME_HOLD_SEC);
      }
      if (!needed) continue;
      for (const entry of fullMoves) {
        const start = entry.move.startSec;
        if (start < beat.endSec - 0.05) continue;
        if (start + PACING_TOLERANCE_SEC >= beat.endSec + needed) continue;
        requiredStart.set(
          entry.index,
          Math.max(requiredStart.get(entry.index) ?? 0, round(beat.endSec + needed)),
        );
      }
    }
    if (!requiredStart.size) return scene;
    const newPath = [...path];
    const notes: string[] = [];
    for (const entry of fullMoves) {
      const target = requiredStart.get(entry.index);
      if (target === undefined) continue;
      const delay = target - entry.move.startSec;
      if (delay <= 0 || delay > MAX_PACING_STRETCH_SEC + 1e-9) continue;
      if (isLoadBearingMove(scene, entry.move)) continue;
      if (target + entry.move.durationSec > sceneEnd + 1e-6) continue;
      const next = fullMoves.find((other) => other.move.startSec > entry.move.startSec + 1e-6);
      if (next && target + entry.move.durationSec > next.move.startSec + 1e-6) continue;
      newPath[entry.index] = { ...entry.move, startSec: round(target) };
      const note =
        `delayed the ${entry.move.move} from ${entry.move.startSec.toFixed(2)}s to ` +
        `${target.toFixed(2)}s so the payoff/copy before it holds`;
      notes.push(note);
      normalized.push(`scene "${scene.id}": ${note}`);
    }
    if (!notes.length) return scene;
    return withNormalizationNotes(
      { ...scene, camera: { ...scene.camera!, path: newPath } },
      notes,
    );
  });
  return { storyboard: scenes, normalized };
}

/** Shift a scene's own start and every nested absolute time by `delta` seconds. */
function withShiftedSceneTimes(scene: DirectScene, delta: number): DirectScene {
  if (Math.abs(delta) < 1e-6) return scene;
  const shift = (value: number): number => round(value + delta);
  return {
    ...scene,
    startSec: shift(scene.startSec),
    ...(scene.timeRamp ? { timeRamp: { ...scene.timeRamp, atSec: shift(scene.timeRamp.atSec) } } : {}),
    ...(scene.gradeShift
      ? { gradeShift: { ...scene.gradeShift, atSec: shift(scene.gradeShift.atSec) } }
      : {}),
    ...(scene.camera
      ? {
          camera: {
            ...scene.camera,
            path: scene.camera.path.map((move) => ({ ...move, startSec: shift(move.startSec) })),
          },
        }
      : {}),
    ...(scene.beats ? { beats: scene.beats.map((beat) => ({ ...beat, atSec: shift(beat.atSec) })) } : {}),
    ...(scene.interactions
      ? {
          interactions: scene.interactions.map((interaction) => ({
            ...interaction,
            startSec: shift(interaction.startSec),
            arriveSec: shift(interaction.arriveSec),
            ...(interaction.pressSec !== undefined ? { pressSec: shift(interaction.pressSec) } : {}),
            ...(interaction.releaseSec !== undefined ? { releaseSec: shift(interaction.releaseSec) } : {}),
            ...(interaction.holdUntilSec !== undefined ? { holdUntilSec: shift(interaction.holdUntilSec) } : {}),
          })),
        }
      : {}),
    ...(scene.moments ? { moments: scene.moments.map((moment) => ({ ...moment, atSec: shift(moment.atSec) })) } : {}),
  };
}

/**
 * Sentinel Phase 3 normalize-before-retry: close a MARGINAL `pacing/reading`
 * or `pacing/outcome` shortfall (≤ `MAX_PACING_STRETCH_SEC`) by stretching
 * the scene's own cut boundary — extending its duration by the shortfall and
 * cascade-shifting every later scene's absolute times by the same delta —
 * instead of sending the plan back to the model. Only shortfalls where the
 * constraining "next framing change" is the scene's OWN end (not an internal
 * camera move already in flight) are stretched: an internal-move conflict is
 * a genuine creative layout call the model should make, not host arithmetic.
 * Scenes inside a declared timeRamp hold are skipped — the ramp already
 * warps content seconds non-linearly, so stretching raw content time there
 * would not deliver the viewer-time hold the finding asks for.
 */
export function stretchMarginalPacingMisses(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const rampSceneIds = new Set(resolveTimeRampPlan(storyboard).ramps.map((ramp) => ramp.sceneId));
  const resolvedBeatsByScene = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const out: DirectScene[] = [];
  let cumulativeShift = 0;

  // Detection runs in each scene's ORIGINAL frame (where the resolved beats
  // live); a uniform later shift preserves every within-scene distance, so the
  // shortfall is shift-invariant and the cumulative shift is applied only when
  // emitting the output scene.
  for (const original of storyboard) {
    let applied = 0;
    if (!rampSceneIds.has(original.id)) {
      const sceneEnd = original.startSec + original.durationSec;
      const fullMoves = (original.camera?.path ?? []).filter((move) => CAMERA_FULL_MOVES.has(move.move));
      const stretchEvents = framingChangeEvents(fullMoves);
      const nextFramingChange = (afterSec: number): number =>
        nextFramingChangeAfter(stretchEvents, afterSec, sceneEnd);
      const componentKinds = new Map(
        (original.components ?? []).map((component) => [component.id, component.kind]),
      );
      const beats = resolvedBeatsByScene.get(original.id) ?? [];
      let shortfall = 0;
      for (const beat of beats) {
        // Only a shortfall constrained by the scene's OWN end (not an internal
        // camera move already in flight) is host-stretchable: extending the
        // cut buys the reading/hold time. An internal-move conflict is a
        // creative layout call left to the model.
        if ((beat.kind === "type" || beat.kind === "swap") && beat.text) {
          const wordCount = words(beat.text);
          const needed = Math.min(READING_MAX_SEC, Math.max(READING_MIN_SEC, READING_SEC_PER_WORD * wordCount));
          if (nextFramingChange(beat.endSec) >= sceneEnd - 1e-6) {
            const available = sceneEnd - beat.endSec;
            if (available + PACING_TOLERANCE_SEC < needed) shortfall = Math.max(shortfall, needed - available);
          }
        }
        const isToastOpen = beat.kind === "open" && componentKinds.get(beat.component) === "toast";
        if (PAYOFF_BEAT_KINDS.has(beat.kind) || isToastOpen) {
          if (nextFramingChange(beat.endSec) >= sceneEnd - 1e-6) {
            const available = sceneEnd - beat.endSec;
            if (available + PACING_TOLERANCE_SEC < OUTCOME_HOLD_SEC) {
              shortfall = Math.max(shortfall, OUTCOME_HOLD_SEC - available);
            }
          }
        }
      }
      if (shortfall > 0 && shortfall <= MAX_PACING_STRETCH_SEC) {
        applied = Math.min(shortfall, 15 - original.durationSec);
        if (applied <= 0.01) applied = 0;
      }
    }
    const shifted = withShiftedSceneTimes(original, cumulativeShift);
    if (applied > 0) {
      const note =
        `stretched ${applied.toFixed(2)}s to close a marginal pacing-floor ` +
        `shortfall at its own cut boundary`;
      out.push(withNormalizationNotes(
        { ...shifted, durationSec: round(shifted.durationSec + applied) },
        [note],
      ));
      cumulativeShift = round(cumulativeShift + applied);
      normalized.push(`scene "${original.id}": ${note}`);
    } else {
      out.push(shifted);
    }
  }
  return { storyboard: out, normalized };
}
