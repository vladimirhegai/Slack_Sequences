/**
 * Canonical direct-HyperFrames authoring store and deterministic publication
 * gate. Authored HTML is kept separate from derived thumbnails/renders while
 * the legacy project.json remains available for the curated demo path.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  lintHyperframeHtml,
  type HyperframeLintFinding,
} from "@hyperframes/core";
import type { RenderQuality } from "./render.ts";
import { ensureFfmpegOnPath, findBrowserExecutable } from "./render.ts";
import { inspectDirectComposition } from "./layoutInspector.ts";

const DIRECT_DIR = "composition";
const MANIFEST_FILE = "manifest.json";
const REVISIONS_DIR = "revisions";
const MAX_SOURCE_CHARS = 500_000;

export interface DirectScene {
  id: string;
  title: string;
  purpose: string;
  startSec: number;
  durationSec: number;
  blueprint?: string;
  rules?: string[];
  outgoingCut?: string;
}

export interface DirectCompositionDraft {
  html: string;
  storyboard: DirectScene[];
}

export interface DirectCompositionManifest {
  version: 1;
  mode: "hyperframes-direct";
  title: string;
  compositionId: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  revision: number;
  createdAt: string;
  sourceHash: string;
  provenance: {
    source: "agent";
    operation: "create" | "revise";
    previousRevision: number | null;
  };
  qa?: {
    browserValidated: true;
    layoutSamples: number;
    warningCount: number;
  };
  scenes: DirectScene[];
}

export interface DirectValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  findings: HyperframeLintFinding[];
  compositionId?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface DirectThumbsResult {
  files: Record<string, string>;
  elapsedMs: number;
}

export interface DirectRenderResult {
  outputPath: string;
  durationSec: number;
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

function compositionDir(projectDir: string): string {
  return path.join(path.resolve(projectDir), DIRECT_DIR);
}

function manifestPath(projectDir: string): string {
  return path.join(compositionDir(projectDir), MANIFEST_FILE);
}

function revisionsDir(projectDir: string): string {
  return path.join(path.resolve(projectDir), REVISIONS_DIR);
}

export function hasDirectComposition(projectDir: string): boolean {
  return fs.existsSync(path.join(compositionDir(projectDir), "index.html")) &&
    fs.existsSync(manifestPath(projectDir));
}

export function loadDirectComposition(projectDir: string): {
  html: string;
  manifest: DirectCompositionManifest;
} {
  if (!hasDirectComposition(projectDir)) {
    throw new Error(`no direct HyperFrames composition in ${projectDir}`);
  }
  return {
    html: fs.readFileSync(path.join(compositionDir(projectDir), "index.html"), "utf8"),
    manifest: JSON.parse(
      fs.readFileSync(manifestPath(projectDir), "utf8"),
    ) as DirectCompositionManifest,
  };
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rootTag(html: string): string | undefined {
  return html.match(/<[^>]+\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/is)?.[0];
}

function sceneTags(html: string): string[] {
  return [...html.matchAll(/<([a-z][\w:-]*)\b[^>]*\bdata-scene(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>/gis)]
    .map((match) => match[0]);
}

function referencedLocalPaths(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) {
    const value = match[2]!.trim();
    if (!value || value.startsWith("#") || value.startsWith("data:")) continue;
    refs.push(value.split(/[?#]/, 1)[0]!);
  }
  for (const match of html.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const value = match[2]!.trim();
    if (!value || value.startsWith("data:")) continue;
    refs.push(value.split(/[?#]/, 1)[0]!);
  }
  return [...new Set(refs)];
}

function normalizeStoryboard(
  storyboard: DirectScene[],
  html: string,
): { scenes: DirectScene[]; errors: string[] } {
  const errors: string[] = [];
  const tags = sceneTags(html);
  const byId = new Map(storyboard.map((scene) => [scene.id, scene]));
  const scenes = tags.map((tag, index): DirectScene => {
    const id = attr(tag, "id") ?? "";
    const startSec = finiteNumber(attr(tag, "data-start"));
    const durationSec = finiteNumber(attr(tag, "data-duration"));
    if (!id) errors.push(`scene ${index + 1} is missing a stable id`);
    if (startSec === undefined || startSec < 0) errors.push(`scene "${id || index + 1}" has invalid data-start`);
    if (durationSec === undefined || durationSec <= 0) errors.push(`scene "${id || index + 1}" has invalid data-duration`);
    const proposed = byId.get(id);
    if (!proposed) errors.push(`scene "${id}" is missing from storyboard_json`);
    if (proposed && (
      Math.abs(proposed.startSec - (startSec ?? 0)) > 0.01 ||
      Math.abs(proposed.durationSec - (durationSec ?? 0)) > 0.01
    )) {
      errors.push(`storyboard timing for "${id}" does not match its HTML scene window`);
    }
    return {
      id,
      title: proposed?.title?.trim() || `Scene ${index + 1}`,
      purpose: proposed?.purpose?.trim() || "Advance the launch story",
      startSec: startSec ?? 0,
      durationSec: durationSec ?? 0,
      ...(proposed?.blueprint ? { blueprint: proposed.blueprint } : {}),
      ...(proposed?.rules?.length ? { rules: proposed.rules } : {}),
      ...(proposed?.outgoingCut ? { outgoingCut: proposed.outgoingCut } : {}),
    };
  });
  if (tags.length < 2) errors.push("composition needs at least two elements marked data-scene");
  if (storyboard.length !== tags.length) {
    errors.push(`storyboard has ${storyboard.length} scenes but HTML declares ${tags.length}`);
  }
  return { scenes, errors };
}

function invariantErrors(
  html: string,
  durationSec: number | undefined,
  compositionId: string | undefined,
): string[] {
  const errors: string[] = [];
  const forbidden: Array<[RegExp, string]> = [
    [
      /(?:\b(?:src|href)\s*=\s*(["'])(?:https?:)?\/\/.*?\1|url\(\s*(["']?)(?:https?:)?\/\/|@import\s+(?:url\()?\s*(["']?)(?:https?:)?\/\/)/i,
      "network URLs are not allowed; use project-local assets",
    ],
    [/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/, "render-time network calls are not allowed"],
    [/\b(?:Date\.now|new\s+Date|performance\.now)\s*\(/, "wall-clock time is not seek-safe"],
    [/\bMath\.random\s*\(/, "Math.random is not deterministic"],
    [/\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/, "timer-driven visual state is not seek-safe"],
    [/\brepeat\s*:\s*-1\b/, "infinite repeats are not finite timelines"],
    [/\.play\s*\(/, "render-critical timelines must stay paused"],
    [
      /(?:\.(?:to|from|fromTo|set)|gsap\.(?:to|from|fromTo|set))\s*\([^;]{0,1000}\b(?:display|visibility)\s*:/is,
      "do not animate display/visibility; use scene windows and opacity",
    ],
  ];
  for (const [pattern, message] of forbidden) {
    if (pattern.test(html)) errors.push(message);
  }
  if (!/<!doctype\s+html/i.test(html) || !/<html\b/i.test(html) || !/<body\b/i.test(html)) {
    errors.push("index_html must be a complete HTML document");
  }
  if (!/<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\1[^>]*>\s*<\/script>/i.test(html)) {
    errors.push('load the host-provided GSAP exactly as <script src="gsap.min.js"></script>');
  }
  if (!/gsap\.timeline\s*\(\s*\{[^}]*paused\s*:\s*true/is.test(html)) {
    errors.push("create one synchronous gsap.timeline({ paused: true })");
  }
  if (compositionId) {
    const escaped = compositionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`window\\.__timelines\\s*\\[\\s*(["'])${escaped}\\1\\s*\\]\\s*=`, "s").test(html)) {
      errors.push(`register the paused timeline as window.__timelines["${compositionId}"]`);
    }
  }
  if (durationSec === undefined || durationSec < 6 || durationSec > 60) {
    errors.push("root data-duration must be a finite value from 6 to 60 seconds");
  }
  return errors;
}

export async function validateDirectComposition(
  projectDir: string,
  draft: DirectCompositionDraft,
): Promise<DirectValidationResult> {
  const html = draft.html.trim();
  const errors: string[] = [];
  if (!html) errors.push("index_html is empty");
  if (html.length > MAX_SOURCE_CHARS) errors.push(`index_html exceeds ${MAX_SOURCE_CHARS} characters`);

  const root = rootTag(html);
  const compositionId = root ? attr(root, "data-composition-id") : undefined;
  const width = root ? finiteNumber(attr(root, "data-width")) : undefined;
  const height = root ? finiteNumber(attr(root, "data-height")) : undefined;
  const durationSec = root ? finiteNumber(attr(root, "data-duration")) : undefined;
  if (!root) errors.push("missing root data-composition-id element");
  if (!compositionId) errors.push("root composition id is missing");
  if (!width || !height || width < 320 || height < 320 || width > 4096 || height > 4096) {
    errors.push("root data-width/data-height must be finite canvas dimensions");
  }
  errors.push(...invariantErrors(html, durationSec, compositionId));

  const normalized = normalizeStoryboard(draft.storyboard, html);
  errors.push(...normalized.errors);
  if (durationSec !== undefined) {
    for (const scene of normalized.scenes) {
      if (scene.startSec + scene.durationSec > durationSec + 0.01) {
        errors.push(`scene "${scene.id}" extends past the ${durationSec}s composition`);
      }
    }
  }

  const rootDir = compositionDir(projectDir);
  for (const ref of referencedLocalPaths(html)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) {
      errors.push(`asset reference must be local: ${ref}`);
      continue;
    }
    const resolved = path.resolve(rootDir, ref);
    if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
      errors.push(`asset reference escapes the composition: ${ref}`);
      continue;
    }
    if (ref !== "gsap.min.js" && !fs.existsSync(resolved)) {
      const staged = path.resolve(projectDir, ref);
      if (!fs.existsSync(staged)) errors.push(`referenced local asset does not exist: ${ref}`);
    }
  }

  let findings: HyperframeLintFinding[] = [];
  try {
    const lint = await lintHyperframeHtml(html, { filePath: "index.html" });
    findings = lint.findings;
    errors.push(...lint.findings
      .filter((finding: HyperframeLintFinding) => finding.severity === "error")
      .map((finding: HyperframeLintFinding) => `${finding.code}: ${finding.message}`));
  } catch (error) {
    errors.push(`HyperFrames lint failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: findings
      .filter((finding) => finding.severity === "warning")
      .map((finding) => `${finding.code}: ${finding.message}`),
    findings,
    compositionId,
    width,
    height,
    durationSec,
  };
}

function copyRuntimeAndAssets(projectDir: string, targetDir: string): void {
  const require = createRequire(import.meta.url);
  fs.copyFileSync(
    require.resolve("gsap/dist/gsap.min.js"),
    path.join(targetDir, "gsap.min.js"),
  );
  const sourceAssets = path.join(projectDir, "assets");
  if (fs.existsSync(sourceAssets)) {
    fs.cpSync(sourceAssets, path.join(targetDir, "assets"), { recursive: true });
  }
}

function revisionName(revision: number): string {
  return String(revision).padStart(4, "0");
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export async function commitDirectComposition(
  projectDir: string,
  title: string,
  draft: DirectCompositionDraft,
  fps = 30,
): Promise<{ manifest: DirectCompositionManifest; validation: DirectValidationResult }> {
  const dir = path.resolve(projectDir);
  const target = compositionDir(dir);
  const validation = await validateDirectComposition(dir, draft);
  if (!validation.ok) {
    throw new Error(`composition failed validation:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const browserQa = await inspectDirectComposition(dir, draft);
  if (!browserQa.ok) {
    throw new Error(
      `composition failed browser validation/layout inspection:\n${
        browserQa.errors.map((error) => `- ${error}`).join("\n")
      }`,
    );
  }

  const normalized = normalizeStoryboard(draft.storyboard, draft.html);
  const previous = hasDirectComposition(dir) ? loadDirectComposition(dir).manifest : undefined;
  const revision = (previous?.revision ?? 0) + 1;
  const manifest: DirectCompositionManifest = {
    version: 1,
    mode: "hyperframes-direct",
    title,
    compositionId: validation.compositionId!,
    width: validation.width!,
    height: validation.height!,
    durationSec: validation.durationSec!,
    fps,
    revision,
    createdAt: new Date().toISOString(),
    sourceHash: createHash("sha256").update(draft.html).digest("hex"),
    provenance: {
      source: "agent",
      operation: previous ? "revise" : "create",
      previousRevision: previous?.revision ?? null,
    },
    qa: {
      browserValidated: true,
      layoutSamples: browserQa.samples.length,
      warningCount: browserQa.warnings.length,
    },
    scenes: normalized.scenes,
  };

  const staged = path.join(dir, `.composition-${randomUUID()}`);
  const backup = path.join(dir, `.composition-previous-${randomUUID()}`);
  fs.mkdirSync(staged, { recursive: true });
  let movedPrevious = false;
  try {
    fs.writeFileSync(path.join(staged, "index.html"), draft.html.trim() + "\n");
    writeJson(path.join(staged, MANIFEST_FILE), manifest);
    copyRuntimeAndAssets(dir, staged);
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      movedPrevious = true;
    }
    fs.renameSync(staged, target);
    if (movedPrevious) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(target) && movedPrevious && fs.existsSync(backup)) {
      fs.renameSync(backup, target);
    }
    throw error;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
  }

  const checkpoint = path.join(revisionsDir(dir), revisionName(revision));
  fs.mkdirSync(checkpoint, { recursive: true });
  fs.copyFileSync(path.join(target, "index.html"), path.join(checkpoint, "index.html"));
  writeJson(path.join(checkpoint, MANIFEST_FILE), manifest);
  return { manifest, validation };
}

export function undoDirectComposition(projectDir: string): boolean {
  const current = loadDirectComposition(projectDir).manifest;
  if (current.revision <= 1) return false;
  const targetRevision = current.revision - 1;
  const checkpoint = path.join(revisionsDir(projectDir), revisionName(targetRevision));
  if (!fs.existsSync(path.join(checkpoint, "index.html"))) {
    throw new Error(`missing direct composition checkpoint ${targetRevision}`);
  }
  const target = compositionDir(projectDir);
  fs.copyFileSync(path.join(checkpoint, "index.html"), path.join(target, "index.html"));
  fs.copyFileSync(path.join(checkpoint, MANIFEST_FILE), path.join(target, MANIFEST_FILE));
  return true;
}

export function directOutline(manifest: DirectCompositionManifest): string {
  return manifest.scenes
    .map((scene, index) => {
      const recipe = scene.blueprint ? ` · ${scene.blueprint}` : "";
      const cut = scene.outgoingCut ? ` · cut: ${scene.outgoingCut}` : "";
      return `${index + 1}. ${scene.title} · ${scene.startSec.toFixed(1)}–${(
        scene.startSec + scene.durationSec
      ).toFixed(1)}s${recipe}${cut}`;
    })
    .join("\n");
}

export async function directLintText(projectDir: string): Promise<string> {
  const current = loadDirectComposition(projectDir);
  const validation = await validateDirectComposition(projectDir, {
    html: current.html,
    storyboard: current.manifest.scenes,
  });
  if (!validation.ok) return `lint: ${validation.errors.length} error(s)`;
  const staticText = validation.warnings.length
    ? `lint: clean · ${validation.warnings.length} static warning(s)`
    : "lint: clean";
  const qa = current.manifest.qa;
  if (!qa?.browserValidated) return `${staticText} · browser QA: legacy revision`;
  return `${staticText} · browser QA: ${qa.layoutSamples} samples${
    qa.warningCount ? ` · ${qa.warningCount} warning(s)` : " clean"
  }`;
}

function serveDir(dir: string): Promise<{ url: string; close: () => void }> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dir, "." + pathname.replace(/\/$/, "/index.html"));
      const root = path.resolve(dir);
      if (
        (file !== root && !file.startsWith(root + path.sep)) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": mime[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("could not bind composition server"));
      resolve({ url: `http://127.0.0.1:${address.port}`, close: () => server.close() });
    });
  });
}

export async function generateDirectThumbnails(
  projectDir: string,
  options: { width?: number; browserPath?: string } = {},
): Promise<DirectThumbsResult> {
  const current = loadDirectComposition(projectDir);
  const targetDir = path.join(projectDir, "build", "thumbs");
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-direct-thumbs-"));
  fs.mkdirSync(targetDir, { recursive: true });
  const browserPath = options.browserPath ?? findBrowserExecutable();
  if (!browserPath) throw new Error("no Chrome/Edge found for thumbnail capture");
  const scale = (options.width ?? 480) / current.manifest.width;
  const started = Date.now();
  const puppeteer = (await import("puppeteer-core")).default;
  const server = await serveDir(compositionDir(projectDir));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.setViewport({
      width: current.manifest.width,
      height: current.manifest.height,
      deviceScaleFactor: scale,
    });
    const consoleErrors: string[] = [];
    page.on("pageerror", (error: unknown) =>
      consoleErrors.push(error instanceof Error ? error.message : String(error)),
    );
    await page.goto(`${server.url}/index.html`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForFunction(
      (id: string) => Boolean(
        (window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.[id],
      ),
      { timeout: 15_000 },
      current.manifest.compositionId,
    );
    if (consoleErrors.length) throw new Error(`composition runtime error: ${consoleErrors.join("; ")}`);

    const files: Record<string, string> = {};
    for (const scene of current.manifest.scenes) {
      const at = scene.startSec + scene.durationSec * 0.58;
      await page.evaluate(
        (time: number, id: string) => {
          const win = window as unknown as {
            __timelines: Record<string, { seek(t: number, suppress?: boolean): void }>;
          };
          win.__timelines[id]!.seek(time, false);
          document.querySelectorAll<HTMLElement>("[data-scene]").forEach((element) => {
            const start = Number(element.dataset.start ?? 0);
            const duration = Number(element.dataset.duration ?? 0);
            element.style.visibility = time >= start && time < start + duration ? "visible" : "hidden";
          });
        },
        at,
        current.manifest.compositionId,
      );
      const safeId = scene.id.replace(/[^a-z0-9_-]/gi, "-");
      const staged = path.join(staging, `${safeId}.png`);
      await page.screenshot({ path: staged as `${string}.png` });
      const target = path.join(targetDir, `${safeId}.png`);
      fs.copyFileSync(staged, target);
      files[scene.id] = `thumbs/${safeId}.png`;
    }
    return { files, elapsedMs: Date.now() - started };
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function renderName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "render";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return `${slug}-${stamp}.mp4`;
}

export async function renderDirectComposition(
  projectDir: string,
  options: { quality?: RenderQuality; browserPath?: string; quiet?: boolean } = {},
): Promise<DirectRenderResult> {
  const current = loadDirectComposition(projectDir);
  ensureFfmpegOnPath();
  const browserPath = options.browserPath ?? findBrowserExecutable();
  const outputPath = path.join(projectDir, "renders", renderName(current.manifest.title));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const started = Date.now();
  (globalThis as { require?: NodeRequire }).require ??= createRequire(import.meta.url);
  const producerSpecifier: string = "@hyperframes/producer";
  const producer = (await import(producerSpecifier)) as ProducerModule;
  const job = producer.createRenderJob({
    fps: current.manifest.fps,
    quality: options.quality ?? "draft",
    format: "mp4",
    entryFile: "index.html",
    logger: options.quiet ? undefined : producer.createConsoleLogger?.("info"),
    producerConfig: producer.resolveConfig({
      browserGpuMode: "software",
      forceScreenshot: true,
      ...(browserPath ? { chromePath: browserPath } : {}),
    }),
  });
  await producer.executeRenderJob(
    job,
    compositionDir(projectDir),
    outputPath,
    options.quiet
      ? undefined
      : (progressJob, message) => {
          const percent = Math.round(progressJob.progress);
          process.stdout.write(`\rrender ${percent}% ${message.padEnd(40).slice(0, 40)}`);
          if (percent >= 100) process.stdout.write("\n");
        },
  );
  return {
    outputPath,
    durationSec: current.manifest.durationSec,
    elapsedMs: Date.now() - started,
  };
}
