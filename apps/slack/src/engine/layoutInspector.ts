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
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DirectCompositionDraft, DirectScene } from "./directComposition.ts";
import {
  INTERACTION_RUNTIME_FILE,
  interactionRuntimeSource,
  parseInteractionPlan,
  type InteractionIntentV1,
} from "./interactionContract.ts";
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
  /** True when the document loaded, initialized its timeline, and ran without browser errors. */
  ok: boolean;
  /** True when runtime validation passed and no visual quality findings request polish. */
  strictOk: boolean;
  samples: number[];
  issues: DirectLayoutIssue[];
  interactions?: DirectInteractionEvidence[];
  errors: string[];
  warnings: string[];
  guidePngBase64?: string;
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
          "warning",
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
      if (!visible(cursor) || !visible(target)) {
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
      const targetRect = rect(target);
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
      const targetPoint = {
        x: targetRect.left + targetRect.width * intent.aimX + (intent.offsetX ?? 0),
        y: targetRect.top + targetRect.height * intent.aimY + (intent.offsetY ?? 0),
      };
      const inset = Math.min(
        intent.hitInsetPx ?? 2,
        Math.max(0, targetRect.width / 2 - 0.5),
        Math.max(0, targetRect.height / 2 - 0.5),
      );
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
      // Spatial intent helps explain and inspect the composition, but it is
      // optional planner metadata. Missing focal bindings must not discard an
      // otherwise valid, runnable video.
      severity: "info",
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
    return [];
  }, {
    sceneId: active.id,
    focalPart: active.spatialIntent.focalPart,
    time,
  });
}

function normalizeHyperframesIssue(value: Record<string, unknown>): DirectLayoutIssue {
  const code = String(value.code ?? "layout_issue");
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
  options: { captureGuide?: boolean } = {},
): Promise<DirectBrowserQaResult> {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    const message = "browser validate/layout inspect could not run because Chromium/Chrome/Edge was not found";
    return {
      ok: false,
      strictOk: false,
      samples: [],
      issues: [],
      interactions: [],
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
    const interactionPlan = parseInteractionPlan(draft.html).plan;
    const interactionIntents = interactionPlan?.interactions ?? [];
    await page.addScriptTag({ content: loadBrowserAudit("layout-audit.browser.js") });

    const rawIssues: DirectLayoutIssue[] = [];
    const interactionEvidence: DirectInteractionEvidence[] = [];
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
      const interactionAudit = await auditInteractions(page, interactionIntents, time);
      rawIssues.push(
        ...(hyperframes as Record<string, unknown>[]).map(normalizeHyperframesIssue),
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

    // Rendering may seek frames out of order. Revisit each interaction arrival
    // after seeking forward and backward; a history-dependent cursor will not
    // return to the same measured hotspot.
    for (const intent of interactionIntents.slice(0, 8)) {
      const baseline = interactionEvidence.find((entry) =>
        entry.id === intent.id && entry.phase === "arrival"
      );
      if (!baseline) continue;
      await seekTo(page, intent.releaseSec ?? intent.arriveSec);
      await seekTo(page, intent.startSec + (intent.arriveSec - intent.startSec) / 2);
      await seekTo(page, intent.arriveSec);
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

    const issues = collapseIssues(rawIssues).slice(0, 80);
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
    ];
    const visualErrors = issues
      .filter((issue) => issue.severity === "error")
      .map(formatIssue);
    const warnings = [
      ...runtime.filter((entry) => entry.level === "warning").map((entry) => `browser_warning: ${entry.text}`),
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
    if (interactionIntents.length && options.captureGuide !== false) {
      await seekTo(page, interactionIntents[0]!.arriveSec);
      guidePngBase64 = await renderSpatialGuide(page, interactionIntents);
    }
    return {
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
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      ...(guidePngBase64 ? { guidePngBase64 } : {}),
    };
  } catch (error) {
    const runtimeDetail = runtime
      .slice(0, 5)
      .map((entry) => `${entry.level}: ${entry.text}`)
      .join(" | ");
    return {
      ok: false,
      strictOk: false,
      samples: [],
      issues: [],
      interactions: [],
      errors: [
        `browser validate/layout inspect failed: ${
          error instanceof Error ? error.message : String(error)
        }${runtimeDetail ? ` | ${runtimeDetail}` : ""}`,
      ],
      warnings: [],
    };
  } finally {
    await browser?.close().catch(() => {});
    await server.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
