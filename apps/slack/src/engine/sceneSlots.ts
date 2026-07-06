/**
 * Sentinel Phase 2 (SENTINEL_PLAN.md §3.2): scene-addressable authoring. The
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
    `#root{position:relative;width:${width}px;height:${height}px;overflow:hidden}`,
    ".scene{position:absolute;inset:0;opacity:0}",
    ".clip{overflow:hidden}",
    "[data-camera-overlay]{position:absolute;inset:0;pointer-events:none}",
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
      // Each scene's statements run in their own function scope so scenes
      // cannot collide on variable names; the shared timeline is the only seam.
      return `(function (tl) {\n${script ?? ""}\n})(tl);`;
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

  return { html, missingHtml, missingScript };
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
