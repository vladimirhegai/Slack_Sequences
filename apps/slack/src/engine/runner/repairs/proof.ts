/** Evidence attached to one deterministic repair application. */
export interface RepairProof {
  readonly intendedFinding: string;
  readonly changed: boolean;
  readonly newFindingClasses: readonly string[];
}

export interface RepairEdits<T> {
  readonly edits: T;
  readonly proof: RepairProof;
}

/**
 * Shared L2 wrapper for repair outputs. A repair may change its intended
 * finding, but it must never introduce a new finding class. Callers provide
 * the before/after class sets from the owning gate so the invariant is
 * explicit and testable instead of being inferred from byte changes.
 */
export function withRepairProof<T>(args: {
  edits: T;
  intendedFinding: string;
  beforeFindingClasses: readonly string[];
  afterFindingClasses: readonly string[];
  changed?: boolean;
}): RepairEdits<T> {
  const intendedFinding = args.intendedFinding.trim();
  if (!intendedFinding) throw new Error("repair proof requires an intended finding");
  const before = new Set(args.beforeFindingClasses);
  const newFindingClasses = [...new Set(args.afterFindingClasses)]
    .filter((findingClass) => !before.has(findingClass))
    .sort();
  if (newFindingClasses.length) {
    throw new Error(
      `repair introduced new finding class(es): ${newFindingClasses.join(", ")}`,
    );
  }
  return {
    edits: args.edits,
    proof: {
      intendedFinding,
      changed: args.changed ?? true,
      newFindingClasses,
    },
  };
}
