/**
 * MP4/WebM/MOV/PNG render plumbing for Sequences.
 *
 * The core still owns only Project -> HTML. This host-side module compiles the
 * project into build/ and hands that folder to @hyperframes/producer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { Manifest, Project } from "@sequences/core";
import { buildProject } from "./projectIo.ts";

export type RenderFormat = "mp4" | "webm" | "mov" | "png-sequence";
export type RenderQuality = "draft" | "standard" | "high";

export interface RenderOptions {
  output?: string;
  format?: RenderFormat;
  quality?: RenderQuality;
  workers?: number;
  browserPath?: string;
  quiet?: boolean;
}

export interface RenderResult {
  outputPath: string;
  manifest: Manifest;
  ffmpegPath: string;
  browserPath?: string;
  format: RenderFormat;
  quality: RenderQuality;
  elapsedMs: number;
}

interface ProducerModule {
  createConsoleLogger?: (level: "info") => unknown;
  createRenderJob: (config: Record<string, unknown>) => unknown;
  executeRenderJob: (
    job: unknown,
    projectDir: string,
    outputPath: string,
    onProgress?: (job: { progress: number }, message: string) => void,
  ) => Promise<void>;
  resolveConfig: (config: Record<string, unknown>) => unknown;
}

const FORMAT_EXT: Record<RenderFormat, string> = {
  mp4: ".mp4",
  webm: ".webm",
  mov: ".mov",
  "png-sequence": "",
};

function pathEnvKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function runWhichFfmpeg(): string | undefined {
  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const args = process.platform === "win32" ? ["ffmpeg"] : ["ffmpeg"];
    const output = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

function findWinGetFfmpeg(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const base = path.join(
    process.env.LOCALAPPDATA ?? "",
    "Microsoft",
    "WinGet",
    "Packages",
  );
  if (!base || !fs.existsSync(base)) return undefined;
  const packageDirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("Gyan.FFmpeg_"))
    .map((entry) => path.join(base, entry.name));
  for (const packageDir of packageDirs) {
    const builds = fs
      .readdirSync(packageDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("ffmpeg-"))
      .map((entry) => path.join(packageDir, entry.name, "bin", "ffmpeg.exe"));
    for (const candidate of builds) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function findFfmpeg(): string | undefined {
  return runWhichFfmpeg() ?? findWinGetFfmpeg();
}

export function ensureFfmpegOnPath(): string {
  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    const hint =
      process.platform === "win32"
        ? "Install FFmpeg with `winget install -e --id Gyan.FFmpeg`, then restart your terminal."
        : "Install FFmpeg and ensure `ffmpeg` is on PATH.";
    throw new Error(`FFmpeg not found. ${hint}`);
  }

  const dir = path.dirname(ffmpegPath);
  const key = pathEnvKey();
  const current = process.env[key] ?? "";
  const parts = current.split(path.delimiter).map((part) => path.resolve(part));
  if (!parts.includes(path.resolve(dir))) {
    process.env[key] = [dir, current].filter(Boolean).join(path.delimiter);
  }
  return ffmpegPath;
}

function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

export function findBrowserExecutable(): string | undefined {
  if (process.env.SEQUENCES_BROWSER_PATH && fs.existsSync(process.env.SEQUENCES_BROWSER_PATH)) {
    return process.env.SEQUENCES_BROWSER_PATH;
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    return firstExisting([
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    ]);
  }

  if (process.platform === "darwin") {
    return firstExisting([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]);
  }

  return firstExisting([
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ]);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "render"
  );
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function defaultOutputPath(projectDir: string, project: Project, format: RenderFormat): string {
  const rendersDir = path.join(projectDir, "renders");
  const name = `${slug(project.meta.title)}-${timestamp()}${FORMAT_EXT[format]}`;
  return path.join(rendersDir, name);
}

export function resolveRenderOutputPath(
  projectDir: string,
  project: Project,
  options: RenderOptions,
): string {
  const format = options.format ?? "mp4";
  const raw = options.output ?? defaultOutputPath(projectDir, project, format);
  const root = path.resolve(projectDir);
  const output = path.resolve(root, raw);
  if (output === root || !output.startsWith(root + path.sep)) {
    throw new Error(`render output must stay inside the project directory: ${raw}`);
  }
  let existing = path.dirname(output);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (fs.existsSync(existing)) {
    const realRoot = fs.realpathSync(root);
    const realExisting = fs.realpathSync(existing);
    if (realExisting !== realRoot && !realExisting.startsWith(realRoot + path.sep)) {
      throw new Error(`render output parent escapes the project through a link: ${raw}`);
    }
  }
  return output;
}

export async function renderProject(
  projectDir: string,
  project: Project,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const dir = path.resolve(projectDir);
  const format = options.format ?? "mp4";
  const quality = options.quality ?? "standard";
  const ffmpegPath = ensureFfmpegOnPath();
  const outputPath = resolveRenderOutputPath(dir, project, options);
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-render-"));
  const buildDir = path.join(jobDir, "build");
  const temporaryOutput =
    format === "png-sequence"
      ? path.join(jobDir, "frames")
      : path.join(jobDir, `output${FORMAT_EXT[format]}`);
  const started = Date.now();
  try {
    const compileResult = buildProject(dir, project, { buildDir });
    if (format === "png-sequence") {
      fs.mkdirSync(temporaryOutput, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(temporaryOutput), { recursive: true });
    }

    (globalThis as { require?: NodeRequire }).require ??= createRequire(import.meta.url);
    const producerSpecifier: string = "@hyperframes/producer";
    const producer = (await import(producerSpecifier)) as ProducerModule;
    const browserPath = options.browserPath ?? findBrowserExecutable();
    const logger = options.quiet ? undefined : producer.createConsoleLogger?.("info");
    const job = producer.createRenderJob({
      fps: project.meta.fps,
      quality,
      format,
      workers: options.workers,
      entryFile: "index.html",
      logger,
      producerConfig: producer.resolveConfig({
        browserGpuMode: "software",
        forceScreenshot: true,
        ...(browserPath ? { chromePath: browserPath } : {}),
      }),
    });

    await producer.executeRenderJob(job, buildDir, temporaryOutput, (progressJob, message) => {
      if (options.quiet) return;
      const percent = Math.round(progressJob.progress);
      process.stdout.write(`\rrender ${percent}% ${message.padEnd(40).slice(0, 40)}`);
      if (percent >= 100) process.stdout.write("\n");
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (format === "png-sequence") {
      const staged = `${outputPath}.tmp-${randomUUID()}`;
      const backup = `${outputPath}.previous-${randomUUID()}`;
      fs.cpSync(temporaryOutput, staged, { recursive: true });
      let movedPrevious = false;
      try {
        if (fs.existsSync(outputPath)) {
          fs.renameSync(outputPath, backup);
          movedPrevious = true;
        }
        fs.renameSync(staged, outputPath);
        if (movedPrevious) fs.rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        if (!fs.existsSync(outputPath) && movedPrevious && fs.existsSync(backup)) {
          fs.renameSync(backup, outputPath);
        }
        throw error;
      } finally {
        fs.rmSync(staged, { recursive: true, force: true });
        fs.rmSync(backup, { recursive: true, force: true });
      }
    } else {
      const staged = `${outputPath}.tmp-${randomUUID()}`;
      const backup = `${outputPath}.previous-${randomUUID()}`;
      fs.copyFileSync(temporaryOutput, staged);
      let movedPrevious = false;
      try {
        if (fs.existsSync(outputPath)) {
          fs.renameSync(outputPath, backup);
          movedPrevious = true;
        }
        fs.renameSync(staged, outputPath);
        if (movedPrevious) fs.rmSync(backup, { force: true });
      } catch (error) {
        if (!fs.existsSync(outputPath) && movedPrevious && fs.existsSync(backup)) {
          fs.renameSync(backup, outputPath);
        }
        throw error;
      } finally {
        fs.rmSync(staged, { force: true });
        fs.rmSync(backup, { force: true });
      }
    }

    return {
      outputPath,
      manifest: compileResult.manifest,
      ffmpegPath,
      browserPath,
      format,
      quality,
      elapsedMs: Date.now() - started,
    };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
