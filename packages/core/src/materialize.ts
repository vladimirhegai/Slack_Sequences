/**
 * Deterministic fill, stage B of the pipeline: archetype layout → layers,
 * profile selection table → motions, user/agent overrides → sparse patches.
 * Zero tokens, pure functions.
 */
import type { Project, Scene } from "./schema.ts";
import { sceneStartFrame } from "./schema.ts";
import { ARCHETYPES, PROFILES, PRIMITIVES } from "./registry/index.ts";
import type { MaterializedLayer, ProtoLayer, ResolvedMotion } from "./registry/types.ts";
import { solveScene, type SceneSchedule } from "./solver.ts";

export interface ResolvedScene {
  scene: Scene;
  startFrame: number;
  layers: MaterializedLayer[];
  schedule: SceneSchedule;
}

function motionFromPrimitiveDefaults(primitiveId: string): ResolvedMotion {
  const prim = PRIMITIVES[primitiveId];
  if (!prim) throw new Error(`unknown primitive: ${primitiveId}`);
  return { primitive: prim.id, ...prim.defaults };
}

export function materializeScene(project: Project, scene: Scene): MaterializedLayer[] {
  const archetype = ARCHETYPES[scene.archetype];
  if (!archetype) throw new Error(`unknown archetype: ${scene.archetype}`);
  const profile = PROFILES[project.motionProfile];
  if (!profile) throw new Error(`unknown profile: ${project.motionProfile}`);

  const protos = [
    ...archetype.materialize(scene, {
      W: project.meta.width,
      H: project.meta.height,
      brandName: project.brand.name,
      logoAssetId: project.brand.logoAssetId,
      assetKinds: Object.fromEntries(project.assets.map((asset) => [asset.id, asset.kind])),
    }),
    ...((scene.customLayers ?? []) as ProtoLayer[]),
  ];

  const layers: MaterializedLayer[] = [];
  for (const proto of protos) {
    const override = scene.overrides[proto.id];
    if (override?.hidden) continue;

    const assignment = profile.selection[proto.role];
    // Number slots always count up — codified taste, not a profile choice.
    let enter: ResolvedMotion | undefined =
      proto.kind === "number"
        ? { primitive: "enter.countUp", duration: "slow", easing: "enter.snap" }
        : assignment.enter;
    let exit: ResolvedMotion | undefined = profile.defaults.exits ? assignment.exit : undefined;
    let continuous = assignment.continuous;
    let emphasis: ResolvedMotion | undefined;

    if (override?.enterPrimitive) enter = motionFromPrimitiveDefaults(override.enterPrimitive);
    if (override?.exitPrimitive) exit = motionFromPrimitiveDefaults(override.exitPrimitive);
    if (override?.continuousPrimitive) {
      continuous = motionFromPrimitiveDefaults(override.continuousPrimitive);
    }
    if (override?.emphasisPrimitive) {
      emphasis = {
        ...motionFromPrimitiveDefaults(override.emphasisPrimitive),
        ...(override.emphasisAtFrame !== undefined ? { atFrame: override.emphasisAtFrame } : {}),
      };
    }
    if (enter && override?.enterDuration) enter = { ...enter, duration: override.enterDuration };
    if (emphasis && override?.emphasisDuration) {
      emphasis = { ...emphasis, duration: override.emphasisDuration };
    }

    layers.push({
      ...proto,
      box: override?.box ? { ...proto.box, ...override.box } : proto.box,
      typeToken: override?.typeToken ?? proto.typeToken,
      colorToken: override?.colorToken ?? proto.colorToken,
      content:
        override?.text !== undefined && proto.kind === "text"
          ? { ...proto.content, text: override.text }
          : proto.content,
      sceneId: scene.id,
      motions: { enter, exit, continuous, emphasis },
    });
  }
  return layers;
}

/** Materialize + choreograph every scene. The shared core of compile & lint. */
export function resolveProject(project: Project): ResolvedScene[] {
  return project.scenes.map((scene) => {
    const layers = materializeScene(project, scene);
    const profile = PROFILES[project.motionProfile]!;
    const schedule = solveScene(scene, layers, profile, project.meta.fps);
    return { scene, startFrame: sceneStartFrame(project, scene.id), layers, schedule };
  });
}
