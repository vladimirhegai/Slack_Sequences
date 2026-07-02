import { resolveCutPlan } from "./cutContract.ts";
import type { DirectScene } from "./directComposition.ts";

export type MotionActivityKind = "major" | "medium" | "small";

export interface MotionActivity {
  kind: MotionActivityKind;
  source: string;
  startSec: number;
  endSec: number;
  sceneId?: string;
  target?: string;
}

export interface MotionDensitySceneReport {
  sceneId: string;
  durationSec: number;
  authoredBeatCount: number;
  backHalfBeatCount: number;
  longestQuietGapSec: number;
}

export interface MotionDensityReport {
  version: 1;
  durationSec: number;
  applies: boolean;
  activities: MotionActivity[];
  quietGaps: Array<{ startSec: number; endSec: number; durationSec: number }>;
  maxQuietGapSec: number;
  sceneReports: MotionDensitySceneReport[];
  warnings: string[];
}

const MIN_LIVE_DURATION_SEC = 10;
const MAX_QUIET_GAP_SEC = 3;
const FINAL_HOLD_ALLOWANCE_SEC = 2.6;
const DENSE_WINDOW_SEC = 1;
const MAX_BEATS_PER_WINDOW = 8;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sceneEnd(scene: DirectScene): number {
  return scene.startSec + scene.durationSec;
}

function sceneAt(scenes: DirectScene[], time: number): DirectScene | undefined {
  const boundaryScene = scenes.find((scene) =>
    Math.abs(time - scene.startSec) <= 0.01
  );
  if (boundaryScene) return boundaryScene;
  return scenes.find((scene) =>
    time >= scene.startSec - 0.01 && time < sceneEnd(scene) + 0.01
  );
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (ch === "\\") escaped = true;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function balancedCallSource(source: string, openParen: number): string | undefined {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = openParen; index < source.length; index += 1) {
    const ch = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (ch === "\\") escaped = true;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, index);
    }
  }
  return undefined;
}

function constantsFromSource(html: string): Map<string, number> {
  const constants = new Map<string, number>();
  for (const match of html.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;?/g,
  )) {
    constants.set(match[1]!, Number(match[2]));
  }
  return constants;
}

function readNumberExpression(
  value: string | undefined,
  constants: Map<string, number>,
): number | undefined {
  if (!value) return undefined;
  const raw = value.trim().replace(/^["'`]|["'`]$/g, "");
  if (!raw) return undefined;
  const expanded = raw.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
    const constant = constants.get(name);
    return constant === undefined ? "NaN" : String(constant);
  });
  if (!/^[\d+\-*/().\s]+$/.test(expanded) || /\bNaN\b/.test(expanded)) {
    return undefined;
  }
  try {
    const result = Function(`"use strict"; return (${expanded});`)() as unknown;
    return finite(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function readObjectNumber(
  objectSource: string | undefined,
  key: string,
  constants: Map<string, number>,
): number | undefined {
  if (!objectSource) return undefined;
  const match = objectSource.match(
    new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*([^,}\\n]+)`, "i"),
  );
  return readNumberExpression(match?.[1], constants);
}

function quotedSelector(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  const match = raw.match(/^["'`](.*?)["'`]$/s);
  return match?.[1]?.trim() ?? raw;
}

function targetsSceneWrapper(target: string, scene: DirectScene): boolean {
  const escaped = scene.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^(?:#${escaped}|\\[data-scene=(["'])?${escaped}\\1\\])$`,
  ).test(target.trim());
}

function objectKeys(objectSource: string | undefined): Set<string> {
  const keys = new Set<string>();
  if (!objectSource) return keys;
  for (const match of objectSource.matchAll(/(?:^|[,{]\s*)([A-Za-z_$][\w$-]*)\s*:/g)) {
    keys.add(match[1]!);
  }
  return keys;
}

function opacityOnly(keys: Set<string>): boolean {
  const ignored = new Set(["duration", "ease", "delay", "stagger", "overwrite", "immediateRender"]);
  const motionKeys = [...keys].filter((key) => !ignored.has(key));
  return motionKeys.length > 0 && motionKeys.every((key) =>
    key === "opacity" || key === "autoAlpha"
  );
}

function authoredTweenActivities(
  html: string,
  scenes: DirectScene[],
): { activities: MotionActivity[]; unpositioned: number } {
  const constants = constantsFromSource(html);
  const activities: MotionActivity[] = [];
  let unpositioned = 0;
  const methodPattern = /\.(fromTo|from|to|set)\s*\(/g;
  for (const match of html.matchAll(methodPattern)) {
    const method = match[1] as "fromTo" | "from" | "to" | "set";
    if (method === "set") continue;
    const openParen = (match.index ?? 0) + match[0].length - 1;
    const call = balancedCallSource(html, openParen);
    if (!call) continue;
    const args = splitTopLevel(call);
    const vars = method === "fromTo" ? args[2] : args[1];
    const position = readNumberExpression(method === "fromTo" ? args[3] : args[2], constants);
    if (position === undefined) {
      unpositioned += 1;
      continue;
    }
    const duration = clamp(readObjectNumber(vars, "duration", constants) ?? 0.4, 0.04, 4);
    const scene = sceneAt(scenes, position);
    if (!scene) continue;
    const target = quotedSelector(args[0]);
    if (targetsSceneWrapper(target, scene) && opacityOnly(objectKeys(vars))) {
      continue;
    }
    activities.push({
      kind: "medium",
      source: `gsap.${method}`,
      startSec: round(clamp(position, 0, sceneEnd(scene))),
      endSec: round(clamp(position + duration, 0, sceneEnd(scene))),
      sceneId: scene.id,
      ...(target ? { target } : {}),
    });
  }
  return { activities, unpositioned };
}

function contractActivities(scenes: DirectScene[], durationSec: number): MotionActivity[] {
  const activities: MotionActivity[] = [];
  for (const scene of scenes) {
    activities.push({
      kind: "major",
      source: "scene-start",
      sceneId: scene.id,
      startSec: round(scene.startSec),
      endSec: round(Math.min(scene.startSec + 0.08, durationSec)),
    });
    for (const interaction of scene.interactions ?? []) {
      const end = interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
      activities.push({
        kind: "medium",
        source: `interaction:${interaction.action}`,
        sceneId: scene.id,
        target: interaction.targetPart,
        startSec: round(interaction.startSec),
        endSec: round(end),
      });
    }
  }
  const cutPlan = resolveCutPlan(scenes);
  const typedCutBoundaries = new Set(cutPlan.cuts.map((cut) => `${cut.fromScene}->${cut.toScene}`));
  for (const cut of cutPlan.cuts) {
    activities.push({
      kind: "major",
      source: `cut:${cut.style}`,
      sceneId: cut.fromScene,
      startSec: round(Math.max(0, cut.atSec - cut.exitSec)),
      endSec: round(Math.min(durationSec, cut.atSec + cut.entrySec)),
    });
  }
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const from = scenes[index]!;
    const to = scenes[index + 1]!;
    if (typedCutBoundaries.has(`${from.id}->${to.id}`)) continue;
    const at = sceneEnd(from);
    activities.push({
      kind: "major",
      source: "cut:hard",
      sceneId: from.id,
      startSec: round(Math.max(0, at - 0.05)),
      endSec: round(Math.min(durationSec, at + 0.05)),
    });
  }
  return activities;
}

function mergedGaps(
  activities: MotionActivity[],
  durationSec: number,
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const windows = activities
    .map((activity) => ({
      start: clamp(activity.startSec, 0, durationSec),
      end: clamp(Math.max(activity.endSec, activity.startSec + 0.04), 0, durationSec),
    }))
    .filter((window) => window.end > window.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const gaps: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  let cursor = 0;
  for (const window of windows) {
    if (window.start - cursor > MAX_QUIET_GAP_SEC) {
      gaps.push({
        startSec: round(cursor),
        endSec: round(window.start),
        durationSec: round(window.start - cursor),
      });
    }
    cursor = Math.max(cursor, window.end);
  }
  if (durationSec - cursor > Math.max(MAX_QUIET_GAP_SEC, FINAL_HOLD_ALLOWANCE_SEC)) {
    gaps.push({
      startSec: round(cursor),
      endSec: round(durationSec),
      durationSec: round(durationSec - cursor),
    });
  }
  return gaps;
}

function longestSceneQuietGap(
  scene: DirectScene,
  activities: MotionActivity[],
): number {
  const sceneActivities = activities
    .filter((activity) =>
      activity.endSec >= scene.startSec && activity.startSec <= sceneEnd(scene)
    )
    .map((activity) => ({
      start: clamp(activity.startSec, scene.startSec, sceneEnd(scene)),
      end: clamp(activity.endSec, scene.startSec, sceneEnd(scene)),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = scene.startSec;
  let longest = 0;
  for (const activity of sceneActivities) {
    longest = Math.max(longest, activity.start - cursor);
    cursor = Math.max(cursor, activity.end);
  }
  longest = Math.max(longest, sceneEnd(scene) - cursor);
  return round(longest);
}

export function analyzeMotionDensity(
  html: string,
  scenes: DirectScene[],
  durationSec: number,
): MotionDensityReport {
  const applies = scenes.length >= 3 && durationSec >= MIN_LIVE_DURATION_SEC;
  const authored = authoredTweenActivities(html, scenes);
  const activities = [
    ...contractActivities(scenes, durationSec),
    ...authored.activities,
  ].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const quietGaps = applies ? mergedGaps(activities, durationSec) : [];
  const warnings: string[] = [];
  if (applies) {
    for (const gap of quietGaps) {
      warnings.push(
        `motion/liveness: ${gap.durationSec.toFixed(1)}s with no major cut, ` +
          `interaction, or authored component/camera beat (${gap.startSec.toFixed(1)}-` +
          `${gap.endSec.toFixed(1)}s); add a mid-shot reveal, state change, or ` +
          `camera-world move with explicit timeline timing`,
      );
    }
    for (const scene of scenes) {
      const sceneEndSec = sceneEnd(scene);
      const beats = authored.activities.filter((activity) =>
        activity.sceneId === scene.id &&
        activity.startSec >= scene.startSec + 0.08 &&
        activity.startSec <= sceneEndSec - 0.08
      );
      const backHalf = beats.filter((activity) =>
        activity.startSec >= scene.startSec + scene.durationSec * 0.45
      );
      const minimum = scene.durationSec >= 4.5 ? 2 : 1;
      if (beats.length < minimum) {
        warnings.push(
          `motion/liveness: scene "${scene.id}" has ${beats.length} authored ` +
            `component/camera beat(s) across ${scene.durationSec.toFixed(1)}s; ` +
            `use at least ${minimum} non-wrapper beat(s) so it does not read as a slide`,
        );
        continue;
      }
      const longestQuietGap = longestSceneQuietGap(scene, activities);
      const frontLoadedQuietThreshold = Math.min(
        MAX_QUIET_GAP_SEC,
        Math.max(1.8, scene.durationSec * 0.45),
      );
      if (
        scene.durationSec >= 3.6 &&
        backHalf.length === 0 &&
        longestQuietGap > frontLoadedQuietThreshold
      ) {
        warnings.push(
          `motion/liveness: scene "${scene.id}" front-loads its authored motion; ` +
            `add one back-half information beat after ${(
              scene.startSec + scene.durationSec * 0.45
            ).toFixed(1)}s`,
        );
      }
    }
    if (authored.unpositioned > 0) {
      warnings.push(
        `motion/liveness: ${authored.unpositioned} authored tween(s) have no ` +
          `absolute timeline position, so quiet-window validation cannot place them; ` +
          `give each beat an explicit composition time`,
      );
    }
    const starts = authored.activities.map((activity) => activity.startSec).sort((a, b) => a - b);
    for (const [index, start] of starts.entries()) {
      const count = starts.filter((time) => time >= start && time < start + DENSE_WINDOW_SEC).length;
      if (count > MAX_BEATS_PER_WINDOW) {
        warnings.push(
          `motion/density: ${count} authored beats start within ${DENSE_WINDOW_SEC.toFixed(1)}s ` +
            `near ${start.toFixed(1)}s; stagger or remove supporting motion so the edit has hierarchy`,
        );
        break;
      }
      if (index > starts.length) break;
    }
  }
  const sceneReports = scenes.map((scene) => {
    const beats = authored.activities.filter((activity) => activity.sceneId === scene.id);
    return {
      sceneId: scene.id,
      durationSec: round(scene.durationSec),
      authoredBeatCount: beats.length,
      backHalfBeatCount: beats.filter((activity) =>
        activity.startSec >= scene.startSec + scene.durationSec * 0.45
      ).length,
      longestQuietGapSec: longestSceneQuietGap(scene, activities),
    };
  });
  const maxQuietGapSec = quietGaps.reduce(
    (max, gap) => Math.max(max, gap.durationSec),
    0,
  );
  return {
    version: 1,
    durationSec: round(durationSec),
    applies,
    activities,
    quietGaps,
    maxQuietGapSec: round(maxQuietGapSec),
    sceneReports,
    warnings: [...new Set(warnings)],
  };
}

export function validateMotionDensity(
  html: string,
  scenes: DirectScene[],
  durationSec: number | undefined,
): { warnings: string[]; report?: MotionDensityReport } {
  if (!Number.isFinite(durationSec) || durationSec === undefined) {
    return { warnings: [] };
  }
  const report = analyzeMotionDensity(html, scenes, durationSec);
  return { warnings: report.warnings, report };
}
