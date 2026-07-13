import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";
import { findBrowserExecutable } from "./render.ts";
import { resolveFeatureFlag, type SlackSequencesEnvSource } from "./featureFlags.ts";

export const LUNA_ASSET_PACK_CONTRACT = Object.freeze({
  id: "sequences-luna-ui-pack-v1",
  requiredPaths: [
    "deliverables/asset-pack.json",
    "deliverables/ui-kit.html",
    "deliverables/assets-manifest.json",
  ],
});

const PACK_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
  "img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; " +
  "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_ASSET_PATH = /^assets\/luna\/[A-Za-z0-9._/-]+$/;
const MEDIA_TYPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
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

export interface LunaAssetPackPartV1 {
  id: string;
  selector: string;
  purpose: string;
  morphAnchor?: boolean;
}

export interface LunaAssetPackStateV1 {
  id: string;
  description: string;
}

/** A named fill point ("prop") the film supplies when it instantiates the component. */
export interface LunaAssetPackSlotV1 {
  id: string;
  selector: string;
  kind: "text" | "number" | "image";
}

/** A bounded enumerated parameter the film selects when it invokes the component. */
export interface LunaAssetPackVariantV1 {
  id: string;
  values: string[];
}

/** A first-class morph pair: this component can hand off to `component`, carrying `sharedParts`. */
export interface LunaAssetPackMorphTargetV1 {
  component: string;
  sharedParts?: string[];
}

export interface LunaAssetPackComponentV1 {
  id: string;
  purpose: string;
  rootSelector: string;
  /** Attribute on the root whose value selects the current state (default `data-state`). */
  stateAttribute?: string;
  states: LunaAssetPackStateV1[];
  parts: LunaAssetPackPartV1[];
  slots?: LunaAssetPackSlotV1[];
  variants?: LunaAssetPackVariantV1[];
  morphTargets?: LunaAssetPackMorphTargetV1[];
  interactions?: Array<Record<string, unknown>>;
}

export interface LunaAssetPackV1 {
  version: 1;
  name: string;
  visualThesis: string;
  tokens: Record<string, string | number>;
  components: LunaAssetPackComponentV1[];
  sourceEvidence?: string;
}

export interface ValidatedLunaAssetPack {
  pack: LunaAssetPackV1;
  html: string;
  assetManifest: string;
  fingerprint: string;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function required(files: ReadonlyMap<string, Buffer>, relative: string): Buffer {
  const bytes = files.get(`deliverables/${relative}`);
  if (!bytes) throw new Error(`Luna UI pack did not produce deliverables/${relative}`);
  return bytes;
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`Luna UI pack ${label} is invalid`);
  }
  return value.trim();
}

function selector(document: Document, value: unknown, label: string): string {
  const candidate = text(value, label, 160);
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(candidate);
  } catch {
    throw new Error(`Luna UI pack ${label} is not a valid selector`);
  }
  if (matches.length !== 1) {
    throw new Error(`Luna UI pack ${label} must match exactly one preview element`);
  }
  return candidate;
}

const SAFE_DATA_ATTR = /^data-[a-z][a-z0-9-]{0,40}$/;
const SLOT_KINDS = new Set(["text", "number", "image"]);

/**
 * Lenient bounded parse of an optional enrichment array. Absent/non-array
 * yields `[]`; each entry runs through `parse`, and any entry that returns null
 * or throws is silently dropped. Invokable/morph declarations are additive, so a
 * malformed optional entry must never hard-fail an otherwise-valid pack.
 */
function optionalList<T>(
  value: unknown,
  max: number,
  parse: (entry: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const raw of value) {
    if (out.length >= max) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    try {
      const parsed = parse(raw as Record<string, unknown>);
      if (parsed) out.push(parsed);
    } catch {
      // Drop a malformed optional entry rather than rejecting the whole pack.
    }
  }
  return out;
}

function validatePreviewSecurity(html: string): Document {
  if (Buffer.byteLength(html, "utf8") > 2_000_000) {
    throw new Error("Luna UI pack preview exceeds 2 MB");
  }
  const document = parseHTML(html).document;
  const policies = Array.from(document.head?.querySelectorAll<HTMLMetaElement>(
    'meta[http-equiv="Content-Security-Policy" i]',
  ) ?? []);
  const httpEquiv = Array.from(document.querySelectorAll<HTMLMetaElement>("meta[http-equiv]"));
  if (
    policies.length !== 1 ||
    httpEquiv.length !== 1 ||
    policies[0]!.getAttribute("content")?.replace(/\s+/g, " ").trim() !== PACK_CSP
  ) {
    throw new Error(
      "Luna UI pack preview must contain exactly one head-scoped exact local-only Content Security Policy",
    );
  }
  if (document.querySelector("script,iframe,object,embed,base,link,audio,video,source,form")) {
    throw new Error("Luna UI pack preview contains a forbidden executable, navigation, or media element");
  }
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        throw new Error("Luna UI pack preview contains an event handler");
      }
      if (["src", "href", "xlink:href"].includes(attribute.name.toLowerCase())) {
        const value = attribute.value.trim();
        if (value && !SAFE_ASSET_PATH.test(value)) {
          throw new Error(`Luna UI pack preview references a non-local resource: ${value.slice(0, 120)}`);
        }
      }
      if (
        ["srcset", "imagesrcset", "poster", "action", "formaction", "data", "cite", "background"]
          .includes(attribute.name.toLowerCase())
      ) {
        throw new Error(`Luna UI pack preview contains forbidden URL attribute ${attribute.name}`);
      }
    }
  }
  if (/@import\b|(?:-webkit-)?image-set\s*\(/i.test(html)) {
    throw new Error("Luna UI pack preview CSS contains an unsupported external-loading construct");
  }
  for (const match of html.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)) {
    if (!SAFE_ASSET_PATH.test(match[2]!)) {
      throw new Error(`Luna UI pack CSS references a non-local resource: ${match[2]!.slice(0, 120)}`);
    }
  }
  return document;
}

function validateSvg(bytes: Buffer): void {
  const source = bytes.toString("utf8");
  const hasExternalCssUrl = [...source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)]
    .some((match) => !match[2]!.trim().startsWith("#"));
  if (
    !/^\s*<svg\b/i.test(source) ||
    /<(?:script|foreignObject|image|animate|animateTransform|set)\b/i.test(source) ||
    /\son[a-z]+\s*=/i.test(source) ||
    /\b(?:href|xlink:href)\s*=\s*(["'])(?!#)[\s\S]*?\1/i.test(source) ||
    hasExternalCssUrl || /@import\b/i.test(source) ||
    /<!DOCTYPE|<!ENTITY/i.test(source)
  ) {
    throw new Error("Luna UI pack SVG contains active or external content");
  }
}

function validateAssets(
  files: ReadonlyMap<string, Buffer>,
  rawManifest: string,
  html: string,
): void {
  let manifest: unknown;
  try {
    manifest = JSON.parse(rawManifest);
  } catch {
    throw new Error("Luna UI pack assets-manifest.json is not valid JSON");
  }
  if (!Array.isArray(manifest)) {
    throw new Error("Luna UI pack assets-manifest.json must be an array");
  }
  const actual = [...files.keys()]
    .filter((name) => name.startsWith("deliverables/assets/luna/"))
    .sort();
  const declared = new Set<string>();
  for (const [index, raw] of manifest.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Luna UI pack asset manifest entry ${index + 1} is invalid`);
    }
    const entry = raw as Record<string, unknown>;
    const assetPath = text(entry.path, `asset manifest path ${index + 1}`, 180);
    if (!SAFE_ASSET_PATH.test(assetPath) || assetPath.includes("..") || declared.has(assetPath)) {
      throw new Error(`Luna UI pack asset manifest path ${index + 1} is unsafe or duplicated`);
    }
    declared.add(assetPath);
    text(entry.purpose, `asset manifest purpose ${index + 1}`, 500);
    if (entry.provenance !== "supplied" && entry.provenance !== "agent-created") {
      throw new Error(`Luna UI pack asset manifest provenance ${index + 1} is invalid`);
    }
    const extension = path.posix.extname(assetPath).toLowerCase();
    const allowedTypes = MEDIA_TYPES[extension];
    if (!allowedTypes || !allowedTypes.includes(String(entry.mediaType))) {
      throw new Error(`Luna UI pack asset manifest media type ${index + 1} is invalid`);
    }
    const bytes = files.get(`deliverables/${assetPath}`);
    if (!bytes) throw new Error(`Luna UI pack declared missing ${assetPath}`);
    if (entry.sha256 !== undefined && String(entry.sha256).toLowerCase() !== sha256(bytes)) {
      throw new Error(`Luna UI pack asset ${assetPath} failed its declared SHA-256`);
    }
    if (extension === ".svg") validateSvg(bytes);
    if (!html.includes(assetPath)) {
      throw new Error(`Luna UI pack asset ${assetPath} is not referenced by ui-kit.html`);
    }
  }
  const expected = [...declared].map((name) => `deliverables/${name}`).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Luna UI pack asset manifest does not exactly cover assets/luna");
  }
}

export function validateLunaAssetPack(
  files: ReadonlyMap<string, Buffer>,
  env: SlackSequencesEnvSource = process.env,
): ValidatedLunaAssetPack {
  const invokables =
    resolveFeatureFlag("SLACK_SEQUENCES_LUNA_ASSET_INVOKABLES", env).value === "on";
  const rawPack = required(files, "asset-pack.json").toString("utf8");
  const html = required(files, "ui-kit.html").toString("utf8");
  const assetManifest = required(files, "assets-manifest.json").toString("utf8");
  const document = validatePreviewSecurity(html);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPack);
  } catch {
    throw new Error("Luna UI pack asset-pack.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Luna UI pack asset-pack.json must be an object");
  }
  const value = parsed as Record<string, unknown>;
  if (value.version !== 1) throw new Error("Luna UI pack protocol version must be 1");
  const components = value.components;
  if (!Array.isArray(components) || !components.length || components.length > 24) {
    throw new Error("Luna UI pack must declare 1-24 components");
  }
  const componentIds = new Set<string>();
  const roots = new Set<string>();
  const normalizedComponents = components.map((raw, index): LunaAssetPackComponentV1 => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Luna UI pack component ${index + 1} is invalid`);
    }
    const component = raw as Record<string, unknown>;
    const id = text(component.id, `component ${index + 1} id`, 64);
    if (!SAFE_ID.test(id) || componentIds.has(id)) {
      throw new Error(`Luna UI pack component ${index + 1} has an unsafe or duplicate id`);
    }
    componentIds.add(id);
    const rootSelector = selector(document, component.rootSelector, `component ${id} rootSelector`);
    if (roots.has(rootSelector)) throw new Error(`Luna UI pack component root ${rootSelector} is duplicated`);
    roots.add(rootSelector);
    if (!Array.isArray(component.states) || !component.states.length || component.states.length > 12) {
      throw new Error(`Luna UI pack component ${id} must declare 1-12 states`);
    }
    const stateIds = new Set<string>();
    const states = component.states.map((rawState, stateIndex): LunaAssetPackStateV1 => {
      if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
        throw new Error(`Luna UI pack component ${id} state ${stateIndex + 1} is invalid`);
      }
      const state = rawState as Record<string, unknown>;
      const stateId = text(state.id, `component ${id} state id`, 64);
      if (!SAFE_ID.test(stateId) || stateIds.has(stateId)) {
        throw new Error(`Luna UI pack component ${id} has an unsafe or duplicate state id`);
      }
      stateIds.add(stateId);
      return { id: stateId, description: text(state.description, `component ${id} state description`) };
    });
    if (!Array.isArray(component.parts) || !component.parts.length || component.parts.length > 32) {
      throw new Error(`Luna UI pack component ${id} must declare 1-32 parts`);
    }
    const partIds = new Set<string>();
    const parts = component.parts.map((rawPart, partIndex): LunaAssetPackPartV1 => {
      if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) {
        throw new Error(`Luna UI pack component ${id} part ${partIndex + 1} is invalid`);
      }
      const part = rawPart as Record<string, unknown>;
      const partId = text(part.id, `component ${id} part id`, 64);
      if (!SAFE_ID.test(partId) || partIds.has(partId)) {
        throw new Error(`Luna UI pack component ${id} has an unsafe or duplicate part id`);
      }
      partIds.add(partId);
      return {
        id: partId,
        selector: selector(document, part.selector, `component ${id} part ${partId} selector`),
        purpose: text(part.purpose, `component ${id} part ${partId} purpose`),
        ...(part.morphAnchor === true ? { morphAnchor: true } : {}),
      };
    });
    if (
      component.interactions !== undefined &&
      (!Array.isArray(component.interactions) || component.interactions.length > 24 ||
        component.interactions.some((interaction) =>
          !interaction || typeof interaction !== "object" || Array.isArray(interaction)
        ))
    ) {
      throw new Error(`Luna UI pack component ${id} interactions are invalid`);
    }
    // Invokable surface (additive + lenient). States are invoked by setting the
    // declared attribute on the root; slots are fill points; variants are
    // bounded enum parameters. Morph pairs are resolved in a second pass below.
    const declaredStateAttribute = typeof component.stateAttribute === "string"
      ? component.stateAttribute.trim().toLowerCase()
      : "";
    const stateAttribute = SAFE_DATA_ATTR.test(declaredStateAttribute) ? declaredStateAttribute : "";
    const slotIds = new Set<string>();
    const slots = invokables
      ? optionalList<LunaAssetPackSlotV1>(component.slots, 16, (slot) => {
        const slotId = text(slot.id, `component ${id} slot id`, 64);
        if (!SAFE_ID.test(slotId) || slotIds.has(slotId) || !SLOT_KINDS.has(String(slot.kind))) {
          return null;
        }
        const slotSelector = selector(document, slot.selector, `component ${id} slot ${slotId} selector`);
        slotIds.add(slotId);
        return { id: slotId, selector: slotSelector, kind: slot.kind as LunaAssetPackSlotV1["kind"] };
      })
      : [];
    const variantIds = new Set<string>();
    const variants = invokables
      ? optionalList<LunaAssetPackVariantV1>(component.variants, 8, (variant) => {
        const variantId = text(variant.id, `component ${id} variant id`, 64);
        if (!SAFE_ID.test(variantId) || variantIds.has(variantId) || !Array.isArray(variant.values)) {
          return null;
        }
        const seen = new Set<string>();
        const values = variant.values
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => SAFE_ID.test(value) && !seen.has(value) && (seen.add(value), true))
          .slice(0, 8);
        if (!values.length) return null;
        variantIds.add(variantId);
        return { id: variantId, values };
      })
      : [];
    return {
      id,
      purpose: text(component.purpose, `component ${id} purpose`),
      rootSelector,
      ...(invokables && stateAttribute ? { stateAttribute } : {}),
      states,
      parts,
      ...(slots.length ? { slots } : {}),
      ...(variants.length ? { variants } : {}),
      ...(Array.isArray(component.interactions)
        ? { interactions: component.interactions as Array<Record<string, unknown>> }
        : {}),
    };
  });
  // Second pass: morph pairs can reference any component, so resolve them once
  // every id and its declared anchor parts are known. Lenient: an entry naming
  // an unknown/self target drops; anchor refs are filtered to real morph parts.
  if (invokables) {
    const anchorsByComponent = new Map(normalizedComponents.map((component) =>
      [component.id, new Set(component.parts.filter((part) => part.morphAnchor).map((part) => part.id))]
    ));
    normalizedComponents.forEach((component, index) => {
      const raw = components[index] as Record<string, unknown>;
      const anchors = anchorsByComponent.get(component.id) ?? new Set<string>();
      const morphTargets = optionalList<LunaAssetPackMorphTargetV1>(raw.morphTargets, 8, (target) => {
        const targetComponent = text(target.component, `component ${component.id} morph target`, 64);
        if (!componentIds.has(targetComponent) || targetComponent === component.id) return null;
        const sharedParts = Array.isArray(target.sharedParts)
          ? [...new Set(target.sharedParts
              .filter((part): part is string => typeof part === "string")
              .map((part) => part.trim())
              .filter((part) => anchors.has(part)))]
          : [];
        return { component: targetComponent, ...(sharedParts.length ? { sharedParts } : {}) };
      });
      if (morphTargets.length) component.morphTargets = morphTargets;
    });
  }
  validateAssets(files, assetManifest, html);
  const tokens = value.tokens;
  if (
    !tokens || typeof tokens !== "object" || Array.isArray(tokens) ||
    Object.keys(tokens).length > 128 ||
    Object.entries(tokens).some(([name, token]) =>
      !SAFE_ID.test(name) ||
      !(["string", "number"].includes(typeof token)) ||
      (typeof token === "string" && token.length > 500) ||
      (typeof token === "number" && !Number.isFinite(token))
    )
  ) {
    throw new Error("Luna UI pack tokens must be a bounded string/number map");
  }
  const pack: LunaAssetPackV1 = {
    version: 1,
    name: text(value.name, "name", 160),
    visualThesis: text(value.visualThesis, "visualThesis"),
    tokens: tokens as Record<string, string | number>,
    components: normalizedComponents,
    ...(typeof value.sourceEvidence === "string"
      ? { sourceEvidence: text(value.sourceEvidence, "sourceEvidence", 2_000) }
      : {}),
  };
  return {
    pack,
    html,
    assetManifest,
    fingerprint: sha256([
      `pack:${sha256(rawPack)}`,
      `html:${sha256(html)}`,
      `assets:${sha256(assetManifest)}`,
      ...[...files.entries()]
        .filter(([name]) => name.startsWith("deliverables/assets/luna/"))
        .map(([name, bytes]) => `${name}:${sha256(bytes)}`)
        .sort(),
    ].join("\n")),
  };
}

export async function renderLunaAssetPackPreview(
  deliverablesRoot: string,
  destination: string,
  timeoutMs = 30_000,
): Promise<string | null> {
  const browserPath = findBrowserExecutable();
  const htmlPath = path.join(deliverablesRoot, "ui-kit.html");
  if (!browserPath || !fs.existsSync(htmlPath)) return null;
  const root = path.resolve(deliverablesRoot);
  const bundle = new Map<string, Buffer>();
  const collect = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Luna UI pack preview directory contains a symbolic link");
      if (entry.isDirectory()) {
        collect(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (
        new Set(["asset-pack.json", "ui-kit.html", "assets-manifest.json"]).has(relative) ||
        relative.startsWith("assets/luna/")
      ) {
        bundle.set(`deliverables/${relative}`, fs.readFileSync(absolute));
      }
    }
  };
  collect(root);
  // Revalidate the exact on-disk bytes immediately before opening the model-
  // authored preview. Stored acceptance is evidence, not a perpetual trust bit.
  validateLunaAssetPack(bundle);
  let launch: typeof import("./browserLifecycle.ts").launchHeadlessBrowser;
  try {
    ({ launchHeadlessBrowser: launch } = await import("./browserLifecycle.ts"));
  } catch {
    return null;
  }
  let browser: import("puppeteer-core").Browser | undefined;
  try {
    browser = await launch({
      executablePath: browserPath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 2 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (isAllowedLunaAssetPackPreviewUrl(root, request.url())) {
        void request.continue().catch(() => undefined);
      } else {
        void request.abort("blockedbyclient").catch(() => undefined);
      }
    });
    const previewUrl = pathToFileURL(htmlPath).href;
    await Promise.race([
      page.goto(previewUrl, { waitUntil: "load" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Luna UI pack preview render timed out")), timeoutMs)
      ),
    ]);
    if (page.url() !== previewUrl) {
      throw new Error("Luna UI pack preview attempted to navigate away from its validated document");
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await page.screenshot({ path: destination as `${string}.png`, fullPage: false });
    return destination;
  } catch (error) {
    process.stderr.write(`[luna-asset-pack] preview render skipped: ${String(error)}\n`);
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Network boundary shared by the preview renderer and its negative tests. */
export function isAllowedLunaAssetPackPreviewUrl(
  deliverablesRoot: string,
  requestUrl: string,
): boolean {
  try {
    const parsed = new URL(requestUrl);
    if (parsed.protocol !== "file:") return false;
    const root = path.resolve(deliverablesRoot);
    const requested = path.resolve(fileURLToPath(parsed));
    const relative = path.relative(root, requested);
    return relative === "" || (
      relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}
