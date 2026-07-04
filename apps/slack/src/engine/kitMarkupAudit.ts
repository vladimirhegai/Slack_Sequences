/**
 * Static kit-markup completeness audit.
 *
 * Every host runtime (cuts, camera, components) binds against the browser DOM
 * and throws on a missing element — and one bind exception aborts the whole
 * compile, so browser QA reports an opaque timeline-registration timeout
 * instead of the real defect (the 2026-07-04 paid-run bottleneck: a chart
 * with no bars). This audit re-runs the same bind queries against a parsed
 * DOM *before* the browser, so those failures surface as named, repairable
 * findings inside static validation.
 *
 * A DOM parse (not regex) is load-bearing here: the other 2026-07-04 failure
 * was a scene present to source-text regexes but absent to the browser's DOM
 * after a patch broke the markup. linkedom parses with the HTML spec's error
 * recovery, so what this audit sees is what the browser will see.
 */
import { parseHTML } from "linkedom";
import type { DirectScene } from "./directComposition.ts";
import { resolveCutPlan } from "./cutContract.ts";
import { resolveCameraPlan, type CameraSegmentV1 } from "./cameraContract.ts";
import { resolveComponentPlan } from "./componentContract.ts";

export interface KitMarkupAuditResult {
  errors: string[];
  warnings: string[];
}

/** Attribute values are typed kebab-case ids; skip anything else defensively. */
const SAFE_ATTR_VALUE = /^[\w][\w:.-]*$/;

type DomElement = {
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  children: ArrayLike<DomElement>;
  tagName: string;
};

function bySelector(scope: DomElement, selector: string): DomElement | null {
  try {
    return scope.querySelector(selector);
  } catch {
    return null;
  }
}

function byAttr(scope: DomElement, attribute: string, value: string): DomElement | null {
  if (!SAFE_ATTR_VALUE.test(value)) return null;
  return bySelector(scope, `[${attribute}="${value}"]`);
}

/** Mirrors the component runtime's childItems() lookup order exactly. */
function childItems(el: DomElement): number {
  for (const selector of [".cmp-row", ".cmp-item", ".cmp-card", ".cmp-msg"]) {
    try {
      const found = el.querySelectorAll(selector);
      if (found.length) return found.length;
    } catch {
      return 0;
    }
  }
  let direct = 0;
  for (let i = 0; i < el.children.length; i += 1) {
    if (String(el.children[i]!.tagName).toLowerCase() === "i") direct += 1;
  }
  return direct;
}

function segmentTargets(
  segment: CameraSegmentV1,
): Array<{ attribute: "data-part" | "data-region"; value: string }> {
  const targets: Array<{ attribute: "data-part" | "data-region"; value: string }> = [];
  if (segment.fromPart) targets.push({ attribute: "data-part", value: segment.fromPart });
  else if (segment.fromRegion) targets.push({ attribute: "data-region", value: segment.fromRegion });
  if (segment.move !== "hold") {
    if (segment.toPart) targets.push({ attribute: "data-part", value: segment.toPart });
    else if (segment.toRegion) targets.push({ attribute: "data-region", value: segment.toRegion });
  }
  return targets;
}

export function auditKitMarkupCompleteness(
  html: string,
  scenes: DirectScene[],
): KitMarkupAuditResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!html.trim() || !scenes.length) return { errors, warnings };

  let document: DomElement;
  try {
    document = parseHTML(html).document as unknown as DomElement;
  } catch (error) {
    warnings.push(
      `kit markup audit could not parse the document: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { errors, warnings };
  }

  const root = bySelector(document, "[data-composition-id]");
  if (!root) {
    // Static root checks already error on a missing root in source text; this
    // branch means the root exists to regexes but not to a spec parser.
    errors.push(
      "dom_markup_broken: the data-composition-id root exists in the source text but not in " +
        "the parsed DOM — malformed markup (an unclosed tag or misplaced element) will abort " +
        "every runtime bind in the browser",
    );
    return { errors, warnings };
  }

  // Every runtime resolves scenes via root.querySelector — a scene the DOM
  // lost (or that error recovery moved outside the root) aborts the compile.
  const sceneElements = new Map<string, DomElement>();
  for (const scene of scenes) {
    const element = byAttr(root, "data-scene", scene.id);
    if (element) {
      sceneElements.set(scene.id, element);
    } else {
      errors.push(
        `dom_markup_broken: scene "${scene.id}" exists in the source text but not inside the ` +
          `parsed DOM root — check for an unclosed tag in or before that scene; the cut/camera/` +
          `component runtimes would all fail to bind it and abort the compile`,
      );
    }
  }

  // Cut runtime: bridged styles resolve both focal parts at bind time.
  for (const cut of resolveCutPlan(scenes).cuts) {
    const fromScene = sceneElements.get(cut.fromScene);
    const toScene = sceneElements.get(cut.toScene);
    if (cut.focalPartOut && fromScene && !byAttr(fromScene, "data-part", cut.focalPartOut)) {
      errors.push(
        `kit_markup_incomplete: cut ${cut.fromScene}->${cut.toScene} (${cut.style}) needs ` +
          `data-part="${cut.focalPartOut}" in scene "${cut.fromScene}" but the parsed DOM has ` +
          `none — the cut bind would abort the compile`,
      );
    }
    if (cut.focalPartIn && toScene && !byAttr(toScene, "data-part", cut.focalPartIn)) {
      errors.push(
        `kit_markup_incomplete: cut ${cut.fromScene}->${cut.toScene} (${cut.style}) needs ` +
          `data-part="${cut.focalPartIn}" in scene "${cut.toScene}" but the parsed DOM has ` +
          `none — the cut bind would abort the compile`,
      );
    }
  }

  // Camera runtime: the world plane and every segment's framing target are
  // hard bind requirements.
  for (const scenePlan of resolveCameraPlan(scenes).scenes) {
    const scene = sceneElements.get(scenePlan.sceneId);
    if (!scene) continue;
    const world = bySelector(scene, "[data-camera-world]");
    if (!world) {
      errors.push(
        `kit_markup_incomplete: scene "${scenePlan.sceneId}" declares a camera path but has no ` +
          `data-camera-world plane in the parsed DOM — the camera bind would abort the compile`,
      );
      continue;
    }
    const missing = new Set<string>();
    for (const segment of scenePlan.segments) {
      for (const target of segmentTargets(segment)) {
        if (!byAttr(scene, target.attribute, target.value)) {
          missing.add(`${target.attribute}="${target.value}"`);
        }
      }
    }
    for (const description of missing) {
      errors.push(
        `kit_markup_incomplete: camera path in scene "${scenePlan.sceneId}" frames ` +
          `${description} but the parsed DOM has no such element in that scene — the camera ` +
          `bind would abort the compile`,
      );
    }
  }

  // Component runtime: each beat's bind + the inner markup its compiler
  // animates. This is the "declared chart kinds must contain bars/stroke"
  // completeness check.
  const kindByScene = new Map<string, Map<string, string>>();
  for (const scene of scenes) {
    kindByScene.set(
      scene.id,
      new Map((scene.components ?? []).map((component) => [component.id, component.kind])),
    );
  }
  for (const scenePlan of resolveComponentPlan(scenes).scenes) {
    const scene = sceneElements.get(scenePlan.sceneId);
    if (!scene) continue;
    for (const beat of scenePlan.beats) {
      const el = byAttr(scene, "data-part", beat.component);
      if (!el) {
        errors.push(
          `kit_markup_incomplete: beat "${beat.id}" targets component "${beat.component}" but ` +
            `scene "${scenePlan.sceneId}" has no data-part="${beat.component}" element in the ` +
            `parsed DOM — the component bind would abort the compile`,
        );
        continue;
      }
      const kind = kindByScene.get(scenePlan.sceneId)?.get(beat.component) ?? "component";
      if (beat.kind === "chart") {
        const stroke = bySelector(el, "svg polyline") ?? bySelector(el, "svg path");
        if (!stroke && childItems(el) === 0) {
          errors.push(
            `kit_markup_incomplete: chart beat "${beat.id}" targets "${beat.component}" ` +
              `(${kind}) which contains neither bar children (.cmp-row/.cmp-item/.cmp-card or ` +
              `direct <i> elements) nor an svg polyline/path stroke — the chart bind would ` +
              `abort the compile; author the FINAL bars or line inside it`,
          );
        }
      }
      if ((beat.kind === "rows" || beat.kind === "select") && childItems(el) === 0) {
        errors.push(
          `kit_markup_incomplete: ${beat.kind} beat "${beat.id}" targets "${beat.component}" ` +
            `(${kind}) which has no .cmp-row/.cmp-item/.cmp-card/.cmp-msg children to ` +
            `${beat.kind === "rows" ? "reveal" : "select"} — the bind would abort the compile`,
        );
      }
      if (beat.kind === "progress") {
        const ring = bySelector(el, ".cmp-ring-fg");
        const fill = bySelector(el, "[data-cmp-fill]");
        let directI = false;
        for (let i = 0; i < el.children.length; i += 1) {
          if (String(el.children[i]!.tagName).toLowerCase() === "i") directI = true;
        }
        if (!ring && !fill && !directI) {
          errors.push(
            `kit_markup_incomplete: progress beat "${beat.id}" targets "${beat.component}" ` +
              `(${kind}) which has no .cmp-ring-fg, [data-cmp-fill], or direct <i> fill ` +
              `element — the progress bind would abort the compile`,
          );
        }
      }
      if (beat.kind === "morph" && beat.morphTo && !byAttr(scene, "data-part", beat.morphTo)) {
        errors.push(
          `kit_markup_incomplete: morph beat "${beat.id}" targets "${beat.morphTo}" but scene ` +
            `"${scenePlan.sceneId}" has no such data-part in the parsed DOM — the morph bind ` +
            `would abort the compile`,
        );
      }
    }
  }

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
