/**
 * Plugin contract — the seventh host-owned contract: parameterized GENERATORS
 * the storyboard invokes via a typed form (`plugins:[{kind,params}]`).
 *
 * Recipes (the sixth contract) are specific frozen fragments; plugins are
 * general generators computed fresh from params. The discipline that makes
 * them safe is LOWERING: a plugin never contributes raw model HTML or
 * positions — it lowers into the EXISTING typed contracts (declared
 * `components` + typed `beats` merged into the scene at parse) so layout QA,
 * moments top-up, pacing, motion density, and Sentinel all still bind through
 * one gate. The only new artifact is the unit's host-generated markup block,
 * injected VERBATIM with the recipeContract strip-and-reinject discipline
 * (`applyDeterministicSourceRepairs` deletes and re-generates it every pass,
 * so the author model can never edit the mechanism).
 *
 * Why plugins exist (probe-audit-01/02/03): the model is reliably bad at what
 * a host generator does better — geometry (grids drift, chrome misaligns),
 * believable content ("Item 1/2/3" filler rows), and entrance choreography
 * for N-element sets. A plugin is ONE budget/moment unit regardless of how
 * many child elements it emits (`pluginUid` on each lowered component), which
 * is what lets an N-tile grid live inside `auditComponentComplexity` /
 * `trimOverBudgetComponents` / `sceneIntroductionTimes` without vetoes.
 *
 * Governance mirrors `reconcileRecipeDeclarations` (Sentinel L2,
 * degrade-never-veto): unknown kinds no-op with a note, params
 * default/clamp/drop, the per-film budget trims earliest-first, and a dropped
 * declaration degrades to nothing — never a paid retry.
 *
 * Foundations: `pluginKernel.ts` (distribution primitive + spacing rhythm +
 * seeded PRNG) and `seedContent.ts` (deterministic believable SaaS content).
 * Every lowering is a pure function of (scene identity, declaration), so
 * repair passes and the shared planning cache stay byte-identical.
 */
import type { DirectScene } from "./directComposition.ts";
import { assetPluginSpecs } from "./assetContract.ts";
import { ASSET_LIBRARY } from "./assets/index.ts";
import { assetsEnabled } from "./sentinelFlags.ts";
import { diveLegCap, type CameraMoveIntentV1 } from "./cameraContract.ts";
import {
  COMPONENT_KINDS,
  type ComponentBeatIntentV1,
  type SceneComponentSpecV1,
} from "./componentContract.ts";
import {
  cascadeOffsets,
  createSeededRandom,
  entranceAnchorSec,
  gridWrapperStyle,
  stackWrapperStyle,
  type SeededRandom,
} from "./pluginKernel.ts";
import {
  deriveTopic,
  seedLogLines,
  seedMetrics,
  seedNames,
  seedRows,
  seedToasts,
  type SeedPerson,
  type SeedRow,
  type SeedTopic,
} from "./seedContent.ts";

export const PLUGIN_FORMAT_VERSION = 1;
/** Prompt/DOM budget: at most this many plugin units per film. */
export const MAX_PLUGINS_PER_FILM = 3;

/* ------------------------------------------------------------- declaration */

/** Typed per-scene storyboard declaration (mirrors recipes/components). */
export interface PluginDeclarationV1 {
  version: 1;
  kind: string;
  /** Unit part name; the wrapper's data-part. Defaulted from the kind. */
  id: string;
  /** Optional data-region station the unit is injected into. */
  region?: string;
  params: Record<string, string | number>;
  /** Host-stamped at reconciliation; never model-authored. */
  uid?: string;
}

export type PluginParamKind = "text" | "number" | "enum" | "part-ref";

export interface PluginParamSpec {
  name: string;
  kind: PluginParamKind;
  description?: string;
  /** Default makes the param optional; required + unusable drops the unit. */
  default?: string | number;
  min?: number;
  max?: number;
  maxChars?: number;
  options?: string[];
}

/** What a plugin contributes: typed contract data + its host markup block. */
export interface PluginLowering {
  components: SceneComponentSpecV1[];
  beats: ComponentBeatIntentV1[];
  /** The unit's interior markup (children of the host wrapper). */
  markup: string;
  /** Inline style for the host wrapper (kernel-computed layout). */
  wrapperStyle: string;
}

export interface PluginLowerContext {
  sceneId: string;
  startSec: number;
  durationSec: number;
  /** The unit part name (wrapper data-part). */
  id: string;
  uid: string;
  params: Record<string, string | number>;
  topic: SeedTopic;
  rng: SeededRandom;
  /**
   * When the scene's camera path lands a full move on the unit's station
   * (region / unit part / child part), the absolute second the viewer can
   * actually SEE the unit — the entrance anchor waits for it, so count-ups
   * and cascades never play off-screen (the plugin-live-1 lesson: beats fired
   * at scene entrance while the camera arrived seconds later, landing on a
   * static number).
   */
  arrivalSec?: number;
}

export interface PluginSpec {
  kind: string;
  purpose: string;
  params: PluginParamSpec[];
  /** One compact planner-facing line (kept byte-budget friendly). */
  planningLine: string;
  /** Optional kind-scoped static CSS injected once per film. */
  style?: string;
  lower(ctx: PluginLowerContext): PluginLowering;
}

/* ----------------------------------------------------------------- helpers */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampSec(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function beat(
  ctx: PluginLowerContext,
  index: number,
  component: string,
  kind: ComponentBeatIntentV1["kind"],
  atSec: number,
  extra: Partial<ComponentBeatIntentV1> = {},
): ComponentBeatIntentV1 {
  const sceneEnd = ctx.startSec + ctx.durationSec;
  return {
    version: 1,
    id: `${ctx.id}-b${index}`,
    sceneId: ctx.sceneId,
    component,
    kind,
    atSec: round(clampSec(atSec, ctx.startSec, Math.max(ctx.startSec, sceneEnd - 0.25))),
    ...extra,
  };
}

function component(
  ctx: PluginLowerContext,
  id: string,
  kind: SceneComponentSpecV1["kind"],
): SceneComponentSpecV1 {
  return { version: 1, id, kind, pluginUid: ctx.uid };
}

/* ------------------------------------------------------------ the catalog */

/** Entrance anchor: shortly after the scene opens, scaled to short scenes —
 * or, when the camera only reaches the unit's station later, just before the
 * camera settles there. Shared arithmetic (`entranceAnchorSec` in
 * pluginKernel.ts) so asset units anchor identically. */
function entranceSec(ctx: PluginLowerContext): number {
  return entranceAnchorSec(ctx);
}

/**
 * The absolute second the scene's camera finishes its first full move landing
 * on the plugin unit's station: a move whose toRegion is the unit's declared
 * region, or whose toPart is the unit or one of its children (children derive
 * from the unit id, so a `<id>-` prefix is the child test). hold/drift never
 * re-frame. A dive's arrival is the end of its push-in leg (host arithmetic,
 * mirroring diveLegCap). Undefined when the camera opens already framing the
 * unit's station (the runtime's entry frame is the first segment's
 * from-else-to target) or when no move ever targets the unit — in both cases
 * the default anchor is right.
 */
function cameraArrivalSec(
  camera: { path?: CameraMoveIntentV1[] } | undefined,
  declaration: Pick<PluginDeclarationV1, "id" | "region">,
): number | undefined {
  const childPrefix = `${declaration.id}-`;
  const framesUnit = (part: string | undefined, region: string | undefined): boolean =>
    (declaration.region !== undefined && region === declaration.region) ||
    part === declaration.id ||
    (part?.startsWith(childPrefix) ?? false);
  const path = camera?.path ?? [];
  // The camera runtime derives the scene's OPENING frame from the first
  // segment's from-target, falling back to its to-target, regardless of verb —
  // so a unit whose station is that entry target is on frame from second one.
  // A later push-in/pan back to the same station RE-frames it; it never
  // "arrives" (asset-probe-1: a hold AT the unit's station followed by a
  // same-region push-in read as a 20.4s arrival, anchoring the asset entrance
  // at the 60% introduction cap of a 3s scene — a pacing/holds rejection the
  // host itself manufactured).
  const first = path[0];
  if (first) {
    const entry = first.fromPart || first.fromRegion
      ? { part: first.fromPart, region: first.fromRegion }
      : { part: first.toPart, region: first.toRegion };
    if (framesUnit(entry.part, entry.region)) return undefined;
  }
  let arrival: number | undefined;
  for (const move of path) {
    if (move.move === "hold" || move.move === "drift") continue;
    if (!framesUnit(move.toPart, move.toRegion)) continue;
    const end = move.move === "dive"
      ? move.startSec + (move.inSec ?? diveLegCap(move.durationSec))
      : move.startSec + move.durationSec;
    arrival = arrival === undefined ? end : Math.min(arrival, end);
  }
  return arrival;
}

const TILE_PATTERNS: Record<string, string[]> = {
  mixed: ["stat-card", "chart-bars", "stat-card", "progress-ring", "stat-card", "chart-line"],
  counts: ["stat-card", "stat-card", "stat-card", "stat-card", "stat-card", "stat-card"],
  charts: ["chart-bars", "stat-card", "chart-line", "progress-ring", "chart-bars", "stat-card"],
};

function chartBarsMarkup(part: string, rng: SeededRandom): string {
  // A believable rising trend with one dip — never a monotone staircase.
  const bars: number[] = [];
  let level = rng.int(24, 38);
  for (let i = 0; i < 5; i += 1) {
    level = Math.min(92, level + rng.int(4, 18) * (i === 2 ? -0.6 : 1));
    bars.push(Math.round(level));
  }
  const items = bars.map((height) => `<i style="height:${height}%"></i>`).join("");
  return (
    `<div class="cmp cmp-chart-bars" data-component="chart-bars" data-part="${part}">` +
    `${items}<i class="cmp-hero" style="height:100%"></i></div>`
  );
}

function chartLineMarkup(part: string, rng: SeededRandom): string {
  const points: string[] = [];
  let y = rng.int(120, 145);
  for (let i = 0; i <= 5; i += 1) {
    points.push(`${i * 80},${y}`);
    y = Math.max(14, y - rng.int(6, 34));
  }
  return (
    `<div class="cmp cmp-chart-line" data-component="chart-line" data-part="${part}">` +
    `<svg viewBox="0 0 400 160"><polyline class="cmp-stroke" points="${points.join(" ")}"/></svg></div>`
  );
}

function statCardMarkup(
  part: string,
  metric: { label: string; text: string; delta: string; up: boolean },
): string {
  return (
    `<div class="cmp cmp-stat material" data-component="stat-card" data-part="${part}">` +
    `<div class="cmp-label">${escapeHtml(metric.label)}</div>` +
    `<div class="cmp-value" data-cmp-value>${escapeHtml(metric.text)}</div>` +
    `<div class="cmp-delta ${metric.up ? "cmp-up" : "cmp-down"}">${escapeHtml(metric.delta)}</div></div>`
  );
}

function progressRingMarkup(part: string, pct: number): string {
  return (
    `<div class="cmp cmp-ring" data-component="progress-ring" data-part="${part}">` +
    `<svg viewBox="0 0 120 120"><circle class="cmp-ring-bg" cx="60" cy="60" r="52"/>` +
    `<circle class="cmp-ring-fg" cx="60" cy="60" r="52"/></svg>` +
    `<div class="cmp-value" data-cmp-value>${pct}%</div></div>`
  );
}

/** Row status → kit chip (only cmp-ok/cmp-warn exist; busy stays neutral). */
const ACTIVITY_STATUS: Record<SeedRow["state"], { className: string; label: string }> = {
  ok: { className: "cmp-chip cmp-ok", label: "Done" },
  busy: { className: "cmp-chip", label: "Busy" },
  warn: { className: "cmp-chip cmp-warn", label: "Review" },
};

function activityListMarkup(part: string, rows: SeedRow[]): string {
  const items = rows
    .map(
      (row) =>
        `<div class="cmp-item material">${escapeHtml(row.title)}` +
        `<span class="cmp-meta">${escapeHtml(row.meta)}</span></div>`,
    )
    .join("");
  return `<div class="cmp cmp-list" data-component="list" data-part="${part}">${items}</div>`;
}

function activityTableMarkup(part: string, rows: SeedRow[]): string {
  const body = rows
    .map((row) => {
      const chip = ACTIVITY_STATUS[row.state];
      return (
        `<div class="cmp-row"><span>${escapeHtml(row.title)}</span>` +
        `<span class="${chip.className}">${chip.label}</span></div>`
      );
    })
    .join("");
  return (
    `<div class="cmp cmp-table material" data-component="table" data-part="${part}">` +
    `<div class="cmp-head"><span>Activity</span><span>Status</span></div>${body}</div>`
  );
}

function terminalLogMarkup(part: string, command: string, lines: string[]): string {
  const result = lines
    .map((line) => `<div class="cmp-line cmp-dim cmp-item">${escapeHtml(line)}</div>`)
    .join("");
  return (
    `<div class="cmp cmp-terminal inset-well" data-component="terminal" data-part="${part}">` +
    `<div class="cmp-line"><span class="cmp-prompt">$</span>` +
    `<span class="cmp-text" data-cmp-text>${escapeHtml(command)}</span></div>${result}</div>`
  );
}

function teamStripMarkup(part: string, people: SeedPerson[], more: number): string {
  const avatars = people.map((person) => `<i>${escapeHtml(person.initials)}</i>`).join("");
  const moreChip = more > 0 ? `<span class="cmp-more">+${more}</span>` : "";
  return (
    `<div class="cmp cmp-avatars" data-component="avatar-stack" data-part="${part}">` +
    `${avatars}${moreChip}</div>`
  );
}

export const PLUGIN_CATALOG: PluginSpec[] = [
  {
    kind: "dashboard-grid",
    purpose: "N metric/chart tiles as one aligned, seeded, cascading unit",
    params: [
      { name: "tiles", kind: "number", default: 4, min: 3, max: 6 },
      {
        name: "emphasis",
        kind: "enum",
        default: "mixed",
        options: ["mixed", "counts", "charts"],
      },
      {
        name: "topic",
        kind: "text",
        default: "",
        maxChars: 60,
        description: "short phrase to flavor tile labels",
      },
    ],
    planningLine:
      '- dashboard-grid — N metric/chart tiles arriving as one cascade; params: tiles (3-6), emphasis ("mixed"|"counts"|"charts"), topic (short phrase).',
    lower(ctx) {
      const tiles = Number(ctx.params.tiles ?? 4);
      const pattern = TILE_PATTERNS[String(ctx.params.emphasis ?? "mixed")] ?? TILE_PATTERNS.mixed!;
      const metrics = seedMetrics(ctx.rng, tiles, ctx.topic);
      const t0 = entranceSec(ctx);
      const offsets = cascadeOffsets(tiles, clampSec(ctx.durationSec * 0.28, 0.5, 1.3));
      const components: SceneComponentSpecV1[] = [];
      const beats: ComponentBeatIntentV1[] = [];
      const markups: string[] = [];
      let beatIndex = 1;
      for (let i = 0; i < tiles; i += 1) {
        const kind = pattern[i % pattern.length]! as SceneComponentSpecV1["kind"];
        const part = `${ctx.id}-tile-${i + 1}`;
        const metric = metrics[i]!;
        components.push(component(ctx, part, kind));
        const at = t0 + offsets[i]!;
        if (kind === "stat-card") {
          beats.push(beat(ctx, beatIndex++, part, "open", at, { durationSec: 0.5 }));
          beats.push(
            beat(ctx, beatIndex++, part, "count", at + 0.35, {
              durationSec: clampSec(ctx.durationSec * 0.3, 0.7, 1.4),
              value: metric.value,
            }),
          );
          markups.push(statCardMarkup(part, metric));
        } else if (kind === "chart-bars") {
          beats.push(
            beat(ctx, beatIndex++, part, "chart", at, {
              durationSec: clampSec(ctx.durationSec * 0.32, 0.8, 1.4),
            }),
          );
          markups.push(chartBarsMarkup(part, ctx.rng));
        } else if (kind === "chart-line") {
          beats.push(
            beat(ctx, beatIndex++, part, "chart", at, {
              durationSec: clampSec(ctx.durationSec * 0.32, 0.8, 1.4),
            }),
          );
          markups.push(chartLineMarkup(part, ctx.rng));
        } else {
          const pct = ctx.rng.int(62, 97);
          beats.push(
            beat(ctx, beatIndex++, part, "progress", at, {
              durationSec: clampSec(ctx.durationSec * 0.3, 0.7, 1.3),
              value: pct / 100,
            }),
          );
          markups.push(progressRingMarkup(part, pct));
        }
      }
      return {
        components,
        beats,
        markup: markups.join(""),
        wrapperStyle: gridWrapperStyle(tiles),
      };
    },
  },
  {
    kind: "notification-stack",
    purpose: "a cascading stack of believable product toasts",
    params: [
      { name: "count", kind: "number", default: 3, min: 2, max: 4 },
      { name: "tone", kind: "enum", default: "ok", options: ["ok", "warn", "mixed"] },
      { name: "topic", kind: "text", default: "", maxChars: 60 },
    ],
    planningLine:
      '- notification-stack — a cascade of N product toasts; params: count (2-4), tone ("ok"|"warn"|"mixed"), topic.',
    lower(ctx) {
      const count = Number(ctx.params.count ?? 3);
      const tone = String(ctx.params.tone ?? "ok") as "ok" | "warn" | "mixed";
      const toasts = seedToasts(ctx.rng, count, ctx.topic, tone);
      const t0 = entranceSec(ctx);
      // Toasts land as separate arrivals, slower than a tile cascade.
      const step = clampSec(ctx.durationSec * 0.18, 0.55, 0.85);
      const components: SceneComponentSpecV1[] = [];
      const beats: ComponentBeatIntentV1[] = [];
      const markups: string[] = [];
      toasts.forEach((toast, i) => {
        const part = `${ctx.id}-toast-${i + 1}`;
        components.push(component(ctx, part, "toast"));
        beats.push(beat(ctx, i + 1, part, "open", t0 + step * i, { durationSec: 0.5 }));
        const icon = toast.tone === "ok"
          ? `<span class="cmp-icon cmp-ok">✓</span>`
          : `<span class="cmp-icon cmp-warn">!</span>`;
        markups.push(
          `<div class="cmp cmp-toast material" data-component="toast" data-part="${part}">` +
            `${icon}<div><div class="cmp-title">${escapeHtml(toast.title)}</div>` +
            `<div class="cmp-meta">${escapeHtml(toast.meta)}</div></div></div>`,
        );
      });
      return {
        components,
        beats,
        markup: markups.join(""),
        wrapperStyle: stackWrapperStyle({ widthPx: 440, gapIndex: 1 }),
      };
    },
  },
  {
    kind: "lockup",
    purpose: "headline + sub + CTA as one unit owning copy, spacing, and entrance",
    params: [
      { name: "headline", kind: "text", maxChars: 48, description: "hero line" },
      { name: "sub", kind: "text", default: "", maxChars: 90 },
      { name: "cta", kind: "text", default: "", maxChars: 22 },
      {
        name: "reveal",
        kind: "enum",
        default: "rise",
        options: ["rise", "typewriter", "pop", "assemble"],
      },
    ],
    planningLine:
      '- lockup — headline+sub+CTA as one owned unit with a kinetic reveal; params: headline (REQUIRED, <=48 chars), sub (<=90), cta (<=22), reveal ("rise"|"typewriter"|"pop"|"assemble").',
    style:
      ".seq-plugin-lockup .seq-lockup-sub{font-size:clamp(18px,1.6vw,30px);" +
      "font-weight:500;opacity:.82;letter-spacing:0}\n" +
      ".seq-plugin-lockup .cmp-button{margin-top:13px}",
    lower(ctx) {
      const headline = String(ctx.params.headline ?? "").trim();
      const sub = String(ctx.params.sub ?? "").trim();
      const cta = String(ctx.params.cta ?? "").trim();
      const reveal = String(ctx.params.reveal ?? "rise");
      const t0 = entranceSec(ctx);
      const sceneEnd = ctx.startSec + ctx.durationSec;
      // Host-owned pacing arithmetic (the plugin-probe-1 lesson, from the
      // planner's hand-rolled lockup imitation dying on pacing/reading): typed
      // copy needs max(1.2, 0.3s x words) of reading time after it finishes.
      // Derive a type duration that leaves that floor before the scene ends;
      // when even the minimum duration cannot fit, ship the copy STATIC in the
      // markup (visible the whole scene — readable by construction) instead of
      // emitting a beat the pacing gate would reject.
      const readingFloor = (text: string): number =>
        Math.max(1.2, 0.3 * text.split(/\s+/).filter(Boolean).length);
      const feasibleType = (
        atSec: number,
        text: string,
      ): { durationSec: number } | undefined => {
        const natural = Math.min(3, Math.max(0.4, text.length * 0.055));
        const latestFinish = sceneEnd - readingFloor(text) - 0.3;
        if (atSec + 0.4 > latestFinish) return undefined;
        return { durationSec: Math.round(Math.min(natural, latestFinish - atSec) * 100) / 100 };
      };
      const components: SceneComponentSpecV1[] = [
        component(ctx, `${ctx.id}-headline`, "headline"),
      ];
      const beats: ComponentBeatIntentV1[] = [];
      const headlineType = feasibleType(t0, headline);
      if (headlineType) {
        beats.push(
          beat(ctx, 1, `${ctx.id}-headline`, "type", t0, {
            text: headline,
            durationSec: headlineType.durationSec,
            ...(reveal !== "typewriter" ? { style: reveal } : {}),
          }),
        );
      }
      const markups: string[] = [
        `<h1 class="cmp cmp-headline" data-component="headline" data-part="${ctx.id}-headline">` +
          `<span class="cmp-text" data-cmp-text>${escapeHtml(headline)}</span></h1>`,
      ];
      if (sub) {
        components.push(component(ctx, `${ctx.id}-sub`, "headline"));
        const subType = feasibleType(t0 + 0.45, sub);
        if (subType) {
          beats.push(
            beat(ctx, 2, `${ctx.id}-sub`, "type", t0 + 0.45, {
              text: sub,
              durationSec: subType.durationSec,
              style: "rise",
            }),
          );
        }
        markups.push(
          `<h2 class="cmp cmp-headline seq-lockup-sub" data-component="headline" ` +
            `data-part="${ctx.id}-sub"><span class="cmp-text" data-cmp-text>${escapeHtml(sub)}</span></h2>`,
        );
      }
      if (cta) {
        components.push(component(ctx, `${ctx.id}-cta`, "button"));
        beats.push(
          beat(ctx, 3, `${ctx.id}-cta`, "open", t0 + (sub ? 0.95 : 0.6), { durationSec: 0.5 }),
        );
        markups.push(
          `<button class="cmp cmp-button" data-component="button" data-part="${ctx.id}-cta" ` +
            `data-state="idle"><span class="cmp-label">${escapeHtml(cta)}</span>` +
            `<span class="cmp-spinner"></span><span class="cmp-check">✓</span></button>`,
        );
      }
      return {
        components,
        beats,
        markup: markups.join(""),
        wrapperStyle:
          "display:flex;flex-direction:column;align-items:center;gap:21px;" +
          "text-align:center;width:min(100%,1100px);margin:0 auto",
      };
    },
  },
  {
    kind: "activity-feed",
    purpose: "believable activity rows arriving as one staggered cascade (kills Item 1/2/3 filler)",
    params: [
      { name: "rows", kind: "number", default: 4, min: 3, max: 6 },
      { name: "surface", kind: "enum", default: "list", options: ["list", "table"] },
      { name: "topic", kind: "text", default: "", maxChars: 60 },
    ],
    planningLine:
      '- activity-feed — N believable activity rows arriving as one staggered cascade (the direct kill for "Item 1/2/3" board rows); params: rows (3-6), surface ("list"|"table"), topic (short phrase).',
    style:
      ".seq-plugin-activity-feed .cmp-item .cmp-meta{display:block;margin-top:.25em;" +
      "font-size:.8em;color:var(--muted,#94a3b8)}",
    lower(ctx) {
      const rows = Number(ctx.params.rows ?? 4);
      const surface = String(ctx.params.surface ?? "list") === "table" ? "table" : "list";
      const part = `${ctx.id}-feed`;
      const seeded = seedRows(ctx.rng, rows, ctx.topic);
      // One component, one rows beat — the runtime staggers the children itself.
      return {
        components: [component(ctx, part, surface)],
        beats: [
          beat(ctx, 1, part, "rows", entranceSec(ctx), {
            durationSec: clampSec(ctx.durationSec * 0.35, 0.9, 2.2),
          }),
        ],
        markup:
          surface === "table"
            ? activityTableMarkup(part, seeded)
            : activityListMarkup(part, seeded),
        wrapperStyle: stackWrapperStyle({ widthPx: 560, gapIndex: 0 }),
      };
    },
  },
  {
    kind: "terminal-log",
    purpose: "a terminal card whose command typewrites, then result lines stream in",
    params: [
      {
        name: "command",
        kind: "text",
        maxChars: 60,
        description: "the command that types on — keep it short, e.g. acme deploy --prod",
      },
      { name: "lines", kind: "number", default: 3, min: 2, max: 5 },
      { name: "topic", kind: "text", default: "", maxChars: 60 },
    ],
    planningLine:
      '- terminal-log — a terminal card: the command typewrites, then result lines stream in; params: command (REQUIRED, short, e.g. "acme deploy"), lines (2-5), topic. Give this shot >=4s (the typed command earns a reading floor).',
    lower(ctx) {
      const command = String(ctx.params.command ?? "").trim();
      const lines = Number(ctx.params.lines ?? 3);
      const part = `${ctx.id}-cli`;
      const t0 = entranceSec(ctx);
      // Result lines land after the command has mostly typed (terminals typewrite,
      // so the type beat's duration derives from command length host-side).
      const rowsAt = t0 + clampSec(0.3 * command.length * 0.055 + 0.5, 0.8, 1.6);
      const result = seedLogLines(ctx.rng, lines);
      return {
        components: [component(ctx, part, "terminal")],
        beats: [
          beat(ctx, 1, part, "type", t0, { text: command }),
          beat(ctx, 2, part, "rows", rowsAt, {
            durationSec: clampSec(ctx.durationSec * 0.3, 0.8, 1.8),
          }),
        ],
        markup: terminalLogMarkup(part, command, result),
        wrapperStyle: stackWrapperStyle({ widthPx: 720 }),
      };
    },
  },
  {
    kind: "team-strip",
    purpose: "an overlapping avatar stack of seeded teammates that pops in as one unit",
    params: [
      { name: "people", kind: "number", default: 4, min: 3, max: 6 },
      {
        name: "more",
        kind: "number",
        // -1 is the "auto" sentinel — a defaulted `more` seeds a plausible
        // overflow (5..40); coerceParam passes the default through unclamped.
        default: -1,
        min: 0,
        max: 99,
        description: "the +N overflow count; omit to auto-seed 5..40",
      },
    ],
    planningLine:
      '- team-strip — an overlapping avatar stack of teammates that pops in as one unit; params: people (3-6), more (0-99 overflow, omit to auto-seed).',
    lower(ctx) {
      const people = Number(ctx.params.people ?? 4);
      const rawMore = Number(ctx.params.more ?? -1);
      const more = rawMore < 0 ? ctx.rng.int(5, 40) : rawMore;
      const part = `${ctx.id}-team`;
      return {
        components: [component(ctx, part, "avatar-stack")],
        beats: [beat(ctx, 1, part, "open", entranceSec(ctx), { durationSec: 0.5 })],
        markup: teamStripMarkup(part, seedNames(ctx.rng, people), more),
        wrapperStyle: "display:flex;justify-content:center",
      };
    },
  },
];

/* Pre-built asset library (assetContract.ts, ASSETS.md): each asset rides
 * these rails as an `asset-<id>` kind — same governance, same budget, same
 * strip-and-reinject injection — so the planner can declare but never draw
 * one. Flag-gated OFF until a live probe proves the vocabulary
 * (`SLACK_SEQUENCES_ASSETS=1`); the Asset Lab reads the library directly and
 * ignores this flag. */
if (assetsEnabled()) {
  PLUGIN_CATALOG.push(...assetPluginSpecs(ASSET_LIBRARY));
}

const CATALOG_BY_KIND = new Map(PLUGIN_CATALOG.map((spec) => [spec.kind, spec]));

/** Default unit part name per kind (kept short — it's a data-part). */
function defaultUnitId(kind: string): string {
  return kind === "dashboard-grid" ? "dashboard"
    : kind === "notification-stack" ? "notices"
    : kind === "lockup" ? "lockup"
    : kind === "activity-feed" ? "activity"
    : kind === "terminal-log" ? "terminal"
    : kind === "team-strip" ? "roster"
    : kind;
}

/* --------------------------------------------------------------- parsing */

function stableName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{0,63}$/.test(raw) ? raw : "";
}

/**
 * Parse-time shape normalization (tolerant, the recipe-declaration
 * disposition): accepts params as `{name: value}` or `[{name, value}]`.
 * Unknown kinds are KEPT here — the reconciler drops them with a note so the
 * no-op is visible, not silent.
 */
export function normalizeStoryboardPluginDeclarations(value: unknown): PluginDeclarationV1[] {
  if (!Array.isArray(value)) return [];
  const declarations: PluginDeclarationV1[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const kind = typeof raw.kind === "string" ? raw.kind.trim().toLowerCase() : "";
    if (!kind) continue;
    const params: Record<string, string | number> = {};
    if (Array.isArray(raw.params)) {
      for (const entry of raw.params) {
        if (!entry || typeof entry !== "object") continue;
        const pair = entry as Record<string, unknown>;
        if (typeof pair.name !== "string") continue;
        if (typeof pair.value === "string" || typeof pair.value === "number") {
          params[pair.name] = pair.value;
        }
      }
    } else if (raw.params && typeof raw.params === "object") {
      for (const [name, paramValue] of Object.entries(raw.params as Record<string, unknown>)) {
        if (typeof paramValue === "string" || typeof paramValue === "number") {
          params[name] = paramValue;
        }
      }
    }
    declarations.push({
      version: 1,
      kind,
      id: stableName(raw.id) || defaultUnitId(kind),
      ...(stableName(raw.region) ? { region: stableName(raw.region) } : {}),
      params,
    });
  }
  return declarations;
}

/* ----------------------------------------------------------- reconcile */

function coerceParam(
  spec: PluginParamSpec,
  value: string | number | undefined,
): { value?: string | number; note?: string } {
  const fallback = (): { value?: string | number; note?: string } => {
    if (spec.default !== undefined) {
      return {
        value: spec.default,
        note: value === undefined ? undefined : `param "${spec.name}" reset to its default`,
      };
    }
    return { note: `required param "${spec.name}" is ${value === undefined ? "missing" : "unusable"}` };
  };
  if (value === undefined) return fallback();
  switch (spec.kind) {
    case "text": {
      const text = String(value).trim();
      if (!text) return fallback();
      const capped = spec.maxChars && text.length > spec.maxChars
        ? text.slice(0, spec.maxChars).trimEnd()
        : text;
      return {
        value: capped,
        ...(capped !== text
          ? { note: `param "${spec.name}" copy capped to ${spec.maxChars} chars` }
          : {}),
      };
    }
    case "number": {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback();
      const clamped = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, Math.round(num)));
      return {
        value: clamped,
        ...(clamped !== num ? { note: `param "${spec.name}" clamped to ${clamped}` } : {}),
      };
    }
    case "enum": {
      const text = String(value).trim().toLowerCase();
      if (spec.options?.includes(text)) return { value: text };
      return fallback();
    }
    case "part-ref": {
      const text = String(value).trim();
      if (/^[a-z][a-z0-9-]*$/.test(text)) return { value: text };
      return fallback();
    }
  }
}

function lowerContext(
  scene: Pick<
    DirectScene,
    "id" | "title" | "purpose" | "foreground" | "startSec" | "durationSec" | "camera"
  >,
  declaration: PluginDeclarationV1,
): PluginLowerContext {
  const uid = declaration.uid ?? `${scene.id}-${declaration.id}`;
  const seed =
    `${uid}|${declaration.kind}|` +
    Object.keys(declaration.params).sort()
      .map((name) => `${name}=${declaration.params[name]}`)
      .join("&");
  const arrivalSec = cameraArrivalSec(scene.camera, declaration);
  return {
    sceneId: scene.id,
    startSec: scene.startSec,
    durationSec: scene.durationSec,
    id: declaration.id,
    uid,
    ...(arrivalSec !== undefined ? { arrivalSec } : {}),
    params: declaration.params,
    topic: deriveTopic(
      typeof declaration.params.topic === "string" ? declaration.params.topic : "",
      scene.title,
      scene.purpose,
      scene.foreground,
    ),
    rng: createSeededRandom(seed),
  };
}

export interface PluginReconcileResult {
  scenes: DirectScene[];
  notes: string[];
}

/** Evidence-search half-windows mirroring storyboardMoments.ts. */
const MOMENT_EVIDENCE_BEFORE_SEC = 0.45;
const MOMENT_EVIDENCE_AFTER_SEC = 0.75;

/**
 * Scene-scoped load-bearing check for the duplicate absorber below. A free
 * component is KEPT (never absorbed) when anything typed addresses it:
 * a cursor interaction, a camera landing/focus, any scene's cut focal, the
 * declared focal subject, a morph pairing, or a beat inside a DECLARED
 * moment's evidence window. Deliberately over-conservative — ambiguity keeps
 * the surface (the trimOverBudgetComponents disposition).
 */
function isLoadBearingComponent(
  id: string,
  scene: DirectScene,
  allScenes: DirectScene[],
): boolean {
  for (const interaction of scene.interactions ?? []) {
    if (
      interaction.targetPart === id ||
      (interaction as { ripplePart?: string }).ripplePart === id ||
      (interaction as { dragTargetPart?: string }).dragTargetPart === id
    ) {
      return true;
    }
  }
  for (const move of scene.camera?.path ?? []) {
    if (move.toPart === id || move.focus?.part === id) return true;
  }
  for (const any of allScenes) {
    if (any.cut?.focalPartOut === id || any.cut?.focalPartIn === id) return true;
  }
  if (scene.spatialIntent?.focalPart === id) return true;
  for (const sceneBeat of scene.beats ?? []) {
    if (sceneBeat.morphTo === id) return true;
    if (sceneBeat.component === id && sceneBeat.kind === "morph") return true;
    if (
      sceneBeat.component === id &&
      (scene.moments ?? []).some((moment) =>
        sceneBeat.atSec >= moment.atSec - MOMENT_EVIDENCE_BEFORE_SEC &&
        sceneBeat.atSec <= moment.atSec + MOMENT_EVIDENCE_AFTER_SEC,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Beat kinds safe to absorb with their duplicated component: staging beats
 * (open/rows/close) and content beats (type/swap/highlight) that restate what
 * the plugin already renders. State machinery (press/set-state/select/morph)
 * and metric payoffs (count/progress/chart/stream) always keep the component —
 * and moment-bound copy is already protected by the load-bearing check.
 */
const ENTRANCE_ONLY_BEATS = new Set<ComponentBeatIntentV1["kind"]>([
  "open", "rows", "close", "type", "swap", "highlight",
]);

/**
 * Duplicate-content absorber (live lesson from plugin-probe-1): the planner
 * declared a notification-stack plugin AND authored its own free toast
 * component in the same scene — the vocabulary forbids it, a Flash-tier
 * planner does it anyway, and the film shows the same content twice. When a
 * plugin unit lands in a scene, free components of the SAME kind as the
 * unit's children are absorbed (dropped with a note) — but ONLY when nothing
 * typed depends on them: not load-bearing, and every beat entrance-only.
 */
function absorbDuplicatedPluginContent(
  scene: DirectScene,
  loweredKinds: ReadonlySet<string>,
  allScenes: DirectScene[],
  notes: string[],
): DirectScene {
  const components = scene.components ?? [];
  if (!components.length || !loweredKinds.size) return scene;
  const dropIds = new Set<string>();
  for (const component of components) {
    if (component.pluginUid || !loweredKinds.has(component.kind)) continue;
    if (isLoadBearingComponent(component.id, scene, allScenes)) continue;
    const beats = (scene.beats ?? []).filter((beat) => beat.component === component.id);
    if (beats.some((beat) => !ENTRANCE_ONLY_BEATS.has(beat.kind))) continue;
    dropIds.add(component.id);
  }
  if (!dropIds.size) return scene;
  const note =
    `absorbed ${dropIds.size} free ${[...loweredKinds].join("/")} component(s) ` +
    `(${[...dropIds].join(", ")}) duplicating content a declared plugin already generates`;
  notes.push(`${scene.id}: ${note}`);
  return {
    ...scene,
    components: components.filter((component) => !dropIds.has(component.id)),
    beats: (scene.beats ?? []).filter((beat) => !dropIds.has(beat.component)),
    pluginAbsorbedParts: [...new Set([...(scene.pluginAbsorbedParts ?? []), ...dropIds])],
    sentinelNormalizations: [
      ...(scene.sentinelNormalizations ?? []),
      `plugin-reconcile: ${note}`,
    ],
  };
}

/**
 * Sentinel L2 governor + lowering, run ONCE at storyboard parse (before the
 * dive/pop/moment machinery so lowered beats participate in every downstream
 * derivation). Deterministic repair, zero paid attempts, degrade-never-veto:
 * - unknown plugin kind → declaration no-ops with a note;
 * - duplicate kind in one scene → first wins;
 * - over-budget (> MAX_PLUGINS_PER_FILM units) → earliest declarations win;
 * - param violations → default / clamp / cap; a REQUIRED param with no usable
 *   value drops the unit;
 * - unit/child part-name collisions with declared components or earlier
 *   plugins → the unit id is suffixed deterministically.
 * Kept declarations are lowered immediately: their typed components (stamped
 * `pluginUid`) and beats merge into the scene, so every existing gate judges
 * the same plan the runtime will execute.
 */
export function reconcileAndLowerPlugins(scenes: DirectScene[]): PluginReconcileResult {
  const notes: string[] = [];
  let budget = MAX_PLUGINS_PER_FILM;
  const takenPartIds = new Set<string>();
  for (const scene of scenes) {
    for (const declared of scene.components ?? []) takenPartIds.add(declared.id);
  }
  const reconciled = scenes.map((scene) => {
    if (!scene.plugins?.length) return scene;
    const kept: PluginDeclarationV1[] = [];
    const sceneNotes: string[] = [];
    const seenKinds = new Set<string>();
    const extraComponents: SceneComponentSpecV1[] = [];
    const extraBeats: ComponentBeatIntentV1[] = [];
    /** Existing components to re-mark as plugin-owned (idempotent re-parse). */
    const restampByComponentId = new Map<string, string>();
    for (const declaration of scene.plugins) {
      const spec = CATALOG_BY_KIND.get(declaration.kind);
      if (!spec) {
        sceneNotes.push(`plugin "${declaration.kind}" is not in the catalog — declaration no-ops`);
        continue;
      }
      if (seenKinds.has(declaration.kind)) {
        sceneNotes.push(`plugin "${declaration.kind}" declared twice in one scene — first wins`);
        continue;
      }
      if (budget <= 0) {
        sceneNotes.push(
          `plugin "${declaration.kind}" exceeds the ${MAX_PLUGINS_PER_FILM}-per-film budget — dropped`,
        );
        continue;
      }
      const params: Record<string, string | number> = {};
      let dropReason: string | undefined;
      for (const paramSpec of spec.params) {
        const coerced = coerceParam(paramSpec, declaration.params[paramSpec.name]);
        if (coerced.note) sceneNotes.push(`plugin "${declaration.kind}": ${coerced.note}`);
        if (coerced.value === undefined) {
          dropReason = paramSpec.name;
          break;
        }
        params[paramSpec.name] = coerced.value;
      }
      if (dropReason) {
        sceneNotes.push(
          `plugin "${declaration.kind}" dropped — no usable value for required param "${dropReason}"`,
        );
        continue;
      }
      // Idempotent re-parse (the plugin-probe-1 "notices-2" double-stack): a
      // storyboard scene-repair merge re-parses an ALREADY-LOWERED plan whose
      // components lost their host-only pluginUid stamp at normalization. If
      // every child this lowering would create already exists in the scene,
      // the unit was lowered by a previous parse — re-stamp the existing
      // components and keep the declaration instead of appending a duplicate.
      const replay = spec.lower(
        lowerContext(scene, { ...declaration, params, uid: `${scene.id}-${declaration.id}` }),
      );
      const existingIds = new Set((scene.components ?? []).map((entry) => entry.id));
      if (
        replay.components.length &&
        replay.components.every((entry) => existingIds.has(entry.id))
      ) {
        const uid = `${scene.id}-${declaration.id}`;
        for (const entry of replay.components) restampByComponentId.set(entry.id, uid);
        seenKinds.add(declaration.kind);
        budget -= 1;
        kept.push({
          version: 1,
          kind: declaration.kind,
          id: declaration.id,
          ...(declaration.region ? { region: declaration.region } : {}),
          params,
          uid,
        });
        continue;
      }
      // Deterministic unit-id uniqueness: children derive from the unit id, so
      // a collision anywhere renames the unit, never a child.
      let id = declaration.id;
      for (let suffix = 2; suffix < 6; suffix += 1) {
        const candidate: PluginDeclarationV1 = { ...declaration, id, params };
        const lowered = CATALOG_BY_KIND.get(declaration.kind)!.lower(
          lowerContext(scene, candidate),
        );
        const collision = [id, ...lowered.components.map((entry) => entry.id)]
          .find((partId) => takenPartIds.has(partId));
        if (!collision) break;
        id = `${declaration.id}-${suffix}`;
      }
      if (id !== declaration.id) {
        sceneNotes.push(
          `plugin "${declaration.kind}" unit id "${declaration.id}" collides with a declared ` +
            `part — renamed to "${id}"`,
        );
      }
      const finalDeclaration: PluginDeclarationV1 = {
        version: 1,
        kind: declaration.kind,
        id,
        ...(declaration.region ? { region: declaration.region } : {}),
        params,
        uid: `${scene.id}-${id}`,
      };
      const lowering = spec.lower(lowerContext(scene, finalDeclaration));
      takenPartIds.add(id);
      for (const entry of lowering.components) takenPartIds.add(entry.id);
      extraComponents.push(...lowering.components);
      extraBeats.push(...lowering.beats);
      seenKinds.add(declaration.kind);
      budget -= 1;
      kept.push(finalDeclaration);
    }
    notes.push(...sceneNotes.map((note) => `${scene.id}: ${note}`));
    if (!kept.length && !sceneNotes.length) return scene;
    const baseComponents = (scene.components ?? []).map((entry) => {
      const uid = restampByComponentId.get(entry.id);
      return uid ? { ...entry, pluginUid: uid } : entry;
    });
    const merged: DirectScene = {
      ...scene,
      ...(kept.length ? { plugins: kept } : { plugins: undefined }),
      ...(baseComponents.length || extraComponents.length
        ? { components: [...baseComponents, ...extraComponents] }
        : {}),
      ...(extraBeats.length
        ? {
            beats: [...(scene.beats ?? []), ...extraBeats].sort((a, b) => a.atSec - b.atSec),
          }
        : {}),
      ...(sceneNotes.length
        ? {
            sentinelNormalizations: [
              ...(scene.sentinelNormalizations ?? []),
              ...sceneNotes.map((note) => `plugin-reconcile: ${note}`),
            ],
          }
        : {}),
    };
    if (!kept.length) return merged;
    const loweredKinds = new Set([
      ...extraComponents.map((entry) => entry.kind),
      ...baseComponents.flatMap((entry) => (entry.pluginUid ? [entry.kind] : [])),
    ]);
    return absorbDuplicatedPluginContent(merged, loweredKinds, scenes, notes);
  });
  return { scenes: reconciled, notes };
}

/* ------------------------------------------------------- instantiation */

export interface ResolvedPluginInstance {
  uid: string;
  kind: string;
  sceneId: string;
  /** The unit part name (wrapper data-part). */
  id: string;
  region?: string;
  markup: string;
  wrapperStyle: string;
  style?: string;
  styleId: string;
  /**
   * Copy the unit renders verbatim from its text params (escaped form). An
   * exact text-node duplicate of one of these in the SAME scene outside the
   * wrapper is mechanically certain author duplication (the fix-probe-1
   * doubled lockup) and is hidden at injection.
   */
  copyTexts: string[];
}

/**
 * Re-generate every kept declaration's markup for injection. Pure function of
 * the locked storyboard — the same seed and params produce the same bytes on
 * every repair pass, so strip-and-reinject converges.
 */
export function resolvePluginPlan(scenes: DirectScene[]): ResolvedPluginInstance[] {
  const instances: ResolvedPluginInstance[] = [];
  for (const scene of scenes) {
    for (const declaration of scene.plugins ?? []) {
      const spec = CATALOG_BY_KIND.get(declaration.kind);
      if (!spec || !declaration.uid) continue; // reconcile owns the note
      const lowering = spec.lower(lowerContext(scene, declaration));
      const copyTexts = spec.params
        .filter((param) => param.kind === "text")
        .map((param) => String(declaration.params[param.name] ?? "").trim())
        .filter((value) => value.length >= 8)
        .map(escapeHtml)
        .filter((escaped) => lowering.markup.includes(escaped));
      instances.push({
        uid: declaration.uid,
        kind: declaration.kind,
        sceneId: scene.id,
        id: declaration.id,
        ...(declaration.region ? { region: declaration.region } : {}),
        markup: lowering.markup,
        wrapperStyle: lowering.wrapperStyle,
        ...(spec.style ? { style: spec.style } : {}),
        styleId: `sequences-plugin-style-${declaration.kind}`,
        copyTexts,
      });
    }
  }
  return instances;
}

/* ----------------------------------------------------------- injection */

const STYLE_BLOCK_PATTERN =
  /<style\b[^>]*\bdata-sequences-plugin-style\s*=\s*(["'])[^"']*\1[^>]*>[\s\S]*?<\/style>\n?/gi;

/** Remove every injected plugin wrapper (balanced-div scan — units nest divs). */
export function stripPluginMarkup(html: string): string {
  let result = html;
  for (;;) {
    const open = /<div\b[^>]*\bdata-sequences-plugin\s*=\s*(["'])[^"']*\1[^>]*>/i.exec(result);
    if (!open) break;
    const tagEnd = open.index + open[0].length;
    const scanner = /<div\b|<\/div\s*>/gi;
    scanner.lastIndex = tagEnd;
    let depth = 1;
    let end = -1;
    for (let match = scanner.exec(result); match; match = scanner.exec(result)) {
      depth += match[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = match.index + match[0].length;
        break;
      }
    }
    if (end < 0) end = tagEnd; // unbalanced (host bug) — stay convergent
    // Consume the newline the injector prepends, so strip+reinject is
    // byte-convergent from the FIRST pass (QA caches key on content hash).
    const from = result[open.index - 1] === "\n" ? open.index - 1 : open.index;
    result = result.slice(0, from) + result.slice(end);
  }
  return result.replace(/\n[ \t]*\n[ \t]*\n/g, "\n\n");
}

/** The scene element's [open-tag-start, close-tag-end] span (balanced scan). */
function sceneBlockBounds(
  html: string,
  sceneId: string,
): { start: number; end: number } | undefined {
  const open = sceneOpenTag(html, sceneId);
  if (!open) return undefined;
  const tagName = html.slice(open.index).match(/^<([a-z][\w:-]*)/i)?.[1];
  if (!tagName) return undefined;
  const scanner = new RegExp(`<${tagName}\\b|</${tagName}\\s*>`, "gi");
  scanner.lastIndex = open.end;
  let depth = 1;
  for (let match = scanner.exec(html); match; match = scanner.exec(html)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return { start: open.index, end: match.index + match[0].length };
  }
  return { start: open.index, end: html.length };
}

function sceneOpenTag(html: string, sceneId: string): { index: number; end: number } | undefined {
  const pattern = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bid\\s*=\\s*(["'])${sceneId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\2[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) return undefined;
  return { index: match.index, end: match.index + match[0].length };
}

/**
 * Inject (strip + re-inject) every resolved plugin unit — the recipe seam
 * discipline: a host-marked wrapper prepended inside the target scene section
 * (or its declared data-region station when present), regenerated VERBATIM on
 * every repair pass so the mechanism is unreachable to the author model. No
 * motion blocks: plugin motion is the lowered typed beats, compiled by the
 * host component runtime like any other beat.
 */
export function injectPluginContract(
  html: string,
  scenes: DirectScene[],
): { html: string; injected: string[] } {
  const instances = resolvePluginPlan(scenes);
  const absorbedRules = scenes.flatMap((scene) =>
    (scene.pluginAbsorbedParts ?? []).map((part) =>
      `#${scene.id.replace(/[^\w-]/g, "")} [data-part="${part.replace(/["\\]/g, "")}"]` +
        `{display:none!important}`,
    ),
  );
  const hadInjections = /data-sequences-plugin\s*=/.test(html);
  if (!instances.length && !hadInjections && !absorbedRules.length) {
    return { html, injected: [] };
  }
  let result = stripPluginMarkup(html).replace(STYLE_BLOCK_PATTERN, "");
  // Exact-copy duplicate stamping (the fix-probe-1 doubled lockup): with the
  // host wrappers stripped, any same-scene text node exactly matching copy a
  // unit renders verbatim from its typed params is author duplication. Stamp
  // the enclosing tag; the hide rule below removes it from view while GSAP
  // selectors keep binding.
  for (const instance of instances) {
    if (!instance.copyTexts.length) continue;
    const bounds = sceneBlockBounds(result, instance.sceneId);
    if (!bounds) continue;
    for (const text of instance.copyTexts) {
      const pattern = new RegExp(`>\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*<`, "g");
      const stamps: number[] = [];
      for (let match = pattern.exec(result); match; match = pattern.exec(result)) {
        if (match.index < bounds.start || match.index > bounds.end) continue;
        stamps.push(match.index);
      }
      for (const index of stamps.reverse()) {
        const tagStart = result.lastIndexOf("<", index);
        if (tagStart < 0) continue;
        const tag = result.slice(tagStart, index + 1);
        if (!/^<[a-z]/i.test(tag) || tag.includes("data-sequences-plugin-duplicate")) continue;
        result =
          result.slice(0, index) +
          ` data-sequences-plugin-duplicate=""` +
          result.slice(index);
      }
    }
  }
  // Author-drawn duplicates (absorbed components + exact-copy stamps) hide
  // via static CSS, not a subtree strip, so authored GSAP selectors still
  // bind — no missing-target warnings. data-part selection is deliberate:
  // hiding is scoped to the exact duplicated object, and a bridge clone
  // losing the hide for a 0.4s cut window is an acceptable degrade.
  const hideRules = [
    ...absorbedRules,
    ...(result.includes("data-sequences-plugin-duplicate")
      ? [`[data-sequences-plugin-duplicate]{display:none!important}`]
      : []),
  ];
  if (hideRules.length) {
    const hideTag =
      `<style data-sequences-host="1" data-sequences-plugin-style="absorbed-parts" ` +
      `id="sequences-plugin-absorbed">\n${hideRules.join("\n")}\n</style>\n`;
    result = /<\/head>/i.test(result)
      ? result.replace(/<\/head>/i, `${hideTag}</head>`)
      : hideTag + result;
  }
  const injected: string[] = [];
  const styleInjected = new Set<string>();
  for (const instance of instances) {
    const scene = sceneOpenTag(result, instance.sceneId);
    if (!scene) continue; // validatePluginContract reports plugin_island_missing
    let anchorEnd = scene.end;
    if (instance.region) {
      const regionPattern = new RegExp(
        `<[a-z][\\w:-]*\\b[^>]*\\bdata-region\\s*=\\s*(["'])${instance.region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1[^>]*>`,
        "gi",
      );
      regionPattern.lastIndex = scene.end;
      const region = regionPattern.exec(result);
      // Best-effort: a missing station degrades to the scene root rather than
      // dropping the unit (the recipe-region precedent).
      if (region) anchorEnd = region.index + region[0].length;
    }
    // Placement self-defense (the plugin-live-1 squeeze: an author station
    // styled display:grid put the unit into ONE narrow column cell and its
    // tiles overflowed 240px): the wrapper always spans a grid parent's full
    // track range and never lets content-based min sizing blow past its box.
    // All three properties are inert under non-grid parents.
    const wrapper =
      `\n<div class="seq-plugin seq-plugin-${instance.kind}" data-sequences-host="1" ` +
      `data-sequences-plugin="${instance.kind}" data-plugin-uid="${instance.uid}" ` +
      `data-part="${instance.id}" data-layout-important="1" style="${instance.wrapperStyle};` +
      `grid-column:1/-1;min-width:0;max-width:100%;box-sizing:border-box">` +
      `${instance.markup}</div>`;
    result = result.slice(0, anchorEnd) + wrapper + result.slice(anchorEnd);
    if (instance.style && !styleInjected.has(instance.styleId)) {
      const styleTag =
        `<style data-sequences-host="1" data-sequences-plugin-style="${instance.kind}" ` +
        `id="${instance.styleId}">\n${instance.style}\n</style>\n`;
      result = /<\/head>/i.test(result)
        ? result.replace(/<\/head>/i, `${styleTag}</head>`)
        : styleTag + result;
      styleInjected.add(instance.styleId);
    }
    injected.push(instance.uid);
  }
  return { html: result, injected };
}

/* ---------------------------------------------------------- validation */

/**
 * Host-plumbing self-check (the validateRecipeContract disposition): these
 * codes are reachable only if the injection seam breaks — the L2 governor
 * already dropped everything undeclarable, and the host injects the rest.
 */
export function validatePluginContract(
  html: string,
  scenes: DirectScene[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const scene of scenes) {
    for (const declaration of scene.plugins ?? []) {
      if (!declaration.uid) continue; // never reconciled (parse-only path)
      if (!CATALOG_BY_KIND.has(declaration.kind)) {
        errors.push(
          `plugin_unknown: scene "${scene.id}" declares plugin "${declaration.kind}" ` +
            `which is not in the catalog (reconciliation should have dropped it)`,
        );
        continue;
      }
      const uidPattern = new RegExp(
        `data-plugin-uid\\s*=\\s*(["'])${declaration.uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`,
        "i",
      );
      if (!uidPattern.test(html)) {
        errors.push(
          `plugin_island_missing: scene "${scene.id}" declared plugin ` +
            `"${declaration.kind}" but its host-injected unit wrapper is absent`,
        );
      }
    }
  }
  return { errors, warnings };
}

/* ----------------------------------------------------------- vocabulary */

/** Compact planner-facing teaching block (storyboard prompt). */
export function pluginPlanningVocabulary(): string {
  return [
    "HOST PLUGINS — generated set-pieces you DECLARE, never author. A plugin is",
    "a host-owned generator: declare it on a shot and the host builds the whole",
    "unit — aligned geometry, believable on-topic content, and entrance beats —",
    "as ONE budget unit (its N tiles never count against the component budget,",
    "and you must NOT declare separate components for content the plugin",
    "already generates). Plugin parts stay addressable: the unit's data-part is",
    'its "id"; children are "<id>-tile-1", "<id>-toast-1", "<id>-headline" etc,',
    "so cameras can track-to-anchor them and cuts can carry them. Give a plugin",
    `shot >=3s. At most ${MAX_PLUGINS_PER_FILM} plugin units per film. Declare inside a shot as`,
    '"plugins":[{"version":1,"kind":"dashboard-grid","id":"metrics","region":"optional station",',
    '"params":[{"name":"tiles","value":4},{"name":"topic","value":"deploy metrics"}]}]',
    ...PLUGIN_CATALOG.map((spec) => spec.planningLine),
    'Use "plugins":[] when no generated set-piece fits the shot.',
  ].join("\n");
}

/** True when a scene declares at least one reconciled plugin. */
export function scenePluginUnitIds(scene: Pick<DirectScene, "plugins">): Set<string> {
  return new Set((scene.plugins ?? []).flatMap((declaration) =>
    declaration.uid ? [declaration.id] : [],
  ));
}

/** All catalog kinds (schema/enum surface). */
export const PLUGIN_KINDS: ReadonlySet<string> = new Set(PLUGIN_CATALOG.map((spec) => spec.kind));

/* Sanity: every lowered component kind must exist in the component catalog.
 * Checked at module load so a catalog typo fails fast in tests, not mid-run. */
for (const spec of PLUGIN_CATALOG) {
  const probe = spec.lower({
    sceneId: "probe",
    startSec: 0,
    durationSec: 6,
    id: defaultUnitId(spec.kind),
    uid: `probe-${spec.kind}`,
    params: Object.fromEntries(
      spec.params.map((param) => [param.name, param.default ?? (param.kind === "number" ? 3 : "probe")]),
    ),
    topic: deriveTopic("probe"),
    rng: createSeededRandom(`probe-${spec.kind}`),
  });
  for (const entry of probe.components) {
    if (!COMPONENT_KINDS.has(entry.kind)) {
      throw new Error(
        `plugin "${spec.kind}" lowers to unknown component kind "${entry.kind}"`,
      );
    }
  }
}
