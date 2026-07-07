import { describe, expect, it } from "vitest";
import { EMBEDDED_FONTS } from "../src/engine/brandTokens.ts";
import {
  TYPE_SYSTEMS,
  pickTypeSystems,
  typeSystemById,
  typeSystemFamiliesAreEmbedded,
  typeSystemShortlist,
  typeSystemToFrameType,
} from "../src/engine/typeSystems.ts";

describe("type systems (integrated font-pairing, embedded-only)", () => {
  it("only names families the renderer actually embeds", () => {
    const embedded = new Set<string>(EMBEDDED_FONTS);
    for (const system of TYPE_SYSTEMS) {
      expect(embedded.has(system.display.family), `${system.id} display`).toBe(true);
      expect(embedded.has(system.body.family), `${system.id} body`).toBe(true);
      expect(embedded.has(system.mono.family), `${system.id} mono`).toBe(true);
      expect(system.display.weights.length).toBeGreaterThan(0);
    }
    expect(typeSystemFamiliesAreEmbedded()).toBe(true);
  });

  it("has unique ids and a real range of display faces", () => {
    const ids = TYPE_SYSTEMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const displays = new Set(TYPE_SYSTEMS.map((s) => s.display.family));
    // The roster must span several distinct display faces for the diversity guard.
    expect(displays.size).toBeGreaterThanOrEqual(5);
  });

  it("scores a brief toward the fitting system, deterministically", () => {
    const dev = pickTypeSystems("developer CLI, terminal, sub-100ms latency", 5);
    expect(dev[0]?.id).toBe("infra");
    const editorial = pickTypeSystems("a premium brand story, elegant magazine launch", 5);
    expect(editorial[0]?.id).toBe("editorial");
    // Same input → same shortlist.
    expect(pickTypeSystems("developer CLI, terminal", 5).map((s) => s.id)).toEqual(
      pickTypeSystems("developer CLI, terminal", 5).map((s) => s.id),
    );
  });

  it("honours the diversity guard — no two picks share a display face", () => {
    const picks = pickTypeSystems("bold techy startup launch", 5);
    const displays = picks.map((s) => s.display.family);
    expect(new Set(displays).size).toBe(displays.length);
  });

  it("returns a varied default order for an empty brief", () => {
    const picks = pickTypeSystems("", 5);
    expect(picks.length).toBe(5);
    expect(picks[0]?.id).toBe("signal");
  });

  it("word-boundary matches tags so 'ai' does not fire inside 'captain'", () => {
    const picks = pickTypeSystems("our captain steers the ship", 3);
    // "ai" (an 'infra'/'grotesk' tag) must not match inside "captain"; with no
    // real signal the roster order leads with the neutral default.
    expect(picks[0]?.id).toBe("signal");
  });

  it("projects a chosen system into an embedded FrameType", () => {
    const system = typeSystemById("editorial")!;
    const type = typeSystemToFrameType(system);
    expect(type.display).toBe("Playfair Display");
    expect(type.body).toBe("EB Garamond");
    expect(type.mono).toBe("JetBrains Mono");
    expect(type.note.length).toBeGreaterThan(0);
  });

  it("renders a compact shortlist line block for the prompt", () => {
    const block = typeSystemShortlist("fintech dashboard, trustworthy", 5);
    expect(block.split("\n").length).toBe(5);
    expect(block).toMatch(/^- \w+ \(/);
  });
});
