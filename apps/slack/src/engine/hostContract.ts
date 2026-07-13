/**
 * Shared metadata/capability seam for host-owned composition contracts.
 *
 * Adapters delegate to the existing contract functions. The direct
 * publication gate and runtime staging execute through this registry;
 * compositionRunner retains the load-bearing injection order while its
 * individual stages consume the same adapters.
 */
import type { DirectScene } from "./directComposition.ts";
import {
  CUT_RUNTIME_FILE,
  CUT_RUNTIME_VERSION,
  cutRuntimeHash,
  cutRuntimeSource,
  parseCutPlan,
  validateCutContract,
  type CutPlanV1,
} from "./cutContract.ts";
import {
  CAMERA_RUNTIME_FILE,
  CAMERA_RUNTIME_VERSION,
  cameraRuntimeHash,
  cameraRuntimeSource,
  injectCameraRuntimeTag,
  parseCameraPlan,
  validateCameraContract,
  type CameraPlanV1,
} from "./cameraContract.ts";
import {
  CONTINUITY_RUNTIME_FILE,
  CONTINUITY_RUNTIME_VERSION,
  continuityRuntimeHash,
  continuityRuntimeSource,
  injectContinuityRuntimeTag,
  parseContinuityGraph,
  type ContinuityGraphV1,
} from "./continuityGraph.ts";
import {
  COMPONENT_KIT_FILE,
  COMPONENT_KIT_VERSION,
  COMPONENT_RUNTIME_FILE,
  COMPONENT_RUNTIME_VERSION,
  componentKitHash,
  componentKitSource,
  componentRuntimeHash,
  componentRuntimeSource,
  injectComponentKit,
  injectComponentRuntimeTag,
  parseComponentPlan,
  validateComponentContract,
  type ComponentPlanV1,
} from "./componentContract.ts";
import {
  INTERACTION_RUNTIME_FILE,
  INTERACTION_RUNTIME_VERSION,
  interactionRuntimeHash,
  interactionRuntimeSource,
  parseInteractionPlan,
  validateInteractionContract,
  type InteractionPlanV1,
} from "./interactionContract.ts";
import {
  TIME_RUNTIME_FILE,
  TIME_RUNTIME_VERSION,
  parseTimeRampPlan,
  timeRampRuntimeHash,
  timeRampRuntimeSource,
  validateTimeRampContract,
  type TimeRampPlanV1,
} from "./timeRamp.ts";
import {
  FX_RUNTIME_FILE,
  FX_RUNTIME_VERSION,
  fxRuntimeHash,
  fxRuntimeSource,
  parseFxPlan,
  validateFxContract,
  type FxPlanV1,
} from "./fxContract.ts";
import {
  ASSET_RUNTIME_FILE,
  ASSET_RUNTIME_VERSION,
  assetRuntimeHash,
  assetRuntimeSource,
  parseAssetPlan,
  validateAssetContract,
  type AssetPlanV1,
} from "./assetRuntime.ts";
import {
  ENVIRONMENT_KIT_FILE,
  ENVIRONMENT_KIT_VERSION,
  ENVIRONMENT_RUNTIME_FILE,
  ENVIRONMENT_RUNTIME_VERSION,
  environmentKitHash,
  environmentKitSource,
  environmentRuntimeHash,
  environmentRuntimeSource,
  injectEnvironmentContract,
  injectEnvironmentKit,
  injectEnvironmentRuntimeTag,
  parseEnvironmentPlan,
  stageEnvironmentAssets,
  type EnvironmentInjectionResult,
  type EnvironmentPlanV1,
  type EnvironmentStageResult,
} from "./environmentContract.ts";

export type HostContractId =
  | "cut"
  | "camera"
  | "continuity"
  | "component"
  | "interaction"
  | "time"
  | "fx"
  | "asset"
  | "environment";

/** Common publication result. Findings are the legacy validator's errors. */
export interface ContractResult {
  ok: boolean;
  findings: string[];
  warnings: string[];
  repairs: string[];
}

export interface ContractParseResult<TPlan> extends ContractResult {
  plan?: TPlan;
}

export interface HostContractValidationContext {
  html: string;
  scenes: DirectScene[];
  /** The direct gate skips interaction validation until duration is known. */
  durationSec?: number;
}

/** A versioned file whose bytes and digest come from the host repository. */
export interface HostContractArtifact {
  readonly version: number;
  readonly file: string;
  readonly source: () => string;
  readonly hash: () => string;
  /** Canonical, idempotent document injection for this file. */
  readonly inject: (html: string) => string;
}

export interface HostContractStageResult {
  readonly files: readonly string[];
}

export interface HostContract<
  Id extends HostContractId,
  TPlan,
  TPlanInjection extends { html: string } = { html: string },
  TStage extends HostContractStageResult = HostContractStageResult,
>
  extends HostContractArtifact {
  readonly id: Id;
  readonly parse: (html: string) => ContractParseResult<TPlan>;
  readonly validate: (
    plan: TPlan | undefined,
    context: HostContractValidationContext,
  ) => ContractResult;
  /** Optional host-owned JSON/markup injection in addition to the runtime tag. */
  readonly injectPlan?: (html: string, plan: TPlan) => TPlanInjection;
  /** Optional inline CSS companion. */
  readonly kit?: HostContractArtifact;
  /** Optional project-file staging owned by this contract. */
  readonly stage?: (projectDir: string, plan: TPlan) => TStage;
}

export interface HostContractPlanMap {
  cut: CutPlanV1;
  camera: CameraPlanV1;
  continuity: ContinuityGraphV1;
  component: ComponentPlanV1;
  interaction: InteractionPlanV1;
  time: TimeRampPlanV1;
  fx: FxPlanV1;
  asset: AssetPlanV1;
  environment: EnvironmentPlanV1;
}

export interface HostContractPlanInjectionMap {
  cut: { html: string };
  camera: { html: string };
  continuity: { html: string };
  component: { html: string };
  interaction: { html: string };
  time: { html: string };
  fx: { html: string };
  asset: { html: string };
  environment: EnvironmentInjectionResult;
}

export interface HostContractStageResultMap {
  cut: HostContractStageResult;
  camera: HostContractStageResult;
  continuity: HostContractStageResult;
  component: HostContractStageResult;
  interaction: HostContractStageResult;
  time: HostContractStageResult;
  fx: HostContractStageResult;
  asset: HostContractStageResult;
  environment: EnvironmentStageResult;
}

export type HostContractFor<Id extends HostContractId> =
  HostContract<
    Id,
    HostContractPlanMap[Id],
    HostContractPlanInjectionMap[Id],
    HostContractStageResultMap[Id]
  >;

export type RegisteredHostContract = {
  [Id in HostContractId]: HostContractFor<Id>;
}[HostContractId];

type LegacyParseResult<TPlan> = { plan?: TPlan; errors: string[] };
type LegacyContractResult = { errors: string[]; warnings?: string[] };

function parseResult<TPlan>(legacy: LegacyParseResult<TPlan>): ContractParseResult<TPlan> {
  return {
    ok: legacy.errors.length === 0,
    findings: [...legacy.errors],
    warnings: [],
    repairs: [],
    ...(legacy.plan !== undefined ? { plan: legacy.plan } : {}),
  };
}

function contractResult(legacy: LegacyContractResult): ContractResult {
  return {
    ok: legacy.errors.length === 0,
    findings: [...legacy.errors],
    warnings: [...(legacy.warnings ?? [])],
    repairs: [],
  };
}

/**
 * The legacy interaction/cut/time/fx/asset injectors use this exact GSAP
 * anchor inline. Keeping it here lets their adapters expose the same
 * idempotent operation without moving orchestration into the registry.
 */
function injectRuntimeAfterGsap(file: string, html: string): string {
  if (html.includes(`src="${file}"`) || html.includes(`src='${file}'`)) return html;
  return html.replace(
    /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
    `$1\n<script src="${file}"></script>`,
  );
}

function runtimeArtifact(
  version: number,
  file: string,
  source: () => string,
  hash: () => string,
  inject: (html: string) => string = (html) => injectRuntimeAfterGsap(file, html),
): HostContractArtifact {
  return Object.freeze({ version, file, source, hash, inject });
}

function defineHostContract<
  Id extends HostContractId,
  TPlan,
  TPlanInjection extends { html: string } = { html: string },
  TStage extends HostContractStageResult = HostContractStageResult,
>(
  contract: HostContract<Id, TPlan, TPlanInjection, TStage>,
): HostContract<Id, TPlan, TPlanInjection, TStage> {
  return Object.freeze(contract);
}

const cutRuntime = runtimeArtifact(
  CUT_RUNTIME_VERSION,
  CUT_RUNTIME_FILE,
  cutRuntimeSource,
  cutRuntimeHash,
);

export const CUT_HOST_CONTRACT = defineHostContract<"cut", CutPlanV1>({
  id: "cut",
  ...cutRuntime,
  parse: (html) => parseResult(parseCutPlan(html)),
  validate: (_plan, context) => contractResult(validateCutContract(context.html, context.scenes)),
});

const cameraRuntime = runtimeArtifact(
  CAMERA_RUNTIME_VERSION,
  CAMERA_RUNTIME_FILE,
  cameraRuntimeSource,
  cameraRuntimeHash,
  injectCameraRuntimeTag,
);

export const CAMERA_HOST_CONTRACT = defineHostContract<"camera", CameraPlanV1>({
  id: "camera",
  ...cameraRuntime,
  parse: (html) => parseResult(parseCameraPlan(html)),
  validate: (_plan, context) => contractResult(validateCameraContract(context.html, context.scenes)),
});

const continuityRuntime = runtimeArtifact(
  CONTINUITY_RUNTIME_VERSION,
  CONTINUITY_RUNTIME_FILE,
  continuityRuntimeSource,
  continuityRuntimeHash,
  injectContinuityRuntimeTag,
);

export const CONTINUITY_HOST_CONTRACT = defineHostContract<
  "continuity",
  ContinuityGraphV1
>({
  id: "continuity",
  ...continuityRuntime,
  // The legacy parser intentionally treats absence and malformed JSON alike.
  parse: (html) => parseResult({ plan: parseContinuityGraph(html), errors: [] }),
  // Continuity currently has no publication gate. This explicit no-op keeps
  // the common lifecycle total without silently adding a new veto.
  validate: () => contractResult({ errors: [], warnings: [] }),
});

const componentRuntime = runtimeArtifact(
  COMPONENT_RUNTIME_VERSION,
  COMPONENT_RUNTIME_FILE,
  componentRuntimeSource,
  componentRuntimeHash,
  injectComponentRuntimeTag,
);

export const COMPONENT_HOST_CONTRACT = defineHostContract<"component", ComponentPlanV1>({
  id: "component",
  ...componentRuntime,
  parse: (html) => parseResult(parseComponentPlan(html)),
  validate: (_plan, context) =>
    contractResult(validateComponentContract(context.html, context.scenes)),
  kit: runtimeArtifact(
    COMPONENT_KIT_VERSION,
    COMPONENT_KIT_FILE,
    componentKitSource,
    componentKitHash,
    injectComponentKit,
  ),
});

const interactionRuntime = runtimeArtifact(
  INTERACTION_RUNTIME_VERSION,
  INTERACTION_RUNTIME_FILE,
  interactionRuntimeSource,
  interactionRuntimeHash,
);

export const INTERACTION_HOST_CONTRACT = defineHostContract<
  "interaction",
  InteractionPlanV1
>({
  id: "interaction",
  ...interactionRuntime,
  parse: (html) => parseResult(parseInteractionPlan(html)),
  validate: (_plan, context) => context.durationSec === undefined
    ? contractResult({ errors: [], warnings: [] })
    : contractResult(validateInteractionContract(
      context.html,
      context.scenes,
      context.durationSec,
    )),
});

const timeRuntime = runtimeArtifact(
  TIME_RUNTIME_VERSION,
  TIME_RUNTIME_FILE,
  timeRampRuntimeSource,
  timeRampRuntimeHash,
);

export const TIME_HOST_CONTRACT = defineHostContract<"time", TimeRampPlanV1>({
  id: "time",
  ...timeRuntime,
  parse: (html) => parseResult(parseTimeRampPlan(html)),
  validate: (_plan, context) =>
    contractResult(validateTimeRampContract(context.html, context.scenes)),
});

const fxRuntime = runtimeArtifact(
  FX_RUNTIME_VERSION,
  FX_RUNTIME_FILE,
  fxRuntimeSource,
  fxRuntimeHash,
);

export const FX_HOST_CONTRACT = defineHostContract<"fx", FxPlanV1>({
  id: "fx",
  ...fxRuntime,
  parse: (html) => parseResult(parseFxPlan(html)),
  validate: (_plan, context) => contractResult(validateFxContract(context.html, context.scenes)),
});

const assetRuntime = runtimeArtifact(
  ASSET_RUNTIME_VERSION,
  ASSET_RUNTIME_FILE,
  assetRuntimeSource,
  assetRuntimeHash,
);

export const ASSET_HOST_CONTRACT = defineHostContract<"asset", AssetPlanV1>({
  id: "asset",
  ...assetRuntime,
  parse: (html) => parseResult(parseAssetPlan(html)),
  // Validation retains the legacy byte-exact storyboard equality check.
  validate: (_plan, context) =>
    contractResult(validateAssetContract(context.html, context.scenes)),
});

const environmentRuntime = runtimeArtifact(
  ENVIRONMENT_RUNTIME_VERSION,
  ENVIRONMENT_RUNTIME_FILE,
  environmentRuntimeSource,
  environmentRuntimeHash,
  injectEnvironmentRuntimeTag,
);

export const ENVIRONMENT_HOST_CONTRACT = defineHostContract<
  "environment",
  EnvironmentPlanV1,
  EnvironmentInjectionResult,
  EnvironmentStageResult
>({
  id: "environment",
  ...environmentRuntime,
  parse: (html) => parseResult(parseEnvironmentPlan(html)),
  // Direct validation currently treats environment parser errors as the
  // entire environment gate; do not invent equality/runtime checks here.
  validate: (_plan, context) => contractResult(parseEnvironmentPlan(context.html)),
  injectPlan: injectEnvironmentContract,
  kit: runtimeArtifact(
    ENVIRONMENT_KIT_VERSION,
    ENVIRONMENT_KIT_FILE,
    environmentKitSource,
    environmentKitHash,
    injectEnvironmentKit,
  ),
  stage: stageEnvironmentAssets,
});

/** Mirrors the existing staged-runtime catalog; execution order remains runner-owned. */
export const HOST_CONTRACTS = Object.freeze([
  INTERACTION_HOST_CONTRACT,
  CUT_HOST_CONTRACT,
  CAMERA_HOST_CONTRACT,
  CONTINUITY_HOST_CONTRACT,
  COMPONENT_HOST_CONTRACT,
  TIME_HOST_CONTRACT,
  FX_HOST_CONTRACT,
  ASSET_HOST_CONTRACT,
  ENVIRONMENT_HOST_CONTRACT,
] as const satisfies readonly RegisteredHostContract[]);

export const HOST_CONTRACT_REGISTRY: ReadonlyMap<HostContractId, RegisteredHostContract> =
  new Map(HOST_CONTRACTS.map((contract) => [contract.id, contract]));

/** Typed lookup without exposing registry construction casts to callers. */
export function hostContract<Id extends HostContractId>(id: Id): HostContractFor<Id> {
  const contract = HOST_CONTRACT_REGISTRY.get(id);
  if (!contract) throw new Error(`unknown host contract "${id}"`);
  return contract as HostContractFor<Id>;
}

/** Execute the shared parse/validate lifecycle without leaking union casts. */
export function runHostContractLifecycle<Id extends HostContractId>(
  id: Id,
  context: HostContractValidationContext,
): {
  parsed: ContractParseResult<HostContractPlanMap[Id]>;
  validation: ContractResult;
} {
  const contract = hostContract(id);
  const parsed = contract.parse(context.html);
  return {
    parsed,
    validation: contract.validate(parsed?.plan, context),
  };
}
