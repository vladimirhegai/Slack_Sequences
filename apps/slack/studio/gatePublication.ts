import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PUBLICATION_PATHS = [
  "composition",
  "revisions",
  path.join("build", "thumbs"),
] as const;

interface PublicationSnapshot {
  projectDir: string;
  backupDir: string;
  existing: Set<string>;
}

function snapshotPublication(projectDir: string): PublicationSnapshot {
  const resolvedProjectDir = path.resolve(projectDir);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-recipe-gate-"));
  const existing = new Set<string>();
  for (const relative of PUBLICATION_PATHS) {
    const source = path.join(resolvedProjectDir, relative);
    if (!fs.existsSync(source)) continue;
    existing.add(relative);
    const backup = path.join(backupDir, relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.cpSync(source, backup, { recursive: true });
  }
  return { projectDir: resolvedProjectDir, backupDir, existing };
}

function restorePublication(snapshot: PublicationSnapshot): void {
  for (const relative of PUBLICATION_PATHS) {
    const target = path.join(snapshot.projectDir, relative);
    fs.rmSync(target, { recursive: true, force: true });
    if (!snapshot.existing.has(relative)) continue;
    const backup = path.join(snapshot.backupDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(backup, target, { recursive: true });
  }
}

function discardSnapshot(snapshot: PublicationSnapshot): void {
  fs.rmSync(snapshot.backupDir, { recursive: true, force: true });
}

export interface RecipeGatePublicationResult<T> {
  value: T;
  errors: string[];
}

/**
 * Commit/capture is necessarily stateful: thumbnail generation reads the
 * committed composition. Wrap that promotion in a gate-local transaction so
 * any post-commit evidence failure restores the last green composition,
 * revision history, and preview strip exactly. A first-ever red gate restores
 * the absence of all three surfaces.
 */
export async function runRecipeGatePublication<T>(
  projectDir: string,
  publishAndCapture: () => Promise<T>,
  assess: (value: T) => string[],
): Promise<RecipeGatePublicationResult<T>> {
  const snapshot = snapshotPublication(projectDir);
  let discard = true;
  try {
    const value = await publishAndCapture();
    const errors = assess(value);
    if (errors.length) restorePublication(snapshot);
    return { value, errors };
  } catch (error) {
    try {
      restorePublication(snapshot);
    } catch (restoreError) {
      // Keep the snapshot for manual recovery when the filesystem itself
      // prevents rollback; deleting the only good bytes would compound it.
      discard = false;
      throw new AggregateError(
        [error, restoreError],
        `recipe gate failed and its last-green publication could not be restored; ` +
          `snapshot retained at ${snapshot.backupDir}`,
      );
    }
    throw error;
  } finally {
    if (discard) discardSnapshot(snapshot);
  }
}
