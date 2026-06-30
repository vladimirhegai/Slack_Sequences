/**
 * Browser QA for direct HyperFrames compositions.
 *
 * The installed runtime is pinned at HyperFrames 0.6.86 while the vendored CLI
 * source is newer and intentionally not installed in Railway. This adapter uses
 * the vendored inspector's browser audit verbatim, then adds the small set of
 * Sequences-specific relational checks that HyperFrames cannot infer.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DirectCompositionDraft, DirectScene } from "./directComposition.ts";
import { findBrowserExecutable } from "./render.ts";

export type LayoutSeverity = "error" | "warning" | "info";

export interface DirectLayoutIssue {
  code: string;
  severity: LayoutSeverity;
  time: number;
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
  ok: boolean;
  strictOk: boolean;
  samples: number[];
  issues: DirectLayoutIssue[];
  errors: string[];
  warnings: string[];
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
  const boundaries = uniqueTimes([0, duration, ...cuts, ...tweenBoundaries], duration);
  const midpoints = boundaries.slice(0, -1).map((value, index) => {
    const next = boundaries[index + 1] ?? value;
    return (value + next) / 2;
  });
  const all = uniqueTimes([...heroes, ...boundaries, ...midpoints], duration);
  if (all.length <= cap) return all;

  // Preserve authored hero frames, then evenly stride the remaining boundary
  // evidence so Railway memory/time stays bounded on unusually dense timelines.
  const kept = new Set(uniqueTimes(heroes, duration));
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

function prepareScratch(projectDir: string, draft: DirectCompositionDraft): string {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-layout-"));
  fs.writeFileSync(path.join(scratch, "index.html"), draft.html.trim() + "\n");
  const require = createRequire(import.meta.url);
  fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(scratch, "gsap.min.js"));
  const assets = path.join(projectDir, "assets");
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(scratch, "assets"), { recursive: true });
  return scratch;
}

function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
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
      __timelines?: Record<string, AnimationLike>;
    }).__timelines ?? {};
    return Object.values(timelines).flatMap((timeline) => {
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

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-important]"))) {
      if (!visible(element) || element.closest("[data-layout-allow-overflow]")) continue;
      const value = rect(element);
      const overflow = Math.max(
        rootRect.left + safe - value.left,
        rootRect.top + safe - value.top,
        value.right - (rootRect.right - safe),
        value.bottom - (rootRect.bottom - safe),
      );
      if (overflow > 2) {
        issues.push(issue(
          "important_safe_area",
          "error",
          element,
          `Load-bearing content crosses the ${safe}px safe canvas inset by ${Math.round(overflow)}px.`,
          "Reflow or widen its region first, then wrap; use fitTextFontSize only after those options.",
          root,
        ));
      }
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-anchor]"))) {
      if (!visible(element)) continue;
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
          "error",
          element,
          `Unknown layout anchor "${intent}".`,
          "Use frame:center, frame:left-third, frame:right-third, frame:top-third, or frame:bottom-third.",
        ));
        continue;
      }
      if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) {
        issues.push(issue(
          "layout_anchor_mismatch",
          "error",
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
          "error",
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
          "error",
          element,
          `Unknown relational alignment "${edge}".`,
          "Use left, right, top, bottom, center-x, or center-y.",
          target,
        ));
      } else if (Math.abs(pair[0] - pair[1]) > tolerance) {
        issues.push(issue(
          "layout_alignment_mismatch",
          "error",
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
          "error",
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
          "error",
          element,
          `Decoration is ${Math.round(distance)}px from ${targetSelector}.`,
          "Move it inside the measured text wrapper or implement the stroke as a pseudo-element.",
          target,
        ));
      }
    }

    for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-layout-gap]"))) {
      if (!visible(group)) continue;
      const axis = group.dataset.layoutGap;
      if (axis !== "x" && axis !== "y") {
        issues.push(issue(
          "layout_gap_invalid",
          "error",
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

function normalizeHyperframesIssue(value: Record<string, unknown>): DirectLayoutIssue {
  const code = String(value.code ?? "layout_issue");
  const promoted = code === "content_overlap" || code === "container_overflow";
  return {
    code,
    severity: promoted ? "error" : (value.severity as LayoutSeverity) ?? "warning",
    time: Number(value.time) || 0,
    selector: String(value.selector ?? "composition"),
    ...(value.containerSelector ? { containerSelector: String(value.containerSelector) } : {}),
    ...(value.text ? { text: String(value.text) } : {}),
    message: String(value.message ?? code),
    ...(value.fixHint ? { fixHint: String(value.fixHint) } : {}),
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
): Promise<DirectBrowserQaResult> {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    const message = "browser validate/layout inspect could not run because Chromium/Chrome/Edge was not found";
    return {
      ok: false,
      strictOk: false,
      samples: [],
      issues: [],
      errors: [message],
      warnings: [],
    };
  }

  const scratch = prepareScratch(projectDir, draft);
  const server = await serveDir(scratch);
  const puppeteer = (await import("puppeteer-core")).default;
  const runtime: RuntimeMessage[] = [];
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
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
    const tweenBoundaries = await collectTweenBoundaries(page);
    const samples = buildDirectLayoutSampleTimes(draft.storyboard, tweenBoundaries, duration);
    await page.addScriptTag({ content: loadBrowserAudit("layout-audit.browser.js") });

    const rawIssues: DirectLayoutIssue[] = [];
    for (const time of samples) {
      await seekTo(page, time);
      const hyperframes = await page.evaluate(
        (options: { time: number; tolerance: number }) => {
          const audit = (window as unknown as {
            __hyperframesLayoutAudit?: (value: { time: number; tolerance: number }) => unknown[];
          }).__hyperframesLayoutAudit;
          return audit?.(options) ?? [];
        },
        { time, tolerance: 2 },
      );
      rawIssues.push(
        ...(hyperframes as Record<string, unknown>[]).map(normalizeHyperframesIssue),
        ...await auditSequencesRelationships(page, time),
      );
    }

    // Reuse HyperFrames' screenshot-backed contrast audit at representative hero
    // frames. Contrast findings are repair feedback, not a hard geometry block.
    await page.addScriptTag({ content: loadBrowserAudit("contrast-audit.browser.js") });
    const contrastTimes = uniqueTimes(
      draft.storyboard.map((scene) => scene.startSec + scene.durationSec * 0.58),
      duration,
    ).slice(0, 5);
    for (const time of contrastTimes) {
      await seekTo(page, time);
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

    const issues = collapseIssues(rawIssues).slice(0, 60);
    const errors = [
      ...runtime.filter((entry) => entry.level === "error").map((entry) => `browser_runtime: ${entry.text}`),
      ...issues.filter((issue) => issue.severity === "error").map(formatIssue),
    ];
    const warnings = [
      ...runtime.filter((entry) => entry.level === "warning").map((entry) => `browser_warning: ${entry.text}`),
      ...issues.filter((issue) => issue.severity === "warning").map(formatIssue),
    ];
    const repairWarnings = issues.filter((issue) =>
      issue.severity === "warning" &&
      (issue.code === "layout_intent_missing" || issue.code === "layout_gap_inconsistent")
    );
    return {
      ok: errors.length === 0,
      // HyperFrames contrast warnings include intentionally low-energy
      // decorative text; report them, but do not spend model retries on them.
      strictOk: errors.length === 0 && repairWarnings.length === 0,
      samples,
      issues,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
    };
  } catch (error) {
    return {
      ok: false,
      strictOk: false,
      samples: [],
      issues: [],
      errors: [`browser validate/layout inspect failed: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
    };
  } finally {
    await browser?.close().catch(() => {});
    await server.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
