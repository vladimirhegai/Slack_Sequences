import { recordSentinelNormalization } from "../sentinelTelemetry.ts";

/** A stable L2 identifier owned by the Sentinel normalize registry. */
export type NormalizerId = `normalize.${string}`;

/** A stable state/context address used to make normalizer coupling explicit. */
export type NormalizerField = string;

export interface NormalizerCondition {
  readonly id: string;
  readonly description: string;
}

export interface NormalizerOutcome<State> {
  /** State handed to the next normalizer in the ordered pipeline. */
  readonly state: State;
  /** Number of deterministic repairs performed by this stage. */
  readonly repairCount: number;
  /**
   * Telemetry count when it intentionally differs from the state-change count.
   * `0` preserves legacy stages that emitted diagnostics but no normalization
   * telemetry; omitted means `repairCount`.
   */
  readonly telemetryCount?: number;
  /** Side effects that historically followed normalization telemetry. */
  readonly afterTelemetry?: () => void;
  /** Operator diagnostics emitted after the stage completes. */
  readonly diagnostics?: readonly string[];
}

/** Array order is execution order; ids are stable contract paperwork. */
export interface OrderedNormalizer<State, Context = undefined> {
  readonly id: NormalizerId;
  /** State/context fields inspected by this pass. */
  readonly reads: readonly NormalizerField[];
  /** State fields this pass may mutate. */
  readonly writes: readonly NormalizerField[];
  /** Preconditions checked or guaranteed by an earlier declared dependency. */
  readonly preconditions: readonly NormalizerCondition[];
  /** Invariants established for later passes and the group audit. */
  readonly postconditions: readonly NormalizerCondition[];
  /** Passes that must execute before this pass. Transitive order is honored. */
  readonly orderingDependencies: readonly NormalizerId[];
  /** Consecutive passes committed and fully audited as one unit. */
  readonly atomicGroup: string;
  /** Stable test file/name that proves this pass converges on replay. */
  readonly idempotenceTestRef: string;
  /** Retain historical telemetry keys while execution becomes registry-owned. */
  readonly telemetryTag: string;
  readonly run: (state: State, context: Context) => NormalizerOutcome<State>;
}

export type UndeclaredNormalizer<State, Context = undefined> = Omit<
  OrderedNormalizer<State, Context>,
  | "reads"
  | "writes"
  | "preconditions"
  | "postconditions"
  | "orderingDependencies"
  | "atomicGroup"
  | "idempotenceTestRef"
>;

export interface LinearNormalizerContract {
  readonly order: readonly NormalizerId[];
  readonly reads: readonly NormalizerField[];
  readonly writes: readonly NormalizerField[];
  readonly atomicGroup: string;
  readonly preconditions: readonly NormalizerCondition[];
  readonly postconditions: readonly NormalizerCondition[];
  readonly idempotenceTestRef: string;
}

/**
 * Attach a stable, explicit dependency contract to a historically linear
 * pipeline. The separately declared order is deliberate: moving an
 * implementation entry without updating its contract becomes a test failure
 * rather than silently changing source semantics.
 */
export function declareLinearNormalizerRegistry<State, Context>(
  passes: readonly UndeclaredNormalizer<State, Context>[],
  contract: LinearNormalizerContract,
): readonly OrderedNormalizer<State, Context>[] {
  const byId = new Map(passes.map((pass) => [pass.id, pass]));
  if (byId.size !== passes.length) throw new Error("normalizer registry contains duplicate ids");
  if (contract.order.length !== passes.length || contract.order.some((id) => !byId.has(id))) {
    throw new Error("normalizer dependency order does not match registry entries");
  }
  return passes.map((pass, index) => ({
    ...pass,
    reads: contract.reads,
    writes: contract.writes,
    preconditions: contract.preconditions,
    postconditions: contract.postconditions,
    orderingDependencies: index === 0 ? [] : [contract.order[index - 1]!],
    atomicGroup: contract.atomicGroup,
    idempotenceTestRef: contract.idempotenceTestRef,
  }));
}

export interface NormalizerDependencyAudit {
  readonly duplicateIds: readonly NormalizerId[];
  readonly missingDependencies: readonly string[];
  readonly cycles: readonly NormalizerId[];
  readonly orderViolations: readonly string[];
  readonly writeConflicts: readonly string[];
  readonly splitAtomicGroups: readonly string[];
}

/** Build and validate the dependency graph independently of execution. */
export function auditNormalizerDependencyGraph<State, Context>(
  registry: readonly OrderedNormalizer<State, Context>[],
): NormalizerDependencyAudit {
  const ids = registry.map((entry) => entry.id);
  const idSet = new Set(ids);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const missingDependencies: string[] = [];
  const orderViolations: string[] = [];
  const dependencies = new Map<NormalizerId, readonly NormalizerId[]>();
  for (const [index, entry] of registry.entries()) {
    dependencies.set(entry.id, entry.orderingDependencies);
    for (const dependency of entry.orderingDependencies) {
      if (!idSet.has(dependency)) missingDependencies.push(`${entry.id} -> ${dependency}`);
      else if (ids.indexOf(dependency) >= index) orderViolations.push(`${entry.id} -> ${dependency}`);
    }
  }

  const visiting = new Set<NormalizerId>();
  const visited = new Set<NormalizerId>();
  const cycles = new Set<NormalizerId>();
  const visit = (id: NormalizerId): void => {
    if (visiting.has(id)) {
      cycles.add(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (idSet.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);

  const orderedBefore = (before: NormalizerId, after: NormalizerId): boolean => {
    const pending = [...(dependencies.get(after) ?? [])];
    const seen = new Set<NormalizerId>();
    while (pending.length) {
      const dependency = pending.pop()!;
      if (dependency === before) return true;
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      pending.push(...(dependencies.get(dependency) ?? []));
    }
    return false;
  };
  const writeConflicts: string[] = [];
  for (let left = 0; left < registry.length; left += 1) {
    for (let right = left + 1; right < registry.length; right += 1) {
      const a = registry[left]!;
      const b = registry[right]!;
      const conflicts = a.writes.filter((field) => b.writes.includes(field));
      if (conflicts.length && !orderedBefore(a.id, b.id) && !orderedBefore(b.id, a.id)) {
        writeConflicts.push(`${a.id} <> ${b.id}: ${conflicts.join(", ")}`);
      }
    }
  }

  const splitAtomicGroups: string[] = [];
  const groupBounds = new Map<string, [number, number]>();
  registry.forEach((entry, index) => {
    const bounds = groupBounds.get(entry.atomicGroup);
    groupBounds.set(entry.atomicGroup, bounds ? [bounds[0], index] : [index, index]);
  });
  for (const [group, [first, last]] of groupBounds) {
    if (registry.slice(first, last + 1).some((entry) => entry.atomicGroup !== group)) {
      splitAtomicGroups.push(group);
    }
  }

  return {
    duplicateIds,
    missingDependencies,
    cycles: [...cycles],
    orderViolations,
    writeConflicts,
    splitAtomicGroups,
  };
}

export interface NormalizerRuntimeHooks {
  /** Tests can observe telemetry without entering an AsyncLocalStorage run. */
  readonly recordTelemetry?: (tag: string, count: number) => void;
  /** Tests can suppress/capture stderr while production retains current output. */
  readonly writeDiagnostic?: (message: string) => void;
  /** Full invariant audit, invoked once after each consecutive atomic group. */
  readonly auditAtomicGroup?: <State, Context>(evidence: {
    readonly group: string;
    readonly before: State;
    readonly after: State;
    readonly context: Context;
    readonly changedIds: readonly NormalizerId[];
  }) => void;
}

export interface NormalizerRegistryRun<State> {
  readonly state: State;
  /** Full trace, including no-op stages, exposes the load-bearing order. */
  readonly executedIds: readonly NormalizerId[];
  readonly changedIds: readonly NormalizerId[];
  readonly auditedGroups: readonly string[];
}

/**
 * Execute an ordered deterministic-normalizer registry through one seam.
 * Telemetry and diagnostics are centralized so a stage cannot silently omit
 * L2 accounting or grow a second execution path.
 */
export function runNormalizerRegistry<State, Context>(
  registry: readonly OrderedNormalizer<State, Context>[],
  initialState: State,
  context: Context,
  hooks: NormalizerRuntimeHooks = {},
): NormalizerRegistryRun<State> {
  const executedIds: NormalizerId[] = [];
  const changedIds: NormalizerId[] = [];
  const auditedGroups: string[] = [];
  const recordTelemetry = hooks.recordTelemetry ?? recordSentinelNormalization;
  const writeDiagnostic = hooks.writeDiagnostic ?? ((message: string) => {
    process.stderr.write(message);
  });
  let state = initialState;
  let groupBefore = initialState;
  let groupChangedIds: NormalizerId[] = [];

  for (const [index, normalizer] of registry.entries()) {
    executedIds.push(normalizer.id);
    const outcome = normalizer.run(state, context);
    state = outcome.state;
    if (outcome.repairCount > 0) {
      changedIds.push(normalizer.id);
      groupChangedIds.push(normalizer.id);
    }
    const telemetryCount = outcome.telemetryCount ?? outcome.repairCount;
    if (telemetryCount > 0) recordTelemetry(normalizer.telemetryTag, telemetryCount);
    outcome.afterTelemetry?.();
    for (const diagnostic of outcome.diagnostics ?? []) writeDiagnostic(diagnostic);
    const next = registry[index + 1];
    if (!next || next.atomicGroup !== normalizer.atomicGroup) {
      if (hooks.auditAtomicGroup) {
        hooks.auditAtomicGroup({
          group: normalizer.atomicGroup,
          before: groupBefore,
          after: state,
          context,
          changedIds: groupChangedIds,
        });
        auditedGroups.push(normalizer.atomicGroup);
      }
      groupBefore = state;
      groupChangedIds = [];
    }
  }

  return { state, executedIds, changedIds, auditedGroups };
}
