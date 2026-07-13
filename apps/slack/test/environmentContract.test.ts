import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  ENVIRONMENT_KIT_STYLE_ID,
  ENVIRONMENT_RUNTIME_FILE,
  environmentKitHash,
  environmentKitSource,
  environmentRuntimeHash,
  environmentRuntimeSource,
  injectEnvironmentContract,
  injectEnvironmentKit,
  injectEnvironmentRuntimeCall,
  injectEnvironmentRuntimeTag,
  parseEnvironmentPlan,
  primaryReadingWindowsByScene,
  resolveEnvironmentPlan,
  resolveProjectEnvironmentPlan,
  stageEnvironmentAssets,
} from "../src/engine/environmentContract.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function scenes(): DirectScene[] {
  return [
    {
      id: "desktop",
      title: "Desktop workspace",
      purpose: "The operating system workspace establishes context",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", startSec: 0.8, durationSec: 1.2 },
          { version: 1, move: "pan", startSec: 2, durationSec: 2 },
        ],
      },
    },
    { id: "screen", title: "Product screen", purpose: "A browser UI proves the flow", startSec: 4, durationSec: 4 },
    { id: "app", title: "Full app", purpose: "The full-screen app fills the frame", startSec: 8, durationSec: 4 },
    { id: "field", title: "Brand resolve", purpose: "An abstract end card", startSec: 12, durationSec: 3 },
  ];
}

function shell(): string {
  return `<!doctype html><html><head><script src="gsap.min.js"></script><style>body{margin:0}</style></head><body>
<main data-composition-id="env-film">
<section data-scene="desktop"><div data-camera-world><h1>Desktop copy</h1></div></section>
<section data-scene="screen"><h1>Screen copy</h1></section>
<section data-scene="app"><h1>App copy</h1></section>
<section data-scene="field"><h1>Field copy</h1></section>
</main><script>window.__ready=true</script></body></html>`;
}

describe("environment plan", () => {
  it("maps only primary camera landings into wallpaper reading holds", () => {
    const windows = primaryReadingWindowsByScene({
      version: 1,
      enabled: true,
      solver: {
        curve: "minimum-jerk-quintic",
        measuredDom: true,
        maxNormalizedVelocity: 1,
        maxNormalizedAcceleration: 1,
        maxNormalizedJerk: 1,
      },
      tolerances: {
        opacityMin: 0.35,
        visibleFractionMin: 0.85,
        occupancyMinFactor: 0.9,
        occupancyMaxFactor: 1.1,
        anchorErrorMax: 0.14,
        restSpeedMax: 0.018,
        readableDwellMinSec: 0.35,
        landingSampleInsetSec: 0.08,
        segmentMatchSec: 0.02,
      },
      scenes: [{
        sceneId: "desktop",
        phrases: [
          {
            id: "primary",
            sceneId: "desktop",
            phraseId: "primary",
            role: "entry",
            importance: "primary",
            routeOwnership: "host-derived",
            evidenceOwner: { kind: "direction-phrase", id: "primary" },
            startSec: 0,
            arrivalSec: 0.5,
            endSec: 2,
            target: { kind: "part", id: "hero" },
            occupancy: { min: 0.1, preferred: 0.2, max: 0.4 },
            sourcePose: { anchor: { x: 0.5, y: 0.5, name: "center" }, lens: "fit", zoom: 1 },
            arrivalPose: { target: { kind: "part", id: "hero" }, anchor: { x: 0.5, y: 0.5, name: "center" }, lens: "fit", zoom: 1 },
            corridor: {
              from: { x: 0.5, y: 0.5, name: "center" },
              to: { x: 0.5, y: 0.5, name: "center" },
              padding: 0.1,
            },
            travel: { startSec: 0, endSec: 0.5 },
            settle: { startSec: 0.5, endSec: 0.7 },
            dwell: { startSec: 0.5, endSec: 1.7, readableSec: 1.2 },
            departure: { startSec: 1.7, endSec: 2 },
          },
          {
            id: "supporting",
            sceneId: "desktop",
            phraseId: "supporting",
            role: "develop",
            importance: "supporting",
            routeOwnership: "host-derived",
            evidenceOwner: { kind: "direction-phrase", id: "supporting" },
            startSec: 2,
            arrivalSec: 2.2,
            endSec: 3,
            target: { kind: "part", id: "chip" },
            occupancy: { min: 0.01, preferred: 0.02, max: 0.1 },
            sourcePose: { target: { kind: "part", id: "hero" }, anchor: { x: 0.5, y: 0.5, name: "center" }, lens: "fit", zoom: 1 },
            arrivalPose: { target: { kind: "part", id: "chip" }, anchor: { x: 0.5, y: 0.5, name: "center" }, lens: "detail", zoom: 1.1 },
            corridor: {
              from: { x: 0.5, y: 0.5, name: "center" },
              to: { x: 0.5, y: 0.5, name: "center" },
              padding: 0.1,
            },
            travel: { startSec: 2, endSec: 2.2 },
            settle: { startSec: 2.2, endSec: 2.4 },
            dwell: { startSec: 2.2, endSec: 2.8, readableSec: 0.6 },
            departure: { startSec: 2.8, endSec: 3 },
          },
        ],
      }],
      summary: {
        phraseCount: 2,
        explicitTargetCount: 2,
        primaryPhraseCount: 1,
        primaryWithReadableLandingCount: 1,
        inputPhraseCount: 2,
        collapsedPhraseCount: 0,
        authoredRouteCount: 0,
        continuityRouteCount: 0,
        hostDerivedRouteCount: 2,
      },
    });
    expect(windows).toEqual({ desktop: [{ startSec: 0.5, endSec: 1.7 }] });
  });

  it("selects one deterministic wallpaper for the film and derives bounded scene motion", () => {
    const options = {
      compositionId: "one-wallpaper-film",
      frame: { dialectId: "gallery-white", backgroundPolicyId: "image-stage", basis: "light" as const },
      directionScoreByScene: { desktop: 1 },
      settleWindowsByScene: {
        desktop: [{ startSec: 2.4, endSec: 3.1, amplitudeScale: 0.18 }],
      },
      readingWindowsByScene: {
        desktop: [{ startSec: 1.1, endSec: 1.8 }],
      },
    };
    const first = resolveEnvironmentPlan(scenes(), options);
    const replay = resolveEnvironmentPlan(scenes(), options);
    expect(replay).toEqual(first);
    expect(first.wallpaper.id).toMatch(/^wallpaper-\d{2}$/);
    expect(first.wallpaper.assetFile).toMatch(/^assets\/wallpapers\/wallpaper\d+\.jpg$/);
    expect(first.wallpaper.motion.maxTravelPercent).toBeLessThanOrEqual(2.5);
    expect(first.wallpaper.motion.maxScale).toBeLessThanOrEqual(1.045);
    expect(first.frame).toEqual({
      dialectId: "gallery-white",
      backgroundPolicyId: "image-stage",
      basis: "light",
    });
    expect(first.scenes.map((scene) => scene.basis)).toEqual(["light", "light", "light", "light"]);
    expect(first.scenes[0]!.directionScore).toBe(1);
    expect(first.scenes[0]!.furnitureMaxPx).toBe(4);
    expect(first.scenes[0]!.lightMaxPx).toBe(4);
    expect(first.scenes[0]!.settleWindows).toEqual([
      { startSec: 0.8, endSec: 2, amplitudeScale: 0.2 },
      { startSec: 2.4, endSec: 3.1, amplitudeScale: 0.18 },
      { startSec: 3.45, endSec: 4, amplitudeScale: 0.3 },
    ]);
    expect(first.scenes[0]!.readingWindows).toEqual([
      { startSec: 1.1, endSec: 1.8 },
    ]);
  });

  it("reads the committed frame.md metadata through the project planning seam", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-environment-frame-"));
    roots.push(project);
    fs.writeFileSync(path.join(project, "frame.md"), [
      "# frame.md -- fixture",
      '<!-- sequences-frame: {"presetId":"fixture","dialectId":"editorial-paper","label":"Fixture","basis":"light","backgroundPolicyId":"paper-rules","thesis":"Measured","exceptions":[],"brandMatched":false} -->',
    ].join("\n"));
    const plan = resolveProjectEnvironmentPlan(project, scenes().slice(0, 1), {
      compositionId: "frame-derived",
      wallpaperId: "wallpaper-13",
    });
    expect(plan.frame).toEqual({
      dialectId: "editorial-paper",
      backgroundPolicyId: "paper-rules",
      basis: "light",
    });
    expect(plan.wallpaper.id).toBe("wallpaper-13");
  });
});

describe("environment injection and staging", () => {
  it("injects all four host-owned shapes outside camera-world and converges byte-for-byte", () => {
    const shapeByScene = {
      desktop: "desktop-stage",
      screen: "screen-over-wallpaper",
      app: "full-app-view",
      field: "generated-field",
    } as const;
    const plan = resolveEnvironmentPlan(scenes(), {
      compositionId: "shape-film",
      wallpaperId: "wallpaper-03",
      shapeByScene,
    });
    const first = injectEnvironmentContract(shell(), plan);
    expect(first.injectedScenes).toEqual(["desktop", "screen", "app", "field"]);
    expect(first.skippedScenes).toEqual([]);
    const parsed = parseEnvironmentPlan(first.html);
    expect(parsed.errors).toEqual([]);
    expect(parsed.plan).toEqual(plan);

    const { document } = parseHTML(first.html);
    const environments = Array.from(
      document.querySelectorAll("[data-sequences-environment]"),
    ) as HTMLElement[];
    expect(environments).toHaveLength(4);
    expect(environments.map((node) => node.getAttribute("data-sequences-environment"))).toEqual([
      "desktop-stage",
      "screen-over-wallpaper",
      "full-app-view",
      "generated-field",
    ]);
    for (const environment of environments) {
      expect(environment.hasAttribute("data-layout-ignore")).toBe(true);
      expect(environment.getAttribute("data-composition-credit")).toBe("1");
      expect(environment.getAttribute("data-sequences-host")).toBe("1");
      expect(environment.parentElement?.getAttribute("data-scene")).toBe(environment.getAttribute("data-env-scene"));
    }
    const desktop = document.querySelector<HTMLElement>('[data-scene="desktop"]')!;
    expect(desktop.firstElementChild).toBe(environments[0]);
    expect(environments[0]!.contains(desktop.querySelector("[data-camera-world]"))).toBe(false);
    expect(environments[0]!.querySelector("[data-depth]")?.getAttribute("style")).toBeNull();
    expect(environments[1]!.querySelector(".seq-env__pedestal--screen")).not.toBeNull();
    expect(environments[2]!.querySelector(".seq-env__pedestal--app")).not.toBeNull();
    expect(environments[3]!.querySelector("[data-env-wallpaper]")).toBeNull();
    const wallpaperSources = environments
      .flatMap((environment) => Array.from(
        environment.querySelectorAll("[data-env-wallpaper]"),
      ) as HTMLImageElement[])
      .map((image) => image.getAttribute("src"))
      .filter((source): source is string => Boolean(source));
    expect(new Set(wallpaperSources.map((source) => source.split("?", 1)[0]))).toEqual(
      new Set(["assets/wallpapers/wallpaper3.jpg"]),
    );
    expect(new Set(wallpaperSources).size).toBe(wallpaperSources.length);
    expect(document.querySelectorAll('[id="sequences-environment"]')).toHaveLength(1);
    expect(document.querySelector("#sequences-environment")?.getAttribute("data-sequences-host")).toBe("1");

    expect(injectEnvironmentContract(first.html, plan).html).toBe(first.html);
    const tampered = first.html.replace("seq-env__dock", "seq-env__dock author-tamper");
    expect(injectEnvironmentContract(tampered, plan).html).toBe(first.html);
  });

  it("stages only the selected JPEG and its MIT notice", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-environment-assets-"));
    roots.push(project);
    const plan = resolveEnvironmentPlan(scenes().slice(0, 1), {
      compositionId: "stage-film",
      wallpaperId: "wallpaper-12",
    });
    const result = stageEnvironmentAssets(project, plan);
    expect(result).toEqual({
      wallpaperId: "wallpaper-12",
      files: ["assets/wallpapers/wallpaper12.jpg", "assets/wallpapers/LICENSE"],
    });
    const staged = path.join(project, "assets", "wallpapers");
    expect(fs.readdirSync(staged).sort()).toEqual(["LICENSE", "wallpaper12.jpg"]);
    expect(fs.readFileSync(path.join(staged, "wallpaper12.jpg"))).toEqual(
      fs.readFileSync(new URL("../vendor/wallpapers/wallpaper12.jpg", import.meta.url)),
    );
    expect(fs.readFileSync(path.join(staged, "LICENSE"), "utf8")).toContain("SPDX-License-Identifier: MIT");
  });
});

describe("environment kit and runtime IO", () => {
  it("injects canonical versioned assets idempotently and keeps the runtime seek-driven", () => {
    const runtime = environmentRuntimeSource();
    const kit = environmentKitSource();
    expect(runtime).toContain("SequencesEnvironment");
    expect(runtime).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|repeat\s*:\s*-1|\.play\s*\(/);
    expect(kit).not.toMatch(/#(?:000000|000|ffffff|fff)\b/i);
    expect(kit).toContain('.seq-env[data-env-basis="dark"] .seq-env__pedestal-surface');
    expect(environmentRuntimeHash()).toMatch(/^[a-f0-9]{64}$/);
    expect(environmentKitHash()).toMatch(/^[a-f0-9]{64}$/);

    const withRuntime = injectEnvironmentRuntimeTag(shell());
    expect(withRuntime).toContain(`<script src="${ENVIRONMENT_RUNTIME_FILE}"></script>`);
    expect(injectEnvironmentRuntimeTag(withRuntime)).toBe(withRuntime);
    const withKit = injectEnvironmentKit(withRuntime);
    expect(withKit).toContain(`id="${ENVIRONMENT_KIT_STYLE_ID}" data-version="1"`);
    expect(injectEnvironmentKit(withKit)).toBe(withKit);
    const tampered = withKit.replace("Sequences environment kit v1", "tampered environment kit");
    expect(injectEnvironmentKit(tampered)).toBe(withKit);

    const authored = shell().replace(
      "window.__ready=true",
      'const master = gsap.timeline({ paused: true }); window.__timelines = {}; window.__timelines["env-film"] = master;',
    );
    const withRuntimeCall = injectEnvironmentRuntimeCall(authored);
    expect(withRuntimeCall).toContain(
      'SequencesEnvironment.compile(master, document.querySelector("[data-composition-id]"));',
    );
    expect(withRuntimeCall.indexOf("SequencesEnvironment.compile"))
      .toBeLessThan(withRuntimeCall.indexOf('window.__timelines["env-film"]'));
    expect(injectEnvironmentRuntimeCall(withRuntimeCall)).toBe(withRuntimeCall);
  });
});
