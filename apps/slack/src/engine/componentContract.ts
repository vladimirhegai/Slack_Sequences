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
 * - the AUTHOR owns placement and copy; it owns root entrances only when the
 *   scene does not declare a host-compiled `componentEntranceFamily`;
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
import { CAMERA_FULL_MOVES, SEQUENCES_EASES } from "./cameraContract.ts";
import { canonicalCutStyle, type CutAxis } from "./cutContract.ts";
import {
  resolveContinuityGraph,
  type ContinuityStateV1,
} from "./continuityGraph.ts";

export const COMPONENT_RUNTIME_VERSION = 1;
export const COMPONENT_RUNTIME_FILE = "sequences-components.v1.js";
export const COMPONENT_KIT_VERSION = 1;
export const COMPONENT_KIT_FILE = "sequences-components.v1.css";
export const COMPONENT_KIT_STYLE_ID = "sequences-components-kit";

/** Typed follow-through guardrails (WS-C1). */
export const MIN_COMPONENT_FOLLOW_LAG_MS = 60;
export const MAX_COMPONENT_FOLLOW_LAG_MS = 120;
export const DEFAULT_COMPONENT_FOLLOW_LAG_MS = 90;
export const MAX_COMPONENT_FOLLOW_CHAIN_DEPTH = 3;
export const MAX_COMPONENT_EXIT_RECEDE_PERCENT = 40;
const DIRECTIONAL_COMPONENT_EXIT_RECEDE_PERCENT = 18;

/** One host-owned root-entrance grammar per scene (WS-C2). */
export type ComponentEntranceFamily = "rise" | "assemble" | "materialize";
export const COMPONENT_ENTRANCE_FAMILIES: ReadonlySet<ComponentEntranceFamily> =
  new Set<ComponentEntranceFamily>(["rise", "assemble", "materialize"]);

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
  | "avatar-stack"
  | "headline"
  | "asset";

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
  | "swap"
  | "animate";

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
  /**
   * Host-only kind: excluded from the planner vocabulary, the authoring
   * reference, and model-side normalization (Sentinel L0 — the models cannot
   * even represent it). Only host lowerings may declare it.
   */
  internal?: boolean;
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
    beats: ["press", "open"],
    markup:
      `<button class="cmp cmp-button" data-component="button" data-part="deploy-cta" data-state="idle">` +
      `<span class="cmp-label">Deploy</span><span class="cmp-spinner"></span><span class="cmp-check">✓</span></button>`,
  },
  {
    kind: "toggle",
    className: "cmp-toggle",
    purpose: "On/off switch",
    beats: ["open"],
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
    markup:
      `<div class="cmp cmp-modal" data-component="modal" data-part="invite-modal">` +
      `<div class="cmp-scrim"></div><div class="cmp-dialog material-hero"><div class="cmp-title">Invite your team</div>…</div></div>`,
  },
  {
    kind: "stat-card",
    className: "cmp-stat",
    purpose: "Metric tile: label, big value (counts up), delta chip",
    beats: ["count", "open"],
    morphsWith: ["progress-ring"],
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
    beats: ["progress", "count", "open"],
    morphsWith: ["stat-card"],
    markup:
      `<div class="cmp cmp-ring" data-component="progress-ring" data-part="uptime">` +
      `<svg viewBox="0 0 120 120"><circle class="cmp-ring-bg" cx="60" cy="60" r="52"/>` +
      `<circle class="cmp-ring-fg" cx="60" cy="60" r="52"/></svg><div class="cmp-value" data-cmp-value>99.99%</div></div>`,
  },
  {
    kind: "progress",
    className: "cmp-progress",
    purpose: "Horizontal progress/loading bar",
    beats: ["progress", "open"],
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
    beats: ["rows", "open"],
    markup:
      `<div class="cmp cmp-avatars" data-component="avatar-stack" data-part="team">` +
      `<i>AL</i><i>KD</i><i>MR</i><span class="cmp-more">+9</span></div>`,
  },
  {
    kind: "headline",
    className: "cmp-headline",
    purpose:
      "Hero copy as a first-class object (camera/cut/moment addressable); the " +
      "runtime splits its text for kinetic reveals",
    // type carries the kinetic-reveal style (typewriter|rise|pop|assemble);
    // swap re-fills the whole line. The letter split runs on the wrapper, so a
    // swap MUST target the wrapper's text slot, never the split spans.
    beats: ["type", "swap"],
    markup:
      `<h1 class="cmp cmp-headline" data-component="headline" data-part="hero-copy">` +
      `<span class="cmp-text" data-cmp-text>Final copy</span></h1>`,
  },
  {
    kind: "asset",
    className: "asset",
    internal: true,
    purpose:
      "Pre-built parametric library asset (ASSETS.md), host-lowered from an " +
      "asset-<id> plugin declaration — never planner-declared or author-drawn. " +
      "Its `animate` beats are spring animations compiled by the host asset runtime.",
    beats: ["animate"],
    markup:
      `<div class="asset" data-component="asset" data-part="unit-core">` +
      `…host-generated — do not author…</div>`,
  },
];

const CATALOG_BY_KIND = new Map(COMPONENT_CATALOG.map((spec) => [spec.kind, spec]));

export const COMPONENT_KINDS: ReadonlySet<ComponentKind> = new Set(
  COMPONENT_CATALOG.map((spec) => spec.kind),
);

export const COMPONENT_BEAT_KINDS: ReadonlySet<ComponentBeatKind> = new Set<ComponentBeatKind>([
  "type", "open", "close", "select", "press", "set-state", "count",
  "progress", "chart", "rows", "stream", "highlight", "morph", "swap",
  // Host-only (asset spring animations): valid in resolved plans/islands, but
  // normalizeStoryboardComponentBeats rejects it from model storyboards.
  "animate",
]);

/** Model-facing subsets (Sentinel L0): host-only kinds/beats are excluded from
 * the storyboard JSON schema so the planner cannot even represent them. */
export const PLANNER_COMPONENT_KINDS: readonly ComponentKind[] =
  COMPONENT_CATALOG.filter((spec) => !spec.internal).map((spec) => spec.kind);
export const PLANNER_COMPONENT_BEAT_KINDS: readonly ComponentBeatKind[] =
  [...COMPONENT_BEAT_KINDS].filter((kind) => kind !== "animate");

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
 * Whether two DECLARED component instances share a semantic morph family.
 *
 * Every kind may morph to a distinct instance of the same kind: button-to-
 * button is the canonical pill/status transition, while stat-card-to-stat-card
 * preserves a metric. `morphPartnerKinds` intentionally remains the narrower
 * cross-kind inference table used when a planner forgot to declare its twin;
 * treating the source kind as inferred there would make every missing target
 * ambiguous and would break search-to-command-palette recovery.
 */
export function componentKindsMorphCompatible(
  source: ComponentKind,
  target: ComponentKind,
): boolean {
  return source === target || morphPartnerKinds(source).includes(target);
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
  /**
   * Stable semantic identity across scene-local representations. Optional and
   * planner-facing only while the default-off continuity graph is enabled;
   * the host stamps the corresponding DOM attribute mechanically.
   */
  entityId?: string;
  /**
   * Host-stamped when this component was lowered from a declared plugin unit
   * (`pluginContract.ts`) — never model-authored (`normalizeStoryboardComponents`
   * cannot emit it). Components sharing a pluginUid are ONE budget/pacing unit:
   * complexity audits count the unit once and trims never dismember it.
   */
  pluginUid?: string;
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
  /**
   * Optional style variant on an EXISTING beat kind (the MOTION_DESIGN_PLAN
   * vocabulary rule: one optional field on an existing concept, never a new
   * system). `type`: typewriter|rise|pop|assemble · `open`: pop ·
   * `highlight`: ring|sweep|underline. Absent = today's behavior; an
   * unsupported value is style-dropped at parse, never beat-dropped.
   */
  style?: string;
  /**
   * `animate` beats only (host-lowered from asset declarations, never
   * model-authored): the asset library animation name this beat invokes. The
   * asset runtime compiles the spring motion; the components runtime skips it.
   */
  animation?: string;
  /**
   * Optional choreography dependency (WS-C1): a prior beat id, or a component
   * id whose latest prior beat becomes the lead. Resolution owns the timing;
   * malformed/cyclic/over-depth relationships degrade to the beat's own atSec.
   */
  follows?: string;
  /** Follow delay in milliseconds; normalized to 60..120 (default 90). */
  lagMs?: number;
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
  /** Host-derived baseline resolved by the prior continuity appearance. */
  fromValue?: number;
  item?: number;
  toState?: string;
  morphTo?: string;
  style?: string;
  animation?: string;
  /** Applied follow relationship only (invalid relationships are omitted). */
  follows?: string;
  lagMs?: number;
  followDepth?: number;
  /** Host-derived from a directional outgoing cut for close choreography. */
  exitAxis?: CutAxis;
  /** Directional travel as a percentage of the retiring component's size. */
  exitRecedePercent?: number;
}

export interface ResolvedComponentEntranceV1 {
  component: string;
  startSec: number;
  endSec: number;
  ease: string;
}

export interface SceneComponentPlanV1 {
  sceneId: string;
  /** State applied before any incoming-scene beat; survives arbitrary seek. */
  initialStates?: Array<{ component: string; state: ContinuityStateV1 }>;
  /** Declared once; every entry below uses this same visual grammar. */
  entranceFamily?: ComponentEntranceFamily;
  entrances?: ResolvedComponentEntranceV1[];
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
  // Asset spring animations: the real curve lives in the assets island (spring
  // samples); this paperwork window mirrors the compiled duration the lowering
  // stamps, with room for a slow bounce settle.
  animate: { ease: "none", defaultSec: 0.8, minSec: 0.15, maxSec: 6 },
};

const EASE_PATTERN = new RegExp(
  `^(?:${SEQUENCES_EASES.join("|")}|(?:power[1-4]|expo|sine|circ)\\.(?:in|out|inOut)|none|linear)$`,
);

/** Legal `style` variants per beat kind, with the default listed first (a
 * declared default is normalized away so islands stay canonical). */
const BEAT_STYLE_OPTIONS: Partial<Record<ComponentBeatKind, readonly string[]>> = {
  type: ["typewriter", "rise", "pop", "assemble"],
  open: ["default", "pop"],
  highlight: ["ring", "sweep", "underline"],
};

/**
 * Compact acknowledgment surfaces the MD6 `open` pop is allowed on — the
 * "energetic cascade" register that earns overshoot. Everything else (windows,
 * tables, text blocks, panels) keeps the smooth default open. The taste rule is
 * enforced DETERMINISTICALLY (`degradeOpenPopStyles`), not in prose.
 */
export const COMPACT_POP_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  "toast", "button", "stat-card", "toggle", "progress", "progress-ring", "avatar-stack",
]);
/** Per-scene ceiling on pop-styled opens — beyond it the pop is noise, not accent. */
export const MAX_POP_OPENS_PER_SCENE = 2;

/** Type styles that split the copy into per-letter/word spans at compile time. */
export const HEADLINE_SPLIT_STYLES: ReadonlySet<string> = new Set(["rise", "pop", "assemble"]);

/** Normalize a beat's optional style: unknown/unsupported/default → absent. */
function beatStyle(kind: ComponentBeatKind, value: unknown): string | undefined {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const options = BEAT_STYLE_OPTIONS[kind];
  if (!raw || !options || !options.includes(raw)) return undefined;
  return raw === options[0] ? undefined : raw;
}

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

/** Normalize the scene-level WS-C2 enum without inventing a fallback family. */
export function normalizeStoryboardComponentEntranceFamily(
  value: unknown,
): ComponentEntranceFamily | undefined {
  const family = typeof value === "string" ? value.trim().toLowerCase() : "";
  return COMPONENT_ENTRANCE_FAMILIES.has(family as ComponentEntranceFamily)
    ? family as ComponentEntranceFamily
    : undefined;
}

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
    // Host-only kinds (the asset unit root) are unrepresentable from the model
    // side — only a plugin lowering may declare them (Sentinel L0).
    if (CATALOG_BY_KIND.get(kind)?.internal) return [];
    seen.add(id);
    const region = stableName(item.region);
    const entityId = stableName(item.entityId);
    return [{
      version: 1,
      id,
      kind,
      ...(region ? { region } : {}),
      ...(item.role === "hero" || item.role === "support" ? { role: item.role } : {}),
      ...(entityId ? { entityId } : {}),
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
    // `animate` is host-only (asset lowering); a model cannot declare it.
    if (kind === "animate") return [];
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
    const follows = stableName(item.follows);
    const lagMs = follows && finite(item.lagMs)
      ? Math.round(clamp(
        item.lagMs,
        MIN_COMPONENT_FOLLOW_LAG_MS,
        MAX_COMPONENT_FOLLOW_LAG_MS,
      ))
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
      ...(beatStyle(kind, item.style) ? { style: beatStyle(kind, item.style) } : {}),
      ...(follows ? { follows } : {}),
      ...(lagMs !== undefined ? { lagMs } : {}),
      ...(ease ? { ease } : {}),
    }];
  }).sort((a, b) => a.atSec - b.atSec);
}

/** Repair the one unambiguous metric declaration mismatch without a paid retry. */
export function reconcileMetricComponentKinds(
  components: SceneComponentSpecV1[],
  beats: ComponentBeatIntentV1[],
): { components: SceneComponentSpecV1[]; normalized: string[] } {
  const counted = new Set(
    beats.filter((beat) => beat.kind === "count").map((beat) => beat.component),
  );
  const normalized: string[] = [];
  const reconciled = components.map((component) => {
    if (
      component.kind !== "headline" || component.entityId !== "metric" ||
      !counted.has(component.id)
    ) return component;
    normalized.push(
      `component-kind-reconcile: ${component.id} headline -> stat-card ` +
        `(metric entity owns a typed count beat)`,
    );
    return { ...component, kind: "stat-card" as const };
  });
  return { components: reconciled, normalized };
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

function entranceEase(family: ComponentEntranceFamily): string {
  return family === "materialize" ? "sine.out" : "power3.out";
}

/**
 * Resolve one scene grammar into explicit root-entrance windows. Plugin
 * children already have a host-owned generator choreography, early `open`
 * beats own their root entrance, and morph targets must stay hidden until the
 * bridge hands off; all three are excluded to preserve one entrance owner.
 */
function resolveSceneComponentEntrances(
  scene: DirectScene,
  sceneEnd: number,
): { family?: ComponentEntranceFamily; entrances: ResolvedComponentEntranceV1[] } {
  const family = normalizeStoryboardComponentEntranceFamily(scene.componentEntranceFamily);
  if (!family) return { entrances: [] };
  const beats = scene.beats ?? [];
  const morphTargets = new Set(
    beats.flatMap((beat) => beat.kind === "morph" && beat.morphTo ? [beat.morphTo] : []),
  );
  const earlyOpenUntil = scene.startSec + Math.min(1.2, scene.durationSec * 0.28);
  const earlyOpenOwners = new Set(
    beats.flatMap((beat) =>
      beat.kind === "open" && beat.atSec <= earlyOpenUntil ? [beat.component] : []
    ),
  );
  const components = (scene.components ?? []).filter((component) =>
    !component.pluginUid &&
    !morphTargets.has(component.id) &&
    !earlyOpenOwners.has(component.id)
  );
  if (!components.length) return { entrances: [] };
  const baseStart = round(scene.startSec + clamp(scene.durationSec * 0.08, 0.12, 0.28));
  const duration = family === "assemble" ? 0.68 : family === "materialize" ? 0.48 : 0.58;
  const offsetWindow = Math.min(0.32, Math.max(0.12, scene.durationSec * 0.08));
  const step = components.length > 1 ? offsetWindow / (components.length - 1) : 0;
  const entrances = components.flatMap((component, index): ResolvedComponentEntranceV1[] => {
    const startSec = round(clamp(baseStart + step * index, scene.startSec, sceneEnd));
    const endSec = round(clamp(startSec + duration, startSec + 0.1, sceneEnd));
    if (endSec - startSec < 0.08) return [];
    return [{
      component: component.id,
      startSec,
      endSec,
      ease: entranceEase(family),
    }];
  });
  return entrances.length ? { family, entrances } : { entrances: [] };
}

interface FollowCandidate {
  order: number;
  intent: ComponentBeatIntentV1;
  base: ResolvedComponentBeatV1;
}

/** Mark every node that participates in a one-parent dependency cycle. */
function cyclicFollowCandidates(dependencies: ReadonlyMap<number, number>): Set<number> {
  const cyclic = new Set<number>();
  for (const start of dependencies.keys()) {
    const positions = new Map<number, number>();
    const path: number[] = [];
    let cursor: number | undefined = start;
    while (cursor !== undefined) {
      const seenAt = positions.get(cursor);
      if (seenAt !== undefined) {
        for (let index = seenAt; index < path.length; index += 1) cyclic.add(path[index]!);
        break;
      }
      positions.set(cursor, path.length);
      path.push(cursor);
      cursor = dependencies.get(cursor);
    }
  }
  return cyclic;
}

function followEase(kind: ComponentBeatKind): string {
  if (kind === "type" || kind === "stream") return "none";
  return kind === "close" ? "sine.in" : "sine.out";
}

/**
 * Resolve per-scene component declarations into the concrete beat plan the
 * runtime compiles. Windows are clamped so a beat never escapes its scene.
 */
export function resolveComponentPlan(scenes: DirectScene[]): ComponentPlanV1 {
  const planScenes: SceneComponentPlanV1[] = [];
  const continuity = resolveContinuityGraph(scenes);
  const incomingStates = new Map<string, ContinuityStateV1>();
  for (const edge of continuity.edges) {
    if (edge.stateTransfer && edge.state) {
      incomingStates.set(`${edge.toScene}:${edge.toPart}`, edge.state);
    }
  }
  for (const scene of scenes) {
    const beats = scene.beats ?? [];
    const componentKinds = new Map(
      (scene.components ?? []).map((component) => [component.id, component.kind]),
    );
    const sceneEnd = round(scene.startSec + scene.durationSec);
    const canonicalCut = scene.cut
      ? canonicalCutStyle(scene.cut.style, scene.cut.axis)
      : undefined;
    const exitAxis = canonicalCut?.style === "swipe" ? canonicalCut.axis ?? "right" : undefined;
    const candidates = beats.flatMap((beat, order): FollowCandidate[] => {
      const kind = componentKinds.get(beat.component);
      if (!kind || !componentSupportsBeat(kind, beat.kind)) return [];
      const startSec = clamp(beat.atSec, scene.startSec, sceneEnd);
      const endSec = clamp(startSec + beatDuration(beat), startSec + 0.1, sceneEnd);
      if (endSec - startSec < 0.08) return [];
      return [{
        order,
        intent: beat,
        base: {
          id: beat.id,
          component: beat.component,
          kind: beat.kind,
          startSec: round(startSec),
          endSec: round(endSec),
          // Exit choreography is always a subtle ease-in; other beats preserve
          // the existing explicit/default ease unless a follow is applied.
          ease: beat.kind === "close"
            ? "power2.in"
            : beat.ease ?? BEAT_DEFAULTS[beat.kind].ease,
          ...(beat.text ? { text: beat.text } : {}),
          ...(finite(beat.value) ? { value: beat.value } : {}),
          ...(finite(beat.item) ? { item: beat.item } : {}),
          ...(beat.toState ? { toState: beat.toState } : {}),
          ...(beat.morphTo ? { morphTo: beat.morphTo } : {}),
          ...(beat.style ? { style: beat.style } : {}),
          ...(beat.animation ? { animation: beat.animation } : {}),
          ...(beat.kind === "close" && exitAxis
            ? {
                exitAxis,
                exitRecedePercent: Math.min(
                  MAX_COMPONENT_EXIT_RECEDE_PERCENT,
                  DIRECTIONAL_COMPONENT_EXIT_RECEDE_PERCENT,
                ),
              }
            : {}),
        },
      }];
    });

    // Beat id wins over component id when a name is ambiguous. A component
    // reference resolves to its latest beat at/before the follower's declared
    // time (declaration order breaks same-time ties).
    const byBeatId = new Map<string, number>();
    candidates.forEach((candidate, index) => {
      if (!byBeatId.has(candidate.intent.id)) byBeatId.set(candidate.intent.id, index);
    });
    const dependencies = new Map<number, number>();
    const followReferences = new Map<number, string>();
    candidates.forEach((candidate, index) => {
      const reference = stableName(candidate.intent.follows);
      if (!reference) return;
      let parent = byBeatId.get(reference);
      if (parent === undefined && componentKinds.has(reference)) {
        const preceding = candidates
          .map((entry, candidateIndex) => ({ entry, candidateIndex }))
          .filter(({ entry, candidateIndex }) =>
            candidateIndex !== index &&
            entry.intent.component === reference &&
            (
              entry.base.startSec < candidate.base.startSec ||
              (entry.base.startSec === candidate.base.startSec && entry.order < candidate.order)
            )
          )
          .sort((a, b) =>
            b.entry.base.startSec - a.entry.base.startSec || b.entry.order - a.entry.order
          )[0];
        parent = preceding?.candidateIndex;
      }
      if (parent !== undefined) {
        const lead = candidates[parent]!;
        // Following may overlap different properties on one component, but two
        // beats in the same property channel would fight for the same pixels.
        // Degrade that relationship before timing it (the dedupe disposition).
        if (
          lead.intent.component === candidate.intent.component &&
          BEAT_CHANNELS[lead.intent.kind] === BEAT_CHANNELS[candidate.intent.kind]
        ) {
          return;
        }
        dependencies.set(index, parent);
        followReferences.set(index, reference);
      }
    });
    const cyclic = cyclicFollowCandidates(dependencies);
    const cache = new Map<number, ResolvedComponentBeatV1>();
    const resolveCandidate = (index: number): ResolvedComponentBeatV1 => {
      const cached = cache.get(index);
      if (cached) return cached;
      const candidate = candidates[index]!;
      const parentIndex = dependencies.get(index);
      if (parentIndex === undefined || cyclic.has(index)) {
        cache.set(index, candidate.base);
        return candidate.base;
      }
      const parent = resolveCandidate(parentIndex);
      const depth = (parent.followDepth ?? 0) + 1;
      if (depth > MAX_COMPONENT_FOLLOW_CHAIN_DEPTH) {
        cache.set(index, candidate.base);
        return candidate.base;
      }
      const lagMs = Math.round(clamp(
        finite(candidate.intent.lagMs)
          ? candidate.intent.lagMs
          : DEFAULT_COMPONENT_FOLLOW_LAG_MS,
        MIN_COMPONENT_FOLLOW_LAG_MS,
        MAX_COMPONENT_FOLLOW_LAG_MS,
      ));
      const lagSec = lagMs / 1000;
      const startSec = round(parent.startSec + lagSec);
      // If the scene boundary cannot leave the leader settled first, degrade
      // only this relationship; the original beat remains fully executable.
      if (
        startSec >= sceneEnd - 0.08 ||
        parent.endSec + lagSec > sceneEnd
      ) {
        cache.set(index, candidate.base);
        return candidate.base;
      }
      const duration = candidate.base.endSec - candidate.base.startSec;
      const endSec = round(Math.min(
        sceneEnd,
        Math.max(startSec + duration, parent.endSec + lagSec),
      ));
      const resolved: ResolvedComponentBeatV1 = {
        ...candidate.base,
        startSec,
        endSec,
        ease: followEase(candidate.intent.kind),
        follows: followReferences.get(index)!,
        lagMs,
        followDepth: depth,
      };
      cache.set(index, resolved);
      return resolved;
    };
    const stateByComponent = new Map<string, ContinuityStateV1>();
    const initialStates = (scene.components ?? []).flatMap((component) => {
      const state = incomingStates.get(`${scene.id}:${component.id}`);
      if (!state) return [];
      stateByComponent.set(component.id, state);
      return [{ component: component.id, state }];
    });
    const resolved = candidates.map((_candidate, index) => resolveCandidate(index))
      .sort((a, b) => a.startSec - b.startSec)
      .map((beat): ResolvedComponentBeatV1 => {
        const prior = stateByComponent.get(beat.component);
        let next: ContinuityStateV1 | undefined;
        if (beat.kind === "count" && typeof beat.value === "number") {
          next = { kind: "metric", value: beat.value };
        } else if (beat.kind === "progress" && typeof beat.value === "number") {
          next = { kind: "progress", value: beat.value };
        } else if (beat.kind === "select" && typeof beat.item === "number") {
          next = { kind: "selection", value: beat.item };
        } else if ((beat.kind === "set-state" || beat.kind === "press") && beat.toState) {
          next = { kind: prior?.kind === "button" ? "button" : "shell", value: beat.toState };
        }
        if (next) stateByComponent.set(beat.component, next);
        return {
          ...beat,
          ...(prior?.kind === "metric" && typeof prior.value === "number" && beat.kind === "count"
            ? { fromValue: prior.value }
            : {}),
          ...(prior?.kind === "progress" && typeof prior.value === "number" && beat.kind === "progress"
            ? { fromValue: prior.value }
            : {}),
        };
      });
    const entrance = resolveSceneComponentEntrances(scene, sceneEnd);
    if (resolved.length || entrance.entrances.length || initialStates.length) {
      planScenes.push({
        sceneId: scene.id,
        ...(initialStates.length ? { initialStates } : {}),
        ...(entrance.family ? { entranceFamily: entrance.family } : {}),
        ...(entrance.entrances.length ? { entrances: entrance.entrances } : {}),
        beats: resolved,
      });
    }
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
  // Asset animations transform the unit root; two overlapping would fight.
  animate: "asset",
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

export interface EntranceRetimeResult {
  scenes: DirectScene[];
  /** Human-readable log lines, one per existing entrance moved earlier. */
  normalized: string[];
}

/**
 * A rows/open beat supplies the FIRST painted state of some component kinds:
 * the runtime deliberately holds their children/panel invisible until that
 * beat. When a load-bearing hero schedules that entrance well after scene
 * entry, the audience gets an empty station while the camera travels through
 * it (Roamly's confirmation list was blank for almost three viewer-seconds).
 *
 * This L2 normalizer only moves an EXISTING entrance and any moment already
 * pinned to that exact beat. It never invents content or motion. A morph into
 * the scene gets a slightly longer entry runway so its intact dual-clone
 * handoff can land before the remaining rows cascade.
 */
export function retimeLateLoadBearingEntrances(
  storyboard: DirectScene[],
): EntranceRetimeResult {
  const normalized: string[] = [];
  const collectionKinds = new Set<ComponentKind>([
    "app-window", "sidebar", "table", "list", "kanban", "chat", "terminal",
  ]);
  const sceneStartOffset = (sceneIndex: number, durationSec: number): number => {
    const incoming = sceneIndex > 0 ? storyboard[sceneIndex - 1]?.cut?.style : undefined;
    const runway = incoming === "morph" ? 0.48 : 0.28;
    return Math.min(runway, Math.max(0.18, durationSec * 0.12));
  };

  const scenes = storyboard.map((scene, sceneIndex) => {
    const beats = scene.beats ?? [];
    if (!beats.length) return scene;
    const components = new Map((scene.components ?? []).map((component) => [component.id, component]));
    const openingMove = scene.camera?.path?.[0];
    const openingPart = openingMove?.fromPart ?? openingMove?.toPart;
    const openingRegion = openingMove?.fromRegion ?? openingMove?.toRegion;
    const spatialFocal = scene.spatialIntent?.focalPart;
    const offset = sceneStartOffset(sceneIndex, scene.durationSec);
    const latestLoadBearingEntrance = scene.startSec + Math.max(0.72, offset + 0.18);
    const targetAt = round(scene.startSec + offset);
    const moved = new Map<string, { from: number; to: number }>();

    const nextBeats = beats.map((beat) => {
      if ((beat.kind !== "rows" && beat.kind !== "open") || beat.atSec <= latestLoadBearingEntrance) {
        return beat;
      }
      const component = components.get(beat.component);
      if (!component || component.pluginUid) return beat;
      const firstEntrance = beats
        .filter((candidate) =>
          candidate.component === beat.component &&
          (candidate.kind === "rows" || candidate.kind === "open")
        )
        .sort((a, b) => a.atSec - b.atSec)[0];
      // A later rows/open is a refresh or payoff, not the first painted state.
      if (firstEntrance?.id !== beat.id) return beat;
      const opensWithCamera = component.id === openingPart ||
        Boolean(component.region && component.region === openingRegion);
      const hero = component.role === "hero";
      // A support table can share the opening station with the true hero and
      // still be scheduled as deliberate mid-shot development. Region overlap
      // alone is therefore insufficient; require semantic or exact camera-part
      // ownership before moving its first rows beat.
      const loadBearingRows = beat.kind === "rows" && collectionKinds.has(component.kind) &&
        (hero || component.id === openingPart || component.id === spatialFocal);
      // `open` can be a deliberately late result (toast/CTA). Move it only
      // when the plan explicitly makes this component the opening focal.
      const loadBearingOpen = beat.kind === "open" &&
        (component.id === openingPart || (component.id === spatialFocal && opensWithCamera));
      if (!loadBearingRows && !loadBearingOpen) return beat;

      moved.set(beat.id, { from: beat.atSec, to: targetAt });
      normalized.push(
        `scene "${scene.id}": moved load-bearing ${beat.kind} "${beat.id}" on ` +
          `"${beat.component}" from ${beat.atSec.toFixed(2)}s to ${targetAt.toFixed(2)}s ` +
          `(the runtime entrance cannot leave the opening station blank)`,
      );
      return { ...beat, atSec: targetAt };
    });
    if (!moved.size) return scene;

    const nextMoments = (scene.moments ?? []).map((moment) => {
      // A moment authored on the moved beat is timing paperwork for that same
      // state change. Carry it with the beat so evidence does not become a
      // fabricated late highlight or force a paid missing-moment retry.
      const owner = [...moved.values()].find(({ from }) => {
        if (Math.abs(moment.atSec - from) > 0.12) return false;
        // If another, unmoved beat shares this cue, the moment is ambiguous;
        // leave its semantic timing intact rather than dragging it with the
        // entrance merely because the planner stacked two events.
        return !beats.some((beat) =>
          !moved.has(beat.id) && Math.abs(beat.atSec - moment.atSec) <= 0.12
        );
      });
      return owner ? { ...moment, atSec: owner.to } : moment;
    });
    const notes = normalized.filter((line) => line.startsWith(`scene "${scene.id}":`));
    return {
      ...scene,
      beats: nextBeats.sort((a, b) => a.atSec - b.atSec),
      ...(scene.moments?.length ? { moments: nextMoments } : {}),
      sentinelNormalizations: [
        ...(scene.sentinelNormalizations ?? []),
        ...notes.map((line) => `entrance-retime: ${line.replace(/^scene "[^"]+": /, "")}`),
      ],
    };
  });
  return { scenes, normalized };
}

const HELD_RESULT_STATES = new Set([
  "approved",
  "complete",
  "completed",
  "done",
  "ready",
  "resolved",
  "succeed",
  "succeeded",
  "success",
  "verified",
]);
const HELD_RESULT_FRONT_FRACTION = 0.35;
const HELD_RESULT_HIGHLIGHT_DURATION_SEC = 0.8;
const HELD_RESULT_HIGHLIGHT_TAIL_SEC = 1.6;
const HELD_RESULT_MIN_BREATH_SEC = 0.8;
const HELD_RESULT_MOMENT_EVIDENCE_BEFORE_SEC = 0.45;
const HELD_RESULT_MOMENT_EVIDENCE_AFTER_SEC = 0.75;
const HELD_RESULT_MOMENT_RE =
  /\b(?:approve(?:d)?|complete(?:d)?|done|held|holds?|proof|ready|resolve(?:d|s)?|settle(?:d)?|succeed(?:ed)?|success|verified)\b/i;

function beatOverlapsMoment(
  beat: ComponentBeatIntentV1,
  moment: NonNullable<DirectScene["moments"]>[number],
): boolean {
  const windowStart = moment.atSec - HELD_RESULT_MOMENT_EVIDENCE_BEFORE_SEC;
  const windowEnd = moment.atSec + HELD_RESULT_MOMENT_EVIDENCE_AFTER_SEC;
  return beat.atSec + beatDuration(beat) >= windowStart && beat.atSec <= windowEnd;
}

function interactionOverlapsMoment(
  interaction: NonNullable<DirectScene["interactions"]>[number],
  moment: NonNullable<DirectScene["moments"]>[number],
): boolean {
  const windowStart = moment.atSec - HELD_RESULT_MOMENT_EVIDENCE_BEFORE_SEC;
  const windowEnd = moment.atSec + HELD_RESULT_MOMENT_EVIDENCE_AFTER_SEC;
  const interactionEnd = interaction.releaseSec ?? interaction.pressSec ?? interaction.arriveSec;
  return interactionEnd >= windowStart && interaction.arriveSec <= windowEnd;
}

function heldResultMomentText(
  moment: NonNullable<DirectScene["moments"]>[number],
): string {
  return [
    moment.id,
    moment.title,
    moment.visualState,
    moment.change,
    moment.motionIntent,
  ].join(" ");
}

/**
 * Give a deliberately held interaction result one late, host-owned proof
 * accent when the typed plan would otherwise freeze after its entrance.
 *
 * This is intentionally narrower than a general liveness generator. It only
 * applies when a 4s+ scene:
 * - either front-loads every moment or promises an unsupported late held
 *   success/ready/resolve moment;
 * - finishes every full camera move before the interaction result;
 * - lands an explicit successful set-state on the interaction target; and
 * - leaves enough tail for a separated 800ms highlight and a final settle.
 *
 * The accent changes no copy, value, state, component count, or camera idea.
 * It gives `topUpStoryboardMoments` executable evidence for the already-
 * promised held result instead of making a paid planner invent another
 * surface merely to satisfy the back-half moment grid.
 */
export function topUpHeldInteractionResultDevelopment(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const scenes = storyboard.map((scene) => {
    const moments = scene.moments ?? [];
    const beats = scene.beats ?? [];
    const interactions = scene.interactions ?? [];
    if (scene.durationSec < 4 || moments.length < 2 || !beats.length || !interactions.length) {
      return scene;
    }
    const frontEdge = scene.startSec + scene.durationSec * HELD_RESULT_FRONT_FRACTION;

    const interactionTargets = new Set(interactions.map((interaction) => interaction.targetPart));
    const result = beats
      .filter((beat) =>
        beat.kind === "set-state" &&
        interactionTargets.has(beat.component) &&
        Boolean(beat.toState && HELD_RESULT_STATES.has(beat.toState))
      )
      .sort((a, b) => a.atSec - b.atSec)
      .at(-1);
    if (!result) return scene;
    if ((scene.camera?.path ?? []).some((move) =>
      CAMERA_FULL_MOVES.has(move.move) && move.startSec + move.durationSec > result.atSec + 0.01
    )) return scene;

    const entranceClustered = moments.every((moment) => moment.atSec <= frontEdge);
    const unsupportedHeldMoment = moments
      .filter((moment) =>
        moment.atSec > frontEdge &&
        moment.atSec >= result.atSec + HELD_RESULT_MIN_BREATH_SEC &&
        HELD_RESULT_MOMENT_RE.test(heldResultMomentText(moment)) &&
        !beats.some((beat) => beatOverlapsMoment(beat, moment)) &&
        !interactions.some((interaction) => interactionOverlapsMoment(interaction, moment)) &&
        !(scene.camera?.path ?? []).some((move) =>
          CAMERA_FULL_MOVES.has(move.move) &&
          move.startSec + move.durationSec >=
            moment.atSec - HELD_RESULT_MOMENT_EVIDENCE_BEFORE_SEC &&
          move.startSec <= moment.atSec + HELD_RESULT_MOMENT_EVIDENCE_AFTER_SEC
        ) &&
        !(scene.gradeShift &&
          scene.gradeShift.atSec >= moment.atSec - HELD_RESULT_MOMENT_EVIDENCE_BEFORE_SEC &&
          scene.gradeShift.atSec <= moment.atSec + HELD_RESULT_MOMENT_EVIDENCE_AFTER_SEC)
      )
      .sort((a, b) => b.atSec - a.atSec)[0];
    if (!entranceClustered && !unsupportedHeldMoment) return scene;
    if (beats.some((beat) =>
      beat.id !== result.id &&
      beat.atSec > Math.max(frontEdge, result.atSec + HELD_RESULT_MIN_BREATH_SEC)
    )) return scene;

    const defaultAtSec = scene.startSec + scene.durationSec - HELD_RESULT_HIGHLIGHT_TAIL_SEC;
    const atSec = round(unsupportedHeldMoment
      ? Math.min(defaultAtSec, unsupportedHeldMoment.atSec - 0.3)
      : defaultAtSec);
    const resultEnd = result.atSec + beatDuration(result);
    if (atSec < resultEnd + HELD_RESULT_MIN_BREATH_SEC) return scene;
    if (atSec + HELD_RESULT_HIGHLIGHT_DURATION_SEC > scene.startSec + scene.durationSec - 0.3) {
      return scene;
    }

    const ids = new Set(beats.map((beat) => beat.id));
    const base = `${scene.id}-held-result-highlight`.slice(0, 64);
    let id = base;
    let serial = 2;
    while (ids.has(id)) {
      const suffix = `-${serial}`;
      id = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      serial += 1;
    }
    const note =
      `added a late highlight on "${result.component}" at ${atSec.toFixed(2)}s so the ` +
      `successful interaction result develops during its held frame`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return {
      ...scene,
      beats: [...beats, {
        version: 1 as const,
        id,
        sceneId: scene.id,
        component: result.component,
        kind: "highlight" as const,
        atSec,
        durationSec: HELD_RESULT_HIGHLIGHT_DURATION_SEC,
        style: "ring",
        ease: "power2.out",
      }].sort((a, b) => a.atSec - b.atSec),
      sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
    };
  });
  return { scenes, normalized };
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
        item: intent.item,
        start: intent.pressSec! - CURSOR_PRESS_SLACK_SEC,
        end: (intent.releaseSec ?? intent.pressSec! + 0.3) + CURSOR_PRESS_SLACK_SEC,
      }));
    const kept: ComponentBeatIntentV1[] = [];
    let changed = false;
    for (const beat of beats) {
      const startSec = beat.atSec;
      const endSec = beat.atSec + beatDuration(beat);
      // Rule 3: cursor press already pulses this part on these frames.
      if (PULSE_KINDS.has(beat.kind) && beat.kind !== "highlight") {
        const cursorPress = pressWindows.find((window) =>
          window.part === beat.component &&
          (window.item === undefined || beat.item === undefined || window.item === beat.item) &&
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
          !(beat.item !== undefined && earlier.item !== undefined && earlier.item !== beat.item) &&
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
      // Rule 5: a swap to text the component ALREADY shows is a no-op
      // double-reveal — the same word flies out and flies back in
      // (probe-audit-01: swap "Cadence" onto a wordmark a prior beat already
      // put there). Parse time has no HTML, so only beat-derived text is
      // knowable (a prior type/swap on the same component); the runtime no-op
      // in compileSwap covers the authored-markup case. Drop the redundant beat.
      if (beat.kind === "swap" && beat.text != null) {
        const priorText = [...kept]
          .reverse()
          .find((earlier) =>
            earlier.component === beat.component &&
            (earlier.kind === "type" || earlier.kind === "swap") &&
            earlier.text != null
          )?.text;
        if (priorText != null && priorText.trim() === beat.text.trim()) {
          changed = true;
          dropped.push(
            `scene "${scene.id}": beat "${beat.id}" (swap on ${beat.component}) swaps in text the ` +
              `component already shows ("${beat.text.trim()}") — dropped (a swap to itself is not motion)`,
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

/* --------------------------------------------- typed-style taste governors */

export interface StyleDegradeResult {
  scenes: DirectScene[];
  /** Human-readable log lines, one per degraded beat style. */
  dropped: string[];
}

export interface StyleDeriveResult {
  scenes: DirectScene[];
  /** Human-readable log lines, one per host-applied beat style. */
  applied: string[];
}

/**
 * MD6 host auto-derivation (the taste ladder, MOTION_DESIGN_PLAN §0): a
 * production planner (GLM z-ai/glm-5.2) reliably declares the STRUCTURE — an
 * `open` beat on a compact acknowledgment surface — but under-reaches for the
 * OPTIONAL `style` field, so shipped films never pop even when the brief asks
 * for it (the md-audit-probe-3b/4 evidence). `pop` is the tasteful default for
 * a toast/badge/stat-card/button landing, so the HOST styles every style-less
 * `open` on a [[COMPACT_POP_KINDS]] surface as `pop` — pure derivation from
 * data the storyboard already carries, zero planner surface. It never overrides
 * an explicit style and never exceeds the cap: the density + compact-kind
 * discipline stays owned by [[degradeOpenPopStyles]], which runs immediately
 * after this and is the single governor for the rule (SENTINEL L2). A scene
 * with three compact opens gets three pops here, capped to two there.
 */
export function autoStyleCompactPops(storyboard: DirectScene[]): StyleDeriveResult {
  const applied: string[] = [];
  const scenes = storyboard.map((scene) => {
    const beats = scene.beats ?? [];
    if (!beats.length) return scene;
    const kinds = new Map((scene.components ?? []).map((component) => [component.id, component.kind]));
    // Plugin-lowered entrances stay uniform: the unit's cascade is ONE
    // host-choreographed gesture, and pop-styling only the first two children
    // (the per-scene cap) would make one generated unit read inconsistently.
    const pluginOwned = new Set(
      (scene.components ?? []).flatMap((component) => (component.pluginUid ? [component.id] : [])),
    );
    let changed = false;
    const next = beats.map((beat) => {
      if (beat.kind !== "open" || beat.style) return beat;
      if (pluginOwned.has(beat.component)) return beat;
      const kind = kinds.get(beat.component);
      if (!kind || !COMPACT_POP_KINDS.has(kind)) return beat;
      changed = true;
      applied.push(
        `scene "${scene.id}": open "${beat.id}" on ${kind} "${beat.component}" → pop ` +
          `(compact acknowledgment surface; planner left style blank)`,
      );
      return { ...beat, style: "pop" };
    });
    return changed ? { ...scene, beats: next } : scene;
  });
  return { scenes, applied };
}

/**
 * MD6 deterministic cap: `open` style "pop" is the typed overshoot exception,
 * allowed ONLY on compact acknowledgment surfaces ([[COMPACT_POP_KINDS]]) and
 * at most twice per scene. A pop on a non-compact kind drops to the smooth
 * default open; a third+ pop in a scene drops to default too. Degrade, never
 * veto — the parse already strips unknown styles; this enforces the compact-
 * kind + density rule in code, not prose (SENTINEL L2).
 */
export function degradeOpenPopStyles(storyboard: DirectScene[]): StyleDegradeResult {
  const dropped: string[] = [];
  const scenes = storyboard.map((scene) => {
    const beats = scene.beats ?? [];
    if (!beats.some((beat) => beat.kind === "open" && beat.style === "pop")) return scene;
    const kinds = new Map((scene.components ?? []).map((component) => [component.id, component.kind]));
    let popCount = 0;
    let changed = false;
    const next = beats.map((beat) => {
      if (beat.kind !== "open" || beat.style !== "pop") return beat;
      const kind = kinds.get(beat.component);
      if (!kind || !COMPACT_POP_KINDS.has(kind)) {
        changed = true;
        dropped.push(
          `scene "${scene.id}": open "${beat.id}" style:pop on ${kind ?? "unknown"} ` +
            `"${beat.component}" — pop is compact-surface only; using the default open`,
        );
        const { style: _s, ...rest } = beat;
        return rest;
      }
      popCount += 1;
      if (popCount > MAX_POP_OPENS_PER_SCENE) {
        changed = true;
        dropped.push(
          `scene "${scene.id}": open "${beat.id}" is pop #${popCount} — at most ` +
            `${MAX_POP_OPENS_PER_SCENE} pop opens per scene; using the default open`,
        );
        const { style: _s, ...rest } = beat;
        return rest;
      }
      return beat;
    });
    return changed ? { ...scene, beats: next } : scene;
  });
  return { scenes, dropped };
}

/**
 * MD3 deterministic cap for the loudest text gesture. `assemble` (scattered
 * letters converging into the word) is allowed exactly ONCE per film, only on a
 * `headline` component, and only when it coincides with a `primary` moment — it
 * is a thesis/logo resolve, and twice is kitsch. Every other `assemble` degrades
 * to `rise` (a refined per-word/letter reveal), so a paid attempt is never
 * vetoed for over-ordering the gesture (SENTINEL L2, degrade-never-veto).
 */
export function degradeExcessAssembles(storyboard: DirectScene[]): StyleDegradeResult {
  const dropped: string[] = [];
  let claimed = false;
  const scenes = storyboard.map((scene) => {
    const beats = scene.beats ?? [];
    if (!beats.some((beat) => beat.kind === "type" && beat.style === "assemble")) return scene;
    const kinds = new Map((scene.components ?? []).map((component) => [component.id, component.kind]));
    const primaryMoments = (scene.moments ?? []).filter((moment) => moment.importance === "primary");
    let changed = false;
    const next = beats.map((beat) => {
      if (beat.kind !== "type" || beat.style !== "assemble") return beat;
      const kind = kinds.get(beat.component);
      const start = beat.atSec;
      const end = beat.atSec + beatDuration(beat);
      const onPrimary = primaryMoments.some((moment) =>
        moment.atSec >= start - 0.6 && moment.atSec <= end + 0.6
      );
      let reason = "";
      if (kind !== "headline") reason = `assemble is headline-only (got ${kind ?? "unknown"})`;
      else if (!onPrimary) reason = "assemble must coincide with a primary moment";
      else if (claimed) reason = "one assemble per film — this is a second";
      if (!reason) {
        claimed = true;
        return beat;
      }
      changed = true;
      dropped.push(
        `scene "${scene.id}": type "${beat.id}" on "${beat.component}" — ${reason}; ` +
          `degraded to a rise reveal`,
      );
      return { ...beat, style: "rise" };
    });
    return changed ? { ...scene, beats: next } : scene;
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
 * Budget units in a component list: a plugin unit (components sharing a
 * `pluginUid`) counts ONCE regardless of how many children it lowered — the
 * host generated the whole unit as one gesture, the author builds none of it,
 * and the viewer reads it as one surface. Free-standing components count
 * individually as before.
 */
export function componentUnitCount(
  components: SceneComponentSpecV1[] | undefined,
): number {
  if (!components?.length) return 0;
  const pluginUids = new Set<string>();
  const freeByRegion = new Map<string, SceneComponentSpecV1[]>();
  for (const component of components) {
    if (!component.pluginUid && component.region) {
      const group = freeByRegion.get(component.region) ?? [];
      group.push(component);
      freeByRegion.set(component.region, group);
    }
  }
  // One app-window chassis plus one non-overlay child in the same declared
  // station is one product surface, not two simultaneous ideas. LumaFlow's
  // two-second bridge (`app-window` + its action bar) burned a storyboard
  // retry because the old raw count contradicted the finding's own wording.
  // Keep this deliberately narrow: larger groups and transient overlays still
  // count independently, so the original dense-scene guard retains teeth.
  const pairedChassisRegions = new Set(
    [...freeByRegion.entries()]
      .filter(([, group]) =>
        group.length === 2 && group.some((component) => component.kind === "app-window") &&
        group.every((component) =>
          !STACKABLE_OVERLAY_KINDS.has(component.kind) && component.kind !== "toast"
        )
      )
      .map(([region]) => region),
  );
  const countedChassisRegions = new Set<string>();
  let free = 0;
  for (const component of components) {
    if (component.pluginUid) pluginUids.add(component.pluginUid);
    else if (component.region && pairedChassisRegions.has(component.region)) {
      countedChassisRegions.add(component.region);
    } else free += 1;
  }
  return free + pluginUids.size + countedChassisRegions.size;
}

/**
 * Film-wide complexity charges a stable entity once across scenes. `entityId`
 * is the plan's explicit declaration that later appearances are the same
 * continuity object, so charging every appearance as a newly introduced
 * surface contradicts the governor's own reuse remedy. Same-scene duplicates,
 * plugin children, and components absorbed into a paired app chassis retain
 * their ordinary cost.
 */
function filmComponentUnitCount(
  scenes: Array<Pick<DirectScene, "components">>,
): number {
  const rawTotal = scenes.reduce(
    (count, scene) => count + componentUnitCount(scene.components),
    0,
  );
  const entityScenes = new Map<string, Set<number>>();
  for (const [sceneIndex, scene] of scenes.entries()) {
    const components = scene.components ?? [];
    const pairedChassisRegions = new Set(
      [...new Set(components.map((component) => component.region).filter(Boolean))]
        .filter((region) => {
          const group = components.filter(
            (component) => !component.pluginUid && component.region === region,
          );
          return group.length === 2 &&
            group.some((component) => component.kind === "app-window") &&
            group.every((component) =>
              !STACKABLE_OVERLAY_KINDS.has(component.kind) && component.kind !== "toast"
            );
        }),
    );
    for (const component of components) {
      const entityId = component.entityId?.trim();
      if (!entityId || component.pluginUid ||
        (component.region && pairedChassisRegions.has(component.region))) continue;
      const appearances = entityScenes.get(entityId) ?? new Set<number>();
      appearances.add(sceneIndex);
      entityScenes.set(entityId, appearances);
    }
  }
  const continuityReuse = [...entityScenes.values()].reduce(
    (count, sceneIndexes) => count + Math.max(0, sceneIndexes.size - 1),
    0,
  );
  return rawTotal - continuityReuse;
}

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
  let filmSec = 0;
  for (const scene of scenes) {
    const count = componentUnitCount(scene.components);
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
  const total = filmComponentUnitCount(scenes);
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
 * Evidence-search half-windows mirroring `storyboardMoments.ts`
 * (EVIDENCE_BEFORE_SEC / EVIDENCE_AFTER_SEC). Kept local to avoid an import
 * cycle — a beat inside a declared moment's window may bind that moment at
 * publication, so its component must never be trimmed.
 */
const MOMENT_EVIDENCE_BEFORE_SEC = 0.45;
const MOMENT_EVIDENCE_AFTER_SEC = 0.75;

/**
 * Component ids that are LOAD-BEARING — never trimmed — because dropping one
 * would orphan declared choreography or a reviewable moment:
 *  - a cursor interaction targets it (`targetPart`),
 *  - a camera move frames it (`toPart`) or racks focus on it (`focus.part`),
 *  - a cut carries it across a boundary (`focalPartOut`/`focalPartIn`),
 *  - it is a declared focal subject (`spatialIntent.focalPart`),
 *  - it is a morph twin (a beat morphs TO it) or a morph source (it has a beat
 *    that morphs to another),
 *  - one of its beats lands inside a declared moment's evidence-search window
 *    (publication may bind that moment to the beat — the `isLoadBearingMove`
 *    rule, applied to component beats).
 * Matched across the WHOLE storyboard by id (kebab ids are effectively unique),
 * so the predicate is deliberately over-conservative: an ambiguous surface is
 * kept, which is exactly the "ambiguity stays a finding" rule.
 */
function boundComponentIds(storyboard: DirectScene[]): Set<string> {
  const bound = new Set<string>();
  const add = (value: string | undefined | null): void => {
    const id = typeof value === "string" ? value.trim() : "";
    if (id) bound.add(id);
  };
  for (const scene of storyboard) {
    for (const interaction of scene.interactions ?? []) add(interaction.targetPart);
    for (const move of scene.camera?.path ?? []) {
      add(move.toPart);
      add(move.focus?.part);
    }
    if (scene.cut) {
      add(scene.cut.focalPartOut);
      add(scene.cut.focalPartIn);
    }
    add(scene.spatialIntent?.focalPart);
    for (const beat of scene.beats ?? []) {
      if (beat.morphTo) {
        add(beat.morphTo);
        add(beat.component);
      }
    }
    for (const moment of scene.moments ?? []) {
      for (const beat of scene.beats ?? []) {
        if (
          beat.atSec >= moment.atSec - MOMENT_EVIDENCE_BEFORE_SEC &&
          beat.atSec <= moment.atSec + MOMENT_EVIDENCE_AFTER_SEC
        ) {
          add(beat.component);
        }
      }
    }
  }
  return bound;
}

/**
 * Sentinel L2 normalize-before-retry: a `components/complexity` over-count by 1
 * or 2 is arithmetic the host can do without inventing anything — drop the
 * fewest-beat surface(s) that bind NO declared moment, NO interaction target,
 * and NO camera/cut focal (the finding's own fix hint: "drop the surfaces that
 * are set dressing"). It only DELETES a declared surface the plan can spare, so
 * it is a normalization (L2), not a creative rewrite. An over-count of >= 3 is a
 * genuine over-reach the model must resolve, and a scene/film with nothing
 * safely droppable keeps its blocking finding (ambiguity stays a finding). It
 * runs inside the parse-side atomic commit-or-revert, so a trim that minted a
 * new finding class (e.g. a dropped beat opening a liveness gap) reverts.
 */
export function trimOverBudgetComponents(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const bound = boundComponentIds(storyboard);
  const beatCountOf = (scene: DirectScene, id: string): number =>
    (scene.beats ?? []).filter((beat) => beat.component === id).length;
  // Safely-droppable components in a scene, fewest-beat first (then declaration
  // order) — set dressing goes before a surface carrying real state changes.
  const droppableInScene = (scene: DirectScene): SceneComponentSpecV1[] => {
    const components = scene.components ?? [];
    // A plugin child is never set dressing to trim piecemeal: the unit was
    // host-generated as one gesture and counts as one budget unit anyway.
    return components
      .filter((component) => !component.pluginUid && !bound.has(component.id))
      .sort(
        (a, b) =>
          beatCountOf(scene, a.id) - beatCountOf(scene, b.id) ||
          components.indexOf(a) - components.indexOf(b),
      );
  };
  const applyTrim = (scene: DirectScene, dropIds: Set<string>, note: string): DirectScene => ({
    ...scene,
    components: (scene.components ?? []).filter((component) => !dropIds.has(component.id)),
    beats: (scene.beats ?? []).filter((beat) => !dropIds.has(beat.component)),
    sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
  });

  // (1) Per-scene over-cap: trim the offending scene only, over by 1-2.
  let scenes = storyboard.map((scene) => {
    const components = scene.components ?? [];
    if (!components.length) return scene;
    const cap = Math.min(
      MAX_COMPONENTS_PER_SCENE,
      Math.max(1, Math.floor(scene.durationSec / SEC_PER_COMPONENT)),
    );
    const overBy = componentUnitCount(components) - cap;
    if (overBy < 1 || overBy > 2) return scene;
    const picks = droppableInScene(scene).slice(0, overBy);
    if (picks.length < overBy) return scene; // cannot safely reach the cap → keep the finding
    const dropIds = new Set(picks.map((component) => component.id));
    const note =
      `trimmed ${dropIds.size} unbound component(s) (${[...dropIds].join(", ")}) to fit the ` +
      `${cap}-surface budget for a ${scene.durationSec.toFixed(1)}s window`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return applyTrim(scene, dropIds, note);
  });

  // (2) Film-wide over-cap (recomputed after per-scene trims), over by 1-2.
  const total = filmComponentUnitCount(scenes);
  const filmSec = scenes.reduce((sec, scene) => sec + scene.durationSec, 0);
  const filmCap = Math.max(2, Math.ceil(filmSec / FILM_SEC_PER_COMPONENT));
  const filmOver = total - filmCap;
  if (filmOver >= 1 && filmOver <= 2) {
    const flat = scenes.flatMap((scene, sceneIndex) =>
      droppableInScene(scene).map((component) => ({
        sceneIndex,
        id: component.id,
        beats: beatCountOf(scene, component.id),
      })),
    );
    const picks = flat
      .sort((a, b) => a.beats - b.beats || a.sceneIndex - b.sceneIndex)
      .slice(0, filmOver);
    if (picks.length >= filmOver) {
      const dropByScene = new Map<number, Set<string>>();
      for (const pick of picks) {
        if (!dropByScene.has(pick.sceneIndex)) dropByScene.set(pick.sceneIndex, new Set());
        dropByScene.get(pick.sceneIndex)!.add(pick.id);
      }
      scenes = scenes.map((scene, sceneIndex) => {
        const dropIds = dropByScene.get(sceneIndex);
        if (!dropIds) return scene;
        const note =
          `trimmed ${dropIds.size} unbound component(s) (${[...dropIds].join(", ")}) to fit the ` +
          `${filmCap}-surface film budget`;
        normalized.push(`scene "${scene.id}": ${note}`);
        return applyTrim(scene, dropIds, note);
      });
    }
  }

  return { storyboard: scenes, normalized };
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
    const entranceFamily = normalizeStoryboardComponentEntranceFamily(sceneObject.entranceFamily);
    if (sceneObject.entranceFamily !== undefined && !entranceFamily) {
      errors.push(`components scene[${index}].entranceFamily is unsupported`);
    }
    if (!Array.isArray(sceneObject.beats)) {
      errors.push(`components scene[${index}] needs a beats array`);
      return [];
    }
    const entrances = (Array.isArray(sceneObject.entrances) ? sceneObject.entrances : [])
      .flatMap((raw, entranceIndex): ResolvedComponentEntranceV1[] => {
        const label = `components scene[${index}].entrances[${entranceIndex}]`;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          errors.push(`${label} must be an object`);
          return [];
        }
        const entrance = raw as Record<string, unknown>;
        const component = stableName(entrance.component);
        const ease = typeof entrance.ease === "string" ? entrance.ease : "";
        if (!component) errors.push(`${label} needs a stable component`);
        if (!finite(entrance.startSec) || !finite(entrance.endSec)) {
          errors.push(`${label} needs finite startSec/endSec`);
        }
        if (!EASE_PATTERN.test(ease)) errors.push(`${label} ease "${ease}" is not a known ease`);
        if (errors.some((error) => error.startsWith(label))) return [];
        return [{
          component,
          startSec: entrance.startSec as number,
          endSec: entrance.endSec as number,
          ease,
        }];
      });
    if (sceneObject.entrances !== undefined && !Array.isArray(sceneObject.entrances)) {
      errors.push(`components scene[${index}].entrances must be an array`);
    }
    if (entrances.length && !entranceFamily) {
      errors.push(`components scene[${index}] entrances need one entranceFamily`);
    }
    const initialStates = (Array.isArray(sceneObject.initialStates) ? sceneObject.initialStates : [])
      .flatMap((raw, stateIndex): Array<{ component: string; state: ContinuityStateV1 }> => {
        const label = `components scene[${index}].initialStates[${stateIndex}]`;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          errors.push(`${label} must be an object`);
          return [];
        }
        const entry = raw as Record<string, unknown>;
        const component = stableName(entry.component);
        const state = entry.state;
        if (!component || !state || typeof state !== "object" || Array.isArray(state)) {
          errors.push(`${label} needs a stable component and state`);
          return [];
        }
        const stateObject = state as Record<string, unknown>;
        const kind = typeof stateObject.kind === "string" ? stateObject.kind : "";
        const value = stateObject.value;
        if (!["metric", "button", "progress", "selection", "shell"].includes(kind) ||
            !(typeof value === "number" && Number.isFinite(value)) &&
            typeof value !== "string" && typeof value !== "boolean") {
          errors.push(`${label} has an invalid typed state`);
          return [];
        }
        return [{ component, state: { kind: kind as ContinuityStateV1["kind"], value } }];
      });
    if (sceneObject.initialStates !== undefined && !Array.isArray(sceneObject.initialStates)) {
      errors.push(`components scene[${index}].initialStates must be an array`);
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
      const animation = stableName(beat.animation);
      const follows = stableName(beat.follows);
      const exitAxis = typeof beat.exitAxis === "string" &&
          ["left", "right", "up", "down"].includes(beat.exitAxis)
        ? beat.exitAxis as CutAxis
        : undefined;
      if (beat.exitAxis !== undefined && !exitAxis) {
        errors.push(`${label} exitAxis "${String(beat.exitAxis)}" is unsupported`);
      }
      if (beat.lagMs !== undefined && !finite(beat.lagMs)) {
        errors.push(`${label} lagMs must be finite`);
      }
      if (beat.followDepth !== undefined && !finite(beat.followDepth)) {
        errors.push(`${label} followDepth must be finite`);
      }
      if (beat.exitRecedePercent !== undefined && !finite(beat.exitRecedePercent)) {
        errors.push(`${label} exitRecedePercent must be finite`);
      }
      if (errors.some((error) => error.startsWith(label))) return [];
      return [{
        id,
        component,
        kind: kind as ComponentBeatKind,
        startSec: beat.startSec as number,
        endSec: beat.endSec as number,
        ease,
        ...(typeof beat.text === "string" && beat.text ? { text: beat.text } : {}),
        ...(finite(beat.value) ? { value: beat.value } : {}),
        ...(finite(beat.fromValue) ? { fromValue: beat.fromValue } : {}),
        ...(finite(beat.item) ? { item: beat.item } : {}),
        ...(toState ? { toState } : {}),
        ...(morphTo ? { morphTo } : {}),
        // Asset `animate` beats round-trip their animation name — the
        // island-equality check rejects any drift from the resolved plan.
        ...(animation ? { animation } : {}),
        // The resolved plan carries the optional `style` variant (MD3/MD6:
        // type→rise/pop/assemble, open→pop, highlight→sweep/underline), and the
        // runtime reads it. It MUST round-trip here or the island-equality check
        // in validateComponentContract rejects every styled film (md-audit-probe-1).
        ...(typeof beat.style === "string" && beat.style ? { style: beat.style } : {}),
        ...(exitAxis ? { exitAxis } : {}),
        ...(finite(beat.exitRecedePercent)
          ? { exitRecedePercent: beat.exitRecedePercent }
          : {}),
        ...(follows ? { follows } : {}),
        ...(finite(beat.lagMs) ? { lagMs: beat.lagMs } : {}),
        ...(finite(beat.followDepth) ? { followDepth: beat.followDepth } : {}),
      }];
    });
    if (!beats.length && !entrances.length && !initialStates.length) {
      errors.push(`components scene[${index}] needs beats, entrances, or initial states`);
    }
    return sceneId && (beats.length || entrances.length || initialStates.length)
      ? [{
          sceneId,
          ...(initialStates.length ? { initialStates } : {}),
          ...(entranceFamily ? { entranceFamily } : {}),
          ...(entrances.length ? { entrances } : {}),
          beats,
        }]
      : [];
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
      "storyboard declares component choreography but index_html has no sequences-components JSON island",
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
    for (const entrance of scenePlan.entrances ?? []) {
      if (attributeMatches(scope, "data-part", entrance.component) !== 1) {
        errors.push(
          `entrance family targets component "${entrance.component}" but scene ` +
            `"${scenePlan.sceneId}" does not contain exactly one matching data-part element`,
        );
      }
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
    [
      ...(scene.entrances ?? []).map((entrance) => ({
        start: entrance.startSec - 0.05,
        end: entrance.endSec + 0.1,
      })),
      ...scene.beats
        .filter((beat) =>
          beat.kind === "morph" ||
          beat.kind === "open" ||
          beat.kind === "close" ||
        // In-place component-internal motion (2026-07-08, probe-audit-01): these
        // beats animate a surface's OWN text/value/emphasis without moving the
        // surface, transiently perturbing the internal geometry the vendored
        // static overlap/overflow heuristics measure. `swap` stacks an
        // absolutely-positioned `.cmp-swap-new` over the old text in the same
        // slot; `count` rewrites the value text every frame as digits roll in
        // (reflowing its box); `set-state` re-lays a surface's internal state;
        // `highlight` pulses a ring/scale over the surface. Sampled mid-beat the
        // heuristics misread this as "two text blocks overlap" / "container
        // overflow" (the stat-card label↔value↔delta and swap-new↔slot false
        // positives that legible frames disprove), and the author loop then
        // spends repairs fighting motion it cannot fix. Suppress exactly like
        // morph/open/close; the settled state is still audited outside the
        // window, and these heuristics are advisory-only — never a gate.
        beat.kind === "swap" ||
        beat.kind === "count" ||
        beat.kind === "set-state" ||
        beat.kind === "highlight" ||
        // Asset spring animations (enter pops, bouncy expands, fills) move the
        // unit root by design — mid-flight geometry is designed motion exactly
        // like an open/morph window; the settled state stays audited.
        beat.kind === "animate" ||
        // MD3 split-style headline entrances (rise/pop/assemble) transiently
        // displace letters/words by transform (assemble scatters up to ~96px)
        // before converging to the AUTHORED copy — designed entrance motion, not
        // a layout defect, exactly like an open/morph window. The settled state
        // (the authored text) is still audited outside this window.
          (beat.kind === "type" && beat.style != null && HEADLINE_SPLIT_STYLES.has(beat.style))
        )
        .map((beat) => ({ start: beat.startSec - 0.05, end: beat.endSec + 0.1 })),
    ]
  );
}

/* --------------------------------------------------------- prompt renders */

/**
 * Compact component vocabulary for the GLM storyboard pass (~1.3K chars):
 * what exists, what state changes it supports, and which twins morph.
 */
export function componentPlanningVocabulary(): string {
  const lines = COMPONENT_CATALOG.filter((spec) => !spec.internal).map((spec) => {
    const beats = [...new Set([...spec.beats])];
    const crossKind = spec.morphsWith?.length ? `/${spec.morphsWith.join("/")}` : "";
    const morphs = ` · morphs↔same-kind${crossKind}`;
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
    !spec.internal && (!requested || requested.has(spec.kind))
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
    "data-component kind, using the kit markup below and the frame's selected",
    "material profile. componentEntranceFamily means the host owns root entrances.",
    "Otherwise add one only when no typed open/pop/morph owns it. Never author",
    "internal type/open/select/count/chart/stream/morph motion; the runtime",
    "compiles it. Author FINAL text, numbers, and bar heights. States are",
    "data-state/data-active attributes the runtime flips. A morph target",
    "starts hidden by the runtime; do not author an entrance for it.",
    "A `rows` or `stream` beat reveals EXISTING children: author at least 3",
    ".cmp-row / .cmp-item / .cmp-card / .cmp-msg children inside that target;",
    "a custom visual row class must also carry the generic `data-cmp-item` marker",
    "yourself — a rows beat on a childless container has nothing to reveal and",
    "aborts the compile.",
    "",
    ...specs.map((spec) => `**${spec.kind}** \`${spec.markup}\``),
  ].join("\n");
}
