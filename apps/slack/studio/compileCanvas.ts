/**
 * Recipe Studio — the deterministic canvas compiler (plan §3.3, §4).
 *
 * Compiles a typed `CanvasFilm` into a complete `{ html, storyboard }` draft
 * and hands it to the REAL author-pipeline injection pass
 * (`applyDeterministicSourceRepairs`), which injects every host-owned island
 * (camera, cuts, components, interactions, timeRamp, fx) + runtime tags +
 * compile calls exactly as a live `/sequences` create would. The studio never
 * re-implements injection (plan guardrail #2); the time-wrap rewrite stays LAST
 * because the injection pass owns it.
 *
 * Zero tokens: an operator who never types a prompt can click a valid,
 * seek-safe, fully-gated film together. Component markup comes VERBATIM from
 * `COMPONENT_CATALOG` (guardrail #12 — never fork the catalog); the compiler
 * only substitutes each instance's `data-part` id and primary copy slot.
 */
import { applyDeterministicSourceRepairs } from "../src/engine/compositionRunner.ts";
import { COMPONENT_CATALOG } from "../src/engine/componentContract.ts";
import type {
  ComponentBeatIntentV1,
  SceneComponentSpecV1,
} from "../src/engine/componentContract.ts";
import type {
  CameraMoveIntentV1,
  SceneCameraIntentV1,
} from "../src/engine/cameraContract.ts";
import type {
  DirectCompositionDraft,
  DirectScene,
} from "../src/engine/directComposition.ts";
import type { StoryboardMomentV1 } from "../src/engine/storyboardMoments.ts";
import type { SceneCutIntentV1 } from "../src/engine/cutContract.ts";
import type {
  CanvasComponent,
  CanvasFilm,
  CanvasScene,
  CanvasStation,
} from "./canvasModel.ts";

const CATALOG_BY_KIND = new Map(COMPONENT_CATALOG.map((spec) => [spec.kind, spec]));
const WORLD_CELL_PX = 1920;
const r2 = (value: number): number => Math.round(value * 100) / 100;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a catalog component VERBATIM, substituting only the instance id (its
 * `data-part`) and the primary copy slot. The catalog markup is the single
 * source of truth for structure; the kit CSS styles it. We never author our
 * own component HTML.
 */
export function renderCatalogComponent(component: CanvasComponent): string {
  const spec = CATALOG_BY_KIND.get(component.kind);
  if (!spec) return "";
  let markup = spec.markup;
  // Retarget the component's root data-part to this instance's stable id.
  markup = markup.replace(/\bdata-part="[^"]*"/, `data-part="${escapeHtml(component.id)}"`);
  const copy = component.copy?.trim();
  if (copy) {
    const filled = fillPrimaryCopy(markup, escapeHtml(copy));
    if (filled) markup = filled;
  }
  return markup;
}

/** Replace the inner text of the first copy-bearing slot, in priority order. */
function fillPrimaryCopy(markup: string, copy: string): string | undefined {
  const slots = [
    /(<[^>]*\bdata-cmp-text[^>]*>)([\s\S]*?)(<\/[a-z0-9]+>)/i,
    /(<[^>]*\bdata-cmp-value[^>]*>)([\s\S]*?)(<\/[a-z0-9]+>)/i,
    /(<[^>]*\bclass="[^"]*\bcmp-value\b[^"]*"[^>]*>)([\s\S]*?)(<\/[a-z0-9]+>)/i,
    /(<[^>]*\bclass="[^"]*\bcmp-label\b[^"]*"[^>]*>)([\s\S]*?)(<\/[a-z0-9]+>)/i,
    /(<[^>]*\bclass="[^"]*\bcmp-title\b[^"]*"[^>]*>)([\s\S]*?)(<\/[a-z0-9]+>)/i,
  ];
  for (const slot of slots) {
    if (slot.test(markup)) {
      return markup.replace(slot, (_all, open: string, _inner: string, close: string) =>
        `${open}${copy}${close}`);
    }
  }
  return undefined;
}

interface CompiledScene {
  scene: DirectScene;
  /** Scene body HTML (world/regions + component markup). */
  bodyHtml: string;
  /** Timeline lines for this scene (entrance tweens). */
  timelineLines: string[];
  startSec: number;
}

/** Reveal time of a station = start of the first camera move targeting it. */
function stationRevealSec(scene: CanvasScene, station: CanvasStation): number {
  const move = scene.camera.find((segment) => segment.toRegion === station.region);
  if (move) return Math.max(0, move.startSec);
  // The station framed at scene start (no move targets it) reveals immediately.
  return 0;
}

function compileScene(scene: CanvasScene, startSec: number, film: CanvasFilm): CompiledScene {
  const hasWorld = scene.camera.length > 0 || scene.stations.length > 1;
  const timelineLines: string[] = [];
  const components: SceneComponentSpecV1[] = [];
  const beats: ComponentBeatIntentV1[] = [];
  const moments: StoryboardMomentV1[] = [];
  const PRIMARY_BEATS = new Set(["count", "progress", "press", "chart", "type", "morph"]);

  const renderStationBody = (station: CanvasStation): string => {
    const revealSec = stationRevealSec(scene, station);
    const count = station.components.length;
    // Spread reveals across the station's on-screen window so a multi-element
    // scene keeps developing into its back half (the motionDensity front-load /
    // quiet-gap rules) instead of firing everything at the entrance.
    const spanEnd = Math.min(scene.durationSec - 0.5, revealSec + (scene.durationSec - revealSec) * 0.62);
    const parts = station.components.map((component, index) => {
      components.push({
        version: 1,
        id: component.id,
        kind: component.kind,
        ...(hasWorld ? { region: station.region } : {}),
        ...(component.role ? { role: component.role } : {}),
      });
      // Entrance: a positioned tween the moment contract can bind and
      // motionDensity counts as a live "medium" beat (non-decorative target).
      const at = count > 1
        ? r2(revealSec + 0.25 + ((spanEnd - revealSec - 0.25) * index) / (count - 1))
        : r2(Math.min(scene.durationSec - 0.4, revealSec + 0.35));
      const entranceAbs = r2(startSec + at);
      timelineLines.push(
        `tl.fromTo('[data-part="${component.id}"]',{y:44,opacity:0},` +
          `{y:0,opacity:1,duration:.7,ease:"seqSettle"},${entranceAbs});`,
      );
      // A moment placed INSIDE the entrance window (so it binds) but late
      // enough that the WS7 thumbnail walk lands on settled content — never on
      // the blank scene-start frame synthesized moments produced.
      moments.push({
        version: 1,
        id: `${component.id}-in`,
        sceneId: scene.id,
        atSec: r2(entranceAbs + 0.35),
        title: `${component.copy ?? component.kind} arrives`,
        visualState: `${component.kind} "${component.copy ?? component.id}" settled on frame`,
        change: `${component.copy ?? component.kind} enters`,
        motionIntent: "reveal",
        importance: component.role === "hero" ? "primary" : "supporting",
      });
      for (const beat of component.beats ?? []) {
        const beatAbs = r2(startSec + Math.min(scene.durationSec - 0.2, Math.max(0, beat.atSec)));
        beats.push({
          version: 1,
          id: beat.id,
          sceneId: scene.id,
          component: component.id,
          kind: beat.kind,
          atSec: beatAbs,
          ...(beat.text ? { text: beat.text } : {}),
          ...(beat.value !== undefined ? { value: beat.value } : {}),
          ...(beat.item !== undefined ? { item: beat.item } : {}),
          ...(beat.toState ? { toState: beat.toState } : {}),
          ...(beat.style ? { style: beat.style } : {}),
        });
        moments.push({
          version: 1,
          id: `${beat.id}-m`,
          sceneId: scene.id,
          atSec: r2(beatAbs + 0.15),
          title: `${component.copy ?? component.kind} ${beat.kind}`,
          visualState: `${component.kind} after its ${beat.kind} beat`,
          change: `${component.kind} ${beat.kind}`,
          motionIntent: beat.kind,
          importance: PRIMARY_BEATS.has(beat.kind) ? "primary" : "supporting",
        });
      }
      return renderCatalogComponent(component);
    });
    return `<div class="canvas-stack" data-layout-important>${parts.join("")}</div>`;
  };

  let bodyHtml: string;
  if (hasWorld) {
    const maxCell = Math.max(0, ...scene.stations.map((station) => station.cell));
    const worldWidth = (maxCell + 1) * WORLD_CELL_PX;
    const regions = scene.stations
      .map((station) => {
        const left = station.cell * WORLD_CELL_PX;
        return (
          `<div class="region" data-region="${escapeHtml(station.region)}" ` +
          `style="left:${left}px;width:${WORLD_CELL_PX}px">${renderStationBody(station)}</div>`
        );
      })
      .join("");
    bodyHtml =
      `<div class="keylight keylight-c" data-layout-ignore></div>` +
      `<div class="world" data-camera-world style="width:${worldWidth}px">${regions}</div>`;
  } else {
    const station = scene.stations[0]!;
    bodyHtml =
      `<div class="keylight keylight-c" data-layout-ignore></div>` +
      `<div class="canvas-flat" data-layout-anchor="frame:center">${renderStationBody(station)}</div>`;
  }

  // Camera move times in the canvas model are scene-relative (operator-facing);
  // the engine resolver expects ABSOLUTE composition times (as the fallback
  // film emits them), so shift each by the scene start here.
  const camera: SceneCameraIntentV1 | undefined = scene.camera.length
    ? {
        version: 1,
        path: scene.camera.map((move): CameraMoveIntentV1 => ({
          version: 1,
          move: move.move,
          toRegion: move.toRegion,
          startSec: r2(startSec + move.startSec),
          durationSec: r2(move.durationSec),
          ...(move.ease ? { ease: move.ease } : {}),
          ...(move.zoom !== undefined ? { zoom: move.zoom } : {}),
        })),
      }
    : undefined;

  const cut: SceneCutIntentV1 | undefined =
    scene.cut && scene.cut !== "hard" ? { version: 1, style: scene.cut } : undefined;

  const directScene: DirectScene = {
    id: scene.id,
    title: scene.title,
    purpose: scene.purpose ?? scene.title,
    startSec: r2(startSec),
    durationSec: r2(scene.durationSec),
    ...(camera ? { camera } : {}),
    ...(cut ? { cut } : {}),
    ...(components.length ? { components } : {}),
    ...(beats.length ? { beats } : {}),
    ...(moments.length ? { moments: moments.sort((a, b) => a.atSec - b.atSec) } : {}),
  };

  return { scene: directScene, bodyHtml, timelineLines, startSec };
}

/**
 * Compile a whole canvas film. Returns the injected draft (all host islands in
 * place) ready for `validateDirectComposition` — the exact production gate.
 */
export function compileCanvasFilm(
  projectDir: string,
  film: CanvasFilm,
): DirectCompositionDraft {
  let cursor = 0;
  const compiled: CompiledScene[] = [];
  for (const scene of film.scenes) {
    compiled.push(compileScene(scene, cursor, film));
    cursor = r2(cursor + scene.durationSec);
  }
  const durationSec = cursor;
  const compositionId = "studio-canvas";

  const sceneSections = compiled
    .map((entry) => {
      const s = entry.scene;
      return (
        `<section id="${s.id}" class="scene clip" data-scene="${s.id}" ` +
        `data-start="${s.startSec}" data-duration="${s.durationSec}" data-track-index="1">` +
        `${entry.bodyHtml}</section>`
      );
    })
    .join("\n");

  // Scene opacity swaps (the hard-cut baseline) + entrance tweens.
  const sceneOpacity = compiled
    .map((entry, index) => {
      const s = entry.scene;
      const end = index === compiled.length - 1 ? durationSec : compiled[index + 1]!.scene.startSec;
      return (
        `tl.set("#${s.id}",{opacity:1},${s.startSec}).set("#${s.id}",{opacity:0},${cutBoundary(end)});`
      );
    })
    .join("\n");
  const entranceLines = compiled.flatMap((entry) => entry.timelineLines).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>Studio canvas film</title>
<script src="gsap.min.js"></script>
<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${film.background}}
body{color:${film.text};font-family:${film.bodyFont},Arial,sans-serif}
#root{--space-safe:72px;--space-region:64px;--space-element:28px;--surface:${film.surface};--accent:${film.accent};--text:${film.text};--muted:${film.muted};--cinema-key:${film.accent};--cinema-bloom:${film.accent};--font-display:${film.displayFont};--font-mono:ui-monospace,monospace;position:relative;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(circle at 78% 12%,${film.surface},${film.background} 55%)}
.scene{position:absolute;inset:0;padding:96px;opacity:0}
.world{position:absolute;left:0;top:0;height:1080px;transform-origin:0 0}
.region{position:absolute;top:0;height:1080px;display:grid;align-content:center;justify-items:center;padding:120px;min-width:0;min-height:0}
.canvas-flat{position:absolute;inset:0;display:grid;align-content:center;justify-items:center;padding:120px;text-align:center}
.canvas-stack{display:flex;flex-direction:column;gap:40px;align-items:center;min-width:0;max-width:1500px}
h1.cmp-headline{margin:0;font-family:${film.displayFont},${film.bodyFont},sans-serif;font-size:124px;line-height:.9;letter-spacing:-.05em;max-width:16ch;text-align:center}
.canvas-stack h1.cmp-headline ~ h1.cmp-headline{font-size:50px;font-weight:600;letter-spacing:-.02em;opacity:.82}
</style>
</head>
<body>
<main id="root" data-composition-id="${compositionId}" data-start="0" data-width="1920" data-height="1080" data-duration="${durationSec}">
${sceneSections}
</main>
<script>
window.__timelines=window.__timelines||{};
var tl=gsap.timeline({paused:true});
${sceneOpacity}
${entranceLines}
window.__timelines["${compositionId}"]=tl;
tl.seek(0);
</script>
</body>
</html>
`;

  const storyboard = compiled.map((entry) => entry.scene);
  // The REAL injection pass: camera / component / cut islands + runtime tags +
  // compile calls, time-wrap LAST. The studio is a cockpit over the engine.
  return applyDeterministicSourceRepairs({ html, storyboard }, projectDir, storyboard);
}

function cutBoundary(sec: number): string {
  return Math.max(0, sec - 0.01).toFixed(2);
}
