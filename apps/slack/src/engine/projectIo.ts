/**
 * Project directory IO — the host-side persistence the core deliberately
 * doesn't do. A project is a plain directory (no database, plan §7):
 *
 *   project.json   — the scene graph (always current; saved on every command)
 *   events.log     — append-only JSONL command journal (audit/time-travel)
 *   assets/        — user media, referenced by Asset.path
 *   build/         — compile artifacts (HTML + vendor scripts + manifest)
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  applyCommand,
  CommandSchema,
  compile,
  contentHash,
  migrateProject,
  validateProject,
  type CompileResult,
  type EventEntry,
  type Project,
} from "@sequences/core";
import { sha256File } from "@sequences/platform/asset-metadata";
import { vendorFiles } from "@sequences/platform/vendors";
export { vendorFiles } from "@sequences/platform/vendors";

export function loadProject(dir: string): Project {
  const file = path.join(dir, "project.json");
  if (!fs.existsSync(file)) {
    throw new Error(`no project.json in ${dir} — run "sequences init ${dir}" first`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const migrated = migrateProject(raw, {
    hashAssetPath: (relative) => {
      const candidate = path.resolve(dir, relative);
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
        ? sha256File(candidate)
        : undefined;
    },
  });
  const result = validateProject(migrated);
  if (!result.ok || !result.project) {
    const issues = result.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
    throw new Error(`project.json is invalid:\n${issues}`);
  }
  let project = result.project;
  let recovered = false;
  const eventsFile = path.join(dir, "events.log");
  if (fs.existsSync(eventsFile)) {
    for (const line of fs.readFileSync(eventsFile, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let entry: Partial<EventEntry>;
      try {
        entry = JSON.parse(line) as Partial<EventEntry>;
      } catch {
        continue;
      }
      if (
        typeof entry.beforeHash !== "string" ||
        typeof entry.afterHash !== "string" ||
        !entry.command
      ) {
        continue;
      }
      const currentHash = contentHash(project);
      if (currentHash === entry.afterHash) continue;
      if (currentHash !== entry.beforeHash) continue;
      const parsed = CommandSchema.safeParse(entry.command);
      if (!parsed.success) continue;
      const replayed = applyCommand(project, entry.command).project;
      const validation = validateProject(replayed);
      if (
        !validation.ok ||
        !validation.project ||
        contentHash(validation.project) !== entry.afterHash
      ) {
        continue;
      }
      project = validation.project;
      recovered = true;
    }
  }
  if (recovered) saveProject(dir, project);
  return project;
}

export function saveProject(dir: string, project: Project): void {
  const file = path.join(dir, "project.json");
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(project, null, 2) + "\n");
    const handle = fs.openSync(temporary, "r+");
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, file);
    try {
      const directory = fs.openSync(path.dirname(file), "r");
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    } catch {
      // Windows does not consistently permit fsync on directory handles.
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function appendEvent(dir: string, entry: EventEntry): void {
  const file = path.join(dir, "events.log");
  const handle = fs.openSync(file, "a");
  try {
    fs.writeSync(handle, JSON.stringify(entry) + "\n");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Persist a mutation as write-ahead journal entries followed by the atomic
 * snapshot. If the process dies between those steps, loadProject replays the
 * hashed journal record exactly once.
 */
export function commitProject(dir: string, project: Project, entries: EventEntry[]): void {
  for (const entry of entries) appendEvent(dir, entry);
  saveProject(dir, project);
}

/** Highest durable event sequence already present on disk. */
export function readEventSequence(dir: string): number {
  const file = path.join(dir, "events.log");
  if (!fs.existsSync(file)) return 0;
  let highest = 0;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { seq?: unknown };
      if (typeof parsed.seq === "number" && Number.isInteger(parsed.seq)) {
        highest = Math.max(highest, parsed.seq);
      }
    } catch {
      // A malformed journal line must not prevent the project snapshot loading.
    }
  }
  return highest;
}

function lockOwnerIsAlive(file: string): boolean {
  let pid: number;
  try {
    const owner = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: unknown };
    if (typeof owner.pid !== "number" || !Number.isInteger(owner.pid)) return false;
    pid = owner.pid;
  } catch {
    // A competing process may have created the file but not written its token yet.
    try {
      return Date.now() - fs.statSync(file).mtimeMs < 5_000;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Serialize project snapshot/event writes across Studio, MCP, and CLI hosts.
 * The lock is project-local and automatically recovered when its owner dies.
 */
export async function withProjectWriteLock<T>(
  dir: string,
  action: () => T | Promise<T>,
  timeoutMs = 10_000,
): Promise<T> {
  const lockFile = path.join(path.resolve(dir), ".sequences-write.lock");
  const token = { pid: process.pid, id: randomUUID(), at: new Date().toISOString() };
  const started = Date.now();

  while (true) {
    try {
      const handle = fs.openSync(lockFile, "wx");
      try {
        fs.writeFileSync(handle, JSON.stringify(token));
      } finally {
        fs.closeSync(handle);
      }
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (!lockOwnerIsAlive(lockFile)) {
        fs.rmSync(lockFile, { force: true });
        continue;
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`timed out waiting for another Sequences writer: ${lockFile}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  try {
    return await action();
  } finally {
    try {
      const current = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { id?: unknown };
      if (current.id === token.id) fs.rmSync(lockFile, { force: true });
    } catch {
      // A missing lock here means another recovery path already cleaned it up.
    }
  }
}

function containedPath(root: string, relative: string): string {
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, relative);
  if (target !== rootPath && !target.startsWith(rootPath + path.sep)) {
    throw new Error(`path escapes ${rootPath}: ${relative}`);
  }
  return target;
}

/** Compile the project and write build/ next to it. Returns the result. */
export interface BuildProjectOptions {
  buildDir?: string;
  /** Studio preview may degrade around a deleted asset; CLI/render remain strict. */
  allowMissingAssets?: boolean;
}

export interface BuildProjectResult extends CompileResult {
  missingAssetPaths: string[];
}

export function buildProject(
  dir: string,
  project: Project,
  options: BuildProjectOptions = {},
): BuildProjectResult {
  const projectDir = path.resolve(dir);
  const publishedBuildDir = path.resolve(options.buildDir ?? path.join(projectDir, "build"));
  const ownsJobDir = options.buildDir === undefined;
  const jobRoot = projectDir;
  const buildDir = ownsJobDir
    ? path.join(jobRoot, `.sequences-build-${randomUUID()}`)
    : publishedBuildDir;
  let previousManifest: CompileResult["manifest"] | undefined;
  const previousManifestFile = path.join(publishedBuildDir, "manifest.json");
  if (fs.existsSync(previousManifestFile)) {
    try {
      previousManifest = JSON.parse(fs.readFileSync(previousManifestFile, "utf8")) as CompileResult["manifest"];
    } catch {
      previousManifest = undefined;
    }
  }
  const result = compile(project, { previousManifest });
  const missingAssetPaths: string[] = [];
  const verifiedSources = new Map<string, string>();
  for (const asset of result.assets) {
    const source = containedPath(projectDir, asset.sourcePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      missingAssetPaths.push(asset.sourcePath);
      continue;
    }
    const realProjectDir = fs.realpathSync(projectDir);
    const realSource = fs.realpathSync(source);
    if (realSource !== realProjectDir && !realSource.startsWith(realProjectDir + path.sep)) {
      throw new Error(`asset source escapes project directory: ${asset.sourcePath}`);
    }
    verifiedSources.set(asset.assetId, source);
  }
  if (missingAssetPaths.length > 0 && !options.allowMissingAssets) {
    throw new Error(`asset file missing: ${missingAssetPaths.join(", ")}`);
  }

  fs.mkdirSync(path.join(buildDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(buildDir, "scenes"), { recursive: true });
  fs.writeFileSync(path.join(buildDir, "index.html"), result.html);
  fs.writeFileSync(
    path.join(buildDir, "manifest.json"),
    JSON.stringify(result.manifest, null, 2) + "\n",
  );
  for (const sceneId of result.changedSceneIds) {
    const scene = result.manifest.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) continue;
    fs.writeFileSync(
      path.join(buildDir, "scenes", `${sceneId}.json`),
      JSON.stringify(scene, null, 2) + "\n",
    );
  }
  for (const name of fs.readdirSync(path.join(buildDir, "scenes"))) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (!result.manifest.scenes.some((scene) => scene.id === id)) {
      fs.rmSync(path.join(buildDir, "scenes", name), { force: true });
    }
  }
  const vendors = vendorFiles();
  for (const name of result.vendorScripts) {
    const source = vendors[name];
    if (source && !fs.existsSync(path.join(buildDir, name))) {
      fs.copyFileSync(source, path.join(buildDir, name));
    }
  }
  for (const asset of result.assets) {
    const source = verifiedSources.get(asset.assetId);
    if (!source) continue;
    const destination = containedPath(buildDir, asset.href);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const hashFile = `${destination}.sha256`;
    const previousHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim() : "";
    if (!fs.existsSync(destination) || previousHash !== asset.contentHash) {
      fs.copyFileSync(source, destination);
      fs.writeFileSync(hashFile, asset.contentHash + "\n");
    }
  }
  if (ownsJobDir) {
    const oldThumbs = path.join(publishedBuildDir, "thumbs");
    if (fs.existsSync(oldThumbs)) {
      fs.cpSync(oldThumbs, path.join(buildDir, "thumbs"), { recursive: true });
    }
    const backup = path.join(jobRoot, `.sequences-build-previous-${randomUUID()}`);
    let movedPrevious = false;
    try {
      if (fs.existsSync(publishedBuildDir)) {
        fs.renameSync(publishedBuildDir, backup);
        movedPrevious = true;
      }
      fs.renameSync(buildDir, publishedBuildDir);
      if (movedPrevious) fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (!fs.existsSync(publishedBuildDir) && movedPrevious && fs.existsSync(backup)) {
        fs.renameSync(backup, publishedBuildDir);
      }
      throw error;
    } finally {
      fs.rmSync(buildDir, { recursive: true, force: true });
      fs.rmSync(backup, { recursive: true, force: true });
    }
  }
  return { ...result, missingAssetPaths };
}
