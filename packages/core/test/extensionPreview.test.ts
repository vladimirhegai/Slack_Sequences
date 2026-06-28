import { describe, expect, it } from "vitest";
import {
  ARCHETYPES,
  CAMERA_MOVES,
  compile,
  extensionPreviewProject,
  extensionDisplayTitle,
  PRIMITIVES,
  PROFILES,
} from "../src/index.ts";

describe("extension previews", () => {
  it("titleizes ids the way the extensions page does", () => {
    expect(extensionDisplayTitle("enter.fadeIn")).toBe("Fade In");
    expect(extensionDisplayTitle("logo-sting-cta")).toBe("Logo Sting CTA");
    expect(extensionDisplayTitle("crisp-saas")).toBe("Crisp SaaS");
    expect(extensionDisplayTitle("ui-walkthrough")).toBe("UI Walkthrough");
  });

  it("rejects unknown entries so the server can 404", () => {
    expect(() => extensionPreviewProject("primitive", "enter.nope")).toThrow();
    expect(() => extensionPreviewProject("archetype", "nope")).toThrow();
    // @ts-expect-error guard against an out-of-domain type at runtime too
    expect(() => extensionPreviewProject("bogus", "x")).toThrow();
  });

  it("compiles a live preview for every motion primitive that demos its phase", () => {
    for (const primitive of Object.values(PRIMITIVES)) {
      const project = extensionPreviewProject("primitive", primitive.id);
      const { manifest } = compile(project);
      expect(manifest.scenes).toHaveLength(1);
      const headline = manifest.scenes[0]!.layers.find((l) => l.id === "headline");
      expect(headline, `${primitive.id} headline`).toBeDefined();
      // The demoed primitive lands in the phase matching its kind.
      const phase =
        primitive.kind === "enter"
          ? headline!.enter
          : primitive.kind === "exit"
            ? headline!.exit
            : primitive.kind === "emphasis"
              ? headline!.emphasis
              : headline!.continuous;
      expect(phase?.primitive, `${primitive.id} phase`).toBe(primitive.id);
      // Headline text is the human label, e.g. "Fade In" for enter.fadeIn.
      expect(headline!.label).toBe(extensionDisplayTitle(primitive.id));
    }
  });

  it("compiles a populated preview for every archetype", () => {
    for (const archetype of Object.values(ARCHETYPES)) {
      const { manifest } = compile(extensionPreviewProject("archetype", archetype.id));
      expect(manifest.scenes[0]!.archetype).toBe(archetype.id);
      expect(manifest.scenes[0]!.layers.length).toBeGreaterThan(0);
    }
  });

  it("compiles a preview under every motion profile", () => {
    for (const profile of Object.values(PROFILES)) {
      const { manifest } = compile(extensionPreviewProject("profile", profile.id));
      expect(manifest.motionProfile).toBe(profile.id);
      expect(manifest.scenes[0]!.layers.length).toBeGreaterThan(0);
    }
  });

  it("compiles a visibly travelling preview for every camera move", () => {
    for (const move of Object.values(CAMERA_MOVES)) {
      const { manifest, steps } = compile(extensionPreviewProject("camera", move.id));
      expect(manifest.scenes[0]!.camera?.move).toBe(move.id);
      // A camera move animates the whole-frame stage wrapper, not a layer.
      expect(steps.some((s) => "target" in s && String(s.target).includes(".seq-camera"))).toBe(true);
    }
  });
});
