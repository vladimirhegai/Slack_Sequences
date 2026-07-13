/**
 * Channel asset briefs — the `/sequences assets` intake (ASSETS.md workflow
 * step 2). A user runs `/sequences assets`, uploads UI screenshots in the
 * modal's file input (Slack slash commands themselves cannot carry files —
 * the modal `file_input` block is the native path), and adds optional notes.
 * The host extracts palette evidence deterministically, stores one brief per
 * channel, and gives the approved screenshots to a dedicated Luna turn that
 * authors a reusable, host-validated code-native UI pack. Every subsequent
 * `/sequences` create receives both the brief and that exact accepted pack.
 *
 * Deliberate boundaries:
 * - one brief per channel, replaced on re-run, removed by `/sequences assets
 *   clear` — nothing else from the channel is ever stored;
 * - screenshots remain visual evidence, never executable instructions;
 * - palette and UI-pack authoring are best-effort enrichments: an ordinary
 *   create can synthesize its own local UI system when either is unavailable.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "./engine/projectTemplates.ts";
import { findBrowserExecutable } from "./engine/render.ts";
import { luminance, saturation } from "./engine/brandTokens.ts";
import { renderAssetInstance } from "./engine/assetContract.ts";
import { assetsEnabled } from "./engine/sentinelFlags.ts";
import { ASSET_LIBRARY } from "./engine/assets/index.ts";

export interface AssetBriefPalette {
  accent?: string;
  background?: string;
  /** Dominant colors, most-covered first (#RRGGBB). */
  colors: string[];
}

export interface ChannelAssetBrief {
  version: 1;
  channel: string;
  userId?: string;
  notes?: string;
  palette: AssetBriefPalette;
  /** Stored reference screenshots (operator diagnostics; never re-shared). */
  refs: string[];
  imageCount: number;
  /** Latest host-validated, versioned Luna UI pack for this channel. */
  assetPack?: ChannelLunaAssetPackReceiptV1;
  createdAt: string;
}

export interface ChannelLunaAssetPackReceiptV1 {
  version: 1;
  id: string;
  /** Relative to assetPacksRoot(); never an arbitrary host path. */
  storageKey: string;
  /** Relative evidence run holding the accepted deliverables. */
  latestRunDir: string;
  fingerprint: string;
  materializedFingerprint: string;
  workerJobId: string;
  workerRunCount: number;
  threadId: string;
  createdAt: string;
}

export interface ReservedLunaAssetPack {
  id: string;
  storageKey: string;
  projectDir: string;
}

export interface PreparedLunaAssetPack {
  deliverablesDir: string;
  approvedRoot: string;
  receipt: ChannelLunaAssetPackReceiptV1;
}

/* ----------------------------------------------------------------- store */

function briefsFile(): string {
  return path.join(dataDir(), "asset-briefs.json");
}

function refsDir(channel: string): string {
  return path.join(assetBriefReferencesRoot(), channel.replace(/[^\w-]/g, "_"));
}

function safeChannel(channel: string): string {
  return channel.replace(/[^\w-]/g, "_") || "channel";
}

/** The only host filesystem root whose regular files may enter a Luna job. */
export function assetBriefReferencesRoot(): string {
  return path.join(dataDir(), "asset-briefs");
}

/** Separate allowlisted root for model-authored, host-validated UI packs. */
export function assetPacksRoot(): string {
  return path.join(dataDir(), "asset-packs");
}

export function reserveLunaAssetPack(channel: string): ReservedLunaAssetPack {
  const id = randomUUID();
  const storageKey = `${safeChannel(channel)}/${id}`;
  const projectDir = path.join(assetPacksRoot(), ...storageKey.split("/"));
  fs.mkdirSync(projectDir, { recursive: true });
  return { id, storageKey, projectDir };
}

function strictChild(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve a stored pack only through its host-issued relative receipt. */
export function preparedLunaAssetPack(
  brief: ChannelAssetBrief,
): PreparedLunaAssetPack | undefined {
  const receipt = brief.assetPack;
  if (!receipt || receipt.version !== 1) return undefined;
  const root = path.resolve(assetPacksRoot());
  const projectDir = path.resolve(root, ...receipt.storageKey.split("/"));
  if (!strictChild(root, projectDir) || !fs.existsSync(projectDir)) return undefined;
  const projectInfo = fs.lstatSync(projectDir);
  if (!projectInfo.isDirectory() || projectInfo.isSymbolicLink()) return undefined;
  const runDir = path.resolve(projectDir, ...receipt.latestRunDir.replace(/\\/g, "/").split("/"));
  if (!strictChild(projectDir, runDir) || !fs.existsSync(runDir)) return undefined;
  const deliverablesDir = path.join(runDir, "deliverables");
  if (!fs.existsSync(deliverablesDir)) return undefined;
  const deliverablesInfo = fs.lstatSync(deliverablesDir);
  if (!deliverablesInfo.isDirectory() || deliverablesInfo.isSymbolicLink()) return undefined;
  return { deliverablesDir, approvedRoot: root, receipt };
}

function readAll(): Record<string, ChannelAssetBrief> {
  const file = briefsFile();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, ChannelAssetBrief>;
  } catch {
    return {};
  }
}

function writeAll(briefs: Record<string, ChannelAssetBrief>): void {
  const file = briefsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(briefs, null, 2) + "\n");
}

export function loadAssetBrief(channel: string): ChannelAssetBrief | undefined {
  return readAll()[channel];
}

export function saveAssetBrief(brief: ChannelAssetBrief): void {
  const briefs = readAll();
  briefs[brief.channel] = brief;
  writeAll(briefs);
}

export function clearAssetBrief(channel: string): boolean {
  const briefs = readAll();
  if (!briefs[channel]) return false;
  delete briefs[channel];
  writeAll(briefs);
  fs.rmSync(refsDir(channel), { recursive: true, force: true });
  fs.rmSync(path.join(assetPacksRoot(), safeChannel(channel)), { recursive: true, force: true });
  return true;
}

/** Persist the raw screenshots beside the brief for operator diagnosis. */
export function storeReferenceImages(
  channel: string,
  images: Array<{ name: string; buffer: Buffer }>,
): string[] {
  const dir = refsDir(channel);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return images.map((image, index) => {
    const safe = image.name.replace(/[^\w.-]/g, "_").slice(0, 60) || `ref-${index + 1}.png`;
    const file = path.join(dir, `${String(index + 1).padStart(2, "0")}-${safe}`);
    fs.writeFileSync(file, image.buffer);
    return file;
  });
}

/* ------------------------------------------------------- palette extraction */

/**
 * In-page sampler (single string expression — the brandCapture discipline, no
 * closures for the tsx `__name` landmine): draw the image at ~96px, quantize
 * each channel to 16 levels, and histogram the buckets with a running average
 * so each bucket reports a representative real color, not the bucket corner.
 */
const SAMPLE_IMAGE = `(async (dataUri) => {
  const img = new Image();
  img.src = dataUri;
  await img.decode();
  const scale = Math.min(1, 96 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const buckets = {};
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = (data[i] >> 4) + '-' + (data[i + 1] >> 4) + '-' + (data[i + 2] >> 4);
    const b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
    b.n += 1; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
  }
  const total = Object.values(buckets).reduce((sum, b) => sum + b.n, 0) || 1;
  return Object.values(buckets)
    .map((b) => ({
      hex: '#' + ((1 << 24) + ((Math.round(b.r / b.n)) << 16) + ((Math.round(b.g / b.n)) << 8) + Math.round(b.b / b.n)).toString(16).slice(1).toUpperCase(),
      share: b.n / total,
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 24);
})`;

interface ColorShare {
  hex: string;
  share: number;
}

/**
 * Deterministic palette from screenshot bytes. Returns null (never throws)
 * without a browser — the caller stores the brief with notes only.
 */
export async function extractPaletteFromImages(
  images: Array<{ buffer: Buffer; mimetype: string }>,
  timeoutMs = 30_000,
): Promise<AssetBriefPalette | null> {
  const browserPath = findBrowserExecutable();
  if (!browserPath || !images.length) return null;
  let launch: typeof import("./engine/browserLifecycle.ts").launchHeadlessBrowser;
  try {
    ({ launchHeadlessBrowser: launch } = await import("./engine/browserLifecycle.ts"));
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
    const merged = new Map<string, number>();
    await Promise.race([
      (async () => {
        for (const image of images) {
          const dataUri = `data:${image.mimetype};base64,${image.buffer.toString("base64")}`;
          const shares = (await page.evaluate(
            `${SAMPLE_IMAGE}(${JSON.stringify(dataUri)})`,
          )) as ColorShare[];
          for (const entry of shares) {
            merged.set(entry.hex, (merged.get(entry.hex) ?? 0) + entry.share / images.length);
          }
        }
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("palette extraction timed out")), timeoutMs),
      ),
    ]);
    const ranked = [...merged.entries()]
      .map(([hex, share]) => ({ hex, share }))
      .sort((a, b) => b.share - a.share);
    if (!ranked.length) return null;
    // Background: the most-covered color (product canvases dominate area).
    // Accent: the most-covered CHROMATIC color that isn't near-canvas — the
    // brand's interactive hue, judged by coverage since screenshots carry no
    // interactivity signal (the brandCapture heuristic's static analogue).
    const background = ranked[0]!.hex;
    const accent = ranked.find(
      (entry) =>
        saturation(entry.hex) >= 0.25 &&
        luminance(entry.hex) > 0.08 &&
        luminance(entry.hex) < 0.92 &&
        entry.share >= 0.004,
    )?.hex;
    return {
      ...(accent ? { accent } : {}),
      background,
      colors: ranked.slice(0, 8).map((entry) => entry.hex),
    };
  } catch (error) {
    process.stderr.write(`[asset-brief] palette extraction skipped: ${String(error)}\n`);
    return null;
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
}

/* ----------------------------------------------------------- brief → create */

/**
 * The context block appended to every subsequent create in the channel. Plain
 * prose the concept/frame/storyboard stages already know how to honor —
 * committed brand truth outranks inferred defaults in frame design.
 */
export function assetBriefContext(brief: ChannelAssetBrief): string {
  const lines = [
    "Brand truth captured from the user's own UI screenshots (`/sequences assets`) — " +
      "honor these over inferred defaults:",
  ];
  if (brief.palette.accent) {
    lines.push(
      `- Observed accent color: ${brief.palette.accent}. Treat it as evidence, not a quota; ` +
        "use supporting colors when the captured UI or story needs them.",
    );
  }
  if (brief.palette.background) {
    const tone = luminance(brief.palette.background) < 0.5 ? "dark" : "light";
    lines.push(
      `- Product canvas: ${brief.palette.background} (${tone} UI). Keep the film's world in this temperature.`,
    );
  }
  if (brief.palette.colors.length > 2) {
    lines.push(`- Supporting palette seen in the product: ${brief.palette.colors.slice(0, 6).join(", ")}.`);
  }
  if (brief.notes) lines.push(`- The user's own notes about their product/UI: ${brief.notes}`);
  if (brief.assetPack) {
    lines.push(
      `- A validated Luna UI pack (${brief.assetPack.id}) is attached separately with reusable ` +
        "component states and stable motion hooks.",
    );
  }
  return lines.join("\n");
}

/* ------------------------------------------------------ brief → asset offer */

/** The hero set almost every launch brief can use — offered when notes add nothing. */
const DEFAULT_ASSET_OFFER = ["glass-metric", "browser-hero", "cta-button", "laurel-badge"];

/** Note-keyword nudges: a brief that names the concept outranks a default slot. */
const NOTE_ASSET_HINTS: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /\b(team|avatar|collab)/i, id: "team-medallion" },
  { pattern: /\b(rating|review|stars)/i, id: "rating-strip" },
  { pattern: /\b(shortcut|keyboard|hotkey)/i, id: "key-combo" },
  { pattern: /\b(pipeline|workflow|deploy|automat)/i, id: "flow-node" },
  { pattern: /\b(notif|alert|inbox|unread)/i, id: "notify-gem" },
  { pattern: /\b(trend|spark|chart|graph)/i, id: "spark-card" },
];

/**
 * The declare-by-default asset offer appended to a create's context when the
 * channel captured a brand brief AND the asset library rides the plugin rails
 * (`SLACK_SEQUENCES_ASSETS=1`). Mirrors the recipe offer's posture: declaring
 * the matching pre-built asset is the DEFAULT, dropping it is allowed, and the
 * gate never loosens — the planner may decline every one. The brief's accent
 * is prefilled so the declaration lands already on-brand.
 */
export function assetBriefPlanningOffer(brief: ChannelAssetBrief): string {
  if (!assetsEnabled()) return "";
  const picked: string[] = [];
  for (const hint of NOTE_ASSET_HINTS) {
    if (picked.length >= 4) break;
    if (hint.pattern.test(brief.notes ?? "") && !picked.includes(hint.id)) picked.push(hint.id);
  }
  for (const id of DEFAULT_ASSET_OFFER) {
    if (picked.length >= 4) break;
    if (!picked.includes(id)) picked.push(id);
  }
  const byId = new Map(ASSET_LIBRARY.map((asset) => [asset.id, asset]));
  const offered = picked.flatMap((id) => byId.get(id) ?? []);
  if (!offered.length) return "";
  const accent = brief.palette.accent;
  const example = JSON.stringify({
    version: 1,
    kind: `asset-${offered[0]!.id}`,
    id: "hero",
    params: [
      ...(accent ? [{ name: "accent", value: accent }] : []),
      { name: "label", value: "on-topic copy" },
    ],
  });
  return [
    "Pre-built brand assets for this channel (host-drawn hero visuals — DECLARE, never draw):",
    "these assets already render in the captured palette; when a scene needs the matching",
    "hero visual, declaring it is the DEFAULT — the host draws and spring-animates it at",
    "zero authoring cost. Fitting kinds for this brief:",
    ...offered.map((asset) => `- "asset-${asset.id}": ${asset.purpose}`),
    `Declare inside the shot's "plugins" array, e.g. "plugins":[${example}]`,
    ...(accent ? [`Set each asset's "accent" param to ${accent} (the captured brand accent).`] : []),
    "Fill text params with on-topic copy from the brief — never placeholders. Drop an",
    "asset only when it genuinely conflicts with the scene.",
  ].join("\n");
}

/* ------------------------------------------------------------ preview PNG */

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number): number =>
    Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return (
    "#" +
    ((1 << 24) + (channel(16) << 16) + (channel(8) << 8) + channel(0)).toString(16).slice(1)
  );
}

/**
 * Render the asset library themed with the captured palette to one PNG strip —
 * the "gives pictures back" step, so the user sees their brand on the
 * pre-built assets before any film run. Best-effort: null without a browser.
 */
export async function renderAssetBriefPreview(
  brief: ChannelAssetBrief,
  timeoutMs = 30_000,
): Promise<string | null> {
  const browserPath = findBrowserExecutable();
  if (!browserPath) return null;
  const background = brief.palette.background ?? "#0a0c10";
  const dark = luminance(background) < 0.5;
  const tokens = {
    canvas: background,
    surface: mixHex(background, dark ? "#ffffff" : "#000000", 0.06),
    text: dark ? "#edf0f6" : "#1c1e22",
    muted: dark ? "#9aa5b4" : "#6b7280",
    accent: brief.palette.accent ?? "#6ea8ff",
  };
  const instances = ASSET_LIBRARY.map((asset, index) =>
    renderAssetInstance(asset, {}, { partId: `preview-${index + 1}` }),
  );
  const styles = [...new Map(instances.map((entry) => [entry.styleId, entry.style])).values()];
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `:root{--canvas:${tokens.canvas};--surface:${tokens.surface};--text:${tokens.text};` +
    `--muted:${tokens.muted};--accent:${tokens.accent}}` +
    `body{margin:0;display:flex;gap:56px;align-items:center;justify-content:center;` +
    `padding:56px;background:${tokens.canvas};font-family:system-ui,sans-serif}` +
    `${styles.join("\n")}</style></head><body>` +
    instances.map((entry) => entry.markup).join("") +
    `</body></html>`;
  let launch: typeof import("./engine/browserLifecycle.ts").launchHeadlessBrowser;
  try {
    ({ launchHeadlessBrowser: launch } = await import("./engine/browserLifecycle.ts"));
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
    await page.setViewport({ width: 960, height: 480, deviceScaleFactor: 2 });
    await Promise.race([
      page.setContent(html, { waitUntil: "load" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("preview render timed out")), timeoutMs),
      ),
    ]);
    const file = path.join(refsDir(brief.channel), "asset-preview.png");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file as `${string}.png`, fullPage: true });
    return file;
  } catch (error) {
    process.stderr.write(`[asset-brief] preview render skipped: ${String(error)}\n`);
    return null;
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
}
