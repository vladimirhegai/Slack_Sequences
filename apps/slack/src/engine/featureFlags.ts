/**
 * Central inventory for the Slack app's `SLACK_SEQUENCES_*` environment
 * surface. Existing call sites may still read their variables directly while
 * WS-F4 migrates incrementally; this catalog is the closed-world contract and
 * the source-scan test prevents an unclassified read from landing.
 */

export type FeatureFlagResolutionV1 =
  | { kind: "opt-out" }
  | { kind: "enum"; rawValues: Readonly<Record<string, string>> };

export interface FeatureFlagDefinitionV1 {
  kind: "feature";
  defaultValue: string;
  values: readonly string[];
  owner: string;
  description: string;
  rollback: string;
  resolution: FeatureFlagResolutionV1;
}

export interface OperationalEnvDefinitionV1 {
  kind: "operational";
  defaultValue: string;
  values: readonly string[];
  owner: string;
  description: string;
  rollback: string;
  /** Why this is configuration/tuning rather than a feature switch. */
  exceptionReason: string;
}

function optOut(
  owner: string,
  description: string,
  rollback = "Set to 0 to disable the feature and restore the previous path.",
): FeatureFlagDefinitionV1 {
  return {
    kind: "feature",
    defaultValue: "on",
    values: ["on", "off"],
    owner,
    description,
    rollback,
    resolution: { kind: "opt-out" },
  };
}

function mode(
  defaultValue: string,
  values: readonly string[],
  rawValues: Readonly<Record<string, string>>,
  owner: string,
  description: string,
  rollback: string,
): FeatureFlagDefinitionV1 {
  return {
    kind: "feature",
    defaultValue,
    values,
    owner,
    description,
    rollback,
    resolution: { kind: "enum", rawValues },
  };
}

function operational(
  defaultValue: string,
  values: readonly string[],
  owner: string,
  description: string,
  rollback: string,
  exceptionReason: string,
): OperationalEnvDefinitionV1 {
  return {
    kind: "operational",
    defaultValue,
    values,
    owner,
    description,
    rollback,
    exceptionReason,
  };
}

/** Behavior switches. Every entry has an explicit rollback posture. */
export const FEATURE_FLAG_REGISTRY = {
  SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK: mode(
    "off",
    ["off", "on"],
    { "0": "off", off: "off", "1": "on", on: "on" },
    "orchestrator",
    "Permit an explicitly requested model-free proof film after creative authoring is exhausted.",
    "Leave off for ordinary Slack runs; set to 1 only for an operator-requested proof-film drill.",
  ),
  SLACK_SEQUENCES_AUTHOR_ROUTE: mode(
    "luna-direct",
    ["luna-direct", "legacy-provider"],
    {
      luna: "luna-direct",
      "luna-direct": "luna-direct",
      legacy: "legacy-provider",
      "legacy-provider": "legacy-provider",
      openrouter: "legacy-provider",
    },
    "orchestrator",
    "Choose the single-session Luna director or the frozen legacy provider committee.",
    "Set to legacy-provider and configure SLACK_SEQUENCES_PROVIDER for an explicit rollback.",
  ),
  SLACK_SEQUENCES_ASSETS: optOut(
    "asset contract",
    "Expose and inject the host-owned parametric asset library through plugin rails.",
  ),
  SLACK_SEQUENCES_COMPOSITION: mode(
    "audit",
    ["off", "audit", "block"],
    { "0": "off", off: "off", audit: "audit", block: "block" },
    "browser QA",
    "Measure the whole-frame semantic/environment composition floor.",
    "Set to audit for report-only calibration or 0/off to disable the audit.",
  ),
  SLACK_SEQUENCES_CONCEPT_PASS: optOut(
    "planning pipeline",
    "Run the cached concept/arc direction pass before storyboard expansion.",
  ),
  SLACK_SEQUENCES_CONTINUITY_GRAPH: optOut(
    "continuity + camera blocking",
    "Compile cross-shot entity continuity and graph-owned camera blocking by default.",
  ),
  SLACK_SEQUENCES_CONTINUOUS_MOTION: optOut(
    "browser QA",
    "Capture advisory continuous-playback focal, settle, and motion-quality evidence.",
  ),
  SLACK_SEQUENCES_CREATIVE_CRITIC: optOut(
    "continuity critic",
    "Run the post-author continuity critic for eligible whole-film creates.",
  ),
  SLACK_SEQUENCES_CRITIC_SKIP_CLEAN: optOut(
    "Sentinel critic economy",
    "Skip the critic for pristine or repeatedly stagnant banked drafts.",
    "Set to 0 to restore always-run critic behavior.",
  ),
  SLACK_SEQUENCES_CRITIC_SLOT_REPAIR: optOut(
    "Sentinel scene slots",
    "Route scene-addressable critic directives through bounded slot repair.",
    "Set to 0 to restore the whole-document critique patch.",
  ),
  SLACK_SEQUENCES_CUT_DISCOVERY: optOut(
    "cut contract",
    "Upgrade one mechanically proven silhouette rhyme to a matched cut.",
  ),
  SLACK_SEQUENCES_DIRECTION_SCORE: optOut(
    "direction score",
    "Let automatic camera/FX consumers follow the persisted direction score.",
  ),
  SLACK_SEQUENCES_ENVIRONMENT: optOut(
    "environment contract",
    "Inject the default-on host-owned living canvas/environment layer.",
  ),
  SLACK_SEQUENCES_EYE_TRACE: mode(
    "block",
    ["off", "audit", "block"],
    { "0": "off", off: "off", audit: "audit", block: "block" },
    "browser QA",
    "Measure boundary eye-trace continuity; audit reports without strictOk pressure.",
    "Set to audit for report-only operation or 0/off to disable.",
  ),
  SLACK_SEQUENCES_HEDGED_REQUESTS: optOut(
    "provider transport",
    "Launch a bounded delayed duplicate for eligible OpenRouter authoring calls.",
  ),
  SLACK_SEQUENCES_INTERACTION_QA: mode(
    "block",
    ["audit", "block"],
    { audit: "audit", block: "block" },
    "browser QA",
    "Choose whether interaction-time findings are enforced or report-only.",
    "Set to audit for report-only interaction QA; there is currently no off path.",
  ),
  SLACK_SEQUENCES_LUNA_CRAFT_CAPSULE: optOut(
    "Luna director route",
    "Embed the golden reference film (technique-only, appearance-fenced) in the Luna direction and build turns.",
    "Set to 0 to withhold the reference film and restore the text-only motion principles.",
  ),
  SLACK_SEQUENCES_PLUGINS: optOut(
    "plugin contract",
    "Lower and inject host-owned parameterized plugin generators.",
  ),
  SLACK_SEQUENCES_QA_CACHE: optOut(
    "browser QA",
    "Reuse successful content-hash browser-QA results for byte-identical drafts.",
  ),
  SLACK_SEQUENCES_RECIPES: optOut(
    "recipe contract",
    "Offer, lower, and inject proven Recipe Studio fragments.",
  ),
  SLACK_SEQUENCES_RENDER_SUPERSAMPLE: mode(
    "auto",
    ["off", "auto", "forced"],
    { "0": "off", auto: "auto", "1": "forced" },
    "render pipeline",
    "Supersample supported canvases; auto limits the path to HD renders.",
    "Set to 0 to disable supersampling for every quality tier.",
  ),
  SLACK_SEQUENCES_SENTINEL_SKELETON: optOut(
    "Sentinel scaffold",
    "Emit host-owned scene skeletons so required authoring structure exists up front.",
    "Set to 0 to force-revert to bare author-owned shells.",
  ),
  SLACK_SEQUENCES_SENTINEL_SLOTS: optOut(
    "Sentinel scene slots",
    "Author, truncate, validate, and repair source by named scene slots.",
    "Set to 0 to restore whole-document authoring.",
  ),
  SLACK_SEQUENCES_SHAPE_HINT: optOut(
    "planning pipeline",
    "Run the bounded light-model storyboard-shape selector.",
  ),
  SLACK_SEQUENCES_SHARED_PLANNING_CACHE: optOut(
    "planning pipeline",
    "Reuse validated planning artifacts across immutable sibling job directories.",
  ),
  SLACK_SEQUENCES_STORYBOARD_SCENE_REPAIR: optOut(
    "Sentinel storyboard repair",
    "Replace an eligible whole-plan retry with one locked-envelope scene repair.",
    "Set to 0 to restore the whole-plan-only storyboard ladder.",
  ),
  SLACK_SEQUENCES_TEMPORAL_JUDGE: optOut(
    "browser QA",
    "Render before/after moment frames and detect visually static promised changes.",
  ),
  SLACK_SEQUENCES_USE_MCP: optOut(
    "orchestrator",
    "Use the internal Sequences stdio MCP for mutation, preview, and render operations.",
    "Set to 0 to use the diagnostic in-process execution path.",
  ),
  SLACK_SEQUENCES_VISION_CRITIC: optOut(
    "continuity critic",
    "Attach bounded rendered strip/blocking evidence to the post-author taste-tail critic.",
    "Set to 0 to retain the text-only continuity critic.",
  ),
} as const satisfies Record<string, FeatureFlagDefinitionV1>;

/**
 * Non-feature operational inputs. These are explicitly classified exceptions:
 * they tune/select an already-enabled path and do not independently expose a
 * behavior branch.
 */
export const OPERATIONAL_ENV_REGISTRY = {
  SLACK_SEQUENCES_AUTHOR_THINKING: operational(
    "none",
    ["auto", "none", "enabled", "minimal", "low", "medium", "high", "xhigh", "max"],
    "model policy",
    "Override full-document source-author reasoning effort.",
    "Unset to restore none.",
    "Reasoning-effort tuning for an existing author call, not a feature switch.",
  ),
  SLACK_SEQUENCES_CREATIVE_MODEL: operational(
    "provider default (OpenRouter: z-ai/glm-5.2)",
    ["<model id>", "primary"],
    "model policy",
    "Select the shared creative-director model used by bounded planning helpers.",
    "Unset to restore the provider-specific creative model.",
    "Model selection changes an existing call target without enabling a code path.",
  ),
  SLACK_SEQUENCES_DATA_DIR: operational(
    "apps/slack/.data",
    ["<absolute or relative directory>"],
    "project storage",
    "Override the project/job data root.",
    "Unset to restore apps/slack/.data.",
    "Filesystem location configuration, not behavioral rollout control.",
  ),
  SLACK_SEQUENCES_EARLY_LEAST_BAD_MAX_PENALTY: operational(
    "4",
    ["<number >= 0>"],
    "Sentinel attempt economy",
    "Tune the maximum penalty eligible for bounded early least-bad shipping.",
    "Unset to restore 4.",
    "A numeric threshold for an existing policy path, not a feature toggle.",
  ),
  SLACK_SEQUENCES_FRAME_MODEL: operational(
    "provider creative model",
    ["<model id>", "primary"],
    "frame design",
    "Select the model used for the compact frame-design choice.",
    "Unset to restore the shared creative model.",
    "Model selection for an existing call, not a feature switch.",
  ),
  SLACK_SEQUENCES_HEDGE_DELAY_MS: operational(
    "25000",
    ["<milliseconds >= 0>"],
    "provider transport",
    "Tune the delay before an eligible request hedge launches.",
    "Unset to restore 25000ms.",
    "Latency tuning; SLACK_SEQUENCES_HEDGED_REQUESTS owns enablement.",
  ),
  SLACK_SEQUENCES_HEDGE_MAX_PER_RUN: operational(
    "2",
    ["<integer >= 0>"],
    "provider transport",
    "Bound the number of hedged calls in one run.",
    "Unset to restore 2.",
    "Budget tuning; SLACK_SEQUENCES_HEDGED_REQUESTS owns enablement.",
  ),
  SLACK_SEQUENCES_HEDGE_SOURCE_AUTHOR_RESERVE: operational(
    "1",
    ["<integer >= 0>"],
    "Sentinel telemetry",
    "Reserve hedge budget for the expensive source-author stage.",
    "Unset to restore 1.",
    "Budget allocation for an enabled hedge system, not a feature switch.",
  ),
  SLACK_SEQUENCES_LIGHT_MODEL: operational(
    "provider default (OpenRouter: deepseek/deepseek-v4-flash)",
    ["<model id>", "primary"],
    "model policy",
    "Select the bounded helper model used for structural shape work.",
    "Unset to restore the provider-specific light model.",
    "Model selection for an existing helper call, not a feature switch.",
  ),
  SLACK_SEQUENCES_LUNA_WORKER_TOKEN: operational(
    "unset",
    ["<shared bearer secret>"],
    "Luna worker transport",
    "Authenticate Slack-to-worker requests on Railway's private network.",
    "Rotate the secret on both services; never place it in source or logs.",
    "A transport credential for an already-selected author route, not a rollout switch.",
  ),
  SLACK_SEQUENCES_LUNA_WORKER_URL: operational(
    "http://codex-worker.railway.internal:3000",
    ["<http(s) URL>"],
    "Luna worker transport",
    "Address the private Codex worker used by the Luna director route.",
    "Point back to the previous healthy worker deployment.",
    "Service discovery for an already-selected author route, not a rollout switch.",
  ),
  SLACK_SEQUENCES_LUNA_JOB_TIMEOUT_MS: operational(
    "1800000",
    ["<milliseconds >= 30000>"],
    "Luna worker transport",
    "Bound one initial, review, or revision Codex turn.",
    "Unset to restore the worker-aligned thirty-minute bound.",
    "A request deadline for an already-selected author route, not a rollout switch.",
  ),
  SLACK_SEQUENCES_PROVIDER: operational(
    "legacy rollback only (auto provider detection)",
    ["<registered provider id>"],
    "orchestrator",
    "Select the provider used only by the explicit legacy-provider author route.",
    "Unset to restore legacy provider auto-detection.",
    "Provider selection configures the rollback route; SLACK_SEQUENCES_AUTHOR_ROUTE owns behavior.",
  ),
  SLACK_SEQUENCES_RECIPES_DIR: operational(
    "skills/sequences-recipes",
    ["<directory>"],
    "Recipe Studio",
    "Point the studio gate at a staged recipe library root.",
    "Unset in production to restore the exported recipe library.",
    "Studio-only filesystem injection used to test content through the real path.",
  ),
  SLACK_SEQUENCES_RECOVER_REJECTED_STORYBOARD: operational(
    "unset",
    ["latest", "storyboard-N-rejected.raw.txt"],
    "storyboard diagnostics",
    "Explicitly resume one already-paid rejected storyboard artifact.",
    "Unset after the one recovery run.",
    "A fail-loud operator recovery selector, not a generally enabled feature.",
  ),
  SLACK_SEQUENCES_REPAIR_MODEL: operational(
    "primary model",
    ["<model id>"],
    "source repair",
    "Override the model used for compact deterministic-finding source patches.",
    "Unset to restore the configured primary model.",
    "Model selection for an existing repair rung, not a feature switch.",
  ),
  SLACK_SEQUENCES_SOURCE_RESCUE_MODEL: operational(
    "provider default (OpenRouter: tencent/hy3-preview)",
    ["<model id>", "0", "none", "off"],
    "model policy",
    "Select or disable the independent source-author rescue model.",
    "Unset to restore the provider default; 0/none/off disables the rescue rung.",
    "Model/rung selection is operational policy; fallback enablement is owned separately.",
  ),
  SLACK_SEQUENCES_SOURCE_RESCUE_THINKING: operational(
    "none",
    ["auto", "none", "enabled", "minimal", "low", "medium", "high", "xhigh", "max"],
    "model policy",
    "Override source-rescue reasoning effort.",
    "Unset to restore none.",
    "Reasoning-effort tuning for an existing rescue call.",
  ),
  SLACK_SEQUENCES_STORYBOARD_MODEL: operational(
    "provider creative model",
    ["<model id>", "primary"],
    "storyboard planner",
    "Select the required storyboard-director model.",
    "Unset to restore the shared creative model.",
    "Model selection for the required planning stage, not a feature switch.",
  ),
  SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL: operational(
    "provider default (OpenRouter: tencent/hy3-preview)",
    ["<model id>", "0", "none", "off"],
    "model policy",
    "Select or disable the independent storyboard rescue model.",
    "Unset to restore the provider default; 0/none/off disables the rescue rung.",
    "Model/rung selection is operational policy rather than general feature rollout.",
  ),
  SLACK_SEQUENCES_STORYBOARD_RESCUE_THINKING: operational(
    "medium",
    ["auto", "none", "enabled", "minimal", "low", "medium", "high", "xhigh", "max"],
    "storyboard planner",
    "Override storyboard-rescue reasoning effort.",
    "Unset to restore medium.",
    "Reasoning-effort tuning for an existing rescue call.",
  ),
  SLACK_SEQUENCES_STORYBOARD_SCENE_REPAIR_THINKING: operational(
    "minimal",
    ["auto", "none", "enabled", "minimal", "low", "medium", "high", "xhigh", "max"],
    "Sentinel storyboard repair",
    "Override scene-scoped storyboard-repair reasoning effort.",
    "Unset to restore minimal.",
    "Reasoning tuning; SLACK_SEQUENCES_STORYBOARD_SCENE_REPAIR owns enablement.",
  ),
  SLACK_SEQUENCES_STORYBOARD_THINKING: operational(
    "provider-dependent (OpenRouter creative: medium; otherwise none)",
    ["auto", "none", "enabled", "minimal", "low", "medium", "high", "xhigh", "max"],
    "storyboard planner",
    "Override the primary storyboard-director reasoning effort.",
    "Unset to restore the provider/model-derived default.",
    "Reasoning-effort tuning for the required planning stage.",
  ),
  SLACK_SEQUENCES_STREAM_IDLE_TIMEOUT_MS: operational(
    "90000",
    ["<milliseconds >= 10000>"],
    "provider transport",
    "Tune the streaming idle watchdog for authoring calls.",
    "Unset to restore 90000ms.",
    "Transport timeout tuning, not a feature switch.",
  ),
} as const satisfies Record<string, OperationalEnvDefinitionV1>;

export type FeatureFlagName = keyof typeof FEATURE_FLAG_REGISTRY;
export type OperationalEnvName = keyof typeof OPERATIONAL_ENV_REGISTRY;
export type SlackSequencesEnvName = FeatureFlagName | OperationalEnvName;
export type SlackSequencesEnvDefinitionV1 = FeatureFlagDefinitionV1 | OperationalEnvDefinitionV1;

export interface ResolvedFeatureFlagV1<Name extends FeatureFlagName = FeatureFlagName> {
  name: Name;
  value: string;
  rawValue?: string;
  defaulted: boolean;
  valid: boolean;
}

export interface ResolvedOperationalEnvV1<Name extends OperationalEnvName = OperationalEnvName> {
  name: Name;
  value: string;
  rawValue?: string;
  defaulted: boolean;
}

export type FeatureFlagSnapshotV1 = {
  [Name in FeatureFlagName]: ResolvedFeatureFlagV1<Name>;
};

export type OperationalEnvSnapshotV1 = {
  [Name in OperationalEnvName]: ResolvedOperationalEnvV1<Name>;
};

export interface SlackSequencesEnvSnapshotV1 {
  features: FeatureFlagSnapshotV1;
  operational: OperationalEnvSnapshotV1;
}

export type SlackSequencesEnvSource = Readonly<Record<string, string | undefined>>;

export const REGISTERED_SLACK_SEQUENCES_ENV_NAMES: readonly SlackSequencesEnvName[] =
  Object.freeze([
    ...Object.keys(FEATURE_FLAG_REGISTRY),
    ...Object.keys(OPERATIONAL_ENV_REGISTRY),
  ].sort() as SlackSequencesEnvName[]);

export function isFeatureFlagName(name: string): name is FeatureFlagName {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAG_REGISTRY, name);
}

export function isOperationalEnvName(name: string): name is OperationalEnvName {
  return Object.prototype.hasOwnProperty.call(OPERATIONAL_ENV_REGISTRY, name);
}

export function featureFlagDefinition<Name extends FeatureFlagName>(
  name: Name,
): (typeof FEATURE_FLAG_REGISTRY)[Name] {
  return FEATURE_FLAG_REGISTRY[name];
}

export function operationalEnvDefinition<Name extends OperationalEnvName>(
  name: Name,
): (typeof OPERATIONAL_ENV_REGISTRY)[Name] {
  return OPERATIONAL_ENV_REGISTRY[name];
}

export function slackSequencesEnvDefinition(
  name: SlackSequencesEnvName,
): SlackSequencesEnvDefinitionV1 {
  return isFeatureFlagName(name)
    ? FEATURE_FLAG_REGISTRY[name]
    : OPERATIONAL_ENV_REGISTRY[name];
}

/**
 * Exact raw environment access for registered Slack variables. No trimming,
 * casing, parsing, aliasing, or defaulting happens here, so migrating a legacy
 * call site cannot change its semantics. Higher-level snapshot helpers remain
 * responsible for interpretation.
 */
export function slackSequencesEnvRawValue<Name extends SlackSequencesEnvName>(
  name: Name,
  env: SlackSequencesEnvSource = process.env,
): string | undefined {
  return env[name];
}

export function resolveFeatureFlag<Name extends FeatureFlagName>(
  name: Name,
  env: SlackSequencesEnvSource = process.env,
): ResolvedFeatureFlagV1<Name> {
  const definition = FEATURE_FLAG_REGISTRY[name];
  const rawValue = slackSequencesEnvRawValue(name, env)?.trim().toLowerCase();
  if (!rawValue) {
    return { name, value: definition.defaultValue, defaulted: true, valid: true };
  }
  if (definition.resolution.kind === "opt-out") {
    const valid = rawValue === "0" || rawValue === "1";
    return {
      name,
      value: rawValue === "0" ? "off" : "on",
      rawValue,
      defaulted: false,
      valid,
    };
  }
  const value = definition.resolution.rawValues[rawValue];
  return {
    name,
    value: value ?? definition.defaultValue,
    rawValue,
    defaulted: false,
    valid: value !== undefined,
  };
}

export function featureFlagSnapshot(
  env: SlackSequencesEnvSource = process.env,
): FeatureFlagSnapshotV1 {
  return Object.fromEntries(
    (Object.keys(FEATURE_FLAG_REGISTRY) as FeatureFlagName[]).map((name) => [
      name,
      resolveFeatureFlag(name, env),
    ]),
  ) as FeatureFlagSnapshotV1;
}

export function operationalEnvSnapshot(
  env: SlackSequencesEnvSource = process.env,
): OperationalEnvSnapshotV1 {
  return Object.fromEntries(
    (Object.keys(OPERATIONAL_ENV_REGISTRY) as OperationalEnvName[]).map((name) => {
      const rawValue = slackSequencesEnvRawValue(name, env)?.trim();
      const definition = OPERATIONAL_ENV_REGISTRY[name];
      return [
        name,
        rawValue
          ? { name, value: rawValue, rawValue, defaulted: false }
          : { name, value: definition.defaultValue, defaulted: true },
      ];
    }),
  ) as OperationalEnvSnapshotV1;
}

export function slackSequencesEnvSnapshot(
  env: SlackSequencesEnvSource = process.env,
): SlackSequencesEnvSnapshotV1 {
  return {
    features: featureFlagSnapshot(env),
    operational: operationalEnvSnapshot(env),
  };
}
