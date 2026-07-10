/**
 * Optional brand capture from a product URL — reuses HyperFrames' `capture`
 * palette/font extraction approach (the in-page token sweep from the vendored
 * cli/src/capture/tokenExtractor.ts), copied in here per the app isolation rule.
 *
 * This is the ONLY network/browser step in frame design, and it is strictly
 * best-effort: gated by SLACK_BRAND_CAPTURE (default on), hard-timed-out, and it
 * never throws into the create flow — on any failure the caller falls back to the
 * deterministic evidence-pack extraction. Rendering still does no network fetch;
 * captured brand tokens are baked into frame.md, not fetched at render time.
 */
import { findBrowserExecutable } from "./render.ts";
import { luminance, mapFontToEmbedded, saturation } from "./brandTokens.ts";

export interface CapturedBrand {
  /** All colours seen on the page, dominant-first (#RRGGBB). */
  colors: string[];
  /** The most likely brand accent (chromatic, used on interactive/repeated fills). */
  accent?: string;
  /** The page's dominant canvas/background colour. */
  background?: string;
  /** Brand fonts mapped to embedded families, display-likely first. */
  fonts: string[];
}

/**
 * The in-page extraction. Kept as a single string expression (no closures, no
 * imports) so it runs verbatim in the browser context — the same constraint the
 * upstream extractor documents (avoids tsx/esbuild __name injection). Focused on
 * colour stats + fonts, which is all frame design needs.
 */
const EXTRACT_BRAND = `(() => {
  function rgbToHex(color) {
    if (!color) return null;
    if (color[0] === '#') return (color.length === 4
      ? '#' + color[1]+color[1] + color[2]+color[2] + color[3]+color[3]
      : color).slice(0,7).toUpperCase();
    var m = color.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/);
    if (m) return '#' + ((1<<24) + (parseInt(m[1])<<16) + (parseInt(m[2])<<8) + parseInt(m[3])).toString(16).slice(1).toUpperCase();
    if (/oklch|oklab|lch|lab|hsla?|color/.test(color)) {
      try {
        var cvs = document.createElement('canvas'); cvs.width = 1; cvs.height = 1;
        var ctx = cvs.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0,0,1,1);
        var px = ctx.getImageData(0,0,1,1).data;
        if (px[3] > 0) return '#' + ((1<<24) + (px[0]<<16) + (px[1]<<8) + px[2]).toString(16).slice(1).toUpperCase();
      } catch(e) {}
    }
    return null;
  }
  // Fonts: loaded FontFaces + heading/body DOM sampling.
  var generic = ["serif","sans-serif","monospace","cursive","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded","emoji","math"];
  var fontOrder = [];
  function pushFont(name) {
    if (!name) return;
    name = name.replace(/['"]/g, "").trim();
    if (!name || generic.indexOf(name.toLowerCase()) !== -1) return;
    if (name.indexOf("Placeholder") !== -1 || name.indexOf("Fallback") !== -1) return;
    if (fontOrder.indexOf(name) === -1) fontOrder.push(name);
  }
  var heads = Array.from(document.querySelectorAll("h1,h2,h3")).slice(0, 20);
  for (var i = 0; i < heads.length; i++) { try { pushFont(getComputedStyle(heads[i]).fontFamily.split(",")[0]); } catch(e) {} }
  try { pushFont(getComputedStyle(document.body).fontFamily.split(",")[0]); } catch(e) {}
  var ps = Array.from(document.querySelectorAll("p,li,a,button")).slice(0, 40);
  for (var j = 0; j < ps.length; j++) { try { pushFont(getComputedStyle(ps[j]).fontFamily.split(",")[0]); } catch(e) {} }

  // Colour stats: distinguish brand fills (interactive/repeated) from canvas/text.
  var stats = {};
  function stat(hex) { if (!stats[hex]) stats[hex] = { bg: 0, interactive: 0, area: 0, text: 0 }; return stats[hex]; }
  var els = Array.from(document.querySelectorAll("*")).slice(0, 8000);
  for (var k = 0; k < els.length; k++) {
    try {
      var el = els[k]; var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var rect = el.getBoundingClientRect(); var area = rect.width * rect.height;
      var tag = el.tagName.toLowerCase(); var role = el.getAttribute("role") || ""; var cls = el.getAttribute("class") || "";
      var interactive = tag === "a" || tag === "button" || role === "button" || /\\b(btn|button|cta|primary|action)\\b/i.test(cls);
      var bg = cs.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        var h = rgbToHex(bg);
        if (h) { var s = stat(h); s.bg++; if (interactive) s.interactive++; if (area > 50000) s.area++; }
      }
      var col = cs.color;
      if (col && col !== "rgba(0, 0, 0, 0)") { var hc = rgbToHex(col); if (hc) stat(hc).text++; }
    } catch(e) {}
  }
  var canvasBg = null;
  try { canvasBg = rgbToHex(getComputedStyle(document.body).backgroundColor) || rgbToHex(getComputedStyle(document.documentElement).backgroundColor); } catch(e) {}
  var arr = Object.keys(stats).map(function(h){ var s = stats[h]; return { hex: h, score: s.bg + s.interactive*4 + s.text, interactive: s.interactive, area: s.area, bg: s.bg }; });
  arr.sort(function(a,b){ return b.score - a.score; });
  return { fonts: fontOrder.slice(0, 8), colorStats: arr.slice(0, 40), canvasBg: canvasBg };
})()`;

interface RawCapture {
  fonts: string[];
  colorStats: Array<{ hex: string; score: number; interactive: number; area: number; bg: number }>;
  canvasBg: string | null;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Capture brand colours + fonts from a URL. Returns `null` (never throws) when
 * capture is disabled, the URL is unusable, no browser is available, or anything
 * times out — the caller then uses evidence-pack extraction alone.
 */
export async function captureBrandFromUrl(url: string, timeoutMs = 20_000): Promise<CapturedBrand | null> {
  if (process.env.SLACK_BRAND_CAPTURE === "0") return null;
  if (!url || !isHttpUrl(url)) return null;
  const browserPath = findBrowserExecutable();
  if (!browserPath) return null;

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
    await page.setViewport({ width: 1440, height: 900 });
    const raw = await Promise.race([
      (async (): Promise<RawCapture> => {
        await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
        await page.evaluate("new Promise(r => setTimeout(r, 400))");
        return (await page.evaluate(EXTRACT_BRAND)) as RawCapture;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("brand capture timed out")), timeoutMs + 5_000),
      ),
    ]);
    return shape(raw);
  } catch (error) {
    process.stderr.write(`[frame] brand capture skipped: ${String(error)}\n`);
    return null;
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
}

function shape(raw: RawCapture): CapturedBrand {
  const fonts = raw.fonts
    .map((f) => mapFontToEmbedded(f))
    .filter((f): f is string => Boolean(f));
  const dedupedFonts = [...new Set(fonts)];

  // Accent: the highest-scoring chromatic colour that shows up on interactive
  // fills — the brand button colour, not the canvas or body text.
  const accentEntry = raw.colorStats
    .filter((c) => saturation(c.hex) >= 0.25 && luminance(c.hex) > 0.05 && luminance(c.hex) < 0.95)
    .sort((a, b) => (b.interactive - a.interactive) || (b.score - a.score))[0];

  return {
    colors: raw.colorStats.map((c) => c.hex),
    accent: accentEntry?.hex,
    background: raw.canvasBg ?? undefined,
    fonts: dedupedFonts,
  };
}
