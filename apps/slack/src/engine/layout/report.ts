/**
 * Browser QA for direct HyperFrames compositions.
 *
 * The installed runtime is pinned at HyperFrames 0.6.86 while the vendored CLI
 * source is newer and intentionally not installed in Railway. This adapter uses
 * the vendored inspector's browser audit (including local regression fixes),
 * then adds the small set of Sequences-specific relational checks that
 * HyperFrames cannot infer.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DirectCompositionDraft, DirectScene } from "../directComposition.ts";
import {
  INTERACTION_RUNTIME_FILE,
  interactionRuntimeSource,
  parseInteractionPlan,
  type InteractionIntentV1,
} from "../interactionContract.ts";
import {
  CUT_RUNTIME_FILE,
  cutMotionWindows,
  cutRuntimeSource,
  parseCutPlan,
} from "../cutContract.ts";
import {
  CAMERA_FULL_MOVES,
  CAMERA_RUNTIME_FILE,
  cameraMotionWindows,
  cameraRuntimeSource,
  parseCameraPlan,
} from "../cameraContract.ts";
import {
  CONTINUITY_RUNTIME_FILE,
  continuityRuntimeSource,
  parseContinuityGraph,
} from "../continuityGraph.ts";
import {
  buildCameraBlockingEvidence,
  type CameraBlockingEvidenceV1,
} from "../cameraBlocking.ts";
import {
  cameraPhraseTolerances,
  parseCameraPhrasePlan,
  type CameraPhrasePlanV1,
} from "../cameraPhrase.ts";
import {
  ENVIRONMENT_RUNTIME_FILE,
  environmentKitSource,
  environmentRuntimeSource,
  parseEnvironmentPlan,
} from "../environmentContract.ts";
import {
  COMPONENT_RUNTIME_FILE,
  componentMotionWindows,
  componentRuntimeSource,
  parseComponentPlan,
} from "../componentContract.ts";
import {
  TIME_RUNTIME_FILE,
  parseTimeRampPlan,
  timeRampRuntimeSource,
} from "../timeRamp.ts";
import { sourceTime, timeConversionService } from "../time.ts";
import { FX_RUNTIME_FILE, fxRuntimeSource } from "../fxContract.ts";
import { ASSET_RUNTIME_FILE, assetRuntimeSource } from "../assetRuntime.ts";
import { GRADE_SHIFT_DURATION_SEC } from "../gradeShift.ts";
import { recordSentinelNormalization } from "../sentinelTelemetry.ts";
import { resolveMomentContract } from "../storyboardMoments.ts";
import {
  pingPongCandidates,
  resolveBoundaryAttention,
  scoreEyeTraceBoundaries,
  scorePingPongPair,
} from "../eyeTrace.ts";
import { findBrowserExecutable } from "../render.ts";
import {
  captureContinuousMotionEvidence,
  continuousMotionEvidenceEnabled,
  continuousMotionQualityFindings,
  QUIET_WINDOW_REVIEW_SEC,
  type ContinuousMotionEvidenceV1,
} from "../continuousMotion.ts";
import {
  analyzeCompositionWashout,
  type CompositionWashoutEvidenceV1,
} from "../washoutAnalysis.ts";
import { slackSequencesEnvRawValue } from "../featureFlags.ts";
import {
  primaryBlockingTransitTimes,
  temporalSceneSampleTimes,
} from "../temporalSampling.ts";

/**
 * Two computed `transform` values render as the same deterministic state when
 * their matrices match component-wise within a sub-pixel epsilon. Rotated
 * elements vary by ~1e-6 across equivalent seek paths (browser/GSAP float
 * noise); genuine non-deterministic motion differs by orders of magnitude more,
 * and any resulting position shift is separately caught by the 0.1px rect
 * tolerance. `"none"` is treated as the 2D identity. This is the unit-tested
 * twin of the inline comparison used inside the in-browser timeline-contract
 * probe; keep the two in sync.
 */
export function timelineTransformsEquivalent(
  before: string,
  after: string,
  epsilon = 1e-3,
): boolean {
  const vector = (value: string): number[] | null => {
    if (value === "none") return [1, 0, 0, 1, 0, 0];
    const match = /^matrix(3d)?\(([^)]+)\)$/.exec(value);
    if (!match) return null;
    const values = match[2]!.split(",").map((entry) => Number(entry.trim()));
    return values.every((entry) => Number.isFinite(entry)) ? values : null;
  };
  const nearIdentity = (candidate: number[]): boolean => {
    const identity = candidate.length === 16
      ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      : [1, 0, 0, 1, 0, 0];
    return candidate.length === identity.length &&
      candidate.every((entry, index) => Math.abs(entry - identity[index]!) <= epsilon);
  };
  const left = vector(before);
  const right = vector(after);
  if (!left || !right) return before === after;
  if (left.length !== right.length) return nearIdentity(left) && nearIdentity(right);
  return left.every((entry, index) => Math.abs(entry - right[index]!) <= epsilon);
}

export type LayoutSeverity = "error" | "warning" | "info";

export interface LayoutRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type LayoutOverflow = Partial<Record<"left" | "right" | "top" | "bottom", number>>;

/**
 * Browser measurement for one typed primary whose visibility is load-bearing.
 * This is evidence, not another finding class: S6.10 uses the same measurement
 * before and after one host-owned containment repair.
 */
export interface LoadBearingContainmentEvidence {
  sceneId: string;
  part: string;
  detector: "primary-moment" | "camera-blocking" | "declared-primary";
  time: number;
  found: boolean;
  opacity: number;
  visibleFraction: number;
  requiredVisibleFraction: number;
  rect?: LayoutRect;
  frameRect?: LayoutRect;
  safeRect?: LayoutRect;
}

export interface DirectLayoutIssue {
  code: string;
  severity: LayoutSeverity;
  time: number;
  /** Stable storyboard interaction id when this finding belongs to an optional interaction. */
  interactionId?: string;
  firstSeen?: number;
  lastSeen?: number;
  occurrences?: number;
  selector: string;
  containerSelector?: string;
  text?: string;
  rect?: LayoutRect;
  containerRect?: LayoutRect;
  safeRect?: LayoutRect;
  overflow?: LayoutOverflow;
  peerRect?: LayoutRect;
  repairSelector?: string;
  sceneId?: string;
  part?: string;
  componentRootPart?: string;
  /** Importance of a storyboard moment when this issue is moment-scoped. */
  momentImportance?: "primary" | "supporting";
  /** The finding sits on (or inside) the author-declared primary subject. */
  declaredPrimary?: boolean;
  insideCameraWorld?: boolean;
  /** The subject IS a data-camera-world plane (overflow there is by design). */
  isCameraWorld?: boolean;
  motionWindowOverlap?: boolean;
  message: string;
  fixHint?: string;
  source: "hyperframes" | "sequences";
  contrast?: {
    ratio: number;
    required: number;
    foreground?: string;
    background?: string;
    suggestedColor?: string;
  };
  /**
   * Measured framing coverage on a `camera_framed_sparse` finding — the scene,
   * the fraction of the frame its visible content fills, and the station the
   * camera landed on (when a full move framed one). Consumed by the
   * deterministic `camera-sparse-zoom` correction (compositionRunner) to size a
   * bounded zoom-in on exactly that move.
   */
  framing?: {
    sceneId: string;
    /** Fraction of the 24x14 semantic occupancy grid covered by content. */
    fraction: number;
    /** Legacy union-bbox footprint, retained as corroborating diagnostics. */
    bboxFraction?: number;
    /** Union area of actual painted/text/media rectangles in the frame. */
    occupiedFraction?: number;
    part?: string;
    region?: string;
  };
  /** Structured evidence consumed by the bounded post-browser beat retimer. */
  eyeTracePingPong?: {
    sceneId: string;
    firstBeatId: string;
    secondBeatId: string;
    firstPart: string;
    secondPart: string;
    firstAtSec: number;
    secondAtSec: number;
    viewerGapSec: number;
    displacementFraction: number;
    firstCenter: { x: number; y: number };
    secondCenter: { x: number; y: number };
  };
}

export interface DirectBrowserQaResult {
  /** True when the document loaded, initialized its timeline, and ran without browser errors. */
  ok: boolean;
  /** True when runtime validation passed and no visual quality findings request polish. */
  strictOk: boolean;
  /** Present only when browser QA could not execute; this is not evidence that the draft is bad. */
  infraError?: string;
  samples: number[];
  issues: DirectLayoutIssue[];
  interactions?: DirectInteractionEvidence[];
  /** Measured primary containment evidence used by the bounded S6.10 repair. */
  loadBearingContainment?: LoadBearingContainmentEvidence[];
  /** Measured per-boundary focal-part geometry (feeds cut discovery). */
  boundaries?: DirectBoundaryInventory[];
  /** Rendered temporal judge: per-moment before/after frame-difference evidence. */
  temporalJudge?: TemporalJudgeMomentEvidence[];
  /** Outgoing-leg liveness for storyboard-declared transitions. */
  transitionOutgoing?: TransitionOutgoingEvidence[];
  /** Advisory luminance/value-separation evidence at representative hero frames. */
  washoutEvidence?: CompositionWashoutEvidenceV1[];
  /** Playback time series; bounded polish thresholds may affect strictOk, never ok. */
  continuousMotion?: ContinuousMotionEvidenceV1;
  /** Blocking-director plan joined to the same bounded browser samples. */
  cameraBlockingEvidence?: CameraBlockingEvidenceV1;
  errors: string[];
  warnings: string[];
  guidePngBase64?: string;
  /** Bounded visual evidence passed natively to the optional vision critic. */
  visionCriticEvidence?: VisionCriticEvidenceV1;
  /** Browser proof that WS-B2 follow-through exists and decays to rest. */
  settleBlooms?: ComponentSettleBloomEvidenceV1[];
  /** Bounded, machine-readable proof for a hard canonical-seek failure. */
  timelineContract?: TimelineContractEvidence;
}

export interface TimelineContractDifference {
  selector: string;
  property: string;
  before: string | number | null;
  after: string | number | null;
}

export interface TimelineContractEvidence {
  compositionId: string;
  seekSequence: number[];
  changeCount: number;
  /** First differences in DOM order; deliberately bounded before leaving Chromium. */
  differences: TimelineContractDifference[];
}

export interface ComponentSettleBloomEvidenceV1 {
  sceneId: string;
  beatId: string;
  startSec: number;
  endSec: number;
  startOpacity: number;
  endOpacity: number;
}

export interface VisionCriticEvidenceV1 {
  version: 1;
  /** Hash of the exact pre-critique source/storyboard generation. */
  draftHash: string;
  /** Content address of source/assets/runtime plus both rendered sheets. */
  evidenceHash: string;
  /** Canonical temporal-strip interior samples (five per shot, capped at six shots). */
  stripPngBase64: string;
  stripSha256: string;
  /** The actual pre-critique temporal strip artifact consumed by the critic. */
  stripPath: string;
  /** Immutable manifest that links the source generation to model-seen bytes. */
  manifestPath: string;
  /** Matching transit/landing samples with their measured target outlined. */
  blockingPngBase64?: string;
  blockingSha256?: string;
  /** The actual pre-critique blocking artifact consumed by the critic. */
  blockingPath?: string;
  stripTimes: number[];
  blockingTimes: number[];
}

interface VisionEvidenceManifestV1 {
  version: 1;
  draftHash: string;
  evidenceHash: string;
  strip: { file: "strip.png"; sha256: string };
  blocking?: { file: "blocking.png"; sha256: string };
  stripTimes: number[];
  blockingTimes: number[];
}

let atomicEvidenceWriteSerial = 0;

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function visionEvidenceHash(
  draftHash: string,
  stripSha256: string,
  blockingSha256?: string,
): string {
  return createHash("sha256")
    .update(draftHash)
    .update("\0")
    .update(stripSha256)
    .update("\0")
    .update(blockingSha256 ?? "no-blocking")
    .digest("hex");
}

function writeEvidenceFileAtomic(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicEvidenceWriteSerial += 1;
  const temporary = file + "." + process.pid + "." + Date.now() + "." +
    atomicEvidenceWriteSerial + ".tmp";
  try {
    fs.writeFileSync(temporary, bytes);
    try {
      fs.renameSync(temporary, file);
    } catch {
      // Windows can refuse an atomic replacement when the destination exists.
      // The caller snapshots both aliases and restores them if either write
      // fails, so this fallback preserves transactional end-state semantics.
      fs.rmSync(file, { force: true });
      fs.renameSync(temporary, file);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function readOptionalFile(file: string): Buffer | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file) : undefined;
}

function restoreOptionalFile(file: string, bytes: Buffer | undefined): void {
  if (bytes) writeEvidenceFileAtomic(file, bytes);
  else fs.rmSync(file, { force: true });
}

/**
 * Publish one already-persisted, content-addressed visual generation to the
 * operator-facing temporal aliases. All hashes, manifest fields, and immutable
 * source paths are verified before either alias is touched. A write failure
 * restores the previous strip/blocking pair before surfacing the error.
 */
export function publishCanonicalVisionEvidence(
  projectDir: string,
  evidence: VisionCriticEvidenceV1,
): void {
  if (!/^[a-f0-9]{64}$/.test(evidence.draftHash) ||
      !/^[a-f0-9]{64}$/.test(evidence.evidenceHash) ||
      !/^[a-f0-9]{64}$/.test(evidence.stripSha256) ||
      (evidence.blockingSha256 && !/^[a-f0-9]{64}$/.test(evidence.blockingSha256))) {
    throw new Error("vision evidence contains an invalid content digest");
  }
  const blockingFields = [
    evidence.blockingPngBase64,
    evidence.blockingSha256,
    evidence.blockingPath,
  ];
  const hasBlocking = blockingFields.every((value) => value !== undefined);
  if (!hasBlocking && blockingFields.some((value) => value !== undefined)) {
    throw new Error("vision blocking evidence is incomplete");
  }
  const expectedEvidenceHash = visionEvidenceHash(
    evidence.draftHash,
    evidence.stripSha256,
    evidence.blockingSha256,
  );
  if (expectedEvidenceHash !== evidence.evidenceHash) {
    throw new Error("vision evidence content address does not match its digests");
  }

  const generationDir = path.resolve(
    projectDir,
    "build",
    "qa",
    "critic",
    evidence.evidenceHash,
  );
  const expectedStripPath = path.join(generationDir, "strip.png");
  const expectedBlockingPath = path.join(generationDir, "blocking.png");
  const expectedManifestPath = path.join(generationDir, "evidence.json");
  if (path.resolve(evidence.stripPath) !== expectedStripPath ||
      path.resolve(evidence.manifestPath) !== expectedManifestPath ||
      (hasBlocking && path.resolve(evidence.blockingPath!) !== expectedBlockingPath)) {
    throw new Error("vision evidence path escapes its content-addressed generation");
  }
  for (const file of [
    expectedStripPath,
    expectedManifestPath,
    ...(hasBlocking ? [expectedBlockingPath] : []),
  ]) {
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      throw new Error("vision evidence source is missing or not a file: " + file);
    }
  }

  const stripBytes = Buffer.from(evidence.stripPngBase64, "base64");
  if (!stripBytes.length || sha256Bytes(stripBytes) !== evidence.stripSha256 ||
      !fs.readFileSync(expectedStripPath).equals(stripBytes)) {
    throw new Error("vision strip bytes do not match their digest and immutable source");
  }
  const blockingBytes = hasBlocking
    ? Buffer.from(evidence.blockingPngBase64!, "base64")
    : undefined;
  if (blockingBytes &&
      (!blockingBytes.length || sha256Bytes(blockingBytes) !== evidence.blockingSha256 ||
        !fs.readFileSync(expectedBlockingPath).equals(blockingBytes))) {
    throw new Error("vision blocking bytes do not match their digest and immutable source");
  }

  let manifest: VisionEvidenceManifestV1;
  try {
    manifest = JSON.parse(
      fs.readFileSync(expectedManifestPath, "utf8"),
    ) as VisionEvidenceManifestV1;
  } catch {
    throw new Error("vision evidence manifest is not valid JSON");
  }
  if (manifest.version !== 1 || manifest.draftHash !== evidence.draftHash ||
      manifest.evidenceHash !== evidence.evidenceHash ||
      manifest.strip?.file !== "strip.png" ||
      manifest.strip.sha256 !== evidence.stripSha256 ||
      (hasBlocking
        ? manifest.blocking?.file !== "blocking.png" ||
          manifest.blocking.sha256 !== evidence.blockingSha256
        : manifest.blocking !== undefined)) {
    throw new Error("vision evidence manifest does not match the captured generation");
  }

  const temporalDir = path.resolve(projectDir, "build", "qa", "temporal");
  const canonicalStrip = path.join(temporalDir, "strip.png");
  const canonicalBlocking = path.join(temporalDir, "blocking.png");
  const previousStrip = readOptionalFile(canonicalStrip);
  const previousBlocking = readOptionalFile(canonicalBlocking);
  try {
    writeEvidenceFileAtomic(canonicalStrip, stripBytes);
    if (blockingBytes) writeEvidenceFileAtomic(canonicalBlocking, blockingBytes);
    else fs.rmSync(canonicalBlocking, { force: true });
  } catch (error) {
    try {
      restoreOptionalFile(canonicalStrip, previousStrip);
      restoreOptionalFile(canonicalBlocking, previousBlocking);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "vision evidence publication and rollback both failed",
      );
    }
    throw error;
  }
}

/**
 * One storyboard moment judged against rendered pixels: a frame just before
 * its bound evidence begins versus a frame just after that evidence settles.
 * `static` means the claimed change is not visible on screen.
 */
export interface TemporalJudgeMomentEvidence {
  momentId: string;
  title: string;
  importance: "primary" | "supporting";
  atSec: number;
  beforeSec: number;
  /** Mid-evidence frame: catches pulse-shaped changes that return to rest. */
  midSec: number;
  afterSec: number;
  /** Max fraction of downscaled pixels (before→mid, before→after) whose channel delta exceeds tolerance. */
  changedRatio: number;
  /** Mean per-pixel max channel delta (0..255) of the stronger comparison. */
  meanDelta: number;
  verdict: "changed" | "static";
}

/** Rendered-DOM evidence for the outgoing leg of one declared transition. */
export interface TransitionOutgoingEvidence {
  fromScene: string;
  toScene: string;
  style: string;
  atSec: number;
  beforeSec: number;
  afterSec: number;
  selector: string;
  verdict: "changed" | "static";
}

/** One visible data-part measured near a scene boundary (viewport space). */
export interface BoundaryPartMeasurement {
  part: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Border radius resolved to px (percentages resolved against the box). */
  radiusPx: number;
  /** Subtree size including the element itself — bridge-clone paint cost. */
  nodeCount: number;
  /** Fraction of the part's area inside the frame, 0..1. */
  onFrameRatio: number;
}

/**
 * Measured geometry on both sides of one scene boundary: the outgoing scene
 * sampled just before the cut, the incoming scene sampled after its entry
 * settles. Strictly better data than the runtime's bind-time audit, which
 * only sees load state.
 */
export interface DirectBoundaryInventory {
  fromScene: string;
  toScene: string;
  atSec: number;
  outgoing: BoundaryPartMeasurement[];
  incoming: BoundaryPartMeasurement[];
}

export interface DirectInteractionEvidence {
  id: string;
  phase: "path" | "arrival" | "press" | "release" | "hold";
  time: number;
  cursor: { x: number; y: number };
  target: { x: number; y: number };
  deltaPx: number;
  hit: boolean;
  /** Raw measured boxes make pointer/annotation drift diagnosable from QA artifacts. */
  cursorRect?: LayoutRect;
  targetRect?: LayoutRect;
  hotspot?: { x: number; y: number };
  normalized?: "cursor_near_miss";
}

interface RuntimeMessage {
  level: "error" | "warning";
  text: string;
}

const MAX_LAYOUT_SAMPLES = 48;
const SEEK_SETTLE_MS = 90;
const CLI_BROWSER_SCRIPTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../vendor/hyperframes/packages/cli/src/commands",
);

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function uniqueTimes(values: number[], duration: number): number[] {
  return [...new Set(values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= duration)
    .map(roundTime))]
    .sort((a, b) => a - b);
}

/** Hero frames plus every known cut/tween boundary and the interval midpoints. */
export function buildDirectLayoutSampleTimes(
  scenes: DirectScene[],
  tweenBoundaries: number[],
  duration: number,
  cap = MAX_LAYOUT_SAMPLES,
): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const heroes = scenes.map((scene) => scene.startSec + scene.durationSec * 0.58);
  const cuts = scenes.flatMap((scene) => [
    scene.startSec,
    scene.startSec + scene.durationSec,
  ]);
  const intents = scenes.flatMap((scene) => scene.interactions ?? []);
  const interactions = intents.flatMap((interaction) => [
    interaction.startSec,
    interaction.startSec + (interaction.arriveSec - interaction.startSec) / 2,
    interaction.arriveSec,
    ...(interaction.pressSec !== undefined
      ? [interaction.pressSec, interaction.pressSec + 0.02]
      : []),
    ...(interaction.releaseSec !== undefined ? [interaction.releaseSec] : []),
    ...(interaction.holdUntilSec !== undefined ? [interaction.holdUntilSec] : []),
  ]);
  const boundaries = uniqueTimes(
    [0, duration, ...cuts, ...interactions, ...tweenBoundaries],
    duration,
  );
  const midpoints = boundaries.slice(0, -1).map((value, index) => {
    const next = boundaries[index + 1] ?? value;
    return (value + next) / 2;
  });
  const all = uniqueTimes([...heroes, ...boundaries, ...midpoints], duration);
  if (all.length <= cap) return all;

  // Preserve authored interaction evidence and hero frames, then evenly stride
  // the remaining boundary
  // evidence so Railway memory/time stays bounded on unusually dense timelines.
  const interactionPriority = uniqueTimes([
    ...intents.flatMap((intent) =>
      intent.pressSec !== undefined ? [intent.pressSec, intent.pressSec + 0.02] : []
    ),
    ...intents.map((intent) => intent.arriveSec),
    ...intents.flatMap((intent) =>
      intent.releaseSec !== undefined ? [intent.releaseSec] : []
    ),
    ...intents.map((intent) =>
      intent.startSec + (intent.arriveSec - intent.startSec) / 2
    ),
    ...intents.flatMap((intent) =>
      intent.holdUntilSec !== undefined ? [intent.holdUntilSec] : []
    ),
  ], duration);
  const kept = new Set(uniqueTimes(heroes, duration).slice(0, cap));
  for (const time of interactionPriority) {
    if (kept.size >= cap) break;
    kept.add(time);
  }
  const remaining = all.filter((time) => !kept.has(time));
  const slots = Math.max(0, cap - kept.size);
  for (let index = 0; index < slots; index += 1) {
    const pick = remaining[Math.floor((index * Math.max(0, remaining.length - 1)) / Math.max(1, slots - 1))];
    if (pick !== undefined) kept.add(pick);
  }
  return [...kept].sort((a, b) => a - b);
}

function loadBrowserAudit(name: "layout-audit.browser.js" | "contrast-audit.browser.js"): string {
  const file = path.join(CLI_BROWSER_SCRIPTS, name);
  if (!fs.existsSync(file)) throw new Error(`vendored HyperFrames browser audit is missing: ${name}`);
  return fs.readFileSync(file, "utf8");
}

/* ------------------------------------------------------- QA evidence cache */

/**
 * Browser QA is deterministic for a given document: same bytes, same runtimes,
 * same audits → same verdict. A successful inspection is therefore cached on
 * disk keyed by content hash, so the pipeline never pays a second Chrome pass
 * for a draft it already proved healthy — most importantly the publication
 * commit (`submit_composition`), which re-inspects the exact bytes the
 * authoring loop just validated, usually from the MCP subprocess. Only fully
 * successful, non-infra results are cached; every failing or degraded draft is
 * always re-measured live. Opt out with SLACK_SEQUENCES_QA_CACHE=0.
 */
// v2: camera-arrival framing audit (camera_framed_clipped) joined the pass.
// v3: rendered temporal judge evidence + whip lens relocation.
// v4: cut_degraded became a measured polish finding + camera_framed_sparse
//     coverage audit joined the arrival pass.
// v5: eye-trace continuity audit (eye_trace_jump boundary findings +
//     advisory eye_trace_pingpong within-scene findings).
// v6: boundary inventory prioritizes declared attention targets and samples
//     the outgoing side before the cut's exit window; ping-pong measures each
//     target at its own beat in viewer time; camera_framed_sparse gets a
//     final-scene landing tier + zero-coverage parity with the static path.
// v7: camera_framed_sparse mid-window sample covers full-move-less camera scenes.
// v8: exit discipline — advisory stale_asset_lingers overlap audit (WS4).
// v9: MD1 3-transition language — `match` boundaries carry a tightened
//     eye-trace budget, degraded morphs retarget to an axis-derived swipe
//     (cut_degraded messages carry the executed target), and swipes gain a
//     directional blur lens + optional cover panel in the overlay layer.
// v10: MD4 animated grade shift — the contrast (AA) sample scheduler adds each
//     grade shift's post-cover settle instant, so text AA is re-measured under
//     the new wash a mid-scene temperature turn lands on.
// v11: MD3 split-style headline entrances (rise/pop/assemble) join the
//     designed-motion suppression windows, so the transient letter scatter is
//     not audited as a static-layout defect (the settled copy still is).
// v12: measurement honesty for the two loudest churn classes (2026-07-07
//     attempt-economy sweep): spatial_focal_invisible re-samples bounded later
//     instants before reporting (late entrance ≠ absent focal), and contrast_aa
//     dedupes to the worst ratio per selector+text instead of one row per
//     sampled hero frame.
// v13: layout findings preserve structured geometry and repair selectors.
// v14: Sequences safe-area evidence serializes plain root rects, not DOMRect.
// v17: sparse framing includes painted rectangle-union occupancy and primary
//      static moments participate in strict visual acceptance.
// v18: continuity handoff runtime participates in scratch staging + cache
// fingerprint, so feature-on drafts compile against the same runtime they ship.
// v19: graph-owned camera documents are not judged against overridden legacy
// segment destinations; blocking/static coverage owns their framing evidence.
// v20: contrast evidence resolves the exact sampled text node before the next
// seek, so compact audit selectors (for example plain `span`) cannot all enrich
// to the first matching element and mint one shared, ineffective repair rule.
// v21: interaction seek stability compares the cursor-to-anchor relationship,
// not absolute viewport coordinates that legitimately move with the camera.
// v22: continuous-motion thresholds and measured blocking anchor/rest evidence
// participate in strict polish acceptance and least-bad ranking.
// v23: sparse framing is judged by a 24x14 occupancy grid at every scene and
// graph-owned primary landing; compact final frames no longer bypass it.
// v24: storyboard-declared transitions carry boundary-scoped outgoing-leg
// liveness evidence into strict polish acceptance.
// v25: whole-frame composition coverage credits explicit host environments
// while excluding bare canvas paint (audit by default, optional strict mode).
// v26: representative hero screenshots carry luminance/value-separation
// washout evidence for browser polish and draft ranking.
// v27: the final vision critic may request two bounded visual contact sheets;
// normal QA cache hits remain reusable when no visual pack is requested.
// v28: browser evidence proves host settle blooms exist and decay to rest.
// v29: measured washout is strict polish feedback (never an `ok` veto), so
// cached v28 reports cannot retain the old advisory-only `strictOk` verdict.
// v30: substantial exact copy rendered in two distinct same-scene surfaces is
// strict polish feedback; cache entries must include that new browser truth.
// v31: visual-critic PNGs are immutable, hash-addressed artifacts and never
// persist in the ordinary QA cache; every requested visual review is fresh.
// v32: measured washout remains critic/ranking evidence but no longer lowers
// strictOk or spends a paid source repair; invalidate cached v31 verdicts.
// v33: ensemble framing owns contextual occupancy/anchor semantics and host
// plugin children are excluded from stale-surface overlap.
// v34: living-canvas wallpaper/light/furniture layers participate in rendered
// quiet-window evidence at their intentionally subtle motion threshold.
// v35: any deterministic change on a host-declared ambient layer counts as the
// micro-motion voice it is; static ambient nodes still contribute nothing.
// v36: environment-backed scenes do not ask the source author to duplicate the
// host's ambient-motion obligation; temporal evidence still reports the hold.
// v37: cursor phases no longer promote nearby pre-arrival tween boundaries to
// endpoint obligations; MeterlyQC4's 10.588s sample preceded its 10.600s pin.
// v38: ensemble occupancy mirrors the camera runtime's painted-content union;
// transparent semantic wrappers no longer fabricate a collapsed station.
// v39: blocking rest evidence measures camera-world speed instead of focal DOM
// entrance motion, and explicit full-move destinations become primary routes.
// v40: typed primary focal/camera samples persist structured containment bounds
// for the one measured, same-attempt S6.10 repair and its reinspection proof.
// v41: author-declared per-scene primary selectors (Luna motion intent) drive
// continuous-motion focal attention, waive layout_intent_missing, and flag
// contrast findings on the declared primary subject.
// v42: declared Luna interactions and per-act primaries are measured directly
// against live actor/target geometry and viewport containment.
const QA_CACHE_VERSION = 42;

/** Everything environment-side that can change the verdict for the same draft. */
let cachedStaticFingerprint: string | undefined;
function qaStaticFingerprint(): string {
  if (cachedStaticFingerprint) return cachedStaticFingerprint;
  cachedStaticFingerprint = createHash("sha256")
    .update(JSON.stringify({
      version: QA_CACHE_VERSION,
      runtimes: [
        interactionRuntimeSource(),
        cutRuntimeSource(),
        cameraRuntimeSource(),
        continuityRuntimeSource(),
        componentRuntimeSource(),
        timeRampRuntimeSource(),
        fxRuntimeSource(),
        assetRuntimeSource(),
        environmentRuntimeSource(),
        environmentKitSource(),
      ].map((source) => createHash("sha256").update(source).digest("hex")),
      audits: [
        loadBrowserAudit("layout-audit.browser.js"),
        loadBrowserAudit("contrast-audit.browser.js"),
      ].map((source) => createHash("sha256").update(source).digest("hex")),
      interactionQaMode:
        slackSequencesEnvRawValue("SLACK_SEQUENCES_INTERACTION_QA")?.trim().toLowerCase() ?? "",
      eyeTraceMode: eyeTraceMode(),
      compositionFloorMode: compositionFloorMode(),
    }))
    .digest("hex");
  return cachedStaticFingerprint;
}

/**
 * Eye-trace enforcement mode: "block" (default) makes `eye_trace_jump` a
 * strictOk-blocking polish finding; "audit" keeps it a reported advisory
 * warning while the false-positive rate is observed on live probes; "off"
 * disables the audit entirely. The within-scene ping-pong variant is always
 * advisory regardless of mode.
 */
function eyeTraceMode(): "block" | "audit" | "off" {
  const raw = slackSequencesEnvRawValue("SLACK_SEQUENCES_EYE_TRACE")?.trim().toLowerCase() ?? "";
  if (raw === "0" || raw === "off") return "off";
  if (raw === "audit") return "audit";
  return "block";
}

function qaCacheEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_QA_CACHE") !== "0";
}

function projectAssetFingerprint(projectDir: string): string {
  const root = path.join(path.resolve(projectDir), "assets");
  const hash = createHash("sha256");
  if (!fs.existsSync(root)) return hash.update("missing-assets").digest("hex");
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        hash.update(relative).update("\0").update(fs.readFileSync(absolute)).update("\0");
      }
    }
  };
  visit(root);
  return hash.digest("hex");
}

function qaCacheKey(projectDir: string, draft: DirectCompositionDraft): string {
  return createHash("sha256")
    .update(qaStaticFingerprint())
    .update("\0")
    .update(projectAssetFingerprint(projectDir))
    .update("\0")
    .update(draft.html)
    .update("\0")
    .update(JSON.stringify(draft.storyboard))
    .update("\0")
    .update(JSON.stringify(draft.declaredPrimarySelectors ?? null))
    .update("\0")
    .update(JSON.stringify(draft.declaredInteractions ?? null))
    .digest("hex");
}

/** Content identity used by immutable WS-I evidence for one exact draft/runtime/assets set. */
export function visionCriticDraftHash(
  projectDir: string,
  draft: DirectCompositionDraft,
): string {
  return qaCacheKey(projectDir, draft);
}

function qaCacheFile(projectDir: string, key: string): string {
  return path.join(path.resolve(projectDir), "qa-cache", `${key.slice(0, 32)}.json`);
}

function readQaCache(projectDir: string, key: string): DirectBrowserQaResult | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(qaCacheFile(projectDir, key), "utf8")) as {
      version?: number;
      key?: string;
      result?: DirectBrowserQaResult;
    };
    if (parsed.version === QA_CACHE_VERSION && parsed.key === key && parsed.result?.ok) {
      return parsed.result;
    }
  } catch {
    // Missing/partial cache entries are simply a miss.
  }
  return undefined;
}

function writeQaCache(projectDir: string, key: string, result: DirectBrowserQaResult): void {
  // Cache only clean, fully measured passes: a failing draft is always
  // re-measured live, and an infra fault is not evidence about the draft.
  if (!result.ok || result.infraError) return;
  try {
    const { visionCriticEvidence: _visualEvidence, ...cacheResult } = result;
    const file = qaCacheFile(projectDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: QA_CACHE_VERSION, key, result: cacheResult }) + "\n",
      "utf8",
    );
    fs.renameSync(temporary, file);
  } catch {
    // Cache bookkeeping must never disturb a build.
  }
}

function prepareScratch(projectDir: string, draft: DirectCompositionDraft): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-layout-"));
  fs.writeFileSync(path.join(scratch, "index.html"), draft.html.trim() + "\n");
  const require = createRequire(import.meta.url);
  fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(scratch, "gsap.min.js"));
  fs.writeFileSync(
    path.join(scratch, INTERACTION_RUNTIME_FILE),
    interactionRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, CUT_RUNTIME_FILE),
    cutRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, CAMERA_RUNTIME_FILE),
    cameraRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, CONTINUITY_RUNTIME_FILE),
    continuityRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, COMPONENT_RUNTIME_FILE),
    componentRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, TIME_RUNTIME_FILE),
    timeRampRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, FX_RUNTIME_FILE),
    fxRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, ASSET_RUNTIME_FILE),
    assetRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, ENVIRONMENT_RUNTIME_FILE),
    environmentRuntimeSource(),
    "utf8",
  );
  const assets = path.join(projectDir, "assets");
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(scratch, "assets"), { recursive: true });
  return scratch;
}

function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dir, "." + pathname.replace(/\/$/, "/index.html"));
      const root = path.resolve(dir);
      if (
        (file !== root && !file.startsWith(root + path.sep)) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": mime[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      response.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not bind browser QA server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function collectTweenBoundaries(page: import("puppeteer-core").Page): Promise<number[]> {
  return page.evaluate(() => {
    type AnimationLike = {
      startTime?: () => number;
      duration?: () => number;
      timeScale?: () => number;
      parent?: AnimationLike | null;
      getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => AnimationLike[];
    };
    const read = (
      fn: (() => number) | undefined,
      self: AnimationLike,
      fallback: number,
    ): number => typeof fn === "function" ? fn.call(self) : fallback;
    const toRootTime = (root: AnimationLike, animation: AnimationLike, local: number): number => {
      let time = local;
      let node: AnimationLike | null | undefined = animation;
      while (node && node !== root) {
        time = read(node.startTime, node, 0) + time / (read(node.timeScale, node, 1) || 1);
        node = node.parent;
      }
      return time;
    };
    const timelines = (window as unknown as {
      __timelines?: Record<string, AnimationLike & { __seqChild?: AnimationLike }>;
    }).__timelines ?? {};
    // A time-ramped film registers the warped master, whose only child is the
    // warp proxy; the authored tween boundaries live on the wrapped content
    // timeline it exposes as __seqChild (boundaries stay content time).
    return Object.values(timelines)
      .map((timeline) => timeline.__seqChild ?? timeline)
      .flatMap((timeline) => {
        try {
          return (timeline.getChildren?.(true, true, false) ?? []).flatMap((tween) => [
            toRootTime(timeline, tween, 0),
            toRootTime(timeline, tween, read(tween.duration, tween, 0)),
          ]);
        } catch {
          return [];
        }
      }).filter(Number.isFinite);
  });
}

async function seekTo(
  page: import("puppeteer-core").Page,
  time: number,
  compositionId?: string,
): Promise<void> {
  await page.evaluate((payload: { at: number; compositionId?: string }) => {
    const timelines = (window as unknown as {
      __timelines?: Record<string, { pause?: () => void; seek?: (time: number, suppressEvents?: boolean) => void }>;
    }).__timelines ?? {};
    const exact = payload.compositionId ? timelines[payload.compositionId] : undefined;
    const selected = payload.compositionId
      ? exact ? [exact] : []
      : Object.values(timelines);
    for (const timeline of selected) {
      timeline.pause?.();
      timeline.seek?.(payload.at, false);
    }
  }, { at: time, ...(compositionId ? { compositionId } : {}) });
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  await new Promise((resolve) => setTimeout(resolve, SEEK_SETTLE_MS));
}

async function auditSequencesRelationships(
  page: import("puppeteer-core").Page,
  time: number,
): Promise<DirectLayoutIssue[]> {
  return page.evaluate((at: number) => {
    type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
    type BrowserIssue = Omit<DirectLayoutIssue, "source">;
    const root = document.querySelector<HTMLElement>("[data-composition-id][data-width][data-height]");
    if (!root) return [];
    const rootBox = root.getBoundingClientRect();
    const rootRect: Rect = {
      left: rootBox.left,
      top: rootBox.top,
      right: rootBox.right,
      bottom: rootBox.bottom,
      width: rootBox.width,
      height: rootBox.height,
    };
    const rect = (element: Element): Rect => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const rectFromEdges = (left: number, top: number, right: number, bottom: number): Rect => ({
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    });
    const overflowFor = (subject: Rect, container: Rect, tolerance: number): LayoutOverflow | undefined => {
      const overflow: LayoutOverflow = {};
      if (subject.left < container.left - tolerance) overflow.left = container.left - subject.left;
      if (subject.right > container.right + tolerance) overflow.right = subject.right - container.right;
      if (subject.top < container.top - tolerance) overflow.top = container.top - subject.top;
      if (subject.bottom > container.bottom + tolerance) overflow.bottom = subject.bottom - container.bottom;
      return Object.keys(overflow).length ? overflow : undefined;
    };
    const selector = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const name = element.getAttribute("data-layout-name");
      if (name) return `[data-layout-name="${name.replaceAll('"', '\\"')}"]`;
      const part = element.getAttribute("data-part");
      const scene = element.closest<HTMLElement>("[data-scene]");
      const sceneId = scene?.getAttribute("data-scene") ?? scene?.id;
      if (part && sceneId) {
        return `[data-scene="${sceneId.replaceAll('"', '\\"')}"] ` +
          `[data-part="${part.replaceAll('"', '\\"')}"]`;
      }
      return element.tagName.toLowerCase();
    };
    const ignored = (element: Element): boolean => Boolean(element.closest("[data-layout-ignore]"));
    const visible = (element: Element): boolean => {
      if (ignored(element)) return false;
      const value = rect(element);
      if (value.width < 1 || value.height < 1) return false;
      let node: Element | null = element;
      let opacity = 1;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number.parseFloat(style.opacity) || 0;
        node = node.parentElement;
      }
      return opacity >= 0.2;
    };
    const issue = (
      code: string,
      severity: LayoutSeverity,
      element: Element,
      message: string,
      fixHint: string,
      container?: Element,
    ): BrowserIssue => ({
      code,
      severity,
      time: at,
      selector: selector(element),
      ...(container ? { containerSelector: selector(container) } : {}),
      message,
      fixHint,
    });
    const issues: BrowserIssue[] = [];
    const cssSafe = Number.parseFloat(getComputedStyle(root).getPropertyValue("--space-safe"));
    const safe = Number.isFinite(cssSafe) && cssSafe > 0
      ? cssSafe
      : Math.round(Math.min(rootRect.width, rootRect.height) * 0.06);
    const safeRect = rectFromEdges(
      rootRect.left + safe,
      rootRect.top + safe,
      rootRect.right - safe,
      rootRect.bottom - safe,
    );

    // Camera-rig worlds are deliberately larger than the frame: content that
    // sits in a currently-unframed region is expected to be off screen, and
    // frame-relative anchors stop being meaningful once the world plane
    // carries a camera transform.
    const movedWorld = (element: Element): boolean => {
      const world = element.closest<HTMLElement>("[data-camera-world]");
      if (!world) return false;
      const transform = getComputedStyle(world).transform;
      return Boolean(transform) && transform !== "none" &&
        transform !== "matrix(1, 0, 0, 1, 0, 0)";
    };
    const mostlyOffFrame = (value: Rect): boolean => {
      const width = Math.max(0, Math.min(value.right, rootRect.right) - Math.max(value.left, rootRect.left));
      const height = Math.max(0, Math.min(value.bottom, rootRect.bottom) - Math.max(value.top, rootRect.top));
      const area = value.width * value.height;
      return area <= 0 || (width * height) / area < 0.6;
    };

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-important]"))) {
      const importantFrom = Number.parseFloat(element.dataset.layoutImportantFrom ?? "");
      if (Number.isFinite(importantFrom) && at < importantFrom - 0.02) continue;
      if (!visible(element) || element.closest("[data-layout-allow-overflow]")) continue;
      const value = rect(element);
      if (movedWorld(element) && mostlyOffFrame(value)) continue;
      const overflow = Math.max(
        rootRect.left + safe - value.left,
        rootRect.top + safe - value.top,
        value.right - (rootRect.right - safe),
        value.bottom - (rootRect.bottom - safe),
      );
      if (overflow > 2) {
        issues.push({
          ...issue(
          "important_safe_area",
          "warning",
          element,
          `Load-bearing content crosses the ${safe}px safe canvas inset by ${Math.round(overflow)}px.`,
          "Keep it in the .scene flow container; give it a .zone and widen the named layout track before wrapping or reducing type.",
          root,
          ),
          rect: value,
          containerRect: rootRect,
          safeRect,
          overflow: overflowFor(value, safeRect, 2),
        });
      }
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-anchor]"))) {
      if (!visible(element) || movedWorld(element)) continue;
      const intent = element.dataset.layoutAnchor ?? "";
      const value = rect(element);
      const centerX = value.left + value.width / 2;
      const centerY = value.top + value.height / 2;
      const opticalX = Number.parseFloat(element.dataset.layoutOpticalX ?? "0") || 0;
      const opticalY = Number.parseFloat(element.dataset.layoutOpticalY ?? "0") || 0;
      const tolerance = Number.parseFloat(element.dataset.layoutTolerance ?? "12") || 12;
      let dx = 0;
      let dy = 0;
      if (intent === "frame:center") {
        dx = centerX - (rootRect.left + rootRect.width / 2 + opticalX);
        dy = centerY - (rootRect.top + rootRect.height / 2 + opticalY);
      } else if (intent === "frame:left-third") {
        dx = centerX - (rootRect.left + rootRect.width / 3 + opticalX);
      } else if (intent === "frame:right-third") {
        dx = centerX - (rootRect.left + rootRect.width * 2 / 3 + opticalX);
      } else if (intent === "frame:top-third") {
        dy = centerY - (rootRect.top + rootRect.height / 3 + opticalY);
      } else if (intent === "frame:bottom-third") {
        dy = centerY - (rootRect.top + rootRect.height * 2 / 3 + opticalY);
      } else {
        issues.push(issue(
          "layout_anchor_invalid",
          "warning",
          element,
          `Unknown layout anchor "${intent}".`,
          "Use frame:center, frame:left-third, frame:right-third, frame:top-third, or frame:bottom-third.",
        ));
        continue;
      }
      if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
        issues.push(issue(
          "layout_anchor_mismatch",
          "warning",
          element,
          `Declared ${intent} anchor misses by ${Math.round(dx)}px x / ${Math.round(dy)}px y.`,
          "Let Grid/Flexbox settle the declared anchor; reserve transforms for motion.",
          root,
        ));
      }
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-align]"))) {
      if (!visible(element)) continue;
      const declaration = element.dataset.layoutAlign ?? "";
      const split = declaration.indexOf(":");
      const edge = split > 0 ? declaration.slice(0, split) : "";
      const targetSelector = split > 0 ? declaration.slice(split + 1) : "";
      let target: Element | null = null;
      try {
        target = targetSelector ? root.querySelector(targetSelector) : null;
      } catch {
        target = null;
      }
      if (!target || !visible(target)) {
        issues.push(issue(
          "layout_target_missing",
          "warning",
          element,
          `Alignment target "${targetSelector || "(missing)"}" is absent or invisible.`,
          "Use a stable id on the intended target.",
        ));
        continue;
      }
      const value = rect(element);
      const targetRect = rect(target);
      const coordinates: Record<string, [number, number]> = {
        left: [value.left, targetRect.left],
        right: [value.right, targetRect.right],
        top: [value.top, targetRect.top],
        bottom: [value.bottom, targetRect.bottom],
        "center-x": [value.left + value.width / 2, targetRect.left + targetRect.width / 2],
        "center-y": [value.top + value.height / 2, targetRect.top + targetRect.height / 2],
      };
      const pair = coordinates[edge];
      const tolerance = Number.parseFloat(element.dataset.layoutTolerance ?? "8") || 8;
      if (!pair) {
        issues.push(issue(
          "layout_alignment_invalid",
          "warning",
          element,
          `Unknown relational alignment "${edge}".`,
          "Use left, right, top, bottom, center-x, or center-y.",
          target,
        ));
      } else if (Math.abs(pair[0] - pair[1]) > tolerance) {
        issues.push(issue(
          "layout_alignment_mismatch",
          "warning",
          element,
          `${edge} is ${Math.round(Math.abs(pair[0] - pair[1]))}px away from ${targetSelector}.`,
          "Put both elements in one Grid/Flex layout or derive them from the same inset variable.",
          target,
        ));
      }
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-attach]"))) {
      if (!visible(element)) continue;
      const targetSelector = element.dataset.layoutAttach ?? "";
      let target: Element | null = null;
      try {
        target = targetSelector ? root.querySelector(targetSelector) : null;
      } catch {
        target = null;
      }
      if (!target || !visible(target)) {
        issues.push(issue(
          "layout_attachment_missing",
          "warning",
          element,
          `Attachment target "${targetSelector || "(missing)"}" is absent or invisible.`,
          "Wrap the exact target word in a stable id and attach the decoration to that wrapper.",
        ));
        continue;
      }
      const a = rect(element);
      const b = rect(target);
      const dx = Math.max(b.left - a.right, a.left - b.right, 0);
      const dy = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
      const distance = Math.hypot(dx, dy);
      const tolerance = Number.parseFloat(element.dataset.layoutTolerance ?? "24") || 24;
      if (distance > tolerance) {
        issues.push(issue(
          "layout_attachment_detached",
          "warning",
          element,
          `Decoration is ${Math.round(distance)}px from ${targetSelector}.`,
          "Move it inside the measured text wrapper or implement the stroke as a pseudo-element.",
          target,
        ));
      }
      const identity = [
        element.id,
        element.className,
        element.dataset.layoutRole,
      ].join(" ").toLowerCase();
      const annotationKind = /\b(?:underline|underbar|marker|highlight|stroke)\b/.test(identity);
      const lineLike =
        a.width >= Math.max(8, a.height * 2) &&
        a.height <= Math.min(32, Math.max(8, b.height * 0.45));
      if (annotationKind || lineLike) {
        const widthRatio = b.width > 0 ? a.width / b.width : 1;
        const centerDelta = Math.abs(
          (a.left + a.width / 2) - (b.left + b.width / 2),
        );
        const centerTolerance = Math.max(12, b.width * 0.18);
        if (widthRatio < 0.55 || widthRatio > 1.45) {
          issues.push(issue(
            "layout_annotation_width_mismatch",
            "warning",
            element,
            `Attached annotation is ${Math.round(widthRatio * 100)}% of ${targetSelector}'s width.`,
            "Size the marker from its measured text wrapper with left/right or inline-size:100%.",
            target,
          ));
        }
        if (centerDelta > centerTolerance) {
          issues.push(issue(
            "layout_annotation_alignment_mismatch",
            "warning",
            element,
            `Attached annotation is horizontally offset from ${targetSelector} by ${Math.round(centerDelta)}px.`,
            "Keep the marker inside the text wrapper and derive both horizontal edges from that wrapper.",
            target,
          ));
        }
        const underlineLike = /\b(?:underline|underbar|stroke)\b/.test(identity);
        if (
          underlineLike &&
          (
            a.top + a.height / 2 < b.top + b.height * 0.55 ||
            a.top + a.height / 2 > b.bottom + b.height * 0.35
          )
        ) {
          issues.push(issue(
            "layout_annotation_vertical_mismatch",
            "warning",
            element,
            `Underline is outside ${targetSelector}'s lower text band.`,
            "Anchor it to the wrapper baseline (for example bottom:.06em), not to canvas coordinates.",
            target,
          ));
        }
      }
    }

    for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-gap]"))) {
      if (!visible(group)) continue;
      const axis = group.dataset.layoutGap;
      if (axis !== "x" && axis !== "y") {
        issues.push(issue(
          "layout_gap_invalid",
          "warning",
          group,
          `Unknown gap axis "${axis ?? ""}".`,
          'Use data-layout-gap="x" or data-layout-gap="y".',
        ));
        continue;
      }
      const children = Array.from(group.children)
        .filter(visible)
        .map((child) => ({ child, rect: rect(child) }));
      children.sort((a, b) => axis === "x" ? a.rect.left - b.rect.left : a.rect.top - b.rect.top);
      const gaps = children.slice(1).map((entry, index) => {
        const previous = children[index]!.rect;
        return axis === "x" ? entry.rect.left - previous.right : entry.rect.top - previous.bottom;
      });
      if (gaps.length < 2) continue;
      const spread = Math.max(...gaps) - Math.min(...gaps);
      const tolerance = Number.parseFloat(group.dataset.layoutTolerance ?? "8") || 8;
      if (spread > tolerance) {
        issues.push(issue(
          "layout_gap_inconsistent",
          "warning",
          group,
          `Declared ${axis}-axis gaps vary by ${Math.round(spread)}px.`,
          "Use one CSS gap token on the group instead of independent child offsets.",
        ));
      }
    }

    for (const scene of Array.from(root.querySelectorAll<HTMLElement>("[data-scene]"))) {
      if (!visible(scene)) continue;
      const declared = scene.matches(
        "[data-layout-important],[data-layout-anchor],[data-layout-align],[data-layout-attach],[data-layout-gap]",
      ) || Boolean(scene.querySelector(
        "[data-layout-important],[data-layout-anchor],[data-layout-align],[data-layout-attach],[data-layout-gap]",
      ));
      if (!declared) {
        issues.push(issue(
          "layout_intent_missing",
          "warning",
          scene,
          "Visible scene declares no relational layout intent.",
          "Declare only the load-bearing anchor, alignment, attachment, safe-area, or group-gap relationships.",
        ));
      }
    }
    return issues.map((value) => ({ ...value, source: "sequences" as const }));
  }, time);
}

export function interactionPhase(
  intent: InteractionIntentV1,
  time: number,
): DirectInteractionEvidence["phase"] | undefined {
  // Sample construction includes arbitrary tween boundaries. Treating every
  // point within 35ms BEFORE arrival as the endpoint charged an in-flight
  // cursor when another tween ended 12ms early (MeterlyQC4). Authored intent
  // times are rounded to milliseconds, so 5ms absorbs serialization noise
  // without turning a real path sample into a click/arrival obligation.
  const tolerance = 0.005;
  if (Math.abs(time - intent.arriveSec) <= tolerance) return "arrival";
  if (intent.pressSec !== undefined && Math.abs(time - intent.pressSec) <= tolerance) return "press";
  if (intent.releaseSec !== undefined && Math.abs(time - intent.releaseSec) <= tolerance) return "release";
  if (intent.holdUntilSec !== undefined && Math.abs(time - intent.holdUntilSec) <= tolerance) return "hold";
  if (time >= intent.startSec && time < intent.arriveSec) return "path";
  return undefined;
}

async function auditInteractions(
  page: import("puppeteer-core").Page,
  intents: InteractionIntentV1[],
  time: number,
): Promise<{ issues: DirectLayoutIssue[]; evidence: DirectInteractionEvidence[] }> {
  const active = intents
    .map((intent) => ({ intent, phase: interactionPhase(intent, time) }))
    .filter((entry): entry is {
      intent: InteractionIntentV1;
      phase: DirectInteractionEvidence["phase"];
    } => Boolean(entry.phase));
  if (!active.length) return { issues: [], evidence: [] };
  return page.evaluate((payload) => {
    type Rect = {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    };
    const root = document.querySelector<HTMLElement>("[data-composition-id][data-width][data-height]");
    if (!root) return { issues: [], evidence: [] };
    const rect = (element: Element): Rect => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const visible = (element: Element): boolean => {
      const value = rect(element);
      if (value.width < 1 || value.height < 1) return false;
      let opacity = 1;
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number.parseFloat(style.opacity) || 0;
        node = node.parentElement;
      }
      return opacity >= 0.15;
    };
    const issues: DirectLayoutIssue[] = [];
    const evidence: DirectInteractionEvidence[] = [];
    const childItems = (element: HTMLElement): HTMLElement[] => {
      const scoped = (selector: string): HTMLElement[] => {
        const direct = Array.from(
          element.querySelectorAll<HTMLElement>(`:scope > ${selector}`),
        );
        return direct.length
          ? direct
          : Array.from(element.querySelectorAll<HTMLElement>(selector));
      };
      for (const selector of [
        ".cmp-row", ".cmp-item", ".cmp-card", ".cmp-msg", "[data-cmp-item]",
        '[class$="-row"],[class*="-row "]', "i",
      ]) {
        const found = scoped(selector);
        if (found.length) return found;
      }
      return [];
    };
    const semanticTarget = (
      base: HTMLElement | null,
      intent: InteractionIntentV1,
      useItem: boolean,
    ): HTMLElement | null => {
      if (!base || !useItem || intent.item === undefined) return base;
      const items = childItems(base);
      if (!items.length) return base;
      const index = Math.max(0, Math.min(items.length - 1, Math.round(intent.item) - 1));
      return items[index] ?? base;
    };
    const add = (
      code: string,
      element: Element | null,
      id: string,
      message: string,
      fixHint: string,
    ): void => {
      issues.push({
        code,
        severity: "error",
        time: payload.time,
        interactionId: id,
        selector: element?.id ? `#${CSS.escape(element.id)}` : `[interaction="${id}"]`,
        message,
        fixHint,
        source: "sequences",
      });
    };
    for (const entry of payload.active) {
      const intent: InteractionIntentV1 = entry.intent;
      const scene: HTMLElement | null = root.querySelector<HTMLElement>(
        `[data-scene="${CSS.escape(intent.sceneId)}"]`,
      );
      const cursorMatches: NodeListOf<HTMLElement> = root.querySelectorAll<HTMLElement>(
        `[data-cursor-id="${CSS.escape(intent.cursorId)}"]`,
      );
      const cursor: HTMLElement | null = cursorMatches[0] ?? null;
      const targetName = intent.action === "drag" && entry.phase === "release" &&
          intent.dragTargetPart
        ? intent.dragTargetPart
        : intent.targetPart;
      const targetMatches: NodeListOf<HTMLElement> | undefined =
        scene?.querySelectorAll<HTMLElement>(
        `[data-part="${CSS.escape(targetName)}"]`,
      );
      const target: HTMLElement | null = semanticTarget(
        targetMatches?.[0] ?? null,
        intent,
        targetName === intent.targetPart,
      );
      if (!scene || !cursor || !target) {
        add(
          "interaction_binding_missing",
          cursor ?? target,
          intent.id,
          `Interaction "${intent.id}" cannot resolve its scene, cursor, or target part.`,
          "Bind stable data-scene, data-cursor-id, and data-part values before authoring motion.",
        );
        continue;
      }
      if (cursorMatches.length !== 1 || targetMatches?.length !== 1) {
        add(
          "interaction_binding_ambiguous",
          cursor ?? target,
          intent.id,
          `Interaction "${intent.id}" requires one cursor and one scene-scoped target part.`,
          "Make data-cursor-id unique in the composition and data-part unique within the scene.",
        );
      }
      if (cursor.closest("[data-camera-world]")) {
        add(
          "interaction_camera_coupling",
          cursor,
          intent.id,
          "Cursor is inside data-camera-world and inherits product camera transforms.",
          "Move the cursor into the scene/root data-camera-overlay.",
        );
      }
      const overlay: HTMLElement | null = cursor.parentElement;
      if (
        !overlay?.hasAttribute("data-camera-overlay") ||
        (overlay.parentElement !== scene && overlay.parentElement !== root)
      ) {
        add(
          "interaction_overlay_invalid",
          cursor,
          intent.id,
          "Cursor must be a direct child of a scene/root data-camera-overlay.",
          "Use a fixed overlay sibling of data-camera-world.",
        );
      }
      if (cursor.closest("[data-layout-ignore]") || target.closest("[data-layout-ignore]")) {
        add(
          "interaction_ignored",
          cursor,
          intent.id,
          "Active cursor or target is hidden from spatial inspection.",
          "Remove data-layout-ignore from interaction actors.",
        );
      }
      if (getComputedStyle(cursor).pointerEvents !== "none") {
        add(
          "interaction_pointer_events",
          cursor,
          intent.id,
          "Decorative cursor can intercept the target.",
          "Set pointer-events:none on the cursor.",
        );
      }
      const entryFadeSec = Math.min(
        0.14,
        (intent.arriveSec - intent.startSec) * 0.18,
      );
      const inEntryFade =
        entry.phase === "path" &&
        payload.time <= intent.startSec + entryFadeSec + 0.01;
      const targetBox = rect(target);
      // A target may intentionally reveal while the cursor approaches it. The
      // runtime only needs stable geometry during the path; visibility becomes
      // mandatory at arrival and remains mandatory through press/release/hold.
      const targetReady = entry.phase === "path"
        ? targetBox.width >= 1 && targetBox.height >= 1
        : visible(target);
      if ((!visible(cursor) && !inEntryFade) || !targetReady) {
        add(
          "interaction_not_visible",
          !visible(cursor) ? cursor : target,
          intent.id,
          `Cursor or target is not visible during ${entry.phase}.`,
          "Keep both visible from arrival through release/result hold.",
        );
        continue;
      }
      const cursorRect = rect(cursor);
      const targetRect = targetBox;
      const hotspotX = Math.max(
        0,
        Math.min(1, Number.parseFloat(cursor.dataset.cursorHotspotX ?? "0") || 0),
      );
      const hotspotY = Math.max(
        0,
        Math.min(1, Number.parseFloat(cursor.dataset.cursorHotspotY ?? "0") || 0),
      );
      const cursorPoint = {
        x: cursorRect.left + cursorRect.width * hotspotX,
        y: cursorRect.top + cursorRect.height * hotspotY,
      };
      const requestedTargetPoint = {
        x: targetRect.left + targetRect.width * intent.aimX + (intent.offsetX ?? 0),
        y: targetRect.top + targetRect.height * intent.aimY + (intent.offsetY ?? 0),
      };
      const inset = Math.min(
        Math.max(
          2,
          intent.hitInsetPx ??
            Math.min(12, Math.min(targetRect.width, targetRect.height) * 0.14),
        ),
        Math.max(0, targetRect.width / 2 - 0.5),
        Math.max(0, targetRect.height / 2 - 0.5),
      );
      const targetPoint = {
        x: Math.max(
          targetRect.left + inset,
          Math.min(targetRect.right - inset, requestedTargetPoint.x),
        ),
        y: Math.max(
          targetRect.top + inset,
          Math.min(targetRect.bottom - inset, requestedTargetPoint.y),
        ),
      };
      const rawHit =
        cursorPoint.x >= targetRect.left + inset &&
        cursorPoint.x <= targetRect.right - inset &&
        cursorPoint.y >= targetRect.top + inset &&
        cursorPoint.y <= targetRect.bottom - inset;
      const rawDeltaPx = Math.hypot(
        cursorPoint.x - targetPoint.x,
        cursorPoint.y - targetPoint.y,
      );
      const endpoint = entry.phase === "arrival" || entry.phase === "press" ||
        entry.phase === "release" || entry.phase === "hold";
      const nearMissSnap = endpoint &&
        rawDeltaPx > 0 &&
        rawDeltaPx <= 3 &&
        (!rawHit || rawDeltaPx > 2);
      const evidenceCursor = nearMissSnap ? targetPoint : cursorPoint;
      const hit = nearMissSnap ? true : rawHit;
      const deltaPx = nearMissSnap ? 0 : rawDeltaPx;
      evidence.push({
        id: intent.id,
        phase: entry.phase,
        time: payload.time,
        cursor: evidenceCursor,
        target: targetPoint,
        deltaPx,
        hit,
        cursorRect,
        targetRect,
        hotspot: { x: hotspotX, y: hotspotY },
        ...(nearMissSnap ? { normalized: "cursor_near_miss" as const } : {}),
      });
      if (endpoint && (!hit || deltaPx > 2)) {
        add(
          "interaction_target_miss",
          cursor,
          intent.id,
          `Cursor hotspot misses "${targetName}" by ${Math.round(deltaPx * 10) / 10}px.`,
          "Let SequencesInteractions derive the cursor endpoint from the target anchor.",
        );
      }
      if (entry.phase === "press") {
        const stack = document.elementsFromPoint(evidenceCursor.x, evidenceCursor.y);
        const actorSet = new Set<Element>([
          cursor,
          ...(overlay ? [overlay] : []),
          scene,
          root,
          ...(intent.ripplePart
          ? Array.from(scene.querySelectorAll(
              `[data-part="${CSS.escape(intent.ripplePart)}"]`,
            ))
          : []),
        ]);
        const top = stack.find((element) =>
          !actorSet.has(element) &&
          getComputedStyle(element).pointerEvents !== "none" &&
          visible(element)
        );
        if (top && top !== target && !target.contains(top) && !top.contains(target)) {
          add(
            "interaction_target_occluded",
            target,
            intent.id,
            `Click point is covered by ${top.id ? `#${top.id}` : top.tagName.toLowerCase()}.`,
            "Reorder scene layers or choose a visible target anchor.",
          );
        }
        if (intent.ripplePart) {
          const ripple = scene.querySelector<HTMLElement>(
            `[data-part="${CSS.escape(intent.ripplePart)}"]`,
          );
          if (!ripple) {
            add(
              "interaction_ripple_missing",
              target,
              intent.id,
              "Declared click ripple is absent.",
              "Bind the declared ripple part in the same scene.",
            );
          } else if (visible(ripple)) {
            const rippleRect = rect(ripple);
            const ripplePoint = {
              x: rippleRect.left + rippleRect.width / 2,
              y: rippleRect.top + rippleRect.height / 2,
            };
            const rippleDelta = Math.hypot(
              ripplePoint.x - evidenceCursor.x,
              ripplePoint.y - evidenceCursor.y,
            );
            if (rippleDelta > 2) {
              add(
                "interaction_ripple_miss",
                ripple,
                intent.id,
                `Ripple origin misses the cursor hotspot by ${
                  Math.round(rippleDelta * 10) / 10
                }px.`,
                "Use the interaction runtime's measured target point for ripple placement.",
              );
            }
          }
        }
      }
    }
    return { issues, evidence };
  }, { active, time });
}

async function renderSpatialGuide(
  page: import("puppeteer-core").Page,
  intents: InteractionIntentV1[],
): Promise<string | undefined> {
  if (!intents.length) return undefined;
  await page.evaluate((values) => {
    document.getElementById("__sequences-spatial-guide")?.remove();
    const root = document.querySelector<HTMLElement>("[data-composition-id]");
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const semanticTarget = (
      base: HTMLElement | null,
      item: number | undefined,
    ): HTMLElement | null => {
      if (!base || item === undefined) return base;
      const selectors = [
        ".cmp-row", ".cmp-item", ".cmp-card", ".cmp-msg", "[data-cmp-item]",
        '[class$="-row"],[class*="-row "]', "i",
      ];
      for (const selector of selectors) {
        const direct = Array.from(
          base.querySelectorAll<HTMLElement>(`:scope > ${selector}`),
        );
        const found = direct.length
          ? direct
          : Array.from(base.querySelectorAll<HTMLElement>(selector));
        if (!found.length) continue;
        const index = Math.max(0, Math.min(found.length - 1, Math.round(item) - 1));
        return found[index] ?? base;
      }
      return base;
    };
    const layer = document.createElement("div");
    layer.id = "__sequences-spatial-guide";
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      font: "12px monospace",
    });
    const box = (
      rect: DOMRect,
      color: string,
      label: string,
      dashed = false,
    ): void => {
      const node = document.createElement("div");
      node.textContent = label;
      Object.assign(node.style, {
        position: "absolute",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        border: `2px ${dashed ? "dashed" : "solid"} ${color}`,
        color,
        boxSizing: "border-box",
      });
      layer.appendChild(node);
    };
    const safe = Number.parseFloat(getComputedStyle(root).getPropertyValue("--space-safe")) ||
      Math.min(rootRect.width, rootRect.height) * 0.06;
    box(
      new DOMRect(
        rootRect.left + safe,
        rootRect.top + safe,
        rootRect.width - safe * 2,
        rootRect.height - safe * 2,
      ),
      "#22d3ee",
      "safe",
      true,
    );
    for (const intent of values) {
      const scene = root.querySelector<HTMLElement>(
        `[data-scene="${CSS.escape(intent.sceneId)}"]`,
      );
      const target = semanticTarget(
        scene?.querySelector<HTMLElement>(
          `[data-part="${CSS.escape(intent.targetPart)}"]`,
        ) ?? null,
        intent.item,
      );
      const cursor = root.querySelector<HTMLElement>(
        `[data-cursor-id="${CSS.escape(intent.cursorId)}"]`,
      );
      if (target) {
        box(
          target.getBoundingClientRect(),
          "#a3e635",
          `${intent.targetPart}${intent.item ? ` item ${intent.item}` : ""}`,
        );
      }
      if (cursor) box(cursor.getBoundingClientRect(), "#fb7185", intent.cursorId);
    }
    document.body.appendChild(layer);
  }, intents);
  const image = await page.screenshot({ encoding: "base64", type: "png" });
  await page.evaluate(() => document.getElementById("__sequences-spatial-guide")?.remove());
  return String(image);
}

interface VisionFrameCapture {
  time: number;
  label: string;
  image: string;
}

function htmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function stitchVisionFrames(
  browser: import("puppeteer-core").Browser,
  frames: VisionFrameCapture[],
  title: string,
): Promise<string | undefined> {
  if (!frames.length) return undefined;
  const sheet = await browser.newPage();
  try {
    const columns = frames.length > 6 ? 5 : 3;
    const rows = Math.ceil(frames.length / columns);
    const width = columns === 5 ? 1600 : 1280;
    const horizontal = 56 + (columns - 1) * 12;
    const cardWidth = (width - horizontal) / columns;
    const cardHeight = Math.round(cardWidth * 9 / 16);
    const height = 68 + rows * cardHeight + Math.max(0, rows - 1) * 12 + 24;
    await sheet.setViewport({ width, height, deviceScaleFactor: 1 });
    const cards = frames.map((frame) =>
      `<figure><img alt="" src="data:image/png;base64,${frame.image}">` +
      `<figcaption>${htmlText(frame.label)}</figcaption></figure>`
    ).join("");
    await sheet.setContent(
      `<!doctype html><style>` +
      `*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;` +
      `background:#090d14;color:#f4f6fa;font-family:Arial,sans-serif}` +
      `body{padding:44px 28px 24px}h1{position:absolute;left:28px;top:12px;margin:0;` +
      `font:700 20px/1 Arial;letter-spacing:.02em}main{width:100%;height:100%;display:grid;` +
      `grid-template-columns:repeat(${columns},1fr);grid-template-rows:repeat(${rows},${cardHeight}px);gap:12px}` +
      `figure{position:relative;margin:0;min-width:0;min-height:0;background:#121925;` +
      `border:1px solid #344155;overflow:hidden}img{width:100%;height:100%;object-fit:cover;display:block}` +
      `figcaption{position:absolute;left:0;right:0;bottom:0;padding:8px 10px;` +
      `background:linear-gradient(transparent,rgba(0,0,0,.88));font:600 14px/1.2 Arial}` +
      `</style><h1>${htmlText(title)}</h1><main>${cards}</main>`,
      { waitUntil: "load" },
    );
    await sheet.waitForFunction(
      () => Array.from(document.images).every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
      { timeout: 10_000 },
    );
    return String(await sheet.screenshot({ encoding: "base64", type: "png" }));
  } finally {
    await sheet.close();
  }
}

/**
 * Capture the bounded visual evidence WS-I needs at the existing critic seam.
 * It is opt-in because ordinary repair passes already have numeric evidence;
 * the final critic alone pays for these two compact contact sheets.
 */
async function captureVisionCriticEvidence(
  projectDir: string,
  draftHash: string,
  browser: import("puppeteer-core").Browser,
  page: import("puppeteer-core").Page,
  storyboard: DirectScene[],
  blockingPlan: CameraPhrasePlanV1 | undefined,
  seekContent: (time: number) => Promise<void>,
  publishVisualReview: boolean,
): Promise<VisionCriticEvidenceV1 | undefined> {
  const temporalDir = path.join(projectDir, "build", "qa", "temporal");
  if (publishVisualReview) {
    fs.rmSync(path.join(temporalDir, "strip.png"), { force: true });
    fs.rmSync(path.join(temporalDir, "blocking.png"), { force: true });
  }
  const stripEntries = storyboard.flatMap((scene) => {
    const transitTimes = primaryBlockingTransitTimes(blockingPlan, scene.id);
    return temporalSceneSampleTimes(scene.startSec, scene.durationSec, transitTimes)
      .map((time) => {
      return {
        sceneId: scene.id,
        time,
        label: `${scene.id} · ${time.toFixed(2)}s`,
      };
      });
  });
  const capture = async (
    entries: Array<{
      time: number;
      label: string;
      outline?: { sceneId: string; kind: "part" | "region" | "selector"; id: string };
    }>,
  ): Promise<VisionFrameCapture[]> => {
    const frames: VisionFrameCapture[] = [];
    for (const entry of entries) {
      await seekContent(entry.time);
      if (entry.outline) {
        await page.evaluate((outline) => {
          document.getElementById("__sequences-vision-outline")?.remove();
          const scene = document.querySelector<HTMLElement>(
            `[data-scene="${CSS.escape(outline.sceneId)}"]`,
          );
          const selector = outline.kind === "part"
            ? `[data-part="${CSS.escape(outline.id)}"]`
            : outline.kind === "region"
            ? `[data-region="${CSS.escape(outline.id)}"]`
            : outline.id;
          let target: HTMLElement | null = null;
          try {
            target = scene?.querySelector<HTMLElement>(selector) ?? null;
          } catch {
            target = null;
          }
          if (!target) return;
          const rect = target.getBoundingClientRect();
          const marker = document.createElement("div");
          marker.id = "__sequences-vision-outline";
          marker.style.cssText =
            `position:fixed;z-index:2147483647;pointer-events:none;left:${rect.left}px;` +
            `top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;` +
            `border:5px solid #ffcc33;box-shadow:0 0 0 2px #111,0 0 24px #ffcc33;`;
          marker.setAttribute("data-layout-ignore", "");
          document.body.appendChild(marker);
        }, entry.outline);
      }
      frames.push({
        time: entry.time,
        label: entry.label,
        image: String(await page.screenshot({ encoding: "base64", type: "png" })),
      });
      await page.evaluate(() => document.getElementById("__sequences-vision-outline")?.remove());
    }
    return frames;
  };
  const stripFrames = await capture(stripEntries);
  const blockingEntries = stripEntries.flatMap((entry) => {
    const scene = storyboard.find((candidate) => candidate.id === entry.sceneId);
    const primaryPhrases = blockingPlan?.scenes
      .find((candidate) => candidate.sceneId === entry.sceneId)?.phrases
      .filter((phrase) => phrase.importance === "primary") ?? [];
    const active = primaryPhrases.find((phrase) =>
      entry.time >= phrase.startSec && entry.time <= phrase.endSec
    ) ?? [...primaryPhrases].sort((a, b) =>
      Math.abs(a.dwell.startSec - entry.time) - Math.abs(b.dwell.startSec - entry.time)
    )[0];
    if (active) {
      return [{
        time: entry.time,
        label: `${entry.sceneId}/${active.phraseId} · ${entry.time.toFixed(2)}s`,
        outline: {
          sceneId: entry.sceneId,
          kind: active.target.kind,
          id: active.target.id,
        },
      }];
    }
    const focalPart = scene ? spatialFocalPartAt(scene, entry.time) : undefined;
    return focalPart
      ? [{
          time: entry.time,
          label: `${entry.sceneId}/focal · ${entry.time.toFixed(2)}s`,
          outline: { sceneId: entry.sceneId, kind: "part" as const, id: focalPart },
        }]
      : [];
  });
  const blockingFrames = await capture(blockingEntries);
  const stripPngBase64 = await stitchVisionFrames(browser, stripFrames, "film strip · representative shots");
  if (!stripPngBase64) return undefined;
  const blockingPngBase64 = await stitchVisionFrames(
    browser,
    blockingFrames,
    "blocking · primary landings",
  );
  const stripBuffer = Buffer.from(stripPngBase64, "base64");
  const blockingBuffer = blockingPngBase64
    ? Buffer.from(blockingPngBase64, "base64")
    : undefined;
  const stripSha256 = sha256Bytes(stripBuffer);
  const blockingSha256 = blockingBuffer
    ? sha256Bytes(blockingBuffer)
    : undefined;
  const evidenceHash = visionEvidenceHash(draftHash, stripSha256, blockingSha256);
  const criticDir = path.join(projectDir, "build", "qa", "critic", evidenceHash);
  // The hash-addressed generation is immutable provenance for the exact bytes
  // shown to the model. Canonical temporal paths are refreshed for the operator
  // and may later be replaced by the final post-critique temporal report.
  const stripPath = path.join(criticDir, "strip.png");
  const blockingPath = blockingBuffer ? path.join(criticDir, "blocking.png") : undefined;
  const manifestPath = path.join(criticDir, "evidence.json");
  const manifest = Buffer.from(JSON.stringify({
    version: 1,
    draftHash,
    evidenceHash,
    strip: { file: "strip.png", sha256: stripSha256 },
    ...(blockingSha256
      ? { blocking: { file: "blocking.png", sha256: blockingSha256 } }
      : {}),
    stripTimes: stripFrames.map((frame) => frame.time),
    blockingTimes: blockingFrames.map((frame) => frame.time),
  }, null, 2) + "\n");
  const pendingCriticDir = `${criticDir}.${process.pid}.${Date.now()}.tmp`;
  if (fs.existsSync(criticDir)) {
    const existingStrip = createHash("sha256").update(fs.readFileSync(stripPath)).digest("hex");
    const existingBlocking = blockingPath && fs.existsSync(blockingPath)
      ? createHash("sha256").update(fs.readFileSync(blockingPath)).digest("hex")
      : undefined;
    if (
      existingStrip !== stripSha256 ||
      existingBlocking !== blockingSha256 ||
      !fs.existsSync(manifestPath)
    ) {
      throw new Error(`vision evidence hash collision or incomplete generation ${evidenceHash}`);
    }
  } else {
    try {
      writeEvidenceFileAtomic(path.join(pendingCriticDir, "strip.png"), stripBuffer);
      if (blockingBuffer) {
        writeEvidenceFileAtomic(path.join(pendingCriticDir, "blocking.png"), blockingBuffer);
      }
      writeEvidenceFileAtomic(path.join(pendingCriticDir, "evidence.json"), manifest);
      fs.renameSync(pendingCriticDir, criticDir);
    } catch (error) {
      fs.rmSync(pendingCriticDir, { recursive: true, force: true });
      throw error;
    }
  }
  const evidence: VisionCriticEvidenceV1 = {
    version: 1,
    draftHash,
    evidenceHash,
    stripPngBase64,
    stripSha256,
    stripPath,
    manifestPath,
    ...(blockingPngBase64 ? { blockingPngBase64 } : {}),
    ...(blockingSha256 ? { blockingSha256 } : {}),
    ...(blockingPath ? { blockingPath } : {}),
    stripTimes: stripFrames.map((frame) => frame.time),
    blockingTimes: blockingFrames.map((frame) => frame.time),
  };
  if (publishVisualReview) publishCanonicalVisionEvidence(projectDir, evidence);
  return evidence;
}

/** Follow a declared focal through completed component morphs in one scene. */
export function spatialFocalPartAt(scene: DirectScene, time: number): string | undefined {
  let focalPart = scene.spatialIntent?.focalPart;
  if (!focalPart) return undefined;
  const morphs = (scene.beats ?? [])
    .filter((beat) => beat.kind === "morph" && beat.morphTo)
    .sort((a, b) => a.atSec - b.atSec);
  for (const beat of morphs) {
    const endSec = beat.atSec + (beat.durationSec ?? 0.8);
    if (beat.component === focalPart && time >= endSec) focalPart = beat.morphTo!;
  }
  return focalPart;
}

/** Review a primary morph on its settled target, not its hidden source shell. */
export function primaryFocalReview(
  scene: DirectScene,
  momentAtSec: number,
  momentSubjectPart?: string,
  momentEvidenceEndSec?: number,
): { focalPart?: string; sampleAt: number } {
  const sceneEnd = scene.startSec + scene.durationSec;
  let sampleAt = Math.min(
    Math.max(momentAtSec + 0.15, scene.startSec + 0.15),
    sceneEnd - 0.08,
  );
  if (momentEvidenceEndSec !== undefined && Number.isFinite(momentEvidenceEndSec)) {
    sampleAt = Math.min(
      Math.max(sampleAt, momentEvidenceEndSec + 0.08),
      sceneEnd - 0.08,
    );
  }
  // A primary moment may concern a supporting component rather than the
  // scene-level hero (direction-live-a: feed rows at 4.5s while the later
  // mttr counter was still correctly hidden). Prefer its executable evidence
  // target; the spatial focal remains the scene-level fallback.
  let focalPart = momentSubjectPart ?? scene.spatialIntent?.focalPart;
  if (!focalPart) return { sampleAt };
  const morph = (scene.beats ?? []).find((beat) => {
    if (beat.kind !== "morph" || beat.component !== focalPart || !beat.morphTo) return false;
    const endSec = beat.atSec + (beat.durationSec ?? 0.8);
    return momentAtSec >= beat.atSec - 0.1 && momentAtSec <= endSec + 0.1;
  });
  if (morph?.morphTo) {
    sampleAt = Math.min(
      Math.max(sampleAt, morph.atSec + (morph.durationSec ?? 0.8) + 0.08),
      sceneEnd - 0.08,
    );
    focalPart = morph.morphTo;
  } else if (!momentSubjectPart) {
    focalPart = spatialFocalPartAt(scene, sampleAt) ?? focalPart;
  }
  return { focalPart, sampleAt };
}

async function auditFocalParts(
  page: import("puppeteer-core").Page,
  scenes: DirectScene[],
  time: number,
): Promise<DirectLayoutIssue[]> {
  const active = scenes.find((scene) =>
    scene.spatialIntent &&
    time >= scene.startSec &&
    time <= scene.startSec + scene.durationSec &&
    Math.abs(time - (scene.startSec + scene.durationSec * 0.58)) <= 0.04
  );
  if (!active?.spatialIntent) return [];
  const focalPart = spatialFocalPartAt(active, time) ?? active.spatialIntent.focalPart;
  return page.evaluate((payload) => {
    const scene = document.querySelector<HTMLElement>(
      `[data-scene="${CSS.escape(payload.sceneId)}"]`,
    );
    const focal = scene?.querySelector<HTMLElement>(
      `[data-part="${CSS.escape(payload.focalPart)}"]`,
    );
    const issue = (code: string, message: string, fixHint: string): DirectLayoutIssue => ({
      code,
      // Spatial intent is optional planner metadata, so focal findings never
      // block a runnable video — but they are warnings, not info, because a
      // shot whose declared subject is absent/invisible/off-frame is exactly
      // the failure that shipped a blank live film (2026-07-03 incident):
      // warnings feed the bounded repair loop, info was silently ignored.
      severity: "warning",
      time: payload.time,
      selector: focal?.id ? `#${CSS.escape(focal.id)}` : `[data-part="${payload.focalPart}"]`,
      message,
      fixHint,
      source: "sequences",
    });
    if (!scene || !focal) {
      return [issue(
        "spatial_focal_missing",
        `Declared focal part "${payload.focalPart}" is absent.`,
        "Bind the shot's dominant subject with a stable data-part.",
      )];
    }
    const rect = focal.getBoundingClientRect();
    let opacity = 1;
    let node: Element | null = focal;
    while (node) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") opacity = 0;
      opacity *= Number.parseFloat(style.opacity) || 0;
      node = node.parentElement;
    }
    if (rect.width < 1 || rect.height < 1 || opacity < 0.15) {
      return [issue(
        "spatial_focal_invisible",
        `Declared focal part "${payload.focalPart}" is not visible at the hero frame.`,
        "Resolve the shot around its declared focal subject before adding supporting motion.",
      )];
    }
    // Existence and opacity are not prominence: the blank-film incident's
    // focal part passed both while sitting entirely outside the viewport.
    // Skip the geometric checks when the part rides a transformed camera
    // world — the rig may frame it later in the shot, and near-blank
    // detection separately covers a camera that frames nothing.
    const root = document.querySelector<HTMLElement>(
      "[data-composition-id][data-width][data-height]",
    );
    const world = focal.closest<HTMLElement>("[data-camera-world]");
    const worldTransform = world ? getComputedStyle(world).transform : "";
    const worldMoved = Boolean(world) && Boolean(worldTransform) &&
      worldTransform !== "none" && worldTransform !== "matrix(1, 0, 0, 1, 0, 0)";
    if (root && !worldMoved) {
      const rootRect = root.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left));
      const height = Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top));
      const onFrame = (width * height) / (rect.width * rect.height);
      if (onFrame < 0.5) {
        return [issue(
          "spatial_focal_offframe",
          `Declared focal part "${payload.focalPart}" is mostly outside the frame at the hero frame ` +
            `(${Math.round(onFrame * 100)}% visible).`,
          "Position the shot's declared subject inside the viewport at its hero frame, or frame it with the camera rig.",
        )];
      }
      const frameArea = rootRect.width * rootRect.height;
      if (frameArea > 0 && (width * height) / frameArea < 0.005) {
        return [issue(
          "spatial_focal_minor",
          `Declared focal part "${payload.focalPart}" covers under 0.5% of the frame at the hero frame.`,
          "Scale the declared subject to visual dominance, or declare the actually-dominant element as the focal part.",
        )];
      }
    }
    return [];
  }, {
    sceneId: active.id,
    focalPart,
    time,
  });
}

/**
 * Luna owns its DOM and GSAP, so its motion-intent interactions cannot rely on
 * the legacy data-part cursor compiler. Resolve the declared selectors against
 * the rendered frame instead: the actor hotspot must land inside the live
 * target at actionSec, and the promised result must visibly change between the
 * director's own before/after evidence times.
 */
async function auditDeclaredInteractions(
  page: import("puppeteer-core").Page,
  draft: DirectCompositionDraft,
  seekContent: (time: number) => Promise<void>,
): Promise<{ issues: DirectLayoutIssue[]; evidence: DirectInteractionEvidence[] }> {
  const issues: DirectLayoutIssue[] = [];
  const evidence: DirectInteractionEvidence[] = [];
  for (const intent of (draft.declaredInteractions ?? []).slice(0, 8)) {
    await seekContent(intent.actionSec);
    const action = await page.evaluate((payload) => {
      type Rect = LayoutRect;
      const query = (selector: string): HTMLElement | null => {
        try {
          return document.querySelector<HTMLElement>(selector);
        } catch {
          return null;
        }
      };
      const rectValue = (value: DOMRect): Rect => ({
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      });
      const chainOpacity = (element: Element): number => {
        let opacity = 1;
        let node: Element | null = element;
        while (node) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return 0;
          const own = Number.parseFloat(style.opacity);
          opacity *= Number.isFinite(own) ? own : 1;
          node = node.parentElement;
        }
        return opacity;
      };
      const root = document.querySelector<HTMLElement>(
        "[data-composition-id][data-width][data-height]",
      );
      const actor = query(payload.actorSelector);
      const target = query(payload.targetSelector);
      if (!root || !actor || !target) {
        return {
          bound: false as const,
          actorFound: Boolean(actor),
          targetFound: Boolean(target),
          sceneId: target?.closest<HTMLElement>("[data-scene]")?.dataset.scene ??
            actor?.closest<HTMLElement>("[data-scene]")?.dataset.scene,
        };
      }
      const frameRect = root.getBoundingClientRect();
      const actorRect = actor.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const visibleFraction = (rect: DOMRect): number => {
        const width = Math.max(
          0,
          Math.min(rect.right, frameRect.right) - Math.max(rect.left, frameRect.left),
        );
        const height = Math.max(
          0,
          Math.min(rect.bottom, frameRect.bottom) - Math.max(rect.top, frameRect.top),
        );
        const area = rect.width * rect.height;
        return area > 0 ? (width * height) / area : 0;
      };
      const hotspotX = Math.max(
        0,
        Math.min(1, Number.parseFloat(actor.dataset.cursorHotspotX ?? "0") || 0),
      );
      const hotspotY = Math.max(
        0,
        Math.min(1, Number.parseFloat(actor.dataset.cursorHotspotY ?? "0") || 0),
      );
      const cursor = {
        x: actorRect.left + actorRect.width * hotspotX,
        y: actorRect.top + actorRect.height * hotspotY,
      };
      const inset = Math.min(
        12,
        Math.max(2, Math.min(targetRect.width, targetRect.height) * 0.14),
        Math.max(0, targetRect.width / 2 - 0.5),
        Math.max(0, targetRect.height / 2 - 0.5),
      );
      const targetPoint = {
        x: Math.max(targetRect.left + inset, Math.min(targetRect.right - inset, cursor.x)),
        y: Math.max(targetRect.top + inset, Math.min(targetRect.bottom - inset, cursor.y)),
      };
      const hit =
        cursor.x >= targetRect.left + inset && cursor.x <= targetRect.right - inset &&
        cursor.y >= targetRect.top + inset && cursor.y <= targetRect.bottom - inset;
      return {
        bound: true as const,
        sceneId: target.closest<HTMLElement>("[data-scene]")?.dataset.scene ??
          actor.closest<HTMLElement>("[data-scene]")?.dataset.scene,
        actorOpacity: chainOpacity(actor),
        actorVisibleFraction: visibleFraction(actorRect),
        targetOpacity: chainOpacity(target),
        targetVisibleFraction: visibleFraction(targetRect),
        actorRect: rectValue(actorRect),
        targetRect: rectValue(targetRect),
        cursor,
        targetPoint,
        hotspot: { x: hotspotX, y: hotspotY },
        deltaPx: Math.hypot(cursor.x - targetPoint.x, cursor.y - targetPoint.y),
        hit,
      };
    }, intent);
    const add = (code: string, message: string, fixHint: string): void => {
      issues.push({
        code,
        severity: "error",
        time: intent.actionSec,
        interactionId: intent.id,
        selector: intent.actorSelector,
        ...(action.sceneId ? { sceneId: action.sceneId } : {}),
        message,
        fixHint,
        source: "sequences",
      });
    };
    if (!action.bound) {
      add(
        "interaction_binding_missing",
        `Declared interaction "${intent.id}" cannot resolve its actor or target selector.`,
        "Keep the declared actor and target selectors unique and present in the accepted DOM.",
      );
      continue;
    }
    evidence.push({
      id: intent.id,
      phase: "press",
      time: intent.actionSec,
      cursor: action.cursor,
      target: action.targetPoint,
      deltaPx: action.deltaPx,
      hit: action.hit,
      cursorRect: action.actorRect,
      targetRect: action.targetRect,
      hotspot: action.hotspot,
    });
    if (
      action.actorOpacity < 0.15 || action.actorVisibleFraction < 0.85 ||
      action.targetOpacity < 0.35 || action.targetVisibleFraction < 0.85
    ) {
      add(
        "interaction_not_visible",
        `Declared interaction "${intent.id}" does not keep its actor and target visibly ready at ` +
          `${intent.actionSec.toFixed(2)}s.`,
        "Keep the pointer and the real target on frame and visible through the declared action time.",
      );
    }
    if (!action.hit) {
      add(
        "interaction_target_miss",
        `Declared interaction "${intent.id}" misses ${intent.targetSelector} by ` +
          `${Math.round(action.deltaPx * 10) / 10}px at ${intent.actionSec.toFixed(2)}s.`,
        "Derive the pointer endpoint from the target's measured screen-space rect at action time.",
      );
    }

    const resultSnapshot = async (time: number) => {
      await seekContent(time);
      return page.evaluate((selector) => {
        let element: HTMLElement | null = null;
        try {
          element = document.querySelector<HTMLElement>(selector);
        } catch {
          return null;
        }
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        let opacity = 1;
        let node: Element | null = element;
        while (node) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") opacity = 0;
          const own = Number.parseFloat(style.opacity);
          opacity *= Number.isFinite(own) ? own : 1;
          node = node.parentElement;
        }
        const style = getComputedStyle(element);
        return {
          opacity: Math.round(opacity * 1_000) / 1_000,
          rect: [rect.left, rect.top, rect.width, rect.height].map((value) => Math.round(value * 10) / 10),
          transform: style.transform,
          backgroundColor: style.backgroundColor,
          color: style.color,
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 256),
        };
      }, intent.resultSelector);
    };
    const before = await resultSnapshot(intent.beforeSampleSec);
    const after = await resultSnapshot(intent.afterSampleSec);
    if (!before || !after || JSON.stringify(before) === JSON.stringify(after)) {
      add(
        "interaction_result_static",
        `Declared interaction "${intent.id}" promises "${intent.observableStateChange}", but ` +
          `${intent.resultSelector} does not visibly change between ` +
          `${intent.beforeSampleSec.toFixed(2)}s and ${intent.afterSampleSec.toFixed(2)}s.`,
        "Make the declared result visibly change inside the evidence window, or correct the declared sample times.",
      );
    }
  }
  return { issues, evidence };
}

/**
 * Luna's per-act primary selector is the route-neutral load-bearing contract.
 * Sample the held body of every act, after entrances and before exits, against
 * the real frame under all authored transforms. Decorative cropping remains
 * free; only the director's declared semantic subject must stay at least 85%
 * visible.
 */
async function auditDeclaredPrimarySelectors(
  page: import("puppeteer-core").Page,
  draft: DirectCompositionDraft,
  seekContent: (time: number) => Promise<void>,
  containmentEvidence: LoadBearingContainmentEvidence[] = [],
): Promise<DirectLayoutIssue[]> {
  const issues: DirectLayoutIssue[] = [];
  for (const scene of draft.storyboard) {
    const selector = draft.declaredPrimarySelectors?.[scene.id];
    if (!selector) continue;
    const sampleAt = scene.startSec + scene.durationSec * 0.6;
    await seekContent(sampleAt);
    const measured = await page.evaluate((payload) => {
      const root = document.querySelector<HTMLElement>(
        "[data-composition-id][data-width][data-height]",
      );
      let focal: HTMLElement | null = null;
      try {
        focal = document.querySelector<HTMLElement>(payload.selector);
      } catch {
        focal = null;
      }
      if (!root || !focal) return { missing: true, opacity: 0, visibleFraction: 0 };
      const frame = root.getBoundingClientRect();
      const rect = focal.getBoundingClientRect();
      let opacity = 1;
      let node: Element | null = focal;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") opacity = 0;
        const own = Number.parseFloat(style.opacity);
        opacity *= Number.isFinite(own) ? own : 1;
        node = node.parentElement;
      }
      const width = Math.max(
        0,
        Math.min(rect.right, frame.right) - Math.max(rect.left, frame.left),
      );
      const height = Math.max(
        0,
        Math.min(rect.bottom, frame.bottom) - Math.max(rect.top, frame.top),
      );
      const area = rect.width * rect.height;
      const rectValue = (value: DOMRect) => ({
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      });
      const cssSafe = Number.parseFloat(getComputedStyle(root).getPropertyValue("--space-safe"));
      const safe = Number.isFinite(cssSafe) && cssSafe > 0
        ? cssSafe
        : Math.round(Math.min(frame.width, frame.height) * 0.06);
      return {
        missing: false,
        opacity,
        visibleFraction: area > 0 ? (width * height) / area : 0,
        rect: rectValue(rect),
        frameRect: rectValue(frame),
        safeRect: {
          left: frame.left + safe,
          top: frame.top + safe,
          right: frame.right - safe,
          bottom: frame.bottom - safe,
          width: frame.width - safe * 2,
          height: frame.height - safe * 2,
        },
      };
    }, { selector });
    containmentEvidence.push({
      sceneId: scene.id,
      part: selector,
      detector: "declared-primary",
      time: sampleAt,
      found: !measured.missing,
      opacity: measured.opacity,
      visibleFraction: measured.visibleFraction,
      requiredVisibleFraction: 0.85,
      ...(measured.rect ? { rect: measured.rect } : {}),
      ...(measured.frameRect ? { frameRect: measured.frameRect } : {}),
      ...(measured.safeRect ? { safeRect: measured.safeRect } : {}),
    });
    if (!measured.missing && measured.opacity >= 0.35 && measured.visibleFraction >= 0.85) {
      continue;
    }
    const invisible = measured.missing || measured.opacity < 0.35;
    issues.push({
      code: invisible ? "spatial_focal_invisible" : "spatial_focal_offframe",
      severity: "warning",
      time: sampleAt,
      selector,
      sceneId: scene.id,
      part: selector,
      declaredPrimary: true,
      message: invisible
        ? `Declared primary ${selector} is not visibly ready in scene "${scene.id}" at ` +
          `${sampleAt.toFixed(2)}s.`
        : `Declared primary ${selector} is only ` +
          `${Math.round(measured.visibleFraction * 100)}% inside the frame in scene ` +
          `"${scene.id}" at ${sampleAt.toFixed(2)}s.`,
      fixHint:
        "Preserve the treatment while removing compounded transforms or reframing the declared subject so at least 85% remains on frame.",
      source: "sequences",
    });
  }
  return issues;
}

/**
 * A scene-level hero sample cannot protect the exact frames the storyboard
 * calls primary. Measure each primary moment's declared focal after a short
 * settle allowance, under the active camera transform. This catches entrances
 * that begin at the promised "resolve" moment and assets still hanging outside
 * the viewport even though they become healthy later in the scene.
 */
async function auditPrimaryMomentFocals(
  page: import("puppeteer-core").Page,
  draft: DirectCompositionDraft,
  seekContent: (time: number) => Promise<void>,
  containmentEvidence: LoadBearingContainmentEvidence[] = [],
): Promise<DirectLayoutIssue[]> {
  const issues: DirectLayoutIssue[] = [];
  const failed = new Set<string>();
  const scenes = draft.storyboard;
  const duration = scenes.reduce(
    (end, scene) => Math.max(end, scene.startSec + scene.durationSec),
    0,
  );
  const boundMomentById = new Map(
    resolveMomentContract(draft.html, scenes, duration).moments
      .map((moment) => [moment.id, moment]),
  );
  for (const scene of scenes) {
    const sceneEnd = scene.startSec + scene.durationSec;
    for (const moment of (scene.moments ?? []).filter((entry) => entry.importance === "primary")) {
      // Bind source evidence before choosing a focal. Planner moments do not
      // yet carry `evidence`; falling back to the scene hero made an active
      // button/ring moment audit the wrong subject (Threadline live attempt 1).
      const evidence = boundMomentById.get(moment.id)?.evidence ?? moment.evidence;
      const evidenceTarget = evidence &&
          (evidence.kind === "component" || evidence.kind === "interaction")
        ? evidence.detail.split("→").at(-1)?.trim()
        : undefined;
      const momentSubject = evidenceTarget && /^[a-z0-9][a-z0-9-]*$/i.test(evidenceTarget)
        ? evidenceTarget
        : undefined;
      const review = primaryFocalReview(scene, moment.atSec, momentSubject, evidence?.endSec);
      const focalPart = review.focalPart;
      if (!focalPart) continue;
      const key = `${scene.id}\u0000${focalPart}`;
      if (failed.has(key)) break;
      const sampleAt = review.sampleAt;
      if (sampleAt <= scene.startSec || sampleAt >= sceneEnd) continue;
      await seekContent(sampleAt);
      const measured = await page.evaluate((payload: { sceneId: string; focalPart: string }) => {
        const root = document.querySelector<HTMLElement>(
          "[data-composition-id][data-width][data-height]",
        );
        const sceneElement = document.querySelector<HTMLElement>(
          `[data-scene="${CSS.escape(payload.sceneId)}"]`,
        );
        const focal = sceneElement?.querySelector<HTMLElement>(
          `[data-part="${CSS.escape(payload.focalPart)}"]`,
        );
        if (!root || !focal) return { missing: true, opacity: 0, onFrame: 0, frameFraction: 0 };
        const rootRect = root.getBoundingClientRect();
        const rect = focal.getBoundingClientRect();
        let opacity = 1;
        let node: Element | null = focal;
        while (node) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") opacity = 0;
          opacity *= Number.parseFloat(style.opacity) || 0;
          node = node.parentElement;
        }
        const width = Math.max(
          0,
          Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left),
        );
        const height = Math.max(
          0,
          Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top),
        );
        const area = rect.width * rect.height;
        const frameArea = rootRect.width * rootRect.height;
        const rectValue = (value: DOMRect) => ({
          left: value.left,
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          width: value.width,
          height: value.height,
        });
        const cssSafe = Number.parseFloat(getComputedStyle(root).getPropertyValue("--space-safe"));
        const safe = Number.isFinite(cssSafe) && cssSafe > 0
          ? cssSafe
          : Math.round(Math.min(rootRect.width, rootRect.height) * 0.06);
        return {
          missing: false,
          opacity,
          onFrame: area > 0 ? (width * height) / area : 0,
          frameFraction: frameArea > 0 ? (width * height) / frameArea : 0,
          rect: rectValue(rect),
          frameRect: rectValue(rootRect),
          safeRect: {
            left: rootRect.left + safe,
            top: rootRect.top + safe,
            right: rootRect.right - safe,
            bottom: rootRect.bottom - safe,
            width: rootRect.width - safe * 2,
            height: rootRect.height - safe * 2,
          },
        };
      }, { sceneId: scene.id, focalPart });
      containmentEvidence.push({
        sceneId: scene.id,
        part: focalPart,
        detector: "primary-moment",
        time: sampleAt,
        found: !measured.missing,
        opacity: measured.opacity,
        visibleFraction: measured.onFrame,
        requiredVisibleFraction: 0.85,
        ...(measured.rect ? { rect: measured.rect } : {}),
        ...(measured.frameRect ? { frameRect: measured.frameRect } : {}),
        ...(measured.safeRect ? { safeRect: measured.safeRect } : {}),
      });
      if (!measured.missing && measured.opacity >= 0.35 && measured.onFrame >= 0.85) continue;
      failed.add(key);
      const invisible = measured.missing || measured.opacity < 0.35;
      issues.push({
        code: invisible ? "spatial_focal_invisible" : "spatial_focal_offframe",
        severity: "warning",
        time: sampleAt,
        selector: `[data-part="${focalPart}"]`,
        sceneId: scene.id,
        part: focalPart,
        momentImportance: "primary",
        message: invisible
          ? `Primary moment "${moment.id}" promises focal part "${focalPart}", but it is not ` +
            `visibly ready at the review frame (${sampleAt.toFixed(2)}s).`
          : `Primary moment "${moment.id}" promises focal part "${focalPart}", but only ` +
            `${Math.round(measured.onFrame * 100)}% is inside the frame at its review frame ` +
            `(${sampleAt.toFixed(2)}s).`,
        fixHint:
          "Finish the focal entrance before the primary moment, move the moment to the settled " +
          "state, or reframe the subject so at least 85% is visible at that exact review frame.",
        source: "sequences",
      });
    }
  }
  return issues;
}

/** Feature-on browser proof for the camera that actually ships. Exported for tests. */
export async function auditCameraBlockingLandings(
  page: import("puppeteer-core").Page,
  draft: DirectCompositionDraft,
  seekContent: (time: number) => Promise<void>,
  containmentEvidence: LoadBearingContainmentEvidence[] = [],
): Promise<DirectLayoutIssue[]> {
  const plan = parseCameraPhrasePlan(draft.html);
  if (!plan?.enabled) return [];
  const tolerances = cameraPhraseTolerances(plan);
  const sceneEndById = new Map(draft.storyboard.map((scene) => [
    scene.id,
    scene.startSec + scene.durationSec,
  ]));
  const issues: DirectLayoutIssue[] = [];
  for (const block of plan.scenes.flatMap((scene) => scene.phrases)) {
    if (block.target.kind !== "part") continue;
    // The runtime explicitly lets supporting phrases yield to the next
    // primary route; they can extend a same-pose hold but do not own a lens
    // landing. Audit only primary promises here. Supporting components with an
    // explicit full-move destination are promoted to primary by the blocking
    // resolver, so camera-load-bearing CTAs remain covered.
    if (block.importance !== "primary") continue;
    const sceneEnd = sceneEndById.get(block.sceneId);
    if (sceneEnd === undefined) continue;
    // Judge the settled readable landing, not the first 80ms after camera
    // arrival. Host component/entrance motion may legitimately begin at the
    // phrase boundary; sampling there charged LumaFlow for invisible
    // release-card/shipped-badge roots that were fully readable later inside
    // the declared dwell. A target that never becomes readable still fails at
    // the end of that same bounded window.
    const sampleAt = Math.min(
      sceneEnd - tolerances.landingSampleInsetSec,
      Math.max(
        block.arrivalSec + tolerances.landingSampleInsetSec,
        block.dwell.endSec - tolerances.landingSampleInsetSec,
      ),
    );
    if (sampleAt <= 0) continue;
    await seekContent(sampleAt);
    const measured = await page.evaluate((payload: {
      sceneId: string;
      part: string;
      framing: { kind: "part" | "region"; id: string } | null;
    }) => {
      const root = document.querySelector<HTMLElement>(
        "[data-composition-id][data-width][data-height]",
      );
      const scene = document.querySelector<HTMLElement>(
        `[data-scene="${CSS.escape(payload.sceneId)}"]`,
      );
      const target = scene?.querySelector<HTMLElement>(
        `[data-part="${CSS.escape(payload.part)}"]`,
      );
      if (!root || !target) {
        return {
          missing: true,
          opacity: 0,
          visibleFraction: 0,
          occupancyFraction: 0,
          framingOccupancyFraction: -1,
          framingCollapsed: true,
        };
      }
      const frame = root.getBoundingClientRect();
      const frameArea = Math.max(1, frame.width * frame.height);
      const opacityCache = new Map<Element, number>();
      const chainOpacity = (element: Element | null): number => {
        if (!element) return 1;
        const cached = opacityCache.get(element);
        if (cached !== undefined) return cached;
        const style = getComputedStyle(element);
        const own = style.display === "none" || style.visibility === "hidden"
          ? 0
          : Number.parseFloat(style.opacity);
        const value = (Number.isFinite(own) ? own : 1) * chainOpacity(element.parentElement);
        opacityCache.set(element, value);
        return value;
      };
      const visibleAreaOf = (rect: { left: number; top: number; right: number; bottom: number }) => {
        const width = Math.max(0, Math.min(rect.right, frame.right) - Math.max(rect.left, frame.left));
        const height = Math.max(0, Math.min(rect.bottom, frame.bottom) - Math.max(rect.top, frame.top));
        return width * height;
      };
      const rect = target.getBoundingClientRect();
      const opacity = chainOpacity(target);
      const area = Math.max(0, rect.width * rect.height);
      const visibleArea = visibleAreaOf(rect);
      const rectValue = (value: DOMRect) => ({
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      });
      const cssSafe = Number.parseFloat(getComputedStyle(root).getPropertyValue("--space-safe"));
      const safe = Number.isFinite(cssSafe) && cssSafe > 0
        ? cssSafe
        : Math.round(Math.min(frame.width, frame.height) * 0.06);
      // Mirror the camera runtime's regionContentRect: an ensemble framing
      // station is judged by the union of its painted/semantic content, not
      // its raw placement rect, and a station whose only painted content IS
      // the addressed subject collapses back to the subject's own contract.
      let framingOccupancyFraction = -1;
      let framingCollapsed = true;
      const framingElement = payload.framing && scene
        ? payload.framing.kind === "region"
          ? scene.querySelector<HTMLElement>(`[data-region="${CSS.escape(payload.framing.id)}"]`)
          : scene.querySelector<HTMLElement>(`[data-part="${CSS.escape(payload.framing.id)}"]`)
        : null;
      if (framingElement) {
        const MEDIA = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE"]);
        const hasVisualPaint = (element: HTMLElement): boolean => {
          const style = getComputedStyle(element);
          const colorHasAlpha = (value: string): boolean => {
            if (!value || value === "transparent") return false;
            const match = value.match(/rgba?\(([^)]+)\)/i);
            if (!match) return true;
            const channels = match[1]!.split(",");
            return channels.length < 4 || Number(channels[3]) > 0.02;
          };
          return colorHasAlpha(style.backgroundColor) || style.backgroundImage !== "none" ||
            style.boxShadow !== "none" || style.outlineStyle !== "none" ||
            (Number.parseFloat(style.borderTopWidth) || 0) > 0 ||
            (Number.parseFloat(style.borderRightWidth) || 0) > 0 ||
            (Number.parseFloat(style.borderBottomWidth) || 0) > 0 ||
            (Number.parseFloat(style.borderLeftWidth) || 0) > 0;
        };
        const nodes = [framingElement, ...Array.from(framingElement.querySelectorAll<HTMLElement>("*"))];
        const prefersSemantic = Boolean(
          framingElement.querySelector("[data-layout-important],[data-component],[data-part]"),
        );
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const node of nodes) {
          if (node.closest("[data-layout-ignore],[data-camera-overlay]")) continue;
          if (node.matches(".cmp-scrim,.seq-whip-lens,[data-layout-decorative]")) continue;
          const isSemantic = node.matches("[data-layout-important],[data-component],[data-part]");
          const hasText = Array.from(node.childNodes).some((child) =>
            child.nodeType === Node.TEXT_NODE && /\S/.test(child.textContent ?? ""),
          );
          const isMedia = MEDIA.has(node.tagName.toUpperCase());
          const isPainted = hasVisualPaint(node);
          if (
            prefersSemantic
              ? !(isSemantic || hasText || isMedia) || !(hasText || isMedia || isPainted)
              : !(hasText || isMedia || isPainted)
          ) continue;
          if (chainOpacity(node) < 0.35) continue;
          const nodeRect = node.getBoundingClientRect();
          if (nodeRect.width < 4 || nodeRect.height < 4) continue;
          left = Math.min(left, nodeRect.left);
          top = Math.min(top, nodeRect.top);
          right = Math.max(right, nodeRect.right);
          bottom = Math.max(bottom, nodeRect.bottom);
        }
        const union = right > left && bottom > top
          ? { left, top, right, bottom, width: right - left, height: bottom - top }
          : (() => {
              const fallback = framingElement.getBoundingClientRect();
              return {
                left: fallback.left,
                top: fallback.top,
                right: fallback.right,
                bottom: fallback.bottom,
                width: fallback.width,
                height: fallback.height,
              };
            })();
        framingCollapsed =
          Math.abs(union.left - rect.left) <= 4 &&
          Math.abs(union.top - rect.top) <= 4 &&
          Math.abs(union.width - rect.width) <= 4 &&
          Math.abs(union.height - rect.height) <= 4;
        framingOccupancyFraction = visibleAreaOf(union) / frameArea;
      }
      return {
        missing: false,
        opacity,
        visibleFraction: area > 0 ? visibleArea / area : 0,
        occupancyFraction: visibleArea / frameArea,
        framingOccupancyFraction,
        framingCollapsed,
        rect: rectValue(rect),
        frameRect: rectValue(frame),
        safeRect: {
          left: frame.left + safe,
          top: frame.top + safe,
          right: frame.right - safe,
          bottom: frame.bottom - safe,
          width: frame.width - safe * 2,
          height: frame.height - safe * 2,
        },
      };
    }, {
      sceneId: block.sceneId,
      part: block.target.id,
      framing: block.framingTarget ?? null,
    });
    containmentEvidence.push({
      sceneId: block.sceneId,
      part: block.target.id,
      detector: "camera-blocking",
      time: sampleAt,
      found: !measured.missing,
      opacity: measured.opacity,
      visibleFraction: measured.visibleFraction,
      requiredVisibleFraction: tolerances.visibleFractionMin,
      ...(measured.rect ? { rect: measured.rect } : {}),
      ...(measured.frameRect ? { frameRect: measured.frameRect } : {}),
      ...(measured.safeRect ? { safeRect: measured.safeRect } : {}),
    });
    const visible = !measured.missing && measured.opacity >= tolerances.opacityMin &&
      measured.visibleFraction >= tolerances.visibleFractionMin;
    // Browser geometry is fractional and the runtime solver intentionally
    // accepts a 10% landing band. Mirror that contract here so a 1.4% measured
    // tile does not fail a 1.5% semantic floor while the runtime reports the
    // same landing as in-range. Upper bounds stay exact: oversize framing is a
    // genuine hierarchy defect, not sub-pixel noise.
    const subjectInRange = measured.occupancyFraction >=
        block.occupancy.min * tolerances.occupancyMinFactor - 1e-6 &&
      measured.occupancyFraction <=
        block.occupancy.max * tolerances.occupancyMaxFactor + 1e-6;
    // An ensemble phrase (declared framingTarget) is satisfied when the camera
    // frames the contextual station inside ITS occupancy contract and the
    // subject stays fully readable. The runtime deliberately caps zoom so the
    // context remains delivery-safe, which can legitimately hold a compact
    // subject below its solo floor; judging the subject's solo range there
    // burned paid attempts on a host-owned decision (motion-quality-verify-1).
    const ensembleInRange = Boolean(
      block.framingTarget && block.framingOccupancy &&
      measured.framingOccupancyFraction >= 0 && !measured.framingCollapsed &&
      measured.framingOccupancyFraction >=
        block.framingOccupancy.min * tolerances.occupancyMinFactor - 1e-6 &&
      measured.framingOccupancyFraction <=
        block.framingOccupancy.max * tolerances.occupancyMaxFactor + 1e-6,
    );
    const inRange = subjectInRange || ensembleInRange;
    if (visible && inRange) continue;
    const framingNote = block.framingTarget && block.framingOccupancy
      ? measured.framingCollapsed
        ? ` (framing station "${block.framingTarget.id}" collapses to the subject, so the subject's own range binds)`
        : `; ensemble framing "${block.framingTarget.id}" measured ` +
          `${(Math.max(0, measured.framingOccupancyFraction) * 100).toFixed(1)}% against ` +
          `${(block.framingOccupancy.min * 100).toFixed(1)}–` +
          `${(block.framingOccupancy.max * 100).toFixed(1)}%`
      : "";
    issues.push({
      code: "camera_blocking_landing",
      severity: "warning",
      time: sampleAt,
      selector: `[data-part="${block.target.id}"]`,
      sceneId: block.sceneId,
      part: block.target.id,
      message:
        `Blocking phrase "${block.phraseId}" lands on "${block.target.id}" with ` +
        `${Math.round(measured.visibleFraction * 100)}% visibility and ` +
        `${(measured.occupancyFraction * 100).toFixed(1)}% frame occupancy; expected ` +
        `>=85% visibility and ${(block.occupancy.min * 100).toFixed(1)}–` +
        `${(block.occupancy.max * 100).toFixed(1)}% occupancy${framingNote}.`,
      fixHint:
        "Keep the blocking target visible through its dwell and adjust its station bounds or " +
        "component scale so the measured occupancy lands inside the declared range.",
      source: "sequences",
    });
  }
  return issues;
}

/**
 * Fraction of the frame covered by visible, meaning-bearing content — text,
 * media (img/svg/video/canvas), or declared `data-part` elements — at the
 * current seek time. Backgrounds, gradients, and the cinematography kit's
 * grain/vignette layers deliberately do not count: an audience seeing only
 * backgrounds is looking at a blank frame. DOM-rect coverage on a coarse
 * grid was chosen over screenshot pixel analysis because the cinema kit
 * guarantees every frame has nonzero pixel variance (grain), which defeats
 * naive blankness statistics, while rect coverage is deterministic and cheap.
 */
async function measureContentCoverage(
  page: import("puppeteer-core").Page,
  includeCompositionCredit = false,
): Promise<number> {
  return page.evaluate((includeCredit: boolean) => {
    const root = document.querySelector<HTMLElement>(
      "[data-composition-id][data-width][data-height]",
    );
    if (!root) return 0;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width < 1 || rootRect.height < 1) return 0;
    const MEDIA = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE"]);
    const opacityCache = new Map<Element, number>();
    const chainOpacity = (element: Element | null): number => {
      if (!element || !root.contains(element) && element !== root) return 1;
      const cached = opacityCache.get(element);
      if (cached !== undefined) return cached;
      const style = getComputedStyle(element);
      const own = style.display === "none" || style.visibility === "hidden"
        ? 0
        : Number.parseFloat(style.opacity);
      const value = (Number.isFinite(own) ? own : 1) * chainOpacity(element.parentElement);
      opacityCache.set(element, value);
      return value;
    };
    const rects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      const credited = includeCredit && element.hasAttribute("data-composition-credit");
      if (element.closest("[data-layout-ignore]") && !credited) continue;
      const hasText = Array.from(element.childNodes).some((node) =>
        node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent ?? ""),
      );
      const isContent = hasText ||
        MEDIA.has(element.tagName.toUpperCase()) ||
        element.hasAttribute("data-part") ||
        credited;
      if (!isContent) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const left = Math.max(rect.left, rootRect.left);
      const top = Math.max(rect.top, rootRect.top);
      const right = Math.min(rect.right, rootRect.right);
      const bottom = Math.min(rect.bottom, rootRect.bottom);
      if (right - left < 4 || bottom - top < 4) continue;
      if (chainOpacity(element) < 0.05) continue;
      rects.push({ left, top, right, bottom });
    }
    if (!rects.length) return 0;
    const COLUMNS = 32;
    const ROWS = 18;
    let covered = 0;
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const x = rootRect.left + ((column + 0.5) / COLUMNS) * rootRect.width;
        const y = rootRect.top + ((row + 0.5) / ROWS) * rootRect.height;
        if (rects.some((rect) =>
          x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        )) {
          covered += 1;
        }
      }
    }
    return covered / (COLUMNS * ROWS);
  }, includeCompositionCredit);
}

/** Parts smaller than this on either axis cannot carry a readable bridge. */
const BOUNDARY_PART_MIN_PX = 24;
/** Cap measured parts per boundary side to bound QA cost on dense scenes. */
const BOUNDARY_PART_CAP = 16;

/**
 * Measure every visible `data-part` of one scene at the current seek time:
 * viewport rect, resolved border-radius, and subtree node count — the same
 * idioms the cut runtime's `shapeMatchAudit`/`radiusPx` use, so a
 * discovery-time score and the bind-time audit agree about geometry.
 *
 * `priorityParts` are measured FIRST regardless of DOM order: the declared
 * attention/focal targets must never be silently dropped by the measurement
 * cap in a dense scene (a real probe lost `spatialIntent.focalPart` as the
 * 17th part and the eye-trace audit went blind); arbitrary parts fill the
 * remaining budget.
 */
async function measureBoundaryParts(
  page: import("puppeteer-core").Page,
  sceneId: string,
  priorityParts: string[] = [],
): Promise<BoundaryPartMeasurement[]> {
  return page.evaluate((payload: {
    sceneId: string;
    minPx: number;
    cap: number;
    priorityParts: string[];
  }) => {
    const root = document.querySelector<HTMLElement>(
      "[data-composition-id][data-width][data-height]",
    );
    const scene = root?.querySelector<HTMLElement>(
      `[data-scene="${CSS.escape(payload.sceneId)}"]`,
    );
    if (!root || !scene) return [];
    const rootRect = root.getBoundingClientRect();
    const measurements: BoundaryPartMeasurement[] = [];
    const all = Array.from(scene.querySelectorAll<HTMLElement>("[data-part]"));
    const prioritized = new Set(payload.priorityParts);
    const ordered = [
      ...all.filter((element) => prioritized.has(element.getAttribute("data-part") ?? "")),
      ...all.filter((element) => !prioritized.has(element.getAttribute("data-part") ?? "")),
    ];
    for (const element of ordered) {
      if (measurements.length >= payload.cap) break;
      const part = element.getAttribute("data-part") ?? "";
      if (!part) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < payload.minPx || rect.height < payload.minPx) continue;
      let opacity = 1;
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          opacity = 0;
          break;
        }
        opacity *= Number.parseFloat(style.opacity) || 0;
        node = node.parentElement;
      }
      if (opacity < 0.15) continue;
      // Radius resolved to px against the element's own layout box, so a
      // "50%" circle and an "18px" card compare in one unit (offset sizes
      // are transform-immune).
      const raw = getComputedStyle(element).borderTopLeftRadius || "0px";
      let radiusPx = Number.parseFloat(raw) || 0;
      if (raw.includes("%")) {
        radiusPx = (radiusPx / 100) *
          Math.min(element.offsetWidth || 1, element.offsetHeight || 1);
      }
      const onWidth = Math.max(
        0,
        Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left),
      );
      const onHeight = Math.max(
        0,
        Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top),
      );
      measurements.push({
        part,
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
        radiusPx,
        nodeCount: element.querySelectorAll("*").length + 1,
        onFrameRatio: (onWidth * onHeight) / (rect.width * rect.height),
      });
    }
    return measurements;
  }, { sceneId, minPx: BOUNDARY_PART_MIN_PX, cap: BOUNDARY_PART_CAP, priorityParts });
}

/* --------------------------------------- exit discipline (WS4, QA stage) */

/** A done surface must have finished its last beat this long ago to linger. */
const STALE_MIN_ELAPSED_SEC = 0.5;
/** Opacity at/above which a done surface is still fully present (not fading). */
const STALE_MIN_OPACITY = 0.9;
/** Intersection over the smaller rect above which two surfaces visibly overlap. */
const STALE_MIN_OVERLAP = 0.25;
/** On-frame size (px) below which a surface is a leftover accent, not a stack. */
const STALE_MIN_SIZE_PX = 80;
/** Hard cap on the extra seeks this advisory pass may add across the film. */
const STALE_MAX_SAMPLES = 8;

interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
}

/** Intersection area over the smaller of two frame rects (0..1). */
function intersectionOverMin(a: FrameRect, b: FrameRect): number {
  const ix = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const iy = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea > 0 ? (ix * iy) / minArea : 0;
}

/**
 * Measure named `data-part` surfaces of one scene at the current seek: rect
 * clamped to the visible frame (a surface parked off-camera reads as size 0
 * and is never "lingering") and chained opacity. Scoped to the scene subtree
 * so a cut bridge clone in its own overlay layer is never sampled (gotcha #7);
 * the pass only runs OUTSIDE cut windows anyway.
 */
async function measureComponentRects(
  page: import("puppeteer-core").Page,
  sceneId: string,
  partIds: string[],
): Promise<Map<string, FrameRect>> {
  const raw = await page.evaluate((payload: { sceneId: string; partIds: string[] }) => {
    const root = document.querySelector<HTMLElement>(
      "[data-composition-id][data-width][data-height]",
    );
    const scene = root?.querySelector<HTMLElement>(
      `[data-scene="${CSS.escape(payload.sceneId)}"]`,
    );
    if (!root || !scene) return [];
    const rootRect = root.getBoundingClientRect();
    const out: Array<{ part: string } & FrameRect> = [];
    for (const part of payload.partIds) {
      const element = scene.querySelector<HTMLElement>(`[data-part="${CSS.escape(part)}"]`);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      let opacity = 1;
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          opacity = 0;
          break;
        }
        opacity *= Number.parseFloat(style.opacity) || 0;
        node = node.parentElement;
      }
      const left = Math.max(rect.left, rootRect.left);
      const top = Math.max(rect.top, rootRect.top);
      const right = Math.min(rect.right, rootRect.right);
      const bottom = Math.min(rect.bottom, rootRect.bottom);
      out.push({
        part,
        left: left - rootRect.left,
        top: top - rootRect.top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        opacity,
      });
    }
    return out;
  }, { sceneId, partIds });
  return new Map(raw.map(({ part, ...rect }) => [part, rect]));
}

/**
 * Exit discipline (WS4), QA stage. The plan-stage `auditSurfaceExits` catches
 * a stacked OPEN before the film compiles; this catches what the plan cannot
 * see — a surface whose last beat has passed still sitting at full opacity,
 * overlapping the element the viewer is now watching (operator verdict on
 * probe-cutfix-3: "assets don't disappear when necessary and overlap"). It is
 * ALWAYS advisory (never blocks publication, never a strictOk pressure) and
 * bounded to a handful of extra seeks: false positives are the whole game, so
 * it constrains to real overlap with the focal element — not mere presence —
 * and exempts `role:"hero"` chrome that legitimately stays. Findings feed the
 * repair prompt as guidance only.
 */
async function auditStaleAssets(
  page: import("puppeteer-core").Page,
  draft: DirectCompositionDraft,
  seekContent: (time: number) => Promise<void>,
  insideCutWindow: (time: number) => boolean,
): Promise<DirectLayoutIssue[]> {
  const plan = parseComponentPlan(draft.html).plan;
  if (!plan) return [];
  const beatsByScene = new Map(plan.scenes.map((scene) => [scene.sceneId, scene.beats]));
  const issues: DirectLayoutIssue[] = [];
  const flagged = new Set<string>();
  let samples = 0;
  for (const scene of draft.storyboard) {
    if (samples >= STALE_MAX_SAMPLES) break;
    const components = scene.components ?? [];
    const beats = beatsByScene.get(scene.id) ?? [];
    if (components.length < 2 || !beats.length) continue;
    const kindById = new Map(components.map((component) => [component.id, component.kind]));
    const roleById = new Map(components.map((component) => [component.id, component.role]));
    const lastBeatEnd = new Map<string, number>();
    for (const beat of beats) {
      lastBeatEnd.set(
        beat.component,
        Math.max(lastBeatEnd.get(beat.component) ?? 0, beat.endSec),
      );
    }
    const sceneEnd = scene.startSec + scene.durationSec;
    const seen = new Set<number>();
    let perScene = 0;
    for (const beat of [...beats].sort((a, b) => a.startSec - b.startSec)) {
      if (perScene >= 2 || samples >= STALE_MAX_SAMPLES) break;
      const t = Math.min(beat.endSec + 0.15, sceneEnd - 0.1);
      if (t <= scene.startSec || insideCutWindow(t)) continue;
      const rounded = Math.round(t * 20) / 20;
      if (seen.has(rounded)) continue;
      // A surface is a candidate only if another surface's last beat is
      // already done — its story job ended while this focal beat plays.
      const stale = components.filter((component) =>
        component.id !== beat.component &&
        // A host plugin is one semantic surface. Its connector/row/tile
        // children deliberately overlap inside that unit and must not be
        // audited as independently expired authored surfaces.
        !component.pluginUid &&
        roleById.get(component.id) !== "hero" &&
        (lastBeatEnd.get(component.id) ?? Infinity) < t - STALE_MIN_ELAPSED_SEC &&
        !flagged.has(`${scene.id}:${component.id}`)
      );
      if (!stale.length) continue;
      seen.add(rounded);
      perScene += 1;
      samples += 1;
      await seekContent(t);
      const rects = await measureComponentRects(page, scene.id, [
        beat.component,
        ...stale.map((component) => component.id),
      ]);
      const focal = rects.get(beat.component);
      if (!focal || focal.width < STALE_MIN_SIZE_PX || focal.height < STALE_MIN_SIZE_PX) continue;
      for (const component of stale) {
        const rect = rects.get(component.id);
        if (!rect || rect.opacity < STALE_MIN_OPACITY) continue;
        if (rect.width < STALE_MIN_SIZE_PX || rect.height < STALE_MIN_SIZE_PX) continue;
        const overlap = intersectionOverMin(focal, rect);
        if (overlap < STALE_MIN_OVERLAP) continue;
        flagged.add(`${scene.id}:${component.id}`);
        const doneAt = lastBeatEnd.get(component.id) ?? 0;
        issues.push({
          code: "stale_asset_lingers",
          severity: "warning",
          time: t,
          selector: `[data-part="${component.id}"]`,
          message:
            `In scene "${scene.id}", "${component.id}" ` +
            `(${kindById.get(component.id) ?? "surface"}) finished its last beat at ` +
            `${doneAt.toFixed(1)}s but is still fully visible at ${t.toFixed(1)}s, overlapping ` +
            `${Math.round(overlap * 100)}% of the focal "${beat.component}" the viewer is watching.`,
          fixHint:
            "Retire a surface when its job ends: close/swap/morph it out, dim or scale it to " +
            "recede (≤40%), or move it to its own station so it stops crowding the focal element.",
          source: "sequences",
        });
      }
    }
  }
  return issues;
}

/** Below this 24x14 semantic-grid fraction, a frame reads as mostly void. */
// 59 occupied cells is the calibrated floor; 60/336 (17.86%) is the first
// stable post-correction tier while the known void compositions remain far
// below it.
const SPARSE_COVERAGE_MIN = 0.175;
/**
 * A large union bbox can be faked by a few tiny fragments in opposite corners.
 * Require a modest amount of actually painted/text/media area as well.
 */
const SPARSE_OCCUPANCY_MIN = 0.055;
/** Content spanning this much of one frame axis is a deliberate composition. */
const SPARSE_AXIS_ESCAPE = 0.6;
/** A true band/rail stays compact on the perpendicular axis. */
const SPARSE_AXIS_ESCAPE_THICKNESS = 0.35;
/** Scenes shorter than this are stings/flashes — never judged for coverage. */
const SPARSE_MIN_SCENE_SEC = 2;

/** Whole-frame semantic + intentional-environment composition floor. */
const COMPOSITION_COVERAGE_MIN = 0.3;
function compositionFloorMode(): "off" | "audit" | "block" {
  const value = slackSequencesEnvRawValue("SLACK_SEQUENCES_COMPOSITION")?.trim().toLowerCase();
  if (value === "0" || value === "off") return "off";
  if (value === "block") return "block";
  return "audit";
}

/** Exact-copy audit thresholds: deliberately too high for brand/CTA tokens. */
export const REPEATED_VISIBLE_COPY_MIN_CHARS = 30;
export const REPEATED_VISIBLE_COPY_MIN_WORDS = 5;
const REPEATED_VISIBLE_COPY_MAX_PER_SAMPLE = 6;

/**
 * High-confidence same-landing copy audit (owner ledger: QuillSign duplicate
 * liability clause). Browser truth is required: static markup cannot know
 * whether responsive twins, transition clones, or component split spans are
 * actually visible together. The finding is strict polish only; it never
 * enters `errors` and therefore never changes browser `ok`.
 */
async function auditRepeatedVisibleCopy(
  page: import("puppeteer-core").Page,
  time: number,
): Promise<DirectLayoutIssue[]> {
  const findings = await page.evaluate((thresholds: {
    minChars: number;
    minWords: number;
    maxFindings: number;
  }) => {
    const composition = document.querySelector<HTMLElement>(
      "[data-composition-id][data-width][data-height]",
    );
    if (!composition) return [];
    const compositionRect = composition.getBoundingClientRect();
    const candidateSelector = [
      "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote",
      "label", "button", "[role='heading']", "[data-copy-root]",
      "[data-part]", "[data-component]",
    ].join(",");
    const excludedAncestorSelector = [
      "[aria-hidden='true']", "[hidden]", "[inert]", "[data-layout-ignore]",
      "[data-sequences-host]", "[data-sequences-plugin]",
      "[data-sequences-plugin-duplicate]", "[data-sequences-runtime-cut]",
      "[data-sequences-fx]", "[data-sequences-display-type]",
      ".seq-component-morph-bridge", ".cmp-split",
    ].join(",");
    const excludedContentSelector = [
      "[aria-hidden='true']", "[data-sequences-runtime-cut]",
      "[data-sequences-fx]", ".seq-component-morph-bridge", ".cmp-split",
    ].join(",");
    const escapeAttr = (value: string): string =>
      value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const escapeCss = (value: string): string =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const normalizedText = (value: string): string =>
      value.normalize("NFKC").replace(/\s+/g, " ").trim();
    const opacityThrough = (element: Element, stop: Element): number => {
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.display === "none" || style.visibility === "hidden" ||
          style.visibility === "collapse"
        ) return 0;
        opacity *= Number.parseFloat(style.opacity) || 0;
        if (node === stop) break;
      }
      return opacity;
    };
    const visibleRect = (element: HTMLElement, scene: HTMLElement): DOMRect | undefined => {
      if (opacityThrough(element, scene) < 0.15) return undefined;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return undefined;
      const left = Math.max(rect.left, compositionRect.left);
      const top = Math.max(rect.top, compositionRect.top);
      const right = Math.min(rect.right, compositionRect.right);
      const bottom = Math.min(rect.bottom, compositionRect.bottom);
      return right - left >= 2 && bottom - top >= 2 ? rect : undefined;
    };
    const sceneSelector = (scene: HTMLElement): string => {
      const id = scene.getAttribute("data-scene");
      return id ? `[data-scene="${escapeAttr(id)}"]` : `#${escapeCss(scene.id)}`;
    };
    const stableSelector = (element: HTMLElement, scene: HTMLElement): string => {
      if (element.id && composition.querySelectorAll(`#${escapeCss(element.id)}`).length === 1) {
        return `#${escapeCss(element.id)}`;
      }
      const part = element.getAttribute("data-part");
      if (part && scene.querySelectorAll(`[data-part="${escapeAttr(part)}"]`).length === 1) {
        return `${sceneSelector(scene)} [data-part="${escapeAttr(part)}"]`;
      }
      const path: string[] = [];
      for (let node: Element | null = element; node && node !== scene; node = node.parentElement) {
        const tag = node.tagName.toLowerCase();
        const siblings = node.parentElement
          ? Array.from(node.parentElement.children).filter((entry) => entry.tagName === node!.tagName)
          : [node];
        path.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
      }
      return `${sceneSelector(scene)} > ${path.join(" > ")}`;
    };
    const rectValue = (rect: DOMRect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    type Candidate = {
      element: HTMLElement;
      owner: Element;
      sceneId: string;
      text: string;
      key: string;
      selector: string;
      rect: DOMRect;
    };
    const results: Array<{
      sceneId: string;
      text: string;
      selector: string;
      peerSelector: string;
      rect: ReturnType<typeof rectValue>;
      peerRect: ReturnType<typeof rectValue>;
    }> = [];

    for (const scene of Array.from(composition.querySelectorAll<HTMLElement>("[data-scene]"))) {
      if (!visibleRect(scene, scene)) continue;
      const sceneId = scene.getAttribute("data-scene") || scene.id || "scene";
      const initial: Candidate[] = [];
      for (const element of Array.from(scene.querySelectorAll<HTMLElement>(candidateSelector))) {
        // CTA/brand tokens are explicitly out of scope, even if localization
        // makes one exceed the general length threshold.
        if (element.closest("a,button,[role='button']")) continue;
        if (element.closest("[data-brand],[data-logo],[data-wordmark],[data-component='logo'],[data-component='wordmark']")) {
          continue;
        }
        if (element.closest(excludedAncestorSelector)) continue;
        // A kinetic/split root is one authored phrase rendered as many spans,
        // not repeated copy. Exclude the whole aggregate, not merely each span.
        if (element.querySelector(excludedContentSelector)) continue;
        const text = normalizedText(element.innerText || element.textContent || "");
        const wordCount = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
        if (text.length < thresholds.minChars || wordCount < thresholds.minWords) continue;
        const rect = visibleRect(element, scene);
        if (!rect) continue;
        const owner = element.closest("[data-component][data-part],[data-part],[data-component]") ??
          element;
        initial.push({
          element,
          owner,
          sceneId,
          text,
          key: text.toLocaleLowerCase(),
          selector: stableSelector(element, scene),
          rect,
        });
      }
      // Prefer the smallest semantic text root. A data-part wrapper containing
      // one paragraph otherwise repeats the same DOM text before comparison.
      const candidates = initial.filter((candidate) =>
        !initial.some((other) =>
          other !== candidate && other.key === candidate.key &&
          candidate.element.contains(other.element)
        )
      );
      const groups = new Map<string, Candidate[]>();
      for (const candidate of candidates) {
        const group = groups.get(candidate.key);
        if (group) group.push(candidate);
        else groups.set(candidate.key, [candidate]);
      }
      for (const group of groups.values()) {
        const byOwner = new Map<Element, Candidate>();
        for (const candidate of group) {
          if (!byOwner.has(candidate.owner)) byOwner.set(candidate.owner, candidate);
        }
        const distinct = [...byOwner.values()];
        let pair: [Candidate, Candidate] | undefined;
        for (let left = 0; left < distinct.length && !pair; left += 1) {
          for (let right = left + 1; right < distinct.length; right += 1) {
            const a = distinct[left]!;
            const b = distinct[right]!;
            if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
            // Byte-identical overlay twins are usually responsive/runtime
            // mirrors. Named host mirrors are already excluded; retain this
            // geometry backstop for unannotated accessibility twins.
            const sameBox = Math.abs(a.rect.left - b.rect.left) < 2 &&
              Math.abs(a.rect.top - b.rect.top) < 2 &&
              Math.abs(a.rect.width - b.rect.width) < 2 &&
              Math.abs(a.rect.height - b.rect.height) < 2;
            if (!sameBox) pair = [a, b];
          }
        }
        if (!pair) continue;
        results.push({
          sceneId,
          text: pair[0].text,
          selector: pair[0].selector,
          peerSelector: pair[1].selector,
          rect: rectValue(pair[0].rect),
          peerRect: rectValue(pair[1].rect),
        });
        if (results.length >= thresholds.maxFindings) return results;
      }
    }
    return results;
  }, {
    minChars: REPEATED_VISIBLE_COPY_MIN_CHARS,
    minWords: REPEATED_VISIBLE_COPY_MIN_WORDS,
    maxFindings: REPEATED_VISIBLE_COPY_MAX_PER_SAMPLE,
  });

  return findings.map((finding): DirectLayoutIssue => ({
    code: "repeated_visible_copy",
    severity: "warning",
    time,
    selector: finding.selector,
    sceneId: finding.sceneId,
    text: finding.text,
    rect: finding.rect,
    peerRect: finding.peerRect,
    message:
      `Scene "${finding.sceneId}" renders the same substantial copy in distinct visible ` +
      `surfaces (${finding.selector} and ${finding.peerSelector}): ` +
      `"${finding.text.slice(0, 120)}${finding.text.length > 120 ? "…" : ""}"`,
    fixHint:
      "Remove one copy or make the two surfaces advance different facts. Keep one clear " +
      "owner for this statement; do not merely hide it behind another visible surface.",
    source: "sequences",
  }));
}

/** Below this content-coverage fraction a sampled frame reads as blank. */
const NEAR_BLANK_COVERAGE = 0.005;
/** Scenes shorter than this are micro-beats (flashes, stings) — never judged. */
const NEAR_BLANK_MIN_SCENE_SEC = 1.2;
/** A single fully blank scene at least this long blocks publication alone. */
const NEAR_BLANK_SCENE_HARD_SEC = 4;
/** Blank scenes totalling this fraction of the film block publication. */
const NEAR_BLANK_FILM_FRACTION = 0.3;

function asLayoutRect(value: unknown): LayoutRect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const rect = {
    left: Number(raw.left),
    top: Number(raw.top),
    right: Number(raw.right),
    bottom: Number(raw.bottom),
    width: Number(raw.width),
    height: Number(raw.height),
  };
  return Object.values(rect).every(Number.isFinite) ? rect : undefined;
}

function asLayoutOverflow(value: unknown): LayoutOverflow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const overflow: LayoutOverflow = {};
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const parsed = Number(raw[side]);
    if (Number.isFinite(parsed)) overflow[side] = parsed;
  }
  return Object.keys(overflow).length ? overflow : undefined;
}

function unionLayoutRect(a: LayoutRect | undefined, b: LayoutRect | undefined): LayoutRect | undefined {
  if (!a) return b;
  if (!b) return a;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function maxLayoutOverflow(
  a: LayoutOverflow | undefined,
  b: LayoutOverflow | undefined,
): LayoutOverflow | undefined {
  if (!a) return b;
  if (!b) return a;
  const overflow: LayoutOverflow = {};
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const value = Math.max(a[side] ?? 0, b[side] ?? 0);
    if (value > 0) overflow[side] = value;
  }
  return Object.keys(overflow).length ? overflow : undefined;
}

function normalizeHyperframesIssue(value: Record<string, unknown>): DirectLayoutIssue {
  const code = String(value.code ?? "layout_issue");
  // Keys quoted deliberately: these are HyperFrames finding codes, and the
  // Sentinel closed-world scanner only sees quoted code literals.
  const scaffoldHints: Record<string, string> = {
    "content_overlap":
      "Give each load-bearing group its own .zone inside a named flow layout; reserve overlap for an annotated decorative layer.",
    "important_safe_area":
      "Keep the group in the .scene flow container so its safe padding applies; use a .zone and widen the grid track before wrapping.",
    "container_overflow":
      "Move the content into a min-width:0 .zone and let the named grid/flex layout size the container.",
    "clipped_text":
      "Reflow the text in a .stack/.zone, remove fixed box height, then reduce type only if the flow layout still cannot fit.",
    "text_box_overflow":
      "Reflow the text in a .stack/.zone, remove fixed box height, then reduce type only if the flow layout still cannot fit.",
  };
  return {
    code,
    // Preserve HyperFrames' own severity boundary. In particular, animated
    // container excursions and text overlap are warnings because composition
    // can deliberately layer/enter; hard text clipping and occlusion are errors.
    severity: (value.severity as LayoutSeverity) ?? "warning",
    time: Number(value.time) || 0,
    selector: String(value.selector ?? "composition"),
    ...(value.containerSelector ? { containerSelector: String(value.containerSelector) } : {}),
    ...(value.text ? { text: String(value.text) } : {}),
    ...(asLayoutRect(value.rect) ? { rect: asLayoutRect(value.rect) } : {}),
    ...(asLayoutRect(value.containerRect) ? { containerRect: asLayoutRect(value.containerRect) } : {}),
    ...(asLayoutOverflow(value.overflow) ? { overflow: asLayoutOverflow(value.overflow) } : {}),
    message: String(value.message ?? code),
    ...(scaffoldHints[code]
      ? { fixHint: scaffoldHints[code] }
      : value.fixHint ? { fixHint: String(value.fixHint) } : {}),
    source: "hyperframes",
  };
}

async function enrichRepairEvidence(
  page: import("puppeteer-core").Page,
  issues: DirectLayoutIssue[],
): Promise<DirectLayoutIssue[]> {
  if (!issues.length) return issues;
  return page.evaluate((rawIssues: DirectLayoutIssue[]) => {
    const root = document.querySelector<HTMLElement>("[data-composition-id][data-width][data-height]");
    if (!root) return rawIssues;
    const escapeCss = (value: string): string =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const escapeAttr = (value: string): string =>
      value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const count = (selector: string): number => {
      try {
        return root.querySelectorAll(selector).length;
      } catch {
        return 0;
      }
    };
    const scenePrefix = (scene: HTMLElement): string | undefined => {
      const sceneId = scene.getAttribute("data-scene");
      if (sceneId) return `[data-scene="${escapeAttr(sceneId)}"]`;
      return scene.id ? `#${escapeCss(scene.id)}` : undefined;
    };
    const nthSegment = (element: Element): string => {
      const tag = element.tagName.toLowerCase();
      const parent = element.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
      return `${tag}:nth-of-type(${siblings.indexOf(element) + 1})`;
    };
    const structuralSelector = (element: Element, scene: HTMLElement | null): string | undefined => {
      const stop = scene ?? root;
      const prefix = scene ? scenePrefix(scene) : "[data-composition-id]";
      if (!prefix) return undefined;
      const parts: string[] = [];
      for (let current: Element | null = element; current && current !== stop; current = current.parentElement) {
        parts.unshift(nthSegment(current));
      }
      if (!parts.length) return prefix;
      const selector = `${prefix} > ${parts.join(" > ")}`;
      return count(selector) === 1 ? selector : undefined;
    };
    const repairSelectorFor = (element: Element, scene: HTMLElement | null): string | undefined => {
      if (element.id) {
        const selector = `#${escapeCss(element.id)}`;
        if (count(selector) === 1) return selector;
      }
      const ownPart = element.getAttribute("data-part");
      if (ownPart && scene) {
        const prefix = scenePrefix(scene);
        const selector = prefix
          ? `${prefix} [data-part="${escapeAttr(ownPart)}"]`
          : `[data-part="${escapeAttr(ownPart)}"]`;
        if (count(selector) === 1) return selector;
      }
      return structuralSelector(element, scene);
    };
    const resolveElement = (issue: DirectLayoutIssue): Element | null => {
      const selector = issue.selector;
      if (!selector || selector === "composition") return null;
      try {
        const candidates = Array.from(root.querySelectorAll(selector));
        if (candidates.length === 1) return candidates[0]!;
        const measured = issue.rect;
        if (measured) {
          const ranked = candidates.map((candidate) => {
            const rect = candidate.getBoundingClientRect();
            return {
              candidate,
              delta: Math.abs(rect.left - measured.left) +
                Math.abs(rect.top - measured.top) +
                Math.abs(rect.width - measured.width) +
                Math.abs(rect.height - measured.height),
            };
          }).sort((a, b) => a.delta - b.delta);
          // Layout evidence already carries the sampled box. Use it to resolve
          // repeated letters/rows whose compact selector and text are both
          // ambiguous; a visibly separated runner-up keeps this conservative.
          if (
            ranked[0] && ranked[0].delta <= 2 &&
            (!ranked[1] || ranked[1].delta - ranked[0].delta >= 1)
          ) {
            return ranked[0].candidate;
          }
        }
        // HyperFrames intentionally emits compact evidence labels such as
        // `span`/`span.cmp-label`. When several nodes share that selector, bind
        // the finding to the exact direct-text node the contrast audit sampled.
        // Ambiguous duplicate copy stays unrepaired rather than recoloring an
        // arbitrary sibling.
        const text = issue.text?.trim();
        if (!text) return null;
        const matches = candidates.filter((candidate) =>
          (candidate.textContent ?? "").trim().slice(0, 50) === text
        );
        if (matches.length === 1) return matches[0]!;
        const visibleMatches = matches.filter((candidate) => {
          const rect = candidate.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return false;
          let opacity = 1;
          for (let node: Element | null = candidate; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") return false;
            opacity *= Number.parseFloat(style.opacity) || 0;
          }
          return opacity > 0.01;
        });
        return visibleMatches.length === 1 ? visibleMatches[0]! : null;
      } catch {
        return null;
      }
    };
    return rawIssues.map((issue) => {
      const element = resolveElement(issue);
      if (!element) return issue;
      const scene = element.closest<HTMLElement>("[data-scene]");
      const partElement = element.closest<HTMLElement>("[data-part]");
      const componentRoot = element.closest<HTMLElement>("[data-component][data-part]");
      const repairSelector = repairSelectorFor(element, scene);
      return {
        ...issue,
        ...(repairSelector ? { repairSelector } : {}),
        ...(scene ? { sceneId: scene.getAttribute("data-scene") || scene.id || undefined } : {}),
        ...(partElement ? { part: partElement.getAttribute("data-part") || undefined } : {}),
        ...(componentRoot
          ? { componentRootPart: componentRoot.getAttribute("data-part") || undefined }
          : {}),
        insideCameraWorld: Boolean(element.closest("[data-camera-world]")),
        isCameraWorld: element.hasAttribute("data-camera-world"),
      };
    });
  }, issues);
}

function collapseIssues(values: DirectLayoutIssue[]): DirectLayoutIssue[] {
  const groups = new Map<string, DirectLayoutIssue>();
  for (const value of values) {
    const key = [
      value.source,
      value.code,
      value.severity,
      value.interactionId ?? "",
      value.sceneId ?? "",
      value.selector,
      value.repairSelector ?? "",
      value.containerSelector ?? "",
      value.text ?? "",
    ].join("|");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...value,
        firstSeen: value.time,
        lastSeen: value.time,
        occurrences: 1,
      });
      continue;
    }
    existing.firstSeen = Math.min(existing.firstSeen ?? value.time, value.time);
    existing.lastSeen = Math.max(existing.lastSeen ?? value.time, value.time);
    existing.occurrences = (existing.occurrences ?? 1) + 1;
    existing.rect = unionLayoutRect(existing.rect, value.rect);
    existing.containerRect = unionLayoutRect(existing.containerRect, value.containerRect);
    existing.safeRect = unionLayoutRect(existing.safeRect, value.safeRect);
    existing.peerRect = unionLayoutRect(existing.peerRect, value.peerRect);
    existing.overflow = maxLayoutOverflow(existing.overflow, value.overflow);
  }
  return [...groups.values()].sort((a, b) => {
    const rank = (severity: LayoutSeverity) => severity === "error" ? 0 : severity === "warning" ? 1 : 2;
    return rank(a.severity) - rank(b.severity) || a.time - b.time;
  });
}

function formatIssue(value: DirectLayoutIssue): string {
  const when = (value.occurrences ?? 0) > 1
    ? `t=${value.firstSeen?.toFixed(2)}–${value.lastSeen?.toFixed(2)}s`
    : `t=${value.time.toFixed(2)}s`;
  return `${value.code}${value.declaredPrimary ? " [declared primary subject]" : ""} ${
    value.selector
  } (${when}): ${value.message}${value.fixHint ? ` Fix: ${value.fixHint}` : ""}`;
}

/* ----------------------------------------------- rendered temporal judge */

const TEMPORAL_JUDGE_MAX_MOMENTS = 12;
/** Frames are captured at this device scale (1920x1080 → 384x216). */
const TEMPORAL_JUDGE_SCALE = 0.2;
/** Channel deltas at or below this are decoder/AA noise, not change. */
const TEMPORAL_JUDGE_PIXEL_TOLERANCE = 6;
/**
 * A claimed change is `static` when fewer than this fraction of downscaled
 * pixels moved (~100 px at 384x216). Calibrated conservative: a modest
 * type-on beat moves ~2-3x this many pixels, a camera move lights up the
 * whole frame, while byte-identical rendering measures ~0 — so false
 * positives require a change that is genuinely near-invisible on screen.
 */
const TEMPORAL_JUDGE_STATIC_RATIO = 0.0012;
const TEMPORAL_JUDGE_STATIC_MEAN_DELTA = 0.35;

function temporalJudgeEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_TEMPORAL_JUDGE") !== "0";
}

interface TransitionDomState {
  missing: boolean;
  opacity: number;
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
  clipPath: string;
}

/** Pure comparison kept exported so the liveness tolerance has cheap coverage. */
export function transitionOutgoingStateMoved(
  before: TransitionDomState,
  after: TransitionDomState,
): boolean {
  if (before.missing !== after.missing) return true;
  if (before.missing && after.missing) return false;
  return Math.abs(before.opacity - after.opacity) >= 0.025 ||
    Math.abs(before.left - after.left) >= 1 ||
    Math.abs(before.top - after.top) >= 1 ||
    Math.abs(before.width - after.width) >= 1 ||
    Math.abs(before.height - after.height) >= 1 ||
    before.transform !== after.transform ||
    before.clipPath !== after.clipPath;
}

/**
 * Declaring a transition promises motion on both sides of the boundary. The
 * temporal report already measures this after render; repeat the cheap DOM
 * half in browser QA so an invisible outgoing leg consumes bounded repair
 * budget before publication. Hard cuts have no outgoing motion promise.
 */
async function judgeDeclaredTransitionOutgoing(
  page: import("puppeteer-core").Page,
  draft: DirectCompositionDraft,
  seekContent: (time: number) => Promise<void>,
): Promise<TransitionOutgoingEvidence[]> {
  if (!temporalJudgeEnabled()) return [];
  const declared = new Set(
    draft.storyboard.flatMap((scene, index) => {
      const next = draft.storyboard[index + 1];
      return scene.cut && next ? [`${scene.id}\u0000${next.id}`] : [];
    }),
  );
  const cuts = (parseCutPlan(draft.html).plan?.cuts ?? []).filter((cut) =>
    cut.style !== "hard" && declared.has(`${cut.fromScene}\u0000${cut.toScene}`) &&
    cut.exitSec >= 0.12
  );
  const escapeAttribute = (value: string): string =>
    value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const readState = async (selector: string, fallbackSelector: string): Promise<TransitionDomState> =>
    page.evaluate((payload: { selector: string; fallbackSelector: string }) => {
      const element = document.querySelector<HTMLElement>(payload.selector) ??
        document.querySelector<HTMLElement>(payload.fallbackSelector);
      if (!element) {
        return {
          missing: true,
          opacity: 0,
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: "none",
          clipPath: "none",
        };
      }
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          opacity = 0;
          break;
        }
        const own = Number.parseFloat(style.opacity);
        opacity *= Number.isFinite(own) ? own : 1;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        missing: false,
        opacity,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        transform: style.transform,
        clipPath: style.clipPath,
      };
    }, { selector, fallbackSelector });
  const evidence: TransitionOutgoingEvidence[] = [];
  for (const cut of cuts) {
    const from = escapeAttribute(cut.fromScene);
    const to = escapeAttribute(cut.toScene);
    const selector = cut.style === "match" || cut.style === "morph"
      ? `[data-sequences-runtime-cut="bridge"][data-sequences-cut-from="${from}"]` +
        `[data-sequences-cut-to="${to}"]`
      : cut.style === "flash-white"
        ? `[data-sequences-runtime-cut="flash"][data-sequences-cut-from="${from}"]` +
          `[data-sequences-cut-to="${to}"]`
        : `[data-scene="${from}"]`;
    const fallbackSelector = `[data-scene="${from}"]`;
    const beforeSec = roundTime(Math.max(0, cut.atSec - cut.exitSec + 0.02));
    const afterSec = roundTime(Math.max(beforeSec, cut.atSec - 0.02));
    await seekContent(beforeSec);
    const before = await readState(selector, fallbackSelector);
    await seekContent(afterSec);
    const after = await readState(selector, fallbackSelector);
    evidence.push({
      fromScene: cut.fromScene,
      toScene: cut.toScene,
      style: cut.style,
      atSec: cut.atSec,
      beforeSec,
      afterSec,
      selector,
      verdict: transitionOutgoingStateMoved(before, after) ? "changed" : "static",
    });
  }
  return evidence;
}

/**
 * The rendered temporal judge: for each evidence-bound storyboard moment,
 * render one frame just before its evidence starts and one just after it
 * settles (the thumbnail strip's capture policy), then measure the pixel
 * difference in-page. Static source validation can prove a tween exists;
 * only rendered pixels can prove the promised change is *visible*. Findings
 * are polish-grade (they trigger bounded repair through strictOk) and never
 * unpublish a runnable draft. Cost: ≤2 tiny screenshots per moment, run last
 * on the already-open QA browser, cached with the rest of the QA result.
 */
async function judgeRenderedMoments(
  page: import("puppeteer-core").Page,
  draft: DirectCompositionDraft,
  duration: number,
  seekContent: (time: number) => Promise<void>,
  viewport: { width: number; height: number },
): Promise<TemporalJudgeMomentEvidence[]> {
  if (!temporalJudgeEnabled()) return [];
  if (!Number.isFinite(duration) || duration < 10) return [];
  const bound = resolveMomentContract(draft.html, draft.storyboard, duration)
    .moments.filter((moment) => moment.evidence);
  if (bound.length < 2) return [];
  const selected = (bound.length <= TEMPORAL_JUDGE_MAX_MOMENTS
    ? bound
    : [
        ...bound.filter((moment) => moment.importance === "primary"),
        ...bound.filter((moment) => moment.importance !== "primary"),
      ].slice(0, TEMPORAL_JUDGE_MAX_MOMENTS)
  ).slice().sort((a, b) => a.atSec - b.atSec);
  const sceneById = new Map(draft.storyboard.map((scene) => [scene.id, scene]));
  const judgeCuts = parseCutPlan(draft.html).plan?.cuts ?? [];
  const cutExitByScene = new Map(
    judgeCuts.map((cut) => [cut.fromScene, cut.exitSec ?? 0]),
  );
  // A cover swipe's panel is still on frame through the incoming scene's
  // entry window — a before-frame sampled under the panel would compare a
  // solid wipe against content and judge any change "visible" dishonestly.
  const entryCoverByScene = new Map(
    judgeCuts
      .filter((cut) => cut.style === "swipe" && (cut as { cover?: boolean }).cover)
      .map((cut) => [cut.toScene, cut.entrySec ?? 0]),
  );
  const pairs = selected.flatMap((moment) => {
    const scene = sceneById.get(moment.sceneId);
    const evidence = moment.evidence!;
    const sceneStart = scene ? scene.startSec : 0;
    const sceneEnd = scene ? scene.startSec + scene.durationSec : duration;
    // Mirror the thumbnail capture policy: the after-frame is the SETTLED
    // state, clamped ahead of the outgoing cut's exit window so a
    // mid-transition frame can never poison the comparison.
    const latest = Math.max(
      sceneStart,
      sceneEnd - 0.05 - (cutExitByScene.get(moment.sceneId) ?? 0),
    );
    const earliest = Math.min(
      latest,
      sceneStart + (entryCoverByScene.get(moment.sceneId) ?? 0),
    );
    const beforeSec = roundTime(
      Math.max(earliest, Math.min(evidence.startSec - 0.12, latest)),
    );
    const afterSec = roundTime(
      Math.min(Math.max(evidence.endSec + 0.08, beforeSec + 0.15), latest),
    );
    // Pulse-shaped evidence (highlight rings, press scales, ripples) returns
    // to its rest state by the settle frame, so before/after alone reads a
    // real pulse as static. A mid-evidence frame catches the peak.
    const midSec = roundTime(
      Math.min(
        Math.max((evidence.startSec + evidence.endSec) / 2, beforeSec + 0.05),
        latest,
      ),
    );
    if (afterSec - beforeSec < 0.12) return [];
    return [{ moment, beforeSec, midSec, afterSec }];
  });
  if (!pairs.length) return [];
  // Tiny frames: drop only the device scale — CSS layout is untouched. Runs
  // after every full-resolution capture (samples, boundaries, guide).
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: TEMPORAL_JUDGE_SCALE,
  });
  const frames = new Map<number, string>();
  const captureFrame = async (time: number): Promise<string> => {
    const cached = frames.get(time);
    if (cached) return cached;
    await seekContent(time);
    const png = (await page.screenshot({ type: "png", encoding: "base64" })) as string;
    frames.set(time, png);
    return png;
  };
  const evidence: TemporalJudgeMomentEvidence[] = [];
  const diffFrames = (aB64: string, bB64: string) =>
    page.evaluate(
      async (aB64: string, bB64: string, tolerance: number) => {
        const load = async (base64: string): Promise<ImageBitmap> => {
          const binary = atob(base64);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          return createImageBitmap(new Blob([bytes], { type: "image/png" }));
        };
        const [imageA, imageB] = await Promise.all([load(aB64), load(bB64)]);
        const width = Math.min(imageA.width, imageB.width);
        const height = Math.min(imageA.height, imageB.height);
        const read = (image: ImageBitmap): Uint8ClampedArray => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true })!;
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, width, height).data;
        };
        const dataA = read(imageA);
        const dataB = read(imageB);
        imageA.close();
        imageB.close();
        let changed = 0;
        let total = 0;
        let sum = 0;
        for (let index = 0; index < dataA.length; index += 4) {
          const delta = Math.max(
            Math.abs(dataA[index]! - dataB[index]!),
            Math.abs(dataA[index + 1]! - dataB[index + 1]!),
            Math.abs(dataA[index + 2]! - dataB[index + 2]!),
          );
          sum += delta;
          total += 1;
          if (delta > tolerance) changed += 1;
        }
        return {
          changedRatio: total ? changed / total : 0,
          meanDelta: total ? sum / total : 0,
        };
      },
      aB64,
      bB64,
      TEMPORAL_JUDGE_PIXEL_TOLERANCE,
    );
  for (const pair of pairs) {
    const before = await captureFrame(pair.beforeSec);
    const mid = await captureFrame(pair.midSec);
    const after = await captureFrame(pair.afterSec);
    const settled = await diffFrames(before, after);
    const peak = pair.midSec !== pair.afterSec && pair.midSec !== pair.beforeSec
      ? await diffFrames(before, mid)
      : settled;
    const diff = peak.changedRatio > settled.changedRatio ? peak : settled;
    evidence.push({
      momentId: pair.moment.id,
      title: pair.moment.title,
      importance: pair.moment.importance,
      atSec: pair.moment.atSec,
      beforeSec: pair.beforeSec,
      midSec: pair.midSec,
      afterSec: pair.afterSec,
      changedRatio: Math.round(diff.changedRatio * 1e6) / 1e6,
      meanDelta: Math.round(diff.meanDelta * 1000) / 1000,
      verdict:
        diff.changedRatio < TEMPORAL_JUDGE_STATIC_RATIO &&
        diff.meanDelta < TEMPORAL_JUDGE_STATIC_MEAN_DELTA
          ? "static"
          : "changed",
    });
  }
  return evidence;
}

async function measureComponentSettleBlooms(
  page: import("puppeteer-core").Page,
  draft: DirectCompositionDraft,
  seekContent: (time: number) => Promise<void>,
): Promise<ComponentSettleBloomEvidenceV1[]> {
  const plan = parseComponentPlan(draft.html).plan;
  if (!plan) return [];
  const candidates = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-sequences-settle-bloom]"))
      .map((element) => ({
        beatId: element.getAttribute("data-sequences-settle-bloom") ?? "",
        sceneId: element.closest<HTMLElement>("[data-scene]")?.dataset.scene ?? "",
      }))
      .filter((entry) => entry.beatId && entry.sceneId)
  );
  const evidence: ComponentSettleBloomEvidenceV1[] = [];
  for (const candidate of candidates.slice(0, 12)) {
    const scenePlan = plan.scenes.find((scene) => scene.sceneId === candidate.sceneId);
    const beat = scenePlan?.beats.find((entry) => entry.id === candidate.beatId);
    const scene = draft.storyboard.find((entry) => entry.id === candidate.sceneId);
    if (!beat || !scene) continue;
    const duration = Math.min(1, scene.startSec + scene.durationSec - beat.endSec - 0.02);
    if (duration < 0.18) continue;
    const startSec = beat.endSec + Math.min(0.03, duration * 0.1);
    const endSec = beat.endSec + duration - 0.01;
    const opacityAt = async (time: number): Promise<number> => {
      await seekContent(time);
      return page.evaluate(({ beatId, sceneId }) => {
        const scene = document.querySelector<HTMLElement>(
          `[data-scene="${CSS.escape(sceneId)}"]`,
        );
        const bloom = scene?.querySelector<HTMLElement>(
          `[data-sequences-settle-bloom="${CSS.escape(beatId)}"]`,
        );
        return Number.parseFloat(bloom ? getComputedStyle(bloom).opacity : "0") || 0;
      }, candidate);
    };
    evidence.push({
      sceneId: candidate.sceneId,
      beatId: candidate.beatId,
      startSec,
      endSec,
      startOpacity: await opacityAt(startSec),
      endOpacity: await opacityAt(endSec),
    });
  }
  return evidence;
}

export async function inspectDirectComposition(
  projectDir: string,
  draft: DirectCompositionDraft,
  // captureGuide is retained for call-site compatibility but no longer skips
  // the guide: every pass with interactions captures it (one extra screenshot)
  // so a cached result is a superset any later caller can reuse verbatim.
  options: {
    captureGuide?: boolean;
    captureVisualReview?: boolean;
    /** Persist captured sheets to canonical temporal aliases (default true). */
    publishVisualReview?: boolean;
  } = {},
): Promise<DirectBrowserQaResult> {
  const cacheKey = qaCacheEnabled() ? qaCacheKey(projectDir, draft) : undefined;
  if (cacheKey) {
    const cached = readQaCache(projectDir, cacheKey);
    // A vision request always renders fresh, hash-addressed evidence. Native
    // image bytes and local artifact existence are intentionally not cached.
    if (cached && !options.captureVisualReview) {
      process.stderr.write(
        `[layout-qa] reusing cached browser QA evidence (${cacheKey.slice(0, 8)})\n`,
      );
      return cached;
    }
  }
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    const message = "browser validate/layout inspect could not run because Chromium/Chrome/Edge was not found";
    return {
      ok: false,
      strictOk: false,
      infraError: message,
      samples: [],
      issues: [],
      interactions: [],
      errors: [message],
      warnings: [],
    };
  }

  const scratch = prepareScratch(projectDir, draft);
  const runtime: RuntimeMessage[] = [];
  let timelineContractEvidence: TimelineContractEvidence | undefined;
  let server: Awaited<ReturnType<typeof serveDir>> | undefined;
  let browser: import("puppeteer-core").Browser | undefined;
  let documentLoaded = false;
  try {
    server = await serveDir(scratch);
    const puppeteer = (await import("puppeteer-core")).default;
    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: [
        "--hide-scrollbars",
        "--mute-audio",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    const rootTag = draft.html.match(
      /<[^>]+\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/is,
    )?.[0] ?? "";
    const readDimension = (name: "data-width" | "data-height", fallback: number): number => {
      const match = rootTag.match(new RegExp(`\\b${name}\\s*=\\s*([\"'])(\\d+)\\1`, "i"));
      return Number(match?.[2]) || fallback;
    };
    const compositionId = rootTag.match(
      /\bdata-composition-id\s*=\s*(["'])(.*?)\1/i,
    )?.[2] ?? "";
    const lunaDeclaredIntentPresent = Boolean(
      draft.declaredPrimarySelectors && Object.keys(draft.declaredPrimarySelectors).length,
    );
    const width = readDimension("data-width", 1920);
    const height = readDimension("data-height", 1080);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
        runtime.push({ level: "error", text: message.text() });
      } else if (message.type() === "warn") {
        runtime.push({ level: "warning", text: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      runtime.push({ level: "error", text: error instanceof Error ? error.message : String(error) });
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith("data:") || request.url().includes("favicon")) return;
      if (
        request.resourceType() === "media" &&
        request.failure()?.errorText === "net::ERR_ABORTED"
      ) return;
      runtime.push({
        level: "error",
        text: `failed to load ${decodeURIComponent(new URL(request.url()).pathname)}: ${
          request.failure()?.errorText ?? "net::ERR_FAILED"
        }`,
      });
    });
    await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
    documentLoaded = true;
    // tsx/esbuild annotates nested functions in page.evaluate with __name.
    // Browser contexts do not have that build helper, so provide its inert form.
    await page.addScriptTag({ content: "globalThis.__name ||= (target) => target;" });
    await page.waitForFunction(
      () => Object.keys(
        (window as unknown as { __timelines?: Record<string, unknown> }).__timelines ?? {},
      ).length > 0,
      { timeout: 12_000 },
    );
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);

    if (lunaDeclaredIntentPresent) {
      const firstScene = draft.storyboard[0];
      const timelineContract = await page.evaluate(async (payload: {
        expectedId: string;
        probeTimes: number[];
      }) => {
        const expectedId = payload.expectedId;
        type TimelineLike = {
          paused?: () => boolean;
          pause?: () => unknown;
          seek?: (time: number, suppressEvents?: boolean) => unknown;
        };
        type SnapshotNode = {
          path: string;
          selector: string;
          tag: string;
          attrs: Record<string, string>;
          text: string | null;
          style: Record<string, string>;
          rect: Record<"x" | "y" | "width" | "height", number>;
        };
        type Difference = TimelineContractDifference;
        const win = window as unknown as {
          __timelines?: Record<string, TimelineLike>;
          __seek?: (time: number) => unknown;
        };
        const timeline = win.__timelines?.[expectedId];
        if (!timeline) {
          return { error: `timeline_contract: window.__timelines["${expectedId}"] is absent` };
        }
        if (typeof timeline.seek !== "function") {
          return { error: `timeline_contract: window.__timelines["${expectedId}"] is not seekable` };
        }
        if (typeof timeline.paused !== "function" || timeline.paused() !== true) {
          return { error: `timeline_contract: window.__timelines["${expectedId}"] is not paused` };
        }
        if (typeof win.__seek !== "function") {
          return { error: "timeline_contract: window.__seek(t) is absent" };
        }
        const duration = Number(
          document.querySelector<HTMLElement>(
            `[data-composition-id="${CSS.escape(expectedId)}"]`,
          )?.dataset.duration ?? 0,
        );
        if (!Number.isFinite(duration) || duration <= 0) {
          return { error: "timeline_contract: the declared composition duration is invalid in-browser" };
        }
        const settle = () => new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        const domPath = (element: Element): string => {
          const parts: string[] = [];
          let current: Element | null = element;
          while (current && current !== document.body) {
            const tag = current.tagName.toLowerCase();
            const siblings = current.parentElement
              ? Array.from(current.parentElement.children).filter((candidate) => candidate.tagName === current!.tagName)
              : [];
            const position = siblings.indexOf(current) + 1;
            parts.unshift(`${tag}:nth-of-type(${Math.max(1, position)})`);
            current = current.parentElement;
          }
          return `body>${parts.join(">")}`;
        };
        const diagnosticSelector = (element: Element, fallback: string): string => {
          const id = element.getAttribute("id") ?? "";
          if (id && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
            return `#${CSS.escape(id)}`;
          }
          const sceneId = element.getAttribute("data-scene") ?? "";
          if (sceneId) return `[data-scene=${JSON.stringify(sceneId)}]`;
          return fallback;
        };
        const snapshot = (): SnapshotNode[] =>
          Array.from(document.querySelectorAll<HTMLElement | SVGElement>("body *")).map((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const path = domPath(element);
            return {
              path,
              selector: diagnosticSelector(element, path),
              tag: element.tagName.toLowerCase(),
              attrs: Object.fromEntries(Array.from(element.attributes)
                .filter((attribute) => attribute.name !== "style" && attribute.name !== "data-svg-origin")
                .map((attribute) => [attribute.name, attribute.value] as const)
                .sort((left, right) => left[0].localeCompare(right[0]))),
              text: element.childElementCount === 0 ? element.textContent : null,
              style: {
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                transform: style.transform,
                color: style.color,
                backgroundColor: style.backgroundColor,
                clipPath: style.clipPath,
              },
              rect: Object.fromEntries(["x", "y", "width", "height"].map((name) => [
                name,
                Math.round(rect[name as "x" | "y" | "width" | "height"] * 1_000) / 1_000,
              ])) as SnapshotNode["rect"],
            };
          });
        const compare = (before: SnapshotNode[], after: SnapshotNode[]) => {
          const differences: Difference[] = [];
          let changeCount = 0;
          // Rotated-element matrices vary by ~1e-6 across equivalent seek paths
          // (browser/GSAP float noise). Compare transforms component-wise within
          // a sub-pixel epsilon instead of by string, so genuine non-determinism
          // still fails while float noise does not; rendered position is
          // separately guarded by the 0.1px rect tolerance below. Unit-tested
          // twin: timelineTransformsEquivalent in this module — keep in sync.
          const TRANSFORM_EPSILON = 1e-3;
          const matrixVector = (value: string): number[] | null => {
            if (value === "none") return [1, 0, 0, 1, 0, 0];
            const match = /^matrix(3d)?\(([^)]+)\)$/.exec(value);
            if (!match) return null;
            const values = match[2]!.split(",").map((entry) => Number(entry.trim()));
            return values.every((entry) => Number.isFinite(entry)) ? values : null;
          };
          const nearIdentity = (candidate: number[]): boolean => {
            const identity = candidate.length === 16
              ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
              : [1, 0, 0, 1, 0, 0];
            return candidate.length === identity.length &&
              candidate.every((entry, index) => Math.abs(entry - identity[index]!) <= TRANSFORM_EPSILON);
          };
          const transformEquivalent = (before: string, after: string): boolean => {
            const left = matrixVector(before);
            const right = matrixVector(after);
            if (!left || !right) return before === after;
            if (left.length !== right.length) return nearIdentity(left) && nearIdentity(right);
            return left.every((entry, index) => Math.abs(entry - right[index]!) <= TRANSFORM_EPSILON);
          };
          const bounded = (value: string | number | null | undefined): string | number | null =>
            value == null
              ? null
              : typeof value === "number"
                ? value
                : value.replace(/\s+/g, " ").slice(0, 160);
          const add = (
            selector: string,
            property: string,
            beforeValue: string | number | null | undefined,
            afterValue: string | number | null | undefined,
          ) => {
            changeCount += 1;
            if (differences.length < 8) {
              differences.push({
                selector: selector.slice(0, 240),
                property: property.slice(0, 80),
                before: bounded(beforeValue),
                after: bounded(afterValue),
              });
            }
          };
          const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
          const afterByPath = new Map(after.map((entry) => [entry.path, entry]));
          for (const path of new Set([...beforeByPath.keys(), ...afterByPath.keys()])) {
            const left = beforeByPath.get(path);
            const right = afterByPath.get(path);
            const selector = left?.selector ?? right?.selector ?? path;
            if (!left || !right) {
              add(selector, "node", left?.tag, right?.tag);
              continue;
            }
            for (const name of new Set([...Object.keys(left.attrs), ...Object.keys(right.attrs)])) {
              if (left.attrs[name] !== right.attrs[name]) {
                add(selector, `attribute.${name}`, left.attrs[name], right.attrs[name]);
              }
            }
            if (left.text !== right.text) add(selector, "text", left.text, right.text);
            for (const name of Object.keys(left.style)) {
              const leftValue = left.style[name] ?? "";
              const rightValue = right.style[name] ?? "";
              const differs = name === "transform"
                ? !transformEquivalent(leftValue, rightValue)
                : leftValue !== rightValue;
              if (differs) {
                add(selector, `style.${name}`, left.style[name], right.style[name]);
              }
            }
            for (const name of Object.keys(left.rect) as Array<keyof SnapshotNode["rect"]>) {
              if (Math.abs(left.rect[name] - right.rect[name]) > 0.1) {
                add(selector, `rect.${name}`, left.rect[name], right.rect[name]);
              }
            }
          }
          return { changeCount, differences };
        };
        const seek = async (time: number) => {
          timeline.pause?.();
          timeline.seek!(time, false);
          await settle();
        };
        try {
          const probeTimes = [...new Set(payload.probeTimes
            .filter((time) => Number.isFinite(time) && time >= 0.2 && time <= duration - 0.2)
            .map((time) => Math.round(time * 1_000) / 1_000))]
            .sort((left, right) => left - right);
          for (let index = 0; index < probeTimes.length; index += 1) {
            const first = probeTimes[index]!;
            const requestedSecond = probeTimes[index + 1] ?? duration * 0.73;
            const second = Math.min(duration - 0.1, Math.max(first + 0.2, requestedSecond));
            // Production render workers and evidence capture can reset to frame zero
            // between arbitrary frames. Include that real path: the Relay incident
            // restored 1.89s after a direct late seek, but lost its opening scene
            // after the equally valid late -> zero -> 1.89s sequence.
            const seekSequence = [first, second, 0, first]
              .map((time) => Math.round(time * 1_000) / 1_000);
            await seek(first);
            const before = snapshot();
            await seek(second);
            await seek(0);
            await seek(first);
            const after = snapshot();
            const comparison = compare(before, after);
            if (comparison.changeCount > 0) {
              const evidence: TimelineContractEvidence = {
                compositionId: expectedId,
                seekSequence,
                ...comparison,
              };
              return {
                error:
                  `timeline_contract: canonical seek(${first.toFixed(3)}) does not restore deterministic state; ` +
                  `evidence=${JSON.stringify(evidence)}`,
                evidence,
              };
            }
          }
          if (timeline.paused() !== true) {
            return { error: "timeline_contract: canonical seek(t) resumed the declared timeline" };
          }
        } catch (error) {
          return {
            error: `timeline_contract: canonical seek(t) threw: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
        return { error: "" };
      }, {
        expectedId: compositionId,
        probeTimes: [
          firstScene
            ? firstScene.startSec + firstScene.durationSec * 0.45
            : 0.2,
          Number(
            rootTag.match(/\bdata-duration\s*=\s*(["'])(.*?)\1/i)?.[2] ?? 0,
          ) * 0.37,
        ],
      });
      timelineContractEvidence = timelineContract.evidence;
      if (timelineContract.error) throw new Error(timelineContract.error);
    }

    const duration = await page.evaluate(() => {
      const element = document.querySelector("[data-composition-id][data-duration]");
      return Number.parseFloat(element?.getAttribute("data-duration") ?? "0");
    });
    // The cut runtime may degrade a boundary at bind time (shape-match's
    // geometry audit compiles zoom-through instead of a broken bridge). That
    // is a designed, deterministic decision — keep the raw warning string for
    // operators and downstream passes (cut discovery, paperwork reconciler),
    // and additionally raise a measured polish finding further below once the
    // boundary geometry inventory exists.
    const degradedCutBindings = await page.evaluate(() => {
      const bindings = (window as unknown as {
        __sequencesCutBindings?: Array<{
          cut?: {
            style?: string;
            fromScene?: string;
            toScene?: string;
            focalPartOut?: string;
            focalPartIn?: string;
          };
          degraded?: boolean;
          reason?: string;
          target?: string;
        }>;
      }).__sequencesCutBindings ?? [];
      return bindings
        .filter((binding) => binding?.degraded)
        .map((binding) => ({
          style: binding.cut?.style ?? "cut",
          fromScene: binding.cut?.fromScene ?? "?",
          toScene: binding.cut?.toScene ?? "?",
          focalPartOut: binding.cut?.focalPartOut ?? "",
          focalPartIn: binding.cut?.focalPartIn ?? "",
          reason: binding.reason ?? "geometry audit failed",
          target: binding.target ?? "zoom-through",
        }));
    });
    const degradedCutWarnings = degradedCutBindings.map((binding) =>
      `cut_degraded: ${binding.style} ` +
      `${binding.fromScene}->${binding.toScene} ` +
      `compiled as ${binding.target}: ${binding.reason}`
    );
    const tweenBoundaries = await collectTweenBoundaries(page);
    const samples = buildDirectLayoutSampleTimes(draft.storyboard, tweenBoundaries, duration);
    const interactionPlan = parseInteractionPlan(draft.html).plan;
    const interactionIntents = interactionPlan?.interactions ?? [];
    // QA thinks in content (timeline) time everywhere — sample times, issue
    // times, and suppression windows. When the film ramps, the registered
    // timeline is the warped master (output time), so every PHYSICAL seek
    // converts through warpInverse here and nowhere else.
    const conversion = timeConversionService(parseTimeRampPlan(draft.html).plan);
    const toOutputTime = (value: number): number => conversion.toViewer(sourceTime(value));
    const seekContent = (time: number): Promise<void> =>
      seekTo(page, toOutputTime(time), lunaDeclaredIntentPresent ? compositionId : undefined);
    await page.addScriptTag({ content: loadBrowserAudit("layout-audit.browser.js") });

    const rawIssues: DirectLayoutIssue[] = [];
    const interactionEvidence: DirectInteractionEvidence[] = [];
    const loadBearingContainment: LoadBearingContainmentEvidence[] = [];
    const coverageSamples: Array<{ time: number; coverage: number }> = [];
    const compositionMode = compositionFloorMode();
    const compositionCoverageSamples: Array<{ time: number; coverage: number }> = [];
    for (const time of samples) {
      await seekContent(time);
      coverageSamples.push({ time, coverage: await measureContentCoverage(page) });
      if (compositionMode !== "off") {
        compositionCoverageSamples.push({
          time,
          coverage: await measureContentCoverage(page, true),
        });
      }
      const hyperframes = await page.evaluate(
        (options: { time: number; tolerance: number }) => {
          const audit = (window as unknown as {
            __hyperframesLayoutAudit?: (value: { time: number; tolerance: number }) => unknown[];
          }).__hyperframesLayoutAudit;
          return audit?.(options) ?? [];
        },
        { time, tolerance: 2 },
      );
      const interactionAudit = await auditInteractions(page, interactionIntents, time);
      const repeatedCopyIssues = await auditRepeatedVisibleCopy(page, time);
      const hyperframesIssues = (hyperframes as Record<string, unknown>[])
        .map(normalizeHyperframesIssue);
      const sequenceRelationshipIssues = await auditSequencesRelationships(page, time);
      // Resolve generic class/tag selectors to their exact scene-scoped DOM
      // path before deciding whether camera travel owns the excursion.
      const enrichedHyperframes = await enrichRepairEvidence(page, hyperframesIssues);
      // Content parked in a currently-unframed camera-world region is meant to
      // be off screen (clipped by the viewport); it is not a layout defect.
      const offWorldFlags = await page.evaluate((payload: {
        entries: Array<{ selector: string; code: string }>;
        time: number;
      }) => {
        const entries = payload.entries;
        const root = document.querySelector<HTMLElement>(
          "[data-composition-id][data-width][data-height]",
        );
        if (!root) return entries.map(() => false);
        const rootRect = root.getBoundingClientRect();
        return entries.map(({ selector: sel, code }) => {
          let element: Element | null = null;
          try {
            element = sel && sel !== "composition" ? root.querySelector(sel) : null;
          } catch {
            element = null;
          }
          if (!element) return false;
          const scene = element.closest<HTMLElement>("[data-scene]");
          if (scene) {
            const start = Number(scene.dataset.start);
            const duration = Number(scene.dataset.duration);
            if (
              Number.isFinite(start) && Number.isFinite(duration) &&
              (payload.time < start - 0.01 || payload.time > start + duration + 0.01)
            ) return true;
          }
          const world = element.closest<HTMLElement>("[data-camera-world]");
          if (!world) return false;
          const transform = getComputedStyle(world).transform;
          if (!transform || transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)") {
            return false;
          }
          const r = element.getBoundingClientRect();
          const w = Math.max(0, Math.min(r.right, rootRect.right) - Math.max(r.left, rootRect.left));
          const h = Math.max(0, Math.min(r.bottom, rootRect.bottom) - Math.max(r.top, rootRect.top));
          const area = r.width * r.height;
          // Text extending beyond the frame because its camera station is in
          // transit is not text-box overflow. Use the same 85% readable floor
          // as focal QA for text findings; primary/blocking evidence still
          // catches a subject that remains cropped at its actual landing.
          const threshold = code === "text_box_overflow" || code === "clipped_text"
            ? 0.85
            : 0.6;
          return area <= 0 || (w * h) / area < threshold;
        });
      }, {
        entries: enrichedHyperframes.map((issue) => ({
          selector: issue.repairSelector ?? issue.selector,
          code: issue.code,
        })),
        time,
      });
      const enrichedSequence = await enrichRepairEvidence(page, sequenceRelationshipIssues);
      rawIssues.push(
        // A camera world plane extends beyond its scene clip BY DESIGN under
        // any pan/zoom — container_overflow on the world ELEMENT is a false
        // positive dropped at the source so penalty/warnings/repair prompts
        // all agree (fix-probe-5/6). Content INSIDE the world stays judged.
        ...enrichedHyperframes.filter((issue, index) =>
          !offWorldFlags[index] &&
          !(issue.code === "container_overflow" && issue.isCameraWorld)
        ),
        ...enrichedSequence,
        ...repeatedCopyIssues,
        ...await auditFocalParts(page, draft.storyboard, time),
        ...interactionAudit.issues,
      );
      interactionEvidence.push(...interactionAudit.evidence);
    }

    // A focal subject invisible at the single 58% hero sample may simply enter
    // late — the shot resolves around it a beat after the sample instant (the
    // WS7 thumbnail lesson applied to measurement: walk forward before
    // reporting). Re-sample bounded alternates inside the same shot; a subject
    // visible at any of them is late choreography, not an absent focal, and
    // reporting it as invisible burned identical paid patch attempts on the
    // 2026-07-07 probe set. A subject visible at NO sample stays a finding.
    const focalInvisible = rawIssues.filter((issue) => issue.code === "spatial_focal_invisible");
    if (focalInvisible.length) {
      const lateVisible = new Set<DirectLayoutIssue>();
      for (const issue of focalInvisible.slice(0, 4)) {
        const scene = draft.storyboard.find((entry) =>
          entry.spatialIntent?.focalPart &&
          issue.time >= entry.startSec &&
          issue.time <= entry.startSec + entry.durationSec
        );
        const focalPart = scene?.spatialIntent?.focalPart;
        if (!scene || !focalPart) continue;
        const sceneEnd = scene.startSec + scene.durationSec;
        const recheckTimes = uniqueTimes(
          [
            Math.min(issue.time + 0.6, sceneEnd - 0.05),
            scene.startSec + scene.durationSec * 0.82,
          ],
          duration,
        ).filter((time) => time > issue.time + 0.05 && time < sceneEnd).slice(0, 2);
        for (const time of recheckTimes) {
          await seekContent(time);
          const visibleNow = await page.evaluate((payload: { sceneId: string; part: string }) => {
            const sceneElement = document.querySelector<HTMLElement>(
              `[data-scene="${CSS.escape(payload.sceneId)}"]`,
            );
            const focal = sceneElement?.querySelector<HTMLElement>(
              `[data-part="${CSS.escape(payload.part)}"]`,
            );
            if (!focal) return false;
            const rect = focal.getBoundingClientRect();
            let opacity = 1;
            let node: Element | null = focal;
            while (node) {
              const style = getComputedStyle(node);
              if (style.display === "none" || style.visibility === "hidden") opacity = 0;
              opacity *= Number.parseFloat(style.opacity) || 0;
              node = node.parentElement;
            }
            return rect.width >= 1 && rect.height >= 1 && opacity >= 0.15;
          }, { sceneId: scene.id, part: focalPart });
          if (visibleNow) {
            lateVisible.add(issue);
            break;
          }
        }
      }
      if (lateVisible.size) {
        recordSentinelNormalization("focal-late-sample", lateVisible.size);
        for (let index = rawIssues.length - 1; index >= 0; index -= 1) {
          if (lateVisible.has(rawIssues[index]!)) rawIssues.splice(index, 1);
        }
      }
    }

    // Reuse HyperFrames' screenshot-backed contrast audit at representative hero
    // frames. Contrast findings are repair feedback, not a hard geometry block.
    await page.addScriptTag({ content: loadBrowserAudit("contrast-audit.browser.js") });
    // MD4: re-measure text AA under a mid-scene grade shift's NEW wash. Sample
    // at the post-cover settle (panel faded, grade class active) — never during
    // the expand, which would measure the transient decoration panel.
    const gradeShiftSettles = draft.storyboard
      .filter((scene) => scene.gradeShift)
      .map((scene) => {
        const sceneEnd = scene.startSec + scene.durationSec;
        return Math.min(scene.gradeShift!.atSec + GRADE_SHIFT_DURATION_SEC + 0.45, sceneEnd - 0.05);
      });
    const contrastTimes = uniqueTimes(
      [
        ...gradeShiftSettles,
        ...draft.storyboard.map((scene) => scene.startSec + scene.durationSec * 0.58),
      ],
      duration,
    ).slice(0, 5 + gradeShiftSettles.length);
    // One real defect, one finding: an element sampled at several hero frames
    // (or mid color animation) otherwise mints near-duplicate contrast rows
    // whose count inflates the least-bad penalty (2026-07-07 ledgers: the same
    // div at five ratios 4.23–4.46 in ONE attempt). Keep the worst ratio per
    // selector+text.
    const contrastWorst = new Map<string, DirectLayoutIssue>();
    const washoutEvidence: CompositionWashoutEvidenceV1[] = [];
    for (const time of contrastTimes) {
      await seekContent(time);
      const screenshot = await page.screenshot({ encoding: "base64", type: "png" });
      const washoutScene = draft.storyboard.find((scene) =>
        time >= scene.startSec && time < scene.startSec + scene.durationSec
      );
      const washoutFocal = washoutScene ? spatialFocalPartAt(washoutScene, time) : undefined;
      if (washoutScene && washoutFocal) {
        const pixels = await page.evaluate(async (payload: {
          image: string;
          sceneId: string;
          focalPart: string;
        }) => {
          const root = document.querySelector<HTMLElement>(
            "[data-composition-id][data-width][data-height]",
          );
          const scene = root?.querySelector<HTMLElement>(
            `[data-scene="${CSS.escape(payload.sceneId)}"]`,
          );
          const focal = scene?.querySelector<HTMLElement>(
            `[data-part="${CSS.escape(payload.focalPart)}"]`,
          );
          if (!root || !focal) return null;
          const binary = atob(payload.image);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const width = 192;
          const height = Math.max(1, Math.round(width * image.height / image.width));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) {
            image.close();
            return null;
          }
          context.drawImage(image, 0, 0, width, height);
          image.close();
          const rootRect = root.getBoundingClientRect();
          const focalRect = focal.getBoundingClientRect();
          if (rootRect.width < 1 || rootRect.height < 1 || focalRect.width < 1 || focalRect.height < 1) {
            return null;
          }
          return {
            width,
            height,
            data: Array.from(context.getImageData(0, 0, width, height).data),
            focalRect: {
              left: (focalRect.left - rootRect.left) / rootRect.width * width,
              top: (focalRect.top - rootRect.top) / rootRect.height * height,
              right: (focalRect.right - rootRect.left) / rootRect.width * width,
              bottom: (focalRect.bottom - rootRect.top) / rootRect.height * height,
            },
          };
        }, { image: String(screenshot), sceneId: washoutScene.id, focalPart: washoutFocal });
        if (pixels) {
          const washout = analyzeCompositionWashout({
            ...pixels,
            time,
            sceneId: washoutScene.id,
            focalPart: washoutFocal,
          });
          washoutEvidence.push(washout.evidence);
          if (washout.finding) {
            rawIssues.push({
              code: "composition_washed_out",
              severity: "warning",
              time,
              selector: `[data-part="${washoutFocal}"]`,
              sceneId: washoutScene.id,
              part: washoutFocal,
              message: washout.finding.message,
              fixHint: washout.finding.fixHint,
              source: "sequences",
            });
          }
        }
      }
      const contrast = await page.evaluate(
        (payload: { image: string; time: number }) => {
          const audit = (window as unknown as {
            __contrastAudit?: (image: string, time: number) => Promise<Array<{
              selector: string;
              text: string;
              ratio: number;
              required?: number;
              wcagAA: boolean;
              large: boolean;
              fg?: string;
              bg?: string;
              suggestedColor?: string;
            }>>;
          }).__contrastAudit;
          return audit?.(payload.image, payload.time) ?? [];
        },
        { image: String(screenshot), time },
      );
      const sampleIssues: DirectLayoutIssue[] = [];
      for (const entry of contrast) {
        if (entry.wcagAA) continue;
        const required = entry.required ?? (entry.large ? 3 : 4.5);
        sampleIssues.push({
          code: "contrast_aa",
          severity: "warning",
          time,
          selector: entry.selector,
          text: entry.text,
          message: `Contrast is ${entry.ratio}:1; needs ${required}:1.`,
          fixHint: "Adjust the existing semantic color while preserving the committed hue family.",
          source: "hyperframes",
          contrast: {
            ratio: entry.ratio,
            required,
            ...(entry.fg ? { foreground: entry.fg } : {}),
            ...(entry.bg ? { background: entry.bg } : {}),
            ...(entry.suggestedColor ? { suggestedColor: entry.suggestedColor } : {}),
          },
        });
      }
      // Author-declared primary subjects make contrast triage honest: low
      // contrast ON the declared subject is load-bearing feedback, while
      // supporting microcopy stays ordinary advisory evidence. Best-effort
      // annotation only; it never changes severity.
      const declaredScene = draft.declaredPrimarySelectors
        ? draft.storyboard.find((scene) =>
          time >= scene.startSec && time < scene.startSec + scene.durationSec)
        : undefined;
      const declaredPrimarySelector = declaredScene
        ? draft.declaredPrimarySelectors?.[declaredScene.id]
        : undefined;
      if (declaredPrimarySelector && sampleIssues.length) {
        const declaredFlags = await page.evaluate(
          (payload: { selectors: string[]; primary: string }) => {
            let primary: Element | null = null;
            try {
              primary = document.querySelector(payload.primary);
            } catch {
              return payload.selectors.map(() => false);
            }
            return payload.selectors.map((selector) => {
              try {
                const element = selector ? document.querySelector(selector) : null;
                return Boolean(
                  element && primary && (element === primary || primary.contains(element)),
                );
              } catch {
                return false;
              }
            });
          },
          {
            selectors: sampleIssues.map((issue) => issue.selector ?? ""),
            primary: declaredPrimarySelector,
          },
        );
        for (const [flagIndex, sampleIssue] of sampleIssues.entries()) {
          if (declaredFlags[flagIndex]) sampleIssue.declaredPrimary = true;
        }
      }
      // Resolve while the page is still parked on THIS sample. Deferring until
      // after the loop used the final seek's DOM state and, more importantly,
      // mapped every compact `span` selector to the first span in the document.
      for (const issue of await enrichRepairEvidence(page, sampleIssues)) {
        const key = `${issue.repairSelector ?? issue.selector}\0${issue.text ?? ""}`;
        const existing = contrastWorst.get(key);
        if (!existing || (issue.contrast?.ratio ?? 999) < (existing.contrast?.ratio ?? 999)) {
          contrastWorst.set(key, issue);
        }
      }
    }
    // Contrast Audit intentionally returns compact selectors such as
    // `span.cmp-label`. Those are useful evidence labels but are unsafe repair
    // selectors: one low-contrast CTA previously recolored every component
    // label in the film. Resolve each finding to the same unique scene/part or
    // structural selector used by geometry QA before a deterministic repair is
    // allowed to touch CSS.
    rawIssues.push(...contrastWorst.values());

    const declaredInteractionAudit = await auditDeclaredInteractions(page, draft, seekContent);
    rawIssues.push(...declaredInteractionAudit.issues);
    interactionEvidence.push(...declaredInteractionAudit.evidence);

    // Rendering may seek frames out of order. Revisit each interaction arrival
    // after seeking forward and backward; a history-dependent cursor will not
    // return to the same measured hotspot.
    for (const intent of interactionIntents.slice(0, 8)) {
      const baseline = interactionEvidence.find((entry) =>
        entry.id === intent.id && entry.phase === "arrival"
      );
      if (!baseline) continue;
      await seekContent(intent.releaseSec ?? intent.arriveSec);
      await seekContent(intent.startSec + (intent.arriveSec - intent.startSec) / 2);
      await seekContent(intent.arriveSec);
      const replay = await auditInteractions(page, [intent], intent.arriveSec);
      const endpoint = replay.evidence.find((entry) => entry.phase === "arrival");
      // Screen-space coordinates are not an interaction invariant: a cursor
      // and its target can move together when a camera world is re-rendered.
      // What the pointer owns is its relationship to the live measured anchor.
      // Comparing those two vectors still catches a stale/independently moved
      // cursor, without charging a camera-world excursion to the interaction.
      const baselineOffset = {
        x: baseline.cursor.x - baseline.target.x,
        y: baseline.cursor.y - baseline.target.y,
      };
      const endpointOffset = endpoint
        ? {
          x: endpoint.cursor.x - endpoint.target.x,
          y: endpoint.cursor.y - endpoint.target.y,
        }
        : undefined;
      if (
        endpointOffset &&
        Math.hypot(
          endpointOffset.x - baselineOffset.x,
          endpointOffset.y - baselineOffset.y,
        ) > 0.5
      ) {
        rawIssues.push({
          code: "interaction_seek_instability",
          severity: "error",
          time: intent.arriveSec,
          selector: `[data-cursor-id="${intent.cursorId}"]`,
          message:
            `Interaction "${intent.id}" changes its measured-target relationship when frames ` +
            "are sought out of order.",
          fixHint: "Derive cursor position only from timeline time and measured anchors.",
          source: "sequences",
        });
      }
    }

    // Boundary geometry inventory (feeds deterministic cut discovery): the
    // outgoing scene measured just before each boundary, the incoming scene
    // after its entry settles. Content time; seekContent converts.
    const cutTimingByBoundary = new Map(
      (parseCutPlan(draft.html).plan?.cuts ?? []).map((cut) => [
        `${cut.fromScene}->${cut.toScene}`,
        { entrySec: cut.entrySec, exitSec: cut.exitSec ?? 0 },
      ]),
    );
    const boundaryInventories: DirectBoundaryInventory[] = [];
    const cameraPhrasePlan = parseCameraPhrasePlan(draft.html);
    for (let index = 0; index < draft.storyboard.length - 1; index += 1) {
      const from = draft.storyboard[index]!;
      const to = draft.storyboard[index + 1]!;
      const atSec = from.startSec + from.durationSec;
      const timing = cutTimingByBoundary.get(`${from.id}->${to.id}`);
      // Sample the outgoing side BEFORE the declared exit begins: a typed cut
      // with exitSec > 0.15 is already translating/fading the outgoing scene
      // at atSec - 0.15, so "where the eye is before the cut" would record
      // transition geometry, not the held frame.
      const outgoingAt = atSec - Math.max(0.15, (timing?.exitSec ?? 0) + 0.1);
      const incomingAt = Math.min(
        atSec + (timing?.entrySec ?? 0.5),
        to.startSec + Math.max(0.1, to.durationSec - 0.05),
      );
      if (outgoingAt <= from.startSec) continue;
      // The declared attention/focal endpoints must survive the measurement
      // cap: they are what cut degradation diagnostics and the eye-trace
      // audit are ABOUT.
      const attention = resolveBoundaryAttention(from, to, cameraPhrasePlan);
      await seekContent(outgoingAt);
      const outgoing = await measureBoundaryParts(page, from.id, [
        ...new Set([
          ...(from.cut?.focalPartOut ? [from.cut.focalPartOut] : []),
          ...(attention.outPart ? [attention.outPart] : []),
          ...(from.spatialIntent?.focalPart ? [from.spatialIntent.focalPart] : []),
        ]),
      ]);
      await seekContent(incomingAt);
      const incoming = await measureBoundaryParts(page, to.id, [
        ...new Set([
          ...(from.cut?.focalPartIn ? [from.cut.focalPartIn] : []),
          ...(attention.inPart ? [attention.inPart] : []),
          ...(to.spatialIntent?.focalPart ? [to.spatialIntent.focalPart] : []),
        ]),
      ]);
      if (outgoing.length || incoming.length) {
        boundaryInventories.push({ fromScene: from.id, toScene: to.id, atSec, outgoing, incoming });
      }
    }

    // A planner-DECLARED bridged cut that the runtime degraded is a broken
    // promise the author can usually keep: the storyboard (and every artifact
    // derived from it) advertises a morph the viewer never gets. Raise it as
    // a polish finding — strictOk-blocking so the repair loop asks the author
    // to make the two silhouettes actually rhyme, never a publication error —
    // and carry the measured endpoint geometry so the repair prompt gets the
    // real numbers, not a vibe. Discovery upgrades need no finding here: the
    // upgrade pass already rejects any candidate whose boundary degrades.
    const declaredBridgedBoundaries = new Map<string, number>();
    for (let index = 0; index < draft.storyboard.length - 1; index += 1) {
      const scene = draft.storyboard[index]!;
      const style = scene.cut?.style;
      if (
        style !== "morph" && style !== "match" &&
        style !== "shape-match" && style !== "object-match"
      ) continue;
      declaredBridgedBoundaries.set(
        `${scene.id}->${draft.storyboard[index + 1]!.id}`,
        scene.startSec + scene.durationSec,
      );
    }
    for (const degraded of degradedCutBindings) {
      const boundaryKey = `${degraded.fromScene}->${degraded.toScene}`;
      const atSec = declaredBridgedBoundaries.get(boundaryKey);
      if (atSec === undefined) continue;
      const inventory = boundaryInventories.find((entry) =>
        entry.fromScene === degraded.fromScene && entry.toScene === degraded.toScene
      );
      const summarize = (
        side: BoundaryPartMeasurement[] | undefined,
        partName: string,
      ): string => {
        const part = side?.find((entry) => entry.part === partName);
        if (!part) return `"${partName}" (not measurable at the boundary sample)`;
        return `"${partName}" ${Math.round(part.width)}x${Math.round(part.height)}px ` +
          `(aspect ${(part.width / Math.max(1, part.height)).toFixed(2)}, ` +
          `radius ${Math.round(part.radiusPx)}px, ${part.nodeCount} nodes, ` +
          `${Math.round(part.onFrameRatio * 100)}% on frame)`;
      };
      rawIssues.push({
        code: "cut_degraded",
        severity: "warning",
        time: atSec,
        selector: `[data-part="${degraded.focalPartOut}"]`,
        message:
          `The storyboard declares a ${degraded.style} cut ${boundaryKey}, but the runtime ` +
          `degraded it to ${degraded.target} at bind time: ${degraded.reason}. Measured at the ` +
          `boundary: outgoing ${summarize(inventory?.outgoing, degraded.focalPartOut)} vs ` +
          `incoming ${summarize(inventory?.incoming, degraded.focalPartIn)}.`,
        fixHint:
          `Make the endpoint silhouettes genuinely rhyme so the declared cut compiles: ` +
          `restyle one endpoint — e.g. give "${degraded.focalPartIn}" a condensed band whose ` +
          `box matches "${degraded.focalPartOut}"'s proportions and move that data-part ` +
          `attribute onto the band (a sub-element that rhymes) — or resize the other part. ` +
          `Both parts need aspect ratios within 2.5x of each other, subtrees under 60 nodes, ` +
          `and must sit on frame at the boundary. Never rename the parts, edit the cut plan ` +
          `JSON, or remove any other binding.`,
        source: "sequences",
      });
    }

    // Eye-trace continuity (WS2). The boundary inventory above measured the
    // outgoing scene just before each cut and the incoming scene at entry
    // settle — exactly the two gaze samples Murch's eye-trace rule needs. A
    // hard/undeclared boundary whose declared attention targets sit far apart
    // in viewport space breaks comprehension ("I constantly look all over the
    // place"); directional/zoom/bridged cuts carry the eye and a flash resets
    // it, so those styles are exempt. `eye_trace_jump` is a polish finding —
    // strictOk-blocking under the default mode, advisory under
    // SLACK_SEQUENCES_EYE_TRACE=audit — and never unpublishes a runnable
    // draft. The within-scene ping-pong variant is always advisory.
    const eyeTrace = eyeTraceMode();
    if (eyeTrace !== "off") {
      for (const jump of scoreEyeTraceBoundaries({
        scenes: draft.storyboard,
        cameraPhrases: cameraPhrasePlan,
        boundaries: boundaryInventories,
        frameWidth: width,
        frameHeight: height,
      })) {
        rawIssues.push({
          code: "eye_trace_jump",
          severity: "warning",
          time: jump.atSec,
          selector: `[data-part="${jump.inPart}"]`,
          message:
            `The viewer's eye is on "${jump.outPart}" at (${jump.outCenter.x},` +
            `${jump.outCenter.y}) when scene "${jump.fromScene}" cuts to ` +
            `"${jump.toScene}", but the incoming attention target "${jump.inPart}" ` +
            `appears at (${jump.inCenter.x},${jump.inCenter.y}) — a ` +
            `${Math.round(jump.displacementFraction * 100)}%-of-frame-diagonal jump ` +
            `across a ${jump.cutStyle} cut ` +
            `(budget ${Math.round(jump.budgetFraction * 100)}%` +
            `${jump.cutStyle === "match"
              ? " — match PROMISES the incoming subject lands where the eye already is"
              : ""}).`,
          fixHint:
            "Place the incoming shot's opening subject where the eye already is at the " +
            "cut: align the two focal elements' frame positions, or move the incoming " +
            "scene's entry station so its hero lands near the measured outgoing position. " +
            "Never retime the cut or edit the cut plan JSON.",
          source: "sequences",
        });
      }
      // Two seeks per candidate pair (capped): each target is sampled just
      // after ITS OWN beat — camera motion, swaps, or component motion
      // between the beats can relocate or hide the first target by the time
      // the second fires, so a single shared sample lies in both directions.
      // Samples are cached by scene/part/time so chained pairs (a->b->c)
      // reuse the shared middle sample instead of re-seeking.
      const measurePartCenter = async (
        sceneId: string,
        part: string,
      ): Promise<{ x: number; y: number } | undefined> =>
        page.evaluate(
          (payload: { sceneId: string; part: string }) => {
            const root = document.querySelector<HTMLElement>(
              "[data-composition-id][data-width][data-height]",
            );
            const scene = root?.querySelector<HTMLElement>(
              `[data-scene="${CSS.escape(payload.sceneId)}"]`,
            );
            if (!root || !scene) return undefined;
            const rootRect = root.getBoundingClientRect();
            const element = scene.querySelector<HTMLElement>(
              `[data-part="${CSS.escape(payload.part)}"]`,
            );
            if (!element) return undefined;
            const rect = element.getBoundingClientRect();
            if (rect.width < 8 || rect.height < 8) return undefined;
            let opacity = 1;
            let node: Element | null = element;
            while (node) {
              const style = getComputedStyle(node);
              if (style.display === "none" || style.visibility === "hidden") return undefined;
              opacity *= Number.parseFloat(style.opacity) || 0;
              node = node.parentElement;
            }
            if (opacity < 0.15) return undefined;
            return {
              x: Math.min(
                rootRect.width,
                Math.max(0, rect.left - rootRect.left + rect.width / 2),
              ),
              y: Math.min(
                rootRect.height,
                Math.max(0, rect.top - rootRect.top + rect.height / 2),
              ),
            };
          },
          { sceneId, part },
        );
      const pingPongSamples = new Map<string, { x: number; y: number } | undefined>();
      const samplePartCenter = async (
        sceneId: string,
        part: string,
        atSec: number,
      ): Promise<{ x: number; y: number } | undefined> => {
        const key = `${sceneId}|${part}|${atSec.toFixed(3)}`;
        if (pingPongSamples.has(key)) return pingPongSamples.get(key);
        await seekContent(atSec);
        const center = await measurePartCenter(sceneId, part);
        pingPongSamples.set(key, center);
        return center;
      };
      for (const candidate of pingPongCandidates(draft.storyboard)) {
        const first = await samplePartCenter(
          candidate.sceneId,
          candidate.firstPart,
          candidate.firstMeasureAtSec,
        );
        const second = await samplePartCenter(
          candidate.sceneId,
          candidate.secondPart,
          candidate.secondMeasureAtSec,
        );
        const pingPong = scorePingPongPair(
          candidate,
          { ...(first ? { first } : {}), ...(second ? { second } : {}) },
          width,
          height,
        );
        if (!pingPong) continue;
        rawIssues.push({
          code: "eye_trace_pingpong",
          severity: "warning",
          time: pingPong.secondAtSec,
          selector: `[data-part="${pingPong.secondPart}"]`,
          message:
            `Consecutive beats "${pingPong.firstBeatId}" -> "${pingPong.secondBeatId}" in ` +
            `scene "${pingPong.sceneId}" move the eye ` +
            `${Math.round(pingPong.displacementFraction * 100)}% of the frame diagonal in ` +
            `${pingPong.viewerGapSec.toFixed(2)}s ` +
            `("${pingPong.firstPart}" -> "${pingPong.secondPart}") — ping-pong choreography ` +
            `reads as noise.`,
          fixHint:
            "Bring the two beat targets closer together in the frame, stagger the beats " +
            "further apart in time, or let one component carry both beats — one focal " +
            "element at a time.",
          source: "sequences",
          eyeTracePingPong: {
            sceneId: pingPong.sceneId,
            firstBeatId: pingPong.firstBeatId,
            secondBeatId: pingPong.secondBeatId,
            firstPart: pingPong.firstPart,
            secondPart: pingPong.secondPart,
            firstAtSec: pingPong.firstAtSec,
            secondAtSec: pingPong.secondAtSec,
            viewerGapSec: pingPong.viewerGapSec,
            displacementFraction: pingPong.displacementFraction,
            firstCenter: first!,
            secondCenter: second!,
          },
        });
      }
    }

    // Typed cuts intentionally move scene wrappers across the safe area and
    // stack both scenes' geometry for a few hundred milliseconds around each
    // boundary. Static-layout heuristics sampled inside those windows would
    // report that intentional motion as overlap/overflow findings and spend
    // model repairs fighting the cut compositor; interaction evidence and
    // runtime errors keep their full authority everywhere.
    // The camera rig intentionally re-frames the world during full moves
    // (whips, pans, push-ins…): mid-transit geometry is designed motion, not a
    // layout defect. Suppress static-layout heuristics inside those windows
    // exactly like cut boundaries; interaction evidence and runtime errors
    // keep their full authority everywhere.
    const boundaryWindows = [
      ...cutMotionWindows(parseCutPlan(draft.html).plan),
      ...cameraMotionWindows(parseCameraPlan(draft.html).plan),
      // Morph/open/close beats intentionally move a component over other
      // content; mid-travel geometry is designed motion, not a layout defect.
      ...componentMotionWindows(parseComponentPlan(draft.html).plan),
    ];
    const insideCutWindow = (time: number): boolean =>
      boundaryWindows.some((window) => time >= window.start && time <= window.end);

    // Camera-arrival framing audit (2026-07-04). The off-world suppression
    // above deliberately exempts content whose station the camera has not
    // framed *yet* — which also meant nothing ever verified content at the
    // moment its station IS framed, so a component overflowing its region
    // shipped half-clipped at every arrival. For each full-move landing that
    // frames a station at fit zoom, seek to just after the move settles and
    // require the station's visible content to actually be on frame. A
    // second, later sample must confirm each finding so mid-entrance travel
    // never masquerades as clipping.
    const measureArrivalClipping = async (
      time: number,
      sceneId: string,
      part: string | undefined,
      region: string | undefined,
    ): Promise<Array<{ selector: string; text: string; fraction: number }>> => {
      await seekContent(time);
      return page.evaluate((payload: {
        sceneId: string;
        part?: string;
        region?: string;
      }) => {
        const root = document.querySelector<HTMLElement>(
          "[data-composition-id][data-width][data-height]",
        );
        if (!root) return [];
        const rootRect = root.getBoundingClientRect();
        const scene = root.querySelector<HTMLElement>(
          `[data-scene="${CSS.escape(payload.sceneId)}"]`,
        );
        const station = payload.part
          ? scene?.querySelector<HTMLElement>(`[data-part="${CSS.escape(payload.part)}"]`)
          : payload.region
            ? scene?.querySelector<HTMLElement>(`[data-region="${CSS.escape(payload.region)}"]`)
            : null;
        if (!scene || !station) return [];
        const MEDIA = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE"]);
        const opacityCache = new Map<Element, number>();
        const chainOpacity = (element: Element | null): number => {
          if (!element || (!root.contains(element) && element !== root)) return 1;
          const cached = opacityCache.get(element);
          if (cached !== undefined) return cached;
          const style = getComputedStyle(element);
          const own = style.display === "none" || style.visibility === "hidden"
            ? 0
            : Number.parseFloat(style.opacity);
          const value = (Number.isFinite(own) ? own : 1) * chainOpacity(element.parentElement);
          opacityCache.set(element, value);
          return value;
        };
        const clipped: Array<{ selector: string; text: string; fraction: number }> = [];
        const flagged: Element[] = [];
        for (const element of [station, ...Array.from(station.querySelectorAll<HTMLElement>("*"))]) {
          if (element.closest("[data-layout-ignore]")) continue;
          // Outermost finding wins; its children clip for the same reason.
          if (flagged.some((parent) => parent.contains(element))) continue;
          const hasText = Array.from(element.childNodes).some((node) =>
            node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent ?? ""),
          );
          const isContent = hasText ||
            MEDIA.has(element.tagName.toUpperCase()) ||
            element.hasAttribute("data-part");
          if (!isContent) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 12 || rect.height < 12) continue;
          if (chainOpacity(element) < 0.15) continue;
          const visibleWidth = Math.max(
            0,
            Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left),
          );
          const visibleHeight = Math.max(
            0,
            Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top),
          );
          const fraction = (visibleWidth * visibleHeight) / (rect.width * rect.height);
          if (fraction >= 0.62) continue;
          const partName = element.getAttribute("data-part");
          const className = (element.getAttribute("class") ?? "").trim().split(/\s+/)[0];
          clipped.push({
            selector: partName
              ? `[data-part="${partName}"]`
              : element.tagName.toLowerCase() + (className ? `.${className}` : ""),
            text: (element.textContent ?? "").trim().slice(0, 60),
            fraction,
          });
          flagged.push(element);
          if (clipped.length >= 6) break;
        }
        return clipped;
      }, { sceneId, ...(part ? { part } : {}), ...(region ? { region } : {}) });
    };
    // Framing-coverage audit (WS5). Clipping proves nothing about a landing
    // that frames 6% of content adrift in a void (probe-cutfix-3 m06): after
    // each fit-zoom landing (and once mid-window for camera-less scenes),
    // measure the union bounding box of the scene's visible content — text,
    // media, data-part / data-layout-important elements; decoration and
    // blooms carry none of those markers and count toward nothing — clipped
    // to the frame, and flag framings the viewer sees as mostly empty. The
    // scope is deliberately the whole SCENE, not the framed station: a tight
    // track-to-anchor close-up on a button is fine when the surrounding UI
    // fills the margins (the fit zoom caps how tight small parts frame), and
    // is the m06 defect exactly when nothing else is on frame around it.
    const measureFramedCoverage = async (
      time: number,
      sceneId: string,
    ): Promise<
      {
        fraction: number;
        bboxFraction: number;
        occupiedFraction: number;
        widthFraction: number;
        heightFraction: number;
      } | undefined
    > => {
      await seekContent(time);
      return page.evaluate((payload: { sceneId: string }) => {
        const root = document.querySelector<HTMLElement>(
          "[data-composition-id][data-width][data-height]",
        );
        if (!root) return undefined;
        const rootRect = root.getBoundingClientRect();
        if (rootRect.width < 1 || rootRect.height < 1) return undefined;
        const scope = root.querySelector<HTMLElement>(
          `[data-scene="${CSS.escape(payload.sceneId)}"]`,
        );
        if (!scope) return undefined;
        const MEDIA = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE"]);
        const opacityCache = new Map<Element, number>();
        const chainOpacity = (element: Element | null): number => {
          if (!element || (!root.contains(element) && element !== root)) return 1;
          const cached = opacityCache.get(element);
          if (cached !== undefined) return cached;
          const style = getComputedStyle(element);
          const own = style.display === "none" || style.visibility === "hidden"
            ? 0
            : Number.parseFloat(style.opacity);
          const value = (Number.isFinite(own) ? own : 1) * chainOpacity(element.parentElement);
          opacityCache.set(element, value);
          return value;
        };
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        const rects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
        const colorHasAlpha = (value: string): boolean => {
          if (!value || value === "transparent") return false;
          const match = value.match(/rgba?\(([^)]+)\)/i);
          if (!match) return true;
          const channels = match[1]!.split(",");
          return channels.length < 4 || Number(channels[3]) > 0.02;
        };
        const stylePaints = (style: CSSStyleDeclaration): boolean =>
          colorHasAlpha(style.backgroundColor) ||
          style.backgroundImage !== "none" ||
          style.boxShadow !== "none" ||
          style.outlineStyle !== "none" ||
          (Number.parseFloat(style.borderTopWidth) || 0) > 0 ||
          (Number.parseFloat(style.borderRightWidth) || 0) > 0 ||
          (Number.parseFloat(style.borderBottomWidth) || 0) > 0 ||
          (Number.parseFloat(style.borderLeftWidth) || 0) > 0;
        for (const element of [scope, ...Array.from(scope.querySelectorAll<HTMLElement>("*"))]) {
          if (element.closest("[data-layout-ignore]")) continue;
          const hasText = Array.from(element.childNodes).some((node) =>
            node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent ?? ""),
          );
          const style = getComputedStyle(element);
          const before = getComputedStyle(element, "::before");
          const after = getComputedStyle(element, "::after");
          const pseudoPaints = (pseudo: CSSStyleDeclaration) =>
            pseudo.content !== "none" && pseudo.content !== "normal" && stylePaints(pseudo);
          const isContent = hasText ||
            MEDIA.has(element.tagName.toUpperCase()) ||
            stylePaints(style) || pseudoPaints(before) || pseudoPaints(after);
          if (!isContent) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 12 || rect.height < 12) continue;
          if (chainOpacity(element) < 0.15) continue;
          const l = Math.max(rect.left, rootRect.left);
          const t = Math.max(rect.top, rootRect.top);
          const r = Math.min(rect.right, rootRect.right);
          const b = Math.min(rect.bottom, rootRect.bottom);
          if (r - l < 4 || b - t < 4) continue;
          left = Math.min(left, l);
          top = Math.min(top, t);
          right = Math.max(right, r);
          bottom = Math.max(bottom, b);
          rects.push({ left: l, top: t, right: r, bottom: b });
        }
        if (right <= left || bottom <= top) {
          return {
            fraction: 0,
            bboxFraction: 0,
            occupiedFraction: 0,
            widthFraction: 0,
            heightFraction: 0,
          };
        }
        // Exact rectangle-union area. Nested text inside a painted panel does
        // not double-count, while widely separated tiny cards no longer earn
        // the empty area between them as visual coverage.
        const xs = [...new Set(rects.flatMap((rect) => [rect.left, rect.right]))]
          .sort((a, b) => a - b);
        let occupiedArea = 0;
        for (let index = 0; index < xs.length - 1; index += 1) {
          const x1 = xs[index]!;
          const x2 = xs[index + 1]!;
          if (x2 <= x1) continue;
          const intervals = rects
            .filter((rect) => rect.left < x2 && rect.right > x1)
            .map((rect) => [rect.top, rect.bottom] as const)
            .sort((a, b) => a[0] - b[0]);
          let coveredY = 0;
          let runStart = 0;
          let runEnd = 0;
          for (let interval = 0; interval < intervals.length; interval += 1) {
            const [start, end] = intervals[interval]!;
            if (interval === 0) {
              runStart = start;
              runEnd = end;
            } else if (start <= runEnd) {
              runEnd = Math.max(runEnd, end);
            } else {
              coveredY += runEnd - runStart;
              runStart = start;
              runEnd = end;
            }
          }
          if (intervals.length) coveredY += runEnd - runStart;
          occupiedArea += (x2 - x1) * coveredY;
        }
        const frameArea = rootRect.width * rootRect.height;
        // The union bbox was easy to game with two tiny islands in opposite
        // corners. Judge the composition on a deterministic 24x14 semantic
        // occupancy grid instead, while retaining exact painted area and bbox
        // as corroborating diagnostics. A cell counts only when visible
        // content actually intersects it; backgrounds and ignored environment
        // layers never enter `rects` above.
        const columns = 24;
        const rows = 14;
        const cellWidth = rootRect.width / columns;
        const cellHeight = rootRect.height / rows;
        let occupiedCells = 0;
        for (let row = 0; row < rows; row += 1) {
          const cellTop = rootRect.top + row * cellHeight;
          const cellBottom = cellTop + cellHeight;
          for (let column = 0; column < columns; column += 1) {
            const cellLeft = rootRect.left + column * cellWidth;
            const cellRight = cellLeft + cellWidth;
            if (rects.some((rect) =>
              rect.left < cellRight && rect.right > cellLeft &&
              rect.top < cellBottom && rect.bottom > cellTop
            )) occupiedCells += 1;
          }
        }
        return {
          fraction: occupiedCells / (columns * rows),
          bboxFraction: ((right - left) * (bottom - top)) / frameArea,
          occupiedFraction: occupiedArea / frameArea,
          widthFraction: (right - left) / rootRect.width,
          heightFraction: (bottom - top) / rootRect.height,
        };
      }, { sceneId });
    };
    const isSparseCoverage = (
      coverage: {
        fraction: number;
        bboxFraction: number;
        occupiedFraction: number;
        widthFraction: number;
        heightFraction: number;
      } | undefined,
    ): coverage is {
      fraction: number;
      bboxFraction: number;
      occupiedFraction: number;
      widthFraction: number;
      heightFraction: number;
    } =>
      Boolean(
        coverage &&
        (
          coverage.fraction < SPARSE_COVERAGE_MIN ||
          coverage.occupiedFraction < SPARSE_OCCUPANCY_MIN
        ) &&
        // A composition that spans one axis while staying compact on the
        // other (a full-width headline band, a tall rail) is deliberate. Two
        // tiny islands in opposite corners span BOTH axes and are not a band.
        !(
          (
            coverage.widthFraction >= SPARSE_AXIS_ESCAPE &&
            coverage.heightFraction <= SPARSE_AXIS_ESCAPE_THICKNESS
          ) ||
          (
            coverage.heightFraction >= SPARSE_AXIS_ESCAPE &&
            coverage.widthFraction <= SPARSE_AXIS_ESCAPE_THICKNESS
          )
        ),
      );
    const blockingPlan = parseCameraPhrasePlan(draft.html);
    const graphOwnedCamera = blockingPlan?.enabled === true;
    if (!graphOwnedCamera) {
      for (const scenePlan of parseCameraPlan(draft.html).plan?.scenes ?? []) {
      const scene = draft.storyboard.find((entry) => entry.id === scenePlan.sceneId);
      if (!scene) continue;
      const sceneEnd = scene.startSec + scene.durationSec;
      // Selectors already reported for this scene — the moment-time re-check
      // below must not duplicate a landing finding.
      const flaggedClips = new Set<string>();
      for (const segment of scenePlan.segments) {
        if (!CAMERA_FULL_MOVES.has(segment.move) || segment.blend < 1) continue;
        if (!segment.toRegion && !segment.toPart) continue;
        // A creative zoom above fit may crop the station deliberately, so the
        // general audit stays on fit framings. Host-applied sparse corrections
        // must prove themselves after zooming instead of clearing by skip.
        const auditZoomedCorrection = segment.framingCorrection === "camera-sparse-zoom";
        if (segment.zoom > 1.05 && !auditZoomedCorrection) continue;
        // A dive (MD5) lands twice: on the part when its push-in leg ends,
        // and back on the prior framing at endSec. The prior framing was
        // already sampled by its own segment, so audit the PART landing —
        // inside the held window, never after the pull-back has left it.
        const isDive = segment.move === "dive";
        const legFallback = Math.min(0.8, (segment.endSec - segment.startSec) * 0.25);
        const arriveSec = isDive
          ? segment.startSec + (segment.inSec ?? legFallback)
          : segment.endSec;
        const windowEnd = isDive
          ? segment.endSec - (segment.outSec ?? legFallback)
          : sceneEnd;
        const settleAt = Math.min(arriveSec + 0.35, windowEnd - 0.1, sceneEnd - 0.1);
        if (settleAt <= arriveSec - 0.01 || insideCutWindow(settleAt)) continue;
        const confirmAt = Math.min(settleAt + 0.8, windowEnd - 0.05, sceneEnd - 0.05);
        const canConfirm = confirmAt > settleAt + 0.05 && !insideCutWindow(confirmAt);
        const station = segment.toPart
          ? `part "${segment.toPart}"`
          : `region "${segment.toRegion}"`;
        const found = await measureArrivalClipping(
          settleAt,
          scenePlan.sceneId,
          segment.toPart,
          segment.toRegion,
        );
        if (found.length) {
          const confirmed = canConfirm
            ? await measureArrivalClipping(
                confirmAt,
                scenePlan.sceneId,
                segment.toPart,
                segment.toRegion,
              )
            : found;
          const confirmedSelectors = new Set(confirmed.map((entry) => entry.selector));
          for (
            const clip of found.filter((entry) => confirmedSelectors.has(entry.selector)).slice(0, 4)
          ) {
            flaggedClips.add(clip.selector);
            rawIssues.push({
              code: "camera_framed_clipped",
              severity: "error",
              time: settleAt,
              selector: clip.selector,
              ...(clip.text ? { text: clip.text } : {}),
              message:
                `Camera ${segment.move} lands on ${station} in scene "${scenePlan.sceneId}" at ` +
                `${arriveSec.toFixed(1)}s, but ${clip.selector} is only ` +
                `${Math.round(clip.fraction * 100)}% inside the frame after the move settles — ` +
                `the audience sees it clipped.`,
              fixHint:
                "Content at a camera station must fit that station's box: move the element fully " +
                "inside its data-region rect (with an ~8% inner margin), shrink it, or relocate it " +
                "to the station the camera actually frames.",
              source: "sequences",
            });
          }
        }
        const coverage = await measureFramedCoverage(settleAt, scenePlan.sceneId);
        // A fully-empty landing is the near-blank audit's finding; sparse is
        // strictly the "content exists but is tiny" class (same skip as the
        // static mid-window path).
        if (isSparseCoverage(coverage) && coverage.fraction > 0) {
          // Double-sample like the clipping audit: an entrance still tweening
          // at the settle sample must not masquerade as a sparse framing.
          const confirmedCoverage = canConfirm
            ? await measureFramedCoverage(confirmAt, scenePlan.sceneId)
            : coverage;
          if (isSparseCoverage(confirmedCoverage) && confirmedCoverage.fraction > 0) {
            rawIssues.push({
              code: "camera_framed_sparse",
              severity: "warning",
              time: settleAt,
              selector: segment.toPart
                ? `[data-part="${segment.toPart}"]`
                : `[data-region="${segment.toRegion}"]`,
              framing: {
                sceneId: scenePlan.sceneId,
                fraction: confirmedCoverage.fraction,
                bboxFraction: confirmedCoverage.bboxFraction,
                occupiedFraction: confirmedCoverage.occupiedFraction,
                ...(segment.toPart ? { part: segment.toPart } : {}),
                ...(segment.toRegion ? { region: segment.toRegion } : {}),
              },
              message:
                `Camera ${segment.move} lands on ${station} in scene "${scenePlan.sceneId}" at ` +
                `${arriveSec.toFixed(1)}s, but the scene's visible content fills only ` +
                `${Math.round(confirmedCoverage.fraction * 100)}% of the 24x14 occupancy grid and ` +
                `${Math.round(confirmedCoverage.occupiedFraction * 100)}% painted area — a small ` +
                `subject adrift in empty space.`,
              fixHint:
                "Fill the framing: enlarge the framed content, tighten the station rect (the fit " +
                "zoom follows the data-region box), or bring more of the scene's content into the " +
                "frame the camera lands on — a tight close-up is fine only when surrounding UI " +
                "still fills the margins.",
              source: "sequences",
            });
          }
        }
      }

      // Landing-only geometry cannot catch a subject that drifts or clips
      // LATER in the held segment (live probe m08-m4-land: a stat card
      // visibly cropped at its own moment's capture time while every landing
      // sample passed). Re-check framed-content containment at each PRIMARY
      // moment's capture time against the framing that holds there,
      // double-sampled so a transient never fires.
      const fullSegments = scenePlan.segments.filter((segment) =>
        CAMERA_FULL_MOVES.has(segment.move) &&
        segment.blend >= 1 &&
        (segment.toRegion || segment.toPart) &&
        (segment.zoom <= 1.05 || segment.framingCorrection === "camera-sparse-zoom")
      );
      const settledFramingAt = (atSec: number) =>
        fullSegments
          .filter((segment) => segment.endSec <= atSec)
          .sort((a, b) => b.endSec - a.endSec)[0];
      const cameraInFlightAt = (atSec: number): boolean =>
        scenePlan.segments.some((segment) =>
          CAMERA_FULL_MOVES.has(segment.move) &&
          segment.startSec <= atSec && segment.endSec > atSec
        );
      for (
        const moment of (scene.moments ?? []).filter((entry) => entry.importance === "primary")
      ) {
        const captureAt = Math.min(
          Math.max(moment.atSec + 0.15, scene.startSec),
          sceneEnd - 0.1,
        );
        if (captureAt <= scene.startSec || insideCutWindow(captureAt)) continue;
        if (cameraInFlightAt(captureAt)) continue;
        const framing = settledFramingAt(captureAt);
        if (!framing) continue;
        // The landing's own settle+confirm samples already cover the first
        // ~1.2s after the move; only later holds need the re-check.
        if (captureAt <= framing.endSec + 1.2) continue;
        const found = await measureArrivalClipping(
          captureAt,
          scenePlan.sceneId,
          framing.toPart,
          framing.toRegion,
        );
        if (!found.length) continue;
        const confirmAt = Math.min(captureAt + 0.5, sceneEnd - 0.05);
        const canConfirmMoment = confirmAt > captureAt + 0.05 &&
          !insideCutWindow(confirmAt) && !cameraInFlightAt(confirmAt);
        const confirmed = canConfirmMoment
          ? await measureArrivalClipping(
              confirmAt,
              scenePlan.sceneId,
              framing.toPart,
              framing.toRegion,
            )
          : found;
        const confirmedSelectors = new Set(confirmed.map((entry) => entry.selector));
        for (
          const clip of found
            .filter((entry) =>
              confirmedSelectors.has(entry.selector) && !flaggedClips.has(entry.selector)
            )
            .slice(0, 2)
        ) {
          flaggedClips.add(clip.selector);
          rawIssues.push({
            code: "camera_framed_clipped",
            severity: "error",
            time: captureAt,
            selector: clip.selector,
            ...(clip.text ? { text: clip.text } : {}),
            message:
              `At primary moment "${moment.id}" (${moment.atSec.toFixed(1)}s) the camera holds ` +
              `${framing.toPart ? `part "${framing.toPart}"` : `region "${framing.toRegion}"`} in ` +
              `scene "${scenePlan.sceneId}", but ${clip.selector} is only ` +
              `${Math.round(clip.fraction * 100)}% inside the frame — the audience studies this ` +
              `exact frame and sees it clipped.`,
            fixHint:
              "Content at a camera station must stay inside that station's box for the WHOLE " +
              "held segment: move the element fully inside its data-region rect (with an ~8% " +
              "inner margin), shrink it, or remove the authored drift that carries it off frame.",
            source: "sequences",
          });
        }
      }
      }
    }

    // The continuity director overrides the legacy camera plan, so its own
    // primary phrase arrivals must carry the same whole-frame composition
    // floor. Target occupancy alone is insufficient: a perfectly readable
    // CTA can still float in an otherwise empty frame.
    const graphLandingSampledScenes = new Set<string>();
    if (graphOwnedCamera && blockingPlan) {
      const sampledPhrases = new Set<string>();
      for (const phrase of blockingPlan.scenes.flatMap((scene) => scene.phrases)) {
        if (phrase.importance !== "primary" || sampledPhrases.has(phrase.id)) continue;
        sampledPhrases.add(phrase.id);
        const scene = draft.storyboard.find((entry) => entry.id === phrase.sceneId);
        if (!scene) continue;
        const sceneEnd = scene.startSec + scene.durationSec;
        const sampleAt = Math.min(
          sceneEnd - 0.08,
          Math.max(phrase.arrivalSec + 0.08, phrase.dwell.startSec + 0.08),
        );
        if (sampleAt <= scene.startSec || insideCutWindow(sampleAt)) continue;
        graphLandingSampledScenes.add(scene.id);
        const coverage = await measureFramedCoverage(sampleAt, scene.id);
        if (!isSparseCoverage(coverage) || coverage.fraction <= 0) continue;
        const confirmAt = Math.min(
          sampleAt + 0.8,
          phrase.dwell.endSec - 0.05,
          sceneEnd - 0.05,
        );
        const confirmedCoverage = confirmAt > sampleAt + 0.05 && !insideCutWindow(confirmAt)
          ? await measureFramedCoverage(confirmAt, scene.id)
          : coverage;
        if (!isSparseCoverage(confirmedCoverage) || confirmedCoverage.fraction <= 0) continue;
        const framingTarget = phrase.framingTarget ??
          (phrase.target.kind === "part" || phrase.target.kind === "region"
            ? phrase.target
            : undefined);
        const selector = framingTarget?.kind === "part"
          ? `[data-part="${framingTarget.id}"]`
          : framingTarget?.kind === "region"
            ? `[data-region="${framingTarget.id}"]`
            : phrase.target.kind === "selector"
              ? phrase.target.id
              : `[data-scene="${scene.id}"]`;
        rawIssues.push({
          code: "camera_framed_sparse",
          severity: "warning",
          time: sampleAt,
          selector,
          framing: {
            sceneId: scene.id,
            fraction: confirmedCoverage.fraction,
            bboxFraction: confirmedCoverage.bboxFraction,
            occupiedFraction: confirmedCoverage.occupiedFraction,
            ...(framingTarget?.kind === "part" ? { part: framingTarget.id } : {}),
            ...(framingTarget?.kind === "region" ? { region: framingTarget.id } : {}),
          },
          message:
            `Primary blocking phrase "${phrase.phraseId}" lands in scene "${scene.id}", but ` +
            `visible content covers only ${Math.round(confirmedCoverage.fraction * 100)}% of ` +
            `the 24x14 occupancy grid and ` +
            `${Math.round(confirmedCoverage.occupiedFraction * 100)}% painted area - a small ` +
            `subject adrift in empty space.`,
          fixHint:
            "Fill the whole landing composition: enlarge or tighten the framed station, or " +
            "bring supporting evidence into the frame without weakening the declared focal.",
          source: "sequences",
        });
      }
    }

    // Scenes without a full-move landing get the same coverage discipline
    // once at mid-window: a held framing whose content fills a sliver of the
    // frame is the same "tiny content in the void" defect whether the scene
    // has no camera at all or only drift/hold micro-moves that never land
    // anywhere (live probe fix-ws-probe-3: a toast at ~3% coverage drifted
    // for 3.5s and was never sampled, because the landing pass has nothing to
    // sample and the old camera-less check skipped any scene with a camera).
    // Final frames participate too: a closing lockup is still a composed
    // frame, and a tiny logo/CTA adrift in void is the defect this gate owns.
    const landingSampledScenes = graphOwnedCamera
      ? graphLandingSampledScenes
      : new Set(
          (parseCameraPlan(draft.html).plan?.scenes ?? [])
            .filter((scene) =>
              scene.segments.some((segment) => CAMERA_FULL_MOVES.has(segment.move)))
            .map((scene) => scene.sceneId),
        );
    for (const scene of draft.storyboard) {
      if (landingSampledScenes.has(scene.id)) continue;
      if (scene.durationSec < SPARSE_MIN_SCENE_SEC) continue;
      const sceneEnd = scene.startSec + scene.durationSec;
      const sampleAt = scene.startSec + scene.durationSec * 0.6;
      if (insideCutWindow(sampleAt)) continue;
      const coverage = await measureFramedCoverage(sampleAt, scene.id);
      if (!isSparseCoverage(coverage)) continue;
      // Fully blank scenes are the near-blank audit's finding; sparse is the
      // "content exists but is tiny" class.
      if (coverage.fraction <= 0) continue;
      const confirmAt = Math.min(sampleAt + 0.8, sceneEnd - 0.1);
      const confirmedCoverage = confirmAt > sampleAt + 0.05 && !insideCutWindow(confirmAt)
        ? await measureFramedCoverage(confirmAt, scene.id)
        : coverage;
      if (!isSparseCoverage(confirmedCoverage) || confirmedCoverage.fraction <= 0) continue;
      rawIssues.push({
        code: "camera_framed_sparse",
        severity: "warning",
        time: sampleAt,
        selector: `[data-scene="${scene.id}"]`,
        framing: {
          sceneId: scene.id,
          fraction: confirmedCoverage.fraction,
          bboxFraction: confirmedCoverage.bboxFraction,
          occupiedFraction: confirmedCoverage.occupiedFraction,
        },
        message:
          `Scene "${scene.id}" holds one framing whose visible content fills only ` +
          `${Math.round(confirmedCoverage.fraction * 100)}% of the 24x14 occupancy grid and ` +
          `${Math.round(confirmedCoverage.occupiedFraction * 100)}% painted area — a small ` +
          `subject adrift in empty space.`,
        fixHint:
          "Fill the frame: scale the composition up (hero content at 60-80% of frame width), " +
          "or develop the safe area around the subject with supporting evidence instead of " +
          "leaving it empty.",
        source: "sequences",
      });
    }

    rawIssues.push(...await (draft.declaredPrimarySelectors
      ? auditDeclaredPrimarySelectors(page, draft, seekContent, loadBearingContainment)
      : graphOwnedCamera
        ? auditCameraBlockingLandings(page, draft, seekContent, loadBearingContainment)
        : auditPrimaryMomentFocals(page, draft, seekContent, loadBearingContainment)));

    // Exit discipline (WS4): a surface whose last beat has passed still sitting
    // at full opacity over the focal element is the "assets don't disappear and
    // overlap" mess. Always advisory, bounded seeks.
    rawIssues.push(...await auditStaleAssets(page, draft, seekContent, insideCutWindow));

    // Whole-frame composition floor (WS-A3). Semantic content and an explicit
    // host environment receive credit; root/body canvas paint does not. Start
    // in audit mode so corpus calibration cannot spend a paid author attempt;
    // operators may promote the same measured finding with =block.
    if (compositionMode !== "off") {
      for (const scene of draft.storyboard) {
        if (scene.durationSec < SPARSE_MIN_SCENE_SEC) continue;
        const eligible = compositionCoverageSamples.filter((sample) =>
          sample.time >= scene.startSec + 0.2 &&
          sample.time <= scene.startSec + scene.durationSec - 0.12 &&
          !insideCutWindow(sample.time)
        );
        if (!eligible.length) continue;
        const worst = [...eligible].sort((a, b) => a.coverage - b.coverage || a.time - b.time)[0]!;
        if (worst.coverage >= COMPOSITION_COVERAGE_MIN) continue;
        rawIssues.push({
          code: "composition_frame_underfilled",
          severity: "warning",
          time: worst.time,
          selector: `[data-scene="${scene.id}"]`,
          sceneId: scene.id,
          message:
            `Scene "${scene.id}" fills only ${Math.round(worst.coverage * 100)}% of the ` +
            `whole-frame composition grid; expected at least ` +
            `${Math.round(COMPOSITION_COVERAGE_MIN * 100)}% from semantic content or a ` +
            `deliberate host environment (mode=${compositionMode}).`,
          fixHint:
            "Develop the full frame with a staged environment or enlarge/group the primary " +
            "product composition; changing only the bare canvas color earns no coverage.",
          source: "sequences",
        });
      }
    }

    // Blank-frame guard (2026-07-03 incident: a live film published with the
    // promised content never on frame). A scene is near-blank when EVERY
    // eligible sample — inside the scene body, outside cut/camera/component
    // motion windows — shows content coverage below the floor. Individual
    // near-blank scenes are repair-loop warnings; a film that is
    // systematically blank becomes a blocking error, which after bounded
    // repairs routes the create to the labeled deterministic fallback
    // instead of publishing an empty result.
    const nearBlankScenes: Array<{ scene: DirectScene; atTime: number }> = [];
    for (const scene of draft.storyboard) {
      if (scene.durationSec < NEAR_BLANK_MIN_SCENE_SEC) continue;
      const eligible = coverageSamples.filter((sample) =>
        sample.time >= scene.startSec + 0.15 &&
        sample.time <= scene.startSec + scene.durationSec - 0.15 &&
        !insideCutWindow(sample.time)
      );
      if (!eligible.length) continue;
      if (eligible.every((sample) => sample.coverage < NEAR_BLANK_COVERAGE)) {
        nearBlankScenes.push({
          scene,
          atTime: eligible[Math.floor(eligible.length / 2)]!.time,
        });
      }
    }
    for (const { scene, atTime } of nearBlankScenes) {
      rawIssues.push({
        code: "near_blank_scene",
        severity: "warning",
        time: atTime,
        selector: `[data-scene="${scene.id}"]`,
        message:
          `Scene "${scene.id}" shows no visible content (text, media, or data-part coverage ` +
          `under 0.5%) at every sampled frame — the audience sees only background.`,
        fixHint:
          "Put the scene's declared subject on frame: check that the promised element exists, " +
          "is inside the viewport (or its camera region is actually framed), and is not opacity-0.",
        source: "sequences",
      });
    }
    const blankSec = nearBlankScenes.reduce((sum, entry) => sum + entry.scene.durationSec, 0);
    const nearBlankErrors =
      blankSec >= duration * NEAR_BLANK_FILM_FRACTION ||
      nearBlankScenes.some((entry) => entry.scene.durationSec >= NEAR_BLANK_SCENE_HARD_SEC)
        ? [
            `near_blank_film: ${nearBlankScenes.length} scene(s) totalling ${blankSec.toFixed(1)}s ` +
              `render as blank frames (${nearBlankScenes.map((entry) => entry.scene.id).join(", ")}); ` +
              `the film cannot ship empty — put the storyboard's promised content on frame`,
          ]
        : [];

    // The declared-intent contract (per-scene primary subjects) replaces the
    // legacy data-layout declaration expectation. A film authored under that
    // contract is not additionally asked to annotate data-layout-* attributes
    // it never promised; every measured geometry finding still applies.
    const declaredIntentPresent = Boolean(
      draft.declaredPrimarySelectors && Object.keys(draft.declaredPrimarySelectors).length,
    );
    const routeIssues = declaredIntentPresent
      ? rawIssues.filter((issue) => issue.code !== "layout_intent_missing")
      : rawIssues;
    const issues = collapseIssues(routeIssues.filter((issue) =>
      issue.code.startsWith("interaction_") ||
      // A degraded cut's time IS its boundary window — the window suppression
      // exists for geometry heuristics sampled mid-motion, not for this
      // deliberate bind-time decision. Eye-trace findings likewise live AT
      // their boundary/beat by design and were sampled deliberately.
      issue.code === "cut_degraded" ||
      issue.code.startsWith("eye_trace") ||
      // This is deliberate landing evidence sampled at a camera/component cue.
      // Suppressing it merely because that cue sits inside a motion window made
      // hidden/zero-area primary targets invisible to QA.
      issue.code === "camera_blocking_landing" ||
      issue.code === "composition_frame_underfilled" ||
      issue.code === "composition_washed_out" ||
      !insideCutWindow(issue.time)
    )).slice(0, 80);
    const interactionIssues = issues.filter((issue) =>
      issue.code.startsWith("interaction_")
    );
    const enforceInteractions =
      slackSequencesEnvRawValue("SLACK_SEQUENCES_INTERACTION_QA")?.trim().toLowerCase() !== "audit";
    const errors = [
      ...runtime
      .filter((entry) => entry.level === "error")
      .map((entry) => `browser_runtime: ${entry.text}`),
      ...(enforceInteractions ? interactionIssues.map(formatIssue) : []),
      // A systematically blank film is not a polish heuristic: it is the one
      // visual state that is worse than the deterministic fallback.
      ...nearBlankErrors,
    ];
    const visualErrors = issues
      .filter((issue) => issue.severity === "error")
      .map(formatIssue);
    const warnings = [
      ...runtime.filter((entry) => entry.level === "warning").map((entry) => `browser_warning: ${entry.text}`),
      ...degradedCutWarnings,
      // Geometry, occlusion, overlap, and contrast are screenshot/layout
      // heuristics. They are useful repair feedback but cannot prove that an
      // authored composition is unusable, so they never become publication
      // blockers. Keep the issue's original severity in `issues` for tooling.
      ...visualErrors,
      ...(!enforceInteractions ? interactionIssues.map(formatIssue) : []),
      ...issues.filter((issue) => issue.severity === "warning").map(formatIssue),
    ];
    // E1 washout is rendered taste evidence, not a deterministic authoring
    // obligation. Keep it in `issues`/`warnings` so critic and draft ranking
    // can see its measured penalty, but do not lower strictOk or spend a paid
    // source retry on a class whose safe deterministic repair is unknowable.
    const repairWarnings = issues.filter((issue) =>
      issue.severity === "warning" &&
      issue.code !== "composition_washed_out" &&
      // Ping-pong is always advisory; the boundary jump is advisory only in
      // audit mode — both stay in `warnings` so repair prompts still see them.
      issue.code !== "eye_trace_pingpong" &&
      // Stale-asset lingering (WS4) is always advisory: overlap heuristics
      // must never block a runnable film — the plan-stage exit audit carries
      // the blocking pressure.
      issue.code !== "stale_asset_lingers" &&
      (issue.code !== "composition_frame_underfilled" || compositionMode === "block") &&
      (issue.code !== "eye_trace_jump" || eyeTrace === "block") &&
      // Kit avatar stacks overlap BY DESIGN (negative-margin monograms) —
      // a content_overlap on them is a false positive that burned a paid
      // attempt in fix-probe-4. Kit-owned deliberate overlap only; any other
      // content_overlap stays a finding.
      !(issue.code === "content_overlap" && /\.cmp-avatars/.test(issue.selector ?? "")) &&
      // A camera world plane extends beyond its scene clip BY DESIGN under
      // any pan/zoom — container_overflow on the world element itself is a
      // false positive (fix-probe-5 burned an attempt + shipped penalty on
      // three of them). Content INSIDE the world stays judged.
      !(issue.code === "container_overflow" && issue.isCameraWorld) &&
      (
        issue.source === "sequences" ||
        issue.code === "content_overlap" ||
        issue.code === "container_overflow"
      )
    );
    let guidePngBase64: string | undefined;
    if (interactionIntents.length) {
      await seekContent(interactionIntents[0]!.arriveSec);
      guidePngBase64 = await renderSpatialGuide(page, interactionIntents);
    }
    // Continuous playback evidence. It is deliberately advisory: losing this
    // evidence never rejects a runnable draft. Long measured stillness does
    // request one bounded polish pass: this is rendered evidence, not the
    // planner merely counting a declared beat that may be visually inert.
    let continuousMotion: ContinuousMotionEvidenceV1 | undefined;
    let cameraBlockingEvidence: CameraBlockingEvidenceV1 | undefined;
    const motionQuietIssues: DirectLayoutIssue[] = [];
    const motionQualityIssues: DirectLayoutIssue[] = [];
    if (continuousMotionEvidenceEnabled() && duration >= 8) {
      try {
        const environmentSceneIds = new Set(
          parseEnvironmentPlan(draft.html).plan?.scenes.map((scene) => scene.sceneId) ?? [],
        );
        continuousMotion = await captureContinuousMotionEvidence(
          page,
          draft.storyboard,
          duration,
          { width, height },
          {
            mapSeekTime: toOutputTime,
            ...(draft.declaredPrimarySelectors
              ? { declaredFocalBySceneId: draft.declaredPrimarySelectors }
              : {}),
          },
        );
        for (const window of continuousMotion.quietWindows.filter(
          (entry) =>
            entry.durationSec >= QUIET_WINDOW_REVIEW_SEC &&
            // The living-canvas contract owns ambient wallpaper, furniture,
            // and light outside the camera world. Its low-amplitude pixels can
            // sit below DOM velocity clustering while still preventing a
            // rendered freeze; never pay the source author to duplicate it.
            !environmentSceneIds.has(entry.sceneId),
        )) {
          const issue: DirectLayoutIssue = {
            code: "motion_quiet_window",
            severity: "warning",
            time: window.startSec,
            selector: `[data-scene="${window.sceneId}"]`,
            sceneId: window.sceneId,
            message:
              `Scene "${window.sceneId}" is visually still for ` +
              `${window.durationSec.toFixed(2)}s (${window.startSec.toFixed(2)}–` +
              `${window.endSec.toFixed(2)}s): no camera, component, FX, or micro-motion ` +
              `was measured.`,
            fixHint:
              "Keep the focal state readable while adding one low-amplitude typed motion " +
              "voice: operated camera hold/parallax, progress/chart development, cursor settle, " +
              "or a quiet supporting response. Do not add a looping whole-frame breathing pulse.",
            source: "sequences",
          };
          motionQuietIssues.push(issue);
          issues.push(issue);
          warnings.push(formatIssue(issue));
        }
        for (const finding of continuousMotionQualityFindings(continuousMotion, duration)) {
          const issue: DirectLayoutIssue = {
            code: finding.code,
            severity: "warning",
            time: finding.time,
            selector: `[data-scene="${finding.sceneId}"]`,
            sceneId: finding.sceneId,
            message: finding.message,
            fixHint: finding.fixHint,
            source: "sequences",
          };
          motionQualityIssues.push(issue);
          issues.push(issue);
          warnings.push(formatIssue(issue));
        }

        const blockingPlan = parseCameraPhrasePlan(draft.html);
        const continuityGraph = parseContinuityGraph(draft.html);
        if (blockingPlan && continuityGraph) {
          cameraBlockingEvidence = buildCameraBlockingEvidence(
            blockingPlan,
            continuityGraph,
            continuousMotion,
          );
          const primary = cameraBlockingEvidence.landings.filter((landing) =>
            landing.importance === "primary" && landing.measured
          );
          const anchorMiss = [...primary]
            .filter((landing) => !landing.framingTarget && landing.anchorError > 0.14)
            .sort((a, b) => b.anchorError - a.anchorError)[0];
          if (anchorMiss) {
            const issue: DirectLayoutIssue = {
              code: "camera_blocking_anchor",
              severity: "warning",
              time: anchorMiss.time,
              selector: `[data-part="${anchorMiss.target.id}"]`,
              sceneId: anchorMiss.sceneId,
              part: anchorMiss.target.id,
              message:
                `Primary blocking landing "${anchorMiss.phraseId}" misses its declared screen ` +
                `anchor by ${(anchorMiss.anchorError * 100).toFixed(1)}% of the frame diagonal ` +
                `(14% maximum).`,
              fixHint:
                "Remove the corrective pan and let the blocking route land directly on the " +
                "declared screen anchor before the readable dwell.",
              source: "sequences",
            };
            motionQualityIssues.push(issue);
            issues.push(issue);
            warnings.push(formatIssue(issue));
          }
          const movingLanding = [...primary]
            .filter((landing) => landing.speed > 0.018)
            .sort((a, b) => b.speed - a.speed)[0];
          if (movingLanding) {
            const issue: DirectLayoutIssue = {
              code: "camera_blocking_unsettled",
              severity: "warning",
              time: movingLanding.time,
              selector: `[data-part="${movingLanding.target.id}"]`,
              sceneId: movingLanding.sceneId,
              part: movingLanding.target.id,
              message:
                `Primary blocking landing "${movingLanding.phraseId}" is still moving at ` +
                `${movingLanding.speed.toFixed(3)} frame-diagonals/s (0.018 rest ceiling).`,
              fixHint:
                "Finish the route before the readable dwell; move ambient life on a background " +
                "layer instead of carrying the camera through the landing.",
              source: "sequences",
            };
            motionQualityIssues.push(issue);
            issues.push(issue);
            warnings.push(formatIssue(issue));
          }
        }
      } catch (error) {
        process.stderr.write(
          `[layout-qa] continuous motion evidence skipped: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    }
    let transitionOutgoing: TransitionOutgoingEvidence[] = [];
    try {
      transitionOutgoing = await judgeDeclaredTransitionOutgoing(page, draft, seekContent);
    } catch (error) {
      process.stderr.write(
        `[layout-qa] transition outgoing judge skipped: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
    const staticTransitionOutgoing = transitionOutgoing
      .filter((entry) => entry.verdict === "static");
    for (const transition of staticTransitionOutgoing) {
      const issue: DirectLayoutIssue = {
        code: "transition_static_outgoing",
        severity: "warning",
        time: transition.atSec,
        selector: transition.selector,
        sceneId: transition.fromScene,
        message:
          `Declared ${transition.style} transition "${transition.fromScene}" -> ` +
          `"${transition.toScene}" has a static outgoing leg between ` +
          `${transition.beforeSec.toFixed(2)}s and ${transition.afterSec.toFixed(2)}s.`,
        fixHint:
          "Make the outgoing subject visibly accelerate into the boundary; keep the host bridge " +
          "selector intact and reserve enough pre-cut lead for the movement to read.",
        source: "sequences",
      };
      motionQualityIssues.push(issue);
      issues.push(issue);
      warnings.push(formatIssue(issue));
    }

    let settleBlooms: ComponentSettleBloomEvidenceV1[] = [];
    try {
      settleBlooms = await measureComponentSettleBlooms(page, draft, seekContent);
    } catch (error) {
      process.stderr.write(
        `[layout-qa] component settle-bloom evidence skipped: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }

    let visionCriticEvidence: VisionCriticEvidenceV1 | undefined;
    if (options.captureVisualReview) {
      try {
        visionCriticEvidence = await captureVisionCriticEvidence(
          projectDir,
          visionCriticDraftHash(projectDir, draft),
          browser,
          page,
          draft.storyboard,
          parseCameraPhrasePlan(draft.html),
          seekContent,
          options.publishVisualReview !== false,
        );
      } catch (error) {
        // Taste-tail evidence is enhancement-only. A capture/codec failure
        // keeps the numeric critic pack and, ultimately, the pre-critique draft.
        process.stderr.write(
          `[layout-qa] vision critic evidence skipped: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    }

    // Rendered temporal judge — must run LAST: it drops the device scale for
    // cheap frame pairs, so every full-resolution capture is already done.
    // A judge failure is diagnostics lost, never a QA failure.
    let temporalJudge: TemporalJudgeMomentEvidence[] = [];
    try {
      temporalJudge = await judgeRenderedMoments(
        page,
        draft,
        duration,
        seekContent,
        { width, height },
      );
    } catch (error) {
      process.stderr.write(
        `[layout-qa] rendered temporal judge skipped: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
    const staticMoments = temporalJudge.filter((entry) => entry.verdict === "static");
    const staticPrimaryMoments = staticMoments.filter((entry) => entry.importance === "primary");
    for (const flat of staticMoments) {
      const issue: DirectLayoutIssue = {
        code: "moment_static_frame",
        severity: "warning",
        time: flat.atSec,
        selector: `moment:${flat.momentId}`,
        momentImportance: flat.importance,
        message:
          `moment "${flat.momentId}" (${flat.title}) claims a changed state at ${flat.atSec}s ` +
          `but rendered frames at ${flat.beforeSec}s and ${flat.afterSec}s are near-identical ` +
          `(${(flat.changedRatio * 100).toFixed(3)}% of pixels changed)`,
        fixHint:
          "make the bound evidence visibly change the frame: a larger reveal, a camera " +
          "arrival, or a component state change the viewer can actually see",
        source: "sequences",
      };
      issues.push(issue);
      warnings.push(formatIssue(issue));
    }
    // Ledger honesty: each snapped near-miss endpoint is a deterministic
    // normalization (L2-at-L4) — count it so sentinel-run.json never hides the
    // repair. Cache hits skip this (diagnostics only, same as the whole pass).
    const nearMissSnaps = interactionEvidence
      .filter((entry) => entry.normalized === "cursor_near_miss").length;
    if (nearMissSnaps > 0) {
      recordSentinelNormalization("cursor-near-miss", nearMissSnaps);
    }
    const result: DirectBrowserQaResult = {
      // The hard browser boundary is objective runtime health. Visual audit
      // findings may trigger bounded polish, but a runnable draft is always
      // publishable if those repairs fail or regress it.
      ok: errors.length === 0,
      // HyperFrames contrast warnings include intentionally low-energy
      // decorative text; report them, but do not spend model retries on them.
      strictOk:
        errors.length === 0 &&
        visualErrors.length === 0 &&
        repairWarnings.length === 0 &&
        staticPrimaryMoments.length === 0 &&
        staticTransitionOutgoing.length === 0 &&
        motionQuietIssues.length === 0 &&
        motionQualityIssues.length === 0,
      samples,
      issues,
      interactions: interactionEvidence,
      ...(loadBearingContainment.length ? { loadBearingContainment } : {}),
      ...(boundaryInventories.length ? { boundaries: boundaryInventories } : {}),
      ...(temporalJudge.length ? { temporalJudge } : {}),
      ...(transitionOutgoing.length ? { transitionOutgoing } : {}),
      ...(washoutEvidence.length ? { washoutEvidence } : {}),
      ...(continuousMotion ? { continuousMotion } : {}),
      ...(cameraBlockingEvidence ? { cameraBlockingEvidence } : {}),
      ...(settleBlooms.length ? { settleBlooms } : {}),
      ...(visionCriticEvidence ? { visionCriticEvidence } : {}),
      ...(timelineContractEvidence ? { timelineContract: timelineContractEvidence } : {}),
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      ...(guidePngBase64 ? { guidePngBase64 } : {}),
    };
    if (cacheKey) writeQaCache(projectDir, cacheKey, result);
    return result;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const runtimeErrors = runtime.filter((entry) => entry.level === "error");
    // The loaded document never registered its timeline: a runtime exception
    // aborted the compile (a component/cut/camera bind threw). The timeout is
    // the symptom; the console error is the diagnosis — name the class and
    // lead with the real exception instead of the opaque "Waiting failed".
    const bindException =
      documentLoaded && /waiting failed|waiting for function failed/i.test(rawMessage);
    const message = bindException
      ? `runtime_bind_exception: the composition threw during compile and never registered ` +
        `its timeline${
          runtimeErrors.length
            ? ` — ${runtimeErrors.slice(0, 3).map((entry) => entry.text).join(" | ")}`
            : ` (no console error was captured; the compile likely hung)`
        }`
      : rawMessage.startsWith("timeline_contract:")
        ? rawMessage
        : `browser validate/layout inspect failed: ${rawMessage}`;
    const infrastructureFault =
      !documentLoaded ||
      (!bindException &&
        /target closed|session closed|protocol error|browser.*disconnect|out of memory|ENOMEM/i
          .test(message));
    const runtimeDetail = runtime
      .slice(0, 5)
      .map((entry) => `${entry.level}: ${entry.text}`)
      .join(" | ");
    return {
      ok: false,
      strictOk: false,
      ...(infrastructureFault ? { infraError: message } : {}),
      samples: [],
      issues: [],
      interactions: [],
      errors: [
        bindException
          ? message
          : `${message}${runtimeDetail ? ` | ${runtimeDetail}` : ""}`,
      ],
      warnings: [],
      ...(timelineContractEvidence ? { timelineContract: timelineContractEvidence } : {}),
    };
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
