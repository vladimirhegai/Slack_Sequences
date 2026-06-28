import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "@hyperframes/core/lint";
import { compile } from "../src/compiler.ts";
import { createDefaultProject } from "../src/defaults.ts";
import { projectDurationFrames, type Project } from "../src/schema.ts";
import { testAsset } from "./helpers.ts";

function exampleProject(): Project {
  const dashboard = testAsset("dashboard", "assets/dashboard.svg");
  const project = createDefaultProject({
    title: "Compiler Test Promo",
    brandName: "Acme",
    screenshotAssetId: dashboard.id,
  });
  project.assets.push(dashboard);
  return project;
}

describe("compiler", () => {
  it("emits the HF contract: meta tags, timed clips, timeline registration", () => {
    const { html, manifest } = compile(exampleProject());
    expect(html).toContain(`data-composition-id="${manifest.compositionId}"`);
    expect(html).toContain('content="width=1920, height=1080"');
    expect(html).toContain('class="clip seq-scene scene"');
    expect(html).toContain("data-track-index=\"0\"");
    expect(html).toContain(`window.__timelines[${JSON.stringify(manifest.compositionId)}]`);
    expect(html).toContain("gsap.timeline({ paused: true })");
    // Timeline extended to full duration so composition length is exact.
    expect(html).toContain(`tl.set({}, {}, ${manifest.durationSec})`);
  });

  it("scene clips overlap only in declared pre-roll windows while nominal scenes tile", () => {
    const project = exampleProject();
    const { html, manifest } = compile(project);
    const clips = [...html.matchAll(/data-start="([\d.]+)" data-duration="([\d.]+)"/g)].map(
      (m) => ({ start: Number(m[1]), duration: Number(m[2]) }),
    );
    expect(clips.length).toBe(project.scenes.length);
    expect(clips[0]!.start).toBe(0);
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i]!.start).toBeLessThanOrEqual(manifest.scenes[i]!.startFrame / manifest.fps);
      expect(clips[i]!.start + clips[i]!.duration).toBeCloseTo(
        (manifest.scenes[i]!.startFrame + manifest.scenes[i]!.durationFrames) / manifest.fps,
        2,
      );
    }
    expect(manifest.durationFrames).toBe(projectDurationFrames(project));
  });

  it("PASSES HYPERFRAMES' OWN LINTER (substrate conformance)", async () => {
    const { html } = compile(exampleProject());
    const result = await lintHyperframeHtml(html);
    const errors = result.findings.filter((f: { severity: string }) => f.severity === "error");
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
  });

  it("asset hrefs preserve bin subfolders (same basename in two bins never collides)", () => {
    const project = exampleProject();
    const logoA = testAsset("logo-a", "assets/intro/logo.png");
    const logoB = testAsset("logo-b", "assets/outro/logo.png");
    project.assets.push(logoA, logoB);
    const { assets } = compile(project);
    const hrefOf = (id: string) => assets.find((a) => a.assetId === id)?.href;
    expect(hrefOf(project.assets[0]!.id)).toBe("assets/dashboard.svg");
    expect(hrefOf(logoA.id)).toBe("assets/intro/logo.png");
    expect(hrefOf(logoB.id)).toBe("assets/outro/logo.png");
    expect(new Set(assets.map((a) => a.href)).size).toBe(assets.length);
  });

  it("is a pure function: identical input → identical output", () => {
    const a = compile(exampleProject());
    const b = compile(exampleProject());
    expect(a.html).toBe(b.html);
    expect(a.manifest).toEqual(b.manifest);
  });

  it("brand recolor changes only CSS variables, not structure", () => {
    const base = exampleProject();
    const recolored = structuredClone(base);
    recolored.brand.colors.accent = "#FF0099";
    const htmlA = compile(base).html;
    const htmlB = compile(recolored).html;
    const strip = (html: string) => html.replace(/--c-[a-z]+: #[0-9a-fA-F]{6};/g, "");
    expect(strip(htmlA)).toBe(strip(htmlB));
  });

  it("number slots count up via the custom step (exact final value present)", () => {
    const { html } = compile(exampleProject());
    expect(html).toContain("12,480+"); // static fallback content
    expect(html).toContain("toLocaleString"); // countUp runtime code
  });

  it("warm-startup fade transitions emit scene-level opacity steps", () => {
    const project = exampleProject();
    project.motionProfile = "warm-startup";
    const { steps } = compile(project);
    const sceneFades = steps.filter(
      (s) => s.layerId === null && (s.kind === "custom" || !s.target.includes(".seq-camera")),
    );
    // out + in per boundary; 4 scenes → 3 boundaries → 6 steps.
    expect(sceneFades.length).toBe((project.scenes.length - 1) * 2);
  });

  it("camera pushIn emits one whole-frame scale step on the stage wrapper", () => {
    const { steps, html, manifest } = compile(exampleProject());
    const cameraSteps = steps.filter(
      (s): s is Extract<(typeof steps)[number], { kind: "fromTo" }> =>
        s.kind === "fromTo" && s.target.includes(".seq-camera"),
    );
    expect(cameraSteps).toHaveLength(1); // the feature scene's default pushIn
    const step = cameraSteps[0]!;
    expect(step.target).toBe("#sc-feature > .seq-camera");
    expect(step.from).toEqual({ scale: 1, force3D: false });
    expect(step.to).toEqual({ scale: 1.03, force3D: false, autoRound: false }); // scale token "subtle", never a raw choice
    expect(step.ease).toBe("seqMoveGlide"); // move-role easing token
    expect(html).toContain('class="seq-camera"');
    expect(manifest.scenes.find((s) => s.id === "feature")?.camera).toEqual({
      move: "pushIn",
      scale: "subtle",
    });
  });

  it("allocates another track when a very short neighbor would cause same-track pre-roll overlap", () => {
    const project = createDefaultProject();
    project.scenes[0]!.durationFrames = 15;
    project.scenes[1]!.durationFrames = 15;
    project.transitions[project.scenes[0]!.id] = "crossFade";
    project.transitions[project.scenes[1]!.id] = "crossFade";
    const scenes = compile(project).manifest.scenes;
    for (let left = 0; left < scenes.length; left++) {
      for (let right = left + 1; right < scenes.length; right++) {
        if (scenes[left]!.trackIndex !== scenes[right]!.trackIndex) continue;
        const leftEnd = scenes[left]!.startFrame + scenes[left]!.durationFrames;
        expect(scenes[right]!.clipStartFrame).toBeGreaterThanOrEqual(leftEnd);
      }
    }
  });

  it("escapes font names in CSS and never emits injected markup", () => {
    const project = exampleProject();
    project.brand.fonts.display = `X";}</style><script>window.bad=1</script><style>{`;
    const { html } = compile(project);
    expect(html).not.toContain("</style><script>");
    expect(html).not.toContain("window.bad=1</script>");
    expect(html).toContain("\\3C /style\\3E ");
  });

  it("escapes number prefixes and suffixes inside inline primitive scripts", () => {
    const project = exampleProject();
    project.scenes.find((scene) => scene.id === "stat")!.slots["stat"] = {
      value: 7,
      prefix: "</script><script>window.bad=1</script>",
      suffix: "&done",
    };
    const { html } = compile(project);
    expect(html).not.toContain("</script><script>window.bad=1");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).toContain("\\u0026done");
  });

  it("uses the body font for body/caption tokens and display font for headings", () => {
    const project = exampleProject();
    project.brand.fonts.display = "Display Face";
    project.brand.fonts.body = "Body Face";
    const { html } = compile(project);
    expect(html).toContain("font-family:'Display Face'");
    expect(html).toContain("font-family:'Body Face'");
  });

  it("keeps token motion duration stable in seconds at 60fps", () => {
    const project30 = exampleProject();
    const project60 = structuredClone(project30);
    project60.meta.fps = 60;
    project60.scenes.forEach((scene) => {
      scene.durationFrames *= 2;
    });
    const step30 = compile(project30).steps.find(
      (
        step,
      ): step is Extract<ReturnType<typeof compile>["steps"][number], { kind: "fromTo" }> =>
        step.sceneId === "hook" && step.layerId === "headline" && step.kind === "fromTo",
    );
    const step60 = compile(project60).steps.find(
      (
        step,
      ): step is Extract<ReturnType<typeof compile>["steps"][number], { kind: "fromTo" }> =>
        step.sceneId === "hook" && step.layerId === "headline" && step.kind === "fromTo",
    );
    expect(step30?.durationSec).toBe(step60?.durationSec);
    const manifest60 = compile(project60).manifest;
    expect(manifest60.scenes[0]!.layers.find((layer) => layer.id === "headline")?.enter?.durationFrames)
      .toBe(48);
  });

  it("rejects unsafe asset paths even when compile is called without validation", () => {
    const project = exampleProject();
    project.assets.push(testAsset("escape", "../../outside.png"));
    expect(() => compile(project)).toThrow(/unsafe asset path/);
  });

  it("golden snapshot of the example compile (retune tokens consciously!)", () => {
    const { html } = compile(exampleProject());
    expect(html).toMatchSnapshot();
  });
});
