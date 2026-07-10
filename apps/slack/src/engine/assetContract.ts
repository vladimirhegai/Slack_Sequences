/**
 * Asset contract — the pre-built parametric asset library (ASSETS.md).
 *
 * The complaint this answers: model-drawn hero visuals look lame. The fix is
 * NOT teaching the model to draw better — it's removing drawing from the
 * model entirely. An asset is a designer-grade visual built ONCE by a human
 * (in the Asset Lab, `npm run assets`), parameterized over typed knobs
 * (color / number / text / enum), themed through the SAME brand tokens the
 * component kit reads (`--accent`, `--surface`, `--text`, `--muted`,
 * `--cinema-radius`), and carrying named invokable ANIMATIONS whose motion is
 * derived from real spring physics (`motionSpring.ts`) — never hand-tuned or
 * linear.
 *
 * Division of labor (mirrors the component kit, one level up):
 * - the LIBRARY owns markup, styling, silhouette, and every animation curve;
 * - the PLANNER (GLM) may only *declare* an asset with params — it rides the
 *   plugin rails (`assetPluginSpecs` → pluginContract) so declarations are
 *   governed (default/clamp/drop, budgeted) and the host strips + re-injects
 *   the rendered bytes on every repair pass;
 * - the AUTHOR (DeepSeek) never sees or edits asset internals — the unit
 *   arrives host-injected; the author owns placement context and entrance
 *   timing only, exactly like plugins.
 * Neither model can author a new asset: the escape hatch for surfaces the
 * library lacks is the existing 23-kind component catalog, which is already
 * gated — free-form markup never becomes the hero-visual path again.
 *
 * Determinism: `renderAssetInstance` and every compile below are pure
 * functions of (definition, coerced params) — same declaration, same bytes,
 * on every pass. Tweakability rides CSS custom properties stamped on the
 * asset root, so the static per-kind stylesheet is byte-stable no matter the
 * params.
 *
 * Morph/match readiness: every asset declares a silhouette family aligned
 * with the cut contract's rhyme groups (pill·bar vs card·circle·window), so
 * a morph or match cut between two assets — or an asset and a kit component —
 * can be sanity-checked at plan time instead of degrading at bind time.
 */
import {
  resolveSpring,
  springLinearEasing,
  springSamples,
  springSettleSec,
  type SpringConfigV1,
  type SpringRef,
} from "./motionSpring.ts";
import type {
  PluginLowerContext,
  PluginLowering,
  PluginParamSpec,
  PluginSpec,
} from "./pluginContract.ts";
import type {
  ComponentBeatIntentV1,
  SceneComponentSpecV1,
} from "./componentContract.ts";
import { entranceAnchorSec } from "./pluginKernel.ts";

export const ASSET_FORMAT_VERSION = 1;

/* ------------------------------------------------------------- parameters */

export type AssetParamKind = "color" | "number" | "text" | "enum";

export interface AssetParamSpecV1 {
  name: string;
  kind: AssetParamKind;
  description: string;
  /** Every param has a default — an asset always renders (degrade-never-veto). */
  default: string | number;
  min?: number;
  max?: number;
  maxChars?: number;
  options?: string[];
  /**
   * When set, the coerced value is stamped on the asset root as this CSS
   * custom property (numbers get `unit`) — the one uniform tweak mechanism
   * the static stylesheet reads. Only color/number/enum params may carry it
   * (free text never enters CSS).
   */
  cssVar?: string;
  unit?: string;
  /** Enum params only: also stamp the value as `data-<attr>` on the root. */
  attr?: string;
}

/* -------------------------------------------------------------- animations */

/**
 * Small typed track vocabulary: transform channels + opacity + registered
 * custom properties. Compositor-friendly, and each maps 1:1 onto a GSAP
 * tween for the future film runtime — nothing here is webview-only.
 */
export type AssetTrackProperty =
  | "scale"
  | "translateX"
  | "translateY"
  | "rotate"
  | "opacity"
  | `--${string}`;

export interface AssetAnimationTrackV1 {
  property: AssetTrackProperty;
  /** Number, or `"$param"` to resolve a coerced param value at compile time. */
  from: number | `$${string}`;
  to: number | `$${string}`;
}

export interface AssetAnimationSpecV1 {
  /** Invokable verb, e.g. "enter", "expand", "pulse", "ring-fill". */
  name: string;
  purpose: string;
  /** Named house spring or a bespoke config — the ONLY motion authority. */
  spring: SpringRef;
  tracks: AssetAnimationTrackV1[];
  /** Override the spring's natural settle time (seconds) when needed. */
  durationSec?: number;
  /** There-and-back (pulse-class moves): plays forward then reversed. */
  yoyo?: boolean;
  /**
   * In-film choreography role. `enter` = the unit's arrival (host-emitted as
   * its entrance beat — at most ONE per asset); `payoff` = plays right after
   * the entrance settles (fills, draws, shines); `manual` (default) = Asset
   * Lab / future explicit invocation only, never auto-emitted (looping
   * attention-seekers stay opt-in by design).
   */
  trigger?: "enter" | "payoff" | "manual";
  /**
   * Pre-beat frame discipline for payoff animations whose custom-prop tracks
   * BUILD toward the state the static markup already shows (ring fills, draws,
   * meters): `"from"` makes the film runtime write each custom-prop track's
   * from-value inline at compile, so a seek before the beat shows the empty
   * state instead of the flash-of-full tell (the compileProgress precedent).
   * Leave unset for burst/emphasis moves whose rest state IS the markup.
   */
  preBeat?: "from";
}

export interface CompiledAssetAnimationV1 {
  name: string;
  purpose: string;
  durationMs: number;
  /** CSS `linear()` easing (WAAPI/CSS consumers — the Asset Lab). */
  easing: string;
  /** Normalized ease samples (GSAP registerEase consumers — film runtime). */
  easeSamples: number[];
  spring: SpringConfigV1;
  yoyo: boolean;
  from: Record<string, string>;
  to: Record<string, string>;
}

/* -------------------------------------------------------------- definition */

/**
 * Silhouette family, aligned with the cut contract's shape-rhyme groups so
 * morph/match planning between assets stays mechanically checkable.
 */
export type AssetSilhouetteFamily = "pill" | "bar" | "card" | "circle" | "window";

const FAMILY_GROUPS: Record<AssetSilhouetteFamily, "pill-bar" | "card-circle-window"> = {
  pill: "pill-bar",
  bar: "pill-bar",
  card: "card-circle-window",
  circle: "card-circle-window",
  window: "card-circle-window",
};

/** True when a morph/match between the two silhouettes reads as a rhyme. */
export function assetsRhyme(a: AssetSilhouetteFamily, b: AssetSilhouetteFamily): boolean {
  return FAMILY_GROUPS[a] === FAMILY_GROUPS[b];
}

export interface AssetRenderContext {
  /** Coerced params (every declared param present). */
  params: Record<string, string | number>;
  /** The root's data-part; children should derive as `<partId>-<child>`. */
  partId: string;
  escapeHtml: (value: string) => string;
}

export interface AssetDefinitionV1 {
  version: 1;
  /** Library id, e.g. "glass-metric". The plugin kind becomes `asset-<id>`. */
  id: string;
  title: string;
  purpose: string;
  family: AssetSilhouetteFamily;
  params: AssetParamSpecV1[];
  animations: AssetAnimationSpecV1[];
  /**
   * Static per-kind CSS (injected once per film / lab page). Reads params
   * ONLY through the root's custom properties, brand truth ONLY through the
   * shared tokens with fallbacks — byte-stable regardless of declarations.
   */
  style: string;
  /** Interior markup (the contract renders the root element around it). */
  render: (ctx: AssetRenderContext) => string;
}

/* -------------------------------------------------------------- validation */

const ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
const CSS_VAR_PATTERN = /^--[a-z][a-z0-9-]*$/;
const CSS_UNIT_PATTERN = /^(px|em|rem|%|deg|s|ms|vw|vh)$/;
/** Strict color surface: hex, safe keyword, or a var() reference. */
const COLOR_PATTERN =
  /^(#[0-9a-f]{3}([0-9a-f]{1})?|#[0-9a-f]{6}([0-9a-f]{2})?|[a-z][a-z-]{2,25}|var\(--[a-z0-9-]+\))$/i;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Definition-time validation — a library typo fails at module load (caught by
 * tests), never mid-run. Returns the definition for `const x = defineAsset(…)`.
 */
export function defineAsset(definition: AssetDefinitionV1): AssetDefinitionV1 {
  const fail = (message: string): never => {
    throw new Error(`asset "${definition.id}": ${message}`);
  };
  if (!ID_PATTERN.test(definition.id)) fail(`invalid id`);
  if (!(definition.family in FAMILY_GROUPS)) fail(`unknown family "${definition.family}"`);
  const paramNames = new Set<string>();
  for (const param of definition.params) {
    if (paramNames.has(param.name)) fail(`duplicate param "${param.name}"`);
    paramNames.add(param.name);
    if (param.cssVar !== undefined) {
      if (!CSS_VAR_PATTERN.test(param.cssVar)) fail(`param "${param.name}" bad cssVar`);
      if (param.kind === "text") fail(`param "${param.name}" is text — text never enters CSS`);
    }
    if (param.unit !== undefined && !CSS_UNIT_PATTERN.test(param.unit)) {
      fail(`param "${param.name}" bad unit`);
    }
    if (param.kind === "enum") {
      const options = param.options ?? [];
      if (!options.length) fail(`enum param "${param.name}" has no options`);
      if (!options.every((option) => /^[a-z][a-z0-9-]*$/.test(option))) {
        fail(`enum param "${param.name}" has unsafe options`);
      }
      if (!options.includes(String(param.default))) {
        fail(`enum param "${param.name}" default not in options`);
      }
    }
    if (param.kind === "color" && !COLOR_PATTERN.test(String(param.default))) {
      fail(`color param "${param.name}" default is not a safe color`);
    }
    if (param.attr !== undefined && param.kind !== "enum") {
      fail(`param "${param.name}" attr is enum-only`);
    }
  }
  const animationNames = new Set<string>();
  let enterCount = 0;
  for (const animation of definition.animations) {
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(animation.name)) fail(`bad animation name "${animation.name}"`);
    if (animationNames.has(animation.name)) fail(`duplicate animation "${animation.name}"`);
    animationNames.add(animation.name);
    if (animation.trigger === "enter") {
      enterCount += 1;
      if (enterCount > 1) fail(`declares more than one trigger:"enter" animation`);
    }
    if (animation.preBeat === "from" && !animation.tracks.some((track) => track.property.startsWith("--"))) {
      fail(`animation "${animation.name}" declares preBeat:"from" but has no custom-prop track`);
    }
    if (!animation.tracks.length) fail(`animation "${animation.name}" has no tracks`);
    for (const track of animation.tracks) {
      if (track.property.startsWith("--") && !CSS_VAR_PATTERN.test(track.property)) {
        fail(`animation "${animation.name}" bad custom property "${track.property}"`);
      }
      for (const endpoint of [track.from, track.to]) {
        if (typeof endpoint === "string") {
          const name = endpoint.slice(1);
          const param = definition.params.find((entry) => entry.name === name);
          if (!endpoint.startsWith("$") || !param) {
            fail(`animation "${animation.name}" references unknown param "${endpoint}"`);
          } else if (param.kind !== "number") {
            fail(`animation "${animation.name}" param ref "${endpoint}" must be a number param`);
          }
        }
      }
    }
    resolveSpring(animation.spring); // throws never, but validates preset names by type
  }
  return definition;
}

/* --------------------------------------------------------------- coercion */

/** Default / clamp / cap — the plugin-param disposition, plus color safety. */
export function coerceAssetParams(
  definition: AssetDefinitionV1,
  raw: Record<string, string | number>,
): { params: Record<string, string | number>; notes: string[] } {
  const params: Record<string, string | number> = {};
  const notes: string[] = [];
  for (const spec of definition.params) {
    const value = raw[spec.name];
    const reset = (reason: string): void => {
      params[spec.name] = spec.default;
      if (value !== undefined) notes.push(`param "${spec.name}" ${reason} — reset to default`);
    };
    if (value === undefined) {
      params[spec.name] = spec.default;
      continue;
    }
    switch (spec.kind) {
      case "color": {
        const text = String(value).trim().toLowerCase();
        if (COLOR_PATTERN.test(text)) params[spec.name] = text;
        else reset("is not a safe color");
        break;
      }
      case "number": {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          reset("is not a number");
          break;
        }
        const clamped = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, num));
        params[spec.name] = Math.round(clamped * 100) / 100;
        if (clamped !== num) notes.push(`param "${spec.name}" clamped to ${params[spec.name]}`);
        break;
      }
      case "text": {
        const text = String(value).trim();
        if (!text) {
          reset("is empty");
          break;
        }
        const capped = spec.maxChars && text.length > spec.maxChars
          ? text.slice(0, spec.maxChars).trimEnd()
          : text;
        params[spec.name] = capped;
        if (capped !== text) notes.push(`param "${spec.name}" capped to ${spec.maxChars} chars`);
        break;
      }
      case "enum": {
        const text = String(value).trim().toLowerCase();
        if (spec.options?.includes(text)) params[spec.name] = text;
        else reset("is not one of the options");
        break;
      }
    }
  }
  return { params, notes };
}

/* ------------------------------------------------------------- rendering */

export interface RenderedAssetInstance {
  /** The complete root element (class/data-asset/data-part/custom props). */
  markup: string;
  /** The definition's static stylesheet (inject once per document). */
  style: string;
  styleId: string;
  animations: CompiledAssetAnimationV1[];
  params: Record<string, string | number>;
  notes: string[];
}

export function assetStyleId(assetId: string): string {
  return `sequences-asset-style-${assetId}`;
}

export function renderAssetInstance(
  definition: AssetDefinitionV1,
  rawParams: Record<string, string | number>,
  options: { partId?: string } = {},
): RenderedAssetInstance {
  const partId = /^[a-z][a-z0-9-]{0,63}$/.test(options.partId ?? "")
    ? options.partId!
    : "asset";
  const { params, notes } = coerceAssetParams(definition, rawParams);
  const vars: string[] = [];
  const attrs: string[] = [];
  for (const spec of definition.params) {
    const value = params[spec.name]!;
    if (spec.cssVar) {
      vars.push(`${spec.cssVar}:${value}${typeof value === "number" && spec.unit ? spec.unit : ""}`);
    }
    if (spec.attr && spec.kind === "enum") {
      attrs.push(` data-${spec.attr}="${value}"`);
    }
  }
  const inner = definition.render({ params, partId, escapeHtml });
  // data-component="asset" binds the host-declared internal `asset` component
  // (componentContract.ts) so the unit's typed `animate` beats flow through the
  // SAME resolution/gates as every other beat — pacing, motion density,
  // moments, and layout-QA motion windows all see them for free.
  const markup =
    `<div class="asset asset-${definition.id}" data-asset="${definition.id}" ` +
    `data-component="asset" data-part="${partId}"${attrs.join("")}` +
    (vars.length ? ` style="${vars.join(";")}"` : "") +
    `>${inner}</div>`;
  return {
    markup,
    style: definition.style,
    styleId: assetStyleId(definition.id),
    animations: definition.animations.map((animation) =>
      compileAssetAnimation(animation, params),
    ),
    params,
    notes,
  };
}

/* -------------------------------------------------- animation compilation */

const TRANSFORM_ORDER: AssetTrackProperty[] = ["translateX", "translateY", "rotate", "scale"];
const TRANSFORM_UNIT: Record<string, string> = {
  translateX: "px",
  translateY: "px",
  rotate: "deg",
  scale: "",
};

function resolveEndpoint(
  endpoint: number | `$${string}`,
  params: Record<string, string | number>,
): number {
  if (typeof endpoint === "number") return endpoint;
  const value = Number(params[endpoint.slice(1)]);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Compile one animation against coerced params: transform tracks fold into a
 * single from/to transform string; opacity and registered custom properties
 * ride alongside. One spring eases the whole gesture (multi-spring stacks
 * read as jelly, not craft).
 */
export function compileAssetAnimation(
  spec: AssetAnimationSpecV1,
  params: Record<string, string | number>,
): CompiledAssetAnimationV1 {
  const spring = resolveSpring(spec.spring);
  const from: Record<string, string> = {};
  const to: Record<string, string> = {};
  const transformFrom: string[] = [];
  const transformTo: string[] = [];
  for (const track of spec.tracks) {
    const a = resolveEndpoint(track.from, params);
    const b = resolveEndpoint(track.to, params);
    if (TRANSFORM_ORDER.includes(track.property)) {
      const unit = TRANSFORM_UNIT[track.property]!;
      transformFrom.push(`${track.property}(${a}${unit})`);
      transformTo.push(`${track.property}(${b}${unit})`);
    } else {
      from[track.property] = String(a);
      to[track.property] = String(b);
    }
  }
  if (transformFrom.length) {
    from.transform = transformFrom.join(" ");
    to.transform = transformTo.join(" ");
  }
  const durationSec = spec.durationSec ?? springSettleSec(spring);
  return {
    name: spec.name,
    purpose: spec.purpose,
    durationMs: Math.round(durationSec * 1000),
    easing: springLinearEasing(spring),
    easeSamples: springSamples(spring),
    spring,
    yoyo: spec.yoyo ?? false,
    from,
    to,
  };
}

/* ------------------------------------------------- GSAP-shaped compile */

/** Track property → GSAP tween key (transform channels use GSAP shorthands). */
const GSAP_KEY: Record<string, string> = {
  translateX: "x",
  translateY: "y",
  rotate: "rotation",
  scale: "scale",
  opacity: "opacity",
};

export interface CompiledAssetAnimationGsapV1 {
  name: string;
  /** ONE forward leg in seconds (a yoyo move plays it there and back). */
  legSec: number;
  yoyo: boolean;
  /** Normalized spring ease samples (linear-interpolated by the runtime). */
  ease: number[];
  /** GSAP var maps — numbers for transform/opacity, strings for custom props. */
  from: Record<string, number | string>;
  to: Record<string, number | string>;
  /** Custom-prop from-values to write inline pre-beat (preBeat:"from" only). */
  preBeat?: Record<string, string>;
}

/**
 * Compile one animation into the film runtime's shape: decomposed GSAP vars
 * (never a monolithic transform string — GSAP owns composition order), the
 * spring's sampled ease, and the pre-beat custom-prop writes. Pure function of
 * (spec, coerced params) — byte-stable island JSON on every pass.
 */
export function compileAssetAnimationGsap(
  spec: AssetAnimationSpecV1,
  params: Record<string, string | number>,
): CompiledAssetAnimationGsapV1 {
  const spring = resolveSpring(spec.spring);
  const from: Record<string, number | string> = {};
  const to: Record<string, number | string> = {};
  const preBeat: Record<string, string> = {};
  for (const track of spec.tracks) {
    const a = resolveEndpoint(track.from, params);
    const b = resolveEndpoint(track.to, params);
    if (track.property.startsWith("--")) {
      from[track.property] = String(a);
      to[track.property] = String(b);
      if (spec.preBeat === "from") preBeat[track.property] = String(a);
    } else {
      const key = GSAP_KEY[track.property]!;
      from[key] = a;
      to[key] = b;
    }
  }
  return {
    name: spec.name,
    legSec: Math.round((spec.durationSec ?? springSettleSec(spring)) * 1000) / 1000,
    yoyo: spec.yoyo ?? false,
    ease: springSamples(spring),
    from,
    to,
    ...(Object.keys(preBeat).length ? { preBeat } : {}),
  };
}

/**
 * Total in-film seconds one invocation occupies (a yoyo plays there and back)
 * — the beat window the paperwork declares and the runtime honors.
 */
export function assetAnimationTotalSec(
  spec: AssetAnimationSpecV1,
): number {
  const legSec = spec.durationSec ?? springSettleSec(resolveSpring(spec.spring));
  return Math.round(legSec * (spec.yoyo ? 2 : 1) * 100) / 100;
}

/* ------------------------------------------------------- plugin bridge */

function toPluginParam(spec: AssetParamSpecV1): PluginParamSpec {
  const base = { name: spec.name, description: spec.description, default: spec.default };
  switch (spec.kind) {
    case "color":
      return { ...base, kind: "text", maxChars: 32 };
    case "text":
      return { ...base, kind: "text", ...(spec.maxChars ? { maxChars: spec.maxChars } : {}) };
    case "number":
      return {
        ...base,
        kind: "number",
        ...(spec.min !== undefined ? { min: spec.min } : {}),
        ...(spec.max !== undefined ? { max: spec.max } : {}),
      };
    case "enum":
      return { ...base, kind: "enum", options: [...(spec.options ?? [])] };
  }
}

function planningLine(definition: AssetDefinitionV1): string {
  const params = definition.params
    .map((spec) => {
      if (spec.kind === "enum") return `${spec.name}=${(spec.options ?? []).join("|")}`;
      if (spec.kind === "number") return `${spec.name}=${spec.min ?? 0}..${spec.max ?? 100}`;
      if (spec.kind === "color") return `${spec.name}=hex color`;
      return `${spec.name}="${spec.default}"-style copy`;
    })
    .join(", ");
  return `- "asset-${definition.id}": ${definition.purpose} (pre-built ${definition.family}; params: ${params})`;
}

/** Gap between the entrance settling and the first payoff firing. */
const PAYOFF_GAP_SEC = 0.15;

/**
 * Ride the plugin rails: each library asset becomes a `asset-<id>` plugin
 * kind, so declarations get the SAME governance (default/clamp/drop, per-film
 * budget, strip-and-reinject byte-identical injection) with zero new gate
 * machinery. The lowering contributes ONE internal `asset`-kind component for
 * the unit root plus host-derived typed `animate` beats — the asset's declared
 * `enter` animation at the shared entrance anchor (camera-arrival aware), then
 * each `payoff` animation in sequence. Those beats ride scene.beats like any
 * other typed beat, so pacing / motion density / moments / complexity budgets
 * all judge them, while the spring motion itself is compiled by the host asset
 * runtime (`sequences-assets.v1.js`) — never authored, never linear.
 */
export function assetPluginSpecs(library: AssetDefinitionV1[]): PluginSpec[] {
  return library.map((definition) => ({
    kind: `asset-${definition.id}`,
    purpose: `${definition.purpose} (pre-built asset — declare, never draw)`,
    params: definition.params.map(toPluginParam),
    planningLine: planningLine(definition),
    style: definition.style,
    lower: (ctx: PluginLowerContext): PluginLowering => {
      const corePart = `${ctx.id}-core`;
      const instance = renderAssetInstance(definition, ctx.params, {
        partId: corePart,
      });
      const components: SceneComponentSpecV1[] = [
        { version: 1, id: corePart, kind: "asset", pluginUid: ctx.uid },
      ];
      const sceneEnd = ctx.startSec + ctx.durationSec;
      const clampAt = (value: number): number =>
        Math.round(
          Math.min(Math.max(value, ctx.startSec), Math.max(ctx.startSec, sceneEnd - 0.25)) * 1000,
        ) / 1000;
      const beats: ComponentBeatIntentV1[] = [];
      let cursor = entranceAnchorSec(ctx);
      const emit = (animation: AssetAnimationSpecV1): void => {
        const totalSec = assetAnimationTotalSec(animation);
        const atSec = clampAt(cursor);
        beats.push({
          version: 1,
          id: `${ctx.id}-b${beats.length + 1}`,
          sceneId: ctx.sceneId,
          component: corePart,
          kind: "animate",
          atSec,
          durationSec: Math.round(totalSec * 100) / 100,
          animation: animation.name,
        });
        cursor = atSec + totalSec + PAYOFF_GAP_SEC;
      };
      const enter = definition.animations.find((animation) => animation.trigger === "enter");
      if (enter) emit(enter);
      for (const payoff of definition.animations) {
        if (payoff.trigger === "payoff") emit(payoff);
      }
      return {
        components,
        beats,
        markup: instance.markup,
        wrapperStyle: "display:flex;align-items:center;justify-content:center",
      };
    },
  }));
}
