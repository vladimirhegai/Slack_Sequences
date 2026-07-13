/**
 * Sentinel L1/L5 contract (SENTINEL.md): scene-addressable authoring. The
 * author returns one shared `<film_style>` plus a `<scene_html id>` interior and
 * a `<scene_script id>` statement block per scene; the host assembles the
 * canonical document deterministically — the same chassis every whole-doc
 * composition has, so `applyDeterministicSourceRepairs` and every gate run
 * unchanged. Making the artifact scene-addressable is what lets validation,
 * truncation, and retries operate per scene instead of per document.
 *
 * One authoring call still sees the whole film (coherence); what the model
 * loses is the ability to break paperwork in scene B while fixing scene D.
 */
import type { DirectScene } from "./directComposition.ts";

export interface SceneSlot {
  /** Interior HTML for the scene shell (the host owns the `<section>` wrapper). */
  html?: string;
  /** Statement block appended into a host-owned `(tl) => { … }` per-scene fn. */
  script?: string;
}

export interface ParsedSceneSlots {
  filmStyle?: string;
  scenes: Map<string, SceneSlot>;
  /** Scene ids in the order their html slots appeared. */
  order: string[];
  /** A slot tag opened but never closed — the response hit its token limit. */
  truncated: boolean;
}

function stripFence(body: string): string {
  return body.trim().replace(/^```(?:html|css|js|javascript)?\s*/i, "").replace(/\s*```$/, "");
}

/** Extract every `<tag id="…">…</tag>` block, tolerant of a truncated tail. */
function extractById(
  raw: string,
  tag: string,
): { blocks: Map<string, string>; order: string[]; truncated: boolean } {
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  const closeToken = `</${tag}>`;
  const blocks = new Map<string, string>();
  const order: string[] = [];
  let truncated = false;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(raw)) !== null) {
    const id = match[1]!.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    const contentStart = match.index + match[0].length;
    const closeIndex = raw.indexOf(closeToken, contentStart);
    if (closeIndex < 0) {
      // Opened but never closed: the model ran out of output budget mid-slot.
      truncated = true;
      break;
    }
    const body = raw.slice(contentStart, closeIndex);
    if (id && !blocks.has(id)) {
      blocks.set(id, stripFence(body));
      order.push(id);
    }
    openRe.lastIndex = closeIndex + closeToken.length;
  }
  return { blocks, order, truncated };
}

export function extractSceneSlots(raw: string): ParsedSceneSlots {
  const filmStyleMatch = raw.match(/<film_style\b[^>]*>([\s\S]*?)<\/film_style>/i);
  const filmStyle = filmStyleMatch ? stripFence(filmStyleMatch[1]!) : undefined;

  const htmlSlots = extractById(raw, "scene_html");
  const scriptSlots = extractById(raw, "scene_script");

  const scenes = new Map<string, SceneSlot>();
  for (const [id, html] of htmlSlots.blocks) {
    scenes.set(id, { ...(scenes.get(id) ?? {}), html });
  }
  for (const [id, script] of scriptSlots.blocks) {
    scenes.set(id, { ...(scenes.get(id) ?? {}), script });
  }

  return {
    filmStyle,
    scenes,
    order: htmlSlots.order,
    truncated: htmlSlots.truncated || scriptSlots.truncated,
  };
}

export interface SlotAssemblyArgs {
  storyboard: DirectScene[];
  slots: ParsedSceneSlots;
  compositionId: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface SlotAssemblyResult {
  html: string;
  /** Scene ids with no html interior — the retryable/truncated tail. */
  missingHtml: string[];
  /** Scene ids with no script block. */
  missingScript: string[];
  /** Invalid model-authored slot envelopes normalized onto the host timeline. */
  scriptRepairs: SlotScriptRepairs;
}

export interface SlotScriptRepairs {
  bareFromTo: number;
  pseudoTimeline: number;
  arrowEnvelope: number;
  /** A slot used the global GSAP clock instead of the host-owned timeline. */
  globalTween: number;
  /** A model put GSAP's timeline position inside the vars object as `time`. */
  timePosition: number;
  /** A model tried to tween a `data-*` attribute as a CSS property. */
  dataAttribute: number;
  /** A later scene authored every position in scene-local rather than film time. */
  localPosition: number;
}

interface SlotScriptTiming {
  startSec: number;
  durationSec: number;
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(" || char === "{" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function balancedCallClose(source: string, openParen: number): number {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function simpleNumberExpression(expression: string | undefined): number | undefined {
  if (!expression) return undefined;
  // `i`/`index` are the conventional forEach stagger variables. Substituting
  // zero classifies the first member without changing the authored stagger.
  const source = expression.trim().replace(/\b(?:i|index)\b/g, "0");
  if (!source || !/^[\d+\-*/().\s]+$/.test(source)) return undefined;
  try {
    const value = Function(`"use strict"; return (${source});`)() as unknown;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

interface VarsNormalization {
  source: string;
  timeExpression?: string;
  dataAttribute: boolean;
  dataOnly: boolean;
}

interface DelayExtraction {
  source: string;
  expression?: string;
}

/** Remove a top-level delay from one vars object so it can become a timeline position. */
function extractGsapDelay(source: string): DelayExtraction {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return { source };
  const entries = splitTopLevel(trimmed.slice(1, -1)).filter(Boolean);
  const delayIndex = entries.findIndex((entry) => /^(?:["']?delay["']?)\s*:/.test(entry));
  if (delayIndex < 0) return { source };
  const expression = entries[delayIndex]!
    .replace(/^(?:["']?delay["']?)\s*:\s*/, "")
    .trim();
  return {
    source: `{ ${entries.filter((_entry, index) => index !== delayIndex).join(", ")} }`,
    ...(expression ? { expression } : {}),
  };
}

/** Normalize only top-level vars keys; nested callbacks/objects stay untouched. */
function normalizeGsapVars(source: string): VarsNormalization {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return { source, dataAttribute: false, dataOnly: false };
  }
  const entries = splitTopLevel(trimmed.slice(1, -1)).filter(Boolean);
  const timeIndex = entries.findIndex((entry) => /^(?:["']?time["']?)\s*:/.test(entry));
  const timeExpression = timeIndex >= 0
    ? entries[timeIndex]!.replace(/^(?:["']?time["']?)\s*:\s*/, "").trim()
    : undefined;
  const withoutTime = entries.filter((_entry, index) => index !== timeIndex);
  const dataEntries = withoutTime.filter((entry) =>
    /^(?:["']data-[\w:-]+["']|data-[\w:-]+)\s*:/.test(entry)
  );
  const hasAttr = withoutTime.some((entry) => /^(?:["']?attr["']?)\s*:/.test(entry));
  const dataAttribute = dataEntries.length > 0 && !hasAttr;
  if (timeIndex < 0 && !dataAttribute) {
    return { source, dataAttribute: false, dataOnly: false };
  }
  const rest = withoutTime.filter((entry) => !dataEntries.includes(entry));
  const normalized = dataAttribute
    ? [`attr: { ${dataEntries.join(", ")} }`, ...rest]
    : withoutTime;
  return {
    source: `{ ${normalized.join(", ")} }`,
    ...(timeExpression ? { timeExpression } : {}),
    dataAttribute,
    dataOnly: dataAttribute && rest.length === 0,
  };
}

interface TimelineRewrite {
  script: string;
  timePosition: number;
  dataAttribute: number;
  positions: Array<{ expression: string }>;
}

interface GlobalTweenRewrite {
  script: string;
  repaired: number;
}

/**
 * A scene slot is appended to a paused host timeline. Global `gsap.to(...)`
 * calls run on GSAP's wall-clock root and therefore cannot be reproduced by a
 * seek. Models commonly express the intended absolute cue as `delay`; move
 * that cue into the host timeline's position argument. A call without delay
 * starts at the scene boundary, which is the deterministic equivalent of a
 * page-load call inside that scene slot.
 */
function rewriteGlobalGsapTweens(
  script: string,
  timing: SlotScriptTiming,
): GlobalTweenRewrite {
  const callStart = /\bgsap\s*\.\s*(fromTo|from|to|set)\s*\(/g;
  let output = "";
  let cursor = 0;
  let repaired = 0;
  for (const match of script.matchAll(callStart)) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    const open = script.indexOf("(", start);
    const close = open >= 0 ? balancedCallClose(script, open) : -1;
    if (close < 0) continue;
    const method = match[1] as "fromTo" | "from" | "to" | "set";
    const args = splitTopLevel(script.slice(open + 1, close));
    const varsIndex = method === "fromTo" ? 2 : 1;
    const positionIndex = method === "fromTo" ? 3 : 2;
    const delay = extractGsapDelay(args[varsIndex] ?? "");
    if (args[varsIndex] !== undefined) args[varsIndex] = delay.source;
    const position = args[positionIndex];
    if (position === undefined) {
      args[positionIndex] = delay.expression ?? String(timing.startSec);
    } else if (delay.expression) {
      args[positionIndex] = `(${position}) + (${delay.expression})`;
    }
    output += script.slice(cursor, start) + `tl.${method}(${args.join(", ")})`;
    cursor = close + 1;
    repaired += 1;
  }
  return { script: output + script.slice(cursor), repaired };
}

function rewriteTimelineCalls(
  script: string,
  shiftSec?: number,
): TimelineRewrite {
  const callStart = /\btl\s*\.\s*(fromTo|from|to|set)\s*\(/g;
  let output = "";
  let cursor = 0;
  let timePosition = 0;
  let dataAttribute = 0;
  const positions: Array<{ expression: string }> = [];
  for (const match of script.matchAll(callStart)) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    const open = script.indexOf("(", start);
    const close = open >= 0 ? balancedCallClose(script, open) : -1;
    if (close < 0) continue;
    let method = match[1] as "fromTo" | "from" | "to" | "set";
    const args = splitTopLevel(script.slice(open + 1, close));
    const varsIndex = method === "fromTo" ? 2 : 1;
    const positionIndex = method === "fromTo" ? 3 : 2;
    const vars = normalizeGsapVars(args[varsIndex] ?? "");
    if (args[varsIndex] !== undefined && vars.source !== args[varsIndex]) {
      args[varsIndex] = vars.source;
    }
    if (vars.timeExpression) {
      const existing = simpleNumberExpression(args[positionIndex]);
      if (args[positionIndex] === undefined || existing === 0) {
        args[positionIndex] = vars.timeExpression;
        timePosition += 1;
      }
    }
    if (vars.dataAttribute) {
      dataAttribute += 1;
      // A state-only `.to()` cannot interpolate. Make the intended discrete
      // transition explicit while preserving its film-time position.
      if (vars.dataOnly && method !== "set") method = "set";
    }
    const position = args[positionIndex];
    if (position !== undefined) {
      positions.push({ expression: position });
      if (shiftSec !== undefined) {
        args[positionIndex] = `${shiftSec} + (${position})`;
      }
    }
    const prefix = script.slice(start, open).replace(
      /\b(fromTo|from|to|set)(?=\s*$)/,
      method,
    );
    output += script.slice(cursor, start) + `${prefix}(${args.join(", ")})`;
    cursor = close + 1;
  }
  return {
    script: output + script.slice(cursor),
    timePosition,
    dataAttribute,
    positions,
  };
}

/**
 * Scene slots contain statements for the host's `tl`, but models sometimes
 * repeat remembered whole-document conventions. The live failure shapes below
 * are fully mechanical:
 *
 * - a line-leading bare `fromTo(...)` is not a GSAP global and throws;
 * - `window.__tl_scene_<id>` / `window.__tl` are never created by the host;
 * - a complete `(tl) => { ... };` or `(tl, root) => { ... };` is an uninvoked
 *   function inside the host's own timeline IIFE;
 * - a global `gsap.to/from/fromTo/set` runs on wall time rather than the
 *   seekable host timeline; its top-level delay is the intended position;
 * - `time` inside a vars object is a misplaced GSAP position;
 * - a `data-*` vars key is an attribute transition, not a CSS property;
 * - every cue in a later slot near zero and within that scene's duration is an
 *   unmistakable scene-local clock, while the host timeline is film-absolute.
 *
 * Normalize only those certain shapes. A locally declared `fromTo` function,
 * mixed/unknown time expression, visual vars, and animation duration are left
 * alone.
 */
export function normalizeSceneSlotScript(script: string): {
  script: string;
  repairs: SlotScriptRepairs;
};
export function normalizeSceneSlotScript(script: string, timing: SlotScriptTiming): {
  script: string;
  repairs: SlotScriptRepairs;
};
export function normalizeSceneSlotScript(script: string, timing?: SlotScriptTiming): {
  script: string;
  repairs: SlotScriptRepairs;
} {
  let normalized = script;
  let bareFromTo = 0;
  let pseudoTimeline = 0;
  let arrowEnvelope = 0;
  let globalTween = 0;
  const arrow = normalized.match(
    /^\s*((?:(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))\s*)*)(?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*)?\(\s*tl(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*((?:(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))\s*)*)$/,
  );
  if (arrow) {
    const rootName = arrow[2];
    normalized = [
      arrow[1]!.trim(),
      ...(rootName
        ? [`const ${rootName} = document.querySelector("[data-composition-id]");`]
        : []),
      arrow[3]!.trim(),
      arrow[4]!.trim(),
    ].filter(Boolean).join("\n");
    arrowEnvelope = 1;
  }
  if (!/\b(?:function\s+fromTo|(?:const|let|var)\s+fromTo\b)/.test(normalized)) {
    normalized = normalized.replace(/^(\s*)fromTo\s*\(/gm, (_match, indent: string) => {
      bareFromTo += 1;
      return `${indent}tl.fromTo(`;
    });
  }
  normalized = normalized.replace(
    /\bwindow\.__tl_scene_[A-Za-z0-9_$]+(?=\s*\.)/g,
    () => {
      pseudoTimeline += 1;
      return "tl";
    },
  );
  normalized = normalized.replace(
    /(\}\s*\)\s*\(\s*)window\.__tl_scene_[A-Za-z0-9_$]+(?=\s*\))/g,
    (_match, prefix: string) => {
      pseudoTimeline += 1;
      return `${prefix}tl`;
    },
  );
  // `window.__tl` was the exact Probe 4 failure: the model invoked a valid
  // wrapper with an undefined remembered global. It is just as impossible as
  // the older per-scene pseudo timeline and is safe to bind to the host `tl`.
  normalized = normalized.replace(/\bwindow\.__tl\b/g, () => {
    pseudoTimeline += 1;
    return "tl";
  });

  if (timing) {
    const globalTweens = rewriteGlobalGsapTweens(normalized, timing);
    normalized = globalTweens.script;
    globalTween = globalTweens.repaired;
  }

  let localPosition = 0;
  if (timing) {
    const helper = normalized.match(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*([A-Za-z_$][\w$]*)\s*\+\s*\2\s*;?/,
    );
    if (helper) {
      const basePattern = new RegExp(
        `\\b(?:const|let|var)\\s+${helper[3]}\\s*=\\s*(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))\\s*;?`,
      );
      const base = Number(basePattern.exec(normalized)?.[1]);
      if (Number.isFinite(base) && Math.abs(base - timing.startSec) <= 0.01) {
        const helperName = helper[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        normalized = normalized.replace(
          new RegExp(`\\b${helperName}\\(\\s*(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))\\s*\\)`, "g"),
          (_match, offset: string) => {
            localPosition += 1;
            return String(Math.round((timing.startSec + Number(offset)) * 1000) / 1000);
          },
        );
      }
    }
  }
  const calls = rewriteTimelineCalls(normalized);
  normalized = calls.script;
  if (timing && timing.startSec > 0.5 && calls.positions.length) {
    const values = calls.positions.map((entry) => simpleNumberExpression(entry.expression));
    const known = values.every((value): value is number => value !== undefined);
    const minimum = known ? Math.min(...values) : Number.POSITIVE_INFINITY;
    const maximum = known ? Math.max(...values) : Number.POSITIVE_INFINITY;
    // A complete later-scene slot whose first authored beat starts near zero
    // and whose every beat fits its own duration is unmistakably scene-local.
    // Absolute pre-rolls near the real scene boundary do not meet this shape.
    const sceneLocal = known &&
      minimum >= -0.01 && minimum <= 0.5 &&
      maximum <= timing.durationSec + 0.25 &&
      maximum < timing.startSec - 0.25;
    if (sceneLocal) {
      const shifted = rewriteTimelineCalls(normalized, timing.startSec);
      normalized = shifted.script;
      localPosition += shifted.positions.length;
    }
  }
  return {
    script: normalized,
    repairs: {
      bareFromTo,
      pseudoTimeline,
      arrowEnvelope,
      globalTween,
      timePosition: calls.timePosition,
      dataAttribute: calls.dataAttribute,
      localPosition,
    },
  };
}

function filmDurationSec(storyboard: DirectScene[]): number {
  return storyboard.reduce(
    (end, scene) => Math.max(end, scene.startSec + scene.durationSec),
    0,
  );
}

/** The host-owned `<section>` wrapper (id/timing/track) for one scene. */
function sectionOpen(scene: DirectScene): string {
  return (
    `<section id="${scene.id}" class="scene clip" data-scene="${scene.id}" ` +
    `data-start="${scene.startSec}" data-duration="${scene.durationSec}" data-track-index="1">`
  );
}

/**
 * The host-owned stage floor: root sizing, absolute scene stacking, clip
 * containment, overlay positioning, and the hidden-scene baseline. The
 * 2026-07-05 `sentinel-final-denseui` probe failed loud (`near_blank_film`)
 * precisely because scene positioning depended on the model's `<film_style>`
 * — the model supplied design tokens but no `.scene` rule, so every scene
 * (and its 4800×2160 camera world) landed in static flow, off-frame. Stage
 * layout is structure, not art direction, so the host owns it; the model's
 * film style is injected AFTER and may extend (padding, display, background)
 * but positioning never depends on it. Mirrors the proven fallback-film
 * convention (`fallbackComposition.ts`: `.scene{position:absolute;inset:0;…;
 * opacity:0}` + timeline reveal/clear sets).
 */
export function slotStageStyle(width: number, height: number): string {
  return [
    "html,body{margin:0;padding:0}",
    `#root{position:relative!important;width:${width}px!important;height:${height}px!important;overflow:hidden!important}`,
    // Model film CSS is intentionally loaded after this floor, so the
    // structural declarations must survive the cascade. Probe 4 redefined
    // `.scene{position:relative}` and collapsed every shot to a 116px grid row
    // at y=580: camera targets clipped, the CTA overflowed, and a root-relative
    // ripple inherited a 580px parent offset. Keep display/padding/art direction
    // authorable; lock only the host-owned stage geometry. Opacity is NOT
    // important because the host timeline must still set it inline.
    ".scene{position:absolute!important;inset:0!important;box-sizing:border-box;opacity:0}",
    ".clip{overflow:hidden!important}",
    "[data-camera-overlay]{position:absolute!important;inset:0!important;pointer-events:none}",
  ].join("\n");
}

/**
 * Host-owned scene-window visibility: reveal each scene at its `data-start`,
 * clear it at the end of its window (the final scene clears at the film end,
 * exactly like the fallback film). Emitted AFTER the authored scene blocks so
 * the host sets win insertion-order ties at the window edges — an authored
 * wrapper set at the same time can never leave a scene stuck hidden. Selector
 * literals go through JSON.stringify (the WS7 lesson: never hand-balance
 * quotes in generated JS).
 */
function sceneVisibilityStatements(storyboard: DirectScene[]): string {
  return storyboard
    .map((scene) => {
      const selector = JSON.stringify(`[data-scene="${scene.id}"]`);
      const endSec = scene.startSec + scene.durationSec;
      return (
        `tl.set(${selector}, { opacity: 1 }, ${scene.startSec});\n` +
        `tl.set(${selector}, { opacity: 0 }, ${endSec});`
      );
    })
    .join("\n");
}

/**
 * Assemble the canonical document from the parsed slots. The host owns the
 * chassis, every `<section>` wrapper (so a scene can never be added, dropped,
 * merged, or retimed), the single paused timeline, its registration, and the
 * seek — the author owns only the shared style, each scene's interior, and each
 * scene's timeline statements. `applyDeterministicSourceRepairs` then injects
 * the runtime tags, JSON islands, compile calls, and kits exactly as it does
 * for a whole-doc composition.
 *
 * Deterministic and byte-stable for fixed inputs.
 */
export function assembleSlotComposition(args: SlotAssemblyArgs): SlotAssemblyResult {
  const width = args.width ?? 1920;
  const height = args.height ?? 1080;
  const durationSec = args.durationSec ?? filmDurationSec(args.storyboard);
  const missingHtml: string[] = [];
  const missingScript: string[] = [];
  const scriptRepairs: SlotScriptRepairs = {
    bareFromTo: 0,
    pseudoTimeline: 0,
    arrowEnvelope: 0,
    globalTween: 0,
    timePosition: 0,
    dataAttribute: 0,
    localPosition: 0,
  };

  const sections = args.storyboard
    .map((scene) => {
      const interior = args.slots.scenes.get(scene.id)?.html?.trim();
      if (!interior) missingHtml.push(scene.id);
      return `${sectionOpen(scene)}\n${interior ?? ""}\n</section>`;
    })
    .join("\n");

  const sceneBlocks = args.storyboard
    .map((scene) => {
      const script = args.slots.scenes.get(scene.id)?.script?.trim();
      if (!script) missingScript.push(scene.id);
      const normalized = normalizeSceneSlotScript(script ?? "", {
        startSec: scene.startSec,
        durationSec: scene.durationSec,
      });
      scriptRepairs.bareFromTo += normalized.repairs.bareFromTo;
      scriptRepairs.pseudoTimeline += normalized.repairs.pseudoTimeline;
      scriptRepairs.arrowEnvelope += normalized.repairs.arrowEnvelope;
      scriptRepairs.globalTween += normalized.repairs.globalTween;
      scriptRepairs.timePosition += normalized.repairs.timePosition;
      scriptRepairs.dataAttribute += normalized.repairs.dataAttribute;
      scriptRepairs.localPosition += normalized.repairs.localPosition;
      // Each scene's statements run in their own function scope so scenes
      // cannot collide on variable names; the shared timeline is the only seam.
      return `(function (tl) {\n${normalized.script}\n})(tl);`;
    })
    .join("\n");

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    // Host stage floor first, model film style second: the model may extend
    // the stage (padding, display, background) but positioning never depends
    // on what it remembered to write.
    `<style id="sequences-slot-stage">\n${slotStageStyle(width, height)}\n</style>`,
    `<style>\n${args.slots.filmStyle ?? ""}\n</style>`,
    "</head>",
    "<body>",
    `<main id="root" data-composition-id="${args.compositionId}" data-width="${width}" ` +
      `data-height="${height}" data-duration="${durationSec}">`,
    sections,
    "</main>",
    '<script src="gsap.min.js"></script>',
    "<script>",
    "window.__timelines = window.__timelines || {};",
    "const tl = gsap.timeline({ paused: true });",
    sceneBlocks,
    "// Host-owned scene-window visibility (authoritative at the window edges).",
    sceneVisibilityStatements(args.storyboard),
    `window.__timelines["${args.compositionId}"] = tl;`,
    "tl.seek(0);",
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");

  return { html, missingHtml, missingScript, scriptRepairs };
}

/**
 * Attribute each deterministic finding to the scene(s) it names, so validation,
 * diagnostics, and slot-scoped retries operate per scene. Most validators embed
 * the scene id verbatim (`scene "trace-resolve"`, `trace-resolve->risk-score`,
 * `data-scene="…"`); a finding that names no known scene lands under
 * `__film__` (a shared/film-level finding). Longest ids match first so
 * `risk-score` is not shadowed by a substring `risk`.
 */
export function attributeFindingsToScenes(
  findings: string[],
  sceneIds: string[],
): Map<string, string[]> {
  const ordered = [...sceneIds].sort((a, b) => b.length - a.length);
  const byScene = new Map<string, string[]>();
  const add = (scene: string, finding: string): void => {
    const bucket = byScene.get(scene);
    if (bucket) bucket.push(finding);
    else byScene.set(scene, [finding]);
  };
  for (const finding of findings) {
    const matched = ordered.filter((id) => {
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match the id as a whole token: bounded by quotes/space/=/:/(/start, or
      // a cut arrow (`a->b`), on either side — so `hero->cta` attributes to
      // BOTH scenes, a colon-delimited signature like
      // `component_root_missing:palette-ship:cmd-palette` attributes to
      // `palette-ship`, and `risk` never matches inside `risk-score`.
      const boundary = new RegExp(`(?:^|["'=:\\s(]|->)${esc}(?:$|["'\\s)>.,;:!]|->)`);
      return boundary.test(finding);
    });
    if (matched.length) {
      for (const id of matched) add(id, finding);
    } else {
      add("__film__", finding);
    }
  }
  return byScene;
}
