/**
 * Persistent semantic continuity graph.
 *
 * A `data-part` identifies one rendered representation inside one scene. A
 * continuity entity identifies the product object the audience is following
 * across scenes. The host derives conservative identities from repeated part
 * ids / hero product shells and accepts explicit scene appearances for cases
 * where the representation changes. The resulting graph drives measured
 * shared-element handoffs and the camera-blocking previsualization.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalCutStyle } from "./cutContract.ts";
import type { DirectScene } from "./directComposition.ts";
import { slackSequencesEnvRawValue } from "./featureFlags.ts";

export const CONTINUITY_RUNTIME_VERSION = 1;
export const CONTINUITY_RUNTIME_FILE = "sequences-continuity.v1.js";

const RUNTIME_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
  CONTINUITY_RUNTIME_FILE,
);

export type ContinuityEntityKind =
  | "product-shell"
  | "trace"
  | "alert"
  | "metric"
  | "cta"
  | "generic";

export const CONTINUITY_ENTITY_KINDS: ReadonlySet<ContinuityEntityKind> =
  new Set(["product-shell", "trace", "alert", "metric", "cta", "generic"]);

export type ContinuityStateKind = "metric" | "button" | "progress" | "selection" | "shell";

export interface ContinuityStateV1 {
  kind: ContinuityStateKind;
  value: number | string | boolean;
}

/** Planner-facing declaration for one entity representation in one scene. */
export interface SceneContinuityAppearanceV1 {
  version: 1;
  entityId: string;
  part: string;
  kind?: ContinuityEntityKind;
  /** Human-readable representation change, e.g. "trace chip in result row". */
  representation?: string;
}

export interface ContinuityAppearanceV1 extends SceneContinuityAppearanceV1 {
  sceneId: string;
  sceneIndex: number;
  startSec: number;
  endSec: number;
  componentKind?: string;
  role?: "hero" | "support";
  source: "explicit" | "component" | "repeated-part" | "product-shell";
  /** State resolved by this appearance before its scene exits. */
  state?: ContinuityStateV1;
}

export interface ContinuityEntityV1 {
  id: string;
  kind: ContinuityEntityKind;
  appearances: ContinuityAppearanceV1[];
  traceableAcrossShots: number;
  /** Last state resolved by the entity's ordered appearances. */
  state?: ContinuityStateV1;
}

export type ContinuityHandoffMode = "shared-element" | "cut-owned" | "reacquire";

export interface ContinuityEdgeV1 {
  id: string;
  entityId: string;
  fromScene: string;
  fromPart: string;
  toScene: string;
  toPart: string;
  atSec: number;
  durationSec: number;
  mode: ContinuityHandoffMode;
  cutStyle: string;
  /** State already resolved at the outgoing endpoint. */
  state?: ContinuityStateV1;
  /** True only when the host can initialize the incoming endpoint exactly. */
  stateTransfer: boolean;
}

export interface ContinuityGraphV1 {
  version: 1;
  enabled: true;
  entities: ContinuityEntityV1[];
  edges: ContinuityEdgeV1[];
  summary: {
    entityCount: number;
    multiShotEntityCount: number;
    threeShotEntityCount: number;
    sharedElementHandoffCount: number;
  };
}

function stableName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{0,63}$/.test(raw) ? raw : "";
}

function classifyEntity(id: string, componentKind?: string): ContinuityEntityKind {
  const signal = `${id} ${componentKind ?? ""}`.toLowerCase();
  if (componentKind === "app-window" || /\b(?:product|app|browser)-(?:shell|window)\b/.test(signal)) {
    return "product-shell";
  }
  if (/\b(?:trace|span|request)\b/.test(signal)) return "trace";
  if (/\b(?:alert|anomal|incident|warning)\b/.test(signal)) return "alert";
  if (/\b(?:metric|stat|kpi|delta|score|mttr)\b/.test(signal)) return "metric";
  if (componentKind === "button" || /\b(?:cta|action|button|start|approve)\b/.test(signal)) {
    return "cta";
  }
  return "generic";
}

export function continuityGraphEnabled(): boolean {
  // The exact-source A/B in PROBE_LOG proved the blocking director is the
  // safer production path (substantially fewer off-frame samples and roughly
  // half the focal jerk). Keep one release rollback, but make the proven path
  // the default so an omitted Railway variable cannot silently restore the
  // independent-shot camera.
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_CONTINUITY_GRAPH") !== "0";
}

/** Malformed/duplicate declarations degrade away; this feature never earns a retry. */
export function normalizeStoryboardContinuity(
  value: unknown,
): SceneContinuityAppearanceV1[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): SceneContinuityAppearanceV1[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const entityId = stableName(item.entityId);
    const part = stableName(item.part);
    if (!entityId || !part || seen.has(`${entityId}:${part}`)) return [];
    seen.add(`${entityId}:${part}`);
    const kind = typeof item.kind === "string" &&
        CONTINUITY_ENTITY_KINDS.has(item.kind as ContinuityEntityKind)
      ? item.kind as ContinuityEntityKind
      : undefined;
    const representation = typeof item.representation === "string"
      ? item.representation.trim().slice(0, 120)
      : "";
    return [{
      version: 1,
      entityId,
      part,
      ...(kind ? { kind } : {}),
      ...(representation ? { representation } : {}),
    }];
  });
}

interface AppearanceSeed {
  entityId: string;
  part: string;
  kind?: ContinuityEntityKind;
  representation?: string;
  componentKind?: string;
  role?: "hero" | "support";
  source: ContinuityAppearanceV1["source"];
}

function stateFromSceneComponent(
  scene: DirectScene,
  part: string,
  componentKind: string | undefined,
): ContinuityStateV1 | undefined {
  const beats = (scene.beats ?? [])
    .filter((beat) => beat.component === part)
    .sort((a, b) => a.atSec - b.atSec);
  let state: ContinuityStateV1 | undefined;
  for (const beat of beats) {
    if (beat.kind === "count" && typeof beat.value === "number") {
      state = { kind: "metric", value: beat.value };
    } else if (beat.kind === "progress" && typeof beat.value === "number") {
      state = { kind: "progress", value: beat.value };
    } else if (beat.kind === "select" && typeof beat.item === "number") {
      state = { kind: "selection", value: beat.item };
    } else if ((beat.kind === "set-state" || beat.kind === "press") && beat.toState) {
      state = {
        kind: componentKind === "button" || componentKind === "toggle" ? "button" : "shell",
        value: beat.toState,
      };
    } else if (beat.kind === "open" || beat.kind === "close") {
      state = { kind: "shell", value: beat.kind === "open" ? "open" : "closed" };
    }
  }
  return state;
}

function appearanceAcceptsState(
  scene: DirectScene | undefined,
  appearance: ContinuityAppearanceV1,
  state: ContinuityStateV1 | undefined,
): boolean {
  if (!scene || !state) return false;
  const beatKinds = new Set(
    (scene.beats ?? []).filter((beat) => beat.component === appearance.part).map((beat) => beat.kind),
  );
  const kind = appearance.componentKind ?? "";
  if (state.kind === "metric") {
    return beatKinds.has("count") || ["stat-card", "count-up"].includes(kind);
  }
  if (state.kind === "progress") {
    return beatKinds.has("progress") || ["progress", "progress-ring"].includes(kind);
  }
  if (state.kind === "selection") {
    return beatKinds.has("select") || ["list", "table", "kanban", "sidebar", "dropdown"].includes(kind);
  }
  if (state.kind === "button") {
    return beatKinds.has("press") || beatKinds.has("set-state") || kind === "button" || kind === "toggle";
  }
  return beatKinds.has("set-state") || beatKinds.has("open") || beatKinds.has("close") ||
    ["app-window", "search", "command-palette", "modal", "terminal"].includes(kind);
}

function sceneSeeds(scene: DirectScene, repeatedParts: ReadonlySet<string>): AppearanceSeed[] {
  const seeds: AppearanceSeed[] = [];
  const claimedParts = new Set<string>();
  for (const appearance of scene.continuity ?? []) {
    const component = scene.components?.find((entry) => entry.id === appearance.part);
    seeds.push({
      entityId: appearance.entityId,
      part: appearance.part,
      ...(appearance.kind ? { kind: appearance.kind } : {}),
      ...(appearance.representation ? { representation: appearance.representation } : {}),
      ...(component ? { componentKind: component.kind, role: component.role } : {}),
      source: "explicit",
    });
    claimedParts.add(appearance.part);
  }
  for (const component of scene.components ?? []) {
    if (claimedParts.has(component.id)) continue;
    if (component.entityId) {
      seeds.push({
        entityId: component.entityId,
        part: component.id,
        componentKind: component.kind,
        role: component.role,
        source: "component",
      });
      claimedParts.add(component.id);
    } else if (repeatedParts.has(component.id)) {
      seeds.push({
        entityId: component.id,
        part: component.id,
        componentKind: component.kind,
        role: component.role,
        source: "repeated-part",
      });
      claimedParts.add(component.id);
    }
  }
  const focalPart = scene.spatialIntent?.focalPart;
  if (focalPart && repeatedParts.has(focalPart) && !claimedParts.has(focalPart)) {
    seeds.push({ entityId: focalPart, part: focalPart, source: "repeated-part" });
  }
  return seeds;
}

/**
 * Resolve the graph without reading source HTML. DOM binding is a later,
 * mechanical stamping pass, so source authoring never pays for graph paperwork.
 */
export function resolveContinuityGraph(scenes: DirectScene[]): ContinuityGraphV1 {
  const partScenes = new Map<string, Set<string>>();
  for (const scene of scenes) {
    const parts = new Set([
      ...(scene.components ?? []).map((component) => component.id),
      ...(scene.spatialIntent?.focalPart ? [scene.spatialIntent.focalPart] : []),
    ]);
    for (const part of parts) {
      const bucket = partScenes.get(part) ?? new Set<string>();
      bucket.add(scene.id);
      partScenes.set(part, bucket);
    }
  }
  const repeatedParts = new Set(
    [...partScenes].filter(([, owners]) => owners.size >= 2).map(([part]) => part),
  );
  const seedsByScene = scenes.map((scene) => sceneSeeds(scene, repeatedParts));

  // If three or more shots each carry exactly one hero app-window, treat those
  // representations as the persistent product shell unless explicitly claimed.
  const shellCandidates = scenes.flatMap((scene, sceneIndex) => {
    const windows = (scene.components ?? []).filter((component) =>
      component.kind === "app-window" && component.role === "hero"
    );
    if (windows.length !== 1) return [];
    const component = windows[0]!;
    const alreadyClaimed = seedsByScene[sceneIndex]!.some((seed) => seed.part === component.id);
    return alreadyClaimed ? [] : [{ sceneIndex, component }];
  });
  if (shellCandidates.length >= 3) {
    for (const { sceneIndex, component } of shellCandidates) {
      seedsByScene[sceneIndex]!.push({
        entityId: "product-shell",
        part: component.id,
        kind: "product-shell",
        componentKind: component.kind,
        role: component.role,
        source: "product-shell",
      });
    }
  }

  const appearancesByEntity = new Map<string, ContinuityAppearanceV1[]>();
  for (const [sceneIndex, scene] of scenes.entries()) {
    for (const seed of seedsByScene[sceneIndex]!) {
      const appearance: ContinuityAppearanceV1 = {
        version: 1,
        entityId: seed.entityId,
        part: seed.part,
        sceneId: scene.id,
        sceneIndex,
        startSec: scene.startSec,
        endSec: scene.startSec + scene.durationSec,
        ...(seed.kind ? { kind: seed.kind } : {}),
        ...(seed.representation ? { representation: seed.representation } : {}),
        ...(seed.componentKind ? { componentKind: seed.componentKind } : {}),
        ...(seed.role ? { role: seed.role } : {}),
        source: seed.source,
        ...(() => {
          const state = stateFromSceneComponent(scene, seed.part, seed.componentKind);
          return state ? { state } : {};
        })(),
      };
      const bucket = appearancesByEntity.get(seed.entityId) ?? [];
      if (!bucket.some((entry) => entry.sceneId === scene.id && entry.part === seed.part)) {
        bucket.push(appearance);
        appearancesByEntity.set(seed.entityId, bucket);
      }
    }
  }

  const entities: ContinuityEntityV1[] = [...appearancesByEntity]
    .map(([id, appearances]) => {
      const ordered = appearances.sort((a, b) => a.sceneIndex - b.sceneIndex || a.part.localeCompare(b.part));
      let carriedState: ContinuityStateV1 | undefined;
      const resolvedAppearances = ordered.map((appearance): ContinuityAppearanceV1 => {
        const inheritedState = appearanceAcceptsState(
          scenes[appearance.sceneIndex],
          appearance,
          carriedState,
        )
          ? carriedState
          : undefined;
        const resolvedState = appearance.state ?? inheritedState;
        // An incompatible representation breaks the proof chain. A later
        // authored beat may establish a new exact state, but the host must not
        // carry an older value through pixels it cannot initialize.
        carriedState = resolvedState;
        return resolvedState && !appearance.state
          ? { ...appearance, state: resolvedState }
          : appearance;
      });
      const explicitKind = resolvedAppearances.find((appearance) => appearance.kind)?.kind;
      return {
        id,
        kind: explicitKind ?? classifyEntity(id, resolvedAppearances[0]?.componentKind),
        appearances: resolvedAppearances,
        traceableAcrossShots: new Set(resolvedAppearances.map((appearance) => appearance.sceneId)).size,
        ...(() => {
          const state = [...resolvedAppearances].reverse().find((appearance) => appearance.state)?.state;
          return state ? { state } : {};
        })(),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges: ContinuityEdgeV1[] = [];
  for (const entity of entities) {
    // One shot may legitimately contain several representations of an entity
    // (a product shell plus its sidebar, or a trace path plus its result list).
    // Those are intra-shot composition, never continuity handoffs. Select one
    // stable representative per shot before connecting the graph so a bridge
    // cannot fly an entire product window into a sidebar and no self-edge is
    // emitted at the scene boundary.
    const appearanceScore = (appearance: ContinuityAppearanceV1): number =>
      (entity.kind === "product-shell" && appearance.componentKind === "app-window" ? 100 : 0) +
      (appearance.role === "hero" ? 40 : 0) +
      (appearance.source === "explicit" ? 20 : 0) +
      (appearance.source === "component" ? 10 : 0);
    const appearancesByScene = new Map<number, ContinuityAppearanceV1[]>();
    for (const appearance of entity.appearances) {
      const bucket = appearancesByScene.get(appearance.sceneIndex) ?? [];
      bucket.push(appearance);
      appearancesByScene.set(appearance.sceneIndex, bucket);
    }
    const handoffAppearances = [...appearancesByScene]
      .sort(([a], [b]) => a - b)
      .map(([, appearances]) => [...appearances].sort((a, b) =>
        appearanceScore(b) - appearanceScore(a) || a.part.localeCompare(b.part)
      )[0]!);
    for (let index = 1; index < handoffAppearances.length; index += 1) {
      const from = handoffAppearances[index - 1]!;
      const to = handoffAppearances[index]!;
      const fromScene = scenes[from.sceneIndex];
      if (!fromScene) continue;
      const adjacent = to.sceneIndex === from.sceneIndex + 1;
      const cutStyle = canonicalCutStyle(fromScene.cut?.style ?? "hard", fromScene.cut?.axis).style;
      // Transition compositing is exclusive per boundary, not per entity. Any
      // moving typed cut already owns the two scene plates; persistent objects
      // ride those plates. Launching an independent continuity clone during a
      // swipe (BeaconOps) or a different focal morph (Threadline) makes both
      // runtimes hide/fly incoming nodes and produces duplicate windows/rings.
      // A true hard cut has no moving plate, so continuity may own that seam.
      const cutOwns = adjacent && cutStyle !== "hard";
      const mode: ContinuityHandoffMode = !adjacent
        ? "reacquire"
        : cutOwns
          ? "cut-owned"
          : "shared-element";
      const durationSec = mode === "shared-element"
        ? Math.max(0.32, Math.min(0.72, (fromScene.cut?.entrySec ?? 0.38) + 0.14))
        : 0;
      const stateTransfer = appearanceAcceptsState(scenes[to.sceneIndex], to, from.state);
      edges.push({
        id: `${entity.id}:${from.sceneId}->${to.sceneId}`,
        entityId: entity.id,
        fromScene: from.sceneId,
        fromPart: from.part,
        toScene: to.sceneId,
        toPart: to.part,
        atSec: to.startSec,
        durationSec: Math.round(durationSec * 1000) / 1000,
        mode,
        cutStyle,
        ...(stateTransfer && from.state ? { state: from.state } : {}),
        stateTransfer,
      });
    }
  }
  return {
    version: 1,
    enabled: true,
    entities,
    edges,
    summary: {
      entityCount: entities.length,
      multiShotEntityCount: entities.filter((entity) => entity.traceableAcrossShots >= 2).length,
      threeShotEntityCount: entities.filter((entity) => entity.traceableAcrossShots >= 3).length,
      sharedElementHandoffCount: edges.filter((edge) => edge.mode === "shared-element").length,
    },
  };
}

function regexpEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Stamp graph identity onto exact part roots. Ambiguous mappings are skipped. */
export function reconcileContinuityBindings(
  html: string,
  graph: ContinuityGraphV1,
): { html: string; stamped: number } {
  const entitiesByPart = new Map<string, Set<string>>();
  for (const entity of graph.entities) {
    for (const appearance of entity.appearances) {
      const bucket = entitiesByPart.get(appearance.part) ?? new Set<string>();
      bucket.add(entity.id);
      entitiesByPart.set(appearance.part, bucket);
    }
  }
  let stamped = 0;
  let output = html;
  for (const [part, entityIds] of entitiesByPart) {
    if (entityIds.size !== 1) continue;
    const entityId = [...entityIds][0]!;
    const pattern = new RegExp(
      `<([a-z][\\w:-]*)\\b([^>]*\\bdata-part\\s*=\\s*(["'])${regexpEscape(part)}\\3[^>]*)>`,
      "gi",
    );
    output = output.replace(pattern, (tag, name: string, attributes: string) => {
      if (/\bdata-continuity-entity\s*=/i.test(attributes)) return tag;
      stamped += 1;
      return `<${name}${attributes} data-continuity-entity="${entityId}">`;
    });
  }
  return { html: output, stamped };
}

export function continuityRuntimeSource(): string {
  return fs.readFileSync(RUNTIME_SOURCE_PATH, "utf8");
}

export function continuityRuntimeHash(): string {
  return createHash("sha256").update(continuityRuntimeSource()).digest("hex");
}

export function injectContinuityRuntimeTag(html: string): string {
  if (html.includes(`src="${CONTINUITY_RUNTIME_FILE}"`) || html.includes(`src='${CONTINUITY_RUNTIME_FILE}'`)) {
    return html;
  }
  const cameraTag = new RegExp(
    `(<script\\b[^>]*\\bsrc\\s*=\\s*(["'])sequences-camera\\.v\\d+\\.js\\2[^>]*>\\s*</script>)`,
    "i",
  );
  if (cameraTag.test(html)) return html.replace(cameraTag, `$1\n<script src="${CONTINUITY_RUNTIME_FILE}"></script>`);
  return html.replace(
    /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
    `$1\n<script src="${CONTINUITY_RUNTIME_FILE}"></script>`,
  );
}

export function parseContinuityGraph(html: string): ContinuityGraphV1 | undefined {
  const match = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-continuity\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[2]) return undefined;
  try {
    const value = JSON.parse(match[2]) as Partial<ContinuityGraphV1>;
    return value.version === 1 && value.enabled === true && Array.isArray(value.entities) &&
        Array.isArray(value.edges)
      ? value as ContinuityGraphV1
      : undefined;
  } catch {
    return undefined;
  }
}
