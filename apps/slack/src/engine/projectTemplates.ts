/**
 * Project bootstrap for the Slack app — adapted from apps/sequences'
 * projectTemplates.ts. Same `createDefaultProject` factory + dashboard asset
 * seed, but the workspace lives under apps/slack/.data/projects (gitignored)
 * instead of the monorepo's examples dir.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultProject, createShowcaseProject } from "@sequences/core";
import { saveProject } from "./projectIo.ts";
import {
  contentAssetId,
  extractAssetMetadata,
  sha256File,
} from "@sequences/platform/asset-metadata";

const ENGINE_SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(ENGINE_SRC_DIR, "templates");

/** apps/slack/.data — per-project folders + the job map live here. */
export function dataDir(): string {
  return process.env.SLACK_SEQUENCES_DATA_DIR ?? path.resolve(ENGINE_SRC_DIR, "../../.data");
}

export function projectsDir(): string {
  return path.join(dataDir(), "projects");
}

/** Absolute directory for a given job/project id (created on demand). */
export function projectDirFor(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  return path.join(projectsDir(), safe);
}

export function resolveProjectPath(input: string, baseDir = process.cwd()): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("project path is empty");
  const withHome =
    trimmed === "~" || trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith("~/")
      ? path.join(os.homedir(), trimmed.slice(1))
      : trimmed;
  return path.resolve(baseDir, withHome);
}

export interface InitProjectOptions {
  name?: string;
  brandName?: string;
  showcase?: boolean;
  /** Seed the bundled dashboard screenshot so media archetypes are available. */
  seedScreenshot?: boolean;
}

export function initializeProject(dir: string, options: InitProjectOptions = {}): void {
  if (fs.existsSync(path.join(dir, "project.json"))) {
    throw new Error(`refusing to overwrite existing project in ${dir}`);
  }

  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });

  const name = options.name ?? path.basename(path.resolve(dir));
  const brandName = options.brandName ?? name;
  const factory = options.showcase ? createShowcaseProject : createDefaultProject;
  const seedScreenshot = options.seedScreenshot ?? true;

  if (!seedScreenshot) {
    const project = factory({ title: name, brandName, screenshotAssetId: null });
    saveProject(dir, project);
    fs.writeFileSync(path.join(dir, "events.log"), "");
    return;
  }

  fs.copyFileSync(
    path.join(TEMPLATES_DIR, "dashboard.svg"),
    path.join(dir, "assets", "dashboard.svg"),
  );
  const project = factory({ title: name, brandName, screenshotAssetId: null });
  const dashboardFile = path.join(dir, "assets", "dashboard.svg");
  const dashboardHash = sha256File(dashboardFile);
  const dashboardId = contentAssetId(dashboardHash);
  project.assets.push({
    id: dashboardId,
    path: "assets/dashboard.svg",
    kind: "image",
    contentHash: dashboardHash,
    metadata: extractAssetMetadata(dashboardFile, "image"),
  });
  const withScreenshot = factory({ title: name, brandName, screenshotAssetId: dashboardId });
  project.scenes = withScreenshot.scenes;

  saveProject(dir, project);
  fs.writeFileSync(path.join(dir, "events.log"), "");
}
