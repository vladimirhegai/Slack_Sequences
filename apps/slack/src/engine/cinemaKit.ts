/**
 * Host-owned cinematography kit.
 *
 * `sequences-cinema.v1.css` gives every direct composition a lighting model:
 * automatic film grain + vignette on the composition root, key-light fields,
 * hero bloom, lit material surfaces, and per-scene color grades that form the
 * film's color arc. The host injects it as an inline `<style id="sequences-cinema">`
 * block — exactly like the cut/interaction runtimes it is versioned, injected
 * deterministically, and costs the author zero output budget — but unlike
 * those runtimes it is pure static CSS: no timeline ownership, no bindings to
 * validate, enhancement-only. Inlining (rather than a `<link>`) keeps the
 * composition self-contained and immune to static-server MIME quirks across
 * QA, thumbnails, and the render producer.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CINEMA_KIT_VERSION = 1;
export const CINEMA_KIT_FILE = "sequences-cinema.v1.css";
export const CINEMA_KIT_STYLE_ID = "sequences-cinema";

const KIT_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
  CINEMA_KIT_FILE,
);

export function cinemaKitSource(): string {
  return fs.readFileSync(KIT_SOURCE_PATH, "utf8");
}

export function cinemaKitHash(): string {
  return createHash("sha256").update(cinemaKitSource()).digest("hex");
}

export function cinemaKitStyleTag(): string {
  return `<style id="${CINEMA_KIT_STYLE_ID}" data-version="${CINEMA_KIT_VERSION}">\n${cinemaKitSource()}</style>`;
}

const STYLE_BLOCK = new RegExp(
  `<style\\b[^>]*\\bid\\s*=\\s*(["'])${CINEMA_KIT_STYLE_ID}\\1[^>]*>[\\s\\S]*?</style>`,
  "i",
);

export function hasCinemaKit(html: string): boolean {
  return STYLE_BLOCK.test(html);
}

/**
 * Inject (or refresh to canonical) the kit style block before the first
 * authored <style> so authored rules can override kit defaults, falling back
 * to </head>. Idempotent; an authored/stale block is replaced verbatim.
 */
export function injectCinemaKit(html: string): string {
  if (STYLE_BLOCK.test(html)) {
    return html.replace(STYLE_BLOCK, cinemaKitStyleTag().replace(/\$/g, "$$$$"));
  }
  const tag = cinemaKitStyleTag();
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
