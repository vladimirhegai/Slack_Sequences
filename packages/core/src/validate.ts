/**
 * Project validation: zod schema parse + referential invariants. A project
 * that fails validation cannot reach the compiler — the store rejects any
 * command whose resulting state is invalid.
 */
import { ProjectSchema, type Project } from "./schema.ts";
import { ARCHETYPES, PROFILES, PRIMITIVES, registryExtensionIds } from "./registry/index.ts";
import { migrateProject, type MigrationOptions } from "./migrations.ts";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** The parsed (defaults-applied) project when schema-valid. */
  project?: Project;
}

export function validateProject(input: unknown, migrationOptions: MigrationOptions = {}): ValidationResult {
  let migrated: unknown;
  try {
    migrated = migrateProject(input, migrationOptions);
  } catch (error) {
    return {
      ok: false,
      issues: [{ path: "schemaVersion", message: error instanceof Error ? error.message : String(error) }],
    };
  }
  const parsed = ProjectSchema.safeParse(migrated);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const project = parsed.data;
  const issues: ValidationIssue[] = [];
  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  const assetHashes = new Set<string>();
  const sceneIds = new Set<string>();
  const knownExtensions = new Set(registryExtensionIds());

  project.assets.forEach((asset, ai) => {
    if (assetIds.has(asset.id)) {
      issues.push({ path: `assets.${ai}.id`, message: `duplicate asset id "${asset.id}"` });
    }
    assetIds.add(asset.id);
    if (assetPaths.has(asset.path)) {
      issues.push({ path: `assets.${ai}.path`, message: `duplicate asset path "${asset.path}"` });
    }
    assetPaths.add(asset.path);
    const expectedId = `asset-${asset.contentHash.slice(0, 16)}`;
    if (asset.id !== expectedId) {
      issues.push({
        path: `assets.${ai}.id`,
        message: `content-addressed asset id must be "${expectedId}"`,
      });
    }
    if (assetHashes.has(asset.contentHash)) {
      issues.push({
        path: `assets.${ai}.contentHash`,
        message: `duplicate asset content hash "${asset.contentHash}"`,
      });
    }
    assetHashes.add(asset.contentHash);
  });

  if (project.brand.logoAssetId && !assetIds.has(project.brand.logoAssetId)) {
    issues.push({
      path: "brand.logoAssetId",
      message: `unknown logo asset "${project.brand.logoAssetId}"`,
    });
  }

  const audioIds = new Set<string>();
  project.audio.forEach((clip, index) => {
    if (audioIds.has(clip.id)) {
      issues.push({ path: `audio.${index}.id`, message: `duplicate audio clip id "${clip.id}"` });
    }
    audioIds.add(clip.id);
    const asset = project.assets.find((candidate) => candidate.id === clip.assetId);
    if (!asset) {
      issues.push({ path: `audio.${index}.assetId`, message: `unknown asset "${clip.assetId}"` });
    } else if (asset.kind !== "audio") {
      issues.push({
        path: `audio.${index}.assetId`,
        message: `asset "${clip.assetId}" is ${asset.kind}, not audio`,
      });
    }
  });

  if (project.extensions.enabled) {
    const enabledSeen = new Set<string>();
    project.extensions.enabled.forEach((id, i) => {
      if (!knownExtensions.has(id)) {
        issues.push({
          path: `extensions.enabled.${i}`,
          message: `unknown extension "${id}"`,
        });
      }
      if (enabledSeen.has(id)) {
        issues.push({
          path: `extensions.enabled.${i}`,
          message: `duplicate extension "${id}"`,
        });
      }
      enabledSeen.add(id);
    });
  }

  if (!PROFILES[project.motionProfile]) {
    issues.push({
      path: "motionProfile",
      message: `unknown profile "${project.motionProfile}" (known: ${Object.keys(PROFILES).join(", ")})`,
    });
  }

  project.scenes.forEach((scene, si) => {
    const base = `scenes.${si}(${scene.id})`;
    if (sceneIds.has(scene.id)) issues.push({ path: base, message: "duplicate scene id" });
    sceneIds.add(scene.id);

    const archetype = ARCHETYPES[scene.archetype];
    if (!archetype) {
      issues.push({
        path: `${base}.archetype`,
        message: `unknown archetype "${scene.archetype}" (known: ${Object.keys(ARCHETYPES).join(", ")})`,
      });
      return;
    }
    if (scene.layout && !archetype.layouts.includes(scene.layout)) {
      issues.push({
        path: `${base}.layout`,
        message: `archetype ${archetype.id} has layouts ${archetype.layouts.join("/")}, not "${scene.layout}"`,
      });
    }

    // Slots must match the archetype's slot schema.
    for (const [name, spec] of Object.entries(archetype.slots)) {
      const value = scene.slots[name];
      if (spec.required && value === undefined) {
        issues.push({ path: `${base}.slots.${name}`, message: "required slot missing" });
        continue;
      }
      if (value === undefined) continue;
      const kindOk =
        (spec.kind === "text" && typeof value === "string") ||
        (spec.kind === "textList" && Array.isArray(value)) ||
        (spec.kind === "number" && typeof value === "object" && "value" in value) ||
        (spec.kind === "media" && typeof value === "object" && "assetId" in value);
      if (!kindOk) {
        issues.push({ path: `${base}.slots.${name}`, message: `expected a ${spec.kind} value` });
        continue;
      }
      if (spec.kind === "textList" && Array.isArray(value) && spec.maxItems !== undefined) {
        if (value.length > spec.maxItems) {
          issues.push({
            path: `${base}.slots.${name}`,
            message: `at most ${spec.maxItems} items (got ${value.length})`,
          });
        }
      }
      if (spec.kind === "media" && typeof value === "object" && "assetId" in value) {
        if (!assetIds.has(value.assetId)) {
          issues.push({
            path: `${base}.slots.${name}`,
            message: `unknown asset "${value.assetId}"`,
          });
        }
      }
    }
    for (const name of Object.keys(scene.slots)) {
      if (!archetype.slots[name]) {
        issues.push({
          path: `${base}.slots.${name}`,
          message: `archetype ${archetype.id} has no slot "${name}"`,
        });
      }
    }

    // Overrides must reference real layers and role-correct primitives.
    const archetypeLayers = archetype.materialize(scene, {
      W: project.meta.width,
      H: project.meta.height,
      brandName: project.brand.name,
      logoAssetId: project.brand.logoAssetId,
      assetKinds: Object.fromEntries(project.assets.map((asset) => [asset.id, asset.kind])),
    });
    const archetypeLayerIds = new Set(archetypeLayers.map((layer) => layer.id));
    const layerIds = new Set(
      [...archetypeLayers, ...(scene.customLayers ?? [])].map((layer) => layer.id),
    );
    for (const [layerIndex, layer] of (scene.customLayers ?? []).entries()) {
      const duplicates = (scene.customLayers ?? []).filter((candidate) => candidate.id === layer.id);
      if (duplicates.length > 1 || archetypeLayerIds.has(layer.id)) {
        issues.push({
          path: `${base}.customLayers.${layerIndex}.id`,
          message: `duplicate custom layer id "${layer.id}"`,
        });
      }
      if (layer.content.assetId && !assetIds.has(layer.content.assetId)) {
        issues.push({
          path: `${base}.customLayers.${layerIndex}.content.assetId`,
          message: `unknown asset "${layer.content.assetId}"`,
        });
      }
    }
    if (scene.choreography.order) {
      const orderedIds = new Set<string>();
      scene.choreography.order.forEach((layerId, oi) => {
        if (!layerIds.has(layerId)) {
          issues.push({
            path: `${base}.choreography.order.${oi}`,
            message: `no layer "${layerId}" in this scene`,
          });
        } else if (orderedIds.has(layerId)) {
          issues.push({
            path: `${base}.choreography.order.${oi}`,
            message: `duplicate layer "${layerId}" in choreography order`,
          });
        }
        orderedIds.add(layerId);
      });
    }
    for (const [layerId, override] of Object.entries(scene.overrides)) {
      if (!layerIds.has(layerId)) {
        issues.push({
          path: `${base}.overrides.${layerId}`,
          message: `no layer "${layerId}" in this scene (have: ${[...layerIds].join(", ")})`,
        });
        continue;
      }
      for (const [field, expectedKind] of [
        ["enterPrimitive", "enter"],
        ["exitPrimitive", "exit"],
        ["emphasisPrimitive", "emphasis"],
        ["continuousPrimitive", "continuous"],
      ] as const) {
        const primitiveId = override[field];
        if (primitiveId === undefined) continue;
        const primitive = PRIMITIVES[primitiveId];
        if (!primitive) {
          issues.push({
            path: `${base}.overrides.${layerId}.${field}`,
            message: `unknown primitive "${primitiveId}"`,
          });
        } else if (primitive.kind !== expectedKind) {
          issues.push({
            path: `${base}.overrides.${layerId}.${field}`,
            message: `${primitiveId} is a ${primitive.kind} primitive, not ${expectedKind}`,
          });
        }
      }
    }
  });

  for (const afterSceneId of Object.keys(project.transitions)) {
    if (!sceneIds.has(afterSceneId)) {
      issues.push({
        path: `transitions.${afterSceneId}`,
        message: "transition references unknown scene",
      });
    }
  }

  return issues.length === 0 ? { ok: true, issues: [], project } : { ok: false, issues, project };
}
