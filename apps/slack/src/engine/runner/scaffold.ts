import type { DirectScene } from "../directComposition.ts";
import { resolveCutPlan } from "../cutContract.ts";
import { resolveCameraPlan } from "../cameraContract.ts";
import { componentSkeletonMarkup } from "../componentContract.ts";
import type { ParsedSceneSlots } from "../sceneSlots.ts";
import {
  CAMERA_CELL_STRIDE_X,
  CAMERA_CELL_STRIDE_Y,
  cameraWorldStyle,
  regexpEscape,
  sceneScopeLocations,
} from "./repairs.ts";

/**
 * Exact per-region station rects derived from a scene's world-layout cells —
 * the same math `worldLayoutGuidance` renders as prose, here as inline styles
 * the skeleton stamps directly so the author copies coordinates instead of
 * inventing them.
 */
function worldStationRects(scene: DirectScene): Map<string, string> {
  const map = new Map<string, string>();
  const cells = scene.worldLayout ?? [];
  if (!cells.length) return map;
  const xs = cells.map((entry) => entry.cell[0]);
  const ys = cells.map((entry) => entry.cell[1]);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  for (const { region, cell, fitScale } of cells) {
    const scale = Math.min(1, Math.max(0.55, fitScale ?? 1));
    const width = Math.round(1400 * scale);
    const height = Math.round(800 * scale);
    const left = (cell[0] - minX) * CAMERA_CELL_STRIDE_X + 260 +
      Math.round((1400 - width) / 2);
    const top = (cell[1] - minY) * CAMERA_CELL_STRIDE_Y + 140 +
      Math.round((800 - height) / 2);
    // Centering grid default (fix-probe-3 m01: author interiors hug the
    // station's top-left corner in a void). Authors may override; a station
    // whose content is a centered group at fit zoom is the right default.
    map.set(
      region,
      `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;` +
        `display:grid;align-content:center;justify-items:center`,
    );
  }
  return map;
}

type SkeletonComponent = NonNullable<DirectScene["components"]>[number];
type ResolvedCameraScene = ReturnType<typeof resolveCameraPlan>["scenes"][number];

/**
 * Sentinel L1 scaffold (SENTINEL.md): the host-owned
 * shell for one scene. For a camera scene it emits the `data-camera-world`
 * plane sized from the world layout, each `data-region` station at its exact
 * rect, every declared component root inside its station (or on the plane),
 * cut/camera focal-part carriers, and a screen-space `data-camera-overlay` for
 * cursors. For a plain scene it emits the component roots and carriers in the
 * scene body. The author fills interiors; the paperwork bindings
 * (`data-camera-world`, `data-region`, component `data-part`, focal carriers)
 * are present by construction, so `reconcileCameraWorldPlanes`,
 * `reconcileComponentBindings`, and `reconcileContractBindings` become no-ops.
 */
/** The host-owned opening `<section>` tag for a scene (id/timing/track). */
export function sceneSkeletonOpenTag(scene: DirectScene): string {
  return (
    `<section id="${scene.id}" class="scene clip" data-scene="${scene.id}" ` +
    `data-start="${scene.startSec}" data-duration="${scene.durationSec}" data-track-index="1">`
  );
}

/**
 * The interior of a scene's shell (everything between the `<section>` tags) —
 * the camera-world plane + stations + component roots + focal carriers the
 * storyboard implies. Shared by the whole-doc skeleton (wrapped in the section)
 * and the slot path (shown as the `<scene_html>` template, assembled into the
 * host-owned section wrapper).
 */
function buildSceneSkeletonInterior(
  scene: DirectScene,
  cameraScene: ResolvedCameraScene | undefined,
  cutFocalParts: ReadonlySet<string>,
): string {
  // Plugin-owned components are HOST-INJECTED units (pluginContract.ts): the
  // author must not author their roots (the injection would duplicate them),
  // so the skeleton shows a do-not-author note instead of fillable roots.
  const allComponents = scene.components ?? [];
  const components = allComponents.filter((component) => !component.pluginUid);
  const componentIds = new Set(allComponents.map((component) => component.id));
  const pluginUnitIds = new Set(
    (scene.plugins ?? []).flatMap((declaration) => (declaration.uid ? [declaration.id] : [])),
  );
  const pluginNotes = (scene.plugins ?? [])
    .filter((declaration) => declaration.uid)
    .map((declaration) =>
      `  <!-- host-injected plugin "${declaration.kind}" (data-part="${declaration.id}") ` +
      `lands ${declaration.region ? `inside data-region="${declaration.region}"` : "in this scene"} — ` +
      `do NOT author it, its "${declaration.id}-*" parts, or content that restates what it ` +
      `renders${declaration.kind === "lockup" ? " (the lockup owns this scene's copy — no competing headlines/paragraphs)" : ""}; ` +
      `style the surrounding atmosphere instead -->`,
    );

  const regions = new Set<string>();
  for (const cell of scene.worldLayout ?? []) regions.add(cell.region);
  for (const component of components) if (component.region) regions.add(component.region);

  const requiredParts = new Set<string>(cutFocalParts);
  if (cameraScene) {
    for (const segment of cameraScene.segments) {
      if (segment.fromRegion) regions.add(segment.fromRegion);
      if (segment.toRegion) regions.add(segment.toRegion);
      for (const part of [segment.fromPart, segment.toPart, segment.focus?.part]) {
        if (part) requiredParts.add(part);
      }
    }
  }
  // A component root and a station already carry their name as a binding; only
  // truly free focal parts need a bare carrier. Plugin unit wrappers carry
  // their unit id as data-part, so those never need a carrier either.
  for (const id of componentIds) requiredParts.delete(id);
  for (const region of regions) requiredParts.delete(region);
  for (const id of pluginUnitIds) requiredParts.delete(id);

  const rects = worldStationRects(scene);
  const componentsByRegion = new Map<string, SkeletonComponent[]>();
  const looseComponents: SkeletonComponent[] = [];
  for (const component of components) {
    if (component.region && regions.has(component.region)) {
      const bucket = componentsByRegion.get(component.region);
      if (bucket) bucket.push(component);
      else componentsByRegion.set(component.region, [component]);
    } else {
      looseComponents.push(component);
    }
  }

  const carrier = (part: string): string => `<div data-part="${part}">…focal subject: style and fill…</div>`;

  if (cameraScene) {
    const stations = [...regions].map((region) => {
      const style = rects.get(region);
      const styleAttr = style ? ` style="${style}"` : "";
      const inner = (componentsByRegion.get(region) ?? [])
        .map(componentSkeletonMarkup)
        .join("");
      return `  <div data-region="${region}"${styleAttr}>${inner}…fill ${region}…</div>`;
    });
    const loose = [
      ...looseComponents.map((component) => `  ${componentSkeletonMarkup(component)}`),
      ...[...requiredParts].map((part) => `  ${carrier(part)}`),
    ];
    // Positioned inline so an author who copies the shell verbatim never
    // leaves the overlay in static flow pushing the world plane off-frame.
    const overlay = (scene.interactions?.length ?? 0) > 0
      ? '\n<div data-camera-overlay style="position:absolute;inset:0;pointer-events:none">' +
        "…cursors/labels in screen space…</div>"
      : "";
    return [
      `<div data-camera-world style="${cameraWorldStyle(scene)}">`,
      ...stations,
      ...loose,
      ...pluginNotes,
      `</div>${overlay}`,
    ].join("\n");
  }

  return [
    ...components.map((component) => `  ${componentSkeletonMarkup(component)}`),
    ...[...requiredParts].map((part) => `  ${carrier(part)}`),
    ...pluginNotes,
    "  …compose this scene's interior…",
  ].join("\n");
}

function buildSceneSkeleton(
  scene: DirectScene,
  cameraScene: ResolvedCameraScene | undefined,
  cutFocalParts: ReadonlySet<string>,
): string {
  const interior = buildSceneSkeletonInterior(scene, cameraScene, cutFocalParts);
  return `${sceneSkeletonOpenTag(scene)}\n${interior}\n</section>`;
}

/** Resolve per-scene camera plans + cut focal parts once for a storyboard. */
function skeletonContext(scenes: DirectScene[]): {
  cameraById: Map<string, ResolvedCameraScene>;
  focalByScene: Map<string, Set<string>>;
} {
  const cameraById = new Map(
    resolveCameraPlan(scenes).scenes.map((scenePlan) => [scenePlan.sceneId, scenePlan]),
  );
  const focalByScene = new Map<string, Set<string>>();
  const addFocal = (sceneId: string, part: string | undefined): void => {
    if (!part) return;
    const bucket = focalByScene.get(sceneId);
    if (bucket) bucket.add(part);
    else focalByScene.set(sceneId, new Set([part]));
  };
  for (const cut of resolveCutPlan(scenes).cuts) {
    addFocal(cut.fromScene, cut.focalPartOut);
    addFocal(cut.toScene, cut.focalPartIn);
  }
  return { cameraById, focalByScene };
}

/**
 * Full-fidelity skeletons for every scene (Sentinel Phase 1). Camera plans, cut
 * focal parts, and component roots are resolved once for the whole storyboard so
 * cross-scene cut endpoints land in the right scene.
 */
export function buildSceneSkeletons(scenes: DirectScene[]): string[] {
  const { cameraById, focalByScene } = skeletonContext(scenes);
  return scenes.map((scene) =>
    buildSceneSkeleton(scene, cameraById.get(scene.id), focalByScene.get(scene.id) ?? new Set()),
  );
}

/**
 * Count the illegal states the scaffold makes unrepresentable for a storyboard:
 * the host-guaranteed bindings (a camera-world plane + its data-region stations
 * per camera scene, a component root per declared component) that the model no
 * longer authors and so cannot omit. This is the L1 metric — see
 * `recordSentinelScaffold`. Kept in sync with what `buildSceneSkeletons` /
 * `componentSkeletonMarkup` actually stamp.
 */
export function countScaffoldedBindings(scenes: DirectScene[]): number {
  let count = 0;
  for (const scene of scenes) {
    if (scene.camera?.path?.length) count += 1 + worldStationRects(scene).size;
    count += scene.components?.length ?? 0;
  }
  return count;
}

/**
 * The HONEST L1 figure: how many of the storyboard's host-guaranteed bindings
 * (camera-world plane, stations, component roots) are actually PRESENT in the
 * document that ships. The skeleton/slot templates emit these, but the model
 * returns the interiors — a binding it dropped that no reconciler restored is
 * not "unrepresentable", so counting planned bindings (the old behavior)
 * overstated L1. Scanned per scene scope over the final html.
 */
export function countScaffoldBindingsPresent(
  scenes: DirectScene[],
  html: string,
): number {
  const scopes = new Map(
    [...sceneScopeLocations(html)].map((scope) => [
      scope.id,
      html.slice(scope.openEnd, scope.closeStart),
    ]),
  );
  let count = 0;
  for (const scene of scenes) {
    const content = scopes.get(scene.id);
    if (!content) continue;
    if (scene.camera?.path?.length) {
      if (/\bdata-camera-world\b/i.test(content)) count += 1;
      for (const region of worldStationRects(scene).keys()) {
        if (
          new RegExp(`\\bdata-region\\s*=\\s*["']${regexpEscape(region)}["']`, "i").test(content)
        ) {
          count += 1;
        }
      }
    }
    for (const component of scene.components ?? []) {
      if (
        new RegExp(`\\bdata-part\\s*=\\s*["']${regexpEscape(component.id)}["']`, "i").test(content)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Per-scene interior templates (Sentinel Phase 2 slots): the inner HTML the
 * author fills for each `<scene_html id>` slot. The host owns the `<section>`
 * wrapper at assembly time, so the model only sees and returns the interior.
 */
export function buildSceneSlotInteriors(scenes: DirectScene[]): Map<string, string> {
  const { cameraById, focalByScene } = skeletonContext(scenes);
  return new Map(
    scenes.map((scene) => [
      scene.id,
      buildSceneSkeletonInterior(
        scene,
        cameraById.get(scene.id),
        focalByScene.get(scene.id) ?? new Set(),
      ),
    ]),
  );
}
/**
 * Raw scaffold-contract gaps visible before host assembly. This is diagnostic,
 * NOT paid-retry eligibility: the complete L2 registry has richer evidence
 * (exact ids, semantic candidates, component-region ownership, and the host
 * chassis) and must run before L3 decides whether a provider repair is needed.
 * Near-misses already obvious at this layer stay out, as does a missing
 * camera-world plane that `reconcileCameraWorldPlanes` always wraps.
 */
export function slotScaffoldViolations(
  storyboard: DirectScene[],
  slots: ParsedSceneSlots,
): Map<string, string[]> {
  const { cameraById } = skeletonContext(storyboard);
  const out = new Map<string, string[]>();
  for (const scene of storyboard) {
    const html = slots.scenes.get(scene.id)?.html?.trim();
    if (!html) continue; // a wholly missing interior is the truncation path
    const notes: string[] = [];
    // Plugin-owned roots are host-injected AFTER authoring — their absence
    // from a returned interior is the designed state, never a violation.
    const authorOwned = (scene.components ?? []).filter((component) => !component.pluginUid);
    const componentsByKind = new Map<string, NonNullable<DirectScene["components"]>>();
    for (const component of authorOwned) {
      const group = componentsByKind.get(component.kind) ?? [];
      group.push(component);
      componentsByKind.set(component.kind, group);
    }
    const componentHasL2Candidate = (
      component: NonNullable<DirectScene["components"]>[number],
    ): boolean => {
      const rootRe = new RegExp(
        `\\bdata-part\\s*=\\s*["']${regexpEscape(component.id)}["']`,
        "i",
      );
      if (rootRe.test(html)) return true;
      const kindRe = new RegExp(
        `\\bdata-component\\s*=\\s*["']${regexpEscape(component.kind)}["']`,
        "i",
      );
      // One component of this kind is an obvious raw near-miss. L2 may safely
      // recognize additional exact-id/semantic shapes after host assembly;
      // callers must not treat this diagnostic as a complete classifier.
      return (componentsByKind.get(component.kind)?.length ?? 0) === 1 && kindRe.test(html);
    };
    const cameraScene = scene.camera?.path?.length ? cameraById.get(scene.id) : undefined;
    if (cameraScene) {
      const required = new Set<string>();
      for (const segment of cameraScene.segments) {
        if (segment.fromRegion) required.add(segment.fromRegion);
        if (segment.toRegion) required.add(segment.toRegion);
      }
      const present = new Set(
        [...html.matchAll(/\bdata-region\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!),
      );
      // Count tolerance: with as many stations as required, a renamed station
      // is an obvious near-miss. With fewer stations, suppress the raw gap when
      // this layer can already see a typed component anchor: L2 will stamp the
      // declared region and rehome it into the station. Other candidates (for
      // example an exact HTML id) remain diagnostic here and are still allowed
      // to recover in the complete L2 registry before any paid decision.
      if (present.size < required.size) {
        for (const region of required) {
          const l2Anchor = authorOwned.some((component) =>
            component.region === region && componentHasL2Candidate(component)
          );
          if (!present.has(region) && !l2Anchor) {
            notes.push(`camera station data-region="${region}" is missing from this scene`);
          }
        }
      }
    }
    for (const component of authorOwned) {
      // A kind-marked element is a safe L2 near-miss only when the storyboard
      // declares exactly ONE component of that kind. With repeated buttons,
      // cards, etc. the kind marker cannot identify which missing id it meant;
      // guessing there can bind motion to the wrong object.
      if (!componentHasL2Candidate(component)) {
        notes.push(
          `component root data-part="${component.id}" data-component="${component.kind}" ` +
            "is missing from this scene",
        );
      }
    }
    if (notes.length) out.set(scene.id, notes);
  }
  return out;
}
