import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import type { ProviderId } from "@sequences/platform/providers";
import type { DirectCompositionDraft, DirectScene } from "./directComposition.ts";
import { resolveFeatureFlag, type SlackSequencesEnvSource } from "./featureFlags.ts";
import {
  resolveLunaWorkerConfig,
  resumeLunaWorkerJob,
  startLunaWorkerJob,
  workerInputFile,
  type LunaWorkerDeliverable,
  type LunaWorkerInputFile,
  type LunaWorkerResult,
} from "./lunaWorkerClient.ts";

const PROMPT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../prompts",
);
const MAX_REFERENCE_FILE_BYTES = 12 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 28 * 1024 * 1024;
const MAX_DELIVERABLE_BYTES = 32 * 1024 * 1024;
const MAX_DELIVERABLE_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_DELIVERABLE_COUNT = 128;
const MAX_LUNA_ASSET_COUNT = 48;
const MAX_LUNA_ASSET_BYTES = 28 * 1024 * 1024;
const LUNA_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self' 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; " +
  "media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const LUNA_ASSET_MEDIA_TYPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ".svg": ["image/svg+xml"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".woff": ["font/woff", "application/font-woff"],
  ".woff2": ["font/woff2"],
  ".ttf": ["font/ttf", "application/x-font-ttf"],
  ".otf": ["font/otf", "application/x-font-opentype"],
});

export type LunaAuthorRoute = "luna-direct" | "legacy-provider";

export interface LunaFactEnvelope {
  version: 1;
  product: string;
  brandName: string;
  whatShipped: string;
  audience?: string;
  tone?: string;
  targetDurationSec: number;
  context?: string;
  provenance: {
    source: "slack-user-and-authorized-workspace-context";
    unsupportedClaimsAllowed: false;
  };
}

export interface LunaMotionIntentV1 {
  version: 1;
  compositionId: string;
  durationSec: number;
  creativeOwner: string;
  acts: Array<{
    sceneId: string;
    startSec: number;
    endSec: number;
    primarySelector: string;
    persistentEntityIds?: string[];
  }>;
  boundaries: Array<Record<string, unknown> & {
    id: string;
    atSec: number;
    fromScene: string;
    toScene: string;
    strategy: string;
    outgoingAnchorSelector: string;
    incomingAnchorSelector: string;
  }>;
  cameraMoves: Array<Record<string, unknown> & {
    sceneId: string;
    targetSelector: string;
    startSec: number;
    arrivalSec: number;
    settleEndSec: number;
    holdEndSec: number;
  }>;
  interactions: Array<Record<string, unknown> & {
    actorSelector: string;
    targetSelector: string;
    resultSelector: string;
  }>;
  energyPeak: Record<string, unknown> & { startSec: number; endSec: number };
  finalRestingHold: Record<string, unknown> & {
    startSec: number;
    endSec: number;
    primarySelector: string;
  };
  geometryPolicy?: Record<string, unknown>;
}

export interface LunaSessionReceiptV1 {
  version: 1;
  workerJobId: string;
  workerOperationId: string;
  workerRunCount: number;
  threadId: string;
  codexVersion: string;
  model: "gpt-5.6-luna";
  reasoningEffort: "high";
  durationSec: number;
  committedRevision: number;
  latestCommittedSourceSha256: string;
  latestRawSourceSha256: string;
  latestArtifactFingerprint: string;
  latestRunDir: string;
  createdAt: string;
  updatedAt: string;
}

export interface LunaAuthoredComposition {
  draft: DirectCompositionDraft;
  intent: LunaMotionIntentV1;
  worker: LunaWorkerResult;
  rawSourceSha256: string;
  /** Composition + storyboard + asset bytes; excludes prose-only review notes. */
  artifactFingerprint: string;
  runDir: string;
  assetFiles: Array<{ relativePath: string; bytes: Buffer }>;
}

export interface LunaAssetTransaction {
  commit(): void;
  rollback(): void;
}

export function resolveAuthorRoute(
  explicitProvider?: ProviderId,
  env: SlackSequencesEnvSource = process.env,
): LunaAuthorRoute {
  if (explicitProvider) return "legacy-provider";
  return resolveFeatureFlag("SLACK_SEQUENCES_AUTHOR_ROUTE", env).value as LunaAuthorRoute;
}

function prompt(name: string): string {
  return fs.readFileSync(path.join(PROMPT_DIR, name), "utf8");
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeLeafName(value: string, fallback: string): string {
  const safe = path.basename(value).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return safe || fallback;
}

function approvedAssetInputs(referencePaths: readonly string[], approvedRoot?: string): {
  files: LunaWorkerInputFile[];
  manifest: Array<{ path: string; sourceName: string; sha256: string; bytes: number }>;
} {
  const files: LunaWorkerInputFile[] = [];
  const manifest: Array<{ path: string; sourceName: string; sha256: string; bytes: number }> = [];
  if (referencePaths.length && !approvedRoot) {
    throw new Error("Luna asset references require an explicit approved host root");
  }
  const rootReal = approvedRoot ? fs.realpathSync(approvedRoot) : undefined;
  let total = 0;
  for (const [index, source] of referencePaths.entries()) {
    const stats = fs.lstatSync(source);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Luna asset reference ${index + 1} is not an approved regular file`);
    }
    const sourceReal = fs.realpathSync(source);
    const relativeToRoot = rootReal ? path.relative(rootReal, sourceReal) : "";
    if (
      !rootReal || !relativeToRoot || relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)
    ) {
      throw new Error(`Luna asset reference ${index + 1} is outside the approved host root`);
    }
    if (stats.size > MAX_REFERENCE_FILE_BYTES) {
      throw new Error(`Luna asset reference ${index + 1} exceeds 12 MB`);
    }
    total += stats.size;
    if (total > MAX_REFERENCE_TOTAL_BYTES) {
      throw new Error("Luna asset references exceed the 28 MB job limit");
    }
    const bytes = fs.readFileSync(source);
    const relative = `inputs/brand-assets/${String(index + 1).padStart(2, "0")}-${
      safeLeafName(source, `asset-${index + 1}`)
    }`;
    const digest = sha256(bytes);
    files.push(workerInputFile(relative, bytes));
    manifest.push({ path: relative, sourceName: path.basename(source), sha256: digest, bytes: bytes.length });
  }
  return { files, manifest };
}

function initialWorkerFiles(
  facts: LunaFactEnvelope,
  referencePaths: readonly string[],
  approvedRoot?: string,
): LunaWorkerInputFile[] {
  const assets = approvedAssetInputs(referencePaths, approvedRoot);
  const assetBrief = [
    "# Approved brand asset intake",
    "",
    facts.context ? facts.context : "No additional brand notes were supplied.",
    "",
    "## Approved local files",
    "",
    assets.manifest.length
      ? assets.manifest.map((item) =>
        `- \`${item.path}\` (${item.bytes} bytes, sha256 \`${item.sha256}\`, source name \`${item.sourceName}\`)`
      ).join("\n")
      : "No image files were supplied. Create a small deterministic local asset system from the verified description.",
    "",
  ].join("\n");
  return [
    workerInputFile("inputs/fact-envelope.json", JSON.stringify(facts, null, 2) + "\n"),
    workerInputFile("inputs/asset-brief.md", assetBrief),
    workerInputFile(
      "inputs/references/slack-ad-motion-principles.md",
      prompt("luna-motion-reference.md"),
    ),
    ...assets.files,
  ];
}

function normalizeWorkerPath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Luna worker returned an unsafe deliverable path");
  }
  return normalized;
}

function decodeDeliverable(file: LunaWorkerDeliverable): Buffer {
  const normalized = normalizeWorkerPath(file.path);
  if (!normalized.startsWith("deliverables/")) {
    throw new Error(`Luna worker returned out-of-envelope file ${normalized}`);
  }
  const bytes = Buffer.from(file.contentBase64, "base64");
  if (bytes.length !== file.size || bytes.length > MAX_DELIVERABLE_BYTES) {
    throw new Error(`Luna deliverable ${normalized} has an invalid size`);
  }
  if (sha256(bytes) !== file.sha256.toLowerCase()) {
    throw new Error(`Luna deliverable ${normalized} failed SHA-256 verification`);
  }
  return bytes;
}

function nextRunDir(projectDir: string, kind: string): string {
  const root = path.join(projectDir, "planning", "luna", "runs");
  fs.mkdirSync(root, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const highest = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => Number(entry.name.match(/^(\d{4})-/)?.[1] ?? 0))
      .reduce((maximum, value) => Math.max(maximum, value), 0);
    const candidate = path.join(root, `${String(highest + 1).padStart(4, "0")}-${kind}`);
    try {
      fs.mkdirSync(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a unique Luna evidence run directory");
}

function persistWorkerResult(projectDir: string, kind: string, result: LunaWorkerResult): {
  runDir: string;
  files: Map<string, Buffer>;
} {
  const runDir = nextRunDir(projectDir, kind);
  const files = new Map<string, Buffer>();
  if (result.deliverables.length > MAX_DELIVERABLE_COUNT) {
    throw new Error("Luna worker returned too many deliverables");
  }
  let totalBytes = 0;
  for (const deliverable of result.deliverables) {
    const relative = normalizeWorkerPath(deliverable.path);
    if (files.has(relative)) throw new Error(`Luna worker returned duplicate deliverable ${relative}`);
    const bytes = decodeDeliverable(deliverable);
    totalBytes += bytes.length;
    if (totalBytes > MAX_DELIVERABLE_TOTAL_BYTES) {
      throw new Error("Luna worker deliverables exceeded the host total-size limit");
    }
    const withinDeliverables = relative.slice("deliverables/".length);
    const destination = path.resolve(runDir, "deliverables", withinDeliverables);
    const root = path.resolve(runDir, "deliverables") + path.sep;
    if (!destination.startsWith(root)) throw new Error("Luna deliverable escaped its evidence directory");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    files.set(relative, bytes);
  }
  fs.writeFileSync(path.join(runDir, "worker-receipt.json"), JSON.stringify({
    version: 1,
    jobId: result.jobId,
    threadId: result.threadId,
    status: result.status,
    model: result.model,
    reasoningEffort: result.reasoningEffort,
    codexVersion: result.codexVersion,
    usage: result.usage ?? null,
    finalMessage: result.finalMessage ?? "",
    deliverables: result.deliverables.map(({ path: filePath, sha256: hash, size }) => ({
      path: filePath,
      sha256: hash,
      size,
    })),
  }, null, 2) + "\n");
  return { runDir, files };
}

function requiredText(files: Map<string, Buffer>, relativePath: string): string {
  const bytes = files.get(`deliverables/${relativePath}`);
  if (!bytes) throw new Error(`Luna did not produce deliverables/${relativePath}`);
  return bytes.toString("utf8");
}

function parseStoryboard(raw: string): DirectScene[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Luna storyboard.json is not valid JSON");
  }
  const scenes = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { storyboard?: unknown }).storyboard)
      ? (parsed as { storyboard: unknown[] }).storyboard
      : undefined;
  if (!scenes?.length || scenes.some((scene) => !scene || typeof scene !== "object")) {
    throw new Error("Luna storyboard.json must contain a non-empty storyboard array");
  }
  const ids = new Set<string>();
  for (const [index, scene] of scenes.entries()) {
    const candidate = scene as Partial<DirectScene>;
    if (
      typeof candidate.id !== "string" || !candidate.id || ids.has(candidate.id) ||
      typeof candidate.title !== "string" || !candidate.title.trim() ||
      typeof candidate.purpose !== "string" || !candidate.purpose.trim() ||
      typeof candidate.startSec !== "number" || !Number.isFinite(candidate.startSec) ||
      typeof candidate.durationSec !== "number" || !Number.isFinite(candidate.durationSec) ||
      candidate.startSec < 0 || candidate.durationSec <= 0
    ) {
      throw new Error(`Luna storyboard scene ${index + 1} has an invalid or duplicate core field`);
    }
    ids.add(candidate.id);
  }
  return scenes as DirectScene[];
}

interface LunaAssetDeclaration {
  path: string;
  purpose: string;
  provenance: "supplied" | "agent-created";
  mediaType: string;
  sha256?: string;
}

function validateLunaHtmlSecurity(html: string): void {
  const document = parseHTML(html).document;
  const policies = Array.from(document.querySelectorAll<HTMLMetaElement>(
    'meta[http-equiv="Content-Security-Policy" i]',
  ));
  if (
    policies.length !== 1 ||
    policies[0]!.getAttribute("content")?.replace(/\s+/g, " ").trim() !== LUNA_CONTENT_SECURITY_POLICY
  ) {
    throw new Error("Luna composition is missing the exact local-only Content Security Policy");
  }
  const sourcedScripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
  if (
    sourcedScripts.length !== 1 ||
    sourcedScripts[0]!.getAttribute("src") !== "gsap.min.js"
  ) {
    throw new Error("Luna composition may load only the host gsap.min.js script");
  }
  if (document.querySelector("iframe,object,embed,base,link,audio,video,source,form")) {
    throw new Error("Luna composition contains a forbidden executable, navigation, or media element");
  }
  if (document.querySelector('meta[http-equiv="refresh" i]')) {
    throw new Error("Luna composition cannot navigate with meta refresh");
  }
  if (
    /\b(?:javascript|data|blob)\s*:/i.test(html) ||
    /\b(?:navigator\.sendBeacon|EventSource|RTCPeerConnection|window\.open)\s*\(/.test(html) ||
    /\b(?:window\.)?location\s*(?:=|\.)/.test(html)
  ) {
    throw new Error("Luna composition contains a forbidden runtime URL or navigation primitive");
  }
}

function validateAssetBytes(relativePath: string, mediaType: string, bytes: Buffer): void {
  const extension = path.posix.extname(relativePath).toLowerCase();
  const allowedMediaTypes = LUNA_ASSET_MEDIA_TYPES[extension];
  if (!allowedMediaTypes?.includes(mediaType)) {
    throw new Error(`Luna asset ${relativePath} uses a forbidden type or extension`);
  }
  if (extension === ".svg") {
    const svg = bytes.toString("utf8");
    const hasExternalCssUrl = [...svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)]
      .some((match) => !match[2]!.trim().startsWith("#"));
    if (
      !/<svg\b/i.test(svg) || svg.includes("\0") ||
      /<!DOCTYPE|<!ENTITY/i.test(svg) ||
      /<\s*(?:script|foreignObject|iframe|object|embed|image|audio|video|animate|animateMotion|animateTransform|set)\b/i.test(svg) ||
      /\bon[a-z]+\s*=/i.test(svg) ||
      /\b(?:href|xlink:href)\s*=\s*(["'])(?!#)[\s\S]*?\1/i.test(svg) ||
      hasExternalCssUrl ||
      /@import\b/i.test(svg)
    ) {
      throw new Error(`Luna SVG asset ${relativePath} contains active or external content`);
    }
    return;
  }
  const ascii4 = bytes.subarray(0, 4).toString("ascii");
  const valid = extension === ".png"
    ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : extension === ".jpg" || extension === ".jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : extension === ".webp"
        ? ascii4 === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
        : extension === ".woff"
          ? ascii4 === "wOFF"
          : extension === ".woff2"
            ? ascii4 === "wOF2"
            : extension === ".ttf"
              ? bytes.length >= 4 && bytes.readUInt32BE(0) === 0x00010000
              : extension === ".otf"
                ? ascii4 === "OTTO"
                : false;
  if (!valid) throw new Error(`Luna asset ${relativePath} does not match its declared file type`);
}

function validateAssetManifest(
  raw: string,
  html: string,
  assetFiles: readonly { relativePath: string; bytes: Buffer }[],
  runDir: string,
): void {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Luna assets-manifest.json is not valid JSON");
  }
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { assets?: unknown }).assets)
      ? (value as { assets: unknown[] }).assets
      : undefined;
  if (!entries) throw new Error("Luna assets-manifest.json must be an array or an assets array envelope");

  const actual = new Map(assetFiles.map((asset) => [asset.relativePath, asset.bytes]));
  if (actual.size > MAX_LUNA_ASSET_COUNT) {
    throw new Error(`Luna asset bundle exceeds ${MAX_LUNA_ASSET_COUNT} files`);
  }
  const actualBytes = assetFiles.reduce((total, asset) => total + asset.bytes.length, 0);
  if (actualBytes > MAX_LUNA_ASSET_BYTES) {
    throw new Error("Luna asset bundle exceeds the 28 MB host limit");
  }
  const declared = new Set<string>();
  const receipt: Array<LunaAssetDeclaration & { bytes: number; verifiedSha256: string }> = [];
  for (const [index, candidate] of entries.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Luna asset manifest entry ${index + 1} must be an object`);
    }
    const entry = candidate as Partial<LunaAssetDeclaration>;
    if (typeof entry.path !== "string" || !entry.path.startsWith("assets/luna/")) {
      throw new Error(`Luna asset manifest entry ${index + 1} has an invalid HTML path`);
    }
    const relativePath = normalizeWorkerPath(entry.path.slice("assets/luna/".length));
    if (!/^[A-Za-z0-9._/-]+$/.test(relativePath)) {
      throw new Error(`Luna asset manifest entry ${index + 1} must use URL-safe path characters`);
    }
    if (declared.has(relativePath)) throw new Error(`Luna asset manifest duplicates ${entry.path}`);
    declared.add(relativePath);
    const bytes = actual.get(relativePath);
    if (!bytes) throw new Error(`Luna asset manifest names missing file ${entry.path}`);
    if (typeof entry.purpose !== "string" || !entry.purpose.trim()) {
      throw new Error(`Luna asset manifest entry ${index + 1} lacks a purpose`);
    }
    if (entry.provenance !== "supplied" && entry.provenance !== "agent-created") {
      throw new Error(`Luna asset manifest entry ${index + 1} has invalid provenance`);
    }
    if (typeof entry.mediaType !== "string" || !entry.mediaType.trim()) {
      throw new Error(`Luna asset manifest entry ${index + 1} lacks a media type`);
    }
    validateAssetBytes(relativePath, entry.mediaType.trim().toLowerCase(), bytes);
    const digest = sha256(bytes);
    if (entry.sha256 !== undefined && entry.sha256.toLowerCase() !== digest) {
      throw new Error(`Luna asset manifest SHA-256 does not match ${entry.path}`);
    }
    if (!html.includes(entry.path)) {
      throw new Error(`Luna asset ${entry.path} is registered but unused by composition.html`);
    }
    receipt.push({
      path: entry.path,
      purpose: entry.purpose.trim(),
      provenance: entry.provenance,
      mediaType: entry.mediaType.trim(),
      ...(entry.sha256 ? { sha256: entry.sha256.toLowerCase() } : {}),
      bytes: bytes.length,
      verifiedSha256: digest,
    });
  }
  for (const relativePath of actual.keys()) {
    if (!declared.has(relativePath)) {
      throw new Error(`Luna asset file assets/luna/${relativePath} is not registered`);
    }
  }
  fs.writeFileSync(
    path.join(runDir, "host-assets.json"),
    JSON.stringify({ version: 1, assets: receipt }, null, 2) + "\n",
  );
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Luna motion intent has invalid ${label}`);
  }
  return value;
}

function requireSelector(
  document: ReturnType<typeof parseHTML>["document"],
  selector: unknown,
  label: string,
  unique = false,
): string {
  if (typeof selector !== "string" || !selector.trim()) {
    throw new Error(`Luna motion intent is missing ${label}`);
  }
  let count: number;
  try {
    count = document.querySelectorAll(selector).length;
  } catch {
    throw new Error(`Luna motion intent has invalid selector ${label}`);
  }
  if (count === 0) throw new Error(`Luna motion intent selector ${label} matches no element`);
  if (unique && count !== 1) throw new Error(`Luna motion intent selector ${label} must be unique`);
  return selector;
}

export function parseLunaMotionIntent(
  raw: string,
  html: string,
  storyboard: DirectScene[],
): LunaMotionIntentV1 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Luna motion-intent.json is not valid JSON");
  }
  if (!value || typeof value !== "object") throw new Error("Luna motion intent must be an object");
  const intent = value as Partial<LunaMotionIntentV1>;
  if (intent.version !== 1 || typeof intent.compositionId !== "string" || !intent.compositionId) {
    throw new Error("Luna motion intent must declare version 1 and compositionId");
  }
  if (typeof intent.creativeOwner !== "string" || !intent.creativeOwner.trim()) {
    throw new Error("Luna motion intent must declare its creative owner");
  }
  const duration = finite(intent.durationSec, "durationSec");
  if (!Array.isArray(intent.acts) || !intent.acts.length) {
    throw new Error("Luna motion intent must declare at least one act");
  }
  if (!Array.isArray(intent.boundaries) || !Array.isArray(intent.cameraMoves) || !Array.isArray(intent.interactions)) {
    throw new Error("Luna motion intent must declare boundary, camera, and interaction arrays");
  }
  if (!intent.energyPeak || !intent.finalRestingHold) {
    throw new Error("Luna motion intent must declare one energy peak and final resting hold");
  }
  const sceneIds = new Set(storyboard.map((scene) => scene.id));
  const document = parseHTML(html).document;
  const compositionRoots = document.querySelectorAll<HTMLElement>("[data-composition-id]");
  if (compositionRoots.length !== 1) {
    throw new Error("Luna composition must have one composition root");
  }
  const compositionRoot = compositionRoots[0]!;
  if (compositionRoot.getAttribute("data-composition-id") !== intent.compositionId) {
    throw new Error("Luna motion intent compositionId does not match composition.html");
  }
  const htmlDuration = Number(compositionRoot.getAttribute("data-duration"));
  if (!Number.isFinite(htmlDuration) || Math.abs(htmlDuration - duration) > 0.01) {
    throw new Error("Luna motion intent duration does not match composition.html");
  }
  const sceneElements = Array.from(
    compositionRoot.querySelectorAll<HTMLElement>("[data-scene]"),
  );
  if (sceneElements.length !== storyboard.length) {
    throw new Error("Luna composition must contain exactly one data-scene element per storyboard scene");
  }
  const seenSceneBindings = new Set<string>();
  const seenElementIds = new Set<string>();
  for (const element of sceneElements) {
    const sceneBinding = element.getAttribute("data-scene")?.trim() ?? "";
    const elementId = element.getAttribute("id")?.trim() ?? "";
    if (!sceneBinding || seenSceneBindings.has(sceneBinding)) {
      throw new Error("Luna composition scene bindings must be non-empty and unique");
    }
    if (!elementId || seenElementIds.has(elementId)) {
      throw new Error("Luna composition scene element ids must be non-empty and unique");
    }
    seenSceneBindings.add(sceneBinding);
    seenElementIds.add(elementId);
  }
  for (const scene of storyboard) {
    const element = sceneElements.find(
      (candidate) => candidate.getAttribute("data-scene") === scene.id,
    );
    if (!element) {
      throw new Error(`Luna composition is missing data-scene="${scene.id}"`);
    }
    const sceneStart = Number(element.getAttribute("data-start"));
    const sceneDuration = Number(element.getAttribute("data-duration"));
    if (
      !Number.isFinite(sceneStart) ||
      !Number.isFinite(sceneDuration) ||
      Math.abs(sceneStart - scene.startSec) > 0.05 ||
      Math.abs(sceneDuration - scene.durationSec) > 0.05
    ) {
      throw new Error(`Luna composition scene "${scene.id}" does not match its storyboard window`);
    }
  }
  if (intent.acts.length !== storyboard.length) {
    throw new Error("Luna motion intent must declare one semantic primary act per storyboard scene");
  }
  const actSceneIds = new Set<string>();
  for (const [index, act] of intent.acts.entries()) {
    if (!sceneIds.has(act.sceneId)) throw new Error(`Luna act ${index + 1} names an unknown scene`);
    if (actSceneIds.has(act.sceneId)) throw new Error(`Luna act ${index + 1} duplicates a scene`);
    actSceneIds.add(act.sceneId);
    const start = finite(act.startSec, `acts[${index}].startSec`);
    const end = finite(act.endSec, `acts[${index}].endSec`);
    if (start < 0 || end <= start || end > duration + 0.01) {
      throw new Error(`Luna act ${index + 1} has an invalid time window`);
    }
    const scene = storyboard.find((candidate) => candidate.id === act.sceneId)!;
    if (
      Math.abs(start - scene.startSec) > 0.05 ||
      Math.abs(end - (scene.startSec + scene.durationSec)) > 0.05
    ) {
      throw new Error(`Luna act ${index + 1} does not match its storyboard scene window`);
    }
    requireSelector(document, act.primarySelector, `acts[${index}].primarySelector`, true);
  }
  for (const [index, boundary] of intent.boundaries.entries()) {
    if (!sceneIds.has(boundary.fromScene) || !sceneIds.has(boundary.toScene)) {
      throw new Error(`Luna boundary ${index + 1} names an unknown scene`);
    }
    const at = finite(boundary.atSec, `boundaries[${index}].atSec`);
    if (at <= 0 || at >= duration) throw new Error(`Luna boundary ${index + 1} has invalid timing`);
    if (!boundary.id || !boundary.strategy) throw new Error(`Luna boundary ${index + 1} lacks intent`);
    const outgoing = storyboard.find((scene) => scene.id === boundary.fromScene)!;
    const incoming = storyboard.find((scene) => scene.id === boundary.toScene)!;
    if (
      Math.abs(at - (outgoing.startSec + outgoing.durationSec)) > 0.05 ||
      Math.abs(at - incoming.startSec) > 0.05
    ) {
      throw new Error(`Luna boundary ${index + 1} does not match its scene handoff`);
    }
    requireSelector(document, boundary.outgoingAnchorSelector, `boundaries[${index}].outgoingAnchorSelector`);
    requireSelector(document, boundary.incomingAnchorSelector, `boundaries[${index}].incomingAnchorSelector`);
  }
  for (const [index, camera] of intent.cameraMoves.entries()) {
    if (!sceneIds.has(camera.sceneId)) throw new Error(`Luna camera move ${index + 1} names an unknown scene`);
    const times = [camera.startSec, camera.arrivalSec, camera.settleEndSec, camera.holdEndSec]
      .map((entry, timeIndex) => finite(entry, `cameraMoves[${index}].time${timeIndex}`));
    if (!(times[0]! < times[1]! && times[1]! <= times[2]! && times[2]! < times[3]! && times[3]! <= duration)) {
      throw new Error(`Luna camera move ${index + 1} lacks arrival/settle/hold ordering`);
    }
    const scene = storyboard.find((candidate) => candidate.id === camera.sceneId)!;
    if (times[0]! < scene.startSec || times[3]! > scene.startSec + scene.durationSec + 0.01) {
      throw new Error(`Luna camera move ${index + 1} escapes its declared scene`);
    }
    requireSelector(document, camera.targetSelector, `cameraMoves[${index}].targetSelector`);
  }
  for (const [index, interaction] of intent.interactions.entries()) {
    requireSelector(document, interaction.actorSelector, `interactions[${index}].actorSelector`);
    requireSelector(document, interaction.targetSelector, `interactions[${index}].targetSelector`);
    requireSelector(document, interaction.resultSelector, `interactions[${index}].resultSelector`);
  }
  const peakStart = finite(intent.energyPeak.startSec, "energyPeak.startSec");
  const peakEnd = finite(intent.energyPeak.endSec, "energyPeak.endSec");
  const holdStart = finite(intent.finalRestingHold.startSec, "finalRestingHold.startSec");
  const holdEnd = finite(intent.finalRestingHold.endSec, "finalRestingHold.endSec");
  if (peakStart < 0 || peakEnd <= peakStart || peakEnd > duration) {
    throw new Error("Luna motion intent has an invalid energy peak");
  }
  if (holdStart < 0 || holdEnd <= holdStart || Math.abs(holdEnd - duration) > 0.05) {
    throw new Error("Luna final resting hold must end with the film");
  }
  const finalScene = [...storyboard].sort((left, right) => left.startSec - right.startSec).at(-1)!;
  if (holdStart < finalScene.startSec || holdEnd > finalScene.startSec + finalScene.durationSec + 0.01) {
    throw new Error("Luna final resting hold must stay inside the final scene");
  }
  requireSelector(document, intent.finalRestingHold.primarySelector, "finalRestingHold.primarySelector", true);
  return intent as LunaMotionIntentV1;
}

function sessionPath(projectDir: string): string {
  return path.join(projectDir, "planning", "luna", "session.json");
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function committedCompositionState(projectDir: string): { revision: number; sourceSha256: string } {
  const compositionDir = path.join(projectDir, "composition");
  const manifest = JSON.parse(fs.readFileSync(path.join(compositionDir, "manifest.json"), "utf8")) as {
    revision?: unknown;
  };
  if (typeof manifest.revision !== "number" || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1) {
    throw new Error("Committed Luna composition has an invalid revision");
  }
  return {
    revision: manifest.revision,
    sourceSha256: sha256(fs.readFileSync(path.join(compositionDir, "index.html"))),
  };
}

function acceptancePath(projectDir: string, revision: number): string {
  return path.join(
    projectDir,
    "planning",
    "luna",
    "acceptances",
    `revision-${String(revision).padStart(4, "0")}.json`,
  );
}

function saveSession(
  projectDir: string,
  authored: LunaAuthoredComposition,
): LunaSessionReceiptV1 {
  const file = sessionPath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let previous: LunaSessionReceiptV1 | undefined;
  try {
    previous = JSON.parse(fs.readFileSync(file, "utf8")) as LunaSessionReceiptV1;
  } catch {
    previous = undefined;
  }
  const now = new Date().toISOString();
  const committed = committedCompositionState(projectDir);
  const receipt: LunaSessionReceiptV1 = {
    version: 1,
    workerJobId: authored.worker.jobId,
    workerOperationId: authored.worker.operationId,
    workerRunCount: authored.worker.runCount,
    threadId: authored.worker.threadId,
    codexVersion: authored.worker.codexVersion,
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    durationSec: authored.intent.durationSec,
    committedRevision: committed.revision,
    latestCommittedSourceSha256: committed.sourceSha256,
    latestRawSourceSha256: authored.rawSourceSha256,
    latestArtifactFingerprint: authored.artifactFingerprint,
    latestRunDir: path.relative(projectDir, authored.runDir).replace(/\\/g, "/"),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  writeJsonAtomic(acceptancePath(projectDir, committed.revision), receipt);
  writeJsonAtomic(file, receipt);
  return receipt;
}

/** Persist the thread/hash pointer only after the host has accepted the bytes. */
export function confirmLunaComposition(
  projectDir: string,
  authored: LunaAuthoredComposition,
): LunaSessionReceiptV1 {
  return saveSession(projectDir, authored);
}

export function loadLunaSession(projectDir: string): LunaSessionReceiptV1 | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath(projectDir), "utf8")) as LunaSessionReceiptV1;
    return parsed.version === 1 && parsed.workerJobId && parsed.threadId &&
        Number.isFinite(parsed.durationSec) && parsed.durationSec > 0 &&
        Number.isSafeInteger(parsed.committedRevision) && parsed.committedRevision > 0 &&
        /^[a-f0-9]{64}$/.test(parsed.latestCommittedSourceSha256)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function assertLunaSessionMatchesComposition(
  projectDir: string,
  session: LunaSessionReceiptV1,
): void {
  const committed = committedCompositionState(projectDir);
  if (
    committed.revision !== session.committedRevision ||
    committed.sourceSha256 !== session.latestCommittedSourceSha256
  ) {
    throw new Error(
      "The active composition no longer matches the accepted Luna session. Undo/reconcile it or recreate the film before resuming Luna.",
    );
  }
}

export function reconcileLunaSessionAfterUndo(projectDir: string): boolean {
  let committed: { revision: number; sourceSha256: string };
  try {
    committed = committedCompositionState(projectDir);
  } catch {
    return false;
  }
  const accepted = acceptancePath(projectDir, committed.revision);
  if (!fs.existsSync(accepted)) return false;
  const receipt = JSON.parse(fs.readFileSync(accepted, "utf8")) as LunaSessionReceiptV1;
  if (receipt.latestCommittedSourceSha256 !== committed.sourceSha256) return false;
  writeJsonAtomic(sessionPath(projectDir), receipt);

  const activeAssets = path.join(projectDir, "assets", "luna");
  const committedAssets = path.join(projectDir, "composition", "assets", "luna");
  fs.rmSync(activeAssets, { recursive: true, force: true });
  if (fs.existsSync(committedAssets)) {
    fs.mkdirSync(path.dirname(activeAssets), { recursive: true });
    fs.cpSync(committedAssets, activeAssets, { recursive: true });
  }
  return true;
}

function materializeLunaResult(
  projectDir: string,
  kind: string,
  result: LunaWorkerResult,
  expectedDurationSec: number,
): LunaAuthoredComposition {
  const persisted = persistWorkerResult(projectDir, kind, result);
  const html = requiredText(persisted.files, "composition.html");
  validateLunaHtmlSecurity(html);
  const storyboard = parseStoryboard(requiredText(persisted.files, "storyboard.json"));
  const intent = parseLunaMotionIntent(
    requiredText(persisted.files, "motion-intent.json"),
    html,
    storyboard,
  );
  if (Math.abs(intent.durationSec - expectedDurationSec) > 0.05) {
    throw new Error(
      `Luna authored ${intent.durationSec}s but the verified duration is ${expectedDurationSec}s`,
    );
  }
  requiredText(persisted.files, "director-treatment.md");
  const assetManifest = requiredText(persisted.files, "assets-manifest.json");
  const rawSourceSha256 = sha256(Buffer.from(html, "utf8"));
  const assetFiles = [...persisted.files.entries()]
    .filter(([name]) => name.startsWith("deliverables/assets/luna/"))
    .map(([name, bytes]) => ({
      relativePath: name.slice("deliverables/assets/luna/".length),
      bytes,
    }));
  validateAssetManifest(assetManifest, html, assetFiles, persisted.runDir);
  const artifactFingerprint = sha256([
    `composition:${rawSourceSha256}`,
    `storyboard:${sha256(Buffer.from(requiredText(persisted.files, "storyboard.json"), "utf8"))}`,
    ...assetFiles
      .map((asset) => `${asset.relativePath}:${sha256(asset.bytes)}`)
      .sort(),
  ].join("\n"));
  return {
    draft: { html, storyboard },
    intent,
    worker: result,
    rawSourceSha256,
    artifactFingerprint,
    runDir: persisted.runDir,
    assetFiles,
  };
}

export async function authorLunaComposition(input: {
  projectDir: string;
  jobId: string;
  facts: LunaFactEnvelope;
  assetReferencePaths?: readonly string[];
  assetReferenceRoot?: string;
}): Promise<LunaAuthoredComposition> {
  const files = initialWorkerFiles(
    input.facts,
    input.assetReferencePaths ?? [],
    input.assetReferenceRoot,
  );
  const result = await startLunaWorkerJob(resolveLunaWorkerConfig(), {
    jobId: input.jobId,
    prompt: prompt("luna-director.md"),
    files,
  });
  if (result.jobId !== input.jobId) throw new Error("Luna worker returned a different job ID");
  return materializeLunaResult(input.projectDir, "create", result, input.facts.targetDurationSec);
}

function evidenceFiles(
  projectDir: string,
  thumbnailPaths: readonly string[],
): LunaWorkerInputFile[] {
  const files: LunaWorkerInputFile[] = [];
  const evidenceList: string[] = [];
  for (const [index, source] of thumbnailPaths.entries()) {
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const relative = `inputs/evidence/thumbnails/${String(index + 1).padStart(2, "0")}-${safeLeafName(source, "frame.png")}`;
    files.push(workerInputFile(relative, fs.readFileSync(source)));
    evidenceList.push(`- ${relative}`);
  }
  for (const [source, relative] of [
    [path.join(projectDir, "composition", "index.html"), "inputs/evidence/current/composition.html"],
    [path.join(projectDir, "composition", "STORYBOARD.md"), "inputs/evidence/current/STORYBOARD.md"],
    [path.join(projectDir, "composition", "motion-plan.json"), "inputs/evidence/current/motion-plan.json"],
    [path.join(projectDir, "composition", "qa", "spatial.json"), "inputs/evidence/current/spatial.json"],
    [path.join(projectDir, "composition", "qa", "spatial-guide.png"), "inputs/evidence/current/spatial-guide.png"],
  ] as const) {
    if (!fs.existsSync(source)) continue;
    files.push(workerInputFile(relative, fs.readFileSync(source)));
    evidenceList.push(`- ${relative}`);
  }
  const temporalDir = path.join(projectDir, "build", "qa", "temporal");
  if (fs.existsSync(temporalDir)) {
    for (const entry of fs.readdirSync(temporalDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:json|png)$/i.test(entry.name)) continue;
      const source = path.join(temporalDir, entry.name);
      const relative = `inputs/evidence/temporal/${safeLeafName(entry.name, "evidence")}`;
      files.push(workerInputFile(relative, fs.readFileSync(source)));
      evidenceList.push(`- ${relative}`);
    }
  }
  files.push(workerInputFile("inputs/evidence/README.md", [
    "# Deterministic host evidence",
    "",
    "These files were captured from the mechanically accepted composition bytes:",
    "",
    ...evidenceList,
    "",
    "Review the images and the authored timing code; sparse evidence is not a taste score.",
    "",
  ].join("\n")));
  return files;
}

export async function selfReviewLunaComposition(input: {
  projectDir: string;
  thumbnailPaths: readonly string[];
}): Promise<LunaAuthoredComposition> {
  const session = loadLunaSession(input.projectDir);
  if (!session) throw new Error("Luna session receipt is missing; cannot self-review exact thread");
  assertLunaSessionMatchesComposition(input.projectDir, session);
  const result = await resumeLunaWorkerJob(resolveLunaWorkerConfig(), {
    jobId: session.workerJobId,
    prompt: prompt("luna-self-review.md"),
    files: evidenceFiles(input.projectDir, input.thumbnailPaths),
  });
  if (result.threadId !== session.threadId) {
    throw new Error("Luna worker resumed a different Codex thread");
  }
  if (result.jobId !== session.workerJobId) {
    throw new Error("Luna worker returned a different job ID");
  }
  if (result.runCount <= session.workerRunCount) {
    throw new Error("Luna worker did not advance the exact director thread");
  }
  return materializeLunaResult(input.projectDir, "self-review", result, session.durationSec);
}

export async function reviseLunaComposition(input: {
  projectDir: string;
  instruction: string;
}): Promise<LunaAuthoredComposition> {
  const session = loadLunaSession(input.projectDir);
  if (!session) throw new Error("Luna session receipt is missing; use the explicit legacy route for legacy films");
  assertLunaSessionMatchesComposition(input.projectDir, session);
  const currentFiles: LunaWorkerInputFile[] = [
    workerInputFile("inputs/revision.json", JSON.stringify({
      version: 1,
      instruction: input.instruction,
    }, null, 2) + "\n"),
  ];
  for (const [source, relative] of [
    [path.join(input.projectDir, "composition", "index.html"), "inputs/current/composition.html"],
    [path.join(input.projectDir, "composition", "manifest.json"), "inputs/current/manifest.json"],
    [path.join(input.projectDir, "composition", "motion-plan.json"), "inputs/current/motion-plan.json"],
  ] as const) {
    if (fs.existsSync(source)) currentFiles.push(workerInputFile(relative, fs.readFileSync(source)));
  }
  const currentAssetsRoot = path.join(input.projectDir, "composition", "assets", "luna");
  const appendCurrentAssets = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Committed Luna assets cannot contain symbolic links");
      if (entry.isDirectory()) {
        appendCurrentAssets(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(currentAssetsRoot, absolutePath).replace(/\\/g, "/");
      currentFiles.push(workerInputFile(`inputs/current/assets/luna/${relativePath}`, fs.readFileSync(absolutePath)));
    }
  };
  if (fs.existsSync(currentAssetsRoot)) appendCurrentAssets(currentAssetsRoot);
  const result = await resumeLunaWorkerJob(resolveLunaWorkerConfig(), {
    jobId: session.workerJobId,
    prompt: prompt("luna-revision.md"),
    files: currentFiles,
  });
  if (result.threadId !== session.threadId) {
    throw new Error("Luna worker resumed a different Codex thread");
  }
  if (result.jobId !== session.workerJobId) {
    throw new Error("Luna worker returned a different job ID");
  }
  if (result.runCount <= session.workerRunCount) {
    throw new Error("Luna worker did not advance the exact director thread");
  }
  return materializeLunaResult(input.projectDir, "revision", result, session.durationSec);
}

export function activateLunaAssets(
  projectDir: string,
  assetFiles: readonly { relativePath: string; bytes: Buffer }[],
): LunaAssetTransaction {
  const target = path.join(projectDir, "assets", "luna");
  const backup = path.join(projectDir, `.luna-assets-backup-${randomUUID()}`);
  const root = path.resolve(target) + path.sep;
  const prepared = assetFiles.map((asset) => {
    const relative = normalizeWorkerPath(asset.relativePath);
    const destination = path.resolve(target, relative);
    if (!destination.startsWith(root)) {
      throw new Error("Luna asset escaped the project asset directory");
    }
    return { ...asset, destination };
  });
  if (new Set(prepared.map((asset) => asset.destination)).size !== prepared.length) {
    throw new Error("Luna asset bundle contains duplicate paths");
  }
  let hadPrevious = false;
  if (fs.existsSync(target)) {
    fs.renameSync(target, backup);
    hadPrevious = true;
  }
  try {
    fs.mkdirSync(target, { recursive: true });
    for (const asset of prepared) {
      fs.mkdirSync(path.dirname(asset.destination), { recursive: true });
      fs.writeFileSync(asset.destination, asset.bytes);
    }
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (hadPrevious && fs.existsSync(backup)) fs.renameSync(backup, target);
    else fs.rmSync(backup, { recursive: true, force: true });
    throw error;
  }
  let settled = false;
  return {
    commit() {
      if (settled) return;
      try {
        fs.rmSync(backup, { recursive: true, force: true });
      } catch {
        // The new asset set is already active. A stale random-named backup is
        // safer than turning a fully accepted film into a partial rollback.
      }
      settled = true;
    },
    rollback() {
      if (settled) return;
      settled = true;
      fs.rmSync(target, { recursive: true, force: true });
      if (hadPrevious && fs.existsSync(backup)) fs.renameSync(backup, target);
      else fs.rmSync(backup, { recursive: true, force: true });
    },
  };
}
