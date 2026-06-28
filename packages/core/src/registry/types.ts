/**
 * Registry entry contracts. Primitives, archetypes, and profiles are the
 * "plugins" of the master plan (§7): everything built-in goes through these
 * exact interfaces so external content is a packaging problem, not an
 * architecture problem.
 *
 * Hard contract rule #1 (token purity): primitives receive ONLY resolved
 * token values via EmitContext — a primitive that wants `0.4s` has no way to
 * say it. CI enforces this by the easing-whitelist linter rule and by the
 * params being token types.
 */
import type {
  DistanceToken,
  DurationToken,
  EasingToken,
  ScaleToken,
  StaggerToken,
} from "../tokens.ts";
import type { Box, Scene, TransitionKind } from "../schema.ts";

export type LayerRole = "hero" | "support" | "media" | "list" | "badge" | "decor";
export type LayerKind = "text" | "number" | "image" | "video" | "device" | "shape";

export interface ResolvedMotion {
  primitive: string;
  duration: DurationToken;
  easing: EasingToken;
  distance?: DistanceToken;
  scale?: ScaleToken;
  /** Scene-relative explicit emphasis frame. */
  atFrame?: number;
}

/** A layer after deterministic layout, before choreography. */
export interface ProtoLayer {
  /** Stable id (slot name, or `${slot}-${index}` for list items). */
  id: string;
  role: LayerRole;
  /** 1 = hero. Drives entrance order and the one-loud-motion rule. */
  rank: number;
  kind: LayerKind;
  content: {
    text?: string;
    number?: { value: number; prefix: string; suffix: string };
    assetId?: string;
    mediaKind?: "image" | "video";
    /** For shape layers: a CSS background value (brand vars allowed). */
    css?: string;
  };
  box: Box;
  typeToken?: string;
  colorToken?: string;
  align?: "left" | "center" | "right";
  /** Badge/pill chrome. */
  chrome?: { background: string; radius: number; paddingX: number; paddingY: number };
  opacity?: number;
}

export interface MaterializedLayer extends ProtoLayer {
  sceneId: string;
  motions: {
    enter?: ResolvedMotion;
    exit?: ResolvedMotion;
    continuous?: ResolvedMotion;
    emphasis?: ResolvedMotion;
  };
}

/** What the compiler hands a primitive when emitting GSAP steps. */
export interface EmitContext {
  /** Selector of the layer container (owns box + mask). */
  containerSel: string;
  /** Selector of the inner content element (transform target). */
  innerSel: string;
  startSec: number;
  durationSec: number;
  /** Runtime GSAP ease string, already resolved from the easing token. */
  ease: string;
  easingToken: EasingToken;
  distancePx: number;
  scale: number;
  sceneStartSec: number;
  sceneDurationSec: number;
  layer: MaterializedLayer;
  fps: number;
  stageWidth: number;
  stageHeight: number;
}

export type GsapStep =
  | {
      kind: "fromTo";
      target: string;
      from: Record<string, string | number | boolean>;
      to: Record<string, string | number | boolean>;
      durationSec: number;
      ease: string;
      atSec: number;
    }
  | {
      kind: "to";
      target: string;
      vars: Record<string, string | number | boolean>;
      durationSec: number;
      ease: string;
      atSec: number;
    }
  | { kind: "set"; target: string; vars: Record<string, string | number | boolean>; atSec: number }
  /** Escape hatch for primitives needing imperative code (e.g. countUp).
   *  `code` may reference the in-scope `tl` timeline. Must declare its eases. */
  | { kind: "custom"; code: string; easesUsed: string[] };

export type PrimitiveKindT = "enter" | "exit" | "emphasis" | "continuous";

export interface MotionPrimitive {
  id: string;
  kind: PrimitiveKindT;
  /** One-line catalog summary — what the planner will see (T4). Write it
   *  like a senior designer briefing a junior: "use when…, never with…". */
  summary: string;
  tags: { energy: "calm" | "punchy"; style: "organic" | "mechanical" };
  defaults: {
    duration: DurationToken;
    easing: EasingToken;
    distance?: DistanceToken;
    scale?: ScaleToken;
  };
  /** Container gets overflow:hidden (mask reveals). */
  needsMask?: boolean;
  emit(ctx: EmitContext): GsapStep[];
}

export interface ArchetypeSlotSpec {
  kind: "text" | "textList" | "number" | "media";
  required: boolean;
  /** Copy budget per text value (linter `copy-budget` rule). */
  maxWords?: number;
  maxItems?: number;
}

export interface Archetype {
  id: string;
  summary: string;
  slots: Record<string, ArchetypeSlotSpec>;
  layouts: string[];
  defaultLayout: string;
  /** Duration heuristics in frames @30fps. */
  duration: { min: number; ideal: number; max: number };
  /** Pure layout: scene + canvas size → positioned proto-layers. */
  materialize(
    scene: Scene,
    ctx: {
      W: number;
      H: number;
      brandName: string;
      logoAssetId?: string;
      assetKinds: Record<string, "image" | "video" | "audio">;
    },
  ): ProtoLayer[];
}

export interface ProfileMotionAssignment {
  enter: ResolvedMotion;
  exit?: ResolvedMotion;
  continuous?: ResolvedMotion;
}

export interface MotionProfile {
  id: string;
  summary: string;
  defaults: {
    stagger: StaggerToken;
    settleGap: DurationToken;
    overlapBudget: number;
    transition: TransitionKind;
    /** Sum of foreground animation frames divided by scene frames. */
    motionDensityCeiling: number;
    /** Whether layers get per-layer exit motions (vs persist to the cut). */
    exits: boolean;
  };
  /** Selection-bias table: role → motion assignment (the plan's §4.4). */
  selection: Record<LayerRole, ProfileMotionAssignment>;
}
