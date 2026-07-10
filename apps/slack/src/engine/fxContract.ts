/**
 * sequences-fx.v1 — the host FX runtime plan (MD2): light sweeps, glow
 * pulses, and trim-path draws, compiled as seek-safe garnish on top of the
 * choreography contracts.
 *
 * The taste ladder is the architecture rule: everything here is derived by
 * the HOST from data the storyboard already carries (payoff beats, primary
 * moments, camera arrivals) or from one optional field on an EXISTING
 * concept (`highlight` beat `style`). The planner never orders garnish from
 * a menu; the author at most places optional kit markup (`.fx-connector`).
 * Every effect is enhancement-only: a missing target compiles to nothing,
 * never a veto — and every artifact the runtime appends is
 * `data-layout-ignore` + `data-sequences-fx`-marked so coverage, eye-trace,
 * stale-asset, near-blank, and AA audits never see decoration as content.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAMERA_FULL_MOVES, resolveCameraPlan } from "./cameraContract.ts";
import { resolveComponentPlan } from "./componentContract.ts";
import { EVIDENCE_AFTER_SEC, EVIDENCE_BEFORE_SEC } from "./storyboardMoments.ts";
import { GRADE_SHIFT_DURATION_SEC, type GradeTone } from "./gradeShift.ts";
import {
  directionAccentSlot,
  directionPhraseForMoment,
  directionScoreConsumersEnabled,
  directionSystemOwnsWindow,
  resolveFilmDirectionScore,
} from "./directionScore.ts";
import type { DirectScene } from "./directComposition.ts";

export const FX_RUNTIME_VERSION = 1;
export const FX_RUNTIME_FILE = "sequences-fx.v1.js";

const RUNTIME_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
  FX_RUNTIME_FILE,
);

/** Sweeps are the film's loudest garnish — capped host-side, by design. */
export const MAX_SWEEPS_PER_SCENE = 1;
export const MAX_SWEEPS_PER_FILM = 3;
/**
 * Connectors were host-derived toward EVERY full-move region arrival, so a busy
 * film drew a line at every reframe — the #1 recurring "repetitive spamming"
 * complaint (probe-audit-01/02). Cap them like sweeps: one per scene (the
 * earliest arrival), a handful across the film, and never in a scene that
 * already earned a sweep (one garnish per scene reads produced; two reads busy).
 */
export const MAX_CONNECTORS_PER_SCENE = 1;
export const MAX_CONNECTORS_PER_FILM = 3;
/** No sweep inside the film's very first second — the hook owns that beat. */
export const SWEEP_OPENING_EXCLUSION_SEC = 1;
/**
 * Sweeps schedule at evidence SETTLE + ε, strictly after the temporal judge's
 * after-frame (evidence.endSec + 0.08) — a sweep is a visible change and must
 * never be what "proves" a moment's own claimed change.
 */
export const SWEEP_SETTLE_DELAY_SEC = 0.15;
export const SWEEP_DURATION_SEC = 0.7;
export const GLOW_PULSE_DURATION_SEC = 0.9;

/** Beat kinds whose completion is a payoff worth answering with light. */
const PAYOFF_EVIDENCE_KINDS: ReadonlySet<string> = new Set([
  "count",
  "press",
  "set-state",
  "progress",
  "chart",
]);

export type FxEffectKind = "sweep" | "glow-pulse" | "draw" | "connector" | "grade-shift";

export interface FxEffectV1 {
  kind: FxEffectKind;
  sceneId: string;
  /** sweep / glow-pulse / draw: the data-part the effect answers.
   *  grade-shift: legacy anchor hint (the full-frame wash ignores it). */
  target?: string;
  /** connector: the data-region whose camera arrival ends the draw. */
  region?: string;
  /** grade-shift: the grade class the scene turns to at full cover. */
  toGrade?: GradeTone;
  atSec: number;
  durationSec: number;
}

export interface FxPlanV1 {
  version: 1;
  effects: FxEffectV1[];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Derive the film's FX plan from the storyboard — no planner surface, no
 * author paperwork. Automatic rungs:
 *
 * 1. Payoff sweep: each `primary` moment bound (by the same evidence-window
 *    arithmetic the moment contract uses) to a completing payoff beat may get
 *    one sweep in the direction score's free accent slot. It never stacks a
 *    glow on the same payoff and stands down when another system owns the
 *    phrase. Capped ≤1 sweep/scene, ≤3/film, none in the opening second.
 * 2. Planner opt-in: a `highlight` beat with `style:"sweep"` sweeps its
 *    component at the beat's own window (the ring is simply replaced).
 * 3. Author opt-in: every full camera move landing on a region emits a
 *    `connector` effect; the runtime draws any `.fx-connector`
 *    `[data-fx-toward="<region>"]` strokes to complete at the arrival.
 *    Absent markup compiles to nothing.
 */
export function resolveFxPlan(scenes: DirectScene[]): FxPlanV1 {
  const effects: FxEffectV1[] = [];
  const direction = resolveFilmDirectionScore(scenes);
  const directed = directionScoreConsumersEnabled();
  const beatsByScene = new Map(
    resolveComponentPlan(scenes).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const filmStart = scenes[0]?.startSec ?? 0;
  let filmSweeps = 0;

  for (const scene of scenes) {
    const sceneEnd = scene.startSec + scene.durationSec;
    const beats = beatsByScene.get(scene.id) ?? [];
    let sceneSweeps = 0;

    // MD4 grade shift: the scene's temperature turns at a payoff. The runtime
    // fades a full-frame panel to the target grade's own steady wash, swaps
    // the grade class at cover, and carries the tone across later same-grade
    // scenes. Discipline (window, aftermath, 1/scene, 2/film,
    // moment coincidence) is enforced at parse (`dropUnusableGradeShifts`), so a
    // surviving gradeShift always compiles.
    if (scene.gradeShift) {
      effects.push({
        kind: "grade-shift",
        sceneId: scene.id,
        ...(scene.gradeShift.fromPart ? { target: scene.gradeShift.fromPart } : {}),
        toGrade: scene.gradeShift.toGrade,
        atSec: round(scene.gradeShift.atSec),
        durationSec: GRADE_SHIFT_DURATION_SEC,
      });
    }

    // MD3 underline draw: a highlight beat with style:"underline" draws a
    // trim-path rule under its target (the kit `.fx-underline` SVG is topped up
    // deterministically when absent). The default ring is skipped in the
    // component runtime whenever the style is non-ring, so there is one owner.
    for (const beat of beats) {
      if (beat.kind !== "highlight" || beat.style !== "underline") continue;
      effects.push({
        kind: "draw",
        sceneId: scene.id,
        target: beat.component,
        atSec: round(beat.startSec),
        durationSec: round(Math.max(0.2, beat.endSec - beat.startSec)),
      });
    }

    // Rung 2 first: an explicit style:"sweep" highlight is the planner's own
    // call and wins the scene's sweep slot over the automatic rung.
    for (const beat of beats) {
      if (beat.kind !== "highlight" || beat.style !== "sweep") continue;
      if (filmSweeps >= MAX_SWEEPS_PER_FILM || sceneSweeps >= MAX_SWEEPS_PER_SCENE) break;
      effects.push({
        kind: "sweep",
        sceneId: scene.id,
        target: beat.component,
        atSec: round(beat.startSec),
        durationSec: round(Math.min(
          Math.max(beat.endSec - beat.startSec, SWEEP_DURATION_SEC),
          Math.max(0.2, sceneEnd - beat.startSec),
        )),
      });
      sceneSweeps += 1;
      filmSweeps += 1;
    }

    // Rung 1: one automatic payoff answer, scheduled only after the dominant
    // component action has settled and only when the phrase leaves enough
    // room before its next cue. The old simultaneous sweep + glow pair made
    // garnish compete with the state change it was meant to support.
    for (const moment of scene.moments ?? []) {
      if (moment.importance !== "primary") continue;
      if (moment.atSec < filmStart + SWEEP_OPENING_EXCLUSION_SEC) continue;
      if (filmSweeps >= MAX_SWEEPS_PER_FILM || sceneSweeps >= MAX_SWEEPS_PER_SCENE) break;
      const payoff = beats.find((beat) =>
        PAYOFF_EVIDENCE_KINDS.has(beat.kind) &&
        moment.atSec >= beat.startSec - EVIDENCE_BEFORE_SEC &&
        moment.atSec <= beat.endSec + EVIDENCE_AFTER_SEC
      );
      if (!payoff) continue;
      if (!directed) {
        const atSec = round(payoff.endSec + SWEEP_SETTLE_DELAY_SEC);
        if (atSec + 0.2 > sceneEnd) continue;
        effects.push({
          kind: "sweep",
          sceneId: scene.id,
          target: payoff.component,
          atSec,
          durationSec: round(Math.min(SWEEP_DURATION_SEC, sceneEnd - atSec)),
        });
        effects.push({
          kind: "glow-pulse",
          sceneId: scene.id,
          target: payoff.component,
          atSec: round(payoff.endSec + 0.1),
          durationSec: round(Math.min(
            GLOW_PULSE_DURATION_SEC,
            sceneEnd - payoff.endSec - 0.1,
          )),
        });
        sceneSweeps += 1;
        filmSweeps += 1;
        continue;
      }
      const phrase = directionPhraseForMoment(direction, scene.id, moment.id);
      if (
        !phrase ||
        phrase.dominant.system !== "component" ||
        phrase.dominant.id !== `component:${payoff.id}`
      ) {
        continue;
      }
      const atSec = directionAccentSlot(
        phrase,
        SWEEP_DURATION_SEC,
        Math.max(
          filmStart + SWEEP_OPENING_EXCLUSION_SEC,
          payoff.endSec + SWEEP_SETTLE_DELAY_SEC,
        ),
      );
      if (atSec === undefined || atSec + 0.2 > sceneEnd) continue;
      effects.push({
        kind: "sweep",
        sceneId: scene.id,
        target: payoff.component,
        atSec,
        durationSec: round(Math.min(SWEEP_DURATION_SEC, sceneEnd - atSec)),
      });
      sceneSweeps += 1;
      filmSweeps += 1;
    }
  }

  // Rung 3: connector draw-ons toward full-move region arrivals. Pure
  // decoration — the runtime no-ops when the author placed no `.fx-connector`
  // markup — and it AIDS eye-trace: the drawn line points where the camera goes
  // next. Density-capped (probe-audit-01/02: a line at EVERY reframe read as
  // spam): at most one per scene (the earliest arrival), MAX_CONNECTORS_PER_FILM
  // across the film in scene order, and none in a scene that already earned a
  // sweep this pass.
  const sweepScenes = new Set(
    effects.filter((effect) => effect.kind === "sweep").map((effect) => effect.sceneId),
  );
  let filmConnectors = 0;
  for (const scenePlan of resolveCameraPlan(scenes).scenes) {
    if (filmConnectors >= MAX_CONNECTORS_PER_FILM) break;
    if (sweepScenes.has(scenePlan.sceneId)) continue;
    const arrivals = scenePlan.segments
      .filter((segment) =>
        CAMERA_FULL_MOVES.has(segment.move) && segment.blend >= 1 && Boolean(segment.toRegion) &&
        (!directed || directionSystemOwnsWindow(
          direction,
          scenePlan.sceneId,
          "camera",
          segment.startSec,
          segment.endSec,
        ))
      )
      .sort((a, b) => a.startSec - b.startSec)
      .slice(0, MAX_CONNECTORS_PER_SCENE);
    for (const arrival of arrivals) {
      if (filmConnectors >= MAX_CONNECTORS_PER_FILM) break;
      effects.push({
        kind: "connector",
        sceneId: scenePlan.sceneId,
        region: arrival.toRegion!,
        atSec: round(arrival.startSec),
        durationSec: round(Math.max(0.2, arrival.endSec - arrival.startSec)),
      });
      filmConnectors += 1;
    }
  }

  return { version: 1, effects };
}

export function fxRuntimeSource(): string {
  return fs.readFileSync(RUNTIME_SOURCE_PATH, "utf8");
}

export function fxRuntimeHash(): string {
  return createHash("sha256").update(fxRuntimeSource()).digest("hex");
}

export function parseFxPlan(html: string): { plan?: FxPlanV1; errors: string[] } {
  const match = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-fx\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return { errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(match[2]!.trim());
  } catch (error) {
    return {
      errors: [
        `sequences-fx JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["sequences-fx must be an object"] };
  }
  const object = value as Record<string, unknown>;
  if (object.version !== 1 || !Array.isArray(object.effects)) {
    return { errors: ["sequences-fx must carry version 1 and an effects array"] };
  }
  return { plan: object as unknown as FxPlanV1, errors: [] };
}

/**
 * Static publication check, deliberately soft: the island is host-injected
 * from the same resolver, so drift means plumbing broke — report it — but a
 * missing island with an empty resolved plan is simply "no fx", never an
 * error (the whole runtime is enhancement-only).
 */
export function validateFxContract(
  html: string,
  scenes: DirectScene[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const expected = resolveFxPlan(scenes);
  const parsed = parseFxPlan(html);
  errors.push(...parsed.errors);
  if (!expected.effects.length) return { errors, warnings };
  if (!parsed.plan) {
    errors.push("resolved fx plan has effects but index_html has no sequences-fx JSON island");
    return { errors, warnings };
  }
  if (!html.includes(`src="${FX_RUNTIME_FILE}"`) && !html.includes(`src='${FX_RUNTIME_FILE}'`)) {
    errors.push(`fx composition must load local ${FX_RUNTIME_FILE}`);
  }
  if (!/\bSequencesFx\.compile\s*\(/.test(html)) {
    errors.push("fx composition must call SequencesFx.compile(timeline, root)");
  }
  if (JSON.stringify(parsed.plan) !== JSON.stringify(expected)) {
    errors.push("sequences-fx island differs from the storyboard's resolved fx plan");
  }
  return { errors, warnings };
}
