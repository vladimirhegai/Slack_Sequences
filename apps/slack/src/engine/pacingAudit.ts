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
 * 4. Camera density is budgeted by ideas, not raw moves: each scene gets one
 *    primary lens route while supporting evidence develops inside that frame.
 *
 * Every finding asks for a fix (extend, move, or drop) rather than vetoing a
 * creative addition, and every fix hint carries the "hold ≠ freeze" language
 * so the model does not thrash between these gates and the liveness gate
 * (quiet gap > ~2.5-3s is blocking): a held framing developed by a
 * count/progress/highlight beat satisfies both.
 *
 * All windows are judged in VIEWER (output) time: a timeRamp dip stretches
 * the content seconds it covers, so spans convert through the time service
 * before comparison, like the temporal judge and motion-density passes.
 */
import {
  CAMERA_FULL_MOVES,
  HIGH_ENERGY_PUSH_ZOOM,
  cameraMoveZoom,
  diveWindows,
  type CameraMoveIntentV1,
} from "./cameraContract.ts";
import { auditCameraIdeaBudget } from "./cameraBlocking.ts";
import {
  resolveComponentPlan,
  type ComponentKind,
  type ResolvedComponentBeatV1,
} from "./componentContract.ts";
import {
  EVIDENCE_AFTER_SEC,
  EVIDENCE_BEFORE_SEC,
  FINAL_RESOLVE_ALLOWANCE_SEC,
} from "./storyboardMoments.ts";
import { resolveTimeRampPlan } from "./timeRamp.ts";
import type { DirectScene } from "./directComposition.ts";
import { cascadeRetime, duration, sourceTime, timeConversionService } from "./time.ts";

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function applyCascadeStretches(
  storyboard: DirectScene[],
  stretches: ReadonlyMap<string, number>,
): DirectScene[] {
  let retimed = storyboard;
  for (const scene of storyboard) {
    const delta = stretches.get(scene.id) ?? 0;
    if (delta > 0) retimed = cascadeRetime(retimed, scene.id, duration(delta)).plan;
  }
  return retimed;
}

/** Seconds of post-introduction development each introduced surface needs. */
export const DEVELOPMENT_SEC_PER_INTRODUCTION = 0.9;
/** The last introduction must land by this fraction of the scene window. */
export const LAST_INTRODUCTION_MAX_FRACTION = 0.65;
/** A judge-facing cold open must establish its first declared subject promptly. */
export const OPENING_SUBJECT_MAX_SEC = 1.25;
/** Reading floor per word for typed copy, and its clamp bounds. */
export const READING_SEC_PER_WORD = 0.3;
export const READING_MIN_SEC = 1.2;
export const READING_MAX_SEC = 4;
/** Minimum hold after a payoff beat before the next framing change. */
export const OUTCOME_HOLD_SEC = 0.8;
/** An `assemble` headline is a resolve gesture — its lock holds at least this. */
export const ASSEMBLE_HOLD_SEC = 1.2;
/** Cadence used by the film-wide distinct-framing floor. */
export const CAMERA_BUDGET_WINDOW_SEC = 3.5;
/** Whips allowed per film. */
export const MAX_WHIPS_PER_FILM = 2;
/** Films shorter than this are exempt from the distinct-framings floor. */
export const FRAMING_FLOOR_MIN_FILM_SEC = 10;
/**
 * Distinct framings a film of this length needs: a new framing (a cut into a
 * shot, or a full typed camera move) roughly every `CAMERA_BUDGET_WINDOW_SEC`.
 * The single source of truth for the floor `validateStoryboardPlan` enforces
 * and `topUpFramingFloor` closes.
 */
export function requiredFramingCount(totalDurationSec: number): number {
  return Math.min(12, Math.max(3, Math.round(totalDurationSec / CAMERA_BUDGET_WINDOW_SEC)));
}
/** Gentle establishing zoom for a host-added framing top-up push-in. */
export const FRAMING_TOPUP_ZOOM = 1.15;
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
 * mechanical arithmetic (extend a cut by at most a beat and a half); a larger one is a
 * genuine creative deficit and stays blocking, per Sentinel's decision rule
 * (SENTINEL.md L2 rule: normalize what deletes/degrades/retimes,
 * send content deficits back to the model).
 */
export const MAX_PACING_STRETCH_SEC = 1.5;
/**
 * A camera move can be shifted farther than a cut may be stretched when the
 * move still fits its scene (within the separate stretch cap), does not pass
 * another move, and retains every camera-moment binding. The upper bound is
 * the same four-second maximum reading floor the move is clearing.
 */
export const MAX_PACING_RETIME_SEC = READING_MAX_SEC;
/** A same-station camera phrase may land on a payoff instead of crossing it,
 * but never by collapsing below a readable phrase or below 60% of its authored
 * duration. Cross-station travel is never shortened by this repair. */
const PAYOFF_LANDING_MIN_CAMERA_SEC = 0.6;
const PAYOFF_LANDING_MIN_DURATION_RATIO = 0.6;
/**
 * A cursor interaction owns the frame from just before the cursor arrives
 * until its result settles: a full camera move IN FLIGHT there stacks two
 * verbs on one instant (probe-audit-01: a whip re-framed the world during a
 * sidebar click). The lead keeps the frame stable as the cursor closes in;
 * the settle gives the click's result a beat before the next reframe.
 */
export const INTERACTION_HOLD_LEAD_SEC = 0.15;
export const INTERACTION_HOLD_SETTLE_SEC = 0.3;
/**
 * The eye needs a beat after a cut lands before an ENERGETIC reframe fires,
 * or the boundary reads as two stacked transitions (probe-audit-02: hard cut
 * → 0.2s → whip; morph → 0.3s → push-in). Connective pans/drifts stay free.
 */
export const ENTRY_SETTLE_SEC = 0.9;
/** Minimum gap between two energetic full moves aimed at different targets. */
export const MOVE_SETTLE_GAP_SEC = 0.6;

/** The window each interaction owns, in the scene's own (content) time. */
function interactionHoldWindows(
  scene: DirectScene,
): Array<{ id: string; from: number; until: number }> {
  return (scene.interactions ?? []).map((interaction) => ({
    id: interaction.id,
    from: interaction.arriveSec - INTERACTION_HOLD_LEAD_SEC,
    until:
      (interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.pressSec ??
        interaction.arriveSec) + INTERACTION_HOLD_SETTLE_SEC,
  }));
}

/**
 * A move that reads as a TRANSITION in its own right — the ones that stack
 * badly against a cut landing or against each other. Mirrors
 * `cameraMoveEnergyRank` >= 1 (whip/orbit/high-zoom, push/pull/dive);
 * connective pan/track/parallax stay exempt.
 */
function isEnergeticCameraMove(move: CameraMoveIntentV1): boolean {
  return cameraMoveEnergyRank(move) >= 1;
}

/**
 * The reading/outcome hold windows `auditPacing` will demand after each beat
 * — the windows a retime normalizer must never delay a move INTO. Live probe
 * `probe-audit-fable-2` (2026-07-08): the entry-settle delay moved a push-in
 * from 4.8s to 5.4s, which put it in flight through a set-state payoff's
 * >=0.8s hold at 6.2s and minted the very `pacing/outcome` finding the
 * earlier `delayConflictingCameraMoves` pass exists to prevent (it runs
 * BEFORE these normalizers, so it cannot see their retimes).
 */
function beatHoldWindows(
  scene: DirectScene,
  beats: ResolvedComponentBeatV1[],
  excludedComponents: ReadonlySet<string> = new Set(),
): Array<{ from: number; until: number }> {
  const componentKinds = new Map(
    (scene.components ?? []).map((component) => [component.id, component.kind]),
  );
  const windows: Array<{ from: number; until: number }> = [];
  for (const beat of beats) {
    if (excludedComponents.has(beat.component)) continue;
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
    if (needed > 0) windows.push({ from: beat.endSec, until: beat.endSec + needed });
  }
  return windows;
}

/**
 * Walk a retimed move's start forward until it no longer intersects any
 * obstacle window — EXCEPT windows the move's ORIGINAL placement already
 * intersected (the model's own conflict is the audit's business; a retime
 * must only never CREATE one). Returns the cleared start time.
 */
function advanceClearOfWindows(
  target: number,
  durationSec: number,
  originalStartSec: number,
  obstacles: Array<{ from: number; until: number }>,
): number {
  const clashAt = (start: number): { from: number; until: number } | undefined =>
    obstacles.find(
      (window) => start < window.until - 1e-6 && start + durationSec > window.from + 1e-6,
    );
  const preexisting = new Set<number>();
  for (const window of obstacles) {
    if (
      originalStartSec < window.until - 1e-6 &&
      originalStartSec + durationSec > window.from + 1e-6
    ) {
      preexisting.add(window.from);
    }
  }
  for (let pass = 0; pass <= obstacles.length; pass += 1) {
    const clash = clashAt(target);
    if (!clash || preexisting.has(clash.from)) return round(target);
    target = Math.max(target, clash.until);
  }
  return round(target);
}

/** Beat kinds that withhold a NEW surface or its first readable content until
 * the beat starts. `type`/`stream` clear their authored text slots at compile;
 * `animate` covers a pre-built asset unit's spring entrance (its first beat is
 * its arrival, camera-aware) so introduction timing judges the real moment the
 * viewer sees it. A `swap` is deliberately absent: the runtime swaps content
 * on an already-painted slot, so it is development, not that slot's entrance. */
const ENTRANCE_BEAT_KINDS = new Set(["type", "stream", "open", "rows", "animate"]);
/** Lightweight evidence that reads inside one product chassis, not as another
 * independent dense surface. Explicit entrance beats still introduce it later. */
const LOCAL_PRODUCT_EVIDENCE_KINDS: ReadonlySet<ComponentKind> = new Set([
  "button",
  "stat-card",
  "progress",
  "progress-ring",
  "headline",
  "toggle",
  "avatar-stack",
]);
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
export const PAYOFF_BEAT_KINDS = new Set(["press", "set-state"]);

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
 * entrances it), and each swap beat re-fills that existing surface with new
 * content the viewer must re-read.
 */
export function sceneIntroductionTimes(scene: DirectScene): number[] {
  const components = scene.components ?? [];
  if (!components.length) return [];
  const beats = scene.beats ?? [];
  const events: number[] = [];
  const usedBeatIds = new Set<string>();
  const entranceByComponent = new Map(components.map((component) => [
    component.id,
    beats
      .filter((beat) => beat.component === component.id && ENTRANCE_BEAT_KINDS.has(beat.kind))
      .sort((a, b) => a.atSec - b.atSec)[0],
  ]));
  // One app window (or one hero modal) plus static metric/CTA evidence in the
  // same typed station is one readable product surface. CurrentProof D's one
  // approval panel was charged as app-window + stat + button, inflating the
  // hold requirement beyond the bounded stretch normalizer and burning a paid
  // retry. Keep the grouping narrow: require one unambiguous chassis and one
  // shared non-empty region; dense tables/charts, overlays, plugins, and any
  // child with its own explicit entrance remain independent introductions.
  const productSurfaces = components.filter((component) =>
    !component.pluginUid &&
    (component.kind === "app-window" || (component.kind === "modal" && component.role === "hero"))
  );
  const productSurface = productSurfaces.length === 1 && productSurfaces[0]!.region
    ? productSurfaces[0]
    : undefined;
  const groupedProductEvidence = new Set(
    productSurface
      ? components.filter((component) =>
          !component.pluginUid &&
          component.region === productSurface.region &&
          (component.id === productSurface.id ||
            (LOCAL_PRODUCT_EVIDENCE_KINDS.has(component.kind) &&
              !entranceByComponent.get(component.id)))
        ).map((component) => component.id)
      : [],
  );
  // A plugin unit's children arrive as ONE host-choreographed gesture (the
  // cascade), so the unit contributes one introduction at its earliest
  // entrance — N seeded tiles are one surface to the eye, not N.
  const pluginIntro = new Map<string, number>();
  for (const component of components) {
    const entrance = entranceByComponent.get(component.id);
    if (entrance) usedBeatIds.add(entrance.id);
    const at = entrance ? entrance.atSec : scene.startSec;
    if (component.pluginUid) {
      const earliest = pluginIntro.get(component.pluginUid);
      pluginIntro.set(
        component.pluginUid,
        earliest === undefined ? at : Math.min(earliest, at),
      );
    } else if (groupedProductEvidence.has(component.id)) {
      // The chassis owns one event below; static local evidence is already
      // visible inside it. A child with an entrance was excluded from the set.
      continue;
    } else {
      events.push(at);
    }
  }
  if (productSurface && groupedProductEvidence.has(productSurface.id)) {
    events.push(entranceByComponent.get(productSurface.id)?.atSec ?? scene.startSec);
  }
  events.push(...pluginIntro.values());
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
  const findings: string[] = [...auditCameraIdeaBudget(storyboard)];
  // Content seconds → viewer seconds (identity when no timeRamp is declared).
  const conversion = timeConversionService(resolveTimeRampPlan(storyboard));
  const toViewer = (value: number): number => conversion.toViewer(sourceTime(value));
  const viewerSpan = (fromSec: number, toSec: number): number =>
    Math.max(0, toViewer(toSec) - toViewer(fromSec));
  const resolvedBeats = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );

  let whipCount = 0;
  for (const scene of storyboard) {
    const sceneEnd = scene.startSec + scene.durationSec;
    const isFirstScene = scene === storyboard[0];
    const path = scene.camera?.path ?? [];
    const fullMoves = path.filter((move) => CAMERA_FULL_MOVES.has(move.move));
    whipCount += path.filter((move) => move.move === "whip").length;

    // 1. Introduction → development ratio. The contract is per scene, not
    // only multi-surface scenes: ONE dense window opened at 90% of the scene
    // still needs time to be read. The single narrow exemption is a short
    // final resolve (a logo/CTA-class COMPACT surface inside the moment
    // contract's final-resolve allowance, introducing one surface) — that
    // landing late is the genre's signature, not a defect. A dense kind in
    // the same slot stays judged.
    const introductions = sceneIntroductionTimes(scene);
    if (
      isFirstScene &&
      introductions.length &&
      introductions[0]! > scene.startSec + OPENING_SUBJECT_MAX_SEC
    ) {
      findings.push(
        `storyboard/opening-subject: first scene "${scene.id}" keeps its first declared ` +
          `subject hidden until ${introductions[0]!.toFixed(1)}s (` +
          `${(introductions[0]! - scene.startSec).toFixed(1)}s into the film) — establish the ` +
          `focal product object within ${OPENING_SUBJECT_MAX_SEC.toFixed(2)}s, then develop it; ` +
          `a prolonged empty void becomes a near_blank_film browser failure and reads as dead air`,
      );
    }
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

    // 5. Interaction holds: no full move may be in flight while the cursor is
    // arriving/pressing or its result is settling — the camera holds through
    // arrive→result (probe-audit-01). A dive is exempt: its host-derived held
    // middle exists exactly to frame an act. `retimeCameraOverInteractions`
    // repairs this mechanically at parse, so this finding fires only on the
    // residue no retime could fix; the tolerance keeps marginal grazes from
    // vetoing a paid attempt.
    for (const window of interactionHoldWindows(scene)) {
      for (const move of fullMoves) {
        if (move.move === "dive") continue;
        const moveEnd = move.startSec + move.durationSec;
        if (
          move.startSec < window.until - PACING_TOLERANCE_SEC &&
          moveEnd > window.from + PACING_TOLERANCE_SEC
        ) {
          findings.push(
            `pacing/interaction-hold: scene "${scene.id}" ${move.move} ` +
              `(${move.startSec.toFixed(1)}s-${moveEnd.toFixed(1)}s) re-frames the world while ` +
              `interaction "${window.id}" owns the frame ` +
              `(${window.from.toFixed(1)}s-${window.until.toFixed(1)}s, arrive → settled result) — ` +
              `the camera must hold through a cursor's arrive→press→result. Land the move ` +
              `before the cursor arrives, start it after the result settles, or let the ` +
              `interaction's own focus carry the beat`,
          );
        }
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
      // 2d. Early-swap read-hold (probe-audit-01): the incoming copy of a cut
      // must be READ before it CHANGES. A swap firing right after a non-first
      // scene's start re-writes the just-landed frame before the viewer reads
      // it. delayEarlySwapBeats repairs this at parse, so the finding is the
      // residue no retime could fix (a binding it could not preserve).
      if (
        beat.kind === "swap" &&
        !isFirstScene &&
        beat.startSec - scene.startSec < ENTRY_SETTLE_SEC - PACING_TOLERANCE_SEC
      ) {
        findings.push(
          `pacing/reading: scene "${scene.id}" beat "${beat.id}" swaps "${beat.component}" ` +
            `${(beat.startSec - scene.startSec).toFixed(1)}s after the cut lands — the incoming ` +
            `frame's copy changes before the viewer reads it. Hold the landed copy ` +
            `>=${ENTRY_SETTLE_SEC.toFixed(1)}s before swapping it (delay the swap, or land the ` +
            `final copy in the cut instead of swapping it in)`,
        );
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
  const path = scene.camera?.path ?? [];
  return (scene.moments ?? []).some((moment) => {
    // Host top-up paperwork describes surviving motion; it must never make
    // that same optional move undeletable on the next parse. Only a director-
    // declared moment can protect a camera move from deterministic cleanup.
    if (/-auto-\d+$/i.test(moment.id)) return false;
    if (!momentNeedsCamera(scene, moment)) return false;
    const candidates = path.filter((candidate) =>
      candidate.startSec + candidate.durationSec >= moment.atSec - EVIDENCE_BEFORE_SEC &&
      candidate.startSec <= moment.atSec + EVIDENCE_AFTER_SEC
    );
    // Publication binds one best camera activity, not every move touching the
    // evidence window. Protect the same closest-start candidate and leave
    // redundant overlaps droppable; otherwise a track ending exactly where a
    // whip begins defeats the budget normalizer.
    const best = candidates.sort((a, b) =>
      Math.abs(a.startSec - moment.atSec) - Math.abs(b.startSec - moment.atSec) ||
      path.indexOf(a) - path.indexOf(b)
    )[0];
    return best === move;
  });
}

function momentNeedsCamera(
  scene: DirectScene,
  moment: NonNullable<DirectScene["moments"]>[number],
): boolean {
  const prose = `${moment.title} ${moment.visualState} ${moment.change}`.toLowerCase();
  const explicitlyCameraOwned =
    /\b(?:camera|reframe|framing|pan|whip|zoom|track|orbit|dive|push-in|pull-back)\b/.test(prose);
  const explicitlyInteractionOwned = /\b(?:cursor|click|press|tap|drag|pointer)\b/.test(prose) &&
    (scene.interactions ?? []).some((interaction) => {
      const end = interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
      return interaction.startSec - EVIDENCE_BEFORE_SEC <= moment.atSec &&
        end + EVIDENCE_AFTER_SEC >= moment.atSec;
    });
  // A planner sometimes labels "Cursor arrives" as `camera-arrival`. The
  // explicit interaction is still the evidence owner; preserving a clashing
  // camera move for that mislabeled moment makes the host retry the planner
  // for arithmetic it can resolve by holding the station. Explicit camera
  // prose continues to win when the shot genuinely follows the pointer.
  if (explicitlyInteractionOwned && !explicitlyCameraOwned) return false;
  const intent = `${moment.motionIntent} ${moment.title} ${moment.change}`.toLowerCase();
  return /\b(?:camera|reframe|framing|pan|whip|zoom|track|orbit|dive|push-in|pull-back)\b/
    .test(intent);
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
 * Compatibility seam for the mechanical film-wide whip clamp. Phase 3.4
 * removed raw per-scene move deletion: selecting which visual idea to cut is
 * creative and now returns an actionable `camera/idea-budget` findings-retry.
 */
export function normalizeCameraBudget(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  let scenes = storyboard.map((scene) => ({ ...scene }));

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
 * The concrete framing target for a host-added establishing push-in: a declared
 * focal part, else a station-bearing component's region, else any declared
 * component (its id is its data-part). A scene with none of these is a bare
 * title card — pushing into it would frame a void (`camera_framed_sparse`), so
 * it is skipped. Returned only to decide the scene HAS content to frame; the
 * added push-in is targetless (a gentle centre zoom over whatever the scene
 * already frames), so it never depends on a station lookup that could miss.
 */
function hasFramingSubject(scene: DirectScene): boolean {
  if (scene.spatialIntent?.focalPart?.trim()) return true;
  if ((scene.components ?? []).length > 0) return true;
  return false;
}

/**
 * Sentinel L2 normalize-before-retry: when the distinct-framings floor
 * (`validateStoryboardPlan`) is short by EXACTLY one, add a single gentle
 * establishing push-in to the longest shot that currently holds a single
 * framing (no full camera move) and has real content to frame. This is the
 * mechanical half of the floor's own fix hint ("add shots or give scenes camera
 * paths"): the host cannot invent a shot, but it CAN give one held shot the
 * establishing push a longer film needs — a full move that lifts the framing
 * count by one. Short by >= 2 is a genuine content deficit (the film wants more
 * shots or motion the model must author) and stays a finding.
 *
 * Safety: the push-in opens the scene (startSec == scene start, <= 1s) so it
 * finishes before the shot's content beats and never cuts short a beat's
 * reading/outcome hold (a scene with a beat inside the push window is skipped);
 * it is targetless, so it needs no station; zoom is a gentle
 * FRAMING_TOPUP_ZOOM. Adding one move to a zero-move scene can never breach that
 * scene's own per-scene budget (cap >= 1). The parse-side atomic commit-or-revert
 * reverts if the added move somehow minted any finding.
 */
export function topUpFramingFloor(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const totalSec = storyboard.reduce(
    (end, scene) => Math.max(end, scene.startSec + scene.durationSec),
    0,
  );
  if (totalSec < FRAMING_FLOOR_MIN_FILM_SEC) return { storyboard, normalized };
  const fullMoveCount = storyboard.reduce(
    (count, scene) =>
      count + (scene.camera?.path.filter((move) => CAMERA_FULL_MOVES.has(move.move)).length ?? 0),
    0,
  );
  const framings = storyboard.length + fullMoveCount;
  const required = requiredFramingCount(totalSec);
  const deficit = required - framings;
  // One or two missing framings in an otherwise structured film are mechanical:
  // two long, held product shots can each accept one bounded establishing move.
  // Larger misses still mean the plan lacks a real visual argument and retry.
  if (deficit < 1 || deficit > 2) return { storyboard, normalized };

  const pushDuration = (scene: DirectScene): number =>
    round(Math.min(1.0, Math.max(0.5, scene.durationSec * 0.4)));
  const neutralChassis = (scene: DirectScene): CameraMoveIntentV1 | undefined => {
    const path = scene.camera?.path ?? [];
    const only = path.length === 1 ? path[0] : undefined;
    return only?.move === "hold" && Boolean(only.toPart || only.toRegion)
      ? only
      : undefined;
  };
  // A candidate "holds a single framing" with NO declared camera path at all —
  // a fresh single-move push-in can be created without colliding with an
  // existing hold/drift segment at the scene start (a scene that already owns a
  // path is left for the model). It must frame real content (else the push
  // frames a void → camera_framed_sparse) and have no beat inside the opening
  // push window (else the push steals a beat's hold → a pacing finding).
  const candidates = storyboard
    .map((scene, index) => ({ scene, index }))
    .filter(
      ({ scene }) =>
        ((scene.camera?.path.length ?? 0) === 0 || Boolean(neutralChassis(scene))) &&
        hasFramingSubject(scene) &&
        !(scene.beats ?? []).some(
          (beat) => beat.atSec <= scene.startSec + pushDuration(scene) + 0.05,
        ),
    )
    .sort((a, b) => b.scene.durationSec - a.scene.durationSec || a.index - b.index);
  const chosen = candidates.slice(0, deficit);
  // Commit only when the deterministic additions actually meet the floor.
  if (chosen.length !== deficit) return { storyboard, normalized };
  const chosenByIndex = new Map(chosen.map((entry, order) => [entry.index, order]));

  const scenes = storyboard.map((scene, index) => {
    const order = chosenByIndex.get(index);
    if (order === undefined) return scene;
    const push: CameraMoveIntentV1 = {
      version: 1,
      move: "push-in",
      zoom: FRAMING_TOPUP_ZOOM,
      startSec: round(scene.startSec),
      durationSec: pushDuration(scene),
      ...(neutralChassis(scene)?.toPart
        ? { toPart: neutralChassis(scene)!.toPart }
        : neutralChassis(scene)?.toRegion
          ? { toRegion: neutralChassis(scene)!.toRegion }
          : {}),
    };
    const note =
      `added a gentle establishing push-in (zoom ${FRAMING_TOPUP_ZOOM}) to meet the ` +
      `${required}-framing floor for a ${totalSec.toFixed(0)}s film` +
      (deficit > 1 ? ` (${order + 1}/${deficit} bounded top-ups)` : "");
    normalized.push(`scene "${scene.id}": ${note}`);
    // The candidate had no camera path, so the fresh single-move path can't
    // collide; the host wraps its data-camera-world plane at author time.
    return withNormalizationNotes(
      { ...scene, camera: { version: 1, path: [push] } },
      [note],
    );
  });
  return { storyboard: scenes, normalized };
}

/**
 * Sentinel normalize-before-retry (Phase-5 hardening): a payoff/typed-copy
 * beat whose hold is cut short by a camera move that starts right after it is
 * the single most repeated `pacing/outcome` shape in the 2026-07-06 probe set
 * ("lands its payoff at Ns but the framing changes 0.0s later"). The finding's
 * own fix hint is "delay the reframe" — pure arithmetic the host can do:
 * delay the conflicting move so the payoff gets its hold, when
 *  - the move starts or remains in flight through the required hold,
 *  - the delay is <= MAX_PACING_RETIME_SEC,
 *  - the delayed move does not pass the next full move, and
 *  - a multi-phrase scene keeps every moment binding; a scene with exactly one
 *    full camera phrase carries its camera-only moment timestamps by the same
 *    delay because ownership is unambiguous.
 * When the delayed move no longer fits before the scene's own cut, the scene
 * boundary stretches by the overflow (<= MAX_PACING_STRETCH_SEC, 15s scene
 * cap) and every later scene cascade-shifts — the short-scene shape the
 * 2026-07-07 probe set kept re-rejecting ("payoff at Ns, framing changes 0.0s
 * later" in a 1.3s scene, where a delay alone overflows the cut and a stretch
 * alone can't move the internal conflict). Still pure arithmetic.
 * Runs inside the same parse-side atomic commit-or-revert as the clamp/stretch.
 */
export function delayConflictingCameraMoves(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const resolvedBeatsByScene = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const out: DirectScene[] = [];
  const stretches = new Map<string, number>();
  // Detection runs in each scene's ORIGINAL frame (where the resolved beats
  // live); the cascade shift from earlier boundary stretches preserves every
  // within-scene distance and is applied only when emitting the output scene.
  for (const scene of storyboard) {
    let result = scene;
    let stretch = 0;
    const retimedMomentAt = new Map<string, number>();
    const path = scene.camera?.path;
    if (path?.length) {
      const sceneEnd = scene.startSec + scene.durationSec;
      const fullMoves = path
        .map((move, index) => ({ move, index }))
        .filter((entry) => CAMERA_FULL_MOVES.has(entry.move.move));
      const componentKinds = new Map(
        (scene.components ?? []).map((component) => [component.id, component.kind]),
      );
      const componentRegions = new Map(
        (scene.components ?? []).map((component) => [component.id, component.region]),
      );
      const componentIds = new Set((scene.components ?? []).map((component) => component.id));
      const soleWorldRegion = scene.worldLayout?.length === 1
        ? scene.worldLayout[0]!.region
        : undefined;
      const beats = fullMoves.length ? resolvedBeatsByScene.get(scene.id) ?? [] : [];
      const destinationIdsFor = (move: CameraMoveIntentV1): Set<string> => new Set(
        [...componentRegions.entries()]
          .filter(([id, region]) =>
            (move.toPart && id === move.toPart) ||
            (move.toRegion && region === move.toRegion)
          )
          .map(([id]) => id),
      );
      const targetKey = (part: string | undefined, region: string | undefined): string | undefined => {
        if (region) return `region:${region}`;
        if (!part) return undefined;
        const componentRegion = componentRegions.get(part);
        if (componentRegion) return `region:${componentRegion}`;
        const pluginRegion = scene.plugins?.find((plugin) => plugin.id === part)?.region;
        return pluginRegion ? `region:${pluginRegion}` : `part:${part}`;
      };
      const namedCameraTargets = new Set(
        path.flatMap((move) => [
          targetKey(move.fromPart, move.fromRegion),
          targetKey(move.toPart, move.toRegion),
        ]).filter((target): target is string => Boolean(target)),
      );
      const focalTarget = targetKey(scene.spatialIntent?.focalPart, undefined);
      if (focalTarget) namedCameraTargets.add(focalTarget);
      const declaredContentStations = new Set([
        ...(scene.components ?? []).flatMap((component) =>
          component.region ? [`region:${component.region}`] : []
        ),
        ...(scene.plugins ?? []).flatMap((plugin) =>
          plugin.region ? [`region:${plugin.region}`] : []
        ),
        ...(scene.worldLayout ?? []).map((station) => `region:${station.region}`),
      ]);
      // A single toRegion is not proof of a same-station move: its unseen
      // source may be elsewhere. The scene's actual content must declare one
      // and only one station, matching the camera target.
      const sameStationReframe = namedCameraTargets.size === 1 &&
        declaredContentStations.size === 1 &&
        [...namedCameraTargets].every((target) => declaredContentStations.has(target));
      // World-layout completion can prove a sole station even when the model
      // omitted `region` on its focal component. Keep that inference local to
      // payoff landing; the broader delay/drop policy must retain its stricter
      // authored-region test so an opening route is not reclassified.
      const inferredSoleStationPayoffRoute = Boolean(
        soleWorldRegion &&
        declaredContentStations.size === 1 &&
        declaredContentStations.has(`region:${soleWorldRegion}`) &&
        [...namedCameraTargets].every((target) =>
          target === `region:${soleWorldRegion}` ||
          (target.startsWith("part:") && componentIds.has(target.slice("part:".length)))
        ),
      );
      const samePartPayoffRoute = Boolean(
        focalTarget &&
        focalTarget.startsWith("part:") &&
        componentIds.has(focalTarget.slice("part:".length)) &&
        namedCameraTargets.size === 1 &&
        namedCameraTargets.has(focalTarget),
      );
      const sameTargetPayoffReframe = sameStationReframe ||
        inferredSoleStationPayoffRoute || samePartPayoffRoute;
      // The latest hold each too-early move must clear, from every beat it cuts.
      const requiredStart = new Map<number, number>();
      const conflictCount = new Map<number, number>();
      const conflictingPayoffEnd = new Map<number, number>();
      for (const beat of beats) {
        let needed = 0;
        if ((beat.kind === "type" || beat.kind === "swap") && beat.text) {
          needed = Math.min(
            READING_MAX_SEC,
            Math.max(READING_MIN_SEC, READING_SEC_PER_WORD * words(beat.text)),
          );
        }
        const isToastOpen = beat.kind === "open" && componentKinds.get(beat.component) === "toast";
        const isPayoff = PAYOFF_BEAT_KINDS.has(beat.kind) || isToastOpen;
        if (isPayoff) {
          needed = Math.max(needed, OUTCOME_HOLD_SEC);
        }
        if (!needed) continue;
        for (const entry of fullMoves) {
          // A destination may enter while the lens travels toward it. Its own
          // reveal/payoff hold must not push the camera until after the thing
          // it exists to reveal (Probe 5's late publish button).
          // A true travel move may reveal destination content while the lens is
          // moving. A same-station reframe cannot: it is still interrupting copy
          // that is already visible in the active station, and the pacing audit
          // deliberately treats that overlap as a reading conflict.
          if (!sameTargetPayoffReframe && destinationIdsFor(entry.move).has(beat.component)) continue;
          const start = entry.move.startSec;
          const activeUntil = start + entry.move.durationSec;
          if (activeUntil <= beat.endSec + 0.05) continue;
          if (start + PACING_TOLERANCE_SEC >= beat.endSec + needed) continue;
          requiredStart.set(
            entry.index,
            Math.max(requiredStart.get(entry.index) ?? 0, round(beat.endSec + needed)),
          );
          conflictCount.set(entry.index, (conflictCount.get(entry.index) ?? 0) + 1);
          if (isPayoff) {
            conflictingPayoffEnd.set(
              entry.index,
              Math.max(conflictingPayoffEnd.get(entry.index) ?? 0, beat.endSec),
            );
          }
        }
      }
      if (requiredStart.size) {
        const newPath: Array<CameraMoveIntentV1 | undefined> = [...path];
        const notes: string[] = [];
        for (const entry of fullMoves) {
          const required = requiredStart.get(entry.index);
          if (required === undefined) continue;
          const target = advanceClearOfWindows(
            required,
            entry.move.durationSec,
            entry.move.startSec,
            beatHoldWindows(scene, beats, destinationIdsFor(entry.move)),
          );
          const delay = target - entry.move.startSec;
          // A long, authored approach can miss the bounded scene-stretch cap
          // by only a few frames after we protect a payoff. Preserve the move
          // and trim that small excess instead of reverting the entire atomic
          // normalization (RelayGuard live attempt 2). This is deliberately
          // narrow: at most 350ms / 15% and never below a 600ms camera phrase.
          let durationSec = entry.move.durationSec;
          const initialOverflow = target + durationSec - sceneEnd;
          const trimNeeded = initialOverflow - MAX_PACING_STRETCH_SEC;
          const maxSafeTrim = Math.min(0.35, entry.move.durationSec * 0.15);
          const trimsMarginalOverflow =
            trimNeeded > 1e-6 &&
            trimNeeded <= maxSafeTrim + 1e-9 &&
            entry.move.durationSec - trimNeeded >= 0.6 - 1e-9;
          if (trimsMarginalOverflow) durationSec = round(entry.move.durationSec - trimNeeded);
          const next = fullMoves.find((other) => other.move.startSec > entry.move.startSec + 1e-6);
          // Retiming a load-bearing move is safe only while every moment that
          // could bind to the original move still overlaps the new window.
          const boundMoments = (scene.moments ?? []).filter((moment) =>
            momentNeedsCamera(scene, moment) &&
            entry.move.startSec + entry.move.durationSec >= moment.atSec - EVIDENCE_BEFORE_SEC &&
            entry.move.startSec <= moment.atSec + EVIDENCE_AFTER_SEC
          );
          const keepsBindings = boundMoments.every((moment) =>
            target + durationSec >= moment.atSec - EVIDENCE_BEFORE_SEC &&
            target <= moment.atSec + EVIDENCE_AFTER_SEC
          );
          const overflow = target + durationSec - sceneEnd;
          const fitsDelay = delay > 0 && delay <= MAX_PACING_RETIME_SEC + 1e-9;
          const fitsBeforeNext = !next || target + durationSec <= next.move.startSec + 1e-6;
          const fitsScene = overflow <= 1e-6 ||
            (overflow <= MAX_PACING_STRETCH_SEC + 1e-9 &&
              scene.durationSec + overflow <= 15 + 1e-9);
          // A scene with ONE full camera phrase has no ambiguity about which
          // motion owns its camera-only moments. If arithmetic must delay that
          // phrase, carry those timestamps by the same delta instead of making
          // stale paperwork veto the repair. Multi-move scenes remain strict:
          // shifting a moment there could change which phrase it describes.
          const canCarryCameraMoments =
            !keepsBindings && fullMoves.length === 1 && boundMoments.length > 0;
          const bindingsSafe = keepsBindings || canCarryCameraMoments;
          const destinationIds = destinationIdsFor(entry.move);
          const servesGatedDestination = (scene.beats ?? []).some((candidate) =>
            destinationIds.has(candidate.component) &&
            (candidate.kind === "type" || candidate.kind === "open" ||
              candidate.kind === "rows" || candidate.kind === "morph" ||
              candidate.kind === "swap") &&
            candidate.atSec > scene.startSec + 0.25
          );
          const shouldDropCrowdedOverflow =
            overflow > 1e-6 &&
            ((conflictCount.get(entry.index) ?? 0) >= 2 || sameStationReframe) &&
            !isLoadBearingMove(scene, entry.move) &&
            (!servesGatedDestination || sameStationReframe);
          const delayFits = fitsDelay && fitsBeforeNext && bindingsSafe && fitsScene &&
            !shouldDropCrowdedOverflow;
          if (!delayFits) {
            // A single same-station push that is already carrying the payoff
            // can land WITH that payoff instead of being delayed until after
            // it. This preserves the authored route and declared camera
            // evidence while turning an in-flight result into a framed settle.
            // It is deliberately unavailable to cross-station travel, crowded
            // holds, or a trim that would collapse the authored phrase.
            const payoffEnd = conflictingPayoffEnd.get(entry.index);
            // `nextFramingChangeAfter` treats a move ending within 50ms of a
            // payoff as still in flight. Land 60ms before resolution so the
            // audit and the rendered frame agree that the camera has settled.
            const landedDuration = payoffEnd === undefined
              ? 0
              : round(payoffEnd - entry.move.startSec - 0.06);
            const shortenedKeepsBindings = payoffEnd !== undefined && boundMoments.every((moment) =>
              entry.move.startSec + landedDuration >= moment.atSec - EVIDENCE_BEFORE_SEC &&
              entry.move.startSec <= moment.atSec + EVIDENCE_AFTER_SEC
            );
            const canLandOnPayoff =
              sameTargetPayoffReframe &&
              fullMoves.length === 1 &&
              (conflictCount.get(entry.index) ?? 0) === 1 &&
              payoffEnd !== undefined &&
              landedDuration >= PAYOFF_LANDING_MIN_CAMERA_SEC &&
              landedDuration >= entry.move.durationSec * PAYOFF_LANDING_MIN_DURATION_RATIO &&
              landedDuration < entry.move.durationSec - 0.05 &&
              sceneEnd - payoffEnd + PACING_TOLERANCE_SEC >= OUTCOME_HOLD_SEC &&
              shortenedKeepsBindings;
            if (canLandOnPayoff) {
              newPath[entry.index] = { ...entry.move, durationSec: landedDuration };
              const note =
                `shortened the same-station ${entry.move.move} from ` +
                `${entry.move.durationSec.toFixed(2)}s to ${landedDuration.toFixed(2)}s so it ` +
                `lands with the payoff and leaves the resolved frame readable`;
              notes.push(note);
              normalized.push(`scene "${scene.id}": ${note}`);
              continue;
            }
            // One camera phrase cutting across several independent reading /
            // payoff holds has no free slot left. When it carries no camera
            // moment, dropping that reframe is safer than repeatedly asking
            // the planner to solve contradictory timing (direction-live-a
            // attempt 1: one pull-back crossed two lockup lines + the metric).
            if (
              ((conflictCount.get(entry.index) ?? 0) >= 2 || sameStationReframe) &&
              !isLoadBearingMove(scene, entry.move) &&
              (!servesGatedDestination || sameStationReframe)
            ) {
              newPath[entry.index] = undefined;
              const note =
                `dropped the ${entry.move.move} at ${entry.move.startSec.toFixed(2)}s — it ` +
                `crossed ${conflictCount.get(entry.index)} reading/payoff holds and no ` +
                `binding-safe retime fits; the resolved station holds instead`;
              notes.push(note);
              normalized.push(`scene "${scene.id}": ${note}`);
            }
            continue;
          }
          if (overflow > 1e-6) {
            // The delayed move overruns the scene's own cut: stretch that cut
            // by the overflow instead of leaving the finding to a paid retry.
            stretch = Math.max(stretch, round(overflow));
          }
          newPath[entry.index] = { ...entry.move, startSec: round(target), durationSec };
          if (canCarryCameraMoments) {
            const delta = target - entry.move.startSec;
            for (const moment of boundMoments) {
              retimedMomentAt.set(moment.id, round(moment.atSec + delta));
            }
          }
          const note =
            `delayed the ${entry.move.move} from ${entry.move.startSec.toFixed(2)}s to ` +
            `${target.toFixed(2)}s so the payoff/copy holds without an in-flight reframe` +
            (trimsMarginalOverflow
              ? ` (trimmed duration ${entry.move.durationSec.toFixed(2)}s to ${durationSec.toFixed(2)}s)`
              : "") +
            (canCarryCameraMoments
              ? ` (carried ${boundMoments.length} single-phrase camera moment(s))`
              : "") +
            (overflow > 1e-6 ? ` (cut boundary stretched ${overflow.toFixed(2)}s to fit it)` : "");
          notes.push(note);
          normalized.push(`scene "${scene.id}": ${note}`);
        }
        if (notes.length) {
          const keptPath = newPath.filter(
            (move): move is CameraMoveIntentV1 => move !== undefined,
          );
          result = withNormalizationNotes(
            {
              ...scene,
              ...(retimedMomentAt.size
                ? {
                    moments: (scene.moments ?? []).map((moment) => ({
                      ...moment,
                      atSec: retimedMomentAt.get(moment.id) ?? moment.atSec,
                    })),
                  }
                : {}),
              ...(keptPath.length
                ? { camera: { ...scene.camera!, path: keptPath } }
                : { camera: undefined }),
            },
            notes,
          );
        } else {
          stretch = 0;
        }
      }
    }
    out.push(result);
    if (stretch > 0) stretches.set(scene.id, stretch);
  }
  return { storyboard: applyCascadeStretches(out, stretches), normalized };
}

/**
 * Sentinel normalize-before-retry (2026-07-08, probe-audit-01): a full camera
 * move IN FLIGHT during a cursor interaction's arrive→result window stacks a
 * reframe on a click — the storyboard's own fix hint ("start it after the
 * result settles") is pure arithmetic. Delay each clashing move to the end of
 * the last window it clashes with, when
 *  - the delayed move does not pass the next full move (drift/hold fills
 *    self-heal — the resolver clamps overlaps to its cursor),
 *  - it still fits the scene, stretching the cut boundary by <=
 *    MAX_PACING_STRETCH_SEC (15s scene cap) when it overruns, and
 *  - every moment whose evidence search overlapped the original window still
 *    overlaps the retimed one (load-bearing binding preserved).
 * When no retime fits, a NON-load-bearing move is dropped instead (the drift
 * auto-fill holds the framing); a load-bearing unfixable clash keeps its
 * `pacing/interaction-hold` finding. Dives are exempt like everywhere else.
 * Runs inside the same parse-side atomic commit-or-revert as the clamp/stretch.
 */
export function retimeCameraOverInteractions(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const resolvedBeatsByScene = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const out: DirectScene[] = [];
  const stretches = new Map<string, number>();
  for (const scene of storyboard) {
    let result = scene;
    let stretch = 0;
    const path = scene.camera?.path;
    const windows = interactionHoldWindows(scene);
    if (path?.length && windows.length) {
      const sceneEnd = scene.startSec + scene.durationSec;
      const holds = beatHoldWindows(scene, resolvedBeatsByScene.get(scene.id) ?? []);
      const fullMoves = path
        .map((move, index) => ({ move, index }))
        .filter((entry) => CAMERA_FULL_MOVES.has(entry.move.move) && entry.move.move !== "dive");
      const newPath: Array<CameraMoveIntentV1 | undefined> = [...path];
      const notes: string[] = [];
      for (const entry of fullMoves) {
        // Walk the start forward past every window it would be in flight
        // through (delaying past one window can land inside the next), and —
        // interleaved — clear of every reading/outcome hold the retime would
        // otherwise newly cut (the probe-audit-fable-2 lesson).
        let target = entry.move.startSec;
        for (let round_ = 0; round_ < 4; round_ += 1) {
          const before = target;
          for (let pass = 0; pass <= windows.length; pass += 1) {
            const end = target + entry.move.durationSec;
            const clash = windows.find(
              (window) =>
                target < window.until - PACING_TOLERANCE_SEC &&
                end > window.from + PACING_TOLERANCE_SEC,
            );
            if (!clash) break;
            target = Math.max(target, round(clash.until));
          }
          target = advanceClearOfWindows(
            target,
            entry.move.durationSec,
            entry.move.startSec,
            holds,
          );
          if (target === before) break;
        }
        if (target <= entry.move.startSec + 1e-6) continue;
        const firstClash = windows.find(
          (window) =>
            entry.move.startSec < window.until - PACING_TOLERANCE_SEC &&
            entry.move.startSec + entry.move.durationSec >
              window.from + PACING_TOLERANCE_SEC,
        )!;
        const next = fullMoves.find((other) => other.move.startSec > entry.move.startSec + 1e-6);
        const fitsBeforeNext = !next || target + entry.move.durationSec <= next.move.startSec + 1e-6;
        const overflow = target + entry.move.durationSec - sceneEnd;
        const fitsScene =
          overflow <= 1e-6 ||
          (overflow <= MAX_PACING_STRETCH_SEC + 1e-9 && scene.durationSec + overflow <= 15 + 1e-9);
        // Binding preservation: every moment that could bind to the original
        // window must still overlap the retimed one.
        const boundMoments = (scene.moments ?? []).filter((moment) =>
          momentNeedsCamera(scene, moment) &&
          entry.move.startSec + entry.move.durationSec >= moment.atSec - EVIDENCE_BEFORE_SEC &&
          entry.move.startSec <= moment.atSec + EVIDENCE_AFTER_SEC
        );
        const resolvedBeats = resolvedBeatsByScene.get(scene.id) ?? [];
        const hasNonCameraEvidence = (
          moment: NonNullable<DirectScene["moments"]>[number],
        ): boolean =>
          resolvedBeats.some((beat) =>
            beat.endSec >= moment.atSec - EVIDENCE_BEFORE_SEC &&
            beat.startSec <= moment.atSec + EVIDENCE_AFTER_SEC
          ) || (/\b(?:cursor|click|press|tap|drag|pointer)\b/i.test(
            `${moment.title} ${moment.visualState} ${moment.change}`,
          ) && (scene.interactions ?? []).some((interaction) => {
            const end = interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
            return interaction.startSec <= moment.atSec + EVIDENCE_AFTER_SEC &&
              end >= moment.atSec - EVIDENCE_BEFORE_SEC;
          }));
        // Camera prose is sometimes duplicated by a resolved count/state beat
        // at the same moment. That typed evidence survives without the
        // clashing reframe, so it must not make the camera move load-bearing.
        const cameraOnlyBoundMoments = boundMoments.filter((moment) =>
          !hasNonCameraEvidence(moment)
        );
        const keepsBindings = cameraOnlyBoundMoments.every((moment) =>
          target + entry.move.durationSec >= moment.atSec - EVIDENCE_BEFORE_SEC &&
          target <= moment.atSec + EVIDENCE_AFTER_SEC
        );
        // If a non-camera moment already owns the interaction and postponing
        // this move would stretch the scene, holding the existing station is
        // the smaller deterministic edit. It avoids manufacturing a long,
        // empty tail (LedgerFlow live attempt 1) and reflects the director's
        // rule that the interaction itself supplies the focus.
        const typedEvidenceOwnsMoments =
          boundMoments.length > 0 && cameraOnlyBoundMoments.length === 0;
        const shouldDropOverflow = overflow > 1e-6 && cameraOnlyBoundMoments.length === 0;
        if (
          fitsBeforeNext && fitsScene && keepsBindings &&
          !shouldDropOverflow && !typedEvidenceOwnsMoments
        ) {
          if (overflow > 1e-6) stretch = Math.max(stretch, round(overflow));
          newPath[entry.index] = { ...entry.move, startSec: round(target) };
          const note =
            `delayed the ${entry.move.move} from ${entry.move.startSec.toFixed(2)}s to ` +
            `${target.toFixed(2)}s so the camera holds through interaction ` +
            `"${firstClash.id}" (arrive→result)` +
            (overflow > 1e-6 ? ` (cut boundary stretched ${overflow.toFixed(2)}s to fit it)` : "");
          notes.push(note);
          normalized.push(`scene "${scene.id}": ${note}`);
        } else if (!cameraOnlyBoundMoments.length) {
          newPath[entry.index] = undefined;
          const note =
            `dropped the ${entry.move.move} at ${entry.move.startSec.toFixed(2)}s — it re-framed ` +
            `the world mid-interaction "${firstClash.id}" and no retime fits; the drift ` +
            `auto-fill holds the framing instead`;
          notes.push(note);
          normalized.push(`scene "${scene.id}": ${note}`);
        }
      }
      if (notes.length) {
        result = withNormalizationNotes(
          {
            ...scene,
            camera: {
              ...scene.camera!,
              path: newPath.filter((move): move is CameraMoveIntentV1 => move !== undefined),
            },
          },
          notes,
        );
      } else {
        stretch = 0;
      }
    }
    out.push(result);
    if (stretch > 0) stretches.set(scene.id, stretch);
  }
  return { storyboard: applyCascadeStretches(out, stretches), normalized };
}

/**
 * Sentinel normalize-before-retry (2026-07-08, probe-audit-02): stacked entry
 * transitions. A cut INTO a scene is already a transition, so an ENERGETIC
 * full move (whip/orbit/dive, or a committed push/pull — see
 * `isEnergeticCameraMove`) firing within ENTRY_SETTLE_SEC of the scene start
 * plays as two transitions back to back; likewise two energetic moves aimed
 * at DIFFERENT targets with less than MOVE_SETTLE_GAP_SEC between them read
 * as churn (same-target pairs are `mergeCompoundMoves`' business and are
 * already fused by parse time). Both are retimes the host owns: delay the
 * move to the settle point when it fits (never passing the next full move;
 * boundary stretch <= MAX_PACING_STRETCH_SEC, 15s scene cap) and every
 * moment-evidence binding is preserved; otherwise leave the model's own
 * artifact alone — spacing is polish, and an unfixable stack is not worth a
 * veto. Connective pans/drifts/tracks stay free. Runs inside the same
 * parse-side atomic commit-or-revert as the clamp/stretch.
 */
export function spaceStackedCameraMoves(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const resolvedBeatsByScene = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const out: DirectScene[] = [];
  const stretches = new Map<string, number>();
  storyboard.forEach((scene, sceneIndex) => {
    let result = scene;
    let stretch = 0;
    const path = scene.camera?.path;
    if (path?.length) {
      const sceneEnd = scene.startSec + scene.durationSec;
      // A spacing delay must never CREATE a conflict the earlier passes exist
      // to prevent: reading/outcome holds after beats, and interaction
      // arrive→result windows (probe-audit-fable-2: an entry-settle delay put
      // a push-in in flight through a set-state payoff's hold).
      const obstacles = [
        ...beatHoldWindows(scene, resolvedBeatsByScene.get(scene.id) ?? []),
        ...interactionHoldWindows(scene),
      ];
      const fullMoves = path
        .map((move, index) => ({ move, index }))
        .filter((entry) => CAMERA_FULL_MOVES.has(entry.move.move))
        .sort((a, b) => a.move.startSec - b.move.startSec);
      const newPath = [...path];
      const notes: string[] = [];
      // The previous full move's END in retimed coordinates, so a delayed
      // first move spaces the second correctly.
      let previousEnd: number | undefined;
      let previousTarget: string | undefined;
      for (let i = 0; i < fullMoves.length; i += 1) {
        const entry = fullMoves[i]!;
        const current = newPath[entry.index]!;
        let target = current.startSec;
        let reason = "";
        const moveTarget = current.toPart ?? current.toRegion;
        if (isEnergeticCameraMove(current)) {
          // (a) entry settle: scenes after the first enter through a cut.
          if (sceneIndex > 0 && target < scene.startSec + ENTRY_SETTLE_SEC - 1e-6) {
            target = scene.startSec + ENTRY_SETTLE_SEC;
            reason = "the incoming cut needs a beat to land before an energetic reframe";
          }
          // (b) move-to-move gap, different targets only.
          if (
            previousEnd !== undefined &&
            moveTarget !== previousTarget &&
            target < previousEnd + MOVE_SETTLE_GAP_SEC - 1e-6
          ) {
            target = previousEnd + MOVE_SETTLE_GAP_SEC;
            reason = "two energetic moves at different targets need a settle between them";
          }
        }
        if (target > current.startSec + 1e-6) {
          target = advanceClearOfWindows(
            target,
            current.durationSec,
            current.startSec,
            obstacles,
          );
          const next = fullMoves[i + 1];
          const fitsBeforeNext =
            !next || target + current.durationSec <= newPath[next.index]!.startSec + 1e-6;
          const overflow = target + current.durationSec - sceneEnd;
          const fitsScene =
            overflow <= 1e-6 ||
            (overflow <= MAX_PACING_STRETCH_SEC + 1e-9 &&
              scene.durationSec + overflow <= 15 + 1e-9);
          const boundMoments = (scene.moments ?? []).filter((moment) =>
            current.startSec + current.durationSec >= moment.atSec - EVIDENCE_BEFORE_SEC &&
            current.startSec <= moment.atSec + EVIDENCE_AFTER_SEC
          );
          const keepsBindings = boundMoments.every((moment) =>
            target + current.durationSec >= moment.atSec - EVIDENCE_BEFORE_SEC &&
            target <= moment.atSec + EVIDENCE_AFTER_SEC
          );
          if (fitsBeforeNext && fitsScene && keepsBindings) {
            if (overflow > 1e-6) stretch = Math.max(stretch, round(overflow));
            newPath[entry.index] = { ...current, startSec: round(target) };
            const note =
              `delayed the ${current.move} from ${current.startSec.toFixed(2)}s to ` +
              `${target.toFixed(2)}s — ${reason}` +
              (overflow > 1e-6
                ? ` (cut boundary stretched ${overflow.toFixed(2)}s to fit it)`
                : "");
            notes.push(note);
            normalized.push(`scene "${scene.id}": ${note}`);
          }
        }
        const placed = newPath[entry.index]!;
        previousEnd = placed.startSec + placed.durationSec;
        previousTarget = placed.toPart ?? placed.toRegion;
      }
      if (notes.length) {
        result = withNormalizationNotes(
          { ...scene, camera: { ...scene.camera!, path: newPath } },
          notes,
        );
      } else {
        stretch = 0;
      }
    }
    out.push(result);
    if (stretch > 0) stretches.set(scene.id, stretch);
  });
  return { storyboard: applyCascadeStretches(out, stretches), normalized };
}

/**
 * Sentinel normalize-before-retry (2026-07-08, probe-audit-01): the incoming
 * copy of a cut needs a beat to be READ before it CHANGES. A `swap` beat firing
 * within ENTRY_SETTLE_SEC of a non-first scene's start re-writes the just-landed
 * frame before the viewer reads it (probe-audit-01 cta-resolve: the headline
 * morphs in at 18.6s, then swaps its text 0.2s later at 18.8s — a pointless
 * flash of the landed copy). The finding's own fix ("hold the landed copy before
 * swapping it") is pure arithmetic: delay the swap to `scene.startSec +
 * ENTRY_SETTLE_SEC`, when
 *  - the scene is not the first (a first-scene swap has no incoming cut to hold),
 *  - the delayed beat still fits the scene, stretching the cut boundary by <=
 *    MAX_PACING_STRETCH_SEC (15s scene cap) when it overruns (cascade-shifting
 *    later scenes), and
 *  - every moment whose evidence search overlapped the original beat still
 *    overlaps the delayed one (load-bearing binding preserved, exactly like
 *    retimeCameraOverInteractions). If the retime would break a binding, leave
 *    the beat alone; the audit backstop (auditPacing's pacing/reading variant)
 *    then reports the residue.
 * Runs inside the same parse-side atomic commit-or-revert as the other
 * normalizers (order: after moveSpacing, before pacingStretch).
 */
export function delayEarlySwapBeats(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const resolvedBeatsByScene = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const out: DirectScene[] = [];
  const stretches = new Map<string, number>();
  storyboard.forEach((scene, sceneIndex) => {
    let result = scene;
    let stretch = 0;
    const beats = scene.beats;
    if (sceneIndex > 0 && beats?.length) {
      const sceneEnd = scene.startSec + scene.durationSec;
      const settlePoint = round(scene.startSec + ENTRY_SETTLE_SEC);
      const resolved = new Map(
        (resolvedBeatsByScene.get(scene.id) ?? []).map((beat) => [beat.id, beat]),
      );
      const newBeats = [...beats];
      const notes: string[] = [];
      for (let i = 0; i < newBeats.length; i += 1) {
        const beat = newBeats[i]!;
        if (beat.kind !== "swap") continue;
        if (beat.atSec >= settlePoint - 1e-6) continue;
        // Prefer the full entry-settle hold. In a short scene containing
        // several already-landed surfaces, however, pushing a development
        // swap all the way to that point can create a NEW introduction/
        // development deficit and make the atomic normalizer revert. Cap the
        // delay at the latest point that still satisfies that existing floor,
        // while remaining just beyond the audit's tolerated early-swap edge.
        const introductionCount = sceneIntroductionTimes(scene).length;
        const latestDevelopmentAt = round(
          sceneEnd - DEVELOPMENT_SEC_PER_INTRODUCTION * introductionCount +
            PACING_TOLERANCE_SEC,
        );
        const earliestAcceptedAt = round(
          scene.startSec + ENTRY_SETTLE_SEC - PACING_TOLERANCE_SEC + 0.01,
        );
        const target = round(Math.max(
          earliestAcceptedAt,
          Math.min(settlePoint, latestDevelopmentAt),
        ));
        if (target <= beat.atSec + 1e-6 || target > settlePoint + 1e-6) continue;
        // Duration from the resolved beat (default-filled), else the intent.
        const resolvedBeat = resolved.get(beat.id);
        const beatStart = resolvedBeat ? resolvedBeat.startSec : beat.atSec;
        const beatEnd = resolvedBeat ? resolvedBeat.endSec : beat.atSec + (beat.durationSec ?? 0);
        const duration = beatEnd - beatStart;
        const newEnd = target + duration;
        const overflow = newEnd - sceneEnd;
        let beatStretch = 0;
        if (overflow > 1e-6) {
          if (overflow > MAX_PACING_STRETCH_SEC + 1e-9) continue;
          if (scene.durationSec + overflow > 15 + 1e-9) continue;
          beatStretch = round(overflow);
        }
        // Binding preservation: every moment that could bind to the original
        // beat window must still overlap the delayed one.
        const boundMoments = (scene.moments ?? []).filter((moment) =>
          beatEnd >= moment.atSec - EVIDENCE_BEFORE_SEC &&
          beatStart <= moment.atSec + EVIDENCE_AFTER_SEC
        );
        const keepsBindings = boundMoments.every((moment) =>
          newEnd >= moment.atSec - EVIDENCE_BEFORE_SEC &&
          target <= moment.atSec + EVIDENCE_AFTER_SEC
        );
        if (!keepsBindings) continue;
        newBeats[i] = { ...beat, atSec: round(target) };
        if (beatStretch > 0) stretch = Math.max(stretch, beatStretch);
        const note =
          `delayed the swap beat "${beat.id}" from ${beat.atSec.toFixed(2)}s to ` +
          `${target.toFixed(2)}s so the cut's incoming copy holds before it swaps` +
          (overflow > 1e-6 ? ` (cut boundary stretched ${overflow.toFixed(2)}s to fit it)` : "");
        notes.push(note);
        normalized.push(`scene "${scene.id}": ${note}`);
      }
      if (notes.length) {
        result = withNormalizationNotes({ ...scene, beats: newBeats }, notes);
      } else {
        stretch = 0;
      }
    }
    out.push(result);
    if (stretch > 0) stretches.set(scene.id, stretch);
  });
  return { storyboard: applyCascadeStretches(out, stretches), normalized };
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
 * Shortfalls are measured in viewer time, including scenes with a time ramp.
 * Ramps are net-zero and identity at scene boundaries, so extending the cut by
 * N content seconds buys exactly N viewer seconds. Atomic convergence remains
 * the backstop if the longer scene changes the ramp's internal recovery.
 */
export function stretchMarginalPacingMisses(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const conversion = timeConversionService(resolveTimeRampPlan(storyboard));
  const toViewer = (value: number): number => conversion.toViewer(sourceTime(value));
  const resolvedBeatsByScene = new Map<string, ResolvedComponentBeatV1[]>(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const out: DirectScene[] = [];
  const stretches = new Map<string, number>();

  // Detection runs in each scene's ORIGINAL frame (where the resolved beats
  // live); a uniform later shift preserves every within-scene distance, so the
  // shortfall is shift-invariant and the cumulative shift is applied only when
  // emitting the output scene.
  for (const original of storyboard) {
    let applied = 0;
    {
      const sceneEnd = original.startSec + original.durationSec;
      const viewerStart = toViewer(original.startSec);
      const viewerEnd = toViewer(sceneEnd);
      const fullMoves = (original.camera?.path ?? []).filter((move) => CAMERA_FULL_MOVES.has(move.move));
      const stretchEvents = framingChangeEvents(fullMoves);
      const nextFramingChange = (afterSec: number): number =>
        nextFramingChangeAfter(stretchEvents, afterSec, sceneEnd);
      const componentKinds = new Map(
        (original.components ?? []).map((component) => [component.id, component.kind]),
      );
      const beats = resolvedBeatsByScene.get(original.id) ?? [];
      let shortfall = 0;

      // The introduction/development finding is also constrained by the
      // scene's own cut. When the miss is bounded, extending that boundary is
      // the same deterministic arithmetic as a reading/outcome hold and
      // avoids paying a model to move an otherwise coherent late surface.
      // Solve both clauses used by auditPacing: development seconds after the
      // last introduction, and the 65%-of-scene latest-landing cap.
      const introductions = sceneIntroductionTimes(original);
      const isShortFinalResolve =
        original === storyboard[storyboard.length - 1] &&
        original.durationSec <= FINAL_RESOLVE_ALLOWANCE_SEC &&
        introductions.length === 1 &&
        COMPACT_RESOLVE_KINDS.has(original.components?.[0]?.kind ?? "");
      if (introductions.length && !isShortFinalResolve) {
        const lastIntro = introductions[introductions.length - 1]!;
        const neededDevelopment = DEVELOPMENT_SEC_PER_INTRODUCTION * introductions.length;
        const viewerIntro = toViewer(lastIntro);
        const availableDevelopment = viewerEnd - viewerIntro;
        if (availableDevelopment + PACING_TOLERANCE_SEC < neededDevelopment) {
          shortfall = Math.max(shortfall, neededDevelopment - availableDevelopment);
        }
        const viewerLength = viewerEnd - viewerStart;
        const latestAllowed = viewerStart + viewerLength * LAST_INTRODUCTION_MAX_FRACTION;
        if (viewerIntro > latestAllowed + PACING_TOLERANCE_SEC) {
          const viewerLengthNeeded =
            (viewerIntro - viewerStart - PACING_TOLERANCE_SEC) /
            LAST_INTRODUCTION_MAX_FRACTION;
          shortfall = Math.max(shortfall, viewerLengthNeeded - viewerLength);
        }
      }
      for (const beat of beats) {
        // Only a shortfall constrained by the scene's OWN end (not an internal
        // camera move already in flight) is host-stretchable: extending the
        // cut buys the reading/hold time. An internal-move conflict is a
        // creative layout call left to the model.
        if ((beat.kind === "type" || beat.kind === "swap") && beat.text) {
          const wordCount = words(beat.text);
          const needed = Math.min(READING_MAX_SEC, Math.max(READING_MIN_SEC, READING_SEC_PER_WORD * wordCount));
          if (nextFramingChange(beat.endSec) >= sceneEnd - 1e-6) {
            const available = viewerEnd - toViewer(beat.endSec);
            if (available + PACING_TOLERANCE_SEC < needed) shortfall = Math.max(shortfall, needed - available);
          }
        }
        const isToastOpen = beat.kind === "open" && componentKinds.get(beat.component) === "toast";
        if (PAYOFF_BEAT_KINDS.has(beat.kind) || isToastOpen) {
          if (nextFramingChange(beat.endSec) >= sceneEnd - 1e-6) {
            const available = viewerEnd - toViewer(beat.endSec);
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
    if (applied > 0) {
      const note =
        `stretched ${applied.toFixed(2)}s to close a marginal pacing-floor ` +
        `shortfall at its own cut boundary`;
      out.push(withNormalizationNotes(
        original,
        [note],
      ));
      stretches.set(original.id, applied);
      normalized.push(`scene "${original.id}": ${note}`);
    } else {
      out.push(original);
    }
  }
  return { storyboard: applyCascadeStretches(out, stretches), normalized };
}
