/**
 * Film-level deterministic motion direction.
 *
 * The typed runtimes already know how to execute local camera, component,
 * interaction, grade, time, and cut plans. This score is the small host-owned
 * artifact that lets them agree on the multi-second phrase those plans serve.
 * It is derived entirely from the locked storyboard: no new planner fields,
 * no model rewrite pass, and no wall-clock/runtime state.
 *
 * The score deliberately does not retime authored actions. It names one
 * dominant action around each reviewable cue, records competing systems,
 * supplies a bounded settle window, and exposes a free accent slot. Consumers
 * may subordinate automatic behavior (camera creep and derived garnish) while
 * preserving every declared beat and arbitrary-seek determinism.
 */
import type { DirectScene } from "./directComposition.ts";
import type {
  MomentImportance,
  StoryboardMomentV1,
} from "./storyboardMoments.ts";
import { slackSequencesEnvRawValue } from "./featureFlags.ts";

// Mirrors the moment contract's evidence neighborhood without importing its
// runtime module (motionDensity imports the camera resolver, so a value import
// here would create a camera -> direction -> moments -> camera cycle).
const DIRECTION_EVIDENCE_BEFORE_SEC = 0.45;
const DIRECTION_EVIDENCE_AFTER_SEC = 0.75;

/**
 * Operational A/B switch for the score's automatic consumers. The score is
 * still derived and persisted while disabled so two renders of the same
 * locked storyboard remain directly comparable; only camera settle holds and
 * ownership-aware automatic FX stand down.
 */
export function directionScoreConsumersEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_DIRECTION_SCORE") !== "0";
}

export type DirectionSystem =
  | "cut"
  | "camera"
  | "interaction"
  | "component"
  | "grade"
  | "time"
  | "composition";

export type DirectionPhraseRole =
  | "entry"
  | "develop"
  | "turn"
  | "payoff"
  | "resolve";

export type DirectionBoundaryRelationship = "establish" | "carry" | "reset";

export interface DirectionActionV1 {
  system: DirectionSystem;
  id: string;
  startSec: number;
  endSec: number;
  /** The action's resolution/arrival time, used to bind it to a moment. */
  atSec: number;
  energy: number;
  part?: string;
  region?: string;
  /** Evidence-bound authored target when no typed part/region exists. */
  selector?: string;
}

export interface DirectionEnergyContourV1 {
  in: number;
  peak: number;
  out: number;
}

export interface DirectionSettleWindowV1 {
  startSec: number;
  endSec: number;
  phraseId: string;
  owner: DirectionSystem;
}

export interface DirectionPhraseV1 {
  id: string;
  sceneId: string;
  momentId?: string;
  role: DirectionPhraseRole;
  startSec: number;
  endSec: number;
  cueSec: number;
  energy: DirectionEnergyContourV1;
  dominant: DirectionActionV1;
  /** Other authored systems active around the same cue. They remain authored;
   * automatic consumers use this list to avoid adding a third voice. */
  competing: DirectionActionV1[];
  attention?: { part?: string; region?: string; selector?: string };
  settleUntilSec: number;
}

export interface SceneDirectionScoreV1 {
  sceneId: string;
  entryRelationship: DirectionBoundaryRelationship;
  phrases: DirectionPhraseV1[];
  settleWindows: DirectionSettleWindowV1[];
}

export interface FilmDirectionScoreV1 {
  version: 1;
  source: "host-derived";
  durationSec: number;
  scenes: SceneDirectionScoreV1[];
}

interface DirectionCue {
  id: string;
  atSec: number;
  moment?: StoryboardMomentV1;
  synthetic?: "entry" | "action";
  action: DirectionActionV1;
  candidates: DirectionActionV1[];
}

const FULL_CAMERA_MOVES = new Set([
  "pan",
  "whip",
  "push-in",
  "pull-back",
  "track-to-anchor",
  "parallax-pass",
  "orbit-lite",
  "orbit",
  "dive",
]);

const CARRYING_CUTS = new Set([
  "swipe",
  "cut-left",
  "cut-right",
  "cut-up",
  "cut-down",
  "zoom-through",
  "inverse-zoom",
  "match",
  "object-match",
  "shape-match",
  "morph",
]);

const COMPONENT_DEFAULT_SEC: Record<string, number> = {
  type: 1.2,
  open: 0.5,
  close: 0.35,
  select: 0.35,
  press: 0.45,
  "set-state": 0.4,
  count: 1.1,
  progress: 1,
  chart: 1.2,
  rows: 0.9,
  stream: 1.6,
  highlight: 0.9,
  morph: 0.8,
  swap: 0.6,
  animate: 0.8,
};

const SYSTEM_PRIORITY: Record<DirectionSystem, number> = {
  cut: 0,
  grade: 1,
  interaction: 2,
  component: 3,
  camera: 4,
  time: 5,
  composition: 6,
};

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function componentEnergy(kind: string): number {
  if (["count", "progress", "chart", "morph", "set-state"].includes(kind)) return 0.76;
  if (["press", "select", "open", "swap", "highlight"].includes(kind)) return 0.64;
  return 0.48;
}

function cameraEnergy(move: string): number {
  if (["whip", "dive", "orbit"].includes(move)) return 0.9;
  if (["push-in", "pull-back", "track-to-anchor", "parallax-pass"].includes(move)) {
    return 0.78;
  }
  return 0.62;
}

function sceneActions(
  scenes: DirectScene[],
  scene: DirectScene,
  sceneIndex: number,
): DirectionActionV1[] {
  const actions: DirectionActionV1[] = [];
  const sceneEnd = scene.startSec + scene.durationSec;
  const previous = scenes[sceneIndex - 1];
  if (previous) {
    const style = previous.cut?.style ?? "hard";
    actions.push({
      system: "cut",
      id: `cut:${previous.id}->${scene.id}`,
      startSec: scene.startSec,
      endSec: round(Math.min(sceneEnd, scene.startSec + 0.15)),
      atSec: scene.startSec,
      energy: style === "flash-white" ? 0.9 : style === "hard" ? 0.68 : 0.76,
      ...(scene.spatialIntent?.focalPart ? { part: scene.spatialIntent.focalPart } : {}),
    });
  }

  for (const [index, move] of (scene.camera?.path ?? []).entries()) {
    if (!FULL_CAMERA_MOVES.has(move.move)) continue;
    const startSec = Math.max(scene.startSec, move.startSec);
    const endSec = Math.min(sceneEnd, startSec + Math.max(0.15, move.durationSec));
    actions.push({
      system: "camera",
      id: `camera:${scene.id}:${index}`,
      startSec: round(startSec),
      endSec: round(endSec),
      atSec: round(endSec),
      energy: cameraEnergy(move.move),
      ...(move.toPart ? { part: move.toPart } : {}),
      ...(move.toRegion ? { region: move.toRegion } : {}),
    });
  }

  for (const beat of scene.beats ?? []) {
    const duration = Math.max(0.1, beat.durationSec ?? COMPONENT_DEFAULT_SEC[beat.kind] ?? 0.6);
    const startSec = Math.max(scene.startSec, beat.atSec);
    const endSec = Math.min(sceneEnd, startSec + duration);
    const component = scene.components?.find((entry) => entry.id === beat.component);
    const plugin = component?.pluginUid
      ? scene.plugins?.find((entry) => entry.uid === component.pluginUid)
      : undefined;
    // A lockup is one compositional subject. Its headline/sub/CTA still animate
    // independently, but those internal beats must not make the camera zoom
    // between siblings or frame a subtitle while cropping the wordmark.
    const attentionPart = plugin?.kind === "lockup" ? plugin.id : beat.component;
    actions.push({
      system: "component",
      id: `component:${beat.id}`,
      startSec: round(startSec),
      endSec: round(endSec),
      atSec: round(endSec),
      energy: componentEnergy(beat.kind),
      part: attentionPart,
    });
  }

  for (const interaction of scene.interactions ?? []) {
    const actionSec = interaction.releaseSec ?? interaction.pressSec ?? interaction.arriveSec;
    const endSec = Math.min(
      sceneEnd,
      interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec,
    );
    actions.push({
      system: "interaction",
      id: `interaction:${interaction.id}`,
      startSec: round(Math.max(scene.startSec, interaction.startSec)),
      endSec: round(Math.max(actionSec, endSec)),
      atSec: round(actionSec),
      energy: interaction.action === "click" || interaction.action === "drag" ? 0.74 : 0.58,
      part: interaction.targetPart,
    });
  }

  if (scene.gradeShift) {
    actions.push({
      system: "grade",
      id: `grade:${scene.id}:${scene.gradeShift.toGrade}`,
      startSec: scene.gradeShift.atSec,
      endSec: round(Math.min(sceneEnd, scene.gradeShift.atSec + 0.9)),
      atSec: scene.gradeShift.atSec,
      energy: 0.82,
      ...(scene.gradeShift.fromPart ? { part: scene.gradeShift.fromPart } : {}),
    });
  }

  if (scene.timeRamp) {
    const duration = 0.75 + (scene.timeRamp.holdSec ?? 0.6) + (scene.timeRamp.recoverSec ?? 0.9);
    actions.push({
      system: "time",
      id: `time:${scene.id}`,
      startSec: scene.timeRamp.atSec,
      endSec: round(Math.min(sceneEnd, scene.timeRamp.atSec + duration)),
      atSec: scene.timeRamp.atSec,
      energy: 0.58,
      ...(scene.spatialIntent?.focalPart ? { part: scene.spatialIntent.focalPart } : {}),
    });
  }

  return actions.sort((a, b) =>
    a.atSec - b.atSec || SYSTEM_PRIORITY[a.system] - SYSTEM_PRIORITY[b.system] ||
    a.id.localeCompare(b.id)
  );
}

function preferredSystem(moment: StoryboardMomentV1): DirectionSystem | undefined {
  const intent = `${moment.motionIntent} ${moment.title} ${moment.change}`.toLowerCase();
  if (/\b(?:grade|warm|cold|temperature|colour|color)\b/.test(intent)) return "grade";
  if (/\b(?:cursor|click|drag|hover|press|interaction)\b/.test(intent)) return "interaction";
  if (/\b(?:camera|arrival|reframe|zoom|pan|whip|track)\b/.test(intent)) return "camera";
  if (/\b(?:cut|transition)\b/.test(intent)) return "cut";
  if (/\b(?:slow|ramp|time)\b/.test(intent)) return "time";
  if (/\b(?:type|ui|state|count|chart|progress|morph|swap|draw|reveal|resolve)\b/.test(intent)) {
    return "component";
  }
  return undefined;
}

function actionMatchesMoment(action: DirectionActionV1, moment: StoryboardMomentV1): boolean {
  return moment.atSec >= action.startSec - DIRECTION_EVIDENCE_BEFORE_SEC &&
    moment.atSec <= action.endSec + DIRECTION_EVIDENCE_AFTER_SEC;
}

function fallbackAction(scene: DirectScene, moment: StoryboardMomentV1): DirectionActionV1 {
  const evidenceTarget = moment.evidence?.kind === "tween"
    ? moment.evidence.detail.split("→").at(-1)?.trim()
    : undefined;
  return {
    system: "composition",
    id: `composition:${moment.id}`,
    startSec: moment.atSec,
    endSec: moment.atSec,
    atSec: moment.atSec,
    energy: moment.importance === "primary" ? 0.7 : 0.42,
    ...(scene.spatialIntent?.focalPart ? { part: scene.spatialIntent.focalPart } : {}),
    ...(!scene.spatialIntent?.focalPart && evidenceTarget
      ? { selector: evidenceTarget }
      : {}),
  };
}

function chooseMomentAction(
  scene: DirectScene,
  moment: StoryboardMomentV1,
  actions: DirectionActionV1[],
): { action: DirectionActionV1; candidates: DirectionActionV1[] } {
  const candidates = actions.filter((action) => actionMatchesMoment(action, moment));
  if (!candidates.length) return { action: fallbackAction(scene, moment), candidates: [] };
  const preferred = preferredSystem(moment);
  const ordered = [...candidates].sort((a, b) => {
    const preferredDelta = Number(b.system === preferred) - Number(a.system === preferred);
    if (preferredDelta) return preferredDelta;
    // A primary cue describes the shot's declared subject, not merely the
    // closest local animation. Notification-stack beats often overlap a hero
    // metric's count; choosing the nearest toast made the eye bounce away from
    // the focal metric and then back again (GatePilot stress probe). Keep the
    // planner's focal hierarchy authoritative when both candidates belong to
    // the requested system. Supporting cues remain free to follow local beats.
    const focalPart = moment.importance === "primary"
      ? scene.spatialIntent?.focalPart
      : undefined;
    if (focalPart && a.system === preferred && b.system === preferred) {
      const focalDelta = Number(b.part === focalPart) - Number(a.part === focalPart);
      if (focalDelta) return focalDelta;
    }
    // A camera cue often names what is happening DURING travel rather than
    // its later arrival. Prefer the preferred-system action actually carrying
    // the cue over the move that happened to finish nearest it; at a shared
    // boundary, the newly starting move wins via start-distance below. This
    // keeps attention moving forward through multi-station routes instead of
    // snapping back to the station the camera just left (Vectorline probe 1).
    const active = (action: DirectionActionV1): number => Number(
      action.system === preferred &&
      moment.atSec >= action.startSec - 0.001 &&
      moment.atSec <= action.endSec + 0.001,
    );
    const activeDelta = active(b) - active(a);
    if (activeDelta) return activeDelta;
    if (active(a) && active(b)) {
      const startDelta = Math.abs(a.startSec - moment.atSec) -
        Math.abs(b.startSec - moment.atSec);
      if (startDelta) return startDelta;
    }
    // A full-frame grade or an entry cut is already a large authored action;
    // when the moment did not name another owner, it commands the cue.
    const majorDelta = Number(["grade", "cut"].includes(b.system)) -
      Number(["grade", "cut"].includes(a.system));
    if (majorDelta) return majorDelta;
    return Math.abs(a.atSec - moment.atSec) - Math.abs(b.atSec - moment.atSec) ||
      SYSTEM_PRIORITY[a.system] - SYSTEM_PRIORITY[b.system] ||
      a.id.localeCompare(b.id);
  });
  return { action: ordered[0]!, candidates };
}

function entryRelationship(
  scenes: DirectScene[],
  sceneIndex: number,
): DirectionBoundaryRelationship {
  if (sceneIndex === 0) return "establish";
  const style = scenes[sceneIndex - 1]?.cut?.style ?? "hard";
  return CARRYING_CUTS.has(style) ? "carry" : "reset";
}

function settleDuration(system: DirectionSystem, importance?: MomentImportance): number {
  const base = importance === "primary" ? 0.55 : importance === "supporting" ? 0.28 : 0.32;
  if (system === "grade") return base + 0.2;
  if (system === "camera") return base + 0.08;
  if (system === "cut") return 0.36;
  return base;
}

function phraseRole(
  cue: DirectionCue,
  isFinalCue: boolean,
  isFinalScene: boolean,
): DirectionPhraseRole {
  if (cue.synthetic === "entry" || cue.action.system === "cut") return "entry";
  if (cue.action.system === "grade" || cue.action.system === "time") return "turn";
  if (cue.moment?.importance === "primary") {
    return isFinalCue && isFinalScene ? "resolve" : "payoff";
  }
  return "develop";
}

function buildCues(
  scenes: DirectScene[],
  scene: DirectScene,
  sceneIndex: number,
  actions: DirectionActionV1[],
): DirectionCue[] {
  const cues: DirectionCue[] = (scene.moments ?? []).map((moment) => {
    const chosen = chooseMomentAction(scene, moment, actions);
    return {
      id: `moment:${moment.id}`,
      atSec: moment.atSec,
      moment,
      action: chosen.action,
      candidates: chosen.candidates,
    };
  });

  const entry = actions.find((action) => action.system === "cut");
  if (entry && !cues.some((cue) => Math.abs(cue.atSec - scene.startSec) <= 0.25)) {
    cues.push({
      id: `entry:${scene.id}`,
      atSec: scene.startSec,
      synthetic: "entry",
      action: entry,
      candidates: actions.filter((action) => actionMatchesMoment(action, {
        version: 1,
        id: "entry",
        sceneId: scene.id,
        atSec: scene.startSec,
        title: "entry",
        visualState: "entry",
        change: "entry",
        motionIntent: "cut",
        importance: "supporting",
      })),
    });
  }

  // Legacy/small test storyboards can predate declared moments. Preserve a
  // useful score by promoting their concrete actions directly; publication
  // storyboards normally use their moment contract as the cue list.
  if (!(scene.moments ?? []).length) {
    for (const action of actions) {
      if (cues.some((cue) => cue.action.id === action.id)) continue;
      cues.push({
        id: `action:${action.id}`,
        atSec: action.atSec,
        synthetic: action.system === "cut" ? "entry" : "action",
        action,
        candidates: actions.filter((candidate) =>
          candidate.startSec <= action.endSec + 0.01 &&
          candidate.endSec >= action.startSec - 0.01
        ),
      });
    }
  }

  return cues
    .sort((a, b) => a.atSec - b.atSec || a.id.localeCompare(b.id))
    .filter((cue, index, all) =>
      index === 0 || cue.id !== all[index - 1]!.id || Math.abs(cue.atSec - all[index - 1]!.atSec) > 0.001
    );
}

/** Derive the inspectable direction score for a complete locked storyboard. */
export function resolveFilmDirectionScore(scenes: DirectScene[]): FilmDirectionScoreV1 {
  const durationSec = round(Math.max(0, ...scenes.map((scene) => scene.startSec + scene.durationSec)));
  const scoreScenes: SceneDirectionScoreV1[] = scenes.map((scene, sceneIndex) => {
    const actions = sceneActions(scenes, scene, sceneIndex);
    const cues = buildCues(scenes, scene, sceneIndex, actions);
    const relationship = entryRelationship(scenes, sceneIndex);
    const sceneEnd = scene.startSec + scene.durationSec;
    const peaks = cues.map((cue) => clamp01(
      cue.action.energy + (cue.moment?.importance === "primary" ? 0.12 : 0),
    ));
    const phrases: DirectionPhraseV1[] = cues.map((cue, index) => {
      const previous = cues[index - 1];
      const next = cues[index + 1];
      const startSec = previous
        ? round((previous.atSec + cue.atSec) / 2)
        : scene.startSec;
      const endSec = next ? round((cue.atSec + next.atSec) / 2) : round(sceneEnd);
      const settleStart = cue.action.system === "cut"
        ? cue.action.startSec
        : Math.max(cue.atSec, cue.action.endSec);
      const settleUntilSec = round(Math.max(
        settleStart,
        Math.min(
          endSec,
          sceneEnd,
          settleStart + settleDuration(cue.action.system, cue.moment?.importance),
        ),
      ));
      const dominant = {
        ...cue.action,
        energy: peaks[index]!,
      };
      const competing = cue.candidates.filter((action) =>
        action.id !== dominant.id && action.system !== dominant.system &&
        action.startSec <= dominant.endSec + DIRECTION_EVIDENCE_AFTER_SEC &&
        action.endSec >= dominant.startSec - DIRECTION_EVIDENCE_BEFORE_SEC
      );
      const phraseId = `${scene.id}:${String(index + 1).padStart(2, "0")}`;
      return {
        id: phraseId,
        sceneId: scene.id,
        ...(cue.moment ? { momentId: cue.moment.id } : {}),
        role: phraseRole(cue, index === cues.length - 1, sceneIndex === scenes.length - 1),
        startSec,
        endSec,
        cueSec: round(cue.atSec),
        energy: {
          in: round(index > 0 ? Math.max(0.12, peaks[index - 1]! * 0.45) : relationship === "carry" ? 0.42 : 0.14),
          peak: round(peaks[index]!),
          out: round(index + 1 < peaks.length ? Math.max(0.12, peaks[index + 1]! * 0.45) : 0.2),
        },
        dominant,
        competing,
        ...((dominant.part || dominant.region || dominant.selector)
          ? {
              attention: {
                ...(dominant.part ? { part: dominant.part } : {}),
                ...(dominant.region ? { region: dominant.region } : {}),
                ...(dominant.selector ? { selector: dominant.selector } : {}),
              },
            }
          : {}),
        settleUntilSec,
      };
    });
    return {
      sceneId: scene.id,
      entryRelationship: relationship,
      phrases,
      settleWindows: phrases.flatMap((phrase): DirectionSettleWindowV1[] => {
        const startSec = phrase.dominant.system === "cut"
          ? phrase.dominant.startSec
          : Math.max(phrase.cueSec, phrase.dominant.endSec);
        return phrase.settleUntilSec - startSec > 0.04
          ? [{
              startSec: round(startSec),
              endSec: phrase.settleUntilSec,
              phraseId: phrase.id,
              owner: phrase.dominant.system,
            }]
          : [];
      }),
    };
  });
  return { version: 1, source: "host-derived", durationSec, scenes: scoreScenes };
}

export function directionPhraseForMoment(
  score: FilmDirectionScoreV1,
  sceneId: string,
  momentId: string,
): DirectionPhraseV1 | undefined {
  return score.scenes.find((scene) => scene.sceneId === sceneId)?.phrases
    .find((phrase) => phrase.momentId === momentId);
}

export function directionSettleWindows(
  score: FilmDirectionScoreV1,
  sceneId: string,
): DirectionSettleWindowV1[] {
  return score.scenes.find((scene) => scene.sceneId === sceneId)?.settleWindows ?? [];
}

/**
 * Find a deterministic slot for one automatic accent after a phrase settles.
 * Undefined means the next phrase/cut arrives too soon; garnish stands down.
 */
export function directionAccentSlot(
  phrase: DirectionPhraseV1,
  durationSec: number,
  earliestSec = 0,
): number | undefined {
  const atSec = round(Math.max(earliestSec, phrase.settleUntilSec + 0.08));
  return atSec + durationSec <= phrase.endSec + 1e-6 ? atSec : undefined;
}

/** True when a system is the declared owner of a phrase overlapping a window. */
export function directionSystemOwnsWindow(
  score: FilmDirectionScoreV1,
  sceneId: string,
  system: DirectionSystem,
  startSec: number,
  endSec: number,
): boolean {
  const phrases = score.scenes.find((scene) => scene.sceneId === sceneId)?.phrases ?? [];
  return phrases.some((phrase) =>
    phrase.dominant.system === system &&
    phrase.dominant.startSec <= endSec + 0.01 &&
    phrase.dominant.endSec >= startSec - 0.01
  );
}
