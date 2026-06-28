import { createHash } from "node:crypto";

export const CURRENT_SCHEMA_VERSION = 3 as const;

export interface MigrationOptions {
  /** Host hook for hashing real asset bytes. Falls back to a stable legacy hash. */
  hashAssetPath?: (projectRelativePath: string) => string | undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cloneObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("project must be an object");
  }
  return structuredClone(input as Record<string, unknown>);
}

function remapAssetReferences(value: unknown, ids: Map<string, string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => remapAssetReferences(item, ids));
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.assetId === "string" && ids.has(record.assetId)) {
    record.assetId = ids.get(record.assetId)!;
  }
  Object.values(record).forEach((child) => remapAssetReferences(child, ids));
}

function migrate1To2(input: Record<string, unknown>, options: MigrationOptions): Record<string, unknown> {
  const project = structuredClone(input);
  const assets = Array.isArray(project.assets)
    ? (project.assets as Array<Record<string, unknown>>)
    : [];
  const remapped = new Map<string, string>();

  for (const asset of assets) {
    const oldId = String(asset.id ?? "asset");
    const assetPath = String(asset.path ?? "");
    const contentHash =
      options.hashAssetPath?.(assetPath) ?? sha256(`sequences-legacy-asset:${oldId}:${assetPath}`);
    const id = `asset-${contentHash.slice(0, 16)}`;
    remapped.set(oldId, id);
    asset.id = id;
    asset.contentHash = contentHash;
    asset.metadata = {
      dominantColors: [],
      cacheHint: "migrated-v1",
      ...((asset.metadata as Record<string, unknown> | undefined) ?? {}),
    };
  }

  remapAssetReferences(project.scenes, remapped);
  remapAssetReferences(project.audio, remapped);
  if (project.brand && typeof project.brand === "object") {
    remapAssetReferences(project.brand, remapped);
  }

  const transitions =
    project.transitions && typeof project.transitions === "object"
      ? (project.transitions as Record<string, unknown>)
      : {};
  for (const [sceneId, kind] of Object.entries(transitions)) {
    if (kind === "cut") transitions[sceneId] = "cutHold";
    if (kind === "fade") transitions[sceneId] = "crossFade";
  }

  project.audio ??= [];
  project.schemaVersion = 2;
  return project;
}

function migrate2To3(input: Record<string, unknown>): Record<string, unknown> {
  const project = structuredClone(input);
  const extensions =
    project.extensions && typeof project.extensions === "object"
      ? (project.extensions as Record<string, unknown>)
      : undefined;
  if (!extensions) project.extensions = { enabled: null };
  const configured = extensions?.enabled;
  if (Array.isArray(configured)) {
    const enabled = new Set(configured.filter((value): value is string => typeof value === "string"));
    for (const transition of [
      "cut",
      "fade",
      "cutHold",
      "crossFade",
      "wipeDirectional",
      "slidePush",
      "shader.flashThroughWhite",
      "shader.pixelMelt",
    ]) {
      enabled.add(transition);
    }
    if (typeof project.motionProfile === "string") enabled.add(project.motionProfile);
    const transitions =
      project.transitions && typeof project.transitions === "object"
        ? Object.values(project.transitions as Record<string, unknown>)
        : [];
    for (const transition of transitions) {
      if (typeof transition === "string" && transition !== "cut" && transition !== "fade") {
        enabled.add(transition);
      }
    }
    const scenes = Array.isArray(project.scenes)
      ? (project.scenes as Array<Record<string, unknown>>)
      : [];
    for (const scene of scenes) {
      if (typeof scene.archetype === "string") enabled.add(scene.archetype);
      const camera = scene.camera as Record<string, unknown> | undefined;
      if (typeof camera?.move === "string") enabled.add(camera.move);
      const overrides =
        scene.overrides && typeof scene.overrides === "object"
          ? Object.values(scene.overrides as Record<string, Record<string, unknown>>)
          : [];
      for (const override of overrides) {
        for (const field of [
          "enterPrimitive",
          "exitPrimitive",
          "emphasisPrimitive",
          "continuousPrimitive",
        ]) {
          if (typeof override[field] === "string") enabled.add(override[field]);
        }
      }
    }
    extensions!.enabled = [...enabled];
  }
  project.schemaVersion = 3;
  return project;
}

/**
 * Upgrade any supported project document to the current graph version.
 * Migrations are pure, ordered, and intentionally idempotent.
 */
export function migrateProject(input: unknown, options: MigrationOptions = {}): unknown {
  let project = cloneObject(input);
  let version = Number(project.schemaVersion ?? 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`unsupported schemaVersion ${String(project.schemaVersion)}`);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `project schemaVersion ${version} is newer than this build (${CURRENT_SCHEMA_VERSION})`,
    );
  }
  if (version === 1) {
    project = migrate1To2(project, options);
    version = 2;
  }
  if (version === 2) project = migrate2To3(project);
  return project;
}
