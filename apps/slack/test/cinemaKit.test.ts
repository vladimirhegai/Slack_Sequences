import { describe, expect, it } from "vitest";
import {
  CINEMA_KIT_STYLE_ID,
  cinemaKitSource,
  cinemaKitStyleTag,
  hasCinemaKit,
  injectCinemaKit,
} from "../src/engine/cinemaKit.ts";

const DOC = `<!doctype html>
<html><head>
<script src="gsap.min.js"></script>
<style>#root { color: red; }</style>
</head><body><main id="root" data-composition-id="x"></main></body></html>`;

describe("cinemaKitSource", () => {
  it("ships the full lighting vocabulary", () => {
    const css = cinemaKitSource();
    for (const selector of [
      "[data-composition-id]::after",
      ".keylight",
      ".bloom",
      ".material",
      ".material-hero",
      ".material-chrome",
      ".inset-well",
      ".grade-cold",
      ".grade-warm",
      ".grade-neutral",
      ".grade-noir",
      ".cinema-light",
    ]) {
      expect(css).toContain(selector);
    }
  });

  it("stays deterministic and network-free", () => {
    const css = cinemaKitSource();
    // Only the inline SVG xmlns identifier may look like a URL; no url() may
    // reference the network.
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
    expect(css.replace(/data:image\/svg\+xml[^")]*/g, "")).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/@keyframes|\banimation\s*:|\btransition\s*:/);
    // The grain SVG must carry a fixed feTurbulence seed.
    expect(css).toContain("seed='7'");
  });
});

describe("injectCinemaKit", () => {
  it("injects before the first authored style so authored rules win", () => {
    const html = injectCinemaKit(DOC);
    expect(hasCinemaKit(html)).toBe(true);
    expect(html.indexOf(`id="${CINEMA_KIT_STYLE_ID}"`)).toBeLessThan(
      html.indexOf("#root { color: red; }"),
    );
  });

  it("is idempotent", () => {
    const once = injectCinemaKit(DOC);
    expect(injectCinemaKit(once)).toBe(once);
  });

  it("replaces a stale or hand-written kit block with the canonical source", () => {
    const stale = DOC.replace(
      "<style>",
      `<style id="${CINEMA_KIT_STYLE_ID}">.material { all: unset; }</style><style>`,
    );
    const html = injectCinemaKit(stale);
    expect(html).not.toContain("all: unset");
    expect(html).toContain(cinemaKitStyleTag());
  });

  it("falls back to </head> when no style tag exists", () => {
    const bare = "<!doctype html><html><head></head><body></body></html>";
    const html = injectCinemaKit(bare);
    expect(hasCinemaKit(html)).toBe(true);
    expect(html.indexOf(`id="${CINEMA_KIT_STYLE_ID}"`)).toBeLessThan(html.indexOf("</head>"));
  });
});
