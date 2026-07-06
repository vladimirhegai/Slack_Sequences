/**
 * Motion-native component contract — the fourth host-owned runtime.
 *
 * SaaS product surfaces (windows, search bars, tables, charts, chat threads,
 * toasts, modals …) used to be ad-hoc HTML the author re-invented per film.
 * This contract makes them first-class objects with the same architecture as
 * cuts, camera, and interactions: the storyboard declares typed *components*
 * per scene and typed *beats* (state changes) on them, a deterministic
 * resolver normalizes both into a plan, the host injects the JSON island +
 * versioned runtime (`sequences-components.v1.js`) + the component kit CSS
 * (`sequences-components.v1.css`), and static validation proves every binding
 * before publication.
 *
 * The division of labor that makes components motion-native:
 * - the KIT owns structure and both end states of every component (pure
 *   static CSS — no transitions, no animations, deterministic under seek);
 * - the AUTHOR owns placement, copy, and entrances (a component arrives like
 *   any other content, addressed by its stable `data-part`);
 * - the RUNTIME owns internal state motion — typing, opening, selecting,
 *   counting, chart growth, streaming, and FLIP morphs between twin
 *   components — compiled from the island into the one paused timeline.
 *
 * Because a component is addressed by `data-part`, the camera can track it,
 * an object-match cut can carry it across a boundary, and a cursor
 * interaction can click it — one name, four motion systems.
 *
 * Malformed declarations degrade (a beat that cannot be normalized is
 * dropped); a *declared* plan that cannot bind blocks publication, exactly
 * like cuts and camera.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectScene } from "./directComposition.ts";
import { SEQUENCES_EASES } from "./cameraContract.ts";

export const COMPONENT_RUNTIME_VERSION = 1;
export const COMPONENT_RUNTIME_FILE = "sequences-components.v1.js";
export const COMPONENT_KIT_VERSION = 1;
export const COMPONENT_KIT_FILE = "sequences-components.v1.css";
export const COMPONENT_KIT_STYLE_ID = "sequences-components-kit";

const TEMPLATES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
);

/* ------------------------------------------------------------- catalog */

export type ComponentKind =
  | "app-window"
  | "sidebar"
  | "search"
  | "command-palette"
  | "dropdown"
  | "context-menu"
  | "button"
  | "toggle"
  | "toast"
  | "modal"
  | "stat-card"
  | "table"
  | "list"
  | "kanban"
  | "chat"
  | "chart-bars"
  | "chart-line"
  | "progress-ring"
  | "progress"
  | "terminal"
  | "tabs"
  | "avatar-stack";

export type ComponentBeatKind =
  | "type"
  | "open"
  | "close"
  | "select"
  | "press"
  | "set-state"
  | "count"
  | "progress"
  | "chart"
  | "rows"
  | "stream"
  | "highlight"
  | "morph"
  | "swap";

/** Beats every component kind supports regardless of its specific list. */
const UNIVERSAL_BEATS: ReadonlySet<ComponentBeatKind> = new Set<ComponentBeatKind>([
  "set-state",
  "highlight",
  "swap",
  "morph",
]);

export interface ComponentKindSpec {
  kind: ComponentKind;
  className: string;
  purpose: string;
  /** Kind-specific beats (universal beats are always allowed on top). */
  beats: ComponentBeatKind[];
  /** Twin components this kind morphs into naturally (guidance, not a gate). */
  morphsWith?: ComponentKind[];
  /** Compact authoring exemplar — the markup contract the kit CSS styles. */
  markup: string;
}

/**
 * The component catalog is the single source of truth: the storyboard schema
 * enum, plan validation, the GLM planning vocabulary, and the DeepSeek
 * authoring reference are all derived from it, so prose and runtime
 * capability cannot drift apart.
 */
export const COMPONENT_CATALOG: ComponentKindSpec[] = [
  {
    kind: "app-window",
    className: "cmp-window",
    purpose: "Browser/app frame with chrome bar — the container for product UI",
    // Product worlds often use the window itself as the alert/card stack.
    // The generic rows compiler already targets data-cmp-item descendants.
    beats: ["rows"],
    markup:
      `<div class="cmp cmp-window material-hero" data-component="app-window" data-part="demo-app">` +
      `<div class="cmp-chrome"><i></i><i></i><i></i><span class="cmp-chrome-title">acme.app</span></div>` +
      `<div class="cmp-body">…content…</div></div>`,
  },
  {
    kind: "sidebar",
    className: "cmp-sidebar",
    purpose: "Vertical nav rail with items; one item can be active",
    beats: ["select", "rows"],
    markup:
      `<nav class="cmp cmp-sidebar" data-component="sidebar" data-part="nav">` +
      `<div class="cmp-item" data-active="true">Home</div><div class="cmp-item">Reports</div></nav>`,
  },
  {
    kind: "search",
    className: "cmp-search",
    purpose: "Search input with caret; types queries, can open a results panel",
    beats: ["type", "open", "close"],
    morphsWith: ["command-palette"],
    markup:
      `<div class="cmp cmp-search inset-well" data-component="search" data-part="search">` +
      `<span class="cmp-icon">⌕</span><span class="cmp-text" data-cmp-text>final query</span>` +
      `<div class="cmp-results"><div class="cmp-item">Result A</div></div></div>`,
  },
  {
    kind: "command-palette",
    className: "cmp-palette",
    purpose: "Centered ⌘K palette: input plus result rows",
    beats: ["type", "open", "close", "rows", "select"],
    morphsWith: ["search"],
    markup:
      `<div class="cmp cmp-palette material-hero" data-component="command-palette" data-part="palette">` +
      `<div class="cmp-input inset-well"><span class="cmp-text" data-cmp-text>deploy…</span></div>` +
      `<div class="cmp-item">Deploy to production</div><div class="cmp-item">View logs</div></div>`,
  },
  {
    kind: "dropdown",
    className: "cmp-dropdown",
    purpose: "Trigger button with an attached menu that opens over content",
    beats: ["open", "close", "select"],
    morphsWith: ["context-menu"],
    markup:
      `<div class="cmp cmp-dropdown" data-component="dropdown" data-part="env-picker">` +
      `<div class="cmp-trigger material">Production ▾</div>` +
      `<div class="cmp-menu material"><div class="cmp-item">Staging</div><div class="cmp-item" data-active="true">Production</div></div></div>`,
  },
  {
    kind: "context-menu",
    className: "cmp-menu-standalone",
    purpose: "Floating right-click menu of actions",
    beats: ["open", "close", "select"],
    markup:
      `<div class="cmp cmp-menu-standalone material" data-component="context-menu" data-part="row-actions">` +
      `<div class="cmp-item">Duplicate</div><div class="cmp-item">Share…</div><div class="cmp-item cmp-danger">Delete</div></div>`,
  },
  {
    kind: "button",
    className: "cmp-button",
    purpose: "Primary action button; presses, loads, succeeds",
    beats: ["press"],
    markup:
      `<button class="cmp cmp-button" data-component="button" data-part="deploy-cta" data-state="idle">` +
      `<span class="cmp-label">Deploy</span><span class="cmp-spinner"></span><span class="cmp-check">✓</span></button>`,
  },
  {
    kind: "toggle",
    className: "cmp-toggle",
    purpose: "On/off switch",
    beats: [],
    markup:
      `<div class="cmp cmp-toggle" data-component="toggle" data-part="alerts-toggle" data-state="off"><i class="cmp-knob"></i></div>`,
  },
  {
    kind: "toast",
    className: "cmp-toast",
    purpose: "Transient notification card (icon, title, meta line)",
    beats: ["open", "close"],
    markup:
      `<div class="cmp cmp-toast material" data-component="toast" data-part="deploy-toast">` +
      `<span class="cmp-icon cmp-ok">✓</span><div><div class="cmp-title">Deploy complete</div>` +
      `<div class="cmp-meta">production · 12s</div></div></div>`,
  },
  {
    kind: "modal",
    className: "cmp-modal",
    purpose: "Scrim plus centered dialog",
    beats: ["open", "close"],
    morphsWith: ["stat-card"],
    markup:
      `<div class="cmp cmp-modal" data-component="modal" data-part="invite-modal">` +
      `<div class="cmp-scrim"></div><div class="cmp-dialog material-hero"><div class="cmp-title">Invite your team</div>…</div></div>`,
  },
  {
    kind: "stat-card",
    className: "cmp-stat",
    purpose: "Metric tile: label, big value (counts up), delta chip",
    beats: ["count"],
    morphsWith: ["modal"],
    markup:
      `<div class="cmp cmp-stat material" data-component="stat-card" data-part="latency-stat">` +
      `<div class="cmp-label">P95 latency</div><div class="cmp-value" data-cmp-value>142ms</div>` +
      `<div class="cmp-delta cmp-up">▼ 40%</div></div>`,
  },
  {
    kind: "table",
    className: "cmp-table",
    purpose: "Data table: header row plus rows that can arrive/highlight",
    beats: ["rows", "select"],
    morphsWith: ["list"],
    markup:
      `<div class="cmp cmp-table material" data-component="table" data-part="orders">` +
      `<div class="cmp-head"><span>Order</span><span>Status</span></div>` +
      `<div class="cmp-row"><span>#1042</span><span class="cmp-chip cmp-ok">Paid</span></div></div>`,
  },
  {
    kind: "list",
    className: "cmp-list",
    purpose: "Vertical feed/list of items",
    beats: ["rows", "select"],
    morphsWith: ["table"],
    markup:
      `<div class="cmp cmp-list" data-component="list" data-part="activity">` +
      `<div class="cmp-item material">Alice merged #412</div><div class="cmp-item material">CI passed</div></div>`,
  },
  {
    kind: "kanban",
    className: "cmp-kanban",
    purpose: "Board columns with draggable-looking cards",
    beats: ["rows"],
    markup:
      `<div class="cmp cmp-kanban" data-component="kanban" data-part="board">` +
      `<div class="cmp-col"><div class="cmp-col-title">Doing</div><div class="cmp-card material">Ship v2</div></div>` +
      `<div class="cmp-col"><div class="cmp-col-title">Done</div></div></div>`,
  },
  {
    kind: "chat",
    className: "cmp-chat",
    purpose: "AI/chat thread: bubbles, typing dots, streamed answers",
    beats: ["stream", "rows"],
    markup:
      `<div class="cmp cmp-chat" data-component="chat" data-part="assistant">` +
      `<div class="cmp-msg">Summarize the launch thread</div>` +
      `<div class="cmp-msg cmp-ai" data-cmp-stream>Three features shipped this week…</div>` +
      `<div class="cmp-typing"><i></i><i></i><i></i></div></div>`,
  },
  {
    kind: "chart-bars",
    className: "cmp-chart-bars",
    purpose: "Bar chart whose bars grow in",
    beats: ["chart"],
    morphsWith: ["chart-line"],
    markup:
      `<div class="cmp cmp-chart-bars" data-component="chart-bars" data-part="growth">` +
      `<i style="height:34%"></i><i style="height:52%"></i><i style="height:81%"></i><i class="cmp-hero" style="height:100%"></i></div>`,
  },
  {
    kind: "chart-line",
    className: "cmp-chart-line",
    purpose: "SVG line/area chart that draws on",
    beats: ["chart"],
    morphsWith: ["chart-bars"],
    markup:
      `<div class="cmp cmp-chart-line" data-component="chart-line" data-part="trend">` +
      `<svg viewBox="0 0 400 160"><polyline class="cmp-stroke" points="0,140 80,120 160,124 240,70 320,52 400,18"/></svg></div>`,
  },
  {
    kind: "progress-ring",
    className: "cmp-ring",
    purpose: "Circular progress with a center value",
    beats: ["progress", "count"],
    markup:
      `<div class="cmp cmp-ring" data-component="progress-ring" data-part="uptime">` +
      `<svg viewBox="0 0 120 120"><circle class="cmp-ring-bg" cx="60" cy="60" r="52"/>` +
      `<circle class="cmp-ring-fg" cx="60" cy="60" r="52"/></svg><div class="cmp-value" data-cmp-value>99.99%</div></div>`,
  },
  {
    kind: "progress",
    className: "cmp-progress",
    purpose: "Horizontal progress/loading bar",
    beats: ["progress"],
    markup:
      `<div class="cmp cmp-progress" data-component="progress" data-part="build">` +
      `<i data-cmp-fill></i></div>`,
  },
  {
    kind: "terminal",
    className: "cmp-terminal",
    purpose: "Terminal/code card: mono lines, typed commands",
    beats: ["type", "rows", "stream"],
    markup:
      `<div class="cmp cmp-terminal inset-well" data-component="terminal" data-part="cli">` +
      `<div class="cmp-line"><span class="cmp-prompt">$</span><span class="cmp-text" data-cmp-text>acme deploy --prod</span></div>` +
      `<div class="cmp-line cmp-dim">✓ built in 3.2s</div></div>`,
  },
  {
    kind: "tabs",
    className: "cmp-tabs",
    purpose: "Tab bar; the active tab can move",
    beats: ["select"],
    markup:
      `<div class="cmp cmp-tabs" data-component="tabs" data-part="views">` +
      `<div class="cmp-item" data-active="true">Overview</div><div class="cmp-item">Traces</div><div class="cmp-item">Alerts</div></div>`,
  },
  {
    kind: "avatar-stack",
    className: "cmp-avatars",
    purpose: "Overlapping avatar circles that pop in",
    beats: ["rows"],
    markup:
      `<div class="cmp cmp-avatars" data-component="avatar-stack" data-part="team">` +
      `<i>AL</i><i>KD</i><i>MR</i><span class="cmp-more">+9</span></div>`,
  },
];

const CATALOG_BY_KIND = new Map(COMPONENT_CATALOG.map((spec) => [spec.kind, spec]));

export const COMPONENT_KINDS: ReadonlySet<ComponentKind> = new Set(
  COMPONENT_CATALOG.map((spec) => spec.kind),
);

export const COMPONENT_BEAT_KINDS: ReadonlySet<ComponentBeatKind> = new Set<ComponentBeatKind>([
  "type", "open", "close", "select", "press", "set-state", "count",
  "progress", "chart", "rows", "stream", "highlight", "morph", "swap",
]);

export function componentSupportsBeat(kind: ComponentKind, beat: ComponentBeatKind): boolean {
  if (UNIVERSAL_BEATS.has(beat)) return true;
  return CATALOG_BY_KIND.get(kind)?.beats.includes(beat) ?? false;
}

/**
 * The catalog's legal FLIP-morph partner kinds for a component kind (empty when
 * the kind has no morph pairing). Used by the parse-side morph-twin
 * reconciliation: a morph whose twin id is undeclared can be completed
 * host-side only when the source kind has exactly ONE legal partner.
 */
export function morphPartnerKinds(kind: ComponentKind): ComponentKind[] {
  return [...(CATALOG_BY_KIND.get(kind)?.morphsWith ?? [])];
}

/**
 * The canonical host-owned root element for a declared component (Sentinel
 * Phase 1 scaffold). The catalog exemplar already carries the correct tag,
 * `cmp cmp-<kind>` class, `data-component`, and a kit-valid interior; here its
 * `data-part` is stamped with THIS component's stable id so
 * `component_root_missing` / `component_beat_unbound` are unrepresentable
 * rather than repaired. The author fills/restyles the interior; the binding is
 * guaranteed present. A kind outside the catalog degrades to a bare bound div.
 */
export function componentSkeletonMarkup(spec: SceneComponentSpecV1): string {
  const entry = CATALOG_BY_KIND.get(spec.kind);
  if (!entry) {
    return `<div class="cmp" data-component="${spec.kind}" data-part="${spec.id}"></div>`;
  }
  // The root is the first element; its data-part is the first occurrence, and
  // no exemplar carries a second data-part in its interior.
  return entry.markup.replace(/\bdata-part\s*=\s*"[^"]*"/, `data-part="${spec.id}"`);
}

/* --------------------------------------------------------------- intents */

/** A declared component instance in a scene (the planner's build order). */
export interface SceneComponentSpecV1 {
  version: 1;
  /** Stable kebab-case id — authored verbatim as this element's data-part. */
  id: string;
  kind: ComponentKind;
  /** Optional camera-world station the component lives in. */
  region?: string;
  role?: "hero" | "support";
}

/** One typed state change on a declared component (times are absolute). */
export interface ComponentBeatIntentV1 {
  version: 1;
  id: string;
  sceneId: string;
  /** The declared component id (== its data-part) this beat acts on. */
  component: string;
  kind: ComponentBeatKind;
  atSec: number;
  durationSec?: number;
  /** type/stream/swap: the text that arrives. */
  text?: string;
  /** count: target number · progress: 0-1 fill fraction. */
  value?: number;
  /** select: 1-based item index. */
  item?: number;
  /** set-state/press: the data-state token to land on. */
  toState?: string;
  /** morph: the declared component id this one morphs into. */
  morphTo?: string;
  ease?: string;
}

/** A resolved beat the runtime binds mechanically. */
export interface ResolvedComponentBeatV1 {
  id: string;
  component: string;
  kind: ComponentBeatKind;
  startSec: number;
  endSec: number;
  ease: string;
  text?: string;
  value?: number;
  item?: number;
  toState?: string;
  morphTo?: string;
}

export interface SceneComponentPlanV1 {
  sceneId: string;
  beats: ResolvedComponentBeatV1[];
}

export interface ComponentPlanV1 {
  version: 1;
  scenes: SceneComponentPlanV1[];
}

interface BeatDefaults {
  ease: string;
  defaultSec: number;
  minSec: number;
  maxSec: number;
}

const BEAT_DEFAULTS: Record<ComponentBeatKind, BeatDefaults> = {
  type: { ease: "none", defaultSec: 1.2, minSec: 0.4, maxSec: 3 },
  open: { ease: "seqSettle", defaultSec: 0.5, minSec: 0.25, maxSec: 1.2 },
  close: { ease: "power2.in", defaultSec: 0.35, minSec: 0.2, maxSec: 0.8 },
  select: { ease: "seqMicrobounce", defaultSec: 0.35, minSec: 0.2, maxSec: 0.8 },
  press: { ease: "seqMicrobounce", defaultSec: 0.45, minSec: 0.25, maxSec: 1 },
  "set-state": { ease: "power3.out", defaultSec: 0.4, minSec: 0.1, maxSec: 1 },
  count: { ease: "seqImpulse", defaultSec: 1.1, minSec: 0.4, maxSec: 2.6 },
  progress: { ease: "seqImpulse", defaultSec: 1, minSec: 0.3, maxSec: 2.6 },
  chart: { ease: "seqImpulse", defaultSec: 1.2, minSec: 0.5, maxSec: 2.6 },
  rows: { ease: "power3.out", defaultSec: 0.9, minSec: 0.4, maxSec: 2.4 },
  stream: { ease: "none", defaultSec: 1.6, minSec: 0.6, maxSec: 3.2 },
  highlight: { ease: "power2.out", defaultSec: 0.9, minSec: 0.4, maxSec: 1.6 },
  morph: { ease: "seqSwoosh", defaultSec: 0.8, minSec: 0.4, maxSec: 1.6 },
  swap: { ease: "power3.out", defaultSec: 0.6, minSec: 0.3, maxSec: 1.2 },
};

const EASE_PATTERN = new RegExp(
  `^(?:${SEQUENCES_EASES.join("|")}|(?:power[1-4]|expo|sine|circ)\\.(?:in|out|inOut)|none|linear)$`,
);

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stableName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{0,63}$/.test(raw) ? raw : "";
}

/* ---------------------------------------------------------- normalization */

/**
 * Normalize a storyboard scene's declared components. Malformed entries and
 * duplicate ids degrade to fewer components rather than failing the plan.
 */
export function normalizeStoryboardComponents(value: unknown): SceneComponentSpecV1[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): SceneComponentSpecV1[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const id = stableName(item.id);
    const kind = typeof item.kind === "string" ? item.kind.trim() as ComponentKind : "";
    if (!id || !kind || !COMPONENT_KINDS.has(kind) || seen.has(id)) return [];
    seen.add(id);
    const region = stableName(item.region);
    return [{
      version: 1,
      id,
      kind,
      ...(region ? { region } : {}),
      ...(item.role === "hero" || item.role === "support" ? { role: item.role } : {}),
    }];
  });
}

/**
 * Normalize a scene's typed component beats. A beat that references an
 * undeclared component, has an unknown kind, or is missing its kind-required
 * argument degrades away — the film stays buildable; the plan validator
 * separately reports support-map violations so the planner can fix them.
 */
export function normalizeStoryboardComponentBeats(
  value: unknown,
  scene: { sceneId: string; startSec: number; durationSec: number },
  components: SceneComponentSpecV1[],
): ComponentBeatIntentV1[] {
  if (!Array.isArray(value) || !components.length) return [];
  const componentIds = new Set(components.map((component) => component.id));
  const sceneEnd = scene.startSec + scene.durationSec;
  return value.flatMap((entry): ComponentBeatIntentV1[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const id = stableName(item.id);
    const component = stableName(item.component);
    const kind = typeof item.kind === "string" ? item.kind.trim() as ComponentBeatKind : "";
    if (!id || !component || !kind || !COMPONENT_BEAT_KINDS.has(kind)) return [];
    if (!componentIds.has(component)) return [];
    if (!finite(item.atSec)) return [];
    const rawAtSec = item.atSec;
    const candidateAtSec =
      scene.startSec > 0 &&
      rawAtSec >= 0 &&
      rawAtSec < scene.startSec &&
      rawAtSec <= scene.durationSec
        ? scene.startSec + rawAtSec
        : rawAtSec;
    const atSec = clamp(candidateAtSec, scene.startSec, sceneEnd);
    const text = typeof item.text === "string" ? item.text.trim().slice(0, 220) : "";
    const toState = typeof item.toState === "string"
      ? item.toState.trim().toLowerCase().slice(0, 24)
      : "";
    const morphTo = stableName(item.morphTo);
    if ((kind === "type" || kind === "stream" || kind === "swap") && !text) return [];
    if (kind === "set-state" && !/^[a-z][a-z0-9-]*$/.test(toState)) return [];
    // A morph to an undeclared twin is kept: the plan validator reports it as
    // a retryable finding instead of the beat silently vanishing.
    if (kind === "morph" && (!morphTo || morphTo === component)) return [];
    const ease = typeof item.ease === "string" && EASE_PATTERN.test(item.ease.trim())
      ? item.ease.trim()
      : undefined;
    return [{
      version: 1,
      id,
      sceneId: scene.sceneId,
      component,
      kind,
      atSec: round(atSec),
      ...(finite(item.durationSec) ? { durationSec: round(Math.max(0.1, item.durationSec)) } : {}),
      ...(text && (kind === "type" || kind === "stream" || kind === "swap") ? { text } : {}),
      ...(finite(item.value)
        ? { value: kind === "progress" ? clamp(item.value, 0, 1) : clamp(item.value, -1e9, 1e9) }
        : {}),
      ...(finite(item.item) ? { item: clamp(Math.round(item.item), 1, 48) } : {}),
      ...(toState && (kind === "set-state" || kind === "press") ? { toState } : {}),
      ...(kind === "morph" ? { morphTo } : {}),
      ...(ease ? { ease } : {}),
    }];
  }).sort((a, b) => a.atSec - b.atSec);
}

/* ------------------------------------------------------------- resolution */

function beatDuration(beat: ComponentBeatIntentV1): number {
  const defaults = BEAT_DEFAULTS[beat.kind];
  if (finite(beat.durationSec)) {
    return clamp(beat.durationSec, defaults.minSec, defaults.maxSec);
  }
  if (beat.kind === "type" && beat.text) {
    return clamp(beat.text.length * 0.055, defaults.minSec, defaults.maxSec);
  }
  if (beat.kind === "stream" && beat.text) {
    return clamp(beat.text.split(/\s+/).length * 0.16, defaults.minSec, defaults.maxSec);
  }
  return defaults.defaultSec;
}

/**
 * Resolve per-scene component declarations into the concrete beat plan the
 * runtime compiles. Windows are clamped so a beat never escapes its scene.
 */
export function resolveComponentPlan(scenes: DirectScene[]): ComponentPlanV1 {
  const planScenes: SceneComponentPlanV1[] = [];
  for (const scene of scenes) {
    const beats = scene.beats ?? [];
    if (!beats.length) continue;
    const componentKinds = new Map(
      (scene.components ?? []).map((component) => [component.id, component.kind]),
    );
    const sceneEnd = round(scene.startSec + scene.durationSec);
    const resolved = beats.flatMap((beat): ResolvedComponentBeatV1[] => {
      const kind = componentKinds.get(beat.component);
      if (!kind || !componentSupportsBeat(kind, beat.kind)) return [];
      const startSec = clamp(beat.atSec, scene.startSec, sceneEnd);
      const endSec = clamp(startSec + beatDuration(beat), startSec + 0.1, sceneEnd);
      if (endSec - startSec < 0.08) return [];
      return [{
        id: beat.id,
        component: beat.component,
        kind: beat.kind,
        startSec: round(startSec),
        endSec: round(endSec),
        ease: beat.ease ?? BEAT_DEFAULTS[beat.kind].ease,
        ...(beat.text ? { text: beat.text } : {}),
        ...(finite(beat.value) ? { value: beat.value } : {}),
        ...(finite(beat.item) ? { item: beat.item } : {}),
        ...(beat.toState ? { toState: beat.toState } : {}),
        ...(beat.morphTo ? { morphTo: beat.morphTo } : {}),
      }];
    });
    if (resolved.length) planScenes.push({ sceneId: scene.id, beats: resolved });
  }
  return { version: 1, scenes: planScenes };
}

/* ----------------------------------------------------- redundancy dedupe */

/**
 * Property channels: two beats in the same channel on the same component
 * animate the same visual properties, so overlapping windows fight — the
 * runtime would drive one element's text/scale/fill from two tweens at once.
 */
const BEAT_CHANNELS: Record<ComponentBeatKind, string> = {
  type: "text",
  stream: "text",
  swap: "text",
  count: "value",
  progress: "fill",
  chart: "chart",
  rows: "rows",
  open: "panel",
  close: "panel",
  select: "pulse",
  press: "pulse",
  highlight: "pulse",
  "set-state": "state",
  morph: "morph",
};

/** Pulse kinds repeated in quick succession read as a stutter, not emphasis. */
const PULSE_KINDS: ReadonlySet<ComponentBeatKind> = new Set(["press", "select", "highlight"]);
/** A same-kind pulse on one component within this window is a double fire. */
const PULSE_REPEAT_WINDOW_SEC = 1.5;
/** Slack around a cursor press inside which a pulse beat is a duplicate. */
const CURSOR_PRESS_SLACK_SEC = 0.45;

export interface BeatDedupeResult {
  scenes: DirectScene[];
  /** Human-readable log lines, one per dropped/converted beat. */
  dropped: string[];
}

/**
 * Deterministic de-double pass over a parsed storyboard, run before moments
 * top-up and validation. Planners double-trigger motion three ways, and each
 * plays as the same defect on screen — an element pulsing/animating twice in
 * quick succession:
 *
 * 1. the same pulse beat (press/select/highlight) repeated on one component
 *    within ~1.5s;
 * 2. two beats in one property channel overlapping on one component (two
 *    counts, type over swap, open over close);
 * 3. a `press`/`select` beat scheduled on the same part a cursor interaction
 *    is already pressing — the interaction runtime owns the press scale, so
 *    the beat is a second pulse on the same frames (it survives as a pure
 *    `set-state` when it carries a state change).
 *
 * Beats degrade (drop/convert) instead of vetoing the plan, mirroring
 * `dropUnusableVolunteeredTimeRamps`.
 */
export function dedupeRedundantBeats(storyboard: DirectScene[]): BeatDedupeResult {
  const dropped: string[] = [];
  const scenes = storyboard.map((scene) => {
    const beats = scene.beats ?? [];
    if (!beats.length) return scene;
    const supportsSetState = new Map(
      (scene.components ?? []).map((component) => [
        component.id,
        componentSupportsBeat(component.kind, "set-state"),
      ]),
    );
    const pressWindows = (scene.interactions ?? [])
      .filter((intent) =>
        (intent.feedback === "press" || intent.feedback === "press-ripple") &&
        intent.pressSec != null
      )
      .map((intent) => ({
        part: intent.targetPart,
        start: intent.pressSec! - CURSOR_PRESS_SLACK_SEC,
        end: (intent.releaseSec ?? intent.pressSec! + 0.3) + CURSOR_PRESS_SLACK_SEC,
      }));
    const kept: ComponentBeatIntentV1[] = [];
    let changed = false;
    for (const beat of beats) {
      const startSec = beat.atSec;
      const endSec = beat.atSec + beatDuration(beat);
      // Rule 3: cursor press already pulses this part on these frames.
      if (PULSE_KINDS.has(beat.kind)) {
        const cursorPress = pressWindows.find((window) =>
          window.part === beat.component &&
          startSec < window.end &&
          endSec > window.start
        );
        if (cursorPress) {
          changed = true;
          if (beat.kind === "press" && beat.toState && supportsSetState.get(beat.component)) {
            kept.push({ ...beat, kind: "set-state" });
            dropped.push(
              `scene "${scene.id}": beat "${beat.id}" (${beat.kind} on ${beat.component}) ` +
                `overlaps a cursor press on the same part — kept as set-state only`,
            );
          } else {
            dropped.push(
              `scene "${scene.id}": beat "${beat.id}" (${beat.kind} on ${beat.component}) ` +
                `duplicates a cursor press on the same part in the same window`,
            );
          }
          continue;
        }
      }
      const conflict = kept.find((earlier) => {
        if (earlier.component !== beat.component) return false;
        const earlierEnd = earlier.atSec + beatDuration(earlier);
        // Rule 1: repeated pulse of the same kind in quick succession (a
        // select of a different item is navigation, not a stutter).
        if (
          PULSE_KINDS.has(beat.kind) &&
          earlier.kind === beat.kind &&
          !(beat.kind === "select" && earlier.item !== beat.item) &&
          startSec - earlier.atSec < PULSE_REPEAT_WINDOW_SEC
        ) {
          return true;
        }
        // Rule 2: same property channel, overlapping windows.
        return BEAT_CHANNELS[earlier.kind] === BEAT_CHANNELS[beat.kind] &&
          startSec < earlierEnd &&
          endSec > earlier.atSec;
      });
      if (conflict) {
        changed = true;
        dropped.push(
          `scene "${scene.id}": beat "${beat.id}" (${beat.kind} on ${beat.component}) ` +
            `re-triggers "${conflict.id}" (${conflict.kind}) on the same component — dropped`,
        );
        continue;
      }
      // Rule 4: a morph already brings its twin on stage (the runtime reveals
      // the pre-hidden target mid-morph); an `open` on that twin afterwards
      // re-runs its entrance OVER the morph reveal — two fromTo tweens fight
      // on one element and the twin flashes hidden then re-opens (the
      // 2026-07-06 sentinel-p5-denseui "weird morphing" artifact). Drop the
      // open unless an intervening `close` put the twin away first.
      if (beat.kind === "open") {
        const morphIn = kept.find((earlier) =>
          earlier.kind === "morph" &&
          earlier.morphTo === beat.component &&
          beat.atSec >= earlier.atSec &&
          !kept.some((mid) =>
            mid.component === beat.component &&
            mid.kind === "close" &&
            mid.atSec > earlier.atSec &&
            mid.atSec < beat.atSec
          )
        );
        if (morphIn) {
          changed = true;
          dropped.push(
            `scene "${scene.id}": beat "${beat.id}" (open on ${beat.component}) re-opens the ` +
              `twin that morph "${morphIn.id}" already brings on stage — dropped (a morph IS ` +
              `the twin's entrance)`,
          );
          continue;
        }
      }
      kept.push(beat);
    }
    if (!changed) return scene;
    return { ...scene, beats: kept };
  });
  return { scenes, dropped };
}

/* --------------------------------------------------- complexity governor */

/** Seconds of scene time each declared component needs to carry meaning. */
const SEC_PER_COMPONENT = 1.2;
/** Hard per-scene ceiling regardless of duration. */
const MAX_COMPONENTS_PER_SCENE = 4;
/** Seconds of film each declared component costs the author to build. */
const FILM_SEC_PER_COMPONENT = 2.0;

/* ------------------------------------------------------- exit discipline */

/**
 * Station-dominating overlay kinds: each is invoked by an `open` beat and
 * covers the content beneath it. When a SECOND one opens into the same station
 * while the FIRST is still up (never closed/swapped/morphed), they pile into
 * the "messy stack" the operator called out (probe-cutfix-3: "assets don't
 * disappear when necessary and overlap"). This is the one exit defect the
 * PLAN can prove: base content surfaces (app-window/stat-card/table/…) have no
 * `open` beat — they enter via the author's own tween — so an overlay opening
 * over base content (⌘K over a window, a modal over a dashboard) is the
 * DESIGNED pattern and never involved here. Corner transients (toast) and
 * inline widgets (search) are excluded — they do not dominate a station.
 * Rendered overlap of any lingering surface — base or overlay — is the QA
 * stage's advisory `stale_asset_lingers` job, not this plan gate.
 */
const STACKABLE_OVERLAY_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  "command-palette", "modal", "dropdown", "context-menu",
]);

/** Beats that retire or repurpose a surface so a later one may take its place. */
const SURFACE_RETIRE_BEATS: ReadonlySet<ComponentBeatKind> = new Set<ComponentBeatKind>([
  "close", "swap", "morph",
]);

/**
 * Deterministic plan-complexity audit, run at storyboard validation. The
 * 2026-07-04 baseline failure mode: GLM declared 11 components (4 in one
 * 2.7s scene) for an 18s film, and the source author burned all three
 * attempts failing to bind them — the film shipped as the deterministic
 * fallback. A storyboard finding-retry is far cheaper than an author
 * failure, so plans that exceed what an author can actually build (and a
 * viewer can actually read) are rejected with precise, fixable findings.
 */
export function auditComponentComplexity(
  scenes: Array<Pick<DirectScene, "id" | "durationSec" | "components">>,
): string[] {
  const findings: string[] = [];
  let total = 0;
  let filmSec = 0;
  for (const scene of scenes) {
    const count = scene.components?.length ?? 0;
    total += count;
    filmSec += scene.durationSec;
    const cap = Math.min(
      MAX_COMPONENTS_PER_SCENE,
      Math.max(1, Math.floor(scene.durationSec / SEC_PER_COMPONENT)),
    );
    if (count > cap) {
      findings.push(
        `components/complexity: scene "${scene.id}" (${scene.durationSec.toFixed(1)}s) declares ` +
          `${count} components — a viewer cannot read more than ${cap} product surfaces in that ` +
          `window and the author cannot build them; keep <= ${cap} (let one component carry ` +
          `several beats, or drop the surfaces that are set dressing)`,
      );
    }
  }
  const filmCap = Math.max(2, Math.ceil(filmSec / FILM_SEC_PER_COMPONENT));
  if (total > filmCap) {
    findings.push(
      `components/complexity: the plan declares ${total} components across ${filmSec.toFixed(0)}s ` +
        `— more surfaces than a film this length can introduce with meaning. Keep <= ${filmCap} ` +
        `total: reuse one declared component across beats instead of declaring a new one per idea`,
    );
  }
  return findings;
}

/**
 * Exit discipline (WS4), plan stage. Ownership was "the author owns entrances
 * and final states"; exits were nobody's job, so a scene could OPEN a second
 * overlay into a station already holding a live one and both just sat there
 * overlapping (operator verdict on probe-cutfix-3: "assets don't disappear
 * when necessary and overlap"). This surfaces that exact case as a cheap
 * storyboard finding-retry (never a veto — it degrades to advisory on late
 * attempts) asking the plan to retire the outgoing overlay (`close` / `swap` /
 * `morph`) or give the incoming one its own `data-region` station.
 *
 * Conservative by construction, because false positives are the whole game:
 * BOTH surfaces must be station-dominating overlays whose open windows
 * OVERLAP (the second opens before the first is retired) in the SAME station.
 * An overlay opening over base content, deliberate static composition,
 * different stations, an already-retired surface, and an intended morph
 * `live → incoming` all pass untouched.
 */
export function auditSurfaceExits(
  scenes: Array<Pick<DirectScene, "id" | "startSec" | "components" | "beats">>,
): string[] {
  const findings: string[] = [];
  for (const scene of scenes) {
    const overlays = (scene.components ?? []).filter((component) =>
      STACKABLE_OVERLAY_KINDS.has(component.kind)
    );
    if (overlays.length < 2) continue;
    const beats = scene.beats ?? [];
    const firstOpen = (id: string): number | undefined =>
      beats
        .filter((beat) => beat.component === id && beat.kind === "open")
        .sort((a, b) => a.atSec - b.atSec)[0]?.atSec;
    const regionBucket = (component: SceneComponentSpecV1): string =>
      component.region?.trim() || "__viewport__";
    for (const incoming of overlays) {
      const openAt = firstOpen(incoming.id);
      // Only a real `open` beat stacks an overlay; a statically composed one is
      // deliberate layout the QA-stage rendered-overlap check owns.
      if (openAt === undefined) continue;
      const bucket = regionBucket(incoming);
      for (const live of overlays) {
        if (live.id === incoming.id || regionBucket(live) !== bucket) continue;
        // `live` must already be open when `incoming` opens (its own earlier
        // open beat — a statically composed overlay has no open window to clash).
        const liveOpen = firstOpen(live.id);
        if (liveOpen === undefined || liveOpen >= openAt) continue;
        // `live` morphing INTO `incoming` is the intended transform.
        if (beats.some((beat) => beat.component === live.id && beat.morphTo === incoming.id)) continue;
        // A close/swap/morph on `live` before the open retires it cleanly.
        if (
          beats.some((beat) =>
            beat.component === live.id &&
            beat.atSec <= openAt + 0.05 &&
            SURFACE_RETIRE_BEATS.has(beat.kind)
          )
        ) {
          continue;
        }
        const station = live.region ? `station "${live.region}"` : "viewport";
        findings.push(
          `components/exit: scene "${scene.id}" opens "${incoming.id}" (${incoming.kind}) at ` +
            `${openAt.toFixed(1)}s while "${live.id}" (${live.kind}) is still open in the same ` +
            `${station} — two overlays stacked reads as clutter. Close or swap "${live.id}" ` +
            `before opening "${incoming.id}", or give "${incoming.id}" its own data-region station.`,
        );
      }
    }
  }
  return [...new Set(findings)];
}

/* ------------------------------------------------------- runtime + kit IO */

export function componentRuntimeSource(): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, COMPONENT_RUNTIME_FILE), "utf8");
}

export function componentRuntimeHash(): string {
  return createHash("sha256").update(componentRuntimeSource()).digest("hex");
}

export function componentKitSource(): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, COMPONENT_KIT_FILE), "utf8");
}

export function componentKitHash(): string {
  return createHash("sha256").update(componentKitSource()).digest("hex");
}

export function componentKitStyleTag(): string {
  return `<style id="${COMPONENT_KIT_STYLE_ID}" data-version="${COMPONENT_KIT_VERSION}">\n${componentKitSource()}</style>`;
}

const KIT_STYLE_BLOCK = new RegExp(
  `<style\\b[^>]*\\bid\\s*=\\s*(["'])${COMPONENT_KIT_STYLE_ID}\\1[^>]*>[\\s\\S]*?</style>`,
  "i",
);

/**
 * Inject (or refresh to canonical) the component kit CSS before the first
 * authored <style> so authored rules can override kit defaults. Idempotent —
 * a stale or hand-written kit block is replaced with the versioned source.
 */
export function injectComponentKit(html: string): string {
  if (KIT_STYLE_BLOCK.test(html)) {
    return html.replace(KIT_STYLE_BLOCK, componentKitStyleTag().replace(/\$/g, "$$$$"));
  }
  const tag = componentKitStyleTag();
  const styleTag = /<style\b/i.exec(html);
  if (styleTag?.index !== undefined) {
    return html.slice(0, styleTag.index) + tag + "\n  " + html.slice(styleTag.index);
  }
  const headClose = /<\/head>/i.exec(html);
  if (headClose?.index !== undefined) {
    return html.slice(0, headClose.index) + tag + "\n" + html.slice(headClose.index);
  }
  return html;
}

/** Inject the component runtime script tag after the host GSAP tag. Idempotent. */
export function injectComponentRuntimeTag(html: string): string {
  if (
    html.includes(`src="${COMPONENT_RUNTIME_FILE}"`) ||
    html.includes(`src='${COMPONENT_RUNTIME_FILE}'`)
  ) {
    return html;
  }
  return html.replace(
    /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
    `$1\n<script src="${COMPONENT_RUNTIME_FILE}"></script>`,
  );
}

/* --------------------------------------------------------------- parsing */

export function parseComponentPlan(html: string): { plan?: ComponentPlanV1; errors: string[] } {
  const match = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-components\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return { errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(match[2]!.trim());
  } catch (error) {
    return {
      errors: [
        `sequences-components JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["sequences-components must be an object"] };
  }
  const object = value as Record<string, unknown>;
  const errors: string[] = [];
  if (object.version !== 1) errors.push("sequences-components.version must be 1");
  if (!Array.isArray(object.scenes)) {
    errors.push("sequences-components.scenes must be an array");
    return { errors };
  }
  const scenes = object.scenes.flatMap((entry, index): SceneComponentPlanV1[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`components scene[${index}] must be an object`);
      return [];
    }
    const sceneObject = entry as Record<string, unknown>;
    const sceneId = typeof sceneObject.sceneId === "string" ? sceneObject.sceneId.trim() : "";
    if (!sceneId) errors.push(`components scene[${index}] needs a sceneId`);
    if (!Array.isArray(sceneObject.beats) || !sceneObject.beats.length) {
      errors.push(`components scene[${index}] needs beats`);
      return [];
    }
    const beats = sceneObject.beats.flatMap((raw, beatIndex): ResolvedComponentBeatV1[] => {
      const label = `components scene[${index}].beats[${beatIndex}]`;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${label} must be an object`);
        return [];
      }
      const beat = raw as Record<string, unknown>;
      const kind = typeof beat.kind === "string" ? beat.kind as ComponentBeatKind : "";
      const id = stableName(beat.id);
      const component = stableName(beat.component);
      if (!kind || !COMPONENT_BEAT_KINDS.has(kind)) {
        errors.push(`${label} kind "${String(beat.kind)}" is unsupported`);
      }
      if (!id || !component) errors.push(`${label} needs stable id and component`);
      if (!finite(beat.startSec) || !finite(beat.endSec)) {
        errors.push(`${label} needs finite startSec/endSec`);
      }
      const ease = typeof beat.ease === "string" ? beat.ease : "";
      if (!EASE_PATTERN.test(ease)) errors.push(`${label} ease "${ease}" is not a known ease`);
      if (errors.some((error) => error.startsWith(label))) return [];
      const morphTo = stableName(beat.morphTo);
      const toState = typeof beat.toState === "string" ? beat.toState : "";
      return [{
        id,
        component,
        kind: kind as ComponentBeatKind,
        startSec: beat.startSec as number,
        endSec: beat.endSec as number,
        ease,
        ...(typeof beat.text === "string" && beat.text ? { text: beat.text } : {}),
        ...(finite(beat.value) ? { value: beat.value } : {}),
        ...(finite(beat.item) ? { item: beat.item } : {}),
        ...(toState ? { toState } : {}),
        ...(morphTo ? { morphTo } : {}),
      }];
    });
    return sceneId && beats.length ? [{ sceneId, beats }] : [];
  });
  return errors.length
    ? { errors }
    : { plan: { version: 1, scenes }, errors: [] };
}

/* ------------------------------------------------------------- validation */

export interface ComponentContractResult {
  plan?: ComponentPlanV1;
  errors: string[];
  warnings: string[];
}

function sceneScopes(html: string): Array<{ id: string; scope: string }> {
  const tags = [...html.matchAll(
    /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
  )];
  return tags.map((tag, index) => {
    const tagName = tag[0].match(/^<([a-z][\w:-]*)\b/i)?.[1];
    const nextScene = tags[index + 1]?.index ?? html.length;
    let end = nextScene;
    if (tagName) {
      const close = new RegExp(`</${tagName}\\s*>`, "i")
        .exec(html.slice(tag.index + tag[0].length, nextScene));
      if (close?.index !== undefined) {
        end = tag.index + tag[0].length + close.index + close[0].length;
      }
    }
    return {
      id: (tag[1] ?? tag[2] ?? tag[3] ?? "").trim(),
      scope: html.slice(tag.index, end),
    };
  });
}

function attributeMatches(scope: string, attribute: string, value: string): number {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...scope.matchAll(
    new RegExp(`\\b${attribute}\\s*=\\s*(["'])${escaped}\\1`, "gi"),
  )].length;
}

/**
 * Static publication gate for the component plan. Every declared component
 * must exist as exactly one `data-part` element carrying its declared
 * `data-component` kind inside its scene; a declared beat plan must ship its
 * island, runtime, and compile call byte-equal to the storyboard resolution.
 * Kit-class adoption is advisory (warning), never a veto.
 */
export function validateComponentContract(
  html: string,
  scenes: DirectScene[],
): ComponentContractResult {
  const parsed = parseComponentPlan(html);
  const errors = [...parsed.errors];
  const warnings: string[] = [];
  const expected = resolveComponentPlan(scenes);
  const scopes = new Map(sceneScopes(html).map((scene) => [scene.id, scene.scope]));

  // Declared component instances must bind even when no beat targets them —
  // they are camera/cut/interaction anchors and the film's build order.
  for (const scene of scenes) {
    const scope = scopes.get(scene.id);
    for (const component of scene.components ?? []) {
      if (!scope) {
        errors.push(
          `component "${component.id}" is declared on unknown scene "${scene.id}"`,
        );
        continue;
      }
      const partCount = attributeMatches(scope, "data-part", component.id);
      if (partCount === 0) {
        errors.push(
          `scene "${scene.id}" declares component "${component.id}" (${component.kind}) but no ` +
            `data-part="${component.id}" element exists in that scene`,
        );
        continue;
      }
      if (partCount > 1) {
        errors.push(
          `component "${component.id}" must bind to exactly one element in scene "${scene.id}"; ` +
            `found ${partCount}`,
        );
        continue;
      }
      const partTag = new RegExp(
        `<[a-z][\\w:-]*\\b[^>]*\\bdata-part\\s*=\\s*(["'])${
          component.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        }\\1[^>]*>`,
        "i",
      ).exec(scope)?.[0] ?? "";
      const declaredKind = partTag.match(/\bdata-component\s*=\s*(["'])(.*?)\1/i)?.[2];
      if (declaredKind !== component.kind) {
        errors.push(
          `component "${component.id}" in scene "${scene.id}" must carry ` +
            `data-component="${component.kind}"${declaredKind ? ` (found "${declaredKind}")` : ""}`,
        );
        continue;
      }
      const className = CATALOG_BY_KIND.get(component.kind)?.className;
      if (className && !new RegExp(`\\bclass\\s*=\\s*(["'])[^"']*\\b${className}\\b`, "i").test(partTag)) {
        warnings.push(
          `component "${component.id}" (${component.kind}) does not use the host kit class ` +
            `"${className}"; kit styling and runtime part synthesis work best on kit markup`,
        );
      }
      if (
        component.region &&
        !new RegExp(
          `\\bdata-region\\s*=\\s*(["'])${component.region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`,
          "i",
        ).test(scope)
      ) {
        warnings.push(
          `component "${component.id}" was planned for region "${component.region}" but that ` +
            `data-region does not exist in scene "${scene.id}"`,
        );
      }
    }
  }

  if (!parsed.plan && expected.scenes.length === 0) {
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }
  if (!parsed.plan) {
    errors.push(
      "storyboard declares component beats but index_html has no sequences-components JSON island",
    );
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }
  if (
    !html.includes(`src="${COMPONENT_RUNTIME_FILE}"`) &&
    !html.includes(`src='${COMPONENT_RUNTIME_FILE}'`)
  ) {
    errors.push(`component composition must load local ${COMPONENT_RUNTIME_FILE}`);
  }
  if (!/\bSequencesComponents\.compile\s*\(/.test(html)) {
    errors.push("component composition must call SequencesComponents.compile(timeline, root)");
  }
  if (JSON.stringify(parsed.plan) !== JSON.stringify(expected)) {
    errors.push("sequences-components island differs from the storyboard's resolved component plan");
  }
  for (const scenePlan of parsed.plan.scenes) {
    const scope = scopes.get(scenePlan.sceneId);
    if (!scope) {
      errors.push(`component plan references unknown scene "${scenePlan.sceneId}"`);
      continue;
    }
    for (const beat of scenePlan.beats) {
      for (const part of [beat.component, beat.morphTo]) {
        if (part && attributeMatches(scope, "data-part", part) !== 1) {
          errors.push(
            `beat "${beat.id}" targets component "${part}" but scene "${scenePlan.sceneId}" ` +
              `does not contain exactly one data-part="${part}" element`,
          );
        }
      }
    }
  }
  return {
    plan: parsed.plan,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

/**
 * Windows during which a morph beat intentionally moves a component across
 * the frame — mid-travel geometry is designed motion, so static layout
 * heuristics are suppressed there exactly like cut and camera windows.
 */
export function componentMotionWindows(
  plan: ComponentPlanV1 | undefined,
): Array<{ start: number; end: number }> {
  if (!plan) return [];
  return plan.scenes.flatMap((scene) =>
    scene.beats
      .filter((beat) => beat.kind === "morph" || beat.kind === "open" || beat.kind === "close")
      .map((beat) => ({ start: beat.startSec - 0.05, end: beat.endSec + 0.1 }))
  );
}

/* --------------------------------------------------------- prompt renders */

/**
 * Compact component vocabulary for the GLM storyboard pass (~1.3K chars):
 * what exists, what state changes it supports, and which twins morph.
 */
export function componentPlanningVocabulary(): string {
  const lines = COMPONENT_CATALOG.map((spec) => {
    const beats = [...new Set([...spec.beats])];
    const morphs = spec.morphsWith?.length ? ` · morphs↔${spec.morphsWith.join("/")}` : "";
    return `- ${spec.kind}: ${spec.purpose}${beats.length ? ` · beats: ${beats.join(",")}` : ""}${morphs}`;
  });
  return [
    "COMPONENT KIT — typed SaaS product surfaces (host-styled, host-animated).",
    "Declare per-scene components (stable kebab-case id + kind below); each is",
    "authored once as a data-part element and becomes a first-class object the",
    "camera can track, a cut can object-match, and a cursor can click. Then",
    "declare typed BEATS — state changes at absolute seconds — and the host",
    "compiles the motion (typing, opening, counting, streaming, morphing)",
    "deterministically. Every beat is executable moment evidence.",
    "Universal beats on any component: set-state, highlight, swap, morph.",
    ...lines,
  ].join("\n");
}

/**
 * Authoring reference for the source pass: the markup contract for exactly
 * the component kinds a job declares (default: the whole catalog). Injected
 * into the authoring prompt beside the locked storyboard, so the model gets
 * complete markup for what it must build and nothing else.
 */
export function componentAuthoringReference(kinds?: Iterable<ComponentKind>): string {
  const requested = kinds ? new Set(kinds) : undefined;
  const specs = COMPONENT_CATALOG.filter((spec) =>
    !requested || requested.has(spec.kind)
  );
  if (!specs.length) return "";
  return [
    "## Component kit (host-owned) — markup contract",
    "",
    "The host injects the component kit stylesheet (style id " +
      `\`${COMPONENT_KIT_STYLE_ID}\`) into every composition and, when the locked`,
    "storyboard declares component beats, the `sequences-components` JSON island +",
    `\`${COMPONENT_RUNTIME_FILE}\` + \`SequencesComponents.compile(tl, root)\`.`,
    "Author each declared component ONCE with its exact data-part id and",
    "data-component kind, using the kit markup below (pair with .material /",
    ".material-hero / .inset-well for light). Author its ENTRANCE yourself;",
    "never author its internal state motion — typing, opening, selecting,",
    "counting, chart growth, streaming, and morphs are compiled by the host",
    "runtime from the storyboard beats. Author the FINAL state (full text,",
    "final numbers, final bar heights); the runtime animates toward it. States",
    "are data-state/data-active attributes the runtime flips. A morph target",
    "starts hidden by the runtime; do not author an entrance for it.",
    "A `rows` or `stream` beat reveals EXISTING children: author at least 3",
    ".cmp-row / .cmp-item / .cmp-card / .cmp-msg children inside that target",
    "yourself — a rows beat on a childless container has nothing to reveal and",
    "aborts the compile.",
    "",
    ...specs.map((spec) => `**${spec.kind}** \`${spec.markup}\``),
  ].join("\n");
}
