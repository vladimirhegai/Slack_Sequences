/**
 * Browser QA for direct HyperFrames compositions.
 *
 * The installed runtime is pinned at HyperFrames 0.6.86 while the vendored CLI
 * source is newer and intentionally not installed in Railway. This adapter uses
 * the vendored inspector's browser audit (including local regression fixes),
 * then adds the small set of Sequences-specific relational checks that
 * HyperFrames cannot infer.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DirectCompositionDraft, DirectScene } from "./directComposition.ts";
import {
  INTERACTION_RUNTIME_FILE,
  interactionRuntimeSource,
  parseInteractionPlan,
  type InteractionIntentV1,
} from "./interactionContract.ts";
import {
  CUT_RUNTIME_FILE,
  cutMotionWindows,
  cutRuntimeSource,
  parseCutPlan,
} from "./cutContract.ts";
import {
  CAMERA_RUNTIME_FILE,
  cameraMotionWindows,
  cameraRuntimeSource,
  parseCameraPlan,
} from "./cameraContract.ts";
import {
  COMPONENT_RUNTIME_FILE,
  componentMotionWindows,
  componentRuntimeSource,
  parseComponentPlan,
} from "./componentContract.ts";
import {
  TIME_RUNTIME_FILE,
  parseTimeRampPlan,
  timeRampRuntimeSource,
  warpInverseOf,
} from "./timeRamp.ts";
import { findBrowserExecutable } from "./render.ts";

export type LayoutSeverity = "error" | "warning" | "info";

export interface DirectLayoutIssue {
  code: string;
  severity: LayoutSeverity;
  time: number;
  /** Stable storyboard interaction id when this finding belongs to an optional interaction. */
  interactionId?: string;
  firstSeen?: number;
  lastSeen?: number;
  occurrences?: number;
  selector: string;
  containerSelector?: string;
  text?: string;
  message: string;
  fixHint?: string;
  source: "hyperframes" | "sequences";
}

export interface DirectBrowserQaResult {
  /** True when the document loaded, initialized its timeline, and ran without browser errors. */
  ok: boolean;
  /** True when runtime validation passed and no visual quality findings request polish. */
  strictOk: boolean;
  /** Present only when browser QA could not execute; this is not evidence that the draft is bad. */
  infraError?: string;
  samples: number[];
  issues: DirectLayoutIssue[];
  interactions?: DirectInteractionEvidence[];
  /** Measured per-boundary focal-part geometry (feeds cut discovery). */
  boundaries?: DirectBoundaryInventory[];
  errors: string[];
  warnings: string[];
  guidePngBase64?: string;
}

/** One visible data-part measured near a scene boundary (viewport space). */
export interface BoundaryPartMeasurement {
  part: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Border radius resolved to px (percentages resolved against the box). */
  radiusPx: number;
  /** Subtree size including the element itself — bridge-clone paint cost. */
  nodeCount: number;
  /** Fraction of the part's area inside the frame, 0..1. */
  onFrameRatio: number;
}

/**
 * Measured geometry on both sides of one scene boundary: the outgoing scene
 * sampled just before the cut, the incoming scene sampled after its entry
 * settles. Strictly better data than the runtime's bind-time audit, which
 * only sees load state.
 */
export interface DirectBoundaryInventory {
  fromScene: string;
  toScene: string;
  atSec: number;
  outgoing: BoundaryPartMeasurement[];
  incoming: BoundaryPartMeasurement[];
}

export interface DirectInteractionEvidence {
  id: string;
  phase: "path" | "arrival" | "press" | "release" | "hold";
  time: number;
  cursor: { x: number; y: number };
  target: { x: number; y: number };
  deltaPx: number;
  hit: boolean;
}

interface RuntimeMessage {
  level: "error" | "warning";
  text: string;
}

const MAX_LAYOUT_SAMPLES = 48;
const SEEK_SETTLE_MS = 90;
const CLI_BROWSER_SCRIPTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../vendor/hyperframes/packages/cli/src/commands",
);

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function uniqueTimes(values: number[], duration: number): number[] {
  return [...new Set(values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= duration)
    .map(roundTime))]
    .sort((a, b) => a - b);
}

/** Hero frames plus every known cut/tween boundary and the interval midpoints. */
export function buildDirectLayoutSampleTimes(
  scenes: DirectScene[],
  tweenBoundaries: number[],
  duration: number,
  cap = MAX_LAYOUT_SAMPLES,
): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const heroes = scenes.map((scene) => scene.startSec + scene.durationSec * 0.58);
  const cuts = scenes.flatMap((scene) => [
    scene.startSec,
    scene.startSec + scene.durationSec,
  ]);
  const intents = scenes.flatMap((scene) => scene.interactions ?? []);
  const interactions = intents.flatMap((interaction) => [
    interaction.startSec,
    interaction.startSec + (interaction.arriveSec - interaction.startSec) / 2,
    interaction.arriveSec,
    ...(interaction.pressSec !== undefined
      ? [interaction.pressSec, interaction.pressSec + 0.02]
      : []),
    ...(interaction.releaseSec !== undefined ? [interaction.releaseSec] : []),
    ...(interaction.holdUntilSec !== undefined ? [interaction.holdUntilSec] : []),
  ]);
  const boundaries = uniqueTimes(
    [0, duration, ...cuts, ...interactions, ...tweenBoundaries],
    duration,
  );
  const midpoints = boundaries.slice(0, -1).map((value, index) => {
    const next = boundaries[index + 1] ?? value;
    return (value + next) / 2;
  });
  const all = uniqueTimes([...heroes, ...boundaries, ...midpoints], duration);
  if (all.length <= cap) return all;

  // Preserve authored interaction evidence and hero frames, then evenly stride
  // the remaining boundary
  // evidence so Railway memory/time stays bounded on unusually dense timelines.
  const interactionPriority = uniqueTimes([
    ...intents.flatMap((intent) =>
      intent.pressSec !== undefined ? [intent.pressSec, intent.pressSec + 0.02] : []
    ),
    ...intents.map((intent) => intent.arriveSec),
    ...intents.flatMap((intent) =>
      intent.releaseSec !== undefined ? [intent.releaseSec] : []
    ),
    ...intents.map((intent) =>
      intent.startSec + (intent.arriveSec - intent.startSec) / 2
    ),
    ...intents.flatMap((intent) =>
      intent.holdUntilSec !== undefined ? [intent.holdUntilSec] : []
    ),
  ], duration);
  const kept = new Set(uniqueTimes(heroes, duration).slice(0, cap));
  for (const time of interactionPriority) {
    if (kept.size >= cap) break;
    kept.add(time);
  }
  const remaining = all.filter((time) => !kept.has(time));
  const slots = Math.max(0, cap - kept.size);
  for (let index = 0; index < slots; index += 1) {
    const pick = remaining[Math.floor((index * Math.max(0, remaining.length - 1)) / Math.max(1, slots - 1))];
    if (pick !== undefined) kept.add(pick);
  }
  return [...kept].sort((a, b) => a - b);
}

function loadBrowserAudit(name: "layout-audit.browser.js" | "contrast-audit.browser.js"): string {
  const file = path.join(CLI_BROWSER_SCRIPTS, name);
  if (!fs.existsSync(file)) throw new Error(`vendored HyperFrames browser audit is missing: ${name}`);
  return fs.readFileSync(file, "utf8");
}

/* ------------------------------------------------------- QA evidence cache */

/**
 * Browser QA is deterministic for a given document: same bytes, same runtimes,
 * same audits → same verdict. A successful inspection is therefore cached on
 * disk keyed by content hash, so the pipeline never pays a second Chrome pass
 * for a draft it already proved healthy — most importantly the publication
 * commit (`submit_composition`), which re-inspects the exact bytes the
 * authoring loop just validated, usually from the MCP subprocess. Only fully
 * successful, non-infra results are cached; every failing or degraded draft is
 * always re-measured live. Opt out with SLACK_SEQUENCES_QA_CACHE=0.
 */
const QA_CACHE_VERSION = 1;

/** Everything environment-side that can change the verdict for the same draft. */
let cachedStaticFingerprint: string | undefined;
function qaStaticFingerprint(): string {
  if (cachedStaticFingerprint) return cachedStaticFingerprint;
  cachedStaticFingerprint = createHash("sha256")
    .update(JSON.stringify({
      version: QA_CACHE_VERSION,
      runtimes: [
        interactionRuntimeSource(),
        cutRuntimeSource(),
        cameraRuntimeSource(),
        componentRuntimeSource(),
        timeRampRuntimeSource(),
      ].map((source) => createHash("sha256").update(source).digest("hex")),
      audits: [
        loadBrowserAudit("layout-audit.browser.js"),
        loadBrowserAudit("contrast-audit.browser.js"),
      ].map((source) => createHash("sha256").update(source).digest("hex")),
      interactionQaMode: process.env.SLACK_SEQUENCES_INTERACTION_QA?.trim().toLowerCase() ?? "",
    }))
    .digest("hex");
  return cachedStaticFingerprint;
}

function qaCacheEnabled(): boolean {
  return process.env.SLACK_SEQUENCES_QA_CACHE !== "0";
}

function qaCacheKey(draft: DirectCompositionDraft): string {
  return createHash("sha256")
    .update(qaStaticFingerprint())
    .update(" ")
    .update(draft.html)
    .update(" ")
    .update(JSON.stringify(draft.storyboard))
    .digest("hex");
}

function qaCacheFile(projectDir: string, key: string): string {
  return path.join(path.resolve(projectDir), "qa-cache", `${key.slice(0, 32)}.json`);
}

function readQaCache(projectDir: string, key: string): DirectBrowserQaResult | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(qaCacheFile(projectDir, key), "utf8")) as {
      version?: number;
      key?: string;
      result?: DirectBrowserQaResult;
    };
    if (parsed.version === QA_CACHE_VERSION && parsed.key === key && parsed.result?.ok) {
      return parsed.result;
    }
  } catch {
    // Missing/partial cache entries are simply a miss.
  }
  return undefined;
}

function writeQaCache(projectDir: string, key: string, result: DirectBrowserQaResult): void {
  // Cache only clean, fully measured passes: a failing draft is always
  // re-measured live, and an infra fault is not evidence about the draft.
  if (!result.ok || result.infraError) return;
  try {
    const file = qaCacheFile(projectDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: QA_CACHE_VERSION, key, result }) + "\n",
      "utf8",
    );
    fs.renameSync(temporary, file);
  } catch {
    // Cache bookkeeping must never disturb a build.
  }
}

function prepareScratch(projectDir: string, draft: DirectCompositionDraft): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-layout-"));
  fs.writeFileSync(path.join(scratch, "index.html"), draft.html.trim() + "\n");
  const require = createRequire(import.meta.url);
  fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(scratch, "gsap.min.js"));
  fs.writeFileSync(
    path.join(scratch, INTERACTION_RUNTIME_FILE),
    interactionRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, CUT_RUNTIME_FILE),
    cutRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, CAMERA_RUNTIME_FILE),
    cameraRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, COMPONENT_RUNTIME_FILE),
    componentRuntimeSource(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(scratch, TIME_RUNTIME_FILE),
    timeRampRuntimeSource(),
    "utf8",
  );
  const assets = path.join(projectDir, "assets");
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(scratch, "assets"), { recursive: true });
  return scratch;
}

function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dir, "." + pathname.replace(/\/$/, "/index.html"));
      const root = path.resolve(dir);
      if (
        (file !== root && !file.startsWith(root + path.sep)) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": mime[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      response.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not bind browser QA server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function collectTweenBoundaries(page: import("puppeteer-core").Page): Promise<number[]> {
  return page.evaluate(() => {
    type AnimationLike = {
      startTime?: () => number;
      duration?: () => number;
      timeScale?: () => number;
      parent?: AnimationLike | null;
      getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => AnimationLike[];
    };
    const read = (
      fn: (() => number) | undefined,
      self: AnimationLike,
      fallback: number,
    ): number => typeof fn === "function" ? fn.call(self) : fallback;
    const toRootTime = (root: AnimationLike, animation: AnimationLike, local: number): number => {
      let time = local;
      let node: AnimationLike | null | undefined = animation;
      while (node && node !== root) {
        time = read(node.startTime, node, 0) + time / (read(node.timeScale, node, 1) || 1);
        node = node.parent;
      }
      return time;
    };
    const timelines = (window as unknown as {
      __timelines?: Record<string, AnimationLike & { __seqChild?: AnimationLike }>;
    }).__timelines ?? {};
    // A time-ramped film registers the warped master, whose only child is the
    // warp proxy; the authored tween boundaries live on the wrapped content
    // timeline it exposes as __seqChild (boundaries stay content time).
    return Object.values(timelines)
      .map((timeline) => timeline.__seqChild ?? timeline)
      .flatMap((timeline) => {
        try {
          return (timeline.getChildren?.(true, true, false) ?? []).flatMap((tween) => [
            toRootTime(timeline, tween, 0),
            toRootTime(timeline, tween, read(tween.duration, tween, 0)),
          ]);
        } catch {
          return [];
        }
      }).filter(Number.isFinite);
  });
}

async function seekTo(page: import("puppeteer-core").Page, time: number): Promise<void> {
  await page.evaluate((at: number) => {
    const timelines = (window as unknown as {
      __timelines?: Record<string, { pause?: () => void; seek?: (time: number, suppressEvents?: boolean) => void }>;
    }).__timelines ?? {};
    for (const timeline of Object.values(timelines)) {
      timeline.pause?.();
      timeline.seek?.(at, false);
    }
  }, time);
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  await new Promise((resolve) => setTimeout(resolve, SEEK_SETTLE_MS));
}

async function auditSequencesRelationships(
  page: import("puppeteer-core").Page,
  time: number,
): Promise<DirectLayoutIssue[]> {
  return page.evaluate((at: number) => {
    type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
    type BrowserIssue = Omit<DirectLayoutIssue, "source">;
    const root = document.querySelector<HTMLElement>("[data-composition-id][data-width][data-height]");
    if (!root) return [];
    const rootRect = root.getBoundingClientRect();
    const rect = (element: Element): Rect => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const selector = (element: Element): string => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const name = element.getAttribute("data-layout-name");
      if (name) return `[data-layout-name="${name.replaceAll('"', '\\"')}"]`;
      return element.tagName.toLowerCase();
    };
    const ignored = (element: Element): boolean => Boolean(element.closest("[data-layout-ignore]"));
    const visible = (element: Element): boolean => {
      if (ignored(element)) return false;
      const value = rect(element);
      if (value.width < 1 || value.height < 1) return false;
      let node: Element | null = element;
      let opacity = 1;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number.parseFloat(style.opacity) || 0;
        node = node.parentElement;
      }
      return opacity >= 0.2;
    };
    const issue = (
      code: string,
      severity: LayoutSeverity,
      element: Element,
      message: string,
      fixHint: string,
      container?: Element,
    ): BrowserIssue => ({
      code,
      severity,
      time: at,
      selector: selector(element),
      ...(container ? { containerSelector: selector(container) } : {}),
      message,
      fixHint,
    });
    const issues: BrowserIssue[] = [];
    const cssSafe = Number.parseFloat(getComputedStyle(root).getPropertyValue("--space-safe"));
    const safe = Number.isFinite(cssSafe) && cssSafe > 0
      ? cssSafe
      : Math.round(Math.min(rootRect.width, rootRect.height) * 0.06);

    // Camera-rig worlds are deliberately larger than the frame: content that
    // sits in a currently-unframed region is expected to be off screen, and
    // frame-relative anchors stop being meaningful once the world plane
    // carries a camera transform.
    const movedWorld = (element: Element): boolean => {
      const world = element.closest<HTMLElement>("[data-camera-world]");
      if (!world) return false;
      const transform = getComputedStyle(world).transform;
      return Boolean(transform) && transform !== "none" &&
        transform !== "matrix(1, 0, 0, 1, 0, 0)";
    };
    const mostlyOffFrame = (value: Rect): boolean => {
      const width = Math.max(0, Math.min(value.right, rootRect.right) - Math.max(value.left, rootRect.left));
      const height = Math.max(0, Math.min(value.bottom, rootRect.bottom) - Math.max(value.top, rootRect.top));
      const area = value.width * value.height;
      return area <= 0 || (width * height) / area < 0.6;
    };

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-important]"))) {
      if (!visible(element) || element.closest("[data-layout-allow-overflow]")) continue;
      const value = rect(element);
      if (movedWorld(element) && mostlyOffFrame(value)) continue;
      const overflow = Math.max(
        rootRect.left + safe - value.left,
        rootRect.top + safe - value.top,
        value.right - (rootRect.right - safe),
        value.bottom - (rootRect.bottom - safe),
      );
      if (overflow > 2) {
        issues.push(issue(
          "important_safe_area",
          "warning",
          element,
          `Load-bearing content crosses the ${safe}px safe canvas inset by ${Math.round(overflow)}px.`,
          "Keep it in the .scene flow container; give it a .zone and widen the named layout track before wrapping or reducing type.",
          root,
        ));
      }
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-anchor]"))) {
      if (!visible(element) || movedWorld(element)) continue;
      const intent = element.dataset.layoutAnchor ?? "";
      const value = rect(element);
      const centerX = value.left + value.width / 2;
      const centerY = value.top + value.height / 2;
      const opticalX = Number.parseFloat(element.dataset.layoutOpticalX ?? "0") || 0;
      const opticalY = Number.parseFloat(element.dataset.layoutOpticalY ?? "0") || 0;
      const tolerance = Number.parseFloat(element.dataset.layoutTolerance ?? "12") || 12;
      let dx = 0;
      let dy = 0;
      if (intent === "frame:center") {
        dx = centerX - (rootRect.left + rootRect.width / 2 + opticalX);
        dy = centerY - (rootRect.top + rootRect.height / 2 + opticalY);
      } else if (intent === "frame:left-third") {
        dx = centerX - (rootRect.left + rootRect.width / 3 + opticalX);
      } else if (intent === "frame:right-third") {
        dx = centerX - (rootRect.left + rootRect.width * 2 / 3 + opticalX);
      } else if (intent === "frame:top-third") {
        dy = centerY - (rootRect.top + rootRect.height / 3 + opticalY);
      } else if (intent === "frame:bottom-third") {
        dy = centerY - (rootRect.top + rootRect.height * 2 / 3 + opticalY);
      } else {
        issues.push(issue(
          "layout_anchor_invalid",
          "warning",
          element,
          `Unknown layout anchor "${intent}".`,
          "Use frame:center, frame:left-third, frame:right-third, frame:top-third, or frame:bottom-third.",
        ));
        continue;
      }
      if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
        issues.push(issue(
          "layout_anchor_mismatch",
          "warning",
          element,
          `Declared ${intent} anchor misses by ${Math.round(dx)}px x / ${Math.round(dy)}px y.`,
          "Let Grid/Flexbox settle the declared anchor; reserve transforms for motion.",
          root,
        ));
      }
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-align]"))) {
      if (!visible(element)) continue;
      const declaration = element.dataset.layoutAlign ?? "";
      const split = declaration.indexOf(":");
      const edge = split > 0 ? declaration.slice(0, split) : "";
      const targetSelector = split > 0 ? declaration.slice(split + 1) : "";
      let target: Element | null = null;
      try {
        target = targetSelector ? root.querySelector(targetSelector) : null;
      } catch {
        target = null;
      }
      if (!target || !visible(target)) {
        issues.push(issue(
          "layout_target_missing",
          "warning",
          element,
          `Alignment target "${targetSelector || "(missing)"}" is absent or invisible.`,
          "Use a stable id on the intended target.",
        ));
        continue;
      }
      const value = rect(element);
      const targetRect = rect(target);
      const coordinates: Record<string, [number, number]> = {
        left: [value.left, targetRect.left],
        right: [value.right, targetRect.right],
        top: [value.top, targetRect.top],
        bottom: [value.bottom, targetRect.bottom],
        "center-x": [value.left + value.width / 2, targetRect.left + targetRect.width / 2],
        "center-y": [value.top + value.height / 2, targetRect.top + targetRect.height / 2],
      };
      const pair = coordinates[edge];
      const tolerance = Number.parseFloat(element.dataset.layoutTolerance ?? "8") || 8;
      if (!pair) {
        issues.push(issue(
          "layout_alignment_invalid",
          "warning",
          element,
          `Unknown relational alignment "${edge}".`,
          "Use left, right, top, bottom, center-x, or center-y.",
          target,
        ));
      } else if (Math.abs(pair[0] - pair[1]) > tolerance) {
        issues.push(issue(
          "layout_alignment_mismatch",
          "warning",
          element,
          `${edge} is ${Math.round(Math.abs(pair[0] - pair[1]))}px away from ${targetSelector}.`,
          "Put both elements in one Grid/Flex layout or derive them from the same inset variable.",
          target,
        ));
      }
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-attach]"))) {
      if (!visible(element)) continue;
      const targetSelector = element.dataset.layoutAttach ?? "";
      let target: Element | null = null;
      try {
        target = targetSelector ? root.querySelector(targetSelector) : null;
      } catch {
        target = null;
      }
      if (!target || !visible(target)) {
        issues.push(issue(
          "layout_attachment_missing",
          "warning",
          element,
          `Attachment target "${targetSelector || "(missing)"}" is absent or invisible.`,
          "Wrap the exact target word in a stable id and attach the decoration to that wrapper.",
        ));
        continue;
      }
      const a = rect(element);
      const b = rect(target);
      const dx = Math.max(b.left - a.right, a.left - b.right, 0);
      const dy = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
      const distance = Math.hypot(dx, dy);
      const tolerance = Number.parseFloat(element.dataset.layoutTolerance ?? "24") || 24;
      if (distance > tolerance) {
        issues.push(issue(
          "layout_attachment_detached",
          "warning",
          element,
          `Decoration is ${Math.round(distance)}px from ${targetSelector}.`,
          "Move it inside the measured text wrapper or implement the stroke as a pseudo-element.",
          target,
        ));
      }
      const identity = [
        element.id,
        element.className,
        element.dataset.layoutRole,
      ].join(" ").toLowerCase();
      const annotationKind = /\b(?:underline|underbar|marker|highlight|stroke)\b/.test(identity);
      const lineLike =
        a.width >= Math.max(8, a.height * 2) &&
        a.height <= Math.min(32, Math.max(8, b.height * 0.45));
      if (annotationKind || lineLike) {
        const widthRatio = b.width > 0 ? a.width / b.width : 1;
        const centerDelta = Math.abs(
          (a.left + a.width / 2) - (b.left + b.width / 2),
        );
        const centerTolerance = Math.max(12, b.width * 0.18);
        if (widthRatio < 0.55 || widthRatio > 1.45) {
          issues.push(issue(
            "layout_annotation_width_mismatch",
            "warning",
            element,
            `Attached annotation is ${Math.round(widthRatio * 100)}% of ${targetSelector}'s width.`,
            "Size the marker from its measured text wrapper with left/right or inline-size:100%.",
            target,
          ));
        }
        if (centerDelta > centerTolerance) {
          issues.push(issue(
            "layout_annotation_alignment_mismatch",
            "warning",
            element,
            `Attached annotation is horizontally offset from ${targetSelector} by ${Math.round(centerDelta)}px.`,
            "Keep the marker inside the text wrapper and derive both horizontal edges from that wrapper.",
            target,
          ));
        }
        const underlineLike = /\b(?:underline|underbar|stroke)\b/.test(identity);
        if (
          underlineLike &&
          (
            a.top + a.height / 2 < b.top + b.height * 0.55 ||
            a.top + a.height / 2 > b.bottom + b.height * 0.35
          )
        ) {
          issues.push(issue(
            "layout_annotation_vertical_mismatch",
            "warning",
            element,
            `Underline is outside ${targetSelector}'s lower text band.`,
            "Anchor it to the wrapper baseline (for example bottom:.06em), not to canvas coordinates.",
            target,
          ));
        }
      }
    }

    for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-gap]"))) {
      if (!visible(group)) continue;
      const axis = group.dataset.layoutGap;
      if (axis !== "x" && axis !== "y") {
        issues.push(issue(
          "layout_gap_invalid",
          "warning",
          group,
          `Unknown gap axis "${axis ?? ""}".`,
          'Use data-layout-gap="x" or data-layout-gap="y".',
        ));
        continue;
      }
      const children = Array.from(group.children)
        .filter(visible)
        .map((child) => ({ child, rect: rect(child) }));
      children.sort((a, b) => axis === "x" ? a.rect.left - b.rect.left : a.rect.top - b.rect.top);
      const gaps = children.slice(1).map((entry, index) => {
        const previous = children[index]!.rect;
        return axis === "x" ? entry.rect.left - previous.right : entry.rect.top - previous.bottom;
      });
      if (gaps.length < 2) continue;
      const spread = Math.max(...gaps) - Math.min(...gaps);
      const tolerance = Number.parseFloat(group.dataset.layoutTolerance ?? "8") || 8;
      if (spread > tolerance) {
        issues.push(issue(
          "layout_gap_inconsistent",
          "warning",
          group,
          `Declared ${axis}-axis gaps vary by ${Math.round(spread)}px.`,
          "Use one CSS gap token on the group instead of independent child offsets.",
        ));
      }
    }

    for (const scene of Array.from(root.querySelectorAll<HTMLElement>("[data-scene]"))) {
      if (!visible(scene)) continue;
      const declared = scene.matches(
        "[data-layout-important],[data-layout-anchor],[data-layout-align],[data-layout-attach],[data-layout-gap]",
      ) || Boolean(scene.querySelector(
        "[data-layout-important],[data-layout-anchor],[data-layout-align],[data-layout-attach],[data-layout-gap]",
      ));
      if (!declared) {
        issues.push(issue(
          "layout_intent_missing",
          "warning",
          scene,
          "Visible scene declares no relational layout intent.",
          "Declare only the load-bearing anchor, alignment, attachment, safe-area, or group-gap relationships.",
        ));
      }
    }
    return issues.map((value) => ({ ...value, source: "sequences" as const }));
  }, time);
}

function interactionPhase(
  intent: InteractionIntentV1,
  time: number,
): DirectInteractionEvidence["phase"] | undefined {
  const tolerance = 0.035;
  if (Math.abs(time - intent.arriveSec) <= tolerance) return "arrival";
  if (intent.pressSec !== undefined && Math.abs(time - intent.pressSec) <= tolerance) return "press";
  if (intent.releaseSec !== undefined && Math.abs(time - intent.releaseSec) <= tolerance) return "release";
  if (intent.holdUntilSec !== undefined && Math.abs(time - intent.holdUntilSec) <= tolerance) return "hold";
  if (time >= intent.startSec && time < intent.arriveSec) return "path";
  return undefined;
}

async function auditInteractions(
  page: import("puppeteer-core").Page,
  intents: InteractionIntentV1[],
  time: number,
): Promise<{ issues: DirectLayoutIssue[]; evidence: DirectInteractionEvidence[] }> {
  const active = intents
    .map((intent) => ({ intent, phase: interactionPhase(intent, time) }))
    .filter((entry): entry is {
      intent: InteractionIntentV1;
      phase: DirectInteractionEvidence["phase"];
    } => Boolean(entry.phase));
  if (!active.length) return { issues: [], evidence: [] };
  return page.evaluate((payload) => {
    type Rect = {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    };
    const root = document.querySelector<HTMLElement>("[data-composition-id][data-width][data-height]");
    if (!root) return { issues: [], evidence: [] };
    const rect = (element: Element): Rect => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const visible = (element: Element): boolean => {
      const value = rect(element);
      if (value.width < 1 || value.height < 1) return false;
      let opacity = 1;
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number.parseFloat(style.opacity) || 0;
        node = node.parentElement;
      }
      return opacity >= 0.15;
    };
    const issues: DirectLayoutIssue[] = [];
    const evidence: DirectInteractionEvidence[] = [];
    const add = (
      code: string,
      element: Element | null,
      id: string,
      message: string,
      fixHint: string,
    ): void => {
      issues.push({
        code,
        severity: "error",
        time: payload.time,
        interactionId: id,
        selector: element?.id ? `#${CSS.escape(element.id)}` : `[interaction="${id}"]`,
        message,
        fixHint,
        source: "sequences",
      });
    };
    for (const entry of payload.active) {
      const intent: InteractionIntentV1 = entry.intent;
      const scene: HTMLElement | null = root.querySelector<HTMLElement>(
        `[data-scene="${CSS.escape(intent.sceneId)}"]`,
      );
      const cursorMatches: NodeListOf<HTMLElement> = root.querySelectorAll<HTMLElement>(
        `[data-cursor-id="${CSS.escape(intent.cursorId)}"]`,
      );
      const cursor: HTMLElement | null = cursorMatches[0] ?? null;
      const targetName = intent.action === "drag" && entry.phase === "release" &&
          intent.dragTargetPart
        ? intent.dragTargetPart
        : intent.targetPart;
      const targetMatches: NodeListOf<HTMLElement> | undefined =
        scene?.querySelectorAll<HTMLElement>(
        `[data-part="${CSS.escape(targetName)}"]`,
      );
      const target: HTMLElement | null = targetMatches?.[0] ?? null;
      if (!scene || !cursor || !target) {
        add(
          "interaction_binding_missing",
          cursor ?? target,
          intent.id,
          `Interaction "${intent.id}" cannot resolve its scene, cursor, or target part.`,
          "Bind stable data-scene, data-cursor-id, and data-part values before authoring motion.",
        );
        continue;
      }
      if (cursorMatches.length !== 1 || targetMatches?.length !== 1) {
        add(
          "interaction_binding_ambiguous",
          cursor ?? target,
          intent.id,
          `Interaction "${intent.id}" requires one cursor and one scene-scoped target part.`,
          "Make data-cursor-id unique in the composition and data-part unique within the scene.",
        );
      }
      if (cursor.closest("[data-camera-world]")) {
        add(
          "interaction_camera_coupling",
          cursor,
          intent.id,
          "Cursor is inside data-camera-world and inherits product camera transforms.",
          "Move the cursor into the scene/root data-camera-overlay.",
        );
      }
      const overlay: HTMLElement | null = cursor.parentElement;
      if (
        !overlay?.hasAttribute("data-camera-overlay") ||
        (overlay.parentElement !== scene && overlay.parentElement !== root)
      ) {
        add(
          "interaction_overlay_invalid",
          cursor,
          intent.id,
          "Cursor must be a direct child of a scene/root data-camera-overlay.",
          "Use a fixed overlay sibling of data-camera-world.",
        );
      }
      if (cursor.closest("[data-layout-ignore]") || target.closest("[data-layout-ignore]")) {
        add(
          "interaction_ignored",
          cursor,
          intent.id,
          "Active cursor or target is hidden from spatial inspection.",
          "Remove data-layout-ignore from interaction actors.",
        );
      }
      if (getComputedStyle(cursor).pointerEvents !== "none") {
        add(
          "interaction_pointer_events",
          cursor,
          intent.id,
          "Decorative cursor can intercept the target.",
          "Set pointer-events:none on the cursor.",
        );
      }
      const entryFadeSec = Math.min(
        0.14,
        (intent.arriveSec - intent.startSec) * 0.18,
      );
      const inEntryFade =
        entry.phase === "path" &&
        payload.time <= intent.startSec + entryFadeSec + 0.01;
      const targetBox = rect(target);
      // A target may intentionally reveal while the cursor approaches it. The
      // runtime only needs stable geometry during the path; visibility becomes
      // mandatory at arrival and remains mandatory through press/release/hold.
      const targetReady = entry.phase === "path"
        ? targetBox.width >= 1 && targetBox.height >= 1
        : visible(target);
      if ((!visible(cursor) && !inEntryFade) || !targetReady) {
        add(
          "interaction_not_visible",
          !visible(cursor) ? cursor : target,
          intent.id,
          `Cursor or target is not visible during ${entry.phase}.`,
          "Keep both visible from arrival through release/result hold.",
        );
        continue;
      }
      const cursorRect = rect(cursor);
      const targetRect = targetBox;
      const hotspotX = Math.max(
        0,
        Math.min(1, Number.parseFloat(cursor.dataset.cursorHotspotX ?? "0") || 0),
      );
      const hotspotY = Math.max(
        0,
        Math.min(1, Number.parseFloat(cursor.dataset.cursorHotspotY ?? "0") || 0),
      );
      const cursorPoint = {
        x: cursorRect.left + cursorRect.width * hotspotX,
        y: cursorRect.top + cursorRect.height * hotspotY,
      };
      const requestedTargetPoint = {
        x: targetRect.left + targetRect.width * intent.aimX + (intent.offsetX ?? 0),
        y: targetRect.top + targetRect.height * intent.aimY + (intent.offsetY ?? 0),
      };
      const inset = Math.min(
        Math.max(
          2,
          intent.hitInsetPx ??
            Math.min(12, Math.min(targetRect.width, targetRect.height) * 0.14),
        ),
        Math.max(0, targetRect.width / 2 - 0.5),
        Math.max(0, targetRect.height / 2 - 0.5),
      );
      const targetPoint = {
        x: Math.max(
          targetRect.left + inset,
          Math.min(targetRect.right - inset, requestedTargetPoint.x),
        ),
        y: Math.max(
          targetRect.top + inset,
          Math.min(targetRect.bottom - inset, requestedTargetPoint.y),
        ),
      };
      const hit =
        cursorPoint.x >= targetRect.left + inset &&
        cursorPoint.x <= targetRect.right - inset &&
        cursorPoint.y >= targetRect.top + inset &&
        cursorPoint.y <= targetRect.bottom - inset;
      const deltaPx = Math.hypot(
        cursorPoint.x - targetPoint.x,
        cursorPoint.y - targetPoint.y,
      );
      evidence.push({
        id: intent.id,
        phase: entry.phase,
        time: payload.time,
        cursor: cursorPoint,
        target: targetPoint,
        deltaPx,
        hit,
      });
      const endpoint = entry.phase === "arrival" || entry.phase === "press" ||
        entry.phase === "release" || entry.phase === "hold";
      if (endpoint && (!hit || deltaPx > 2)) {
        add(
          "interaction_target_miss",
          cursor,
          intent.id,
          `Cursor hotspot misses "${targetName}" by ${Math.round(deltaPx * 10) / 10}px.`,
          "Let SequencesInteractions derive the cursor endpoint from the target anchor.",
        );
      }
      if (entry.phase === "press") {
        const stack = document.elementsFromPoint(cursorPoint.x, cursorPoint.y);
        const actorSet = new Set<Element>([
          cursor,
          ...(overlay ? [overlay] : []),
          scene,
          root,
          ...(intent.ripplePart
          ? Array.from(scene.querySelectorAll(
              `[data-part="${CSS.escape(intent.ripplePart)}"]`,
            ))
          : []),
        ]);
        const top = stack.find((element) =>
          !actorSet.has(element) &&
          getComputedStyle(element).pointerEvents !== "none" &&
          visible(element)
        );
        if (top && top !== target && !target.contains(top) && !top.contains(target)) {
          add(
            "interaction_target_occluded",
            target,
            intent.id,
            `Click point is covered by ${top.id ? `#${top.id}` : top.tagName.toLowerCase()}.`,
            "Reorder scene layers or choose a visible target anchor.",
          );
        }
        if (intent.ripplePart) {
          const ripple = scene.querySelector<HTMLElement>(
            `[data-part="${CSS.escape(intent.ripplePart)}"]`,
          );
          if (!ripple) {
            add(
              "interaction_ripple_missing",
              target,
              intent.id,
              "Declared click ripple is absent.",
              "Bind the declared ripple part in the same scene.",
            );
          } else if (visible(ripple)) {
            const rippleRect = rect(ripple);
            const ripplePoint = {
              x: rippleRect.left + rippleRect.width / 2,
              y: rippleRect.top + rippleRect.height / 2,
            };
            const rippleDelta = Math.hypot(
              ripplePoint.x - cursorPoint.x,
              ripplePoint.y - cursorPoint.y,
            );
            if (rippleDelta > 2) {
              add(
                "interaction_ripple_miss",
                ripple,
                intent.id,
                `Ripple origin misses the cursor hotspot by ${
                  Math.round(rippleDelta * 10) / 10
                }px.`,
                "Use the interaction runtime's measured target point for ripple placement.",
              );
            }
          }
        }
      }
    }
    return { issues, evidence };
  }, { active, time });
}

async function renderSpatialGuide(
  page: import("puppeteer-core").Page,
  intents: InteractionIntentV1[],
): Promise<string | undefined> {
  if (!intents.length) return undefined;
  await page.evaluate((values) => {
    document.getElementById("__sequences-spatial-guide")?.remove();
    const root = document.querySelector<HTMLElement>("[data-composition-id]");
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.id = "__sequences-spatial-guide";
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      font: "12px monospace",
    });
    const box = (
      rect: DOMRect,
      color: string,
      label: string,
      dashed = false,
    ): void => {
      const node = document.createElement("div");
      node.textContent = label;
      Object.assign(node.style, {
        position: "absolute",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        border: `2px ${dashed ? "dashed" : "solid"} ${color}`,
        color,
        boxSizing: "border-box",
      });
      layer.appendChild(node);
    };
    const safe = Number.parseFloat(getComputedStyle(root).getPropertyValue("--space-safe")) ||
      Math.min(rootRect.width, rootRect.height) * 0.06;
    box(
      new DOMRect(
        rootRect.left + safe,
        rootRect.top + safe,
        rootRect.width - safe * 2,
        rootRect.height - safe * 2,
      ),
      "#22d3ee",
      "safe",
      true,
    );
    for (const intent of values) {
      const scene = root.querySelector<HTMLElement>(
        `[data-scene="${CSS.escape(intent.sceneId)}"]`,
      );
      const target = scene?.querySelector<HTMLElement>(
        `[data-part="${CSS.escape(intent.targetPart)}"]`,
      );
      const cursor = root.querySelector<HTMLElement>(
        `[data-cursor-id="${CSS.escape(intent.cursorId)}"]`,
      );
      if (target) box(target.getBoundingClientRect(), "#a3e635", intent.targetPart);
      if (cursor) box(cursor.getBoundingClientRect(), "#fb7185", intent.cursorId);
    }
    document.body.appendChild(layer);
  }, intents);
  const image = await page.screenshot({ encoding: "base64", type: "png" });
  await page.evaluate(() => document.getElementById("__sequences-spatial-guide")?.remove());
  return String(image);
}

async function auditFocalParts(
  page: import("puppeteer-core").Page,
  scenes: DirectScene[],
  time: number,
): Promise<DirectLayoutIssue[]> {
  const active = scenes.find((scene) =>
    scene.spatialIntent &&
    time >= scene.startSec &&
    time <= scene.startSec + scene.durationSec &&
    Math.abs(time - (scene.startSec + scene.durationSec * 0.58)) <= 0.04
  );
  if (!active?.spatialIntent) return [];
  return page.evaluate((payload) => {
    const scene = document.querySelector<HTMLElement>(
      `[data-scene="${CSS.escape(payload.sceneId)}"]`,
    );
    const focal = scene?.querySelector<HTMLElement>(
      `[data-part="${CSS.escape(payload.focalPart)}"]`,
    );
    const issue = (code: string, message: string, fixHint: string): DirectLayoutIssue => ({
      code,
      // Spatial intent is optional planner metadata, so focal findings never
      // block a runnable video — but they are warnings, not info, because a
      // shot whose declared subject is absent/invisible/off-frame is exactly
      // the failure that shipped a blank live film (2026-07-03 incident):
      // warnings feed the bounded repair loop, info was silently ignored.
      severity: "warning",
      time: payload.time,
      selector: focal?.id ? `#${CSS.escape(focal.id)}` : `[data-part="${payload.focalPart}"]`,
      message,
      fixHint,
      source: "sequences",
    });
    if (!scene || !focal) {
      return [issue(
        "spatial_focal_missing",
        `Declared focal part "${payload.focalPart}" is absent.`,
        "Bind the shot's dominant subject with a stable data-part.",
      )];
    }
    const rect = focal.getBoundingClientRect();
    let opacity = 1;
    let node: Element | null = focal;
    while (node) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") opacity = 0;
      opacity *= Number.parseFloat(style.opacity) || 0;
      node = node.parentElement;
    }
    if (rect.width < 1 || rect.height < 1 || opacity < 0.15) {
      return [issue(
        "spatial_focal_invisible",
        `Declared focal part "${payload.focalPart}" is not visible at the hero frame.`,
        "Resolve the shot around its declared focal subject before adding supporting motion.",
      )];
    }
    // Existence and opacity are not prominence: the blank-film incident's
    // focal part passed both while sitting entirely outside the viewport.
    // Skip the geometric checks when the part rides a transformed camera
    // world — the rig may frame it later in the shot, and near-blank
    // detection separately covers a camera that frames nothing.
    const root = document.querySelector<HTMLElement>(
      "[data-composition-id][data-width][data-height]",
    );
    const world = focal.closest<HTMLElement>("[data-camera-world]");
    const worldTransform = world ? getComputedStyle(world).transform : "";
    const worldMoved = Boolean(world) && Boolean(worldTransform) &&
      worldTransform !== "none" && worldTransform !== "matrix(1, 0, 0, 1, 0, 0)";
    if (root && !worldMoved) {
      const rootRect = root.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left));
      const height = Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top));
      const onFrame = (width * height) / (rect.width * rect.height);
      if (onFrame < 0.5) {
        return [issue(
          "spatial_focal_offframe",
          `Declared focal part "${payload.focalPart}" is mostly outside the frame at the hero frame ` +
            `(${Math.round(onFrame * 100)}% visible).`,
          "Position the shot's declared subject inside the viewport at its hero frame, or frame it with the camera rig.",
        )];
      }
      const frameArea = rootRect.width * rootRect.height;
      if (frameArea > 0 && (width * height) / frameArea < 0.005) {
        return [issue(
          "spatial_focal_minor",
          `Declared focal part "${payload.focalPart}" covers under 0.5% of the frame at the hero frame.`,
          "Scale the declared subject to visual dominance, or declare the actually-dominant element as the focal part.",
        )];
      }
    }
    return [];
  }, {
    sceneId: active.id,
    focalPart: active.spatialIntent.focalPart,
    time,
  });
}

/**
 * Fraction of the frame covered by visible, meaning-bearing content — text,
 * media (img/svg/video/canvas), or declared `data-part` elements — at the
 * current seek time. Backgrounds, gradients, and the cinematography kit's
 * grain/vignette layers deliberately do not count: an audience seeing only
 * backgrounds is looking at a blank frame. DOM-rect coverage on a coarse
 * grid was chosen over screenshot pixel analysis because the cinema kit
 * guarantees every frame has nonzero pixel variance (grain), which defeats
 * naive blankness statistics, while rect coverage is deterministic and cheap.
 */
async function measureContentCoverage(
  page: import("puppeteer-core").Page,
): Promise<number> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(
      "[data-composition-id][data-width][data-height]",
    );
    if (!root) return 0;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width < 1 || rootRect.height < 1) return 0;
    const MEDIA = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE"]);
    const opacityCache = new Map<Element, number>();
    const chainOpacity = (element: Element | null): number => {
      if (!element || !root.contains(element) && element !== root) return 1;
      const cached = opacityCache.get(element);
      if (cached !== undefined) return cached;
      const style = getComputedStyle(element);
      const own = style.display === "none" || style.visibility === "hidden"
        ? 0
        : Number.parseFloat(style.opacity);
      const value = (Number.isFinite(own) ? own : 1) * chainOpacity(element.parentElement);
      opacityCache.set(element, value);
      return value;
    };
    const rects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      if (element.closest("[data-layout-ignore]")) continue;
      const hasText = Array.from(element.childNodes).some((node) =>
        node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent ?? ""),
      );
      const isContent = hasText ||
        MEDIA.has(element.tagName.toUpperCase()) ||
        element.hasAttribute("data-part");
      if (!isContent) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const left = Math.max(rect.left, rootRect.left);
      const top = Math.max(rect.top, rootRect.top);
      const right = Math.min(rect.right, rootRect.right);
      const bottom = Math.min(rect.bottom, rootRect.bottom);
      if (right - left < 4 || bottom - top < 4) continue;
      if (chainOpacity(element) < 0.05) continue;
      rects.push({ left, top, right, bottom });
    }
    if (!rects.length) return 0;
    const COLUMNS = 32;
    const ROWS = 18;
    let covered = 0;
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const x = rootRect.left + ((column + 0.5) / COLUMNS) * rootRect.width;
        const y = rootRect.top + ((row + 0.5) / ROWS) * rootRect.height;
        if (rects.some((rect) =>
          x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        )) {
          covered += 1;
        }
      }
    }
    return covered / (COLUMNS * ROWS);
  });
}

/** Parts smaller than this on either axis cannot carry a readable bridge. */
const BOUNDARY_PART_MIN_PX = 24;
/** Cap measured parts per boundary side to bound QA cost on dense scenes. */
const BOUNDARY_PART_CAP = 16;

/**
 * Measure every visible `data-part` of one scene at the current seek time:
 * viewport rect, resolved border-radius, and subtree node count — the same
 * idioms the cut runtime's `shapeMatchAudit`/`radiusPx` use, so a
 * discovery-time score and the bind-time audit agree about geometry.
 */
async function measureBoundaryParts(
  page: import("puppeteer-core").Page,
  sceneId: string,
): Promise<BoundaryPartMeasurement[]> {
  return page.evaluate((payload: { sceneId: string; minPx: number; cap: number }) => {
    const root = document.querySelector<HTMLElement>(
      "[data-composition-id][data-width][data-height]",
    );
    const scene = root?.querySelector<HTMLElement>(
      `[data-scene="${CSS.escape(payload.sceneId)}"]`,
    );
    if (!root || !scene) return [];
    const rootRect = root.getBoundingClientRect();
    const measurements: BoundaryPartMeasurement[] = [];
    for (const element of Array.from(scene.querySelectorAll<HTMLElement>("[data-part]"))) {
      if (measurements.length >= payload.cap) break;
      const part = element.getAttribute("data-part") ?? "";
      if (!part) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < payload.minPx || rect.height < payload.minPx) continue;
      let opacity = 1;
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          opacity = 0;
          break;
        }
        opacity *= Number.parseFloat(style.opacity) || 0;
        node = node.parentElement;
      }
      if (opacity < 0.15) continue;
      // Radius resolved to px against the element's own layout box, so a
      // "50%" circle and an "18px" card compare in one unit (offset sizes
      // are transform-immune).
      const raw = getComputedStyle(element).borderTopLeftRadius || "0px";
      let radiusPx = Number.parseFloat(raw) || 0;
      if (raw.includes("%")) {
        radiusPx = (radiusPx / 100) *
          Math.min(element.offsetWidth || 1, element.offsetHeight || 1);
      }
      const onWidth = Math.max(
        0,
        Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left),
      );
      const onHeight = Math.max(
        0,
        Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top),
      );
      measurements.push({
        part,
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
        radiusPx,
        nodeCount: element.querySelectorAll("*").length + 1,
        onFrameRatio: (onWidth * onHeight) / (rect.width * rect.height),
      });
    }
    return measurements;
  }, { sceneId, minPx: BOUNDARY_PART_MIN_PX, cap: BOUNDARY_PART_CAP });
}

/** Below this content-coverage fraction a sampled frame reads as blank. */
const NEAR_BLANK_COVERAGE = 0.005;
/** Scenes shorter than this are micro-beats (flashes, stings) — never judged. */
const NEAR_BLANK_MIN_SCENE_SEC = 1.2;
/** A single fully blank scene at least this long blocks publication alone. */
const NEAR_BLANK_SCENE_HARD_SEC = 4;
/** Blank scenes totalling this fraction of the film block publication. */
const NEAR_BLANK_FILM_FRACTION = 0.3;

function normalizeHyperframesIssue(value: Record<string, unknown>): DirectLayoutIssue {
  const code = String(value.code ?? "layout_issue");
  const scaffoldHints: Record<string, string> = {
    content_overlap:
      "Give each load-bearing group its own .zone inside a named flow layout; reserve overlap for an annotated decorative layer.",
    important_safe_area:
      "Keep the group in the .scene flow container so its safe padding applies; use a .zone and widen the grid track before wrapping.",
    container_overflow:
      "Move the content into a min-width:0 .zone and let the named grid/flex layout size the container.",
    clipped_text:
      "Reflow the text in a .stack/.zone, remove fixed box height, then reduce type only if the flow layout still cannot fit.",
    text_box_overflow:
      "Reflow the text in a .stack/.zone, remove fixed box height, then reduce type only if the flow layout still cannot fit.",
  };
  return {
    code,
    // Preserve HyperFrames' own severity boundary. In particular, animated
    // container excursions and text overlap are warnings because composition
    // can deliberately layer/enter; hard text clipping and occlusion are errors.
    severity: (value.severity as LayoutSeverity) ?? "warning",
    time: Number(value.time) || 0,
    selector: String(value.selector ?? "composition"),
    ...(value.containerSelector ? { containerSelector: String(value.containerSelector) } : {}),
    ...(value.text ? { text: String(value.text) } : {}),
    message: String(value.message ?? code),
    ...(scaffoldHints[code]
      ? { fixHint: scaffoldHints[code] }
      : value.fixHint ? { fixHint: String(value.fixHint) } : {}),
    source: "hyperframes",
  };
}

function collapseIssues(values: DirectLayoutIssue[]): DirectLayoutIssue[] {
  const groups = new Map<string, DirectLayoutIssue>();
  for (const value of values) {
    const key = [
      value.source,
      value.code,
      value.severity,
      value.interactionId ?? "",
      value.selector,
      value.containerSelector ?? "",
      value.text ?? "",
    ].join("|");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...value,
        firstSeen: value.time,
        lastSeen: value.time,
        occurrences: 1,
      });
      continue;
    }
    existing.firstSeen = Math.min(existing.firstSeen ?? value.time, value.time);
    existing.lastSeen = Math.max(existing.lastSeen ?? value.time, value.time);
    existing.occurrences = (existing.occurrences ?? 1) + 1;
  }
  return [...groups.values()].sort((a, b) => {
    const rank = (severity: LayoutSeverity) => severity === "error" ? 0 : severity === "warning" ? 1 : 2;
    return rank(a.severity) - rank(b.severity) || a.time - b.time;
  });
}

function formatIssue(value: DirectLayoutIssue): string {
  const when = (value.occurrences ?? 0) > 1
    ? `t=${value.firstSeen?.toFixed(2)}–${value.lastSeen?.toFixed(2)}s`
    : `t=${value.time.toFixed(2)}s`;
  return `${value.code} ${value.selector} (${when}): ${value.message}${
    value.fixHint ? ` Fix: ${value.fixHint}` : ""
  }`;
}

export async function inspectDirectComposition(
  projectDir: string,
  draft: DirectCompositionDraft,
  // captureGuide is retained for call-site compatibility but no longer skips
  // the guide: every pass with interactions captures it (one extra screenshot)
  // so a cached result is a superset any later caller can reuse verbatim.
  _options: { captureGuide?: boolean } = {},
): Promise<DirectBrowserQaResult> {
  const cacheKey = qaCacheEnabled() ? qaCacheKey(draft) : undefined;
  if (cacheKey) {
    const cached = readQaCache(projectDir, cacheKey);
    if (cached) {
      process.stderr.write(
        `[layout-qa] reusing cached browser QA evidence (${cacheKey.slice(0, 8)})\n`,
      );
      return cached;
    }
  }
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    const message = "browser validate/layout inspect could not run because Chromium/Chrome/Edge was not found";
    return {
      ok: false,
      strictOk: false,
      infraError: message,
      samples: [],
      issues: [],
      interactions: [],
      errors: [message],
      warnings: [],
    };
  }

  const scratch = prepareScratch(projectDir, draft);
  const runtime: RuntimeMessage[] = [];
  let server: Awaited<ReturnType<typeof serveDir>> | undefined;
  let browser: import("puppeteer-core").Browser | undefined;
  let documentLoaded = false;
  try {
    server = await serveDir(scratch);
    const puppeteer = (await import("puppeteer-core")).default;
    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: [
        "--hide-scrollbars",
        "--mute-audio",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    const rootTag = draft.html.match(
      /<[^>]+\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/is,
    )?.[0] ?? "";
    const readDimension = (name: "data-width" | "data-height", fallback: number): number => {
      const match = rootTag.match(new RegExp(`\\b${name}\\s*=\\s*([\"'])(\\d+)\\1`, "i"));
      return Number(match?.[2]) || fallback;
    };
    const width = readDimension("data-width", 1920);
    const height = readDimension("data-height", 1080);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
        runtime.push({ level: "error", text: message.text() });
      } else if (message.type() === "warn") {
        runtime.push({ level: "warning", text: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      runtime.push({ level: "error", text: error instanceof Error ? error.message : String(error) });
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith("data:") || request.url().includes("favicon")) return;
      if (
        request.resourceType() === "media" &&
        request.failure()?.errorText === "net::ERR_ABORTED"
      ) return;
      runtime.push({
        level: "error",
        text: `failed to load ${decodeURIComponent(new URL(request.url()).pathname)}: ${
          request.failure()?.errorText ?? "net::ERR_FAILED"
        }`,
      });
    });
    await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
    documentLoaded = true;
    // tsx/esbuild annotates nested functions in page.evaluate with __name.
    // Browser contexts do not have that build helper, so provide its inert form.
    await page.addScriptTag({ content: "globalThis.__name ||= (target) => target;" });
    await page.waitForFunction(
      () => Object.keys((window as unknown as { __timelines?: object }).__timelines ?? {}).length > 0,
      { timeout: 12_000 },
    );
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);

    const duration = await page.evaluate(() => {
      const element = document.querySelector("[data-composition-id][data-duration]");
      return Number.parseFloat(element?.getAttribute("data-duration") ?? "0");
    });
    // The cut runtime may degrade a boundary at bind time (shape-match's
    // geometry audit compiles zoom-through instead of a broken bridge). That
    // is a designed, deterministic decision — surface it as a warning so the
    // operator sees why the premium cut did not appear, never as a blocker.
    const degradedCutWarnings = await page.evaluate(() => {
      const bindings = (window as unknown as {
        __sequencesCutBindings?: Array<{
          cut?: { style?: string; fromScene?: string; toScene?: string };
          degraded?: boolean;
          reason?: string;
        }>;
      }).__sequencesCutBindings ?? [];
      return bindings
        .filter((binding) => binding?.degraded)
        .map((binding) =>
          `cut_degraded: ${binding.cut?.style ?? "cut"} ` +
          `${binding.cut?.fromScene ?? "?"}->${binding.cut?.toScene ?? "?"} ` +
          `compiled as zoom-through: ${binding.reason ?? "geometry audit failed"}`
        );
    });
    const tweenBoundaries = await collectTweenBoundaries(page);
    const samples = buildDirectLayoutSampleTimes(draft.storyboard, tweenBoundaries, duration);
    const interactionPlan = parseInteractionPlan(draft.html).plan;
    const interactionIntents = interactionPlan?.interactions ?? [];
    // QA thinks in content (timeline) time everywhere — sample times, issue
    // times, and suppression windows. When the film ramps, the registered
    // timeline is the warped master (output time), so every PHYSICAL seek
    // converts through warpInverse here and nowhere else.
    const toOutputTime = warpInverseOf(parseTimeRampPlan(draft.html).plan);
    const seekContent = (time: number): Promise<void> => seekTo(page, toOutputTime(time));
    await page.addScriptTag({ content: loadBrowserAudit("layout-audit.browser.js") });

    const rawIssues: DirectLayoutIssue[] = [];
    const interactionEvidence: DirectInteractionEvidence[] = [];
    const coverageSamples: Array<{ time: number; coverage: number }> = [];
    for (const time of samples) {
      await seekContent(time);
      coverageSamples.push({ time, coverage: await measureContentCoverage(page) });
      const hyperframes = await page.evaluate(
        (options: { time: number; tolerance: number }) => {
          const audit = (window as unknown as {
            __hyperframesLayoutAudit?: (value: { time: number; tolerance: number }) => unknown[];
          }).__hyperframesLayoutAudit;
          return audit?.(options) ?? [];
        },
        { time, tolerance: 2 },
      );
      const interactionAudit = await auditInteractions(page, interactionIntents, time);
      const hyperframesIssues = (hyperframes as Record<string, unknown>[])
        .map(normalizeHyperframesIssue);
      // Content parked in a currently-unframed camera-world region is meant to
      // be off screen (clipped by the viewport); it is not a layout defect.
      const offWorldFlags = await page.evaluate((selectors: string[]) => {
        const root = document.querySelector<HTMLElement>(
          "[data-composition-id][data-width][data-height]",
        );
        if (!root) return selectors.map(() => false);
        const rootRect = root.getBoundingClientRect();
        return selectors.map((sel) => {
          let element: Element | null = null;
          try {
            element = sel && sel !== "composition" ? root.querySelector(sel) : null;
          } catch {
            element = null;
          }
          if (!element) return false;
          const world = element.closest<HTMLElement>("[data-camera-world]");
          if (!world) return false;
          const transform = getComputedStyle(world).transform;
          if (!transform || transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)") {
            return false;
          }
          const r = element.getBoundingClientRect();
          const w = Math.max(0, Math.min(r.right, rootRect.right) - Math.max(r.left, rootRect.left));
          const h = Math.max(0, Math.min(r.bottom, rootRect.bottom) - Math.max(r.top, rootRect.top));
          const area = r.width * r.height;
          return area <= 0 || (w * h) / area < 0.6;
        });
      }, hyperframesIssues.map((issue) => issue.selector));
      rawIssues.push(
        ...hyperframesIssues.filter((_, index) => !offWorldFlags[index]),
        ...await auditSequencesRelationships(page, time),
        ...await auditFocalParts(page, draft.storyboard, time),
        ...interactionAudit.issues,
      );
      interactionEvidence.push(...interactionAudit.evidence);
    }

    // Reuse HyperFrames' screenshot-backed contrast audit at representative hero
    // frames. Contrast findings are repair feedback, not a hard geometry block.
    await page.addScriptTag({ content: loadBrowserAudit("contrast-audit.browser.js") });
    const contrastTimes = uniqueTimes(
      draft.storyboard.map((scene) => scene.startSec + scene.durationSec * 0.58),
      duration,
    ).slice(0, 5);
    for (const time of contrastTimes) {
      await seekContent(time);
      const screenshot = await page.screenshot({ encoding: "base64", type: "png" });
      const contrast = await page.evaluate(
        (payload: { image: string; time: number }) => {
          const audit = (window as unknown as {
            __contrastAudit?: (image: string, time: number) => Promise<Array<{
              selector: string;
              text: string;
              ratio: number;
              wcagAA: boolean;
              large: boolean;
            }>>;
          }).__contrastAudit;
          return audit?.(payload.image, payload.time) ?? [];
        },
        { image: String(screenshot), time },
      );
      for (const entry of contrast) {
        if (entry.wcagAA) continue;
        rawIssues.push({
          code: "contrast_aa",
          severity: "warning",
          time,
          selector: entry.selector,
          text: entry.text,
          message: `Contrast is ${entry.ratio}:1; needs ${entry.large ? 3 : 4.5}:1.`,
          fixHint: "Adjust the existing semantic color while preserving the committed hue family.",
          source: "hyperframes",
        });
      }
    }

    // Rendering may seek frames out of order. Revisit each interaction arrival
    // after seeking forward and backward; a history-dependent cursor will not
    // return to the same measured hotspot.
    for (const intent of interactionIntents.slice(0, 8)) {
      const baseline = interactionEvidence.find((entry) =>
        entry.id === intent.id && entry.phase === "arrival"
      );
      if (!baseline) continue;
      await seekContent(intent.releaseSec ?? intent.arriveSec);
      await seekContent(intent.startSec + (intent.arriveSec - intent.startSec) / 2);
      await seekContent(intent.arriveSec);
      const replay = await auditInteractions(page, [intent], intent.arriveSec);
      const endpoint = replay.evidence.find((entry) => entry.phase === "arrival");
      if (
        endpoint &&
        Math.hypot(
          endpoint.cursor.x - baseline.cursor.x,
          endpoint.cursor.y - baseline.cursor.y,
        ) > 0.5
      ) {
        rawIssues.push({
          code: "interaction_seek_instability",
          severity: "error",
          time: intent.arriveSec,
          selector: `[data-cursor-id="${intent.cursorId}"]`,
          message: `Interaction "${intent.id}" changes position when frames are sought out of order.`,
          fixHint: "Derive cursor position only from timeline time and measured anchors.",
          source: "sequences",
        });
      }
    }

    // Boundary geometry inventory (feeds deterministic cut discovery): the
    // outgoing scene measured just before each boundary, the incoming scene
    // after its entry settles. Content time; seekContent converts.
    const cutEntryByBoundary = new Map(
      (parseCutPlan(draft.html).plan?.cuts ?? []).map((cut) => [
        `${cut.fromScene}->${cut.toScene}`,
        cut.entrySec,
      ]),
    );
    const boundaryInventories: DirectBoundaryInventory[] = [];
    for (let index = 0; index < draft.storyboard.length - 1; index += 1) {
      const from = draft.storyboard[index]!;
      const to = draft.storyboard[index + 1]!;
      const atSec = from.startSec + from.durationSec;
      const outgoingAt = atSec - 0.15;
      const incomingAt = Math.min(
        atSec + (cutEntryByBoundary.get(`${from.id}->${to.id}`) ?? 0.5),
        to.startSec + Math.max(0.1, to.durationSec - 0.05),
      );
      if (outgoingAt <= from.startSec) continue;
      await seekContent(outgoingAt);
      const outgoing = await measureBoundaryParts(page, from.id);
      await seekContent(incomingAt);
      const incoming = await measureBoundaryParts(page, to.id);
      if (outgoing.length || incoming.length) {
        boundaryInventories.push({ fromScene: from.id, toScene: to.id, atSec, outgoing, incoming });
      }
    }

    // Typed cuts intentionally move scene wrappers across the safe area and
    // stack both scenes' geometry for a few hundred milliseconds around each
    // boundary. Static-layout heuristics sampled inside those windows would
    // report that intentional motion as overlap/overflow findings and spend
    // model repairs fighting the cut compositor; interaction evidence and
    // runtime errors keep their full authority everywhere.
    // The camera rig intentionally re-frames the world during full moves
    // (whips, pans, push-ins…): mid-transit geometry is designed motion, not a
    // layout defect. Suppress static-layout heuristics inside those windows
    // exactly like cut boundaries; interaction evidence and runtime errors
    // keep their full authority everywhere.
    const boundaryWindows = [
      ...cutMotionWindows(parseCutPlan(draft.html).plan),
      ...cameraMotionWindows(parseCameraPlan(draft.html).plan),
      // Morph/open/close beats intentionally move a component over other
      // content; mid-travel geometry is designed motion, not a layout defect.
      ...componentMotionWindows(parseComponentPlan(draft.html).plan),
    ];
    const insideCutWindow = (time: number): boolean =>
      boundaryWindows.some((window) => time >= window.start && time <= window.end);

    // Blank-frame guard (2026-07-03 incident: a live film published with the
    // promised content never on frame). A scene is near-blank when EVERY
    // eligible sample — inside the scene body, outside cut/camera/component
    // motion windows — shows content coverage below the floor. Individual
    // near-blank scenes are repair-loop warnings; a film that is
    // systematically blank becomes a blocking error, which after bounded
    // repairs routes the create to the labeled deterministic fallback
    // instead of publishing an empty result.
    const nearBlankScenes: Array<{ scene: DirectScene; atTime: number }> = [];
    for (const scene of draft.storyboard) {
      if (scene.durationSec < NEAR_BLANK_MIN_SCENE_SEC) continue;
      const eligible = coverageSamples.filter((sample) =>
        sample.time >= scene.startSec + 0.15 &&
        sample.time <= scene.startSec + scene.durationSec - 0.15 &&
        !insideCutWindow(sample.time)
      );
      if (!eligible.length) continue;
      if (eligible.every((sample) => sample.coverage < NEAR_BLANK_COVERAGE)) {
        nearBlankScenes.push({
          scene,
          atTime: eligible[Math.floor(eligible.length / 2)]!.time,
        });
      }
    }
    for (const { scene, atTime } of nearBlankScenes) {
      rawIssues.push({
        code: "near_blank_scene",
        severity: "warning",
        time: atTime,
        selector: `[data-scene="${scene.id}"]`,
        message:
          `Scene "${scene.id}" shows no visible content (text, media, or data-part coverage ` +
          `under 0.5%) at every sampled frame — the audience sees only background.`,
        fixHint:
          "Put the scene's declared subject on frame: check that the promised element exists, " +
          "is inside the viewport (or its camera region is actually framed), and is not opacity-0.",
        source: "sequences",
      });
    }
    const blankSec = nearBlankScenes.reduce((sum, entry) => sum + entry.scene.durationSec, 0);
    const nearBlankErrors =
      blankSec >= duration * NEAR_BLANK_FILM_FRACTION ||
      nearBlankScenes.some((entry) => entry.scene.durationSec >= NEAR_BLANK_SCENE_HARD_SEC)
        ? [
            `near_blank_film: ${nearBlankScenes.length} scene(s) totalling ${blankSec.toFixed(1)}s ` +
              `render as blank frames (${nearBlankScenes.map((entry) => entry.scene.id).join(", ")}); ` +
              `the film cannot ship empty — put the storyboard's promised content on frame`,
          ]
        : [];

    const issues = collapseIssues(rawIssues.filter((issue) =>
      issue.code.startsWith("interaction_") || !insideCutWindow(issue.time)
    )).slice(0, 80);
    const interactionIssues = issues.filter((issue) =>
      issue.code.startsWith("interaction_")
    );
    const enforceInteractions =
      process.env.SLACK_SEQUENCES_INTERACTION_QA?.trim().toLowerCase() !== "audit";
    const errors = [
      ...runtime
      .filter((entry) => entry.level === "error")
      .map((entry) => `browser_runtime: ${entry.text}`),
      ...(enforceInteractions ? interactionIssues.map(formatIssue) : []),
      // A systematically blank film is not a polish heuristic: it is the one
      // visual state that is worse than the deterministic fallback.
      ...nearBlankErrors,
    ];
    const visualErrors = issues
      .filter((issue) => issue.severity === "error")
      .map(formatIssue);
    const warnings = [
      ...runtime.filter((entry) => entry.level === "warning").map((entry) => `browser_warning: ${entry.text}`),
      ...degradedCutWarnings,
      // Geometry, occlusion, overlap, and contrast are screenshot/layout
      // heuristics. They are useful repair feedback but cannot prove that an
      // authored composition is unusable, so they never become publication
      // blockers. Keep the issue's original severity in `issues` for tooling.
      ...visualErrors,
      ...(!enforceInteractions ? interactionIssues.map(formatIssue) : []),
      ...issues.filter((issue) => issue.severity === "warning").map(formatIssue),
    ];
    const repairWarnings = issues.filter((issue) =>
      issue.severity === "warning" &&
      (
        issue.source === "sequences" ||
        issue.code === "content_overlap" ||
        issue.code === "container_overflow"
      )
    );
    let guidePngBase64: string | undefined;
    if (interactionIntents.length) {
      await seekContent(interactionIntents[0]!.arriveSec);
      guidePngBase64 = await renderSpatialGuide(page, interactionIntents);
    }
    const result: DirectBrowserQaResult = {
      // The hard browser boundary is objective runtime health. Visual audit
      // findings may trigger bounded polish, but a runnable draft is always
      // publishable if those repairs fail or regress it.
      ok: errors.length === 0,
      // HyperFrames contrast warnings include intentionally low-energy
      // decorative text; report them, but do not spend model retries on them.
      strictOk:
        errors.length === 0 &&
        visualErrors.length === 0 &&
        repairWarnings.length === 0,
      samples,
      issues,
      interactions: interactionEvidence,
      ...(boundaryInventories.length ? { boundaries: boundaryInventories } : {}),
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      ...(guidePngBase64 ? { guidePngBase64 } : {}),
    };
    if (cacheKey) writeQaCache(projectDir, cacheKey, result);
    return result;
  } catch (error) {
    const message = `browser validate/layout inspect failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    const infrastructureFault =
      !documentLoaded ||
      /target closed|session closed|protocol error|browser.*disconnect|out of memory|ENOMEM/i
        .test(message);
    const runtimeDetail = runtime
      .slice(0, 5)
      .map((entry) => `${entry.level}: ${entry.text}`)
      .join(" | ");
    return {
      ok: false,
      strictOk: false,
      ...(infrastructureFault ? { infraError: message } : {}),
      samples: [],
      issues: [],
      interactions: [],
      errors: [
        `${message}${runtimeDetail ? ` | ${runtimeDetail}` : ""}`,
      ],
      warnings: [],
    };
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
