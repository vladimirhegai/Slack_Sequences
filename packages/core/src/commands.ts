/**
 * The command API (T5) — the ONE mutation pathway for everything. UI drags,
 * CLI calls, and (in Phase 1) agent MCP tools are all these same operations.
 *
 * `applyCommand(project, cmd)` is pure: it returns the next project plus the
 * exact inverse command, which is what makes undo/redo and "revert everything
 * the agent just did" free. Commands are zod-validated because agents emit
 * them as JSON.
 */
import { z } from "zod";
import {
  AssetSchema,
  AudioClipSchema,
  BoxSchema,
  CameraSchema,
  ChoreographySchema,
  CustomLayerSchema,
  EnabledExtensionsSchema,
  LayerOverrideSchema,
  SceneSchema,
  SlotValueSchema,
  TransitionKindSchema,
  type Project,
} from "./schema.ts";
import { COLOR_TOKEN_IDS } from "./tokens.ts";
import { enabledExtensionIds, registryExtensionIds } from "./registry/index.ts";

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const CommandSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("AddScene"), scene: SceneSchema, index: z.number().int().min(0).optional() }),
    z.object({ type: z.literal("RemoveScene"), sceneId: z.string() }),
    z.object({ type: z.literal("ReorderScene"), sceneId: z.string(), toIndex: z.number().int().min(0) }),
    z.object({ type: z.literal("SetSceneDuration"), sceneId: z.string(), durationFrames: z.number().int().min(15).max(1800) }),
    z.object({ type: z.literal("SetSceneArchetype"), sceneId: z.string(), archetype: z.string() }),
    z.object({ type: z.literal("ReplaceScene"), sceneId: z.string(), scene: SceneSchema }),
    z.object({ type: z.literal("SetSceneLayout"), sceneId: z.string(), layout: z.string() }),
    z.object({ type: z.literal("SetSlotContent"), sceneId: z.string(), slot: z.string(), value: SlotValueSchema.nullable() }),
    z.object({ type: z.literal("SetTransition"), afterSceneId: z.string(), kind: TransitionKindSchema.nullable() }),
    z.object({ type: z.literal("SetMotionProfile"), profile: z.string() }),
    z.object({ type: z.literal("SetEnabledExtensions"), enabled: EnabledExtensionsSchema }),
    z.object({ type: z.literal("SetBrandColor"), key: z.enum(COLOR_TOKEN_IDS), value: HexColor }),
    z.object({ type: z.literal("SetBrandFont"), key: z.enum(["display", "body"]), value: z.string().min(1) }),
    z.object({ type: z.literal("SetBrandLogo"), assetId: z.string().nullable() }),
    z.object({ type: z.literal("OverrideLayerBox"), sceneId: z.string(), layerId: z.string(), box: BoxSchema.partial().nullable() }),
    z.object({ type: z.literal("MoveLayer"), sceneId: z.string(), layerId: z.string(), x: z.number(), y: z.number() }),
    z.object({ type: z.literal("ResizeLayer"), sceneId: z.string(), layerId: z.string(), w: z.number().positive(), h: z.number().positive() }),
    z.object({ type: z.literal("SetLayerStyle"), sceneId: z.string(), layerId: z.string(), typeToken: z.string().optional(), colorToken: z.enum(COLOR_TOKEN_IDS).optional() }),
    z.object({ type: z.literal("SetText"), sceneId: z.string(), layerId: z.string(), text: z.string().max(500) }),
    z.object({ type: z.literal("SwapMotion"), sceneId: z.string(), layerId: z.string(), phase: z.enum(["enter", "exit", "emphasis", "continuous"]), primitive: z.string().nullable() }),
    z.object({ type: z.literal("AddMotion"), sceneId: z.string(), layerId: z.string(), phase: z.enum(["enter", "exit", "emphasis", "continuous"]), primitive: z.string(), atFrame: z.number().int().min(0).optional(), duration: z.enum(["instant", "quick", "base", "relaxed", "slow", "dramatic"]).optional() }),
    z.object({ type: z.literal("RemoveMotion"), sceneId: z.string(), layerId: z.string(), phase: z.enum(["enter", "exit", "emphasis", "continuous"]) }),
    z.object({ type: z.literal("SetMotionParam"), sceneId: z.string(), layerId: z.string(), phase: z.enum(["enter", "emphasis"]), param: z.enum(["duration", "atFrame"]), value: z.union([z.enum(["instant", "quick", "base", "relaxed", "slow", "dramatic"]), z.number().int().min(0), z.null()]) }),
    z.object({ type: z.literal("SetLayerOverride"), sceneId: z.string(), layerId: z.string(), patch: LayerOverrideSchema.nullable() }),
    z.object({ type: z.literal("SetChoreography"), sceneId: z.string(), choreography: ChoreographySchema }),
    z.object({ type: z.literal("SetSceneCamera"), sceneId: z.string(), camera: CameraSchema.nullable() }),
    z.object({ type: z.literal("AddLayer"), sceneId: z.string(), layer: CustomLayerSchema, index: z.number().int().min(0).optional() }),
    z.object({ type: z.literal("RemoveLayer"), sceneId: z.string(), layerId: z.string() }),
    z.object({ type: z.literal("AddAsset"), asset: AssetSchema, index: z.number().int().min(0).optional() }),
    z.object({ type: z.literal("RemoveAsset"), assetId: z.string() }),
    z.object({ type: z.literal("AddAudioClip"), clip: AudioClipSchema, index: z.number().int().min(0).optional() }),
    z.object({ type: z.literal("RemoveAudioClip"), clipId: z.string() }),
    z.object({ type: z.literal("Batch"), commands: z.array(CommandSchema).min(1).max(100) }),
  ]),
);

// The discriminated union above is self-referential (Batch), so we write the
// TS type by hand; a test asserts the schema accepts every command we apply.
export type Command =
  | { type: "AddScene"; scene: z.infer<typeof SceneSchema>; index?: number }
  | { type: "RemoveScene"; sceneId: string }
  | { type: "ReorderScene"; sceneId: string; toIndex: number }
  | { type: "SetSceneDuration"; sceneId: string; durationFrames: number }
  | { type: "SetSceneArchetype"; sceneId: string; archetype: string }
  | { type: "ReplaceScene"; sceneId: string; scene: z.infer<typeof SceneSchema> }
  | { type: "SetSceneLayout"; sceneId: string; layout: string }
  | { type: "SetSlotContent"; sceneId: string; slot: string; value: z.infer<typeof SlotValueSchema> | null }
  | { type: "SetTransition"; afterSceneId: string; kind: z.infer<typeof TransitionKindSchema> | null }
  | { type: "SetMotionProfile"; profile: string }
  | { type: "SetEnabledExtensions"; enabled: z.infer<typeof EnabledExtensionsSchema> }
  | { type: "SetBrandColor"; key: (typeof COLOR_TOKEN_IDS)[number]; value: string }
  | { type: "SetBrandFont"; key: "display" | "body"; value: string }
  | { type: "SetBrandLogo"; assetId: string | null }
  | { type: "OverrideLayerBox"; sceneId: string; layerId: string; box: Partial<z.infer<typeof BoxSchema>> | null }
  | { type: "MoveLayer"; sceneId: string; layerId: string; x: number; y: number }
  | { type: "ResizeLayer"; sceneId: string; layerId: string; w: number; h: number }
  | { type: "SetLayerStyle"; sceneId: string; layerId: string; typeToken?: string; colorToken?: (typeof COLOR_TOKEN_IDS)[number] }
  | { type: "SetText"; sceneId: string; layerId: string; text: string }
  | { type: "SwapMotion"; sceneId: string; layerId: string; phase: "enter" | "exit" | "emphasis" | "continuous"; primitive: string | null }
  | { type: "AddMotion"; sceneId: string; layerId: string; phase: "enter" | "exit" | "emphasis" | "continuous"; primitive: string; atFrame?: number; duration?: "instant" | "quick" | "base" | "relaxed" | "slow" | "dramatic" }
  | { type: "RemoveMotion"; sceneId: string; layerId: string; phase: "enter" | "exit" | "emphasis" | "continuous" }
  | { type: "SetMotionParam"; sceneId: string; layerId: string; phase: "enter" | "emphasis"; param: "duration" | "atFrame"; value: string | number | null }
  | { type: "SetLayerOverride"; sceneId: string; layerId: string; patch: z.infer<typeof LayerOverrideSchema> | null }
  | { type: "SetChoreography"; sceneId: string; choreography: z.infer<typeof ChoreographySchema> }
  | { type: "SetSceneCamera"; sceneId: string; camera: z.infer<typeof CameraSchema> | null }
  | { type: "AddLayer"; sceneId: string; layer: z.infer<typeof CustomLayerSchema>; index?: number }
  | { type: "RemoveLayer"; sceneId: string; layerId: string }
  | { type: "AddAsset"; asset: z.infer<typeof AssetSchema>; index?: number }
  | { type: "RemoveAsset"; assetId: string }
  | { type: "AddAudioClip"; clip: z.infer<typeof AudioClipSchema>; index?: number }
  | { type: "RemoveAudioClip"; clipId: string }
  | { type: "Batch"; commands: Command[] };

export class CommandError extends Error {}

function assertExtensionEnabled(
  kind: string,
  id: string,
  enabled: Set<string>,
  known: Set<string>,
): void {
  if (known.has(id) && !enabled.has(id)) {
    throw new CommandError(`extension disabled: ${kind} "${id}"`);
  }
}

/** Enforce the per-project extension vocabulary at the shared command layer. */
export function assertCommandUsesEnabled(project: Project, command: Command): void {
  if (command.type === "SetEnabledExtensions") return;
  const enabled = enabledExtensionIds(project);
  const known = new Set(registryExtensionIds());
  switch (command.type) {
    case "Batch": {
      let current = project;
      for (const sub of command.commands) {
        assertCommandUsesEnabled(current, sub);
        current = applyCommand(current, sub).project;
      }
      return;
    }
    case "AddScene":
      assertExtensionEnabled("archetype", command.scene.archetype, enabled, known);
      if (command.scene.camera) {
        assertExtensionEnabled("camera move", command.scene.camera.move, enabled, known);
      }
      for (const override of Object.values(command.scene.overrides)) {
        if (override.enterPrimitive) {
          assertExtensionEnabled("primitive", override.enterPrimitive, enabled, known);
        }
        if (override.exitPrimitive) {
          assertExtensionEnabled("primitive", override.exitPrimitive, enabled, known);
        }
        if (override.emphasisPrimitive) {
          assertExtensionEnabled("primitive", override.emphasisPrimitive, enabled, known);
        }
        if (override.continuousPrimitive) {
          assertExtensionEnabled("primitive", override.continuousPrimitive, enabled, known);
        }
      }
      return;
    case "SetMotionProfile":
      assertExtensionEnabled("profile", command.profile, enabled, known);
      return;
    case "SetSceneArchetype":
      assertExtensionEnabled("archetype", command.archetype, enabled, known);
      return;
    case "ReplaceScene":
      assertCommandUsesEnabled(project, { type: "AddScene", scene: command.scene });
      return;
    case "SetTransition":
      if (command.kind) assertExtensionEnabled("transition", command.kind, enabled, known);
      return;
    case "SwapMotion":
      if (command.primitive) assertExtensionEnabled("primitive", command.primitive, enabled, known);
      return;
    case "AddMotion":
      assertExtensionEnabled("primitive", command.primitive, enabled, known);
      return;
    case "SetLayerOverride":
      if (command.patch?.enterPrimitive) {
        assertExtensionEnabled("primitive", command.patch.enterPrimitive, enabled, known);
      }
      if (command.patch?.exitPrimitive) {
        assertExtensionEnabled("primitive", command.patch.exitPrimitive, enabled, known);
      }
      if (command.patch?.emphasisPrimitive) {
        assertExtensionEnabled("primitive", command.patch.emphasisPrimitive, enabled, known);
      }
      if (command.patch?.continuousPrimitive) {
        assertExtensionEnabled("primitive", command.patch.continuousPrimitive, enabled, known);
      }
      return;
    case "SetSceneCamera":
      if (command.camera) {
        assertExtensionEnabled("camera move", command.camera.move, enabled, known);
      }
      return;
    default:
      return;
  }
}

function findScene(project: Project, sceneId: string) {
  const index = project.scenes.findIndex((s) => s.id === sceneId);
  if (index === -1) throw new CommandError(`unknown scene: ${sceneId}`);
  return { scene: project.scenes[index]!, index };
}

/** Drop override entries that became empty so inverses roundtrip exactly. */
function pruneOverride(scene: Project["scenes"][number], layerId: string): void {
  const override = scene.overrides[layerId];
  if (override && Object.keys(override).length === 0) delete scene.overrides[layerId];
}

export interface ApplyResult {
  project: Project;
  inverse: Command;
}

export function applyCommand(input: Project, cmd: Command): ApplyResult {
  const project = structuredClone(input);

  switch (cmd.type) {
    case "AddScene": {
      if (project.scenes.some((s) => s.id === cmd.scene.id)) {
        throw new CommandError(`scene id already exists: ${cmd.scene.id}`);
      }
      const index = Math.min(cmd.index ?? project.scenes.length, project.scenes.length);
      project.scenes.splice(index, 0, cmd.scene);
      return { project, inverse: { type: "RemoveScene", sceneId: cmd.scene.id } };
    }
    case "RemoveScene": {
      const { scene, index } = findScene(project, cmd.sceneId);
      const transition = project.transitions[cmd.sceneId];
      project.scenes.splice(index, 1);
      delete project.transitions[cmd.sceneId];
      return {
        project,
        inverse:
          transition === undefined
            ? { type: "AddScene", scene, index }
            : {
                type: "Batch",
                commands: [
                  { type: "AddScene", scene, index },
                  { type: "SetTransition", afterSceneId: scene.id, kind: transition },
                ],
              },
      };
    }
    case "ReorderScene": {
      const { scene, index } = findScene(project, cmd.sceneId);
      const toIndex = Math.min(cmd.toIndex, project.scenes.length - 1);
      project.scenes.splice(index, 1);
      project.scenes.splice(toIndex, 0, scene);
      return { project, inverse: { type: "ReorderScene", sceneId: cmd.sceneId, toIndex: index } };
    }
    case "SetSceneDuration": {
      const { scene } = findScene(project, cmd.sceneId);
      const prev = scene.durationFrames;
      scene.durationFrames = cmd.durationFrames;
      return {
        project,
        inverse: { type: "SetSceneDuration", sceneId: cmd.sceneId, durationFrames: prev },
      };
    }
    case "SetSceneLayout": {
      const { scene } = findScene(project, cmd.sceneId);
      const prev = scene.layout ?? "";
      // "" is the canonical "use archetype default" — clears the field so
      // inverses of first-time layout sets roundtrip exactly.
      if (cmd.layout === "") delete scene.layout;
      else scene.layout = cmd.layout;
      return { project, inverse: { type: "SetSceneLayout", sceneId: cmd.sceneId, layout: prev } };
    }
    case "SetSlotContent": {
      const { scene } = findScene(project, cmd.sceneId);
      const prev = scene.slots[cmd.slot] ?? null;
      if (cmd.value === null) delete scene.slots[cmd.slot];
      else scene.slots[cmd.slot] = cmd.value;
      return {
        project,
        inverse: { type: "SetSlotContent", sceneId: cmd.sceneId, slot: cmd.slot, value: prev },
      };
    }
    case "SetTransition": {
      findScene(project, cmd.afterSceneId);
      const prev = project.transitions[cmd.afterSceneId] ?? null;
      if (cmd.kind === null) delete project.transitions[cmd.afterSceneId];
      else project.transitions[cmd.afterSceneId] = cmd.kind;
      return {
        project,
        inverse: { type: "SetTransition", afterSceneId: cmd.afterSceneId, kind: prev },
      };
    }
    case "SetMotionProfile": {
      const prev = project.motionProfile;
      project.motionProfile = cmd.profile;
      return { project, inverse: { type: "SetMotionProfile", profile: prev } };
    }
    case "SetSceneArchetype": {
      const { scene } = findScene(project, cmd.sceneId);
      const previous = structuredClone(scene);
      scene.archetype = cmd.archetype;
      delete scene.layout;
      scene.overrides = {};
      scene.choreography = {};
      return {
        project,
        inverse: { type: "ReplaceScene", sceneId: cmd.sceneId, scene: previous },
      };
    }
    case "ReplaceScene": {
      const { scene, index } = findScene(project, cmd.sceneId);
      if (cmd.scene.id !== cmd.sceneId) {
        throw new CommandError("ReplaceScene cannot change the scene id");
      }
      project.scenes[index] = cmd.scene;
      return {
        project,
        inverse: { type: "ReplaceScene", sceneId: cmd.sceneId, scene },
      };
    }
    case "SetEnabledExtensions": {
      const prev = project.extensions?.enabled ?? null;
      project.extensions = { enabled: cmd.enabled === null ? null : [...cmd.enabled] };
      return {
        project,
        inverse: {
          type: "SetEnabledExtensions",
          enabled: prev === null ? null : [...prev],
        },
      };
    }
    case "SetBrandColor": {
      const prev = project.brand.colors[cmd.key];
      project.brand.colors[cmd.key] = cmd.value;
      return { project, inverse: { type: "SetBrandColor", key: cmd.key, value: prev } };
    }
    case "SetBrandFont": {
      const prev = project.brand.fonts[cmd.key];
      project.brand.fonts[cmd.key] = cmd.value;
      return { project, inverse: { type: "SetBrandFont", key: cmd.key, value: prev } };
    }
    case "SetBrandLogo": {
      const previous = project.brand.logoAssetId ?? null;
      if (cmd.assetId === null) delete project.brand.logoAssetId;
      else project.brand.logoAssetId = cmd.assetId;
      return { project, inverse: { type: "SetBrandLogo", assetId: previous } };
    }
    case "OverrideLayerBox": {
      const { scene } = findScene(project, cmd.sceneId);
      const existing = scene.overrides[cmd.layerId];
      const prevBox = existing?.box ?? null;
      if (cmd.box === null) {
        if (existing) delete existing.box;
      } else {
        scene.overrides[cmd.layerId] = { ...existing, box: { ...existing?.box, ...cmd.box } };
      }
      pruneOverride(scene, cmd.layerId);
      return {
        project,
        inverse: { type: "OverrideLayerBox", sceneId: cmd.sceneId, layerId: cmd.layerId, box: prevBox },
      };
    }
    case "MoveLayer":
      return applyCommand(project, {
        type: "OverrideLayerBox",
        sceneId: cmd.sceneId,
        layerId: cmd.layerId,
        box: { x: cmd.x, y: cmd.y },
      });
    case "ResizeLayer":
      return applyCommand(project, {
        type: "OverrideLayerBox",
        sceneId: cmd.sceneId,
        layerId: cmd.layerId,
        box: { w: cmd.w, h: cmd.h },
      });
    case "SetLayerStyle": {
      const { scene } = findScene(project, cmd.sceneId);
      const previous = scene.overrides[cmd.layerId] ?? null;
      scene.overrides[cmd.layerId] = {
        ...(previous ?? {}),
        ...(cmd.typeToken ? { typeToken: cmd.typeToken as z.infer<typeof LayerOverrideSchema>["typeToken"] } : {}),
        ...(cmd.colorToken ? { colorToken: cmd.colorToken } : {}),
      };
      return {
        project,
        inverse: { type: "SetLayerOverride", sceneId: cmd.sceneId, layerId: cmd.layerId, patch: previous },
      };
    }
    case "SetText": {
      const { scene } = findScene(project, cmd.sceneId);
      const previous = scene.overrides[cmd.layerId] ?? null;
      scene.overrides[cmd.layerId] = { ...(previous ?? {}), text: cmd.text };
      return {
        project,
        inverse: { type: "SetLayerOverride", sceneId: cmd.sceneId, layerId: cmd.layerId, patch: previous },
      };
    }
    case "SwapMotion": {
      const { scene } = findScene(project, cmd.sceneId);
      const existing = scene.overrides[cmd.layerId] ?? {};
      const field =
        cmd.phase === "enter"
          ? "enterPrimitive"
          : cmd.phase === "exit"
            ? "exitPrimitive"
            : cmd.phase === "emphasis"
              ? "emphasisPrimitive"
              : "continuousPrimitive";
      const prev = existing[field] ?? null;
      if (cmd.primitive === null) delete existing[field];
      else existing[field] = cmd.primitive;
      scene.overrides[cmd.layerId] = existing;
      pruneOverride(scene, cmd.layerId);
      return {
        project,
        inverse: {
          type: "SwapMotion",
          sceneId: cmd.sceneId,
          layerId: cmd.layerId,
          phase: cmd.phase,
          primitive: prev,
        },
      };
    }
    case "AddMotion":
      return applyCommand(project, {
        type: "SetLayerOverride",
        sceneId: cmd.sceneId,
        layerId: cmd.layerId,
        patch: {
          ...(findScene(project, cmd.sceneId).scene.overrides[cmd.layerId] ?? {}),
          ...(cmd.phase === "enter" ? { enterPrimitive: cmd.primitive, ...(cmd.duration ? { enterDuration: cmd.duration } : {}) } : {}),
          ...(cmd.phase === "exit" ? { exitPrimitive: cmd.primitive } : {}),
          ...(cmd.phase === "emphasis"
            ? {
                emphasisPrimitive: cmd.primitive,
                ...(cmd.atFrame !== undefined ? { emphasisAtFrame: cmd.atFrame } : {}),
                ...(cmd.duration ? { emphasisDuration: cmd.duration } : {}),
              }
            : {}),
          ...(cmd.phase === "continuous" ? { continuousPrimitive: cmd.primitive } : {}),
        },
      });
    case "RemoveMotion": {
      const { scene } = findScene(project, cmd.sceneId);
      const previous = scene.overrides[cmd.layerId] ?? null;
      const next = { ...(previous ?? {}) };
      if (cmd.phase === "enter") {
        delete next.enterPrimitive;
        delete next.enterDuration;
      } else if (cmd.phase === "exit") {
        delete next.exitPrimitive;
      } else if (cmd.phase === "emphasis") {
        delete next.emphasisPrimitive;
        delete next.emphasisAtFrame;
        delete next.emphasisDuration;
      } else {
        delete next.continuousPrimitive;
      }
      if (Object.keys(next).length === 0) delete scene.overrides[cmd.layerId];
      else scene.overrides[cmd.layerId] = next;
      return {
        project,
        inverse: {
          type: "SetLayerOverride",
          sceneId: cmd.sceneId,
          layerId: cmd.layerId,
          patch: previous,
        },
      };
    }
    case "SetMotionParam": {
      if (cmd.param === "atFrame" && cmd.phase !== "emphasis") {
        throw new CommandError("atFrame is only valid for emphasis motion");
      }
      if (
        (cmd.param === "duration" && typeof cmd.value === "number") ||
        (cmd.param === "atFrame" && typeof cmd.value === "string")
      ) {
        throw new CommandError(`invalid ${cmd.param} value`);
      }
      const { scene } = findScene(project, cmd.sceneId);
      const previous = scene.overrides[cmd.layerId] ?? null;
      const next = { ...(previous ?? {}) };
      if (cmd.param === "duration") {
        const key = cmd.phase === "enter" ? "enterDuration" : "emphasisDuration";
        if (cmd.value === null) delete next[key];
        else next[key] = cmd.value as "instant" | "quick" | "base" | "relaxed" | "slow" | "dramatic";
      } else {
        if (cmd.value === null) delete next.emphasisAtFrame;
        else next.emphasisAtFrame = Number(cmd.value);
      }
      scene.overrides[cmd.layerId] = next;
      pruneOverride(scene, cmd.layerId);
      return {
        project,
        inverse: { type: "SetLayerOverride", sceneId: cmd.sceneId, layerId: cmd.layerId, patch: previous },
      };
    }
    case "SetLayerOverride": {
      const { scene } = findScene(project, cmd.sceneId);
      const prev = scene.overrides[cmd.layerId] ?? null;
      if (cmd.patch === null) delete scene.overrides[cmd.layerId];
      else scene.overrides[cmd.layerId] = { ...prev, ...cmd.patch };
      return {
        project,
        inverse: { type: "SetLayerOverride", sceneId: cmd.sceneId, layerId: cmd.layerId, patch: prev },
      };
    }
    case "SetChoreography": {
      const { scene } = findScene(project, cmd.sceneId);
      const prev = scene.choreography;
      scene.choreography = cmd.choreography;
      return {
        project,
        inverse: { type: "SetChoreography", sceneId: cmd.sceneId, choreography: prev },
      };
    }
    case "SetSceneCamera": {
      const { scene } = findScene(project, cmd.sceneId);
      const prev = scene.camera ?? null;
      if (cmd.camera === null) delete scene.camera;
      else scene.camera = cmd.camera;
      return {
        project,
        inverse: { type: "SetSceneCamera", sceneId: cmd.sceneId, camera: prev },
      };
    }
    case "AddAsset": {
      if (project.assets.some((a) => a.id === cmd.asset.id)) {
        throw new CommandError(`asset id already exists: ${cmd.asset.id}`);
      }
      const index = Math.min(cmd.index ?? project.assets.length, project.assets.length);
      project.assets.splice(index, 0, cmd.asset);
      return { project, inverse: { type: "RemoveAsset", assetId: cmd.asset.id } };
    }
    case "RemoveAsset": {
      // Removing an asset a slot still references is rejected downstream by
      // validateProject (the store gates on it) — no special case here.
      const index = project.assets.findIndex((a) => a.id === cmd.assetId);
      if (index === -1) throw new CommandError(`unknown asset: ${cmd.assetId}`);
      const [asset] = project.assets.splice(index, 1);
      return { project, inverse: { type: "AddAsset", asset: asset!, index } };
    }
    case "AddLayer": {
      const { scene } = findScene(project, cmd.sceneId);
      const custom = scene.customLayers ?? [];
      if (
        custom.some((layer) => layer.id === cmd.layer.id) ||
        scene.overrides[cmd.layer.id] !== undefined
      ) {
        throw new CommandError(`layer id already exists: ${cmd.layer.id}`);
      }
      const index = Math.min(cmd.index ?? custom.length, custom.length);
      custom.splice(index, 0, cmd.layer);
      scene.customLayers = custom;
      return {
        project,
        inverse: { type: "RemoveLayer", sceneId: cmd.sceneId, layerId: cmd.layer.id },
      };
    }
    case "RemoveLayer": {
      const { scene } = findScene(project, cmd.sceneId);
      const custom = scene.customLayers ?? [];
      const index = custom.findIndex((layer) => layer.id === cmd.layerId);
      if (index >= 0) {
        const [layer] = custom.splice(index, 1);
        if (custom.length === 0) delete scene.customLayers;
        return {
          project,
          inverse: { type: "AddLayer", sceneId: cmd.sceneId, layer: layer!, index },
        };
      }
      const previous = scene.overrides[cmd.layerId] ?? null;
      scene.overrides[cmd.layerId] = { ...(previous ?? {}), hidden: true };
      return {
        project,
        inverse: {
          type: "SetLayerOverride",
          sceneId: cmd.sceneId,
          layerId: cmd.layerId,
          patch: previous,
        },
      };
    }
    case "AddAudioClip": {
      if (project.audio.some((clip) => clip.id === cmd.clip.id)) {
        throw new CommandError(`audio clip id already exists: ${cmd.clip.id}`);
      }
      const index = Math.min(cmd.index ?? project.audio.length, project.audio.length);
      project.audio.splice(index, 0, cmd.clip);
      return { project, inverse: { type: "RemoveAudioClip", clipId: cmd.clip.id } };
    }
    case "RemoveAudioClip": {
      const index = project.audio.findIndex((clip) => clip.id === cmd.clipId);
      if (index === -1) throw new CommandError(`unknown audio clip: ${cmd.clipId}`);
      const [clip] = project.audio.splice(index, 1);
      return { project, inverse: { type: "AddAudioClip", clip: clip!, index } };
    }
    case "Batch": {
      let current = project;
      const inverses: Command[] = [];
      for (const sub of cmd.commands) {
        const result = applyCommand(current, sub);
        current = result.project;
        inverses.unshift(result.inverse);
      }
      return { project: current, inverse: { type: "Batch", commands: inverses } };
    }
    default: {
      throw new CommandError(`unknown command type: ${(cmd as { type: string }).type}`);
    }
  }
}
