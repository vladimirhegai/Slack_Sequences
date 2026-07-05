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
import { CAMERA_FULL_MOVES } from "./cameraContract.ts";
import { resolveComponentPlan, type ResolvedComponentBeatV1 } from "./componentContract.ts";
import { FINAL_RESOLVE_ALLOWANCE_SEC } from "./storyboardMoments.ts";
import { resolveTimeRampPlan, warpInverseOf } from "./timeRamp.ts";
import type { DirectScene } from "./directComposition.ts";

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

/** Beat kinds that put a NEW surface (or new content) in front of the viewer. */
const ENTRANCE_BEAT_KINDS = new Set(["open", "rows", "swap"]);
/** Beat kinds whose landing is a payoff the viewer must see resolve. */
const PAYOFF_BEAT_KINDS = new Set(["press", "set-state"]);

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
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
    // final resolve (a logo/CTA card inside the moment contract's
    // final-resolve allowance introducing one surface) — that landing late is
    // the genre's signature, not a defect.
    const introductions = sceneIntroductionTimes(scene);
    const isShortFinalResolve =
      scene === storyboard[storyboard.length - 1] &&
      scene.durationSec <= FINAL_RESOLVE_ALLOWANCE_SEC &&
      introductions.length === 1;
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
    // the first full camera move that starts after the beat settles. A move
    // already IN FLIGHT when the beat settles is an immediate framing
    // conflict (available hold = 0) — the frame is moving through the payoff
    // even though no later move starts.
    const nextFramingChange = (afterSec: number): number => {
      let next = sceneEnd;
      for (const move of fullMoves) {
        if (move.startSec + move.durationSec <= afterSec - 0.05) continue;
        next = Math.min(next, Math.max(afterSec, move.startSec));
      }
      return Math.min(sceneEnd, next);
    };

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
      if (!intent.includes("type") && !intent.includes("headline")) continue;
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
