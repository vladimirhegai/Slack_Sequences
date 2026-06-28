import { describe, expect, it } from "vitest";
import {
  applyCommand,
  compile,
  createDefaultProject,
  migrateProject,
  resolveProject,
  validateProject,
  type Project,
} from "../src/index.ts";
import { testAsset } from "./helpers.ts";

describe("Phase-1 completion contracts", () => {
  it("migrates v1 assets, references, transitions, audio, and extension dependencies to v3", () => {
    const migrated = migrateProject({
      schemaVersion: 1,
      meta: { title: "Old", width: 1920, height: 1080, fps: 30, background: "surface" },
      brand: {
        name: "Old",
        colors: {
          primary: "#111111",
          surface: "#000000",
          text: "#FFFFFF",
          muted: "#AAAAAA",
          accent: "#00FF00",
        },
        fonts: { display: "Inter", body: "Inter" },
      },
      motionProfile: "crisp-saas",
      scenes: [
        {
          id: "feature",
          archetype: "feature-reveal",
          durationFrames: 120,
          slots: { headline: "Old shot", media: { assetId: "screen" } },
          choreography: {},
          overrides: {},
        },
      ],
      transitions: { feature: "fade" },
      assets: [{ id: "screen", path: "assets/screen.png", kind: "image" }],
    }) as Project;
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.assets[0]!.id).toMatch(/^asset-/);
    expect((migrated.scenes[0]!.slots.media as { assetId: string }).assetId).toBe(
      migrated.assets[0]!.id,
    );
    expect(migrated.transitions.feature).toBe("crossFade");
    expect(migrated.extensions.enabled).toBeNull();
    expect(migrated.audio).toEqual([]);
    expect(validateProject(migrated).ok).toBe(true);
  });

  it("migrates v2 explicit extension lists to include referenced graph dependencies", () => {
    const v2 = createDefaultProject() as unknown as Record<string, unknown>;
    v2.schemaVersion = 2;
    v2.extensions = { enabled: ["crisp-saas"] };
    const migrated = migrateProject(v2) as Project;
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.extensions.enabled).toEqual(
      expect.arrayContaining([
        "crisp-saas",
        "hook-opener",
        "stat-callout",
        "logo-sting-cta",
        "cut",
        "fade",
        "cutHold",
        "crossFade",
        "wipeDirectional",
        "slidePush",
        "shader.flashThroughWhite",
        "shader.pixelMelt",
      ]),
    );
    expect(validateProject(migrated).ok).toBe(true);
  });

  it("compiles logo, device/video media, and the audio graph to HyperFrames media tags", () => {
    const video = testAsset("video", "assets/demo.mp4", "video");
    const logo = testAsset("logo", "assets/logo.svg");
    const audio = testAsset("music", "assets/music.wav", "audio");
    const project = createDefaultProject({
      screenshotAssetId: video.id,
    });
    project.assets.push(video, logo, audio);
    project.brand.logoAssetId = logo.id;
    const feature = project.scenes.find((scene) => scene.id === "feature")!;
    feature.slots.media = { assetId: video.id, presentation: "device" };
    project.audio.push({
      id: "music-bed",
      assetId: audio.id,
      role: "music",
      startFrame: 0,
      volume: "bed",
      muted: false,
    });
    const result = compile(project);
    expect(result.html).toContain("seq-device");
    expect(result.html).toContain("<video");
    expect(result.html).toContain('data-has-audio="true"');
    expect(result.html).toContain('<audio id="audio-music-bed"');
    expect(result.html).toContain(`assets/logo.svg`);
  });

  it("emits true overlaps, wipe/slide steps, and HyperFrames shader metadata", () => {
    const project = createDefaultProject();
    project.transitions.hook = "shader.flashThroughWhite";
    project.transitions.stat = "slidePush";
    const result = compile(project);
    expect(result.manifest.scenes[1]!.clipStartFrame).toBeLessThan(
      result.manifest.scenes[1]!.startFrame,
    );
    expect(result.html).toContain('"shader":"flash-through-white"');
    expect(
      result.steps.some(
        (step) => step.kind === "fromTo" && step.target === "#sc-sting",
      ),
    ).toBe(true);
  });

  it("schedules emphasis primitives and includes them in the manifest", () => {
    const project = createDefaultProject();
    project.scenes[0]!.overrides.headline = {
      emphasisPrimitive: "emphasis.pop",
      emphasisAtFrame: 50,
    };
    const resolved = resolveProject(project)[0]!;
    expect(
      resolved.schedule.motions.find(
        (motion) => motion.phase === "emphasis" && motion.layerId === "headline",
      )?.startFrame,
    ).toBe(50);
    expect(compile(project).manifest.scenes[0]!.layers.find((layer) => layer.id === "headline")!.emphasis)
      .toMatchObject({ primitive: "emphasis.pop" });
  });

  it("tracks dirty scene hashes for incremental builds", () => {
    const project = createDefaultProject();
    const first = compile(project);
    const second = compile(project, { previousManifest: first.manifest });
    expect(second.changedSceneIds).toEqual([]);
    const changed = structuredClone(project);
    changed.scenes[1]!.slots.caption = "A changed caption";
    const third = compile(changed, { previousManifest: first.manifest });
    expect(third.changedSceneIds).toEqual([changed.scenes[1]!.id]);
  });

  it("roundtrips explicit custom layers through AddLayer/RemoveLayer", () => {
    const project = createDefaultProject();
    const layer = {
      id: "custom-note",
      role: "support" as const,
      rank: 9,
      kind: "text" as const,
      content: { text: "Custom note" },
      box: { x: 242, y: 800, w: 500, h: 80, origin: "left center" as const },
      typeToken: "body" as const,
      colorToken: "muted" as const,
    };
    const added = applyCommand(project, { type: "AddLayer", sceneId: "hook", layer });
    expect(resolveProject(added.project)[0]!.layers.some((item) => item.id === layer.id)).toBe(true);
    expect(applyCommand(added.project, added.inverse).project).toEqual(project);
  });
});
