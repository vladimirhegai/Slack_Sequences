import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  inspectDirectComposition,
  visionCriticDraftHash,
} from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * The rendered temporal judge's core promise: static source inspection can
 * prove a tween exists, but only rendered pixels prove the promised change is
 * visible. This film declares two evidence-bound moments — one bound to a
 * headline reveal the viewer actually sees, one bound to a tween inside a
 * permanently invisible container (real to the motion parser, invisible on
 * screen). The judge must pass the first and flag the second.
 */
function judgeFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "shot-real",
      title: "Headline lands",
      purpose: "A visible reveal the judge should accept",
      startSec: 0,
      durationSec: 6,
      spatialIntent: {
        version: 1,
        focalPart: "real-headline",
        composition: "one pale headline on a pale field",
        relationships: ["the headline is the scene focal"],
      },
      moments: [
        {
          version: 1,
          id: "m-real",
          sceneId: "shot-real",
          atSec: 1,
          title: "Headline flies in",
          visualState: "the promise fills the frame",
          change: "hero copy arrives",
          motionIntent: "reveal",
          importance: "primary",
        },
      ],
    },
    {
      id: "shot-ghost",
      title: "Nothing visibly changes",
      purpose: "An invisible tween the judge should flag",
      startSec: 6,
      durationSec: 6,
      moments: [
        {
          version: 1,
          id: "m-ghost",
          sceneId: "shot-ghost",
          atSec: 7.2,
          title: "Ghost metric shifts",
          visualState: "a hidden dot slides",
          change: "claimed but invisible",
          motionIntent: "reveal",
          importance: "primary",
        },
      ],
    },
  ];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Temporal judge smoke</title><script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:96px;display:grid;align-content:center;justify-items:center;gap:40px;opacity:0}
#shot-real{background:#f2f3f4;color:#e0e1e2}
h2{margin:0;font-size:96px;letter-spacing:-.04em}
.ghost-wrap{opacity:0;width:600px;height:80px;position:relative}
.ghost-dot{position:absolute;left:0;top:20px;width:40px;height:40px;border-radius:50%;background:#5eead4}
</style></head><body>
<main id="root" data-composition-id="judge-smoke" data-width="1920" data-height="1080" data-duration="12">
<section id="shot-real" class="scene clip" data-scene="shot-real" data-start="0" data-duration="6" data-track-index="1">
<h2 id="real-headline" data-part="real-headline">From shipped to shown</h2>
</section>
<section id="shot-ghost" class="scene clip" data-scene="shot-ghost" data-start="6" data-duration="6" data-track-index="1">
<h2>Steady state</h2>
<div class="ghost-wrap"><div class="ghost-dot" id="ghost-dot" data-part="ghost-dot"></div></div>
</section>
</main>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#shot-real",{opacity:1},0).set("#shot-real",{opacity:0},5.99);
tl.set("#shot-ghost",{opacity:1},6).set("#shot-ghost",{opacity:0},12);
tl.fromTo("#real-headline",{y:220,opacity:0},{y:0,opacity:1,duration:0.7,ease:"power3.out"},0.8);
tl.fromTo("#ghost-dot",{x:0},{x:340,duration:0.8,ease:"power2.out"},7.0);
window.__timelines["judge-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

describe("rendered temporal judge", () => {
  it("accepts a visible reveal and flags an invisible claimed change", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-judge-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Judge", brandName: "Judge", seedScreenshot: false });
    const draft = judgeFilm();
    const qa = await inspectDirectComposition(dir, draft, {
      captureGuide: false,
      captureVisualReview: true,
    });
    expect(qa.infraError).toBeUndefined();
    const judged = qa.temporalJudge ?? [];
    const real = judged.find((entry) => entry.momentId === "m-real");
    const ghost = judged.find((entry) => entry.momentId === "m-ghost");
    expect(real?.verdict).toBe("changed");
    expect(ghost?.verdict).toBe("static");
    // The flagged moment surfaces as a named repair finding, downgrades
    // strictOk (bounded polish), and never blocks a runnable draft.
    expect(qa.issues.some((issue) =>
      issue.code === "moment_static_frame" && issue.selector === "moment:m-ghost")).toBe(true);
    expect(qa.issues.find((issue) => issue.selector === "moment:m-ghost")?.momentImportance)
      .toBe("primary");
    expect(qa.warnings.some((warning) => warning.includes("moment_static_frame"))).toBe(true);
    expect(qa.strictOk).toBe(false);
    expect(qa.ok).toBe(true);
    const washed = (qa.washoutEvidence ?? []).find((entry) => entry.washedOut);
    expect(washed?.context?.sceneId).toBe("shot-real");
    expect(qa.issues.some((issue) =>
      issue.code === "composition_washed_out" && issue.sceneId === "shot-real")).toBe(true);
    expect(qa.visionCriticEvidence?.stripPngBase64.length).toBeGreaterThan(1_000);
    expect(qa.visionCriticEvidence?.blockingPngBase64?.length).toBeGreaterThan(1_000);
    expect(qa.visionCriticEvidence?.stripTimes).toHaveLength(10);
    // Only the first fixture scene declares a stable focal; production plans
    // carry blocking targets for every directed scene.
    expect(qa.visionCriticEvidence?.blockingTimes).toHaveLength(5);
    const visual = qa.visionCriticEvidence!;
    expect(visual.draftHash).toBe(visionCriticDraftHash(dir, draft));
    expect(visual.stripPath).toContain(path.join("build", "qa", "critic"));
    expect(path.basename(visual.stripPath)).toBe("strip.png");
    expect(path.basename(visual.blockingPath!)).toBe("blocking.png");
    const stripBytes = fs.readFileSync(visual.stripPath);
    const blockingBytes = fs.readFileSync(visual.blockingPath!);
    expect(stripBytes.toString("base64")).toBe(visual.stripPngBase64);
    expect(blockingBytes.toString("base64")).toBe(visual.blockingPngBase64);
    expect(createHash("sha256").update(stripBytes).digest("hex")).toBe(visual.stripSha256);
    expect(createHash("sha256").update(blockingBytes).digest("hex"))
      .toBe(visual.blockingSha256);
    const manifest = JSON.parse(fs.readFileSync(visual.manifestPath, "utf8")) as {
      draftHash: string;
      evidenceHash: string;
      strip: { sha256: string };
      blocking: { sha256: string };
    };
    expect(manifest).toMatchObject({
      draftHash: visual.draftHash,
      evidenceHash: visual.evidenceHash,
      strip: { sha256: visual.stripSha256 },
      blocking: { sha256: visual.blockingSha256 },
    });
    expect(path.basename(path.dirname(visual.manifestPath))).toBe(visual.evidenceHash);
    expect(fs.readFileSync(
      path.join(dir, "build", "qa", "temporal", "strip.png"),
    ).equals(stripBytes)).toBe(true);

    // Visual requests never trust the ordinary QA cache. A stale canonical
    // sheet is freshly rendered while the identical content-addressed critic
    // generation remains immutable.
    const immutableMtime = fs.statSync(visual.stripPath).mtimeMs;
    fs.writeFileSync(path.join(dir, "build", "qa", "temporal", "strip.png"), "stale");
    const unpublished = await inspectDirectComposition(dir, draft, {
      captureGuide: false,
      captureVisualReview: true,
      publishVisualReview: false,
    });
    expect(unpublished.visionCriticEvidence!.evidenceHash).toBe(visual.evidenceHash);
    expect(fs.readFileSync(path.join(dir, "build", "qa", "temporal", "strip.png"), "utf8"))
      .toBe("stale");
    expect(fs.statSync(visual.stripPath).mtimeMs).toBe(immutableMtime);

    const recaptured = await inspectDirectComposition(dir, draft, {
      captureGuide: false,
      captureVisualReview: true,
    });
    expect(fs.existsSync(recaptured.visionCriticEvidence!.stripPath)).toBe(true);
    expect(recaptured.visionCriticEvidence!.evidenceHash).toBe(visual.evidenceHash);
    expect(fs.statSync(visual.stripPath).mtimeMs).toBe(immutableMtime);
    expect(fs.readFileSync(recaptured.visionCriticEvidence!.stripPath).toString("base64"))
      .toBe(recaptured.visionCriticEvidence!.stripPngBase64);
    expect(fs.readFileSync(path.join(dir, "build", "qa", "temporal", "strip.png"))
      .toString("base64")).toBe(recaptured.visionCriticEvidence!.stripPngBase64);

    const noBlockingDraft = {
      ...draft,
      storyboard: draft.storyboard.map((scene) => ({
        ...scene,
        spatialIntent: undefined,
        moments: undefined,
      })),
    };
    const noBlocking = await inspectDirectComposition(dir, noBlockingDraft, {
      captureGuide: false,
      captureVisualReview: true,
    });
    expect(noBlocking.visionCriticEvidence?.stripPngBase64.length).toBeGreaterThan(1_000);
    expect(noBlocking.visionCriticEvidence?.blockingPngBase64).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "build", "qa", "temporal", "blocking.png")))
      .toBe(false);

    // Kill switch: the judge disappears without touching the rest of QA.
    process.env.SLACK_SEQUENCES_TEMPORAL_JUDGE = "0";
    process.env.SLACK_SEQUENCES_QA_CACHE = "0";
    try {
      const off = await inspectDirectComposition(dir, draft, { captureGuide: false });
      expect(off.temporalJudge).toBeUndefined();
      expect(off.issues.filter((issue) => issue.code === "moment_static_frame")).toEqual([]);
    } finally {
      delete process.env.SLACK_SEQUENCES_TEMPORAL_JUDGE;
      delete process.env.SLACK_SEQUENCES_QA_CACHE;
    }
  }, 90_000);
});
