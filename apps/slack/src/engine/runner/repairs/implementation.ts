import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CompleteOptions } from "@sequences/platform/providers";
import { parseFrame } from "../../frameValidation.ts";
import {
  validateDirectComposition,
  type DirectCompositionDraft,
  type DirectScene,
  type SceneLayoutRepairV1,
} from "../../directComposition.ts";
import {
  inspectDirectComposition,
  type DirectBrowserQaResult,
  type DirectLayoutIssue,
  type LoadBearingContainmentEvidence,
} from "../../layoutInspector.ts";
import { resolveCutPlan, type CutAxis } from "../../cutContract.ts";
import {
  CAMERA_FULL_MOVES,
  CAMERA_LANDING_RESERVE_SEC,
  resolveCameraPlan,
  type CameraMoveIntentV1,
} from "../../cameraContract.ts";
import {
  continuityGraphEnabled,
  reconcileContinuityBindings,
  resolveContinuityGraph,
} from "../../continuityGraph.ts";
import { resolveCameraBlockingPlan } from "../../cameraBlocking.ts";
import {
  ENVIRONMENT_PLAN_ID,
  environmentsEnabled,
  primaryReadingWindowsByScene,
  resolveProjectEnvironmentPlan,
  stripEnvironmentContract,
} from "../../environmentContract.ts";
import {
  CINEMA_KIT_FILE,
  CINEMA_KIT_VERSION,
  injectCinemaKit,
} from "../../cinemaKit.ts";
import { resolveTimeRampPlan } from "../../timeRamp.ts";
import { resolveFxPlan } from "../../fxContract.ts";
import { resolveAssetPlan } from "../../assetRuntime.ts";
import { stripDeadGsapTweens } from "../../deadTweenRepair.ts";
import {
  resolveComponentPlan,
  topUpHeldInteractionResultDevelopment,
  type ComponentKind,
} from "../../componentContract.ts";
import { analyzeMotionDensity } from "../../motionDensity.ts";
import { readFrameMeta } from "../../frameDesign.ts";
import { recordSentinelScaffoldRestoration } from "../../sentinelTelemetry.ts";
import { assetsEnabled, pluginsEnabled, recipesEnabled } from "../../sentinelFlags.ts";
import { injectRecipeContract } from "../../recipeContract.ts";
import { injectPluginContract } from "../../pluginContract.ts";
import {
  declareLinearNormalizerRegistry,
  runNormalizerRegistry,
  type NormalizerRuntimeHooks,
  type OrderedNormalizer,
  type UndeclaredNormalizer,
} from "../normalizerRegistry.ts";
import {
  firstHtmlDocument,
  firstJsonArray,
  structuredArray,
  tagged,
} from "../parse.ts";
import type { StoryboardPlanRequirements } from "../storyboardAudit.ts";
import type { CompositionRunResult } from "../types.ts";
import { cutSignatureBoundary, findingSignature } from "../findingSignatures.ts";
import { HOST_CONTRACTS, hostContract } from "../../hostContract.ts";
import { normalizeSceneSlotScript } from "../../sceneSlots.ts";
import { withRepairProof } from "./proof.ts";

export const MAX_REPAIR_PATCHES = 16;
export const PATCH_RESPONSE_FORMAT: NonNullable<CompleteOptions["responseFormat"]> = {
  type: "json_schema",
  json_schema: {
    name: "sequences_composition_patches",
    strict: true,
    schema: {
      type: "object",
      properties: {
        patches: {
          type: "array",
          minItems: 1,
          maxItems: MAX_REPAIR_PATCHES,
          items: {
            type: "object",
            properties: {
              search: { type: "string" },
              replace: { type: "string" },
            },
            required: ["search", "replace"],
            additionalProperties: false,
          },
        },
      },
      required: ["patches"],
      additionalProperties: false,
    },
  },
};
function htmlAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2];
}

export function regexpEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function semanticPartTokens(value: string): string[] {
  const modifiers = new Set(["active", "current", "primary", "selected", "target"]);
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !modifiers.has(token));
}

function semanticPartScore(expected: string, candidate: string): number {
  const expectedTokens = new Set(semanticPartTokens(expected));
  const candidateTokens = new Set(semanticPartTokens(candidate));
  if (!expectedTokens.size || !candidateTokens.size) return 0;
  const shared = [...expectedTokens].filter((token) => candidateTokens.has(token)).length;
  return shared / Math.max(expectedTokens.size, candidateTokens.size);
}

export function lockedSceneGraphError(html: string, storyboard: DirectScene[]): string | undefined {
  const authored = [...html.matchAll(
    /<[a-z][\w:-]*\b[^>]*\bdata-scene(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/gis,
  )].map((match) => ({
    id: htmlAttr(match[0], "data-scene") ?? htmlAttr(match[0], "id") ?? "",
    startSec: Number(htmlAttr(match[0], "data-start")),
    durationSec: Number(htmlAttr(match[0], "data-duration")),
  }));
  if (authored.length !== storyboard.length) {
    return `scene count changed from ${storyboard.length} to ${authored.length}`;
  }
  for (const expected of storyboard) {
    const match = authored.find((scene) => scene.id === expected.id);
    if (!match) return `scene "${expected.id}" was removed or renamed`;
    if (
      Math.abs(match.startSec - expected.startSec) > 0.01 ||
      Math.abs(match.durationSec - expected.durationSec) > 0.01
    ) {
      return `scene "${expected.id}" timing changed`;
    }
  }
  return undefined;
}

/** One scene-scoped `data-part` (or station) name a locked contract binds. */
interface ScenePartBinding {
  sceneId: string;
  part: string;
}

interface SceneScopeLocation {
  id: string;
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
}

function matchingCloseTag(
  source: string,
  openStart: number,
  openTag: string,
  limit = source.length,
): { contentStart: number; closeStart: number; closeEnd: number } | undefined {
  const tagName = openTag.match(/^<([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase();
  if (!tagName || /\/\s*>$/.test(openTag)) return undefined;
  const contentStart = openStart + openTag.length;
  const walker = new RegExp(
    `<${regexpEscape(tagName)}\\b[^>]*>|</${regexpEscape(tagName)}\\s*>`,
    "gi",
  );
  walker.lastIndex = contentStart;
  let depth = 1;
  for (let step = walker.exec(source); step && step.index < limit; step = walker.exec(source)) {
    if (step[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return {
          contentStart,
          closeStart: step.index,
          closeEnd: step.index + step[0].length,
        };
      }
    } else if (!/\/\s*>$/.test(step[0])) {
      depth += 1;
    }
  }
  return undefined;
}

export function sceneScopeLocations(source: string): SceneScopeLocation[] {
  const tags = [...source.matchAll(
    /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
  )];
  return tags.flatMap((match, index): SceneScopeLocation[] => {
    const tag = match[0];
    const openStart = match.index ?? 0;
    const tagName = tag.match(/^<([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase();
    const id = htmlAttr(tag, "data-scene") ?? "";
    if (!tagName || !id) return [];
    const close = matchingCloseTag(source, openStart, tag, tags[index + 1]?.index ?? source.length);
    if (!close) return [];
    return [{
      id,
      openStart,
      openEnd: close.contentStart,
      closeStart: close.closeStart,
      closeEnd: close.closeEnd,
    }];
  });
}

/**
 * Reconcile only scene-scoped part bindings whose intended element is
 * mechanically unambiguous. Exact element ids win; a semantic-name fallback is
 * allowed only when one globally unique part is the sole high-confidence
 * candidate. Ambiguity deliberately remains for quarantine/repair instead of
 * guessing.
 */
function reconcileScopedPartBindings(
  source: string,
  bindings: ScenePartBinding[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const desiredParts = [...new Map(bindings.flatMap((interaction) => [
    {
      sceneId: interaction.sceneId,
      part: interaction.part,
    },
  ]).map((entry) => [`${entry.sceneId}\u0000${entry.part}`, entry])).values()];

  for (const { sceneId, part: desired } of desiredParts) {
    const sceneTags = [...html.matchAll(
      /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
    )];
    const sceneIndex = sceneTags.findIndex((match) =>
      htmlAttr(match[0], "data-scene") === sceneId
    );
    if (sceneIndex < 0) continue;
    const scopeStart = sceneTags[sceneIndex]!.index;
    const scopeEnd = sceneTags[sceneIndex + 1]?.index ?? html.length;
    const scope = html.slice(scopeStart, scopeEnd);
    const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].map((match) => ({
      tag: match[0],
      id: htmlAttr(match[0], "id"),
      part: htmlAttr(match[0], "data-part"),
      index: scopeStart + match.index,
    }));
    const exact = tags.filter((entry) => entry.part === desired);
    const exactId = tags.filter((entry) => entry.id === desired);

    if (exact.length === 1) continue;
    if (exact.length > 1 && exactId.length === 1 && exactId[0]!.part === desired) {
      let duplicate = 0;
      const repairedScope = scope.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
        if (htmlAttr(tag, "data-part") !== desired || htmlAttr(tag, "id") === desired) {
          return tag;
        }
        duplicate += 1;
        repairs += 1;
        return tag.replace(
          new RegExp(`(\\bdata-part\\s*=\\s*)(["'])${regexpEscape(desired)}\\2`, "i"),
          `$1"${desired}-aux-${duplicate}"`,
        );
      });
      html = html.slice(0, scopeStart) + repairedScope + html.slice(scopeEnd);
      continue;
    }
    if (exact.length > 1) continue;

    let candidate = exactId.length === 1 ? exactId[0] : undefined;
    if (!candidate) {
      const partCounts = new Map<string, number>();
      for (const entry of tags) {
        if (entry.part) partCounts.set(entry.part, (partCounts.get(entry.part) ?? 0) + 1);
      }
      const scored = tags
        .filter((entry) =>
          Boolean(entry.part) &&
          partCounts.get(entry.part!) === 1 &&
          !entry.tag.includes("data-sequences-runtime-")
        )
        .map((entry) => ({
          entry,
          score: Math.max(
            semanticPartScore(desired, entry.part!),
            entry.id ? semanticPartScore(desired, entry.id) : 0,
          ),
        }))
        .filter((entry) => entry.score >= 0.8)
        .sort((a, b) => b.score - a.score);
      if (scored.length === 1 || (scored[0] && scored[0].score > (scored[1]?.score ?? 0))) {
        candidate = scored[0]?.entry;
      }
    }
    if (!candidate) continue;

    const replacement = candidate.part
      ? candidate.tag.replace(
          /(\bdata-part\s*=\s*)(["'])(.*?)\2/i,
          `$1"${desired}"`,
        )
      : candidate.tag.replace(/>$/, ` data-part="${desired}">`);
    if (replacement === candidate.tag) continue;
    html = html.slice(0, candidate.index) + replacement +
      html.slice(candidate.index + candidate.tag.length);
    repairs += 1;
  }
  return { html, repairs };
}

/**
 * Reconcile interaction targets whose intended element is mechanically
 * unambiguous (exact id, unique semantic candidate, or duplicate cleanup).
 */
export function reconcileInteractionTargets(
  source: string,
  interactions: NonNullable<DirectScene["interactions"]>,
): { html: string; repairs: number } {
  return reconcileScopedPartBindings(source, interactions.flatMap((interaction) => [
    { sceneId: interaction.sceneId, part: interaction.targetPart },
    ...(interaction.dragTargetPart
      ? [{ sceneId: interaction.sceneId, part: interaction.dragTargetPart }]
      : []),
  ]));
}

/**
 * Reconcile a missing `data-region` camera station onto the one element that
 * already carries the station's name as its id or data-part. Regions place
 * the camera, so only exact-name evidence is trusted here — no semantic
 * scoring, and any ambiguity stays a blocking finding.
 */
function reconcileCameraRegionStations(
  source: string,
  bindings: ScenePartBinding[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const desired = [...new Map(
    bindings.map((entry) => [`${entry.sceneId} ${entry.part}`, entry]),
  ).values()];
  for (const { sceneId, part: region } of desired) {
    const sceneTags = [...html.matchAll(
      /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
    )];
    const sceneIndex = sceneTags.findIndex((match) =>
      htmlAttr(match[0], "data-scene") === sceneId
    );
    if (sceneIndex < 0) continue;
    const scopeStart = sceneTags[sceneIndex]!.index;
    const scopeEnd = sceneTags[sceneIndex + 1]?.index ?? html.length;
    const scope = html.slice(scopeStart, scopeEnd);
    const regionPattern = new RegExp(
      `\\bdata-region\\s*=\\s*(["'])${regexpEscape(region)}\\1`,
      "i",
    );
    if (regionPattern.test(scope)) continue;
    const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].map((match) => ({
      tag: match[0],
      id: htmlAttr(match[0], "id"),
      part: htmlAttr(match[0], "data-part"),
      index: scopeStart + match.index,
    })).filter((entry) =>
      !entry.tag.includes("data-sequences-runtime-") &&
      !htmlAttr(entry.tag, "data-region")
    );
    const idMatches = tags.filter((entry) => entry.id === region);
    const partMatches = tags.filter((entry) => entry.part === region);
    const candidate = idMatches.length === 1
      ? idMatches[0]
      : idMatches.length === 0 && partMatches.length === 1
        ? partMatches[0]
        : undefined;
    if (!candidate) continue;
    const replacement = candidate.tag.replace(/>$/, ` data-region="${region}">`);
    if (replacement === candidate.tag) continue;
    html = html.slice(0, candidate.index) + replacement +
      html.slice(candidate.index + candidate.tag.length);
    repairs += 1;
  }
  return { html, repairs };
}

// Camera cells overlap their viewport footprints by a small connective band.
// A full 1920/1080 stride put two centered subjects exactly beyond opposite
// frame edges at the route midpoint, producing a literal blank frame between
// stations. These strides keep station boxes disjoint (200px/100px gutters)
// while letting outgoing and incoming subjects share the edge of a travel shot.
export const CAMERA_CELL_STRIDE_X = 1600;
export const CAMERA_CELL_STRIDE_Y = 900;

function worldLayoutDimensions(scene: DirectScene | undefined): {
  width: number;
  height: number;
  minX: number;
  minY: number;
} {
  const cells = scene?.worldLayout ?? [];
  if (!cells.length) {
    return { width: 1920, height: 1080, minX: 0, minY: 0 };
  }
  const xs = cells.map((entry) => entry.cell[0]);
  const ys = cells.map((entry) => entry.cell[1]);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const width = (Math.max(...xs, 0) - minX) * CAMERA_CELL_STRIDE_X + 1920;
  const height = (Math.max(...ys, 0) - minY) * CAMERA_CELL_STRIDE_Y + 1080;
  return { width, height, minX, minY };
}

export function cameraWorldStyle(scene: DirectScene | undefined): string {
  const cells = scene?.worldLayout ?? [];
  if (!cells.length) {
    return "position:absolute;inset:0;transform-origin:0 0";
  }
  const { width, height } = worldLayoutDimensions(scene);
  return `position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0`;
}

/**
 * Reassert the locked world grid on authored and replayed source. The skeleton
 * already gives new authors these coordinates; this host style also migrates
 * older accepted films so runtime measurement and Studio previews use the same
 * connective geometry without asking a paid source model to rewrite markup.
 */
export function injectWorldLayoutStyles(
  source: string,
  scenes: DirectScene[],
): { html: string; rules: number } {
  let html = source.replace(
    /<style\b[^>]*\bdata-sequences-world-layout\b[^>]*>[\s\S]*?<\/style>/gi,
    "",
  );
  const rules = scenes.flatMap((scene) => {
    const cells = scene.worldLayout ?? [];
    if (!cells.length) return [];
    const { width, height, minX, minY } = worldLayoutDimensions(scene);
    const sceneId = scene.id.replace(/["\\]/g, "");
    return [
      `[data-scene="${sceneId}"] [data-camera-world]{` +
        `width:${width}px !important;height:${height}px !important;}`,
      ...cells.map(({ region, cell, fitScale }) => {
        const safeRegion = region.replace(/["\\]/g, "");
        const scale = Math.min(1, Math.max(0.55, fitScale ?? 1));
        const stationWidth = Math.round(1400 * scale);
        const stationHeight = Math.round(800 * scale);
        const left = (cell[0] - minX) * CAMERA_CELL_STRIDE_X + 260 +
          Math.round((1400 - stationWidth) / 2);
        const top = (cell[1] - minY) * CAMERA_CELL_STRIDE_Y + 140 +
          Math.round((800 - stationHeight) / 2);
        return `[data-scene="${sceneId}"] [data-region="${safeRegion}"]{` +
          `position:absolute !important;left:${left}px !important;top:${top}px !important;` +
          `width:${stationWidth}px !important;height:${stationHeight}px !important;}`;
      }),
    ];
  });
  if (!rules.length) return { html, rules: 0 };
  const style = `<style data-sequences-world-layout>\n${rules.join("\n")}\n</style>`;
  html = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, () => `${style}</head>`)
    : `${style}\n${html}`;
  return { html, rules: rules.length };
}

/**
 * A locked camera path means the scene must expose one transformable world
 * plane. When the author built the stations directly in the scene and omitted
 * only the wrapper, wrap that scene content in the canonical host plane.
 */
export function reconcileCameraWorldPlanes(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number } {
  const cameraSceneIds = new Set(resolveCameraPlan(scenes).scenes.map((scene) => scene.sceneId));
  if (!cameraSceneIds.size) return { html: source, repairs: 0 };
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  let html = source;
  let repairs = 0;
  for (const scope of [...sceneScopeLocations(html)].reverse()) {
    if (!cameraSceneIds.has(scope.id)) continue;
    let content = html.slice(scope.openEnd, scope.closeStart);
    if (/\bdata-camera-world\b/i.test(content)) continue;
    // Preserve percentage centering as the independent CSS translate property.
    // GSAP component entrances own `transform` (scale/y); leaving centering in
    // that same shorthand lets the first tween erase translate(-50%,-50%) and
    // throws a large app window out of frame (PatchworkQC6 trail assembly).
    content = content.replace(
      /transform\s*:\s*translate\(\s*-50%\s*,\s*-50%\s*\)\s*;/gi,
      "translate:-50% -50%;transform:none;",
    );
    const wrapped =
      `\n<div data-camera-world style="${cameraWorldStyle(byId.get(scope.id))}">` +
      `${content}` +
      `\n</div>\n`;
    html = html.slice(0, scope.openEnd) + wrapped + html.slice(scope.closeStart);
    repairs += 1;
  }
  return { html, repairs };
}

/**
 * Deterministic binding reconciliation for the host-owned cut and camera
 * contracts. The author loop's most expensive failure class (the 2026-07-04
 * live fallback) was a locked-storyboard binding — a shape-match focal part or
 * a camera station — that the authored DOM carried under a near-miss name or
 * simply left unannotated on the intended element. Mechanically unambiguous
 * mismatches are reconciled here, before validation spends a paid repair on
 * binding paperwork; ambiguous targets deliberately stay blocking.
 */
export function reconcileContractBindings(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number; regionRepairs: number } {
  let html = source;
  let repairs = 0;
  let regionRepairs = 0;
  const partBindings: ScenePartBinding[] = [];
  for (const cut of resolveCutPlan(scenes).cuts) {
    if (cut.focalPartOut) partBindings.push({ sceneId: cut.fromScene, part: cut.focalPartOut });
    if (cut.focalPartIn) partBindings.push({ sceneId: cut.toScene, part: cut.focalPartIn });
  }
  // MD4: a gradeShift's fromPart is locked-storyboard paperwork like a cut focal
  // part — reconcile a near-miss id deterministically so a paid repair is never
  // spent on it (an absent/ambiguous fromPart just centers the wash — harmless).
  for (const scene of scenes) {
    if (scene.gradeShift?.fromPart) {
      partBindings.push({ sceneId: scene.id, part: scene.gradeShift.fromPart });
    }
  }
  const regionBindings: ScenePartBinding[] = [];
  for (const scenePlan of resolveCameraPlan(scenes).scenes) {
    for (const segment of scenePlan.segments) {
      for (const part of [segment.fromPart, segment.toPart, segment.focus?.part]) {
        if (part) partBindings.push({ sceneId: scenePlan.sceneId, part });
      }
      for (const region of [segment.fromRegion, segment.toRegion]) {
        if (region) regionBindings.push({ sceneId: scenePlan.sceneId, part: region });
      }
    }
  }
  if (partBindings.length) {
    const parts = reconcileScopedPartBindings(html, partBindings);
    html = parts.html;
    repairs += parts.repairs;
  }
  if (regionBindings.length) {
    const regions = reconcileCameraRegionStations(html, regionBindings);
    html = regions.html;
    repairs += regions.repairs;
    regionRepairs += regions.repairs;
  }
  return { html, repairs, regionRepairs };
}

/**
 * The model chooses interaction intent; the runtime owns the mechanical actors.
 * Retiring model-authored pointers/ripples prevents guessed hotspots, zero-size
 * ripples, duplicate visibility tweens, and inherited camera transforms from
 * leaking into an otherwise deterministic interaction.
 */
export function normalizeInteractionActors(
  source: string,
  interactions: NonNullable<DirectScene["interactions"]>,
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const cursorIds = [...new Set(interactions.map((interaction) => interaction.cursorId))];
  // Authored CSS/JS selectors should keep addressing the retired decoration,
  // never accidentally grab the canonical actor injected below.
  html = html.replace(
    /\[data-cursor-id(?=[\]=])/gi,
    "[data-sequences-retired-cursor",
  );
  for (const cursorId of cursorIds) {
    const cursorAttribute = new RegExp(
      `\\bdata-cursor-id\\s*=\\s*(["'])${regexpEscape(cursorId)}\\1`,
      "i",
    );
    html = html.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
      if (
        tag.includes("data-sequences-runtime-cursor") ||
        !cursorAttribute.test(tag)
      ) {
        return tag;
      }
      repairs += 1;
      return tag.replace(
        cursorAttribute,
        `data-sequences-retired-cursor="${cursorId}"`,
      );
    });

    // Live authors also draw cursors as plain `id="cursor-name"` elements
    // (BeaconOps used a circular div this way). Attribute-only retirement left
    // that actor alive beside the canonical arrow, so the viewer saw two
    // pointers in different coordinate spaces. Keep the id so authored JS
    // continues to resolve harmlessly, but hide the element through the same
    // retirement channel as data-cursor-id actors.
    const cursorElementId = new RegExp(
      `\\bid\\s*=\\s*(["'])${regexpEscape(cursorId)}\\1`,
      "i",
    );
    html = html.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
      if (
        tag.includes("data-sequences-runtime-cursor") ||
        tag.includes("data-sequences-retired-cursor") ||
        !cursorElementId.test(tag)
      ) {
        return tag;
      }
      repairs += 1;
      return ensureTagAttr(tag, "data-sequences-retired-cursor", cursorId);
    });
  }

  // Some slot authors draw the pointer as a generic class-only decoration
  // (`.cursor-indicator`) instead of binding it to the declared cursor id.
  // The interaction contract still owns the only visible pointer. Retire only
  // unmistakable pointer-actor class tokens, and only inside a scene that has
  // a typed interaction; typing carets and ordinary `cursor:pointer` styling
  // remain author-owned.
  const interactionScenes = new Map<string, string>();
  for (const interaction of interactions) {
    if (!interactionScenes.has(interaction.sceneId)) {
      interactionScenes.set(interaction.sceneId, interaction.cursorId);
    }
  }
  const pointerActorClass =
    /^(?:cursor|cursor-indicator|cursor-dot|custom-cursor|interaction-cursor|mouse-cursor|mouse-pointer|pointer-indicator)$/i;
  const scopes = sceneScopeLocations(html).filter((scope) => interactionScenes.has(scope.id));
  for (const scope of scopes.slice().sort((a, b) => b.openStart - a.openStart)) {
    const cursorId = interactionScenes.get(scope.id)!;
    const interior = html.slice(scope.openEnd, scope.closeStart);
    const repaired = interior.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
      if (
        tag.includes("data-sequences-runtime-cursor") ||
        tag.includes("data-sequences-retired-cursor")
      ) {
        return tag;
      }
      const className = htmlAttr(tag, "class");
      if (!className?.split(/\s+/).some((token) => pointerActorClass.test(token))) {
        return tag;
      }
      repairs += 1;
      return ensureTagAttr(tag, "data-sequences-retired-cursor", cursorId);
    });
    if (repaired !== interior) {
      html = html.slice(0, scope.openEnd) + repaired + html.slice(scope.closeStart);
    }
  }
  const missingCursorIds = cursorIds.filter((cursorId) =>
    !new RegExp(
      `\\bdata-cursor-id\\s*=\\s*(["'])${regexpEscape(cursorId)}\\1`,
      "i",
    ).test(html)
  );
  if (missingCursorIds.length) {
    const actors = missingCursorIds.map((cursorId) =>
      `<svg aria-hidden="true" data-sequences-runtime-cursor ` +
      `data-cursor-id="${cursorId}" data-cursor-hotspot-x="0.1" ` +
      `data-cursor-hotspot-y="0.06" viewBox="0 0 32 32" ` +
      `style="position:absolute;left:0;top:0;width:32px;height:32px;opacity:0;` +
      `overflow:visible;pointer-events:none;z-index:2147483000;color:#fff;` +
      `filter:drop-shadow(0 1px 2px rgba(0,0,0,.72))">` +
      `<path d="M3 2.2 4.2 26l6.3-5.7 5.7 10.1 4.5-2.5-5.8-10.2 8.5-1.7Z" ` +
      `fill="currentColor" stroke="#090b0f" stroke-width="2" stroke-linejoin="round"/>` +
      `</svg>`
    ).join("");
    const overlay =
      `<div aria-hidden="true" data-camera-overlay data-sequences-interaction-layer ` +
      `style="position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:2147483000">` +
      `${actors}</div>`;
    const rootPattern =
      /<[a-z][\w:-]*\b(?=[^>]*\bdata-composition-id\s*=)[^>]*>/i;
    if (rootPattern.test(html)) {
      html = html.replace(rootPattern, (tag) => `${tag}\n${overlay}`);
      repairs += missingCursorIds.length;
    }
  }

  for (const interaction of interactions) {
    if (!interaction.ripplePart) continue;
    const rippleAttribute = new RegExp(
      `\\bdata-part\\s*=\\s*(["'])${regexpEscape(interaction.ripplePart)}\\1`,
      "i",
    );
    // The cursor precedent, applied per ripple id: authored CSS/JS selectors
    // (`[data-part='the-ripple']` in a tween or stylesheet) must keep
    // addressing the RETIRED decoration — both so they never grab the
    // canonical actor injected below, and so the bare-attribute existence
    // test cannot mistake a selector string inside an inline script for a
    // still-bound element (the 2026-07-07 TraceKit probe shipped rippleless
    // exactly this way: the authored tween's selector kept
    // `interaction_ripple_missing` alive through every paid attempt).
    const rippleSelector = new RegExp(
      `\\[\\s*data-part\\s*=\\s*(["'])${regexpEscape(interaction.ripplePart)}\\1\\s*\\]`,
      "gi",
    );
    // Keep the ORIGINAL quote character: the selector usually lives inside a
    // quoted JS string, and swapping quote styles would break its parse.
    html = html.replace(
      rippleSelector,
      (_match, quote: string) =>
        `[data-sequences-retired-ripple=${quote}${interaction.ripplePart}${quote}]`,
    );
    html = html.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
      if (
        tag.includes("data-sequences-runtime-ripple") ||
        !rippleAttribute.test(tag)
      ) {
        return tag;
      }
      repairs += 1;
      return tag.replace(
        rippleAttribute,
        `data-sequences-retired-ripple="${interaction.ripplePart}"`,
      );
    });
    // Same ownership rule for id-only authored ripple/click-ring elements.
    // They remain addressable by the author's timeline but are display:none,
    // while the measured host ripple is the only visible feedback actor.
    const rippleElementId = new RegExp(
      `\\bid\\s*=\\s*(["'])${regexpEscape(interaction.ripplePart)}\\1`,
      "i",
    );
    html = html.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
      if (
        tag.includes("data-sequences-runtime-ripple") ||
        tag.includes("data-sequences-retired-ripple") ||
        !rippleElementId.test(tag)
      ) {
        return tag;
      }
      repairs += 1;
      return ensureTagAttr(tag, "data-sequences-retired-ripple", interaction.ripplePart!);
    });
    if (rippleAttribute.test(html)) continue;
    const scenePattern = new RegExp(
      `<[a-z][\\w:-]*\\b(?=[^>]*\\bdata-scene\\s*=\\s*(["'])${
        regexpEscape(interaction.sceneId)
      }\\1)[^>]*>`,
      "i",
    );
    if (!scenePattern.test(html)) continue;
    const ripple =
      `<span aria-hidden="true" data-sequences-runtime-ripple ` +
      `data-part="${interaction.ripplePart}" style="position:absolute;left:0;top:0;` +
      `width:72px;height:72px;border:3px solid var(--accent,#3b82f6);` +
      `border-radius:999px;opacity:0;pointer-events:none;z-index:2147482999;` +
      `box-sizing:border-box;filter:drop-shadow(0 0 1px #000)"></span>`;
    html = html.replace(scenePattern, (tag) => `${tag}\n${ripple}`);
    repairs += 1;
  }
  if (
    repairs &&
    !html.includes("<style data-sequences-runtime-actors>")
  ) {
    html = html.replace(
      /<\/head>/i,
      `<style data-sequences-runtime-actors>` +
        `[data-sequences-retired-cursor],[data-sequences-retired-ripple]` +
        `{display:none!important}</style></head>`,
    );
  }
  return { html, repairs };
}

/**
 * A ring's centered value is commonly authored with absolute inset geometry.
 * The shared component vocabulary also uses `.cmp-value` inside stat cards,
 * pricing cards, and other flow components. An unscoped ring rule therefore
 * pulls those values out of flow (ProofLine: `READINESS SCORE` rendered behind
 * `94%`). Scope only the unmistakable centered-ring geometry signature, and
 * only when the document actually contains both a ring and another typed value
 * surface. Typography-only/global value rules remain untouched.
 */
export function scopeRingValueGeometryStyles(
  source: string,
): { html: string; repairs: number } {
  const hasRing = /\bdata-component\s*=\s*(["'])progress-ring\1/i.test(source);
  const hasOtherValueSurface = /\bdata-component\s*=\s*(["'])(?:stat-card|pricing-card|metric-card)\1/i
    .test(source);
  if (!hasRing || !hasOtherValueSurface) return { html: source, repairs: 0 };

  let repairs = 0;
  const html = source.replace(
    /<style\b(?![^>]*\bdata-sequences-host\b)(?![^>]*\bid\s*=\s*["']sequences-)[^>]*>([\s\S]*?)<\/style>/gi,
    (block, css: string) => {
      const scoped = css.replace(
        /(^|})(\s*)([^@{}][^{}]*)\{([^{}]*)\}/g,
        (rule, boundary: string, spacing: string, selectorSource: string, declarations: string) => {
          const ringGeometry =
            /\bposition\s*:\s*absolute\b/i.test(declarations) &&
            /\binset\s*:\s*0(?:px)?(?:\s+0(?:px)?){0,3}\s*;?/i.test(declarations) &&
            /\balign-items\s*:\s*center\b/i.test(declarations) &&
            /\bjustify-content\s*:\s*center\b/i.test(declarations);
          if (!ringGeometry) return rule;
          let changed = false;
          const selectors = selectorSource.split(",").map((selector) => {
            if (selector.trim() !== ".cmp-value") return selector;
            changed = true;
            const leading = selector.match(/^\s*/)?.[0] ?? "";
            const trailing = selector.match(/\s*$/)?.[0] ?? "";
            return `${leading}[data-component="progress-ring"] .cmp-value${trailing}`;
          });
          if (!changed) return rule;
          repairs += 1;
          return `${boundary}${spacing}${selectors.join(",")}{${declarations}}`;
        },
      );
      return scoped === css ? block : block.replace(css, scoped);
    },
  );
  return { html, repairs };
}
function inferVisibilityOpacity(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (
    normalized === "none" ||
    normalized === "hidden" ||
    normalized === "collapse" ||
    normalized === "0" ||
    normalized === "false"
  ) {
    return 0;
  }
  if (
    normalized === "block" ||
    normalized === "flex" ||
    normalized === "grid" ||
    normalized === "inline" ||
    normalized === "inline-block" ||
    normalized === "visible" ||
    normalized === "1" ||
    normalized === "true"
  ) {
    return 1;
  }
  return undefined;
}

function cleanGsapVarsObject(source: string): { source: string; changed: boolean } {
  const forbidden =
    /(["']?)(display|visibility)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$.-]*|-?\d+(?:\.\d+)?|true|false|null)\s*,?/gi;
  const values = [...source.matchAll(forbidden)].map((match) => match[3]);
  if (!values.length) return { source, changed: false };

  let body = source.slice(1, -1);
  body = body.replace(
    /,\s*(["']?)(display|visibility)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$.-]*|-?\d+(?:\.\d+)?|true|false|null)\s*/gi,
    "",
  );
  body = body.replace(
    /^\s*(["']?)(display|visibility)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$.-]*|-?\d+(?:\.\d+)?|true|false|null)\s*,?\s*/i,
    "",
  );
  body = body.replace(/,\s*}/g, "}").replace(/^\s*,\s*/, "");

  const cleaned = `{${body}}`;
  if (/\b(?:opacity|autoAlpha)\s*:/.test(cleaned)) {
    return { source: cleaned, changed: cleaned !== source };
  }
  const inferred = values
    .map(inferVisibilityOpacity)
    .find((opacity): opacity is number => opacity !== undefined);
  if (inferred === undefined) return { source: cleaned, changed: cleaned !== source };

  const trimmedBody = body.trim();
  const addition = `opacity: ${inferred}`;
  return {
    source: trimmedBody ? `{ ${addition}, ${trimmedBody} }` : `{ ${addition} }`,
    changed: true,
  };
}

function rewriteGsapCallVars(call: string): { call: string; repairs: number } {
  let output = "";
  let cursor = 0;
  let repairs = 0;
  for (let index = 0; index < call.length; index += 1) {
    if (call[index] !== "{") continue;
    let depth = 1;
    let quote: string | undefined;
    let escaped = false;
    let end = -1;
    for (let scan = index + 1; scan < call.length; scan += 1) {
      const next = call[scan]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (next === "\\") {
          escaped = true;
        } else if (next === quote) {
          quote = undefined;
        }
        continue;
      }
      if (next === "\"" || next === "'" || next === "`") {
        quote = next;
      } else if (next === "{") {
        depth += 1;
      } else if (next === "}") {
        depth -= 1;
        if (depth === 0) {
          end = scan;
          break;
        }
      }
    }
    if (end < 0) break;
    const objectSource = call.slice(index, end + 1);
    const cleaned = cleanGsapVarsObject(objectSource);
    if (cleaned.changed) {
      output += call.slice(cursor, index) + cleaned.source;
      cursor = end + 1;
      repairs += 1;
    }
    index = end;
  }
  if (!repairs) return { call, repairs };
  return { call: output + call.slice(cursor), repairs };
}

function normalizeGsapDisplayVisibilityTweens(source: string): { html: string; repairs: number } {
  const callStart = /\b(?:gsap|[A-Za-z_$][\w$]*)\s*\.\s*(?:to|from|fromTo|set)\s*\(/g;
  let html = "";
  let cursor = 0;
  let repairs = 0;
  for (const match of source.matchAll(callStart)) {
    const start = match.index ?? 0;
    const open = source.indexOf("(", start);
    if (open < 0) continue;
    let depth = 1;
    let quote: string | undefined;
    let escaped = false;
    let close = -1;
    for (let index = open + 1; index < source.length; index += 1) {
      const char = source[index]!;
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        continue;
      }
      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close < 0) continue;
    const call = source.slice(start, close + 1);
    const rewritten = rewriteGsapCallVars(call);
    if (rewritten.repairs) {
      html += source.slice(cursor, start) + rewritten.call;
      cursor = close + 1;
      repairs += rewritten.repairs;
    }
  }
  if (!repairs) return { html: source, repairs };
  return { html: html + source.slice(cursor), repairs };
}

/** Kit child classes the component runtime's childItems() reveals. */
const REVEALABLE_CHILD_CLASS =
  /(?:\bdata-cmp-item\b|\bclass\s*=\s*(["'])[^"']*(?:\bcmp-(?:row|item|card|msg)\b|\b[a-z][\w-]*-row\b)[^"']*\1)/i;

/** Beat kinds that carry model-authored copy usable as a real row label. */
const ROW_LABEL_BEAT_KINDS: ReadonlySet<string> = new Set(["type", "swap", "stream"]);
/** The neutral "Item N" noun per kind, only used when the plan carries no copy. */
const NEUTRAL_ROW_NOUN: Record<string, string> = { kanban: "Card", chat: "Message", table: "Row" };

function escapeRowLabel(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Clean a candidate row label reused from elsewhere in the plan: strip wrapping
 * quotes (the scattered-fragments foreground quotes each phrase), collapse
 * whitespace, and clamp to ~40 chars so a long sentence fragment reads as a row.
 * Returns "" for an unusable fragment.
 */
function cleanRowLabel(raw: string): string {
  let text = raw.trim().replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "").trim();
  text = text.replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length > 40) text = `${text.slice(0, 39).trimEnd()}…`;
  return text;
}

/**
 * Derive up to `count` REAL row labels for a topped-up rows target, honestly
 * reusing strings the model itself wrote elsewhere in the plan — never inventing
 * a product claim (T5, probe-audit-01/03: the generic "Item 1/2/3" shipped on
 * screen). Priority order:
 *   1. the component's own type/swap/stream beat text,
 *   2. the owning scene's moment titles (short, already display-grade),
 *   3. the scene's foreground sentence split on commas/semicolons (probe-01's
 *      scattered-fragments scene carries five quoted phrases exactly like this).
 * Each label carries the source it came from so the degradation note is honest;
 * slots past the derivable copy fall back to the neutral noun.
 */
function deriveRowLabels(
  scene: DirectScene,
  componentId: string,
  count: number,
): Array<{ label: string; source: string }> {
  const seen = new Set<string>();
  const out: Array<{ label: string; source: string }> = [];
  const add = (value: string | undefined, source: string): void => {
    if (out.length >= count || value == null) return;
    const label = cleanRowLabel(value);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, source });
  };
  for (const beat of scene.beats ?? []) {
    if (beat.component === componentId && ROW_LABEL_BEAT_KINDS.has(beat.kind)) add(beat.text, "beat-text");
  }
  for (const moment of scene.moments ?? []) add(moment.title, "moments");
  for (const fragment of (scene.foreground ?? "").split(/[;,]/)) add(fragment, "foreground");
  return out;
}

/**
 * The kind-appropriate revealable child markup for a rows-markup top-up.
 * `data-sequences-neutral="1"` marks host-invented placeholder STRUCTURE (the
 * author omitted these rows) so the publish-time honesty scan records the
 * degradation; `data-sequences-rows-source` records WHERE the copy came from
 * (a reused plan string, or "neutral" for the "Item N" fallback).
 */
function rowsChildMarkup(
  kind: string | undefined,
  index: number,
  label: string | undefined,
  source: string,
): string {
  const mark = ` data-sequences-neutral="1" data-sequences-rows-source="${source}"`;
  const text = escapeRowLabel(label ?? `${NEUTRAL_ROW_NOUN[kind ?? ""] ?? "Item"} ${index}`);
  if (kind === "kanban") return `<div class="cmp-card material"${mark}>${text}</div>`;
  if (kind === "chat") return `<div class="cmp-msg"${mark}>${text}</div>`;
  if (kind === "table") {
    return `<div class="cmp-row"${mark}><span>${text}</span><span class="cmp-chip">ok</span></div>`;
  }
  return `<div class="cmp-item"${mark}>${text}</div>`;
}

/**
 * Locate the SOLE component root carrying `data-part`=`component` and return
 * the span of its inner content. The shared spine of every host-side kit
 * top-up: exactly one candidate root (ambiguity stays a finding), a
 * depth-balanced close scan so nested same-tag children don't fool it, and a
 * self-closing or unbalanced root falls through (contentEnd stays -1). Returns
 * null when the target is absent, duplicated, or unbalanced — the finding stays
 * for the gate.
 */
function locateSoleComponentContent(
  html: string,
  component: string,
): { contentEnd: number; content: string } | null {
  const openPattern = new RegExp(
    `<([a-z][\\w-]*)\\b[^>]*\\bdata-part\\s*=\\s*(["'])${regexpEscape(component)}\\2[^>]*>`,
    "gi",
  );
  const opens = [...html.matchAll(openPattern)];
  if (opens.length !== 1) return null;
  const open = opens[0]!;
  const tag = open[1]!.toLowerCase();
  const contentStart = (open.index ?? 0) + open[0].length;
  const walker = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
  walker.lastIndex = contentStart;
  let depth = 1;
  let contentEnd = -1;
  for (let step = walker.exec(html); step; step = walker.exec(html)) {
    if (step[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        contentEnd = step.index;
        break;
      }
    } else if (!/\/>$/.test(step[0])) {
      depth += 1;
    }
  }
  if (contentEnd < 0) return null;
  return { contentEnd, content: html.slice(contentStart, contentEnd) };
}

/**
 * The shared body of every host-side kit top-up: for each candidate component
 * id, locate its sole root and hand the inner content to `build`. Whatever
 * markup `build` returns is injected just before the root's close tag; `build`
 * returns null to decline (the target is already complete, or ambiguous /
 * content-bearing — the finding stays for markup-audit). Injecting for one
 * component re-scans the mutated html for the next, so indices never drift.
 */
function injectIntoComponentRoots(
  html: string,
  components: Iterable<string>,
  build: (component: string, content: string) => string | null,
): { html: string; repaired: string[] } {
  const repaired: string[] = [];
  for (const component of components) {
    const located = locateSoleComponentContent(html, component);
    if (!located) continue;
    const markup = build(component, located.content);
    if (markup == null) continue;
    html = `${html.slice(0, located.contentEnd)}${markup}${html.slice(located.contentEnd)}`;
    repaired.push(component);
  }
  return { html, repaired };
}

interface SceneComponentBinding {
  sceneId: string;
  component: string;
}

/**
 * Scene-scoped counterpart to `injectIntoComponentRoots`. Continuity contracts
 * intentionally reuse one component id in consecutive scenes, so global
 * uniqueness is the wrong safety boundary for those roots. Recompute scene
 * locations after every injection, require exactly one root inside the named
 * scene, and retain the old fragment behavior only when the input has no scene
 * wrappers at all. A duplicated root inside one scene remains ambiguous.
 */
function injectIntoSceneComponentRoots<T extends SceneComponentBinding>(
  html: string,
  bindings: Iterable<T>,
  build: (binding: T, content: string) => string | null,
): { html: string; repaired: string[] } {
  const repaired: string[] = [];
  const unique = [...new Map([...bindings].map((binding) => [
    `${binding.sceneId}\u0000${binding.component}`,
    binding,
  ])).values()];
  for (const binding of unique) {
    const scenes = sceneScopeLocations(html);
    const matchingScenes = scenes.filter((scene) => scene.id === binding.sceneId);
    const scope = matchingScenes.length === 1
      ? {
          start: matchingScenes[0]!.openStart,
          html: html.slice(matchingScenes[0]!.openStart, matchingScenes[0]!.closeEnd),
        }
      : scenes.length === 0
        ? { start: 0, html }
        : undefined;
    if (!scope) continue;
    const located = locateSoleComponentContent(scope.html, binding.component);
    if (!located) continue;
    const markup = build(binding, located.content);
    if (markup == null) continue;
    const contentEnd = scope.start + located.contentEnd;
    html = `${html.slice(0, contentEnd)}${markup}${html.slice(contentEnd)}`;
    repaired.push(binding.component);
  }
  return { html, repaired };
}

/**
 * Deterministic rows-markup top-up (fallback-elimination lever): a `rows`
 * beat whose target root exists but has NO revealable children was the
 * single biggest waster of paid author attempts (3 of 5 recorded live runs)
 * — the runtime's childItems() finds nothing, the bind aborts the compile,
 * and a whole model retry is spent on paperwork the kit owns. Inject three
 * neutral kind-appropriate children host-side instead; the beat reveals
 * them, the author already styled the container. `select` beats have the
 * exact same childItems() bind requirement (live probe codexfix-probe-1:
 * a childless command-palette burned 3 attempts + the rescue rung on
 * `kit_markup_incomplete`) and the runtime clamps `item` into range, so
 * they take the same top-up. Only the mechanically certain case is
 * repaired: exactly one candidate root, zero revealable children anywhere
 * inside it. `kitMarkupAudit` keeps the same check for whatever this pass
 * cannot prove.
 */
export function topUpRowsMarkup(
  html: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  const kindByTarget = new Map<string, string | undefined>();
  const sceneByTarget = new Map<string, DirectScene>();
  for (const scene of scenes) {
    const kinds = new Map((scene.components ?? []).map((entry) => [entry.id, entry.kind]));
    for (const beat of scene.beats ?? []) {
      if (beat.kind === "rows" || beat.kind === "select") {
        kindByTarget.set(beat.component, kinds.get(beat.component));
        sceneByTarget.set(beat.component, scene);
      }
    }
  }
  return injectIntoComponentRoots(html, kindByTarget.keys(), (component, content) => {
    if (REVEALABLE_CHILD_CLASS.test(content)) return null;
    const kind = kindByTarget.get(component);
    const scene = sceneByTarget.get(component);
    const derived = scene ? deriveRowLabels(scene, component, 3) : [];
    const rows = [0, 1, 2].map((i) =>
      rowsChildMarkup(kind, i + 1, derived[i]?.label, derived[i]?.source ?? "neutral"),
    );
    return `\n${rows.join("\n")}\n`;
  });
}

function normalizedMarkupText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&hellip;|&#8230;/gi, "…")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Bind child-oriented chat beats to the one authored child that already owns
 * their exact copy and semantic role. Custom Slack/chat surfaces often keep
 * their own class system instead of the kit's `.cmp-text` / `[data-cmp-stream]`
 * markers. Letting the component runtime fall back to the chat ROOT makes a
 * later `stream` reveal pre-hide the whole product surface at compile time;
 * an earlier cursor then arrives on an invisible target (S6.12 probe A).
 *
 * This is deliberately narrower than a markup synthesizer: only `swap` and
 * `stream` beats on a typed chat root participate, the descendant must carry
 * the beat's exact authored text AND a role-bearing id/part/class token, and
 * exactly one candidate may match. Existing kit markup and ambiguity are left
 * byte-identical for the unchanged hard gate. The repair adds attributes only,
 * so copy, hierarchy, timing, and styling remain authored.
 */
export function reconcileChatBeatTargets(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const roleTokens = {
    swap: new Set(["input", "query", "prompt", "composer", "brief"]),
    stream: new Set(["ai", "assistant", "response", "stream", "output"]),
  } as const;

  for (const scene of scenes) {
    const chatIds = new Set(
      (scene.components ?? [])
        .filter((component) => component.kind === "chat")
        .map((component) => component.id),
    );
    const beats = (scene.beats ?? []).filter((beat) =>
      chatIds.has(beat.component) &&
      (beat.kind === "swap" || beat.kind === "stream") &&
      Boolean(beat.text?.trim())
    );
    for (const beat of beats) {
      const beatKind = beat.kind === "stream" ? "stream" : "swap";
      const scopeMeta = sceneScopeLocations(html).find((entry) => entry.id === scene.id);
      if (!scopeMeta) continue;
      let scope = html.slice(scopeMeta.openStart, scopeMeta.closeEnd);
      const rootPattern = new RegExp(
        `<[a-z][\\w:-]*\\b[^>]*\\bdata-part\\s*=\\s*(["'])${
          regexpEscape(beat.component)
        }\\1[^>]*>`,
        "gi",
      );
      const roots = [...scope.matchAll(rootPattern)];
      if (roots.length !== 1) continue;
      const root = { tag: roots[0]![0], index: roots[0]!.index ?? 0 };
      const bounds = elementBlockBoundsAt(scope, root);
      if (!bounds) continue;
      const body = scope.slice(bounds.contentStart, bounds.contentEnd);
      const alreadyBound = beatKind === "stream"
        ? /\bdata-cmp-stream(?:\s|=|>)|\bclass\s*=\s*(["'])[^"']*\bcmp-ai\b[^"']*\1/i.test(body)
        : /\bdata-cmp-text(?:\s|=|>)|\bclass\s*=\s*(["'])[^"']*\bcmp-text\b[^"']*\1/i.test(body);
      if (alreadyBound) continue;

      const expectedText = normalizedMarkupText(beat.text!);
      const candidates = [...body.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)]
        .map((match) => ({ tag: match[0], index: match.index ?? 0 }))
        .map((entry) => {
          if (/\bdata-sequences-runtime-/i.test(entry.tag)) return { ...entry, score: 0 };
          const content = elementInnerContentAt(body, entry);
          if (content === undefined || normalizedMarkupText(content) !== expectedText) {
            return { ...entry, score: 0 };
          }
          const namedTokens = new Set(semanticPartTokens([
            htmlAttr(entry.tag, "data-part"),
            htmlAttr(entry.tag, "id"),
          ].filter(Boolean).join(" ")));
          const classTokens = new Set(semanticPartTokens(htmlAttr(entry.tag, "class") ?? ""));
          const named = [...roleTokens[beatKind]].some((token) => namedTokens.has(token));
          const classed = [...roleTokens[beatKind]].some((token) => classTokens.has(token));
          return { ...entry, score: named ? 2 : classed ? 1 : 0 };
        })
        .filter((entry) => entry.score > 0);
      const bestScore = Math.max(0, ...candidates.map((entry) => entry.score));
      const best = candidates.filter((entry) => entry.score === bestScore);
      if (best.length !== 1) continue;
      const candidate = best[0]!;
      const attribute = beatKind === "stream" ? "data-cmp-stream" : "data-cmp-text";
      const replacement = ensureTagAttr(candidate.tag, attribute, "1");
      if (replacement === candidate.tag) continue;
      const candidateStart = bounds.contentStart + candidate.index;
      scope = scope.slice(0, candidateStart) + replacement +
        scope.slice(candidateStart + candidate.tag.length);
      html = html.slice(0, scopeMeta.openStart) + scope + html.slice(scopeMeta.closeEnd);
      repairs += 1;
    }
  }
  return { html, repairs };
}

/** The kit `.fx-underline` SVG the MD3 draw effect animates (a trim-path rule). */
const FX_UNDERLINE_MARKUP =
  `<span class="fx-underline" data-sequences-fx="underline" data-layout-ignore aria-hidden="true" ` +
  `style="display:block;height:0.14em;margin-top:0.12em;pointer-events:none">` +
  `<svg viewBox="0 0 100 4" preserveAspectRatio="none" ` +
  `style="display:block;width:100%;height:100%;overflow:visible">` +
  `<line x1="0" y1="2" x2="100" y2="2" stroke="var(--accent,#6ea8ff)" stroke-width="3" ` +
  `stroke-linecap="round"/></svg></span>`;

/**
 * MD3 deterministic underline top-up: a `highlight` beat with style "underline"
 * draws a trim-path rule under its target through the fx runtime's `.fx-underline`
 * SVG. When the author placed no such markup, inject the kit pattern host-side —
 * exactly the rows-style philosophy (a paid attempt must never die on fx
 * paperwork, and the effect is enhancement-only so a stray inject is harmless).
 * Only the mechanically certain case is repaired: exactly one target root with
 * no existing `.fx-underline` inside it.
 */
export function topUpUnderlineMarkup(
  html: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  const targets = new Set<string>();
  for (const scene of scenes) {
    for (const beat of scene.beats ?? []) {
      // Item-scoped underlines are synthesized against the measured child by
      // sequences-fx. Injecting into the component root would leave a visible
      // line under the entire list and recreate the targeting bug.
      if (
        beat.kind === "highlight" && beat.style === "underline" &&
        beat.item === undefined
      ) {
        targets.add(beat.component);
      }
    }
  }
  return injectIntoComponentRoots(html, targets, (_component, content) =>
    /\bclass\s*=\s*(["'])[^"']*\bfx-underline\b/i.test(content) ? null : FX_UNDERLINE_MARKUP,
  );
}

/** An svg stroke the chart runtime draws on (`svg polyline, svg path`). */
const CHART_STROKE_MARKUP = /<(?:polyline|path)\b/i;
/**
 * Any `<i>` element already inside a root. childItems() treats a DIRECT `<i>`
 * as a bar/fill, so a stray nested `<i>` icon makes the target ambiguous — we
 * decline and leave the finding rather than double-inject or mis-bind an icon.
 */
const ANY_ITALIC = /<i[\s/>]/i;

/** The kit's neutral bar set (direct `<i>`, revealed scaleY) for a bars/generic chart. */
const NEUTRAL_CHART_BARS =
  `<i style="height:42%" data-sequences-neutral="chart"></i>` +
  `<i style="height:63%" data-sequences-neutral="chart"></i>` +
  `<i style="height:84%" data-sequences-neutral="chart"></i>` +
  `<i class="cmp-hero" style="height:100%" data-sequences-neutral="chart"></i>`;
/** The kit's neutral line stroke (an svg polyline the runtime draws on) for a line chart. */
const NEUTRAL_CHART_LINE =
  `<svg viewBox="0 0 400 160" preserveAspectRatio="none" data-sequences-neutral="chart">` +
  `<polyline class="cmp-stroke" points="0,140 80,120 160,124 240,70 320,52 400,18"/></svg>`;

/**
 * Deterministic chart-markup top-up — the `kit_markup_incomplete` absorption
 * for the top static-rejection class (64 historical). A `chart` beat whose sole
 * target root has NEITHER an svg stroke NOR bar children aborts the component
 * compile, exactly the mechanical bind gap topUpRowsMarkup fixes, and the kit
 * exemplar (componentContract.ts) defines the required structure precisely:
 * chart-bars = direct `<i>` bars, chart-line = an svg polyline. Inject that
 * host-side so a paid attempt never dies on it. The bar heights / stroke points
 * are host-invented placeholder SHAPE (`data-sequences-neutral="chart"`), so a
 * shipped placeholder records the `chart-neutral-bars-shipped` degradation and
 * a salvaged film is never reported clean. Only the mechanically certain case
 * is repaired: exactly one root with no stroke, no revealable children, and no
 * stray `<i>` — anything content-bearing stays the markup-audit finding.
 */
export function topUpChartMarkup(
  html: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  const kindByTarget = new Map<string, string | undefined>();
  for (const scene of scenes) {
    const kinds = new Map((scene.components ?? []).map((entry) => [entry.id, entry.kind]));
    for (const beat of scene.beats ?? []) {
      if (beat.kind === "chart") kindByTarget.set(beat.component, kinds.get(beat.component));
    }
  }
  return injectIntoComponentRoots(html, kindByTarget.keys(), (component, content) => {
    if (
      CHART_STROKE_MARKUP.test(content) ||
      REVEALABLE_CHILD_CLASS.test(content) ||
      ANY_ITALIC.test(content)
    ) {
      return null;
    }
    return /line/i.test(kindByTarget.get(component) ?? "") ? NEUTRAL_CHART_LINE : NEUTRAL_CHART_BARS;
  });
}

/** The kit's neutral horizontal-bar fill (scaleX) — `<i data-cmp-fill>`. */
const NEUTRAL_PROGRESS_FILL = `<i data-cmp-fill data-sequences-neutral="progress"></i>`;
/** The kit's neutral ring track + fg arc (strokeDashoffset), for a progress-ring. */
const NEUTRAL_PROGRESS_RING =
  `<svg viewBox="0 0 120 120" data-sequences-neutral="progress">` +
  `<circle class="cmp-ring-bg" cx="60" cy="60" r="52"/>` +
  `<circle class="cmp-ring-fg" cx="60" cy="60" r="52"/></svg>`;
/** Progress bind evidence the runtime animates: a ring fg arc or a bar fill. */
const PROGRESS_FILL_MARKUP = /\b(?:cmp-ring-fg|data-cmp-fill)\b/i;

/**
 * Deterministic progress-markup top-up (kit_markup_incomplete absorption): a
 * `progress` beat whose sole scene-scoped target root has no `.cmp-ring-fg`,
 * `[data-cmp-fill]`, or direct `<i>` fill aborts the compile. The kit exemplar
 * defines the structure — a horizontal bar wants one `<i data-cmp-fill>`, a
 * ring wants an svg arc — so inject it host-side (neutral, recorded on ship via
 * `progress-neutral-fill-shipped`, like the chart top-up). Repeated ids across
 * continuity scenes are independent roots; duplicate roots inside one scene
 * remain ambiguous. A ring is completed
 * ONLY when the root has no `<svg>` at all: a partial svg (a background track
 * but no fg arc) is ambiguous and stays a finding for markup-audit.
 */
export function topUpProgressMarkup(
  html: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  const bindings: Array<SceneComponentBinding & { kind?: string }> = [];
  for (const scene of scenes) {
    const kinds = new Map((scene.components ?? []).map((entry) => [entry.id, entry.kind]));
    for (const beat of scene.beats ?? []) {
      if (beat.kind === "progress") {
        bindings.push({
          sceneId: scene.id,
          component: beat.component,
          kind: kinds.get(beat.component),
        });
      }
    }
  }
  return injectIntoSceneComponentRoots(html, bindings, (binding, content) => {
    if (PROGRESS_FILL_MARKUP.test(content) || ANY_ITALIC.test(content)) return null;
    if (/ring/i.test(binding.kind ?? "")) {
      return /<svg\b/i.test(content) ? null : NEUTRAL_PROGRESS_RING;
    }
    return NEUTRAL_PROGRESS_FILL;
  });
}

function normalizeJsonIsland(
  source: string,
  id: string,
  payload: string,
): { html: string; repairs: number; found: boolean } {
  const pattern = new RegExp(
    `(<script\\b[^>]*\\bid\\s*=\\s*(["'])${regexpEscape(id)}\\2[^>]*>)([\\s\\S]*?)(<\\/script>)`,
    "gi",
  );
  let found = false;
  let repairs = 0;
  const html = source.replace(pattern, (match, open: string, _quote: string, body: string, close: string) => {
    if (!found) {
      found = true;
      // Stamp the host marker even when the payload already matches: from here
      // on this island's content is host truth, and a later repair pass must
      // not count re-stripping it as a model-authored island.
      const hostOpen = ensureTagAttr(open, "data-sequences-host", "1");
      if (body === payload && hostOpen === open) return match;
      if (body !== payload) repairs += 1;
      return `${hostOpen}${payload}${close}`;
    }
    repairs += 1;
    return "";
  });
  return { html, repairs, found };
}

function removeJsonIsland(
  source: string,
  id: string,
): { html: string; removed: number; removedModel: number } {
  let removed = 0;
  let removedModel = 0;
  const pattern = new RegExp(
    `\\n?[ \\t]*<script\\b[^>]*\\bid\\s*=\\s*(["'])${regexpEscape(id)}\\1[^>]*>[\\s\\S]*?<\\/script>`,
    "gi",
  );
  const html = source.replace(pattern, (match) => {
    removed += 1;
    // Islands the host injected/canonicalized carry data-sequences-host; a
    // repair pass re-stripping them is routine plumbing, not a model fault.
    if (!/\bdata-sequences-host\s*=\s*["']1["']/i.test(match)) removedModel += 1;
    return "";
  });
  return { html, removed, removedModel };
}

/**
 * Host-owned JSON islands are executable contracts, not author notes. When the
 * locked storyboard has no resolved plan for one of those runtimes, any island
 * the model wrote is stale or hallucinated and can only hurt: static validation
 * parses it, and browser compile would try to bind it. Remove it instead of
 * spending a repair attempt on making an unused plan syntactically valid.
 */
export function stripUnusedHostPlanIslands(
  source: string,
  scenes: DirectScene[],
): { html: string; removed: string[] } {
  let html = source;
  const removed: string[] = [];
  const interactions = scenes.flatMap((scene) => scene.interactions ?? []);
  if (interactions.length === 0) {
    const result = removeJsonIsland(html, "sequences-interactions");
    html = result.html;
    for (let index = 0; index < result.removed; index += 1) removed.push("sequences-interactions");
  }
  if (resolveCameraPlan(scenes).scenes.length === 0) {
    const result = removeJsonIsland(html, "sequences-camera");
    html = result.html;
    for (let index = 0; index < result.removed; index += 1) removed.push("sequences-camera");
  }
  if (resolveComponentPlan(scenes).scenes.length === 0) {
    const result = removeJsonIsland(html, "sequences-components");
    html = result.html;
    for (let index = 0; index < result.removed; index += 1) removed.push("sequences-components");
  }
  return { html, removed };
}

/** Every host-owned JSON island id. These are executable contracts injected
 * deterministically from the locked storyboard — never author notes. */
export const HOST_PLAN_ISLAND_IDS = [
  "sequences-interactions",
  "sequences-cuts",
  "sequences-camera",
  "sequences-components",
  "sequences-time",
  "sequences-fx",
  "sequences-assets",
  ENVIRONMENT_PLAN_ID,
] as const;

/**
 * Sentinel L1 (SENTINEL.md): host plan islands are host-owned,
 * always. `stripUnusedHostPlanIslands` only removed islands with NO matching
 * plan, so a model-authored island that *shadows* a real plan survived until
 * validation (the 2026-07-05 `sequences-interactions.version must be 1` /
 * `sequences-camera.scenes must be an array` incident). This removes EVERY
 * host island unconditionally; the per-plan injection that follows re-emits the
 * canonical island from the locked storyboard, so nothing the model hand-wrote
 * about an island can ever reach validation. Idempotent for a document with no
 * author islands (the post-prompt-deletion steady state — removed stays empty).
 */
export function stripAllHostPlanIslands(
  source: string,
): { html: string; removed: string[]; removedModel: string[] } {
  let html = source;
  const removed: string[] = [];
  // Only islands WITHOUT the host marker — the ones the model actually
  // hand-wrote. Host-injected islands from an earlier repair pass are
  // re-stripped as routine plumbing and must not inflate the L2 telemetry.
  const removedModel: string[] = [];
  for (const id of HOST_PLAN_ISLAND_IDS) {
    const result = removeJsonIsland(html, id);
    html = result.html;
    for (let index = 0; index < result.removed; index += 1) removed.push(id);
    for (let index = 0; index < result.removedModel; index += 1) removedModel.push(id);
  }
  return { html, removed, removedModel };
}

function ensureTagAttr(tag: string, name: string, value: string): string {
  const escaped = regexpEscape(name);
  const pattern = new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i");
  if (pattern.test(tag)) {
    return tag.replace(pattern, `${name}="${value}"`);
  }
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

// The intersection of the storyboard schema's `frameAnchor` enum and the
// anchors the layout QA's data-layout-anchor audit understands. The schema's
// corner anchors (frame:top-left/…) have no QA equivalent and are deliberately
// NOT forwarded — the focal part still gets data-layout-important, which
// satisfies layout_intent_missing without minting layout_anchor_invalid.
const SUPPORTED_LAYOUT_ANCHORS = new Set([
  "frame:center",
  "frame:left-third",
  "frame:right-third",
]);

/**
 * Tolerance (px) for a HOST-injected data-layout-anchor. The audit's 12px
 * default assumes the author placed the element while declaring the intent;
 * here the host forwards storyboard intent onto placement the author made
 * without knowing an anchor audit would run, so a repair meant to satisfy
 * layout_intent_missing must not mint layout_anchor_mismatch on a hand-placed
 * hero that honors the intent loosely.
 */
const INJECTED_ANCHOR_TOLERANCE = "48";

function hasDeclaredLayoutIntent(scope: string): boolean {
  return /\bdata-layout-(?:important|anchor|align|attach|gap)\b/i.test(scope);
}

function addLayoutAttrsToFirstTag(
  scope: string,
  pattern: RegExp,
  attrs: Record<string, string>,
): { scope: string; changed: boolean } {
  const match = pattern.exec(scope);
  if (!match?.[0] || match.index === undefined) return { scope, changed: false };
  let tag = match[0];
  for (const [name, value] of Object.entries(attrs)) {
    tag = ensureTagAttr(tag, name, value);
  }
  if (tag === match[0]) return { scope, changed: false };
  return {
    scope: scope.slice(0, match.index) + tag + scope.slice(match.index + match[0].length),
    changed: true,
  };
}

export function injectLayoutIntentHints(
  source: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  let html = source;
  const repaired: string[] = [];
  for (const scene of scenes) {
    const scopeMeta = sceneScopeLocations(html).find((entry) => entry.id === scene.id);
    if (!scopeMeta) continue;
    let scope = html.slice(scopeMeta.openStart, scopeMeta.closeEnd);
    if (hasDeclaredLayoutIntent(scope)) continue;

    let nextScope = scope;
    let changed = false;
    const anchor = scene.spatialIntent?.frameAnchor &&
        SUPPORTED_LAYOUT_ANCHORS.has(scene.spatialIntent.frameAnchor)
      ? scene.spatialIntent.frameAnchor
      : undefined;
    if (scene.spatialIntent?.focalPart) {
      const focalPattern = new RegExp(
        `<[a-z][\\w:-]*\\b[^>]*\\bdata-part\\s*=\\s*(["'])${
          regexpEscape(scene.spatialIntent.focalPart)
        }\\1[^>]*>`,
        "i",
      );
      const result = addLayoutAttrsToFirstTag(nextScope, focalPattern, {
        "data-layout-important": "1",
        ...(anchor
          ? {
              "data-layout-anchor": anchor,
              "data-layout-tolerance": INJECTED_ANCHOR_TOLERANCE,
            }
          : {}),
      });
      nextScope = result.scope;
      changed = result.changed;
    }
    if (!changed && scene.spatialIntent) {
      const sceneOpenPattern =
        /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/i;
      const result = addLayoutAttrsToFirstTag(nextScope, sceneOpenPattern, {
        "data-layout-anchor": anchor ?? "frame:center",
        "data-layout-tolerance": INJECTED_ANCHOR_TOLERANCE,
      });
      nextScope = result.scope;
      changed = result.changed;
    }
    if (!changed) {
      const knownLayoutPattern =
        /<[a-z][\w:-]*\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\b(?:zone|panel|card|hero|stack|grid|cluster|lockup|metric|surface|frame)\b[^"']*\1)(?![^>]*\bdata-scene\s*=)[^>]*>/i;
      const result = addLayoutAttrsToFirstTag(nextScope, knownLayoutPattern, {
        "data-layout-important": "1",
      });
      nextScope = result.scope;
      changed = result.changed;
    }
    if (!changed) continue;
    html = html.slice(0, scopeMeta.openStart) + nextScope + html.slice(scopeMeta.closeEnd);
    repaired.push(scene.id);
  }
  return { html, repaired };
}

/**
 * Retire a free-floating, canvas-scale diagonal "hairline" without removing
 * the element that the locked camera/continuity contracts may still target.
 *
 * Probe S6.12-B exposed the narrow failure shape: an authored SVG covered the
 * whole 1920x1080 world, contained one M/L path spanning most of both axes,
 * and painted above the actual SaaS surfaces. At playback it read as a random
 * blue slash through the commercial. The trace is decorative, but deleting or
 * hiding its target element would turn the existing camera phrase into a new
 * hard visibility failure. Suppressing only the path paint preserves contract
 * geometry and timing while removing the judge-visible residue.
 *
 * The repair is deliberately bounded to non-host, non-component hairlines
 * with a simple two-point path. Charts, host connectors, horizontal rules,
 * short accents, and compound illustrations remain byte-identical.
 */
export function retireOversizedDiagonalHairlines(
  source: string,
): { html: string; repairs: number } {
  let repairs = 0;
  const html = source.replace(
    /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
    (svg) => {
      const open = svg.match(/^<svg\b[^>]*>/i)?.[0];
      if (!open) return svg;
      if (
        /\bdata-sequences-(?:host|retired-diagonal-hairline)\b/i.test(open) ||
        /\bdata-component\b/i.test(open)
      ) {
        return svg;
      }
      const part = htmlAttr(open, "data-part") ?? "";
      const className = htmlAttr(open, "class") ?? "";
      if (!/(?:^|[-_\s])hairline(?:$|[-_\s])/i.test(`${part} ${className}`)) {
        return svg;
      }
      const viewBox = (htmlAttr(open, "viewBox") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        viewBox.length !== 4 ||
        viewBox.some((value) => !Number.isFinite(value)) ||
        viewBox[2]! < 640 ||
        viewBox[3]! < 360
      ) {
        return svg;
      }
      const paths = [...svg.matchAll(/<path\b[^>]*>/gi)];
      if (paths.length !== 1) return svg;
      const pathTag = paths[0]![0];
      const d = htmlAttr(pathTag, "d")?.trim();
      const line = d?.match(
        /^M\s*(-?(?:\d+(?:\.\d+)?|\.\d+))[\s,]+(-?(?:\d+(?:\.\d+)?|\.\d+))\s*L\s*(-?(?:\d+(?:\.\d+)?|\.\d+))[\s,]+(-?(?:\d+(?:\.\d+)?|\.\d+))\s*$/i,
      );
      if (!line) return svg;
      const x1 = Number(line[1]);
      const y1 = Number(line[2]);
      const x2 = Number(line[3]);
      const y2 = Number(line[4]);
      const width = viewBox[2]!;
      const height = viewBox[3]!;
      if (Math.abs(x2 - x1) < width * 0.5 || Math.abs(y2 - y1) < height * 0.25) {
        return svg;
      }

      let retiredOpen = ensureTagAttr(open, "data-sequences-retired-diagonal-hairline", "1");
      let retiredPath = ensureTagAttr(pathTag, "data-sequences-retired-diagonal-hairline-path", "1");
      const style = htmlAttr(retiredPath, "style");
      retiredPath = ensureTagAttr(
        retiredPath,
        "style",
        `${style ? `${style.replace(/;?\s*$/, ";")}` : ""}stroke-opacity:0!important`,
      );
      repairs += 1;
      return svg.replace(open, retiredOpen).replace(pathTag, retiredPath);
    },
  );
  return { html, repairs };
}

/**
 * Bind a declared component whose `data-part` element is entirely missing from
 * the scene to the one unambiguous, still-unlabeled candidate the author left
 * behind — an element carrying this component's kind, an exact id match, or a
 * unique semantic-name match. This mirrors the cut/camera/interaction target
 * reconciler (exact / unique-candidate, ambiguity stays blocking): a dense
 * component brief where the model built the surface but forgot or mis-named its
 * `data-part` no longer sinks the whole run at `source-author`. A lone
 * kind-marked element whose `data-part` is a non-component alias can be claimed;
 * correctly-bound sibling components are never hijacked. Absent any safe
 * candidate the component stays unbound and the author re-authors honestly.
 */
function bindMissingComponentElement(
  scope: string,
  component: NonNullable<DirectScene["components"]>[number],
  sceneComponents: NonNullable<DirectScene["components"]>,
): { html: string; repairs: number } {
  const claimed = new Set(
    sceneComponents.filter((entry) => entry.id !== component.id).map((entry) => entry.id),
  );
  const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)]
    .map((match) => ({
      tag: match[0],
      id: htmlAttr(match[0], "id"),
      part: htmlAttr(match[0], "data-part"),
      kind: htmlAttr(match[0], "data-component"),
      index: match.index,
    }))
    .filter((entry) =>
      !entry.tag.includes("data-sequences-runtime-") &&
      !htmlAttr(entry.tag, "data-scene") &&
      // A non-component alias can move inside this root; another declared
      // component's part/id cannot.
      !(entry.part && claimed.has(entry.part)) &&
      !(entry.id && claimed.has(entry.id))
    );
  const pickUnique = <T,>(list: T[]): T | undefined => (list.length === 1 ? list[0] : undefined);
  // 1) the author put the intended name on `id` instead of data-part;
  // 2) a lone element already declaring this component's kind;
  // 3) a unique high-confidence semantic name match.
  let candidate = pickUnique(tags.filter((entry) => entry.id === component.id));
  if (!candidate) candidate = pickUnique(tags.filter((entry) => entry.kind === component.kind));
  if (!candidate) {
    const scored = tags
      .filter((entry) => entry.id || entry.kind)
      .map((entry) => ({
        entry,
        score: Math.max(
          entry.id ? semanticPartScore(component.id, entry.id) : 0,
          entry.kind === component.kind ? 1 : 0,
        ),
      }))
      .filter((entry) => entry.score >= 0.8)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 1 || (scored[0] && scored[0].score > (scored[1]?.score ?? 0))) {
      candidate = scored[0]?.entry;
    }
  }
  if (!candidate) return { html: scope, repairs: 0 };
  let replacement = ensureTagAttr(candidate.tag, "data-part", component.id);
  replacement = ensureTagAttr(replacement, "data-component", component.kind);
  if (
    component.region &&
    !new RegExp(`\\bdata-region\\s*=\\s*(["'])${regexpEscape(component.region)}\\1`, "i").test(scope)
  ) {
    replacement = ensureTagAttr(replacement, "data-region", component.region);
  }
  if (replacement === candidate.tag) return { html: scope, repairs: 0 };
  const html = scope.slice(0, candidate.index) + replacement +
    scope.slice(candidate.index + candidate.tag.length);
  return { html, repairs: 1 };
}

function elementInnerContentAt(
  html: string,
  opening: { tag: string; index: number },
): string | undefined {
  const name = opening.tag.match(/^<([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase();
  if (!name || /\/>$/.test(opening.tag)) return undefined;
  const contentStart = opening.index + opening.tag.length;
  const walker = new RegExp(`<${regexpEscape(name)}\\b[^>]*>|</${regexpEscape(name)}\\s*>`, "gi");
  walker.lastIndex = contentStart;
  let depth = 1;
  for (let step = walker.exec(html); step; step = walker.exec(html)) {
    if (step[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(contentStart, step.index);
    } else if (!/\/>$/.test(step[0])) {
      depth += 1;
    }
  }
  return undefined;
}

function elementBlockBoundsAt(
  html: string,
  opening: { tag: string; index: number },
): { start: number; contentStart: number; contentEnd: number; end: number } | undefined {
  const name = opening.tag.match(/^<([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase();
  if (!name || /\/>$/.test(opening.tag)) return undefined;
  const contentStart = opening.index + opening.tag.length;
  const walker = new RegExp(`<${regexpEscape(name)}\\b[^>]*>|</${regexpEscape(name)}\\s*>`, "gi");
  walker.lastIndex = contentStart;
  let depth = 1;
  for (let step = walker.exec(html); step; step = walker.exec(html)) {
    if (step[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return {
          start: opening.index,
          contentStart,
          contentEnd: step.index,
          end: step.index + step[0].length,
        };
      }
    } else if (!/\/>$/.test(step[0])) {
      depth += 1;
    }
  }
  return undefined;
}

/**
 * Some dense authored surfaces contain the real metric plus a hidden kit
 * placeholder carrying the storyboard binding. In that state a count beat
 * technically binds but animates invisible DOM while the number on screen
 * stays frozen. Transfer only the narrow, high-confidence stat-card case: one
 * hidden exact binding and one visible stat/metric root that owns a cmp value.
 */
function rebindHiddenStatComponent(
  scope: string,
  component: NonNullable<DirectScene["components"]>[number],
): { html: string; repairs: number } {
  if (component.kind !== "stat-card") return { html: scope, repairs: 0 };
  const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].map((match) => ({
    tag: match[0],
    index: match.index,
  }));
  const exact = tags.filter((entry) => htmlAttr(entry.tag, "data-part") === component.id);
  if (exact.length !== 1) return { html: scope, repairs: 0 };
  const hidden = exact[0]!;
  const hiddenStyle = htmlAttr(hidden.tag, "style") ?? "";
  if (!/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(hiddenStyle)) {
    return { html: scope, repairs: 0 };
  }

  const candidates = tags.filter((entry) => {
    if (entry.index === hidden.index || htmlAttr(entry.tag, "data-part")) return false;
    const className = htmlAttr(entry.tag, "class") ?? "";
    if (!/(?:^|\s)[^\s]*(?:stat|metric|kpi)[^\s]*(?:\s|$)/i.test(className)) return false;
    if (!/(?:^|[-_\s])(?:card|dock|panel|metric|kpi)(?:$|[-_\s])/i.test(className)) return false;
    const style = htmlAttr(entry.tag, "style") ?? "";
    if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(style)) return false;
    return /\bdata-cmp-value\b/i.test(elementInnerContentAt(scope, entry) ?? "");
  });
  if (candidates.length !== 1) return { html: scope, repairs: 0 };

  const candidate = candidates[0]!;
  let visibleTag = ensureTagAttr(candidate.tag, "data-part", component.id);
  visibleTag = ensureTagAttr(visibleTag, "data-component", component.kind);
  const hiddenTag = ensureTagAttr(
    hidden.tag,
    "data-part",
    `${component.id}-hidden-aux-1`,
  );
  // Replace from right to left so the original match indices stay valid.
  const replacements = [
    { index: hidden.index, before: hidden.tag, after: hiddenTag },
    { index: candidate.index, before: candidate.tag, after: visibleTag },
  ].sort((a, b) => b.index - a.index);
  let html = scope;
  for (const replacement of replacements) {
    html = html.slice(0, replacement.index) + replacement.after +
      html.slice(replacement.index + replacement.before.length);
  }
  return { html, repairs: 1 };
}

type HiddenItemRebindResult = {
  html: string;
  repairs: number;
  selectorRename?: { from: string; to: string };
};

function hiddenByInlineStyle(tag: string): boolean {
  const style = htmlAttr(tag, "style") ?? "";
  return (
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(style) ||
    /\shidden(?:\s|=|>)/i.test(tag)
  );
}

/**
 * A dense table can contain the actual story row while the slot scaffold's
 * separately declared focal component survives as an empty hidden placeholder.
 * That makes camera blocking and component evidence bind to invisible DOM even
 * though interaction + highlight both identify one exact visible item.
 *
 * Rebind only when the hidden component is the focal part, all item-bearing
 * evidence agrees on one parent/item, and that visible item is not another
 * declared component. The old authored part name is retained as an alias.
 */
function rebindHiddenFocalItemComponent(
  scope: string,
  scene: DirectScene,
  component: NonNullable<DirectScene["components"]>[number],
): HiddenItemRebindResult {
  if (scene.spatialIntent?.focalPart !== component.id) {
    return { html: scope, repairs: 0 };
  }
  const openings = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].map((match) => ({
    tag: match[0],
    index: match.index,
  }));
  const exact = openings.filter((entry) => htmlAttr(entry.tag, "data-part") === component.id);
  if (exact.length !== 1) return { html: scope, repairs: 0 };
  const hidden = exact[0]!;
  if (!hiddenByInlineStyle(hidden.tag)) return { html: scope, repairs: 0 };
  const hiddenContent = elementInnerContentAt(scope, hidden);
  if (hiddenContent === undefined || hiddenContent.replace(/<[^>]*>|\s|&nbsp;/gi, "")) {
    return { html: scope, repairs: 0 };
  }

  const declaredIds = new Set((scene.components ?? []).map((entry) => entry.id));
  const itemOwners = new Map<string, { parent: string; item: number }>();
  const addOwner = (parent: string | undefined, item: number | undefined): void => {
    if (
      !parent || parent === component.id || !declaredIds.has(parent) ||
      item === undefined || !Number.isFinite(item)
    ) return;
    const normalized = Math.max(1, Math.round(item));
    itemOwners.set(parent + ":" + normalized, { parent, item: normalized });
  };
  for (const beat of scene.beats ?? []) addOwner(beat.component, beat.item);
  for (const interaction of scene.interactions ?? []) {
    addOwner(interaction.targetPart, interaction.item);
  }
  if (itemOwners.size !== 1) return { html: scope, repairs: 0 };
  const owner = [...itemOwners.values()][0]!;
  const parents = openings.filter((entry) => htmlAttr(entry.tag, "data-part") === owner.parent);
  if (parents.length !== 1 || hiddenByInlineStyle(parents[0]!.tag)) {
    return { html: scope, repairs: 0 };
  }
  const parent = parents[0]!;
  const content = elementInnerContentAt(scope, parent);
  if (content === undefined) return { html: scope, repairs: 0 };
  const childOpenings = [...content.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].map((match) => ({
    tag: match[0],
    index: parent.index + parent.tag.length + (match.index ?? 0),
  }));
  const classHas = (entry: { tag: string }, token: string): boolean =>
    new RegExp("(?:^|\\s)" + regexpEscape(token) + "(?:\\s|$)", "i").test(
      htmlAttr(entry.tag, "class") ?? "",
    );
  const families = [
    childOpenings.filter((entry) => classHas(entry, "cmp-row")),
    childOpenings.filter((entry) => classHas(entry, "cmp-item")),
    childOpenings.filter((entry) => classHas(entry, "cmp-card")),
    childOpenings.filter((entry) => classHas(entry, "cmp-msg")),
    childOpenings.filter((entry) => /\bdata-cmp-item(?:\s|=|>)/i.test(entry.tag)),
    childOpenings.filter((entry) =>
      /(?:^|\s)[a-z][\w-]*-row(?:\s|$)/i.test(htmlAttr(entry.tag, "class") ?? "")
    ),
  ];
  const family = families.find((entries) => entries.length);
  const candidate = family?.[owner.item - 1];
  if (!candidate || hiddenByInlineStyle(candidate.tag)) return { html: scope, repairs: 0 };
  const oldPart = htmlAttr(candidate.tag, "data-part");
  if (oldPart && declaredIds.has(oldPart)) return { html: scope, repairs: 0 };

  let visibleTag = ensureTagAttr(candidate.tag, "data-part", component.id);
  visibleTag = ensureTagAttr(visibleTag, "data-component", component.kind);
  if (oldPart) visibleTag = ensureTagAttr(visibleTag, "data-sequences-part-alias", oldPart);
  for (const attr of ["data-continuity-entity", "data-layout-important"] as const) {
    const value = htmlAttr(hidden.tag, attr);
    if (value !== undefined && htmlAttr(visibleTag, attr) === undefined) {
      visibleTag = ensureTagAttr(visibleTag, attr, value);
    }
  }
  const hiddenTag = ensureTagAttr(
    hidden.tag,
    "data-part",
    component.id + "-hidden-aux-1",
  );
  const replacements = [
    { index: hidden.index, before: hidden.tag, after: hiddenTag },
    { index: candidate.index, before: candidate.tag, after: visibleTag },
  ].sort((a, b) => b.index - a.index);
  let html = scope;
  for (const replacement of replacements) {
    html = html.slice(0, replacement.index) + replacement.after +
      html.slice(replacement.index + replacement.before.length);
  }
  return {
    html,
    repairs: 1,
    ...(oldPart ? { selectorRename: { from: oldPart, to: component.id } } : {}),
  };
}

export function reconcileComponentBindings(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const selectorRenames: Array<{ from: string; to: string }> = [];
  for (const scene of scenes) {
    if (!scene.components?.length) continue;
    const sceneTags = [...html.matchAll(
      /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
    )];
    const sceneIndex = sceneTags.findIndex((match) =>
      htmlAttr(match[0], "data-scene") === scene.id
    );
    if (sceneIndex < 0) continue;
    const scopeStart = sceneTags[sceneIndex]!.index;
    const scopeEnd = sceneTags[sceneIndex + 1]?.index ?? html.length;
    let scope = html.slice(scopeStart, scopeEnd);
    for (const component of scene.components) {
      const focalItem = rebindHiddenFocalItemComponent(scope, scene, component);
      if (focalItem.repairs) {
        scope = focalItem.html;
        repairs += focalItem.repairs;
        if (focalItem.selectorRename) selectorRenames.push(focalItem.selectorRename);
      }
      const rebound = rebindHiddenStatComponent(scope, component);
      if (rebound.repairs) {
        scope = rebound.html;
        repairs += rebound.repairs;
      }
      const tags = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)]
        .map((match) => match[0])
        .filter((tag) => htmlAttr(tag, "data-part") === component.id);
      if (!tags.length) {
        // The declared element is absent: try to bind an unambiguous
        // candidate the author left unlabeled instead of losing the attempt.
        const bound = bindMissingComponentElement(scope, component, scene.components);
        if (bound.repairs) {
          scope = bound.html;
          repairs += bound.repairs;
        }
        continue;
      }
      const canonicalOccurrence = Math.max(
        0,
        tags.findIndex((tag) => htmlAttr(tag, "data-component") === component.kind),
      );
      const needsRegion = Boolean(
        component.region &&
        !new RegExp(
          `\\bdata-region\\s*=\\s*(["'])${regexpEscape(component.region)}\\1`,
          "i",
        ).test(scope),
      );
      let occurrence = 0;
      let duplicate = 0;
      scope = scope.replace(/<[a-z][\w:-]*\b[^>]*>/gi, (tag) => {
        if (htmlAttr(tag, "data-part") !== component.id) return tag;
        const isCanonical = occurrence === canonicalOccurrence;
        occurrence += 1;
        if (isCanonical) {
          let next = ensureTagAttr(tag, "data-component", component.kind);
          if (component.region && needsRegion) {
            next = ensureTagAttr(next, "data-region", component.region);
          }
          if (next !== tag) repairs += 1;
          return next;
        }
        duplicate += 1;
        repairs += 1;
        return ensureTagAttr(tag, "data-part", `${component.id}-aux-${duplicate}`);
      });
    }
    html = html.slice(0, scopeStart) + scope + html.slice(scopeEnd);
  }
  for (const rename of selectorRenames) {
    const selector = new RegExp(
      "(\\[\\s*data-part\\s*=\\s*)([\"'])" +
        regexpEscape(rename.from) + "\\2(\\s*\\])",
      "gi",
    );
    html = html.replace(
      selector,
      (_match, prefix: string, quote: string, suffix: string) =>
        prefix + quote + rename.to + quote + suffix,
    );
  }
  return { html, repairs };
}

/**
 * Put a typed component inside the camera station named by its `region`.
 *
 * Slot scaffolds already nest these correctly, but a source response can move
 * the component into a sibling station while retaining the data-region label.
 * The camera then travels to an empty station and the real CTA/value slides
 * off-frame (MeterlyQC4). Rehome only the mechanically certain shape: one
 * component root and one non-component station in the same scene. Ambiguous or
 * void markup remains untouched for browser QA to report.
 */
export function rehomeRegionComponents(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  for (const scene of scenes) {
    const scoped = [...sceneScopeLocations(html)].find((entry) => entry.id === scene.id);
    if (!scoped) continue;
    let scope = html.slice(scoped.openEnd, scoped.closeStart);
    let changed = false;
    for (const component of scene.components ?? []) {
      if (!component.region || component.pluginUid) continue;
      const openings = (value = scope): Array<{ tag: string; index: number }> =>
        [...value.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)].map((match) => ({
          tag: match[0],
          index: match.index ?? 0,
        }));
      const componentTags = openings().filter((entry) =>
        htmlAttr(entry.tag, "data-part") === component.id
      );
      const stationTags = openings().filter((entry) =>
        htmlAttr(entry.tag, "data-region") === component.region &&
        !htmlAttr(entry.tag, "data-part")
      );
      if (componentTags.length !== 1 || stationTags.length > 1) continue;
      const componentBlock = elementBlockBoundsAt(scope, componentTags[0]!);
      if (!componentBlock) continue;
      const stripChildRegion = (value: string): string => value.replace(
        /\sdata-region\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        "",
      );

      if (stationTags.length === 1) {
        const stationBlock = elementBlockBoundsAt(scope, stationTags[0]!);
        if (!stationBlock) continue;
        if (
          componentBlock.start >= stationBlock.contentStart &&
          componentBlock.end <= stationBlock.contentEnd
        ) {
          if (htmlAttr(componentTags[0]!.tag, "data-region") === component.region) {
            const cleanedTag = stripChildRegion(componentTags[0]!.tag);
            scope = scope.slice(0, componentTags[0]!.index) + cleanedTag +
              scope.slice(componentTags[0]!.index + componentTags[0]!.tag.length);
            repairs += 1;
            changed = true;
          }
          continue;
        }

        const componentHtml = stripChildRegion(
          scope.slice(componentBlock.start, componentBlock.end),
        );
        const candidateScope =
          scope.slice(0, componentBlock.start) + scope.slice(componentBlock.end);
        const refreshedStation = openings(candidateScope).filter((entry) =>
          htmlAttr(entry.tag, "data-region") === component.region &&
          !htmlAttr(entry.tag, "data-part")
        );
        if (refreshedStation.length !== 1) continue;
        const refreshedBlock = elementBlockBoundsAt(candidateScope, refreshedStation[0]!);
        if (!refreshedBlock) continue;
        scope = candidateScope.slice(0, refreshedBlock.contentEnd) + componentHtml +
          candidateScope.slice(refreshedBlock.contentEnd);
        repairs += 1;
        changed = true;
        continue;
      }

      // No station exists because the component itself was labeled as the
      // region. Create the missing camera-world child and make the component a
      // normal child of that station. A unique camera world is required.
      if (htmlAttr(componentTags[0]!.tag, "data-region") !== component.region) continue;
      const componentHtml = stripChildRegion(
        scope.slice(componentBlock.start, componentBlock.end),
      );
      const candidateScope =
        scope.slice(0, componentBlock.start) + scope.slice(componentBlock.end);
      const worlds = openings(candidateScope).filter((entry) =>
        /\bdata-camera-world\b/i.test(entry.tag)
      );
      if (worlds.length !== 1) continue;
      const worldBlock = elementBlockBoundsAt(candidateScope, worlds[0]!);
      if (!worldBlock) continue;
      const station = `<div data-region="${component.region.replace(/["&<>]/g, "")}">` +
        `${componentHtml}</div>`;
      scope = candidateScope.slice(0, worldBlock.contentEnd) + station +
        candidateScope.slice(worldBlock.contentEnd);
      repairs += 1;
      changed = true;
    }
    if (changed) {
      html = html.slice(0, scoped.openEnd) + scope + html.slice(scoped.closeStart);
    }
  }
  return { html, repairs };
}

type InternalPartAlias = {
  className: string;
  markup: (part: string, component: string) => string;
};

function internalPartAliasFor(
  kind: ComponentKind,
  part: string,
): InternalPartAlias | undefined {
  const tokens = new Set(semanticPartTokens(part));
  const namesInput = tokens.has("input") || tokens.has("query") || tokens.has("search");
  if (kind === "command-palette" && namesInput) {
    return {
      className: "cmp-input",
      markup: (alias, component) =>
        `<div class="cmp-input inset-well" data-part="${alias}" ` +
        `data-sequences-part-alias="${component}"><span class="cmp-text"></span></div>`,
    };
  }
  if (kind === "search" && (namesInput || tokens.has("pill"))) {
    return {
      className: "cmp-text",
      markup: (alias, component) =>
        `<span class="cmp-text" data-cmp-text data-part="${alias}" ` +
        `data-sequences-part-alias="${component}"></span>`,
    };
  }
  return undefined;
}

function scenePartBindingsFromContracts(scenes: DirectScene[]): ScenePartBinding[] {
  const bindings: ScenePartBinding[] = [];
  for (const cut of resolveCutPlan(scenes).cuts) {
    if (cut.focalPartOut) bindings.push({ sceneId: cut.fromScene, part: cut.focalPartOut });
    if (cut.focalPartIn) bindings.push({ sceneId: cut.toScene, part: cut.focalPartIn });
  }
  for (const scenePlan of resolveCameraPlan(scenes).scenes) {
    for (const segment of scenePlan.segments) {
      for (const part of [segment.fromPart, segment.toPart, segment.focus?.part]) {
        if (part) bindings.push({ sceneId: scenePlan.sceneId, part });
      }
    }
  }
  return [...new Map(bindings.map((entry) => [`${entry.sceneId}\u0000${entry.part}`, entry])).values()];
}

/**
 * Component roots and bridged cuts sometimes name different layers of the same
 * surface: e.g. `cmd-palette` is the command-palette root for component beats,
 * while `palette-input` is the shape-match focal element inside it. Once the
 * root is bound, materialize a known kit subpart for missing cut/camera aliases
 * instead of renaming the root back and breaking component beats.
 */
export function reconcileComponentInternalPartAliases(
  source: string,
  scenes: DirectScene[],
): { html: string; repairs: number } {
  let html = source;
  let repairs = 0;
  const bindingsByScene = new Map<string, Set<string>>();
  for (const binding of scenePartBindingsFromContracts(scenes)) {
    const set = bindingsByScene.get(binding.sceneId) ?? new Set<string>();
    set.add(binding.part);
    bindingsByScene.set(binding.sceneId, set);
  }
  if (!bindingsByScene.size) return { html, repairs };

  for (const scene of scenes) {
    const desired = bindingsByScene.get(scene.id);
    if (!desired?.size || !scene.components?.length) continue;
    const scopeMeta = sceneScopeLocations(html).find((entry) => entry.id === scene.id);
    if (!scopeMeta) continue;
    let scope = html.slice(scopeMeta.openStart, scopeMeta.closeEnd);
    for (const part of desired) {
      if (new RegExp(`\\bdata-part\\s*=\\s*(["'])${regexpEscape(part)}\\1`, "i").test(scope)) {
        continue;
      }
      const candidates = scene.components.flatMap((component) => {
        if (component.id === part) return [];
        const alias = internalPartAliasFor(component.kind, part);
        if (!alias) return [];
        const rootPattern = new RegExp(
          `<([a-z][\\w:-]*)\\b[^>]*\\bdata-part\\s*=\\s*(["'])${
            regexpEscape(component.id)
          }\\2[^>]*>`,
          "gi",
        );
        const roots = [...scope.matchAll(rootPattern)];
        return roots.length === 1 ? [{ component, alias, root: roots[0]! }] : [];
      });
      if (candidates.length !== 1) continue;
      const { component, alias, root } = candidates[0]!;
      const rootOpen = root.index ?? 0;
      const close = matchingCloseTag(scope, rootOpen, root[0]);
      if (!close) continue;
      const body = scope.slice(close.contentStart, close.closeStart);
      const childPattern = new RegExp(
        `<[a-z][\\w:-]*\\b(?=[^>]*\\bclass\\s*=\\s*(["'])[^"']*\\b${
          regexpEscape(alias.className)
        }\\b[^"']*\\1)[^>]*>`,
        "i",
      );
      const child = childPattern.exec(body);
      if (child && !htmlAttr(child[0], "data-part")) {
        const childStart = close.contentStart + child.index;
        let replacement = ensureTagAttr(child[0], "data-part", part);
        replacement = ensureTagAttr(replacement, "data-sequences-part-alias", component.id);
        scope = scope.slice(0, childStart) + replacement +
          scope.slice(childStart + child[0].length);
        repairs += 1;
      } else {
        scope = scope.slice(0, close.contentStart) +
          `\n${alias.markup(part, component.id)}` +
          scope.slice(close.contentStart);
        repairs += 1;
      }
    }
    html = html.slice(0, scopeMeta.openStart) + scope + html.slice(scopeMeta.closeEnd);
  }
  return { html, repairs };
}

function rootDurationSec(source: string): number | undefined {
  const tag = source.match(/<[^>]+\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/is)?.[0];
  if (!tag) return undefined;
  const parsed = Number(htmlAttr(tag, "data-duration"));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cssCommentSafe(value: string): string {
  // `*/` would close the comment; `<`/`>` could smuggle `</style>` past the
  // HTML parser (a style element ends at the literal tag regardless of CSS
  // comment state); `$` is special in String.replace replacement strings.
  return value.replace(/\*\//g, "* /").replace(/[<>$]/g, "");
}

function safeContrastSelector(selector: string): boolean {
  // Only selectors that identify one host-enriched element are safe to inject.
  // A compact audit label such as `span.cmp-label` can match dozens of nodes
  // and caused a single CTA repair to recolor unrelated labels. Enrichment in
  // layoutInspector emits one of these deliberately small grammars.
  return /^(?:#[A-Za-z_][\w-]*|\[data-scene="[A-Za-z0-9_-]+"\](?: \[data-part="[A-Za-z0-9_-]+"\]|(?: > [a-z][\w-]*:nth-of-type\([1-9]\d*\))+))$/.test(selector);
}

function safeCssColor(value: string | undefined): value is string {
  return typeof value === "string" &&
    /^rgb\(\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\s*,\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\s*,\s*(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\s*\)$/i
      .test(value);
}

export function repairContrastAaIssues(
  draft: DirectCompositionDraft,
  browserQa: DirectBrowserQaResult,
): { draft: DirectCompositionDraft; repaired: string[] } {
  const bySelector = new Map<string, DirectLayoutIssue>();
  for (const issue of browserQa.issues ?? []) {
    const selector = issue.repairSelector ?? issue.selector;
    if (
      issue.code !== "contrast_aa" ||
      !safeContrastSelector(selector) ||
      !safeCssColor(issue.contrast?.suggestedColor)
    ) {
      continue;
    }
    const existing = bySelector.get(selector);
    if (!existing || (issue.contrast?.ratio ?? 999) < (existing.contrast?.ratio ?? 999)) {
      bySelector.set(selector, issue);
    }
  }
  if (!bySelector.size) return { draft, repaired: [] };

  const rules = [...bySelector.entries()].map(([selector, issue]) =>
    `${selector}{color:${issue.contrast!.suggestedColor} !important;}` +
    `/* contrast ${issue.contrast!.ratio}:1 -> ${issue.contrast!.required}:1` +
    `${issue.text ? ` ${cssCommentSafe(issue.text.slice(0, 32))}` : ""} */`
  );
  const contrastStylePattern =
    /<style\b[^>]*\bdata-sequences-contrast-repair\b[^>]*>([\s\S]*?)<\/style>/gi;
  const existingBodies = [...draft.html.matchAll(contrastStylePattern)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  // Contrast discovery is sampled: a later pass can reveal a second low-
  // contrast node after the first has been corrected. Preserve already proven
  // selector-scoped rules and append this pass's exact selectors; replacing
  // the whole block made repairs alternate forever with no penalty decrease.
  const styleBody = [...existingBodies, rules.join("\n")].filter(Boolean).join("\n");
  const style = `<style data-sequences-contrast-repair>\n${styleBody}\n</style>`;
  let html = draft.html.replace(
    /\n?\s*<style\b[^>]*\bdata-sequences-contrast-repair\b[^>]*>[\s\S]*?<\/style>/gi,
    "",
  );
  // Function replacer: the style block carries audited on-screen text, and a
  // string replacement would interpret `$&`/`$'`-style patterns inside it.
  html = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, () => `${style}</head>`)
    : `${style}\n${html}`;
  return html === draft.html
    ? { draft, repaired: [] }
    : { draft: { ...draft, html }, repaired: [...bySelector.keys()] };
}

const WASHOUT_PLATE_BACKGROUND = "rgb(24,32,47)";
const WASHOUT_PLATE_FOREGROUND = "rgb(248,250,252)";

function safeScenePartId(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Give one measured, declared focal a denser value plate when rendered-pixel
 * evidence proves that a high-key field and the focal have collapsed into the
 * same pale band. This is intentionally narrower than a generic taste rewrite:
 * the issue must name an exact scene + part, and that part must be either a
 * typed hero component or the scene's declared spatial focal.
 *
 * The caller re-runs static + browser QA and adopts only when every targeted
 * washout clears, runtime/static diagnostics do not regress, and the global
 * quality penalty strictly decreases. The CSS itself never touches the whole
 * frame, hue basis, layout geometry, or unrelated surfaces.
 */
export function repairCompositionWashoutIssues(
  draft: DirectCompositionDraft,
  browserQa: DirectBrowserQaResult,
): { draft: DirectCompositionDraft; repaired: string[] } {
  const selectors = new Set<string>();
  for (const issue of browserQa.issues ?? []) {
    if (
      issue.code !== "composition_washed_out" ||
      !safeScenePartId(issue.sceneId) ||
      !safeScenePartId(issue.part)
    ) {
      continue;
    }
    const scene = draft.storyboard.find((entry) => entry.id === issue.sceneId);
    if (!scene) continue;
    const component = scene.components?.find((entry) => entry.id === issue.part);
    const declaredFocal = component?.role === "hero" || scene.spatialIntent?.focalPart === issue.part;
    if (!declaredFocal) continue;
    selectors.add(`[data-scene="${issue.sceneId}"] [data-part="${issue.part}"]`);
  }
  if (!selectors.size) return { draft, repaired: [] };

  const washoutStylePattern =
    /<style\b[^>]*\bdata-sequences-washout-repair\b[^>]*>([\s\S]*?)<\/style>/gi;
  const existingBodies = [...draft.html.matchAll(washoutStylePattern)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  const existingBody = existingBodies.join("\n");
  const repaired = [...selectors].filter((selector) => !existingBody.includes(`${selector}{`));
  if (!repaired.length) return { draft, repaired: [] };
  const rules = repaired.map((selector) => [
    `${selector}{background:${WASHOUT_PLATE_BACKGROUND} !important;` +
      `color:${WASHOUT_PLATE_FOREGROUND} !important;` +
      "border-color:rgba(255,255,255,.18) !important;" +
      "box-shadow:0 18px 48px rgba(10,15,26,.22) !important;}",
    `${selector} .cmp-label,${selector} .cmp-value,${selector} .cmp-text{` +
      `color:${WASHOUT_PLATE_FOREGROUND} !important;}`,
  ].join("\n"));
  const styleBody = [...existingBodies, ...rules].filter(Boolean).join("\n");
  const style = `<style data-sequences-washout-repair>\n${styleBody}\n</style>`;
  let html = draft.html.replace(
    /\n?\s*<style\b[^>]*\bdata-sequences-washout-repair\b[^>]*>[\s\S]*?<\/style>/gi,
    "",
  );
  html = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, () => `${style}</head>`)
    : `${style}\n${html}`;
  return { draft: { ...draft, html }, repaired };
}

/** Coverage floor the sparse framing audit enforces (layoutInspector SPARSE_COVERAGE_MIN). */
// Aim above the 18% audit floor. Fitting includes optical breathing room and
// browser geometry is pixel-quantized, so targeting the threshold exactly can
// re-measure at 17.x% and reject an otherwise correct deterministic repair.
// Grid occupancy changes in whole cells, so aim above the 18% gate with
// enough optical headroom that a mathematically exact zoom cannot land one
// cell below the threshold after pixel rounding.
const SPARSE_FRAMING_TARGET_COVERAGE = 0.26;
/** Maps the painted-occupancy floor (5.5%) onto the footprint floor (18%). */
const SPARSE_OCCUPANCY_EQUIVALENT_SCALE = 0.18 / 0.055;
/** Never magnify a sparse landing past the camera contract's own fit multiplier ceiling. */
const SPARSE_FRAMING_ZOOM_MAX = 2.8;
/** A correction must clear the audit's 1.05 zoom-skip threshold to actually take effect. */
const SPARSE_FRAMING_ZOOM_FLOOR = 1.08;
const SPARSE_FRAMING_KEY_SEPARATOR = "\u0000";

/**
 * Choose the camera move a sparse finding should zoom in on. A finding that
 * names a station gets the LAST full move that lands on exactly that station; a
 * scene-level (`[data-scene]`) finding with no station gets the scene's last
 * targeted full move. `-1` means there is no full move; a separately targeted
 * drift may still be promoted by `pickSparseDriftIndex` below.
 */
function pickSparseMoveIndex(
  path: CameraMoveIntentV1[],
  finding: { part?: string; region?: string },
): number {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const move = path[index]!;
    if (!CAMERA_FULL_MOVES.has(move.move)) continue;
    if (finding.part) {
      if (move.toPart === finding.part) return index;
    } else if (finding.region) {
      if (move.toRegion === finding.region) return index;
    } else if (move.toRegion || move.toPart) {
      return index;
    }
  }
  return -1;
}

/** Last targeted connective drift that can become the scene's one measured
 * close-up when a scene-level sparse finding has no full move to adjust. */
function pickSparseDriftIndex(
  path: CameraMoveIntentV1[],
  finding: { part?: string; region?: string },
): number {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const move = path[index]!;
    if (move.move !== "drift") continue;
    if (finding.part) {
      if (move.toPart === finding.part) return index;
    } else if (finding.region) {
      if (move.toRegion === finding.region) return index;
    } else if (move.toPart || move.toRegion) {
      return index;
    }
  }
  return -1;
}

/**
 * Deterministic L2-at-L4 framing correction (the camera analogue of
 * `repairContrastAaIssues`): browser QA measured a camera landing — or a
 * camera-less mid-window — as a tiny subject adrift, so raise its coverage to
 * the audit floor with a bounded zoom-in on exactly the move that frames it.
 * The zoom factor `sqrt(0.22 / fraction)` (clamped 1.0..2.8) magnifies the
 * measured coverage beyond the 18% floor with headroom for optical margin and
 * pixel quantization, without ever cropping past the hard ceiling.
 * Pure: returns the mutated storyboard + the scene ids corrected. The caller
 * re-injects the camera island from the mutated storyboard (the
 * `persistUpgradedStoryboard` seam cut-discovery uses), re-inspects, and adopts
 * the result ONLY when the sparse finding clears, no new `camera_framed_clipped`
 * appears, and the quality penalty strictly decreases (enhancement-never-veto).
 */
export function correctSparseFraming(
  storyboard: DirectScene[],
  browserQa: DirectBrowserQaResult,
): { storyboard: DirectScene[]; corrected: string[]; stationSized: string[] } {
  // Smallest measured coverage per (scene, station) → one bump per framing move.
  const wanted = new Map<string, { fraction: number; part?: string; region?: string }>();
  for (const issue of browserQa.issues ?? []) {
    if (issue.code !== "camera_framed_sparse" || !issue.framing) continue;
    const { sceneId, fraction, occupiedFraction, part, region } = issue.framing;
    const effectiveFraction = Math.min(
      fraction,
      occupiedFraction === undefined
        ? Number.POSITIVE_INFINITY
        : occupiedFraction * SPARSE_OCCUPANCY_EQUIVALENT_SCALE,
    );
    if (!(effectiveFraction > 0)) continue;
    const key = [sceneId, part ?? "", region ?? ""].join(SPARSE_FRAMING_KEY_SEPARATOR);
    const existing = wanted.get(key);
    if (!existing || effectiveFraction < existing.fraction) {
      wanted.set(key, { fraction: effectiveFraction, part, region });
    }
  }
  if (!wanted.size) return { storyboard, corrected: [], stationSized: [] };

  const corrected: string[] = [];
  const stationSized: string[] = [];
  const mutated = storyboard.map((scene) => {
    const findings = [...wanted.entries()]
      .filter(([key]) => key.startsWith(`${scene.id}${SPARSE_FRAMING_KEY_SEPARATOR}`))
      .map(([, value]) => value)
      .sort((a, b) => a.fraction - b.fraction);
    if (!findings.length) return scene;
    // Prefer correcting the world-layout geometry itself when QA names the
    // station. A 1400x800 default cell around a compact declared cluster makes
    // fit zoom faithfully frame mostly void; tightening that station around
    // its measured content union is the WS-A2 L2 repair. The same guarded
    // browser replay below proves the smaller box neither clips nor regresses.
    let nextWorldLayout = scene.worldLayout?.map((entry) => ({ ...entry }));
    let stationChanged = false;
    for (const finding of findings) {
      if (!finding.region || !nextWorldLayout?.length) continue;
      const cell = nextWorldLayout.find((entry) => entry.region === finding.region);
      if (!cell) continue;
      const factor = Math.min(
        Math.max(Math.sqrt(SPARSE_FRAMING_TARGET_COVERAGE / finding.fraction), 1),
        SPARSE_FRAMING_ZOOM_MAX,
      );
      const nextScale = Math.round(
        Math.max(0.55, Math.min(1, (cell.fitScale ?? 1) / factor)) * 1000,
      ) / 1000;
      if (nextScale >= (cell.fitScale ?? 1) - 0.0001) continue;
      cell.fitScale = nextScale;
      stationChanged = true;
      stationSized.push(`${scene.id}/${finding.region}`);
    }
    if (stationChanged) {
      corrected.push(scene.id);
      return { ...scene, worldLayout: nextWorldLayout };
    }
    const path = scene.camera?.path;
    // A camera-less scene has no move to bump, which previously made the
    // browser's static sparse finding unrepairable. The scene already declares
    // its focal subject; add one restrained host framing move around that exact
    // part. The caller still adopts only after full static/browser revalidation
    // proves sparseness cleared without clipping.
    if (!path?.length && scene.spatialIntent?.focalPart) {
      const factor = Math.min(
        Math.max(Math.sqrt(SPARSE_FRAMING_TARGET_COVERAGE / findings[0]!.fraction), 1),
        SPARSE_FRAMING_ZOOM_MAX,
      );
      if (factor <= 1.0001) return scene;
      corrected.push(scene.id);
      return {
        ...scene,
        camera: {
          version: 1 as const,
          path: [{
            version: 1 as const,
            move: "push-in" as const,
            fromPart: scene.spatialIntent.focalPart,
            toPart: scene.spatialIntent.focalPart,
            startSec: scene.startSec,
            durationSec: Math.min(1.8, Math.max(0.8, scene.durationSec * 0.35)),
            // Targeting a part already invokes the camera runtime's content-fit
            // scale. Keep only a subtle additional push; applying the raw
            // coverage factor twice can drive the fitted subject through the
            // safe inset.
            zoom: Math.round(Math.min(factor, 1.08) * 1000) / 1000,
            framingCorrection: "camera-sparse-zoom" as const,
          }],
        },
      };
    }
    if (!path?.length) return scene;
    const nextPath = path.map((move) => ({ ...move }));
    let changed = false;
    for (const finding of findings) {
      let index = pickSparseMoveIndex(nextPath, finding);
      const factor = Math.min(
        Math.max(Math.sqrt(SPARSE_FRAMING_TARGET_COVERAGE / finding.fraction), 1),
        SPARSE_FRAMING_ZOOM_MAX,
      );
      if (factor <= 1.0001) continue;
      if (index < 0) {
        index = pickSparseDriftIndex(nextPath, finding);
        if (index < 0) continue;
        const drift = nextPath[index]!;
        const sceneEnd = scene.startSec + scene.durationSec;
        const durationSec = Math.min(
          drift.durationSec,
          sceneEnd - CAMERA_LANDING_RESERVE_SEC - drift.startSec,
        );
        if (durationSec < 0.35) continue;
        nextPath[index] = {
          ...drift,
          move: "push-in",
          durationSec: Math.round(durationSec * 1000) / 1000,
          zoom: Math.round(
            Math.min(
              Math.max((drift.zoom ?? 1) * factor, SPARSE_FRAMING_ZOOM_FLOOR),
              SPARSE_FRAMING_ZOOM_MAX,
            ) * 1000,
          ) / 1000,
          framingCorrection: "camera-sparse-zoom",
        };
        changed = true;
        continue;
      }
      const move = nextPath[index]!;
      const base = move.zoom ?? 1;
      const nextZoom = Math.round(
        Math.min(
          Math.max(base * factor, SPARSE_FRAMING_ZOOM_FLOOR),
          SPARSE_FRAMING_ZOOM_MAX,
        ) * 1000,
      ) / 1000;
      if (nextZoom <= base + 0.0001) continue;
      move.zoom = nextZoom;
      move.framingCorrection = "camera-sparse-zoom";
      changed = true;
    }
    if (!changed) return scene;
    corrected.push(scene.id);
    return { ...scene, camera: { ...scene.camera!, path: nextPath } };
  });
  return corrected.length
    ? { storyboard: mutated, corrected, stationSized }
    : { storyboard, corrected: [], stationSized: [] };
}

const LAYOUT_REPAIR_TARGET_CODES = new Set(["canvas_overflow", "important_safe_area"]);
const LAYOUT_REPAIR_KEY_SEPARATOR = "\u0000";
const LAYOUT_REPAIR_CANVAS_GUARD_PX = 8;
const LAYOUT_REPAIR_SCALE_FLOOR = 0.86;
/**
 * Full-frame bands get a deeper floor: all three plugin-probe runs shipped a
 * least-bad important_safe_area on a hero band whose fix needed scale
 * 0.80–0.83 — the 0.86 floor refused, and the finding burned paid attempts. A
 * band that still spans ≥70% of the frame after a 0.78 scale reads as
 * intentional composition, not shrinkage.
 */
const LAYOUT_REPAIR_SCALE_FLOOR_BAND = 0.78;
const LOAD_BEARING_CONTAINMENT_SCALE_FLOOR = 0.65;
const LAYOUT_REPAIR_BAND_FRACTION = 0.7;
const LAYOUT_REPAIR_TRANSLATE_CAP_FRACTION = 0.1;
const LOAD_BEARING_CONTAINMENT_TRANSLATE_CAP_FRACTION = 0.4;
const LAYOUT_REPAIR_GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const LAYOUT_REPAIR_GOLDEN_INSET = 1 / (LAYOUT_REPAIR_GOLDEN_RATIO * LAYOUT_REPAIR_GOLDEN_RATIO);

type RepairRect = NonNullable<DirectLayoutIssue["rect"]>;
type RepairOverflow = NonNullable<DirectLayoutIssue["overflow"]>;

interface LayoutOverflowRepairCandidate {
  sceneId: string;
  selector: string;
  issueCode: SceneLayoutRepairV1["issueCode"];
  rect: RepairRect;
  safeRect: RepairRect;
  frameRect: RepairRect;
  part?: string;
  componentRootPart?: string;
  issues: DirectLayoutIssue[];
}

function scenePartKey(sceneId: string, part: string): string {
  return `${sceneId}${LAYOUT_REPAIR_KEY_SEPARATOR}${part}`;
}

export function addressedPartsForLayoutRepair(storyboard: DirectScene[]): Set<string> {
  const addressed = new Set<string>();
  for (const scene of storyboard) {
    for (const move of scene.camera?.path ?? []) {
      for (const part of [move.toPart, move.fromPart, move.focus?.part]) {
        if (part) addressed.add(scenePartKey(scene.id, part));
      }
    }
    if (scene.spatialIntent?.focalPart) {
      addressed.add(scenePartKey(scene.id, scene.spatialIntent.focalPart));
    }
    for (const interaction of scene.interactions ?? []) {
      for (const part of [interaction.targetPart, interaction.ripplePart, interaction.dragTargetPart]) {
        if (part) addressed.add(scenePartKey(scene.id, part));
      }
    }
  }
  for (const cut of resolveCutPlan(storyboard).cuts) {
    if (cut.focalPartOut) addressed.add(scenePartKey(cut.fromScene, cut.focalPartOut));
    if (cut.focalPartIn) addressed.add(scenePartKey(cut.toScene, cut.focalPartIn));
  }
  return addressed;
}

function unionRepairRect(a: RepairRect, b: RepairRect): RepairRect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function intersectRepairRect(a: RepairRect, b: RepairRect): RepairRect | undefined {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return undefined;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function insetRepairRect(rect: RepairRect, inset: number): RepairRect | undefined {
  const left = rect.left + inset;
  const top = rect.top + inset;
  const right = rect.right - inset;
  const bottom = rect.bottom - inset;
  if (right <= left || bottom <= top) return undefined;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function roundRepairNumber(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function safeLayoutRepairSelector(selector: string): boolean {
  if (!selector || selector.length > 360 || /[<{};\n\r]/.test(selector)) return false;
  if (/^#[^\s>+~,[\]"'{};<>]+$/.test(selector)) return true;
  return /^\[data-scene="[^"\\<>]+"\](?: \[data-part="[^"\\<>]+"\]|(?: > [a-z][\w:-]*:nth-of-type\([1-9]\d*\))+)$/
    .test(selector);
}

function unsafeLayoutRepairPartName(value: string | undefined): boolean {
  return Boolean(value && /(?:^|-)(?:cursor|ripple|bridge|runtime|actor)(?:-|$)/i.test(value));
}

function layoutSafeRectForIssue(issue: DirectLayoutIssue): RepairRect | undefined {
  if (issue.code === "important_safe_area") {
    return issue.safeRect ?? issue.containerRect;
  }
  if (issue.code === "canvas_overflow" && issue.containerRect) {
    return insetRepairRect(issue.containerRect, LAYOUT_REPAIR_CANVAS_GUARD_PX);
  }
  return undefined;
}

function layoutRepairOverflowMagnitude(overflow: RepairOverflow | undefined): number {
  return Math.max(overflow?.left ?? 0, overflow?.right ?? 0, overflow?.top ?? 0, overflow?.bottom ?? 0);
}

function chooseAxisCenter(
  currentCenter: number,
  scaledSize: number,
  safeStart: number,
  safeSize: number,
  overflowBefore: boolean,
  overflowAfter: boolean,
): number {
  const minCenter = safeStart + scaledSize / 2;
  const maxCenter = safeStart + safeSize - scaledSize / 2;
  if (maxCenter <= minCenter) return (minCenter + maxCenter) / 2;
  const minimal = Math.min(maxCenter, Math.max(minCenter, currentCenter));
  const slack = maxCenter - minCenter;
  let golden = minimal;
  if (overflowBefore && !overflowAfter) {
    golden = minCenter + slack * LAYOUT_REPAIR_GOLDEN_INSET;
  } else if (overflowAfter && !overflowBefore) {
    golden = maxCenter - slack * LAYOUT_REPAIR_GOLDEN_INSET;
  } else if (overflowBefore && overflowAfter) {
    golden = safeStart + safeSize / 2;
  }
  const goldenDelta = golden - minimal;
  const maxNudge = Math.min(24, slack * 0.08);
  const nudge = Math.min(maxNudge, Math.max(-maxNudge, goldenDelta * 0.25));
  return Math.min(maxCenter, Math.max(minCenter, minimal + nudge));
}

function layoutRepairCandidate(
  candidate: LayoutOverflowRepairCandidate,
): Omit<SceneLayoutRepairV1, "id"> | undefined {
  const { rect, safeRect, frameRect } = candidate;
  if (rect.width <= 0 || rect.height <= 0 || safeRect.width <= 0 || safeRect.height <= 0) {
    return undefined;
  }
  const scale = Math.min(1, safeRect.width / rect.width, safeRect.height / rect.height);
  const isBand =
    candidate.issueCode === "important_safe_area" &&
    (rect.width >= frameRect.width * LAYOUT_REPAIR_BAND_FRACTION ||
      rect.height >= frameRect.height * LAYOUT_REPAIR_BAND_FRACTION);
  const loadBearing = candidate.issueCode === "load_bearing_containment";
  const scaleFloor = loadBearing
    ? LOAD_BEARING_CONTAINMENT_SCALE_FLOOR
    : isBand
      ? LAYOUT_REPAIR_SCALE_FLOOR_BAND
      : LAYOUT_REPAIR_SCALE_FLOOR;
  if (!Number.isFinite(scale) || scale < scaleFloor) return undefined;
  const scaledWidth = rect.width * scale;
  const scaledHeight = rect.height * scale;
  if (scaledWidth > safeRect.width + 0.5 || scaledHeight > safeRect.height + 0.5) {
    return undefined;
  }
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const measuredOverflow: RepairOverflow = {
    ...(rect.left < safeRect.left ? { left: safeRect.left - rect.left } : {}),
    ...(rect.right > safeRect.right ? { right: rect.right - safeRect.right } : {}),
    ...(rect.top < safeRect.top ? { top: safeRect.top - rect.top } : {}),
    ...(rect.bottom > safeRect.bottom ? { bottom: rect.bottom - safeRect.bottom } : {}),
  };
  const overflow = candidate.issues.reduce<RepairOverflow>((acc, issue) => ({
    left: Math.max(acc.left ?? 0, issue.overflow?.left ?? 0),
    right: Math.max(acc.right ?? 0, issue.overflow?.right ?? 0),
    top: Math.max(acc.top ?? 0, issue.overflow?.top ?? 0),
    bottom: Math.max(acc.bottom ?? 0, issue.overflow?.bottom ?? 0),
  }), measuredOverflow);
  const targetX = chooseAxisCenter(
    centerX,
    scaledWidth,
    safeRect.left,
    safeRect.width,
    Boolean(overflow.left),
    Boolean(overflow.right),
  );
  const targetY = chooseAxisCenter(
    centerY,
    scaledHeight,
    safeRect.top,
    safeRect.height,
    Boolean(overflow.top),
    Boolean(overflow.bottom),
  );
  const dx = roundRepairNumber(targetX - centerX, 2);
  const dy = roundRepairNumber(targetY - centerY, 2);
  const translateCap = loadBearing
    ? LOAD_BEARING_CONTAINMENT_TRANSLATE_CAP_FRACTION
    : LAYOUT_REPAIR_TRANSLATE_CAP_FRACTION;
  const cappedX = frameRect.width * translateCap;
  const cappedY = frameRect.height * translateCap;
  if (Math.abs(dx) > cappedX || Math.abs(dy) > cappedY) return undefined;
  const roundedScale = roundRepairNumber(scale, 3);
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && roundedScale > 0.999) return undefined;
  return {
    version: 1,
    kind: "overflow-clamp",
    selector: candidate.selector,
    issueCode: candidate.issueCode,
    dx,
    dy,
    scale: roundedScale,
    origin: "center center",
    before: {
      rect: {
        left: roundRepairNumber(rect.left, 2),
        top: roundRepairNumber(rect.top, 2),
        right: roundRepairNumber(rect.right, 2),
        bottom: roundRepairNumber(rect.bottom, 2),
        width: roundRepairNumber(rect.width, 2),
        height: roundRepairNumber(rect.height, 2),
      },
      safeRect: {
        left: roundRepairNumber(safeRect.left, 2),
        top: roundRepairNumber(safeRect.top, 2),
        right: roundRepairNumber(safeRect.right, 2),
        bottom: roundRepairNumber(safeRect.bottom, 2),
        width: roundRepairNumber(safeRect.width, 2),
        height: roundRepairNumber(safeRect.height, 2),
      },
    },
  };
}

function layoutRepairId(sceneId: string, selector: string, issueCode: string): string {
  return `layout-${sceneId}-${createHash("sha1").update(`${issueCode}\0${selector}`).digest("hex").slice(0, 10)}`;
}

function layoutRepairGroups(
  storyboard: DirectScene[],
  browserQa: DirectBrowserQaResult,
): LayoutOverflowRepairCandidate[] {
  const addressed = addressedPartsForLayoutRepair(storyboard);
  const groups = new Map<string, LayoutOverflowRepairCandidate>();
  for (const issue of browserQa.issues ?? []) {
    if (!LAYOUT_REPAIR_TARGET_CODES.has(issue.code)) continue;
    if (!issue.sceneId || !issue.repairSelector || !issue.rect) continue;
    if (!safeLayoutRepairSelector(issue.repairSelector)) continue;
    if (issue.insideCameraWorld || issue.motionWindowOverlap) continue;
    if (unsafeLayoutRepairPartName(issue.part) || unsafeLayoutRepairPartName(issue.componentRootPart)) {
      continue;
    }
    if (
      (issue.part && addressed.has(scenePartKey(issue.sceneId, issue.part))) ||
      (issue.componentRootPart && addressed.has(scenePartKey(issue.sceneId, issue.componentRootPart)))
    ) {
      continue;
    }
    const safeRect = layoutSafeRectForIssue(issue);
    const frameRect = issue.containerRect ?? safeRect;
    if (!safeRect || !frameRect) continue;
    const key = `${issue.sceneId}${LAYOUT_REPAIR_KEY_SEPARATOR}${issue.repairSelector}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        sceneId: issue.sceneId,
        selector: issue.repairSelector,
        issueCode: issue.code === "important_safe_area" ? "important_safe_area" : "canvas_overflow",
        rect: issue.rect,
        safeRect,
        frameRect,
        ...(issue.part ? { part: issue.part } : {}),
        ...(issue.componentRootPart ? { componentRootPart: issue.componentRootPart } : {}),
        issues: [issue],
      });
      continue;
    }
    existing.rect = unionRepairRect(existing.rect, issue.rect);
    const nextSafe = intersectRepairRect(existing.safeRect, safeRect);
    if (!nextSafe) {
      groups.delete(key);
      continue;
    }
    existing.safeRect = nextSafe;
    existing.frameRect = unionRepairRect(existing.frameRect, frameRect);
    existing.issues.push(issue);
    if (issue.code === "important_safe_area") existing.issueCode = "important_safe_area";
  }
  return [...groups.values()].sort((a, b) => {
    const scaleA = Math.min(1, a.safeRect.width / a.rect.width, a.safeRect.height / a.rect.height);
    const scaleB = Math.min(1, b.safeRect.width / b.rect.width, b.safeRect.height / b.rect.height);
    return scaleB - scaleA ||
      layoutRepairOverflowMagnitude(b.issues[0]?.overflow) -
        layoutRepairOverflowMagnitude(a.issues[0]?.overflow);
  });
}

export function correctLayoutOverflow(
  storyboard: DirectScene[],
  browserQa: DirectBrowserQaResult,
  options: { maxRepairs?: number } = {},
): { storyboard: DirectScene[]; corrected: string[] } {
  const repairs = layoutRepairGroups(storyboard, browserQa)
    .flatMap((candidate) => {
      const repair = layoutRepairCandidate(candidate);
      return repair
        ? [{
            sceneId: candidate.sceneId,
            repair: {
              ...repair,
              id: layoutRepairId(candidate.sceneId, candidate.selector, candidate.issueCode),
            } satisfies SceneLayoutRepairV1,
          }]
        : [];
    })
    .slice(0, options.maxRepairs ?? Number.POSITIVE_INFINITY);
  if (!repairs.length) return { storyboard, corrected: [] };

  const byScene = new Map<string, SceneLayoutRepairV1[]>();
  for (const { sceneId, repair } of repairs) {
    const list = byScene.get(sceneId) ?? [];
    list.push(repair);
    byScene.set(sceneId, list);
  }
  const corrected: string[] = [];
  const mutated = storyboard.map((scene) => {
    const nextRepairs = byScene.get(scene.id);
    if (!nextRepairs?.length) return scene;
    corrected.push(scene.id);
    const kept = (scene.layoutRepairs ?? []).filter((repair) =>
      !nextRepairs.some((next) => next.id === repair.id)
    );
    const notes = new Set(scene.sentinelNormalizations ?? []);
    for (const repair of nextRepairs) {
      notes.add(
        `layout-overflow-clamp: ${repair.issueCode} ${repair.selector} ` +
          `translate ${repair.dx}px/${repair.dy}px scale ${repair.scale}`,
      );
    }
    return {
      ...scene,
      layoutRepairs: [...kept, ...nextRepairs],
      sentinelNormalizations: [...notes],
    };
  });
  return { storyboard: mutated, corrected };
}

export interface LoadBearingContainmentTarget {
  sceneId: string;
  part: string;
  detector: LoadBearingContainmentEvidence["detector"];
  time: number;
  beforeVisibleFraction: number;
  requiredVisibleFraction: number;
}

function validLoadBearingPart(scene: DirectScene, evidence: LoadBearingContainmentEvidence): boolean {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(evidence.part)) return false;
  if (scene.spatialIntent?.focalPart === evidence.part) return true;
  if (scene.components?.some((component) =>
    component.id === evidence.part && component.role === "hero"
  )) return true;
  // Camera-blocking evidence is emitted only for a compiled PRIMARY phrase;
  // the typed phrase itself is the load-bearing declaration even when the
  // target is a semantic author part rather than a component-kit root.
  return evidence.detector === "camera-blocking";
}

function containmentEvidenceKey(
  value: Pick<LoadBearingContainmentEvidence, "sceneId" | "part">,
): string {
  // Detector paths can legitimately change after canonical host reinjection
  // (primary-moment -> camera-blocking). Retry ownership is the typed target,
  // so duplicate detectors collapse to one scene+part containment key.
  return `${value.sceneId}${LAYOUT_REPAIR_KEY_SEPARATOR}${value.part}`;
}

/**
 * One S6.10 containment transaction. Only measured typed primaries below the
 * hard visibility floor qualify; occupancy/sparseness never enters this seam.
 * The returned storyboard carries at most one host-only translate/scale rule.
 */
export function correctLoadBearingContainment(
  storyboard: DirectScene[],
  browserQa: DirectBrowserQaResult,
): { storyboard: DirectScene[]; corrected: LoadBearingContainmentTarget[] } {
  const sceneById = new Map(storyboard.map((scene) => [scene.id, scene]));
  const candidates = (browserQa.loadBearingContainment ?? [])
    .filter((evidence) => {
      const scene = sceneById.get(evidence.sceneId);
      return Boolean(
        scene &&
        evidence.found &&
        evidence.opacity >= 0.35 &&
        evidence.visibleFraction + 1e-6 < evidence.requiredVisibleFraction &&
        evidence.rect && evidence.frameRect && evidence.safeRect &&
        evidence.rect.width > 0 && evidence.rect.height > 0 &&
        validLoadBearingPart(scene!, evidence),
      );
    })
    .sort((a, b) =>
      a.visibleFraction - b.visibleFraction ||
      a.time - b.time ||
      containmentEvidenceKey(a).localeCompare(containmentEvidenceKey(b))
    );
  const evidence = candidates[0];
  if (!evidence?.rect || !evidence.frameRect || !evidence.safeRect) {
    return { storyboard, corrected: [] };
  }
  const selector = `[data-scene="${evidence.sceneId}"] [data-part="${evidence.part}"]`;
  if (!safeLayoutRepairSelector(selector)) return { storyboard, corrected: [] };
  const repair = layoutRepairCandidate({
    sceneId: evidence.sceneId,
    selector,
    issueCode: "load_bearing_containment",
    rect: evidence.rect,
    safeRect: evidence.safeRect,
    frameRect: evidence.frameRect,
    part: evidence.part,
    componentRootPart: evidence.part,
    issues: [],
  });
  if (!repair) return { storyboard, corrected: [] };
  const completed: SceneLayoutRepairV1 = {
    ...repair,
    id: layoutRepairId(evidence.sceneId, selector, "load_bearing_containment"),
  };
  const target: LoadBearingContainmentTarget = {
    sceneId: evidence.sceneId,
    part: evidence.part,
    detector: evidence.detector,
    time: evidence.time,
    beforeVisibleFraction: evidence.visibleFraction,
    requiredVisibleFraction: evidence.requiredVisibleFraction,
  };
  const mutated = storyboard.map((scene) => {
    if (scene.id !== evidence.sceneId) return scene;
    const kept = (scene.layoutRepairs ?? []).filter((entry) => entry.id !== completed.id);
    const notes = new Set(scene.sentinelNormalizations ?? []);
    notes.add(
      `load-bearing-containment: ${evidence.part} visibility ` +
      `${roundRepairNumber(evidence.visibleFraction, 3)} -> >=` +
      `${roundRepairNumber(evidence.requiredVisibleFraction, 3)}; ` +
      `translate ${completed.dx}px/${completed.dy}px scale ${completed.scale}`,
    );
    return {
      ...scene,
      layoutRepairs: [...kept, completed],
      sentinelNormalizations: [...notes],
    };
  });
  return { storyboard: mutated, corrected: [target] };
}

function failedContainmentKeys(browserQa: DirectBrowserQaResult): Set<string> {
  return new Set((browserQa.loadBearingContainment ?? [])
    .filter((entry) =>
      !entry.found || entry.opacity < 0.35 ||
      entry.visibleFraction + 1e-6 < entry.requiredVisibleFraction
    )
    .map(containmentEvidenceKey));
}

export function evaluateLoadBearingContainmentAdoption(args: {
  before: DirectBrowserQaResult;
  after: DirectBrowserQaResult;
  target: LoadBearingContainmentTarget;
}): {
  accepted: boolean;
  beforeVisibleFraction: number;
  afterVisibleFraction?: number;
  reason?: "infrastructure" | "hard-failure" | "measurement-missing" | "not-improved" |
    "visibility-floor" | "new-hard-containment";
} {
  const base = { beforeVisibleFraction: args.target.beforeVisibleFraction };
  if (args.after.infraError) return { ...base, accepted: false, reason: "infrastructure" };
  if (!args.after.ok) return { ...base, accepted: false, reason: "hard-failure" };
  const afterEvidence = (args.after.loadBearingContainment ?? [])
    .filter((entry) =>
      entry.sceneId === args.target.sceneId &&
      entry.part === args.target.part
    )
    .sort((a, b) =>
      Number(b.detector === args.target.detector) - Number(a.detector === args.target.detector) ||
      Math.abs(a.time - args.target.time) - Math.abs(b.time - args.target.time)
    )[0];
  if (!afterEvidence?.found || afterEvidence.opacity < 0.35) {
    return { ...base, accepted: false, reason: "measurement-missing" };
  }
  const afterVisibleFraction = afterEvidence.visibleFraction;
  if (afterVisibleFraction <= args.target.beforeVisibleFraction + 0.01) {
    return { ...base, accepted: false, afterVisibleFraction, reason: "not-improved" };
  }
  if (afterVisibleFraction + 1e-6 < args.target.requiredVisibleFraction) {
    return { ...base, accepted: false, afterVisibleFraction, reason: "visibility-floor" };
  }
  const beforeFailures = failedContainmentKeys(args.before);
  const targetKey = containmentEvidenceKey(args.target);
  for (const key of failedContainmentKeys(args.after)) {
    if (key !== targetKey && !beforeFailures.has(key)) {
      return {
        ...base,
        accepted: false,
        afterVisibleFraction,
        reason: "new-hard-containment",
      };
    }
  }
  return { ...base, accepted: true, afterVisibleFraction };
}

function formatLayoutRepairPx(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}px`;
}

function formatLayoutRepairScale(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function validLayoutRepairRect(
  rect: SceneLayoutRepairV1["before"]["rect"] | undefined,
): rect is SceneLayoutRepairV1["before"]["rect"] {
  return Boolean(
    rect &&
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.right) &&
      Number.isFinite(rect.bottom) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width >= 0 &&
      rect.height >= 0,
  );
}

function layoutRepairStyleBlock(storyboard: DirectScene[]): string | undefined {
  const rules = storyboard.flatMap((scene) =>
    (scene.layoutRepairs ?? []).flatMap((repair) => {
      if (
        repair.version !== 1 ||
        repair.kind !== "overflow-clamp" ||
        (
          repair.issueCode !== "canvas_overflow" &&
          repair.issueCode !== "important_safe_area" &&
          repair.issueCode !== "load_bearing_containment"
        ) ||
        !safeLayoutRepairSelector(repair.selector) ||
        !Number.isFinite(repair.dx) ||
        !Number.isFinite(repair.dy) ||
        !Number.isFinite(repair.scale) ||
        repair.origin !== "center center" ||
        repair.scale <= 0 ||
        repair.scale > 1.001 ||
        !validLayoutRepairRect(repair.before?.rect) ||
        !validLayoutRepairRect(repair.before?.safeRect)
      ) {
        return [];
      }
      const before = repair.before;
      const comment = cssCommentSafe(
        `layout-overflow-clamp scene=${scene.id} code=${repair.issueCode} ` +
          `rect=${before.rect.left},${before.rect.top},${before.rect.width}x${before.rect.height} ` +
          `safe=${before.safeRect.left},${before.safeRect.top},${before.safeRect.width}x${before.safeRect.height}`,
      );
      return [
        `/* ${comment} */\n${repair.selector}{` +
          `transform-origin:${repair.origin} !important;` +
          `translate:${formatLayoutRepairPx(repair.dx)} ${formatLayoutRepairPx(repair.dy)} !important;` +
          `scale:${formatLayoutRepairScale(repair.scale)} !important;` +
          `}`,
      ];
    })
  );
  return rules.length
    ? `<style data-sequences-layout-repair>\n${rules.join("\n")}\n</style>`
    : undefined;
}

function injectLayoutRepairStyles(source: string, storyboard: DirectScene[]): { html: string; repairs: number } {
  let html = source.replace(
    /\n?\s*<style\b[^>]*\bdata-sequences-layout-repair\b[^>]*>[\s\S]*?<\/style>/gi,
    "",
  );
  const style = layoutRepairStyleBlock(storyboard);
  if (!style) return { html, repairs: 0 };
  html = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, () => `${style}</head>`)
    : `${style}\n${html}`;
  return {
    html,
    repairs: storyboard.reduce((count, scene) => count + (scene.layoutRepairs?.length ?? 0), 0),
  };
}

function decorativeLivenessName(value: string): boolean {
  return /(?:^|[#.\s_\[\]-])(?:accent-?)?(?:underline|rule|divider|hairline|bloom|glow|grain|vignette|keylight|atmosphere|ambient|decor(?:ation|ative)?|particle|spark|noise)(?:$|[#.\s_\[\]-])/i
    .test(value);
}

function livenessBeatCandidate(scope: string): { tag: string; index: number } | undefined {
  const blockedTag = /^(?:script|style|link|meta|main|section)$/i;
  const candidates = [...scope.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)]
    .map((match) => {
      const tag = match[0];
      const tagName = tag.match(/^<([a-z][\w:-]*)\b/i)?.[1] ?? "";
      const id = htmlAttr(tag, "id") ?? "";
      const part = htmlAttr(tag, "data-part") ?? "";
      const className = htmlAttr(tag, "class") ?? "";
      let score = 0;
      if (part) score += 40;
      if (id) score += 24;
      if (/\bdata-layout-important\b/i.test(tag)) score += 18;
      if (/^(?:h1|h2|h3|p|button|li|article|aside)$/i.test(tagName)) score += 12;
      if (/\b(?:cmp|card|panel|metric|stat|row|item|title|headline|copy)\b/i.test(className)) {
        score += 8;
      }
      if (decorativeLivenessName(`${id} ${part} ${className}`)) score -= 100;
      return { tag, index: match.index ?? 0, score, tagName };
    })
    .filter((entry) =>
      entry.score > 0 &&
      !blockedTag.test(entry.tagName) &&
      !/\/\s*>$/.test(entry.tag) &&
      !/\b(?:data-scene|data-camera-world|data-camera-overlay|data-sequences-runtime-|aria-hidden\s*=\s*(["'])true\1)\b/i
        .test(entry.tag)
    )
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0] ? { tag: candidates[0].tag, index: candidates[0].index } : undefined;
}

function livenessBeatTimes(scene: DirectScene, count: number): number[] {
  if (count <= 0) return [];
  const fractions = count === 1
    ? [0.58]
    : Array.from({ length: count }, (_value, index) =>
      0.32 + (0.42 * index) / Math.max(1, count - 1)
    );
  return fractions.map((fraction) => {
    const min = scene.startSec + 0.12;
    const max = scene.startSec + Math.max(0.14, scene.durationSec - 0.12);
    return Math.round(Math.min(max, Math.max(min, scene.startSec + scene.durationSec * fraction)) * 1000) /
      1000;
  });
}

/**
 * Keep the liveness gate strict while recovering its most mechanical failure:
 * a short scene with visible authored content but no timed child beat. We mark
 * one real content element and add a tiny seek-safe transform/opacity beat at
 * an explicit timeline time; `validateMotionDensity` then re-runs unchanged.
 */
export function injectMissingLivenessBeats(
  source: string,
  scenes: DirectScene[],
): { html: string; repaired: string[] } {
  const durationSec = rootDurationSec(source);
  if (durationSec === undefined) return { html: source, repaired: [] };
  const report = analyzeMotionDensity(source, scenes, durationSec);
  const needs = new Map<string, number>();
  for (const error of report.errors) {
    const match = error.match(
      /^motion\/liveness: scene "([^"]+)" has (\d+) authored component\/camera beat\(s\).*use at least (\d+) non-wrapper beat/,
    );
    if (!match) continue;
    const sceneId = match[1]!;
    const current = Number(match[2]);
    const minimum = Number(match[3]);
    if (Number.isFinite(current) && Number.isFinite(minimum) && minimum > current) {
      needs.set(sceneId, Math.max(needs.get(sceneId) ?? 0, minimum - current));
    }
  }
  if (!needs.size) return { html: source, repaired: [] };

  const timelineName = source.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
  )?.[1];
  if (!timelineName) return { html: source, repaired: [] };
  const registration = timelineRegistrationAnchor(timelineName);
  if (!registration.exec(source)) return { html: source, repaired: [] };

  let html = source;
  const tweens: string[] = [];
  const repaired: string[] = [];
  for (const scene of scenes) {
    const count = needs.get(scene.id) ?? 0;
    if (!count) continue;
    const scopeMeta = sceneScopeLocations(html).find((entry) => entry.id === scene.id);
    if (!scopeMeta) continue;
    let scope = html.slice(scopeMeta.openStart, scopeMeta.closeEnd);
    const selector = `[data-sequences-liveness-beat="${cssString(scene.id)}"]`;
    const selectorLiteral = JSON.stringify(selector);
    if (!new RegExp(`\\bdata-sequences-liveness-beat\\s*=\\s*(["'])${regexpEscape(scene.id)}\\1`, "i")
      .test(scope)) {
      const candidate = livenessBeatCandidate(scope);
      if (!candidate) continue;
      const replacement = ensureTagAttr(candidate.tag, "data-sequences-liveness-beat", scene.id);
      scope = scope.slice(0, candidate.index) + replacement +
        scope.slice(candidate.index + candidate.tag.length);
      html = html.slice(0, scopeMeta.openStart) + scope + html.slice(scopeMeta.closeEnd);
    }
    for (const atSec of livenessBeatTimes(scene, count)) {
      tweens.push(
        `${timelineName}.fromTo(${selectorLiteral}, { y: 16, opacity: 0.72, scale: 0.985 }, ` +
          `{ y: 0, opacity: 1, scale: 1, duration: 0.42, ease: "power3.out", ` +
          `immediateRender: false }, ${atSec});`,
      );
    }
    repaired.push(scene.id);
  }
  if (!tweens.length) return { html, repaired: [] };
  const updatedRegistration = registration.exec(html);
  if (!updatedRegistration) return { html, repaired: [] };
  html = html.slice(0, updatedRegistration.index) +
    tweens.join("\n") + "\n" +
    html.slice(updatedRegistration.index);
  return { html, repaired };
}

/**
 * The `window.__timelines[...] = <timeline>;` line every compile-call
 * injection anchors on. When the film ramps, the time-wrap step (the LAST
 * injection) rewrites that line to register the wrapped master, so on
 * re-entry (critic patches, cut-discovery upgrades) the anchor must also
 * match the wrapped form — the compile call is then inserted before the
 * whole wrap statement.
 */
function timelineRegistrationAnchor(timelineName: string): RegExp {
  const escaped = regexpEscape(timelineName);
  return new RegExp(
    `((?:var\\s+__seqWarped\\s*=\\s*SequencesTime\\.wrap\\(${escaped}\\);\\s*)?` +
      `window\\.__timelines\\s*\\[[^\\]]+\\]\\s*=\\s*(?:${escaped}|__seqWarped)\\s*;)`,
  );
}

/**
 * The registered runtime `.js` files the host stages next to the composition and
 * references with a real `<script src>`; every other `sequences-*.vN.(js|css)`
 * is a kit the host injects INLINE (`sequences-cinema.v1.css`,
 * `sequences-components.v1.css`) or does not exist at all.
 */
const HOST_STAGED_RUNTIME_FILES = new Set<string>([
  ...HOST_CONTRACTS.map((contract) => contract.file),
]);

/**
 * Strip author `<script src>`/`<link href>` references to host-owned kit assets
 * the host injects inline (the CSS kits) or that never exist (the recurring
 * `sequences-cinema.v1.js` hallucination — the cinema kit is CSS-only, so the
 * model invents a `.v1.js` sibling of the real component/camera runtimes). Such
 * a reference resolves to a missing staged file and fails the whole build with
 * `referenced local asset does not exist`; it is never valid, so removing it is
 * mechanical paperwork recovery, not a content change. The five genuinely
 * registered staged runtime `.js` files are preserved.
 */
export function stripHostKitAssetReferences(source: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  const isSpuriousKitRef = (ref: string): boolean => {
    const base = ref.replace(/^\\+|\\+$/g, "").split(/[?#]/, 1)[0]!.split(/[\\/]/).pop() ?? "";
    if (!/^sequences-[\w.-]+\.v\d+\.(?:js|css)$/i.test(base)) return false;
    return !HOST_STAGED_RUNTIME_FILES.has(base);
  };
  const html = source
    .replace(
      /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>\s*<\/script>/gi,
      (tag, _quote, ref: string) => {
        if (!isSpuriousKitRef(ref)) return tag;
        removed.push(ref);
        return "";
      },
    )
    .replace(
      /<link\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi,
      (tag, _quote, ref: string) => {
        if (!isSpuriousKitRef(ref)) return tag;
        removed.push(ref);
        return "";
      },
    );
  return { html, removed };
}

/** Each host runtime `.js` file paired with the global its `<script src>` defines. */
const RUNTIME_SCRIPT_GLOBALS: ReadonlyArray<{ file: string; global: string }> = [
  { file: hostContract("interaction").file, global: "SequencesInteractions" },
  { file: hostContract("cut").file, global: "SequencesCuts" },
  { file: hostContract("camera").file, global: "SequencesCamera" },
  { file: hostContract("continuity").file, global: "SequencesContinuity" },
  { file: hostContract("component").file, global: "SequencesComponents" },
  { file: hostContract("time").file, global: "SequencesTime" },
  { file: hostContract("fx").file, global: "SequencesFx" },
  { file: hostContract("asset").file, global: "SequencesAssets" },
  { file: hostContract("environment").file, global: "SequencesEnvironment" },
];

/** Match a runtime `<script src="…vN.js">` tag plus one leading newline/indent (so
 * removal-then-reinsert is byte-idempotent). */
function runtimeScriptTagSource(file: string): string {
  return (
    `\\n?[ \\t]*<script\\b[^>]*\\bsrc\\s*=\\s*(["'])${regexpEscape(file)}\\1[^>]*>\\s*<\\/script>`
  );
}

/**
 * Guarantee that every host runtime whose global an inline script uses is loaded
 * by a real `<script src>` that runs BEFORE that inline script.
 *
 * The registered runtime injectors each anchor their `<script src>` on the
 * host GSAP tag and are individually *idempotent* (`if the tag is already
 * present, skip`). That means a runtime tag the AUTHOR wrote in the wrong place —
 * after the inline timeline `<script>`, or before GSAP — is left mis-ordered, and
 * the compile call (injected on a *different* anchor, the timeline registration)
 * then executes against an undefined global: `SequencesInteractions is not
 * defined`, an opaque browser bind failure that burns a paid repair attempt and
 * can end in the deterministic fallback. This normalizes all registered runtimes deterministically:
 * any present-or-referenced runtime `<script src>` is collapsed to a single tag,
 * in canonical order, in one contiguous block immediately after the GSAP tag
 * (runtimes load after GSAP — which they may depend on — and before the
 * composition's inline timeline). A referenced-but-missing runtime is injected.
 *
 * No-op and byte-idempotent for an already-correct composition. If the GSAP tag
 * is absent there is no safe anchor and static validation already rejects the
 * draft, so we leave it untouched.
 */
export function ensureRuntimeScriptOrdering(source: string): { html: string; changed: boolean } {
  const gsapPattern = /<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\1[^>]*>\s*<\/script>/i;
  if (!gsapPattern.test(source)) return { html: source, changed: false };

  // Inline (executed) script bodies only — exclude `src` scripts and JSON islands,
  // whose plan payloads never contain a runtime global name.
  const inlineBlob = [
    ...source.matchAll(
      /<script\b(?![^>]*\bsrc\s*=)(?![^>]*\btype\s*=\s*(["'])application\/json\1)[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((match) => match[2] ?? "")
    .join("\n");

  const needed = RUNTIME_SCRIPT_GLOBALS.filter(
    ({ file, global }) =>
      new RegExp(runtimeScriptTagSource(file), "i").test(source) ||
      new RegExp(`\\b${regexpEscape(global)}\\b`).test(inlineBlob),
  ).map((entry) => entry.file);
  if (!needed.length) return { html: source, changed: false };

  // Strip every existing runtime tag (any count, any position) …
  let html = source;
  for (const { file } of RUNTIME_SCRIPT_GLOBALS) {
    html = html.replace(new RegExp(runtimeScriptTagSource(file), "gi"), "");
  }
  // … then re-insert exactly one tag per needed runtime, canonical order, after GSAP.
  const anchor = gsapPattern.exec(html);
  if (!anchor) return { html: source, changed: false };
  const insertAt = anchor.index + anchor[0].length;
  const block = needed.map((file) => `\n<script src="${file}"></script>`).join("");
  const rebuilt = html.slice(0, insertAt) + block + html.slice(insertAt);
  return { html: rebuilt, changed: rebuilt !== source };
}

/**
 * Put host runtime compilers in deterministic render order.
 *
 * GSAP resolves callbacks/tweens that share a timestamp in insertion order. An
 * interaction follower measures its live target from `getBoundingClientRect()`;
 * if it was compiled before camera, component, FX, or asset motion, it sampled
 * stale geometry and visibly trailed the control it was meant to press. Keep
 * scene-producing layers first and the geometry-following interaction layer
 * last. `SequencesTime.wrap(...)` deliberately remains after every compiler.
 *
 * Calls are reordered only among slots for the same simple timeline variable,
 * inside the same inline script. Their exact arguments and all surrounding
 * author code stay untouched. This makes the repair byte-idempotent.
 */
export function ensureHostCompileOrdering(
  source: string,
): { html: string; changed: boolean } {
  const priority = new Map<string, number>([
    ["Cuts", 0],
    ["Camera", 1],
    ["Continuity", 2],
    ["Components", 3],
    ["Fx", 4],
    ["Assets", 5],
    ["Interactions", 6],
  ]);
  const inlineScript =
    /(<script\b(?![^>]*\bsrc\s*=)(?![^>]*\btype\s*=\s*(["'])application\/json\2)[^>]*>)([\s\S]*?)(<\/script>)/gi;
  let changed = false;
  const html = source.replace(
    inlineScript,
    (whole, open: string, _quote: string, body: string, close: string) => {
      const callPattern =
        /\bSequences(Cuts|Camera|Continuity|Components|Fx|Assets|Interactions)\.compile\s*\(\s*([A-Za-z_$][\w$]*)\s*,[^;\r\n]*\)\s*;/g;
      const calls = [...body.matchAll(callPattern)].map((match) => ({
        index: match.index ?? 0,
        text: match[0],
        runtime: match[1]!,
        timeline: match[2]!,
      }));
      if (calls.length < 2) return whole;

      const replacements = new Map<number, string>();
      const timelines = new Set(calls.map((call) => call.timeline));
      for (const timeline of timelines) {
        const slots = calls.filter((call) => call.timeline === timeline);
        if (slots.length < 2) continue;
        const ordered = [...slots].sort((a, b) =>
          (priority.get(a.runtime) ?? Number.MAX_SAFE_INTEGER) -
            (priority.get(b.runtime) ?? Number.MAX_SAFE_INTEGER)
        );
        slots.forEach((slot, index) => replacements.set(slot.index, ordered[index]!.text));
      }
      if (!replacements.size) return whole;

      let rebuilt = "";
      let cursor = 0;
      for (const call of calls) {
        rebuilt += body.slice(cursor, call.index) + (replacements.get(call.index) ?? call.text);
        cursor = call.index + call.text.length;
      }
      rebuilt += body.slice(cursor);
      if (rebuilt === body) return whole;
      changed = true;
      return open + rebuilt + close;
    },
  );
  return { html, changed };
}

/**
 * `.fromTo(target, vars, <number>)` is never valid GSAP — fromTo takes
 * (target, fromVars, toVars, position). When the model omits toVars, GSAP
 * receives the position NUMBER as the to-object and the compile throws
 * "Cannot create property 'parent' on number '…'" — a runtime_bind_exception
 * (and the whole paid attempt) spent on a call-shape typo (the
 * sentinel-s5-interactions probe class, 2026-07-06). The remaining vars do not
 * reveal which object was omitted. The safe rewrites currently proven are
 * `.to`: (1) visible/settled vars after the same selector was explicitly
 * initialized to an opposite state, or (2) a <=50ms visible/settled pin. The
 * latter is not a perceptible entrance/exit; it is the exact Vectorline live
 * probe shape (`{y:0,opacity:1,duration:0.01}`) and preserves the only declared
 * state at the declared position. Hidden/off-position could still be either
 * an entrance `.from` or an exit `.to`, so it stays blocking. Only a
 * string-literal target and a flat vars object are considered.
 */
export function repairMalformedFromToCalls(
  source: string,
): { html: string; repairs: number; fromRepairs: number; toRepairs: number; ambiguous: number } {
  let repairs = 0;
  let fromRepairs = 0;
  let toRepairs = 0;
  let ambiguous = 0;
  const classifyState = (vars: string): "from" | "to" | undefined => {
    const cues: Array<"from" | "to"> = [];
    const body = vars.slice(1, -1);
    const numericCue = (
      property: string,
      classify: (value: number) => "from" | "to" | undefined,
    ): void => {
      const match = new RegExp(`(?:^|[,\\s])${property}\\s*:\\s*(-?\\d*\\.?\\d+)`, "i")
        .exec(body);
      if (!match) return;
      const cue = classify(Number(match[1]));
      if (cue) cues.push(cue);
    };
    numericCue("(?:opacity|autoAlpha)", (value) =>
      value <= 0.05 ? "from" : value >= 0.95 ? "to" : undefined
    );
    for (const property of ["scale", "scaleX", "scaleY"]) {
      numericCue(property, (value) =>
        Math.abs(value - 1) <= 0.02 ? "to" : Math.abs(value - 1) >= 0.08 ? "from" : undefined
      );
    }
    for (const property of ["x", "y", "xPercent", "yPercent", "rotation", "rotationX", "rotationY"]) {
      numericCue(property, (value) =>
        Math.abs(value) <= 0.01 ? "to" : Math.abs(value) >= 1 ? "from" : undefined
      );
    }
    const visibility = /(?:^|[,\s])visibility\s*:\s*["'](visible|hidden)["']/i.exec(body)
      ?.[1]?.toLowerCase();
    if (visibility) cues.push(visibility === "visible" ? "to" : "from");
    const display = /(?:^|[,\s])display\s*:\s*["']([^"']+)["']/i.exec(body)
      ?.[1]?.toLowerCase();
    if (display) cues.push(display === "none" ? "from" : "to");
    return cues.length && cues.every((cue) => cue === cues[0]) ? cues[0] : undefined;
  };
  const pattern =
    /\.fromTo\(\s*((["'])(?:\\.|(?!\2).)*\2)\s*,\s*(\{[^{}]*\})\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
  const html = source.replace(
    pattern,
    (
      _match,
      target: string,
      _quote: string,
      vars: string,
      position: string,
      offset: number,
    ) => {
      const state = classifyState(vars);
      let direction: "from" | "to" | undefined;
      if (state === "to") {
        const duration = /(?:^|[,\s])duration\s*:\s*(-?\d*\.?\d+)/i.exec(
          vars.slice(1, -1),
        )?.[1];
        if (duration !== undefined && Number(duration) >= 0 && Number(duration) <= 0.05) {
          direction = "to";
        }
        // A settled state is safe as `.to` only when this same selector was
        // explicitly initialized earlier to an opposite state. This is the
        // exact s5 failure shape; a lone opacity:1 object remains ambiguous.
        if (!direction) {
          const before = source.slice(0, offset);
          const escapedTarget = regexpEscape(target);
          const candidates: Array<{ index: number; vars: string }> = [];
          for (const match of before.matchAll(
            new RegExp(`\\.(?:set|to)\\(\\s*${escapedTarget}\\s*,\\s*(\\{[^{}]*\\})`, "g"),
          )) {
            candidates.push({ index: match.index, vars: match[1]! });
          }
          for (const match of before.matchAll(
            new RegExp(
              `\\.fromTo\\(\\s*${escapedTarget}\\s*,\\s*\\{[^{}]*\\}\\s*,\\s*(\\{[^{}]*\\})`,
              "g",
            ),
          )) {
            candidates.push({ index: match.index, vars: match[1]! });
          }
          const prior = candidates.sort((a, b) => b.index - a.index)[0];
          if (prior && classifyState(prior.vars) === "from") direction = "to";
        }
      }
      if (!direction) {
        ambiguous += 1;
        return _match;
      }
      repairs += 1;
      if (direction === "from") fromRepairs += 1;
      else toRepairs += 1;
      return `.${direction}(${target}, ${vars}, ${position})`;
    },
  );
  return { html, repairs, fromRepairs, toRepairs, ambiguous };
}

/**
 * Models occasionally paste CSS custom-property syntax directly into a GSAP
 * vars object (`borderColor: var(--positive)`). `var` is a JavaScript keyword,
 * so the inline script cannot parse. Inside JavaScript the only meaningful
 * representation of a CSS `var(...)` value is its string form. Restrict the
 * rewrite to inline executable scripts; styles and JSON islands are untouched.
 */
export function quoteBareCssVarsInInlineScripts(
  source: string,
): { html: string; repairs: number } {
  let repairs = 0;
  const html = source.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (block, attrs: string, body: string) => {
      if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*(["'])application\/json\1/i.test(attrs)) {
        return block;
      }
      const normalized = body.replace(
        /(:\s*)var\(\s*(--[A-Za-z0-9_-]+)\s*\)(?=\s*[,}])/g,
        (_match, prefix: string, token: string) => {
          repairs += 1;
          return `${prefix}"var(${token})"`;
        },
      );
      return `<script${attrs}>${normalized}</script>`;
    },
  );
  return { html, repairs };
}

/**
 * The static author lint deliberately rejects interpolated template literals
 * passed to querySelector/querySelectorAll because the HTML bundler can hand
 * their `${...}` payload to its CSS parser. Preserve the runtime selector while
 * lowering the narrow, mechanically safe form (one simple identifier and no
 * escapes) to ordinary string concatenation before linting and bundling.
 */
export function lowerTemplateLiteralSelectorsInInlineScripts(
  source: string,
): { html: string; repairs: number } {
  let repairs = 0;
  const html = source.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (block, attrs: string, body: string) => {
      if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*(["'])application\/json\1/i.test(attrs)) {
        return block;
      }
      const normalized = body.replace(
        /\b(querySelector(?:All)?)\(\s*`([^`$\\]*)\$\{([A-Za-z_$][\w$]*)\}([^`$\\]*)`\s*\)/g,
        (_match, method: string, before: string, identifier: string, after: string) => {
          repairs += 1;
          return `${method}(${JSON.stringify(before)} + ${identifier} + ${JSON.stringify(after)})`;
        },
      );
      return `<script${attrs}>${normalized}</script>`;
    },
  );
  return { html, repairs };
}

/**
 * Remove only decorative SVG path tags whose `d` contains a literal ellipsis
 * placeholder. Browsers reject `C...` as geometry and emit a runtime error.
 * A path carrying a binding or important-layout marker stays blocking because
 * removing it could erase promised evidence.
 */
export function stripInvalidSvgPathPlaceholders(
  source: string,
): { html: string; repairs: number } {
  let repairs = 0;
  const html = source.replace(/<path\b[^>]*>/gi, (tag) => {
    const d = htmlAttr(tag, "d");
    if (
      !d ||
      !/(?:\.\.\.|…)/.test(d) ||
      /\b(?:data-part|data-component|data-layout-important)\b/i.test(tag)
    ) {
      return tag;
    }
    repairs += 1;
    return "";
  });
  return { html, repairs };
}

/**
 * E2 policy: free-form connector/graph SVGs are not an author-owned drawing
 * surface. Remove connector/graph SVG roots (or a connector wrapper containing
 * only one SVG) unless that exact drawing is host-owned. Author-added
 * `data-part` / `data-edge-*` stamps are not proof of endpoint binding and do
 * not create an escape hatch; the canonical `flow-diagram` plugin is regenerated
 * later by the host from real node parts and owns its geometry.
 */
export function stripUnboundConnectorSvgs(
  source: string,
): { html: string; repairs: number } {
  let repairs = 0;
  const connectorNamed = (attrs: string): boolean =>
    /\b(?:id|class|data-(?:kind|role|visual))\s*=\s*(["'])[^"']*(?:connector|connection|graph|flow[-_ ]?(?:line|edge)|edge[-_ ]?(?:map|lines?))[^"']*\1/i
      .test(attrs);
  const endpointStamped = (attrs: string): boolean =>
    /\bdata-edge-(?:from|to)\s*=/i.test(attrs);
  const hostOwned = (attrs: string): boolean =>
    /\bdata-sequences-(?:host|plugin)\b/i.test(attrs);

  // Close the common wrapper loophole without deleting mixed-content figures:
  // only wrappers whose entire payload is one SVG are eligible.
  let html = source.replace(
    /<([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>\s*(<svg\b[\s\S]*?<\/svg>)\s*<\/\1>/gi,
    (wrapper, _name: string, attrs: string) => {
      if (hostOwned(attrs) || (!connectorNamed(attrs) && !endpointStamped(attrs))) {
        return wrapper;
      }
      repairs += 1;
      return "";
    },
  );
  html = html.replace(
    /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>[\s\S]*?<\/svg>/gi,
    (svg, attrs: string) => {
      if (hostOwned(attrs) || (!connectorNamed(attrs) && !endpointStamped(svg))) return svg;
      repairs += 1;
      return "";
    },
  );
  return { html, repairs };
}

function ensureRootDataStart(html: string): { html: string; repaired: boolean } {
  const rootPattern = /<[a-z][\w:-]*\b(?=[^>]*\bdata-composition-id\s*=)[^>]*>/i;
  let repaired = false;
  const next = html.replace(rootPattern, (tag) => {
    if (/\bdata-start\s*=/.test(tag)) return tag;
    repaired = true;
    return tag.replace(/\s*\/?>$/, (suffix) =>
      suffix.includes("/") ? ` data-start="0" />` : ` data-start="0">`
    );
  });
  return { html: next, repaired };
}

/**
 * L2: a camera-world station authored with a placement rect but no
 * `position:absolute` is static flow — left/top are ignored, the station
 * spans the whole world plane, and everything inside lands off-frame or
 * overflowing (the plugin-live-1 metric-station class: our own plugin tiles
 * "overflowed" 240px because the station was 3840px wide). The intent is
 * mechanically certain, so the host completes it.
 */
export function repairStationPositioning(html: string): { html: string; repairs: number } {
  let repairs = 0;
  const result = html.replace(
    /<([a-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*\bdata-region\s*=(?:[^>"']|"[^"]*"|'[^']*')*)>/gi,
    (tag, name: string, attrs: string) => {
      const style = attrs.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i);
      if (!style) return tag;
      const css = style[2]!;
      const completions: string[] = [];
      if (
        !/(?:^|;)\s*position\s*:/i.test(css) &&
        /(?:^|;)\s*(?:left|top)\s*:/i.test(css)
      ) {
        completions.push("position:absolute");
      }
      // Grid alignment props without a display are inert (fix-probe-1: two
      // stations declared align-content/justify-items in static flow, so
      // nothing centered). The vocabulary is grid-only, so the intent is
      // mechanically certain.
      if (
        !/(?:^|;)\s*display\s*:/i.test(css) &&
        /(?:^|;)\s*(?:align-content|justify-items)\s*:/i.test(css)
      ) {
        completions.push("display:grid");
      }
      if (!completions.length) return tag;
      repairs += 1;
      const patched = attrs.replace(
        style[0]!,
        `style=${style[1]}${completions.join(";")};${css}${style[1]}`,
      );
      return `<${name}${patched}>`;
    },
  );
  return { html: result, repairs };
}

const BRAND_BASE_STYLE_ID = "sequences-brand-base";
const BRAND_BASE_BLOCK = new RegExp(
  `<style\\b[^>]*\\bid\\s*=\\s*(["'])${BRAND_BASE_STYLE_ID}\\1[^>]*>[\\s\\S]*?</style>\\n?`,
  "i",
);

/**
 * L2: host-owned brand base tokens from the job's frame.md — the committed
 * type trio as :root custom properties + base rules, the canvas hex, and the
 * committed accent. Injected BEFORE authored styles so every authored rule
 * still wins; the kit's var() fallbacks bind to the brand instead of the
 * default blue, unstyled text renders in the committed body family (the
 * recurring "EB Garamond not used" browser finding becomes unrepresentable),
 * and html/body carry the tinted canvas from the first frame.
 */
export function brandBaseStyleBlock(frameMd: string): string | undefined {
  const frame = parseFrame(frameMd);
  const quote = (family: string): string => `'${family.replace(/['"]/g, "")}'`;
  const rootTokens: string[] = [];
  if (frame.canvas) rootTokens.push(`--canvas:${frame.canvas}`);
  if (frame.surface) {
    rootTokens.push(`--surface:${frame.surface}`);
    rootTokens.push(`--surface-2:${frame.surface}`);
  }
  if (frame.text) rootTokens.push(`--text:${frame.text}`);
  if (frame.muted) rootTokens.push(`--muted:${frame.muted}`);
  if (frame.accent) rootTokens.push(`--accent:${frame.accent}`);
  if (frame.accentText) rootTokens.push(`--accent-text:${frame.accentText}`);
  if (frame.accentSoft) rootTokens.push(`--accent-soft:${frame.accentSoft}`);
  if (frame.border) rootTokens.push(`--border:${frame.border}`);
  if (frame.positive) rootTokens.push(`--positive:${frame.positive}`);
  if (frame.negative) rootTokens.push(`--negative:${frame.negative}`);
  if (frame.display) rootTokens.push(`--font-display:${quote(frame.display)}`);
  if (frame.body) rootTokens.push(`--font-body:${quote(frame.body)}`);
  if (frame.mono) rootTokens.push(`--font-mono:${quote(frame.mono)}`);
  if (!rootTokens.length) return undefined;
  const rules: string[] = [`:root{${rootTokens.join(";")}}`];
  if (frame.body) {
    rules.push(`body{font-family:var(--font-body),'Inter',system-ui,sans-serif}`);
  }
  if (frame.display) {
    rules.push(
      `h1,h2,h3,.cmp-headline{font-family:var(--font-display),var(--font-body,'Inter'),sans-serif}`,
    );
  }
  if (frame.mono) rules.push(`code,pre{font-family:var(--font-mono),monospace}`);
  return (
    `<style data-sequences-host="1" id="${BRAND_BASE_STYLE_ID}">\n` +
    `${rules.join("\n")}\n</style>`
  );
}

export function injectBrandBase(
  html: string,
  frameMd: string | undefined,
): { html: string; injected: boolean } {
  if (!frameMd) return { html, injected: false };
  const block = brandBaseStyleBlock(frameMd);
  if (!block) return { html, injected: false };
  const hadBlock = BRAND_BASE_BLOCK.test(html);
  let result = hadBlock ? html.replace(BRAND_BASE_BLOCK, "") : html;
  const anchor = /<style\b/i.exec(result);
  if (anchor?.index !== undefined) {
    result = result.slice(0, anchor.index) + block + "\n" + result.slice(anchor.index);
  } else {
    const headClose = /<\/head>/i.exec(result);
    if (headClose?.index === undefined) return { html, injected: false };
    result = result.slice(0, headClose.index) + block + "\n" + result.slice(headClose.index);
  }
  return { html: result, injected: !hadBlock };
}

const DISPLAY_TYPE_MARKUP_BLOCK =
  /<!--\s*sequences-display-type:start\s*-->[\s\S]*?<!--\s*sequences-display-type:end\s*-->[ \t]*(?:\r?\n)?/gi;
const DISPLAY_TYPE_STYLE_BLOCK =
  /<style\b[^>]*\bdata-sequences-display-type-style\b[^>]*>[\s\S]*?<\/style>[ \t]*(?:\r?\n)?/gi;
const DISPLAY_TYPE_MOTION_BLOCK =
  /\/\*\s*sequences-display-type:start\s*\*\/[\s\S]*?\/\*\s*sequences-display-type:end\s*\*\/[ \t]*(?:\r?\n)?/gi;

/** Host-owned one-per-film ghost display moment (WS-E3). */
export function injectDisplayTypeMoments(
  source: string,
  storyboard: DirectScene[],
): { html: string; injected: string[] } {
  let html = source
    .replace(DISPLAY_TYPE_MARKUP_BLOCK, "")
    .replace(DISPLAY_TYPE_STYLE_BLOCK, "")
    .replace(DISPLAY_TYPE_MOTION_BLOCK, "");
  const requested = storyboard.filter((scene) => scene.displayType).slice(0, 1);
  if (!requested.length) return { html, injected: [] };
  const escapeAttribute = (value: string): string => value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const injected: string[] = [];
  for (const scene of requested) {
    const display = scene.displayType!;
    const focalPart = display.focalPart ?? scene.spatialIntent?.focalPart;
    if (!focalPart) continue;
    const escapedScene = regexpEscape(scene.id);
    const open = new RegExp(
      `<[a-z][\\w:-]*\\b[^>]*\\bdata-scene\\s*=\\s*(["'])${escapedScene}\\1[^>]*>`,
      "i",
    ).exec(html);
    if (!open?.index && open?.index !== 0) continue;
    const end = open.index + open[0].length;
    const markup =
      `\n<!-- sequences-display-type:start -->\n` +
      `<div class="seq-display-type seq-display-type--ghost-word" ` +
      `data-sequences-display-type="ghost-word" data-display-scene="${escapeAttribute(scene.id)}" ` +
      `data-display-focal="${escapeAttribute(focalPart)}" ` +
      `data-layout-ignore aria-hidden="true">${escapeAttribute(display.text)}</div>\n` +
      `<!-- sequences-display-type:end -->\n`;
    html = html.slice(0, end) + markup + html.slice(end);
    injected.push(scene.id);
  }
  if (!injected.length) return { html, injected };
  const style = `<style data-sequences-display-type-style>
  .seq-display-type{position:absolute;left:50%;top:50%;z-index:0;max-width:84%;pointer-events:none;user-select:none;transform:translate(-50%,-50%);text-align:center;white-space:nowrap;overflow:hidden;color:var(--text,#eef1f5)}
  .seq-display-type--ghost-word{font:900 72px/.84 var(--display,var(--font-display,sans-serif));letter-spacing:-.065em;opacity:0;text-transform:uppercase}
  </style>`;
  const styleAnchor = /<style\b/i.exec(html);
  if (styleAnchor?.index !== undefined) {
    html = html.slice(0, styleAnchor.index) + style + "\n" + html.slice(styleAnchor.index);
  }
  const timelineName = html.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
  )?.[1];
  if (timelineName) {
    const calls = requested
      .filter((scene) => injected.includes(scene.id))
      .map((scene) => {
        const selector = `[data-sequences-display-type="ghost-word"][data-display-scene="${scene.id}"]`;
        const sceneSelector = `[data-scene="${scene.id}"]`;
        const focalPart = scene.displayType!.focalPart ?? scene.spatialIntent?.focalPart ?? "";
        const textLength = Math.max(4, scene.displayType!.text.trim().length);
        return [
          `${timelineName}.set(${JSON.stringify(selector)},{fontSize:function(){`,
          `var sceneRoot=document.querySelector(${JSON.stringify(sceneSelector)});`,
          `var focalKey=${JSON.stringify(focalPart)};`,
          `var focalNode=sceneRoot&&sceneRoot.querySelector('[data-part="'+CSS.escape(focalKey)+'"],[data-component="'+CSS.escape(focalKey)+'"]');`,
          `if(!sceneRoot||!focalNode)return "48px";`,
          `var focalRect=focalNode.getBoundingClientRect();`,
          `var sceneRect=sceneRoot.getBoundingClientRect();`,
          `var focalScale=Math.sqrt(Math.max(1,focalRect.width*focalRect.height));`,
          `var sceneCap=Math.sqrt(Math.max(1,sceneRect.width*sceneRect.height))*.14;`,
          `var widthCap=Math.max(120,focalRect.width*1.25)/(${textLength}*.58);`,
          `return Math.round(Math.max(38,Math.min(sceneCap,focalScale*.34,widthCap)))+"px";`,
          `}},${scene.displayType!.atSec});`,
          `${timelineName}.fromTo(${JSON.stringify(selector)},{opacity:0},{opacity:.065,duration:.6,ease:"power2.out"},${scene.displayType!.atSec});`,
        ].join("");
      })
      .join("\n");
    const registration = timelineRegistrationAnchor(timelineName);
    if (registration.test(html)) {
      html = html.replace(
        registration,
        `/* sequences-display-type:start */\n${calls}\n/* sequences-display-type:end */\n$1`,
      );
    }
  }
  // The block scrubbers intentionally absorb surrounding line whitespace so
  // stale host blocks cannot leave blank-line drift. When the canonical
  // payload is otherwise identical, preserve the original bytes: repeated L2
  // passes are expected to converge exactly, not merely render equivalently.
  if (
    source.includes("sequences-display-type:start") &&
    source.replace(/\s+/g, " ").trim() === html.replace(/\s+/g, " ").trim()
  ) {
    return { html: source, injected };
  }
  return { html, injected };
}

export interface SourceNormalizerContext {
  readonly draft: DirectCompositionDraft;
  readonly projectDir: string;
  readonly lockedStoryboard?: DirectScene[];
}

/**
 * Recover scene-slot arrow envelopes that were persisted before the slot
 * assembler learned to unwrap them. The host already wraps every scene body
 * in `(function (tl) { ... })(tl)`. If a model returned `(tl) => { ... }`, an
 * older assembler nested that arrow as an uninvoked expression and silently
 * disabled the entire scene's authored choreography. Re-run the same narrow
 * slot normalizer over the body of canonical scene IIFEs; ordinary bodies are
 * byte-preserved and only a complete arrow envelope is unwrapped.
 */
export function unwrapPersistedSceneSlotArrows(
  source: string,
): { html: string; repairs: number } {
  let repairs = 0;
  const html = source.replace(
    /(\(function\s*\(\s*tl\s*\)\s*\{)([\s\S]*?)(\}\s*\)\s*\(\s*tl\s*\)\s*;)/g,
    (match, prefix: string, body: string, suffix: string) => {
      const normalized = normalizeSceneSlotScript(body);
      if (!normalized.repairs.arrowEnvelope) return match;
      repairs += normalized.repairs.arrowEnvelope;
      return `${prefix}\n${normalized.script}\n${suffix}`;
    },
  );
  return { html, repairs };
}

/**
 * Ordered deterministic source repair pipeline (WS-F1). Array order is
 * load-bearing: in particular, host compile injections must precede the time
 * wrapper and the two final ordering guards.
 */
export const SOURCE_NORMALIZER_ORDER = [
  "normalize.root-data-start",
  "normalize.inline-source-syntax.css-var",
  "normalize.inline-source-syntax.template-selector",
  "normalize.inline-source-syntax.svg-placeholder",
  "normalize.inline-source-syntax.persisted-scene-arrow",
  "normalize.inline-source-syntax.connector-svg-policy",
  "normalize.inline-source-syntax.visibility",
  "normalize.gsap-call-shape",
  "normalize.source-bindings.scene-id",
  "normalize.lint-font-var-artifact.font-face",
  "normalize.host-plan-islands.asset-reference",
  "normalize.inline-source-syntax.deterministic-random",
  "normalize.gsap-repeat-clamp",
  "normalize.station-position",
  "normalize.brand-base",
  "normalize.source-bindings.timeline-registration",
  "normalize.host-plan-islands.strip",
  "normalize.source-bindings.layout-intent",
  "normalize.source-bindings.interaction-near-miss",
  "normalize.source-bindings.contract",
  "normalize.source-bindings.camera-world",
  "normalize.host-plan-islands.environment",
  "normalize.host-plan-islands.display-type",
  "normalize.plugin-lower.source-inject",
  "normalize.source-bindings.component-pre-continuity",
  "normalize.source-bindings.component-style-scope",
  "normalize.source-bindings.component-region-home",
  "normalize.source-bindings.component-alias",
  "normalize.source-bindings.rows-markup",
  "normalize.source-bindings.chat-beat-targets",
  "normalize.source-bindings.underline-markup",
  "normalize.kit-chart-complete",
  "normalize.kit-progress-complete",
  "normalize.host-plan-islands.cuts",
  "normalize.source-bindings.camera-runtime",
  "normalize.host-plan-islands.camera",
  "normalize.host-plan-islands.continuity",
  "normalize.source-bindings.component-post-continuity",
  "normalize.host-plan-islands.components",
  "normalize.fx-plan.source-inject",
  "normalize.asset-lower.source-inject",
  "normalize.recipe-reconcile.source-inject",
  "normalize.source-bindings.liveness",
  "normalize.host-plan-islands.component-kit",
  "normalize.host-plan-islands.cinema-kit",
  "normalize.brand-base.cinema-profile",
  "normalize.world-layout-derive.styles",
  "normalize.source-bindings.layout-repair",
  "normalize.dead-tween-strip",
  "normalize.host-plan-islands.time",
  "normalize.source-bindings.compile-order",
  "normalize.source-bindings.runtime-order",
] as const;

export const NORMALIZERS = declareLinearNormalizerRegistry<string, SourceNormalizerContext>([
  {
    id: "normalize.root-data-start",
    telemetryTag: "root-data-start",
    run: (html: string) => {
      const result = ensureRootDataStart(html);
      return {
        state: result.html,
        repairCount: result.repaired ? 1 : 0,
        diagnostics: result.repaired
          ? ['[author] inserted root data-start="0"\n']
          : [],
      };
    },
  },
  {
    id: "normalize.inline-source-syntax.css-var",
    telemetryTag: "bare-css-var",
    run: (html: string) => {
      const result = quoteBareCssVarsInInlineScripts(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] quoted ${result.repairs} bare CSS var() value(s) inside inline JavaScript\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.inline-source-syntax.template-selector",
    telemetryTag: "template-literal-selector",
    run: (html: string) => {
      const result = lowerTemplateLiteralSelectorsInInlineScripts(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] lowered ${result.repairs} interpolated query selector template literal(s) to string concatenation\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.inline-source-syntax.svg-placeholder",
    telemetryTag: "invalid-svg-placeholder",
    run: (html: string) => {
      const result = stripInvalidSvgPathPlaceholders(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] removed ${result.repairs} decorative SVG path placeholder(s) with invalid geometry\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.inline-source-syntax.persisted-scene-arrow",
    telemetryTag: "scene-slot-arrow-envelope",
    run: (html: string) => {
      const result = unwrapPersistedSceneSlotArrows(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] unwrapped ${result.repairs} persisted scene-slot arrow envelope(s) ` +
              `inside host timeline IIFEs\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.inline-source-syntax.connector-svg-policy",
    telemetryTag: "connector-svg-policy",
    run: (html: string) => {
      const result = stripUnboundConnectorSvgs(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] removed ${result.repairs} author-owned connector/graph SVG(s); ` +
                `use the host flow-diagram plugin for endpoint-bound topology\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.inline-source-syntax.visibility",
    telemetryTag: "gsap-display-visibility",
    run: (html: string) => {
      const result = normalizeGsapDisplayVisibilityTweens(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] normalized ${result.repairs} GSAP display/visibility tween(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.gsap-call-shape",
    telemetryTag: "gsap-call-shape",
    run: (html: string) => {
      const result = repairMalformedFromToCalls(html);
      const diagnostics: string[] = [];
      if (result.repairs) {
        diagnostics.push(
          `[author] rewrote ${result.repairs} malformed fromTo(target, vars, <position>) ` +
            `call(s) (${result.fromRepairs} to from, ${result.toRepairs} to to) \u2014 ` +
            `a missing vars object crashes GSAP compile\n`,
        );
      }
      if (result.ambiguous) {
        diagnostics.push(
          `[author] left ${result.ambiguous} malformed fromTo call(s) blocking because ` +
            `their intended from/to direction is ambiguous\n`,
        );
      }
      return { state: result.html, repairCount: result.repairs, diagnostics };
    },
  },
  {
    id: "normalize.source-bindings.scene-id",
    telemetryTag: "scene-id-reconcile",
    run: (html: string, { lockedStoryboard }: SourceNormalizerContext) => {
      let repairedIds = 0;
      if (lockedStoryboard?.length) {
        const authoredScenes = [...html.matchAll(
          /<([a-z][\w:-]*)\b[^>]*\bdata-scene(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/gis,
        )].map((match) => {
          const tag = match[0];
          const id = htmlAttr(tag, "id") ?? "";
          return {
            id,
            scene: htmlAttr(tag, "data-scene") ?? id,
            startSec: Number(htmlAttr(tag, "data-start")),
            durationSec: Number(htmlAttr(tag, "data-duration")),
          };
        });
        for (const expected of lockedStoryboard) {
          const matches = authoredScenes.filter((scene) =>
            Math.abs(scene.startSec - expected.startSec) <= 0.01 &&
            Math.abs(scene.durationSec - expected.durationSec) <= 0.01
          );
          if (matches.length !== 1) continue;
          const authored = matches[0]!;
          for (const current of new Set([authored.id, authored.scene])) {
            if (!current || current === expected.id) continue;
            html = html.replaceAll(current, expected.id);
            repairedIds += 1;
          }
        }
      }
      return {
        state: html,
        repairCount: repairedIds,
        telemetryCount: 0,
        diagnostics: repairedIds
          ? [`[author] reconciled ${repairedIds} scene id reference(s) to the locked storyboard\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.lint-font-var-artifact.font-face",
    telemetryTag: "font-face-strip",
    run: (html: string, { projectDir }: SourceNormalizerContext) => {
      let removedFontFaces = 0;
      html = html.replace(/@font-face\s*\{[^{}]*\}/gi, (block) => {
        const refs = [...block.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)]
          .map((match) => match[2]!.trim());
        const invalid = refs.some((ref) => {
          if (/^data:/i.test(ref)) {
            return /^data:font\/[^;,]+;base64,\s*$/i.test(ref);
          }
          if (/^(?:https?:)?\/\//i.test(ref)) return true;
          const clean = ref.split(/[?#]/, 1)[0]!;
          const fromProject = path.resolve(projectDir, clean);
          const fromComposition = path.resolve(projectDir, "composition", clean);
          return !fs.existsSync(fromProject) && !fs.existsSync(fromComposition);
        });
        if (!invalid) return block;
        removedFontFaces += 1;
        return "";
      });
      return {
        state: html,
        repairCount: removedFontFaces,
        telemetryCount: 0,
        diagnostics: removedFontFaces
          ? [`[author] removed ${removedFontFaces} unavailable or empty @font-face declaration(s)\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.asset-reference",
    telemetryTag: "host-kit-asset-reference",
    run: (html: string) => {
      const result = stripHostKitAssetReferences(html);
      return {
        state: result.html,
        repairCount: result.removed.length,
        telemetryCount: 0,
        diagnostics: result.removed.length
          ? [
              `[author] stripped ${result.removed.length} spurious host-kit asset ` +
              `reference(s) \u2014 the host injects these inline: ` +
              `${[...new Set(result.removed)].join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.inline-source-syntax.deterministic-random",
    telemetryTag: "deterministic-random",
    run: (html: string) => {
      const randomCalls = html.match(/\bMath\.random\s*\(\s*\)/g)?.length ?? 0;
      if (randomCalls) {
        const generator = [
          "let __sequencesSeed = 0x6d2b79f5;",
          "const __sequencesRandom = () => {",
          "  __sequencesSeed = (__sequencesSeed * 1664525 + 1013904223) >>> 0;",
          "  return __sequencesSeed / 4294967296;",
          "};",
        ].join("\n");
        html = html
          .replace(/\bMath\.random\s*\(\s*\)/g, "__sequencesRandom()")
          .replace(
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i,
            (tag) => `${tag}\n${generator}`,
          );
      }
      return {
        state: html,
        repairCount: randomCalls,
        telemetryCount: 0,
        diagnostics: randomCalls
          ? ["[author] deterministically replaced Math.random() with a fixed seeded PRNG\n"]
          : [],
      };
    },
  },
  {
    id: "normalize.gsap-repeat-clamp",
    telemetryTag: "gsap-repeat-clamp",
    run: (html: string) => {
      const infiniteRepeats = html.match(/\brepeat\s*:\s*-1\b/g)?.length ?? 0;
      if (infiniteRepeats) html = html.replace(/\brepeat\s*:\s*-1\b/g, "repeat: 2");
      return {
        state: html,
        repairCount: infiniteRepeats,
        diagnostics: infiniteRepeats
          ? [
              `[author] clamped ${infiniteRepeats} infinite GSAP repeat(s) to repeat: 2 ` +
              `(finite timelines by construction)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.station-position",
    telemetryTag: "station-position",
    run: (html: string) => {
      const result = repairStationPositioning(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] completed position:absolute on ${result.repairs} camera-world ` +
              `station(s) declaring a placement rect in static flow\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.brand-base",
    telemetryTag: "brand-base",
    run: (html: string, { projectDir }: SourceNormalizerContext) => {
      const frameMdPath = path.join(projectDir, "frame.md");
      const result = injectBrandBase(
        html,
        fs.existsSync(frameMdPath) ? fs.readFileSync(frameMdPath, "utf8") : undefined,
      );
      const changed = result.html !== html;
      return {
        state: result.html,
        repairCount: changed ? 1 : 0,
        telemetryCount: changed && result.injected ? 1 : 0,
        diagnostics: changed && result.injected
          ? [
              "[author] injected the host brand-base style block (frame tokens, committed " +
              "type trio, canvas) \u2014 authored rules still win the cascade\n",
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.timeline-registration",
    telemetryTag: "timeline-registration",
    run: (html: string) => {
      const compositionId = html.match(
        /<[^>]+\bdata-composition-id\s*=\s*(["'])(.*?)\1[^>]*>/is,
      )?.[2];
      if (!compositionId) return { state: html, repairCount: 0, telemetryCount: 0 };
      const escapedId = compositionId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const normalized = html.replace(
        /window\.__timelines\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*=\s*([^;]+);/g,
        `window.__timelines["${escapedId}"] = $1;`,
      );
      const changed = normalized !== html;
      return {
        state: normalized,
        repairCount: changed ? 1 : 0,
        telemetryCount: 0,
        diagnostics: changed
          ? ["[author] normalized computed timeline registration to the canonical composition id\n"]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.strip",
    telemetryTag: "island-strip",
    run: (html: string) => {
      const result = stripAllHostPlanIslands(html);
      const modelAuthored = result.removedModel.length;
      return {
        state: result.html,
        repairCount: result.removed.length,
        telemetryCount: modelAuthored,
        diagnostics: result.removed.length
          ? [
              `[author] stripped ${result.removed.length} host plan island(s) ` +
              `(${modelAuthored} model-authored, re-injected canonically): ` +
              `${[...new Set(result.removed)].join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.layout-intent",
    telemetryTag: "layout-intent",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const hairlines = retireOversizedDiagonalHairlines(html);
      const result = injectLayoutIntentHints(
        hairlines.html,
        lockedStoryboard ?? draft.storyboard,
      );
      return {
        state: result.html,
        repairCount: result.repaired.length + hairlines.repairs,
        diagnostics: [
          ...(hairlines.repairs
            ? [`[author] retired ${hairlines.repairs} oversized free-floating diagonal hairline(s)\n`]
            : []),
          ...(result.repaired.length
            ? [
              `[author] injected minimal layout intent hint(s) for scene(s): ` +
              `${result.repaired.join(", ")}\n`,
              ]
            : []),
        ],
      };
    },
  },
  {
    id: "normalize.source-bindings.interaction-near-miss",
    telemetryTag: "interaction-binding",
    run: (html: string, { lockedStoryboard }: SourceNormalizerContext) => {
      const interactions = lockedStoryboard?.flatMap((scene) => scene.interactions ?? []) ?? [];
      let repairedBindings = 0;
      if (interactions.length) {
        const interactionContract = hostContract("interaction");
        const targets = reconcileInteractionTargets(html, interactions);
        html = targets.html;
        repairedBindings += targets.repairs;
        const actors = normalizeInteractionActors(html, interactions);
        html = actors.html;
        repairedBindings += actors.repairs;
        if (
          !html.includes(`src="${interactionContract.file}"`) &&
          !html.includes(`src='${interactionContract.file}'`)
        ) {
          html = interactionContract.inject(html);
          repairedBindings += 1;
        }
        const payload = JSON.stringify({ version: 1, interactions });
        const normalizedIsland = normalizeJsonIsland(html, "sequences-interactions", payload);
        if (normalizedIsland.found) {
          html = normalizedIsland.html;
          repairedBindings += normalizedIsland.repairs;
        } else {
          const timelineScript =
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
          if (timelineScript?.index !== undefined) {
            html = html.slice(0, timelineScript.index) +
              `<script type="application/json" data-sequences-host="1" id="sequences-interactions">${payload}</script>\n` +
              html.slice(timelineScript.index);
            repairedBindings += 1;
          }
        }
        const islandPattern =
          /(<script\b[^>]*\bid\s*=\s*(["'])sequences-interactions\2[^>]*>)([\s\S]*?)(<\/script>)/i;
        const timelineName = html.match(
          /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
        )?.[1];
        if (timelineName) {
          const compileWithInlinePlan = new RegExp(
            `(SequencesInteractions\\.compile\\(\\s*${regexpEscape(timelineName)}\\s*,\\s*` +
              `[A-Za-z_$][\\w$]*\\s*),\\s*[A-Za-z_$][\\w$]*\\s*\\)`,
            "g",
          );
          const normalizedCompile = html.replace(compileWithInlinePlan, "$1)");
          if (normalizedCompile !== html) {
            html = normalizedCompile;
            repairedBindings += 1;
          }
        }
        const island = islandPattern.exec(html);
        const timelineScript =
          /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
        if (
          island?.index !== undefined &&
          timelineScript?.index !== undefined &&
          island.index > timelineScript.index
        ) {
          const islandSource = island[0];
          html = html.slice(0, island.index) + html.slice(island.index + islandSource.length);
          const insertion =
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html)?.index;
          if (insertion !== undefined) {
            html = html.slice(0, insertion) + islandSource + "\n" + html.slice(insertion);
            repairedBindings += 1;
          }
        }
        if (!/\bSequencesInteractions\.compile\s*\(/.test(html) && timelineName) {
          const registration = timelineRegistrationAnchor(timelineName);
          if (registration.test(html)) {
            html = html.replace(
              registration,
              `SequencesInteractions.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
            );
            repairedBindings += 1;
          }
        }
      }
      return {
        state: html,
        repairCount: repairedBindings,
        diagnostics: repairedBindings
          ? [`[author] normalized ${repairedBindings} deterministic interaction binding(s)\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.contract",
    telemetryTag: "contract-binding",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = reconcileContractBindings(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repairs,
        afterTelemetry: result.repairs
          ? () => recordSentinelScaffoldRestoration("l2-normalize", result.regionRepairs)
          : undefined,
        diagnostics: result.repairs
          ? [`[author] reconciled ${result.repairs} cut/camera contract binding(s)\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.camera-world",
    telemetryTag: "camera-world-plane",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = reconcileCameraWorldPlanes(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repairs,
        afterTelemetry: result.repairs
          ? () => recordSentinelScaffoldRestoration("l2-normalize", result.repairs)
          : undefined,
        diagnostics: result.repairs
          ? [`[author] wrapped ${result.repairs} scene(s) in deterministic camera world plane(s)\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.environment",
    telemetryTag: "environment-inject",
    run: (html: string, { draft, projectDir, lockedStoryboard }: SourceNormalizerContext) => {
      const source = html;
      const diagnostics: string[] = [];
      if (environmentsEnabled()) {
        const environmentContract = hostContract("environment");
        const environmentKit = environmentContract.kit!;
        const storyboard = lockedStoryboard ?? draft.storyboard;
        const compositionId = html.match(
          /\bdata-composition-id\s*=\s*(["'])(.*?)\1/i,
        )?.[2] ?? "direct-composition";
        const environmentBlocking = resolveCameraBlockingPlan(
          storyboard,
          resolveContinuityGraph(storyboard),
        );
        const environmentPlan = resolveProjectEnvironmentPlan(projectDir, storyboard, {
          compositionId,
          readingWindowsByScene: primaryReadingWindowsByScene(environmentBlocking),
        });
        const injection = environmentContract.injectPlan!(html, environmentPlan);
        const canonicalIslandSpacing = injection.html.replace(
          new RegExp(
            `([^\\r\\n])(<script\\b[^>]*\\bid\\s*=\\s*(["'])` +
              `${regexpEscape(ENVIRONMENT_PLAN_ID)}\\3[^>]*>)`,
            "i",
          ),
          "$1\n$2",
        );
        html = environmentContract.inject(environmentKit.inject(canonicalIslandSpacing));
        environmentContract.stage!(projectDir, environmentPlan);
        if (!/\bSequencesEnvironment\.compile\s*\(/.test(html)) {
          const timelineName = html.match(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
          )?.[1];
          if (timelineName) {
            const registration = timelineRegistrationAnchor(timelineName);
            if (registration.test(html)) {
              html = html.replace(
                registration,
                `SequencesEnvironment.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
              );
            }
          }
        }
        diagnostics.push(
          `[author] injected host environment ${environmentKit.file} v${environmentKit.version} ` +
            `for ${injection.injectedScenes.length} scene(s); wallpaper=${environmentPlan.wallpaper.id}` +
            `${injection.skippedScenes.length ? `, skipped=${injection.skippedScenes.join(",")}` : ""}\n`,
        );
      } else {
        html = stripEnvironmentContract(html)
          .replace(
            /<style\b[^>]*\bid\s*=\s*(["'])sequences-environment-kit\1[^>]*>[\s\S]*?<\/style>\s*/gi,
            "",
          )
          .replace(/^\s*SequencesEnvironment\.compile\([^\n]+\);\s*$/gmi, "")
          .replace(
            /\n?[ \t]*<script\b[^>]*\bsrc\s*=\s*(["'])sequences-environment\.v1\.js\1[^>]*>\s*<\/script>/gi,
            "",
          );
      }
      return {
        state: html,
        repairCount: html === source ? 0 : 1,
        telemetryCount: 0,
        diagnostics,
      };
    },
  },
  {
    id: "normalize.host-plan-islands.display-type",
    telemetryTag: "display-type-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = injectDisplayTypeMoments(html, lockedStoryboard ?? draft.storyboard);
      const changed = result.html !== html;
      return {
        state: result.html,
        repairCount: changed ? 1 : 0,
        telemetryCount: 0,
        diagnostics: changed && result.injected.length
          ? [`[author] injected host display-type moment for ${result.injected.join(", ")}\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.plugin-lower.source-inject",
    telemetryTag: "plugin-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      if (!pluginsEnabled()) return { state: html, repairCount: 0 };
      const result = injectPluginContract(html, lockedStoryboard ?? draft.storyboard);
      const changed = result.html !== html;
      return {
        state: result.html,
        repairCount: changed ? 1 : 0,
        telemetryCount: changed ? result.injected.length || 1 : 0,
        diagnostics: changed
          ? [
              `[author] injected ${result.injected.length} host-generated ` +
              `plugin unit(s): ${result.injected.join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.component-pre-continuity",
    telemetryTag: "component-binding",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = reconcileComponentBindings(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repairs,
        afterTelemetry: result.repairs
          ? () => recordSentinelScaffoldRestoration("l2-normalize", result.repairs)
          : undefined,
        diagnostics: result.repairs
          ? [`[author] reconciled ${result.repairs} component binding(s)\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.component-style-scope",
    telemetryTag: "component-style-scope",
    run: (html: string) => {
      const result = scopeRingValueGeometryStyles(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] scoped ${result.repairs} ring-only value geometry rule(s) ` +
              `away from other typed components\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.component-region-home",
    telemetryTag: "component-region-home",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = rehomeRegionComponents(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [`[author] rehomed ${result.repairs} typed component(s) into declared camera station(s)\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.component-alias",
    telemetryTag: "component-alias",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = reconcileComponentInternalPartAliases(
        html,
        lockedStoryboard ?? draft.storyboard,
      );
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] materialized ${result.repairs} component-internal cut/camera alias part(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.rows-markup",
    telemetryTag: "rows-markup-topup",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = topUpRowsMarkup(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repaired.length,
        telemetryCount: 0,
        diagnostics: result.repaired.length
          ? [
              `[author] injected neutral revealable children for childless rows target(s): ` +
              `${result.repaired.join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.chat-beat-targets",
    telemetryTag: "chat-beat-target",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = reconcileChatBeatTargets(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [`[author] bound ${result.repairs} chat beat(s) to authored internal text targets\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.underline-markup",
    telemetryTag: "underline-markup-topup",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = topUpUnderlineMarkup(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repaired.length,
        telemetryCount: 0,
        diagnostics: result.repaired.length
          ? [
              `[author] injected kit fx-underline markup for highlight underline target(s): ` +
              `${result.repaired.join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.kit-chart-complete",
    telemetryTag: "kit-chart-complete",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = topUpChartMarkup(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repaired.length,
        telemetryCount: 0,
        diagnostics: result.repaired.length
          ? [
              `[author] injected kit chart bars/stroke for chartless chart target(s): ` +
              `${result.repaired.join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.kit-progress-complete",
    telemetryTag: "kit-progress-complete",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = topUpProgressMarkup(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repaired.length,
        telemetryCount: 0,
        diagnostics: result.repaired.length
          ? [
              `[author] injected kit progress fill for fill-less progress target(s): ` +
              `${result.repaired.join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.cuts",
    telemetryTag: "cut-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const cutPlan = resolveCutPlan(lockedStoryboard ?? draft.storyboard);
      let repairedCuts = 0;
      if (cutPlan.cuts.length) {
        const cutContract = hostContract("cut");
        if (
          !html.includes(`src="${cutContract.file}"`) &&
          !html.includes(`src='${cutContract.file}'`)
        ) {
          const withRuntime = cutContract.inject(html);
          if (withRuntime !== html) {
            html = withRuntime;
            repairedCuts += 1;
          }
        }
        const payload = JSON.stringify(cutPlan);
        const cutIslandPattern =
          /(<script\b[^>]*\bid\s*=\s*(["'])sequences-cuts\2[^>]*>)([\s\S]*?)(<\/script>)/i;
        if (cutIslandPattern.test(html)) {
          const updated = html.replace(cutIslandPattern, `$1${payload}$4`);
          if (updated !== html) {
            html = updated;
            repairedCuts += 1;
          }
        } else {
          const timelineScript =
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
          if (timelineScript?.index !== undefined) {
            html = html.slice(0, timelineScript.index) +
              `<script type="application/json" data-sequences-host="1" id="sequences-cuts">${payload}</script>\n` +
              html.slice(timelineScript.index);
            repairedCuts += 1;
          }
        }
        if (!/\bSequencesCuts\.compile\s*\(/.test(html)) {
          const timelineName = html.match(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
          )?.[1];
          if (timelineName) {
            const registration = timelineRegistrationAnchor(timelineName);
            if (registration.test(html)) {
              html = html.replace(
                registration,
                `SequencesCuts.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
              );
              repairedCuts += 1;
            }
          }
        }
      }
      return {
        state: html,
        repairCount: repairedCuts,
        telemetryCount: 0,
        diagnostics: repairedCuts
          ? [
              `[author] injected ${repairedCuts} deterministic cut binding(s) for ` +
              `${cutPlan.cuts.length} typed boundary cut(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.camera-runtime",
    telemetryTag: "camera-runtime-inject",
    run: (html: string) => {
      const cameraContract = hostContract("camera");
      const result = cameraContract.inject(html);
      const changed = result !== html;
      return {
        state: result,
        repairCount: changed ? 1 : 0,
        telemetryCount: 0,
        diagnostics: changed
          ? [`[author] injected camera/ease runtime ${cameraContract.file}\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.camera",
    telemetryTag: "camera-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const cameraPlan = resolveCameraPlan(lockedStoryboard ?? draft.storyboard);
      let repairedCamera = 0;
      if (cameraPlan.scenes.length) {
        const payload = JSON.stringify(cameraPlan);
        const cameraIslandPattern =
          /(<script\b[^>]*\bid\s*=\s*(["'])sequences-camera\2[^>]*>)([\s\S]*?)(<\/script>)/i;
        if (cameraIslandPattern.test(html)) {
          const updated = html.replace(cameraIslandPattern, `$1${payload}$4`);
          if (updated !== html) {
            html = updated;
            repairedCamera += 1;
          }
        } else {
          const timelineScript =
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
          if (timelineScript?.index !== undefined) {
            html = html.slice(0, timelineScript.index) +
              `<script type="application/json" data-sequences-host="1" id="sequences-camera">${payload}</script>\n` +
              html.slice(timelineScript.index);
            repairedCamera += 1;
          }
        }
        if (!/\bSequencesCamera\.compile\s*\(/.test(html)) {
          const timelineName = html.match(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
          )?.[1];
          if (timelineName) {
            const registration = timelineRegistrationAnchor(timelineName);
            if (registration.test(html)) {
              html = html.replace(
                registration,
                `SequencesCamera.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
              );
              repairedCamera += 1;
            }
          }
        }
      }
      return {
        state: html,
        repairCount: repairedCamera,
        telemetryCount: 0,
        diagnostics: repairedCamera
          ? [
              `[author] injected ${repairedCamera} deterministic camera binding(s) for ` +
              `${cameraPlan.scenes.length} scene camera path(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.continuity",
    telemetryTag: "camera-phrase-collapse",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const source = html;
      let repairedContinuity = 0;
      let collapsedPhraseTelemetry = 0;
      const diagnostics: string[] = [];
      if (continuityGraphEnabled()) {
        const continuityContract = hostContract("continuity");
        const storyboard = lockedStoryboard ?? draft.storyboard;
        const graph = resolveContinuityGraph(storyboard);
        const blocking = resolveCameraBlockingPlan(storyboard, graph);
        const bindings = reconcileContinuityBindings(html, graph);
        html = bindings.html;

        const upsertIsland = (id: string, payload: string): number => {
          const normalized = normalizeJsonIsland(html, id, payload);
          html = normalized.html;
          if (normalized.found) return normalized.repairs;
          const timelineScript =
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
          if (timelineScript?.index === undefined) return 0;
          html = html.slice(0, timelineScript.index) +
            `<script type="application/json" data-sequences-host="1" id="${id}">${payload}</script>\n` +
            html.slice(timelineScript.index);
          return 1;
        };
        repairedContinuity = bindings.stamped;
        repairedContinuity += upsertIsland("sequences-continuity", JSON.stringify(graph));
        const blockingRepairs = upsertIsland("sequences-camera-blocking", JSON.stringify(blocking));
        repairedContinuity += blockingRepairs;
        if (blockingRepairs) collapsedPhraseTelemetry = blocking.summary.collapsedPhraseCount;
        const withRuntime = continuityContract.inject(html);
        if (withRuntime !== html) {
          html = withRuntime;
          repairedContinuity += 1;
        }
        if (!/\bSequencesContinuity\.compile\s*\(/.test(html)) {
          const timelineName = html.match(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
          )?.[1];
          if (timelineName) {
            const registration = timelineRegistrationAnchor(timelineName);
            if (registration.test(html)) {
              html = html.replace(
                registration,
                `SequencesContinuity.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
              );
              repairedContinuity += 1;
            }
          }
        }
        if (repairedContinuity) {
          diagnostics.push(
            `[author] injected continuity graph (${graph.summary.entityCount} entities, ` +
              `${graph.summary.sharedElementHandoffCount} measured handoffs) + ` +
              `${blocking.summary.phraseCount} camera blocking phrase(s)\n`,
          );
        }
      } else {
        html = removeJsonIsland(
          removeJsonIsland(html, "sequences-continuity").html,
          "sequences-camera-blocking",
        ).html
          .replace(/^\s*SequencesContinuity\.compile\([^\n]+\);\s*$/gmi, "")
          .replace(
            /\n?[ \t]*<script\b[^>]*\bsrc\s*=\s*(["'])sequences-continuity\.v1\.js\1[^>]*>\s*<\/script>/gi,
            "",
          );
      }
      return {
        state: html,
        repairCount: repairedContinuity || (html === source ? 0 : 1),
        telemetryCount: collapsedPhraseTelemetry,
        diagnostics,
      };
    },
  },
  {
    id: "normalize.source-bindings.component-post-continuity",
    telemetryTag: "component-binding",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = reconcileComponentBindings(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repairs,
        afterTelemetry: result.repairs
          ? () => recordSentinelScaffoldRestoration("l2-normalize", result.repairs)
          : undefined,
        diagnostics: result.repairs
          ? [`[author] reconciled ${result.repairs} component binding(s)\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.components",
    telemetryTag: "component-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const componentPlan = resolveComponentPlan(lockedStoryboard ?? draft.storyboard);
      let repairedComponents = 0;
      if (componentPlan.scenes.length) {
        const componentContract = hostContract("component");
        const withRuntime = componentContract.inject(html);
        if (withRuntime !== html) {
          html = withRuntime;
          repairedComponents += 1;
        }
        const payload = JSON.stringify(componentPlan);
        const componentIslandPattern =
          /(<script\b[^>]*\bid\s*=\s*(["'])sequences-components\2[^>]*>)([\s\S]*?)(<\/script>)/i;
        if (componentIslandPattern.test(html)) {
          const updated = html.replace(componentIslandPattern, `$1${payload}$4`);
          if (updated !== html) {
            html = updated;
            repairedComponents += 1;
          }
        } else {
          const timelineScript =
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
          if (timelineScript?.index !== undefined) {
            html = html.slice(0, timelineScript.index) +
              `<script type="application/json" data-sequences-host="1" id="sequences-components">${payload}</script>\n` +
              html.slice(timelineScript.index);
            repairedComponents += 1;
          }
        }
        if (!/\bSequencesComponents\.compile\s*\(/.test(html)) {
          const timelineName = html.match(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
          )?.[1];
          if (timelineName) {
            const registration = timelineRegistrationAnchor(timelineName);
            if (registration.test(html)) {
              html = html.replace(
                registration,
                `SequencesComponents.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
              );
              repairedComponents += 1;
            }
          }
        }
      }
      const beatCount = componentPlan.scenes.reduce(
        (count, scene) => count + scene.beats.length,
        0,
      );
      return {
        state: html,
        repairCount: repairedComponents,
        telemetryCount: 0,
        diagnostics: repairedComponents
          ? [
              `[author] injected ${repairedComponents} deterministic component binding(s) for ` +
              `${beatCount} typed beat(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.fx-plan.source-inject",
    telemetryTag: "fx-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const fxPlan = resolveFxPlan(lockedStoryboard ?? draft.storyboard);
      let repairedFx = 0;
      if (fxPlan.effects.length) {
        const fxContract = hostContract("fx");
        if (
          !html.includes(`src="${fxContract.file}"`) &&
          !html.includes(`src='${fxContract.file}'`)
        ) {
          const withRuntime = fxContract.inject(html);
          if (withRuntime !== html) {
            html = withRuntime;
            repairedFx += 1;
          }
        }
        const payload = JSON.stringify(fxPlan);
        const fxIslandPattern =
          /(<script\b[^>]*\bid\s*=\s*(["'])sequences-fx\2[^>]*>)([\s\S]*?)(<\/script>)/i;
        if (fxIslandPattern.test(html)) {
          const updated = html.replace(fxIslandPattern, `$1${payload}$4`);
          if (updated !== html) {
            html = updated;
            repairedFx += 1;
          }
        } else {
          const timelineScript =
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
          if (timelineScript?.index !== undefined) {
            html = html.slice(0, timelineScript.index) +
              `<script type="application/json" data-sequences-host="1" id="sequences-fx">${payload}</script>\n` +
              html.slice(timelineScript.index);
            repairedFx += 1;
          }
        }
        if (!/\bSequencesFx\.compile\s*\(/.test(html)) {
          const timelineName = html.match(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
          )?.[1];
          if (timelineName) {
            const registration = timelineRegistrationAnchor(timelineName);
            if (registration.test(html)) {
              html = html.replace(
                registration,
                `SequencesFx.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
              );
              repairedFx += 1;
            }
          }
        }
      }
      return {
        state: html,
        repairCount: repairedFx,
        telemetryCount: 0,
        diagnostics: repairedFx
          ? [
              `[author] injected ${repairedFx} deterministic fx binding(s) for ` +
              `${fxPlan.effects.length} host-derived effect(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.asset-lower.source-inject",
    telemetryTag: "asset-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      let repairedAssets = 0;
      let beatCount = 0;
      if (assetsEnabled()) {
        const assetPlan = resolveAssetPlan(lockedStoryboard ?? draft.storyboard);
        beatCount = assetPlan.scenes.reduce((count, scene) => count + scene.beats.length, 0);
        if (assetPlan.scenes.length) {
          const assetContract = hostContract("asset");
          if (
            !html.includes(`src="${assetContract.file}"`) &&
            !html.includes(`src='${assetContract.file}'`)
          ) {
            const withRuntime = assetContract.inject(html);
            if (withRuntime !== html) {
              html = withRuntime;
              repairedAssets += 1;
            }
          }
          const payload = JSON.stringify(assetPlan);
          const assetIslandPattern =
            /(<script\b[^>]*\bid\s*=\s*(["'])sequences-assets\2[^>]*>)([\s\S]*?)(<\/script>)/i;
          if (assetIslandPattern.test(html)) {
            const updated = html.replace(assetIslandPattern, `$1${payload}$4`);
            if (updated !== html) {
              html = updated;
              repairedAssets += 1;
            }
          } else {
            const timelineScript =
              /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
            if (timelineScript?.index !== undefined) {
              html = html.slice(0, timelineScript.index) +
                `<script type="application/json" data-sequences-host="1" id="sequences-assets">${payload}</script>\n` +
                html.slice(timelineScript.index);
              repairedAssets += 1;
            }
          }
          if (!/\bSequencesAssets\.compile\s*\(/.test(html)) {
            const timelineName = html.match(
              /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
            )?.[1];
            if (timelineName) {
              const registration = timelineRegistrationAnchor(timelineName);
              if (registration.test(html)) {
                html = html.replace(
                  registration,
                  `SequencesAssets.compile(${timelineName}, document.querySelector("[data-composition-id]"));\n$1`,
                );
                repairedAssets += 1;
              }
            }
          }
        }
      }
      return {
        state: html,
        repairCount: repairedAssets,
        diagnostics: repairedAssets
          ? [
              `[author] injected ${repairedAssets} deterministic asset binding(s) for ` +
              `${beatCount} spring animation beat(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.recipe-reconcile.source-inject",
    telemetryTag: "recipe-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      if (!recipesEnabled()) return { state: html, repairCount: 0 };
      const result = injectRecipeContract(html, lockedStoryboard ?? draft.storyboard);
      const changed = result.html !== html;
      return {
        state: result.html,
        repairCount: changed ? 1 : 0,
        telemetryCount: changed ? result.injected.length || 1 : 0,
        diagnostics: changed
          ? [
              `[author] injected ${result.injected.length} host-instantiated ` +
              `recipe fragment(s): ${result.injected.join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.liveness",
    telemetryTag: "liveness-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = injectMissingLivenessBeats(html, lockedStoryboard ?? draft.storyboard);
      return {
        state: result.html,
        repairCount: result.repaired.length,
        telemetryCount: 0,
        diagnostics: result.repaired.length
          ? [
              `[author] injected deterministic liveness beat(s) for slide-like scene(s): ` +
              `${result.repaired.join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.component-kit",
    telemetryTag: "component-kit-inject",
    run: (html: string) => {
      const componentKit = hostContract("component").kit!;
      const result = componentKit.inject(html);
      const changed = result !== html;
      return {
        state: result,
        repairCount: changed ? 1 : 0,
        telemetryCount: 0,
        diagnostics: changed
          ? [
              `[author] injected host component kit ${componentKit.file} v${componentKit.version}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.cinema-kit",
    telemetryTag: "cinema-kit-inject",
    run: (html: string) => {
      const result = injectCinemaKit(html);
      const changed = result !== html;
      return {
        state: result,
        repairCount: changed ? 1 : 0,
        telemetryCount: 0,
        diagnostics: changed
          ? [`[author] injected host cinematography kit ${CINEMA_KIT_FILE} v${CINEMA_KIT_VERSION}\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.brand-base.cinema-profile",
    telemetryTag: "cinema-profile",
    run: (html: string, { projectDir }: SourceNormalizerContext) => {
      const frameMeta = readFrameMeta(projectDir);
      const profile = frameMeta?.materialProfile ?? "cinematic";
      const cinemaClasses = [
        ...(frameMeta?.basis === "light" ? ["cinema-light"] : []),
        `cinema-profile-${profile}`,
      ];
      const rootTag = /<[a-z][\w:-]*\b[^>]*\bdata-composition-id\s*=[^>]*>/i.exec(html);
      let changed = false;
      if (rootTag) {
        const tag = rootTag[0];
        const classMatch = /\bclass\s*=\s*(["'])([^"']*)\1/i.exec(tag);
        const existing = new Set((classMatch?.[2] ?? "").split(/\s+/).filter(Boolean));
        for (const className of cinemaClasses) existing.add(className);
        const value = [...existing].join(" ");
        const withClass = classMatch
          ? tag.slice(0, classMatch.index) + `class=${classMatch[1]}${value}${classMatch[1]}` +
            tag.slice(classMatch.index + classMatch[0].length)
          : tag.replace(/>$/, ` class="${value}">`);
        if (withClass !== tag) {
          html = html.slice(0, rootTag.index) + withClass +
            html.slice(rootTag.index + tag.length);
          changed = true;
        }
      }
      return {
        state: html,
        repairCount: changed ? 1 : 0,
        telemetryCount: 0,
        diagnostics: changed
          ? [
              `[author] applied cinematography profile ${profile}` +
              `${frameMeta?.basis === "light" ? " + light basis" : ""}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.world-layout-derive.styles",
    telemetryTag: "world-layout-style-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = injectWorldLayoutStyles(html, lockedStoryboard ?? draft.storyboard);
      const changed = result.html !== html;
      return {
        state: result.html,
        repairCount: changed ? Math.max(1, result.rules) : 0,
        telemetryCount: 0,
        diagnostics: changed && result.rules
          ? [`[author] injected ${result.rules} host-owned world-layout rule(s)\n`]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.layout-repair",
    telemetryTag: "layout-repair-style-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const result = injectLayoutRepairStyles(html, lockedStoryboard ?? draft.storyboard);
      const changed = result.html !== html;
      return {
        state: result.html,
        repairCount: changed ? Math.max(1, result.repairs) : 0,
        telemetryCount: 0,
        diagnostics: changed && result.repairs
          ? [
              `[author] injected ${result.repairs} deterministic layout repair style rule(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.dead-tween-strip",
    telemetryTag: "dead-tween-strip",
    run: (html: string) => {
      const result = stripDeadGsapTweens(html);
      return {
        state: result.html,
        repairCount: result.repairs,
        diagnostics: result.repairs
          ? [
              `[author] repaired ${result.repairs} dead GSAP tween(s) with missing/null target(s) ` +
              `(${result.removed} stripped, ${result.neutralized} inert-retargeted): ` +
              `${result.selectors.map((selector) => JSON.stringify(selector)).join(", ")}\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.host-plan-islands.time",
    telemetryTag: "time-inject",
    run: (html: string, { draft, lockedStoryboard }: SourceNormalizerContext) => {
      const timePlan = resolveTimeRampPlan(lockedStoryboard ?? draft.storyboard);
      let repairedTime = 0;
      if (timePlan.ramps.length) {
        const timeContract = hostContract("time");
        if (
          !html.includes(`src="${timeContract.file}"`) &&
          !html.includes(`src='${timeContract.file}'`)
        ) {
          const withRuntime = timeContract.inject(html);
          if (withRuntime !== html) {
            html = withRuntime;
            repairedTime += 1;
          }
        }
        const payload = JSON.stringify(timePlan);
        const timeIslandPattern =
          /(<script\b[^>]*\bid\s*=\s*(["'])sequences-time\2[^>]*>)([\s\S]*?)(<\/script>)/i;
        if (timeIslandPattern.test(html)) {
          const updated = html.replace(timeIslandPattern, `$1${payload}$4`);
          if (updated !== html) {
            html = updated;
            repairedTime += 1;
          }
        } else {
          const timelineScript =
            /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?gsap\.timeline\s*\(/i.exec(html);
          if (timelineScript?.index !== undefined) {
            html = html.slice(0, timelineScript.index) +
              `<script type="application/json" data-sequences-host="1" id="sequences-time">${payload}</script>\n` +
              html.slice(timelineScript.index);
            repairedTime += 1;
          }
        }
        if (!/\bSequencesTime\.wrap\s*\(/.test(html)) {
          const registration =
            /window\.__timelines\s*\[([^\]]+)\]\s*=\s*([A-Za-z_$][\w$]*)\s*;/;
          const match = registration.exec(html);
          if (match) {
            html = html.slice(0, match.index) +
              `var __seqWarped = SequencesTime.wrap(${match[2]}); ` +
              `window.__timelines[${match[1]}] = __seqWarped;` +
              html.slice(match.index + match[0].length);
            repairedTime += 1;
          }
        }
      }
      return {
        state: html,
        repairCount: repairedTime,
        telemetryCount: 0,
        diagnostics: repairedTime
          ? [
              `[author] injected ${repairedTime} deterministic time-warp binding(s) for ` +
              `${timePlan.ramps.length} speed ramp(s)\n`,
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.compile-order",
    telemetryTag: "compile-order",
    run: (html: string) => {
      const result = ensureHostCompileOrdering(html);
      return {
        state: result.html,
        repairCount: result.changed ? 1 : 0,
        diagnostics: result.changed
          ? [
              "[author] normalized host compile ordering (interactions follow final scene geometry)\n",
            ]
          : [],
      };
    },
  },
  {
    id: "normalize.source-bindings.runtime-order",
    telemetryTag: "runtime-order",
    run: (html: string) => {
      const result = ensureRuntimeScriptOrdering(html);
      return {
        state: result.html,
        repairCount: result.changed ? 1 : 0,
        diagnostics: result.changed
          ? [
              "[author] normalized host runtime <script> ordering (runtimes load after GSAP, before the inline timeline)\n",
            ]
          : [],
      };
    },
  },
] as const satisfies readonly UndeclaredNormalizer<string, SourceNormalizerContext>[], {
  order: SOURCE_NORMALIZER_ORDER,
  reads: ["source.html", "context.storyboard", "context.project-files"],
  writes: ["source.html"],
  atomicGroup: "source-composition",
  preconditions: [{
    id: "source-string",
    description: "input is the authored HTML source string",
  }],
  postconditions: [{
    id: "canonical-source",
    description: "source is canonical and ready for the complete static audit",
  }],
  idempotenceTestRef:
    "test/normalizerRegistry.test.ts#keeps-the-full-registry-byte-identical-and-convergent",
});

/** Focused syntax-only seam retained for minimized golden replay fixtures. */
export const SOURCE_SYNTAX_NORMALIZERS: readonly OrderedNormalizer<
  string,
  SourceNormalizerContext
>[] = NORMALIZERS.slice(0, 8);

export function runSourceSyntaxNormalizerRegistry(
  html: string,
  hooks?: NormalizerRuntimeHooks,
) {
  const draft: DirectCompositionDraft = { html, storyboard: [] };
  const result = runNormalizerRegistry(
    SOURCE_SYNTAX_NORMALIZERS,
    html,
    { draft, projectDir: process.cwd() },
    hooks,
  );
  const proof = withRepairProof({
    edits: result.state,
    intendedFinding: result.changedIds[0] ?? "none",
    beforeFindingClasses: [],
    afterFindingClasses: [],
    changed: result.state !== html,
  });
  return { ...result, state: proof.edits, proof: proof.proof };
}

/** Full source-repair seam used by the runner and order/parity tests. */
export function runSourceNormalizerRegistry(
  html: string,
  context: SourceNormalizerContext,
  hooks?: NormalizerRuntimeHooks,
) {
  const result = runNormalizerRegistry(NORMALIZERS, html, context, hooks);
  const proof = withRepairProof({
    edits: result.state,
    intendedFinding: result.changedIds[0] ?? "none",
    beforeFindingClasses: [],
    afterFindingClasses: [],
    changed: result.state !== html,
  });
  return { ...result, state: proof.edits, proof: proof.proof };
}

export function applyDeterministicSourceRepairs(
  draft: DirectCompositionDraft,
  projectDir: string,
  lockedStoryboard?: DirectScene[],
): DirectCompositionDraft {
  // Storyboard parsing normally performs this additive normalization before
  // source authoring. Re-run the narrow idempotent seam here so exact replays
  // and resumed jobs whose persisted plan predates the normalizer receive the
  // same executable held-result beat before host islands are injected.
  const heldResultDevelopment = topUpHeldInteractionResultDevelopment(draft.storyboard);
  const repairedDraft = heldResultDevelopment.normalized.length
    ? { ...draft, storyboard: heldResultDevelopment.scenes }
    : draft;
  const repairedLockedStoryboard = lockedStoryboard
    ? lockedStoryboard === draft.storyboard
      ? repairedDraft.storyboard
      : topUpHeldInteractionResultDevelopment(lockedStoryboard).scenes
    : undefined;
  const html = runSourceNormalizerRegistry(repairedDraft.html, {
    draft: repairedDraft,
    projectDir,
    lockedStoryboard: repairedLockedStoryboard,
  }).state;
  return html === repairedDraft.html ? repairedDraft : { ...repairedDraft, html };
}
interface CompositionPatch {
  search: string;
  replace: string;
}

type PatchLocation =
  | { kind: "ok"; start: number; end: number }
  | { kind: "missing" }
  | { kind: "ambiguous" };

/**
 * Find where a repair patch applies. Exact byte match wins. When that misses —
 * overwhelmingly because the model reflowed indentation or newlines in the search
 * snippet while keeping the substantive characters right — fall back to a
 * whitespace-flexible match: every run of whitespace in the search matches any run
 * in the source. The exactness guarantees are preserved: a fallback only applies
 * when it resolves to exactly one span, so we never silently edit the wrong place.
 */
function locatePatch(html: string, search: string): PatchLocation {
  const first = html.indexOf(search);
  if (first >= 0) {
    return html.indexOf(search, first + search.length) >= 0
      ? { kind: "ambiguous" }
      : { kind: "ok", start: first, end: first + search.length };
  }
  const trimmed = search.trim();
  if (!trimmed) return { kind: "missing" };
  const pattern = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  let matches: RegExpMatchArray[];
  try {
    matches = [...html.matchAll(new RegExp(pattern, "g"))];
  } catch {
    return { kind: "missing" };
  }
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "ambiguous" };
  const match = matches[0]!;
  return { kind: "ok", start: match.index!, end: match.index! + match[0].length };
}

/**
 * First inline-script syntax error in a document, mirroring the vendored
 * lint's `invalid_inline_script_syntax` rule (same script filter, same
 * `new Function` parse) so the per-patch gate below never disagrees with the
 * gate that would later reject the whole attempt.
 */
function inlineScriptSyntaxError(html: string): string | undefined {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] ?? "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (
      /\btype\s*=\s*["'](?:application\/json|application\/hyperframes-slideshow\+json|importmap|module)["']/
        .test(attrs)
    ) {
      continue;
    }
    const content = match[2] ?? "";
    if (!content.trim()) continue;
    try {
      // eslint-disable-next-line no-new-func — parse-only, never executed.
      new Function(content);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return undefined;
}

export function applyCompositionRepair(
  raw: string,
  scratch: DirectCompositionDraft,
): DirectCompositionDraft {
  // Some models ignore patch mode and return a complete replacement document.
  // It is still safe to recover: the normal static and browser validation gates
  // run immediately after this function, and the prior scratch stays available.
  const replacementHtml = firstHtmlDocument(raw);
  if (replacementHtml) {
    process.stderr.write(
      "[author] repair returned a complete document; recovered it for validation\n",
    );
    return { storyboard: scratch.storyboard, html: replacementHtml };
  }
  let value: unknown;
  try {
    const bareArray = firstJsonArray(raw);
    value =
      structuredArray(raw, "patches") ??
      (bareArray ? JSON.parse(bareArray) : JSON.parse(tagged(raw, "patches_json")));
  } catch (error) {
    throw new Error(
      `patches_json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REPAIR_PATCHES) {
    throw new Error(`patches_json must contain 1-${MAX_REPAIR_PATCHES} exact edits`);
  }
  const patches = value as CompositionPatch[];
  let html = scratch.html;
  let applied = 0;
  const rejected: string[] = [];
  // Per-patch syntax gate: a single edit that breaks an inline script's parse
  // reverts THAT edit instead of costing the whole attempt atomically (a
  // partial repair that fixes 3 findings is strictly better than a lost
  // attempt — the verify-ws1ws5-2 fallback ended exactly on this class). A
  // scratch that already fails the parse cannot be gated against itself.
  const gateScriptSyntax = inlineScriptSyntaxError(html) === undefined;
  for (const [index, patch] of patches.entries()) {
    if (
      !patch ||
      typeof patch.search !== "string" ||
      typeof patch.replace !== "string" ||
      !patch.search
    ) {
      rejected.push(
        `patches_json[${index}] must contain non-empty search and string replace`,
      );
      continue;
    }
    const located = locatePatch(html, patch.search);
    if (located.kind === "missing") {
      rejected.push(`patches_json[${index}].search was not found in scratch HTML`);
      continue;
    }
    if (located.kind === "ambiguous") {
      rejected.push(`patches_json[${index}].search is not unique in scratch HTML`);
      continue;
    }
    const candidate = html.slice(0, located.start) + patch.replace + html.slice(located.end);
    if (gateScriptSyntax) {
      const syntaxError = inlineScriptSyntaxError(candidate);
      if (syntaxError) {
        rejected.push(
          `patches_json[${index}] would break an inline script's syntax ` +
            `(${syntaxError.slice(0, 120)}) — reverted`,
        );
        continue;
      }
    }
    html = candidate;
    applied += 1;
  }
  if (applied === 0) {
    throw new Error(rejected[0] ?? "patches_json contained no applicable edits");
  }
  if (rejected.length) {
    process.stderr.write(
      `[author] applied ${applied}/${patches.length} safe patches; skipped ` +
        `${rejected.length}: ${rejected.slice(0, 3).join(" | ")}\n`,
    );
  }
  return { storyboard: scratch.storyboard, html };
}

/**
 * Optional interaction choreography must not be able to veto a healthy film.
 *
 * The model still gets bounded attempts to repair authored target/cursor
 * geometry. If browser evidence proves that a particular interaction remains
 * invalid, remove only that typed enhancement from both canonical stores. The
 * visual composition, timeline, spatial intent, and every healthy interaction
 * remain byte-for-byte unchanged and are validated again before publication.
 */
export function quarantineFailedInteractions(
  draft: DirectCompositionDraft,
  issues: DirectLayoutIssue[],
): { draft: DirectCompositionDraft; removedIds: string[] } {
  const removedIds = [...new Set(
    issues
      .filter((issue) =>
        issue.severity === "error" &&
        issue.code.startsWith("interaction_") &&
        Boolean(issue.interactionId)
      )
      .map((issue) => issue.interactionId!),
  )].sort();
  if (!removedIds.length) return { draft, removedIds: [] };

  const removed = new Set(removedIds);
  const storyboard: DirectScene[] = draft.storyboard.map((scene): DirectScene => {
    if (!scene.interactions?.some((interaction) => removed.has(interaction.id))) {
      return scene;
    }
    const interactions = scene.interactions.filter(
      (interaction) => !removed.has(interaction.id),
    );
    const { interactions: _discarded, ...withoutInteractions } = scene;
    return interactions.length ? { ...scene, interactions } : withoutInteractions;
  });
  const interactions = storyboard.flatMap((scene) => scene.interactions ?? []);
  const payload = JSON.stringify({ version: 1, interactions });
  const island = normalizeJsonIsland(draft.html, "sequences-interactions", payload);
  if (!island.found) {
    // Static validation will reject the unchanged mismatch; do not pretend the
    // enhancement was isolated when its canonical island was absent.
    return { draft, removedIds: [] };
  }
  let html = island.html;
  const liveCursorIds = new Set(interactions.map((interaction) => interaction.cursorId));
  const orphanCursorIds = draft.storyboard
    .flatMap((scene) => scene.interactions ?? [])
    .filter((interaction) => removed.has(interaction.id))
    .map((interaction) => interaction.cursorId)
    .filter((cursorId) => !liveCursorIds.has(cursorId));
  if (orphanCursorIds.length) {
    const selectors = [...new Set(orphanCursorIds)]
      .map((cursorId) =>
        `[data-cursor-id="${cursorId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
      )
      .join(",");
    html = html.replace(
      /<\/head>/i,
      `<style data-sequences-quarantine>${selectors}{display:none!important}</style></head>`,
    );
  }
  return { draft: { storyboard, html }, removedIds };
}

export function browserInteractionIssues(
  draft: DirectCompositionDraft,
  browserQa: DirectBrowserQaResult,
): DirectLayoutIssue[] {
  const issues = [...browserQa.issues];
  if (
    !browserQa.errors.some((error) =>
      /unsupported sequences interaction plan|could not bind interaction|cursor "[^"]+" must be inside data-camera-overlay/i
        .test(error)
    )
  ) {
    return issues;
  }
  const alreadyScoped = new Set(
    issues
      .filter((issue) => issue.code.startsWith("interaction_") && issue.interactionId)
      .map((issue) => issue.interactionId!),
  );
  for (const interaction of draft.storyboard.flatMap((scene) => scene.interactions ?? [])) {
    if (alreadyScoped.has(interaction.id)) continue;
    issues.push({
      code: "interaction_runtime_plan",
      severity: "error",
      time: interaction.startSec,
      interactionId: interaction.id,
      selector: `[interaction="${interaction.id}"]`,
      message: "Optional interaction plan failed browser runtime compilation.",
      fixHint: "Publish the film without this optional cursor choreography.",
      source: "sequences",
    });
  }
  return issues;
}

export function quarantineStaticInteractionErrors(
  draft: DirectCompositionDraft,
  errors: string[],
): { draft: DirectCompositionDraft; removedIds: string[] } | undefined {
  const interactions = draft.storyboard.flatMap((scene) => scene.interactions ?? []);
  if (!interactions.length || !errors.length) return undefined;
  const interactionError = (error: string): boolean =>
    /^(?:interaction\b|storyboard declares .*interactions|HTML bind(?:s|ing)\b|duplicate interaction id\b|sequences-interactions\b|interaction composition must\b)/i
      .test(error);
  if (!errors.every(interactionError)) return undefined;
  const knownIds = new Set(interactions.map((interaction) => interaction.id));
  const mentionedIds = new Set<string>();
  let hasGeneralContractError = false;
  for (const error of errors) {
    const id = error.match(
      /(?:interaction|HTML binds undeclared interaction|HTML binding for interaction)\s+"([^"]+)"/i,
    )?.[1];
    if (id && knownIds.has(id)) mentionedIds.add(id);
    else hasGeneralContractError = true;
  }
  const removeIds = hasGeneralContractError || !mentionedIds.size
    ? [...knownIds]
    : [...mentionedIds];
  return quarantineFailedInteractions(
    draft,
    removeIds.map((interactionId): DirectLayoutIssue => ({
      code: "interaction_static_contract",
      severity: "error",
      time: 0,
      interactionId,
      selector: `[interaction="${interactionId}"]`,
      message: "Optional interaction failed the static publication contract.",
      fixHint: "Publish the visual film without this optional interaction.",
      source: "sequences",
    })),
  );
}

export async function recoverByQuarantiningInteractions(
  projectDir: string,
  candidate: {
    draft: DirectCompositionDraft;
    raw: string;
    browserQa: DirectBrowserQaResult;
  },
): Promise<
  | { result: CompositionRunResult; browserQa: DirectBrowserQaResult }
  | undefined
> {
  const quarantined = quarantineFailedInteractions(
    candidate.draft,
    browserInteractionIssues(candidate.draft, candidate.browserQa),
  );
  if (!quarantined.removedIds.length) return undefined;
  process.stderr.write(
    `[author] quarantining ${quarantined.removedIds.length} persistently invalid optional ` +
      `interaction(s): ${quarantined.removedIds.join(", ")}\n`,
  );
  const validation = await validateDirectComposition(projectDir, quarantined.draft);
  if (!validation.ok) return undefined;
  const browserQa = await inspectDirectComposition(projectDir, quarantined.draft, {
    captureGuide: false,
  });
  if (!browserQa.ok && !browserQa.infraError) return undefined;
  return {
    result: {
      draft: quarantined.draft,
      raw: candidate.raw,
      attempts: 3,
      browserQa,
    },
    browserQa,
  };
}
/**
 * Bridged-cut boundaries the planner volunteered as enhancements: the brief
 * never asked for that cut style, so the film must not die for it. A style the
 * brief explicitly requested is never in this set — explicit requirements do
 * not silently degrade.
 */
export function volunteeredCutBoundaries(
  storyboard: DirectScene[],
  requirements: Pick<StoryboardPlanRequirements, "requireObjectMatch" | "requireShapeMatch">,
): Set<string> {
  const boundaries = new Set<string>();
  for (const [index, scene] of storyboard.entries()) {
    const next = storyboard[index + 1];
    if (!next || !scene.cut) continue;
    const volunteered =
      (scene.cut.style === "morph" && !requirements.requireShapeMatch) ||
      (scene.cut.style === "match" &&
        Boolean(scene.cut.focalPartOut && scene.cut.focalPartIn) &&
        !requirements.requireObjectMatch) ||
      // Legacy names survive in cached storyboards.
      (scene.cut.style === "shape-match" && !requirements.requireShapeMatch) ||
      (scene.cut.style === "object-match" && !requirements.requireObjectMatch);
    if (volunteered) boundaries.add(`${scene.id}->${next.id}`);
  }
  return boundaries;
}

/**
 * Strategy selection after a compact patch is statically rejected. A patch
 * whose candidate still carries a structural signature it was asked to fix is
 * not converging — repeating another compact patch against the same scratch
 * was exactly the 2026-07-04 stall, so the loop abandons the scratch and
 * spends its final attempt as a full-context re-author instead. Survivors
 * that volunteered-cut degradation can resolve deterministically do NOT
 * trigger the switch: the compact patch keeps its chance to repair everything
 * else, and the degradation rung retires the stuck boundary.
 */
export function repairStrategyAfterStaticRejection(args: {
  patchMode: boolean;
  signatures: ReadonlySet<string>;
  previousSignatures: ReadonlySet<string>;
  degradableBoundaries: ReadonlySet<string>;
}): "compact-repair" | "full-reauthor" {
  if (!args.patchMode) return "compact-repair";
  for (const signature of args.signatures) {
    if (!args.previousSignatures.has(signature)) continue;
    const boundary = cutSignatureBoundary(signature);
    if (boundary && args.degradableBoundaries.has(boundary)) continue;
    return "full-reauthor";
  }
  return "compact-repair";
}

interface CutDegradationResult {
  draft: DirectCompositionDraft;
  storyboard: DirectScene[];
  degraded: string[];
}

/**
 * Volunteered bridged cuts must never sink an otherwise valid film. When a
 * morph/match endpoint binding persists across two consecutive
 * static rejections (so it survived at least one model repair that was told
 * to fix it) and the brief did not explicitly request that cut style, degrade
 * the boundary to a swipe — a typed, non-bridged cut that preserves the
 * boundary beat and every moment bound to the cut landing — then re-run the
 * deterministic injections so the shipped island matches the shipped
 * storyboard. Explicitly requested bridged cuts are never degraded here; they
 * stay blocking and fall back honestly.
 */
export function degradeVolunteeredBridgedCuts(args: {
  draft: DirectCompositionDraft;
  errors: string[];
  storyboard: DirectScene[];
  requirements: Pick<StoryboardPlanRequirements, "requireObjectMatch" | "requireShapeMatch">;
  persistentSignatures: ReadonlySet<string>;
  projectDir: string;
}): CutDegradationResult | undefined {
  const volunteered = volunteeredCutBoundaries(args.storyboard, args.requirements);
  const stuck = new Set<string>();
  for (const error of args.errors) {
    const signature = findingSignature(error);
    const boundary = cutSignatureBoundary(signature);
    if (!boundary || !volunteered.has(boundary)) continue;
    if (!args.persistentSignatures.has(signature)) continue;
    stuck.add(boundary);
  }
  if (!stuck.size) return undefined;
  const degraded: string[] = [];
  const storyboard = args.storyboard.map((scene, index) => {
    const next = args.storyboard[index + 1];
    if (!next || !scene.cut || !stuck.has(`${scene.id}->${next.id}`)) return scene;
    degraded.push(`${scene.id}->${next.id} (${scene.cut.style})`);
    // MD1 retarget: the degrade target is a swipe (right-travel — the static
    // gate has no measured focal geometry to derive an axis from), keeping the
    // boundary typed, energetic enough to hold the beat, and inside the
    // 3-transition language.
    return {
      ...scene,
      cut: { version: 1 as const, style: "swipe" as const, axis: "right" as const },
      outgoingCut:
        `Swipe into "${next.title}" (a volunteered ${scene.cut.style} with persistently ` +
        `unbindable focal parts was retired at repair time).`,
    };
  });
  if (!degraded.length) return undefined;
  const draft = applyDeterministicSourceRepairs(
    { storyboard, html: args.draft.html },
    args.projectDir,
    storyboard,
  );
  return { draft, storyboard, degraded };
}
/** The raw runtime-degradation warning emitted by browser QA. The degrade
 * target is measured at bind time: `swipe-<axis>` for a retargeted morph
 * (MD1), `zoom-through` for legacy runtimes replaying cached islands. */
const RAW_DEGRADED_CUT_WARNING =
  /^cut_degraded: \S+ ([\w-]+)->([\w-]+) compiled as ([\w-]+): (.*)$/;

/**
 * Pure half of the paperwork reconciler: rewrite every runtime-degraded
 * declared bridged cut in the SHIPPED storyboard as the cut that actually
 * executed (an axis-derived swipe, or zoom-through on legacy runtimes), with
 * honest advertising prose. Exported for tests.
 */
export function rewriteDegradedCutStoryboard(
  shipped: DirectScene[],
  qaWarnings: string[],
): { storyboard: DirectScene[]; rewritten: string[] } {
  const degraded = new Map<string, { target: string; reason: string }>();
  for (const warning of qaWarnings) {
    const match = warning.match(RAW_DEGRADED_CUT_WARNING);
    if (match) {
      degraded.set(`${match[1]}->${match[2]}`, {
        target: match[3] ?? "zoom-through",
        reason: match[4] ?? "",
      });
    }
  }
  const rewritten: string[] = [];
  if (!degraded.size) return { storyboard: shipped, rewritten };
  const storyboard = shipped.map((scene, index) => {
    const next = shipped[index + 1];
    const cut = scene.cut;
    if (!next || !cut) return scene;
    if (
      cut.style !== "morph" && cut.style !== "match" &&
      cut.style !== "shape-match" && cut.style !== "object-match"
    ) return scene;
    const outcome = degraded.get(`${scene.id}->${next.id}`);
    if (outcome === undefined) return scene;
    rewritten.push(`${scene.id}->${next.id} (${cut.style})`);
    const swipeAxis = outcome.target.match(/^swipe-(left|right|up|down)$/)?.[1] as
      | CutAxis
      | undefined;
    const executed = swipeAxis
      ? { style: "swipe" as const, axis: swipeAxis }
      : { style: "zoom-through" as const };
    return {
      ...scene,
      cut: {
        version: 1 as const,
        ...executed,
        // Keep any authored boundary timing so the executed window stays put.
        ...(cut.travelPx !== undefined ? { travelPx: cut.travelPx } : {}),
        ...(cut.exitSec !== undefined ? { exitSec: cut.exitSec } : {}),
        ...(cut.entrySec !== undefined ? { entrySec: cut.entrySec } : {}),
      },
      outgoingCut:
        `${swipeAxis ? `Swipe ${swipeAxis}` : "Zoom-through"} into "${next.title}" ` +
        `(a declared ${cut.style} was degraded at bind time: ${outcome.reason}).`,
    };
  });
  return { storyboard, rewritten };
}
