import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import {
  browserQualityPenalty,
  earlyLeastBadPublishReason,
  sourceRetryFeedbackForBrowserQa,
} from "../src/engine/runner/browserQuality.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { repairCompositionWashoutIssues } from "../src/engine/runner/repairs.ts";

const roots: string[] = [];
const proofGridIDir = path.resolve(
  import.meta.dirname,
  "../.data/projects/lp3-state-capsule-20260712-i",
);
const proofGridIQa = path.join(
  proofGridIDir,
  "qa-cache",
  "f1b6415949d3724f2f00395de053b839.json",
);
const proofGridIAvailable =
  fs.existsSync(path.join(proofGridIDir, "planning", "storyboard.json")) &&
  fs.existsSync(path.join(proofGridIDir, "composition", "index.html")) &&
  fs.existsSync(proofGridIQa);

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function highKeyFilm(
  id: string,
  focalColor: string,
): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [{
    id: "hero",
    title: "High-key product hero",
    purpose: "Measure value hierarchy without relying on text contrast",
    startSec: 0,
    durationSec: 6,
    spatialIntent: {
      version: 1,
      focalPart: "hero-surface",
      composition: "one large centered product surface over a high-key field",
      relationships: ["hero-surface is the sole focal and fills the central frame"],
    },
  }];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Washout policy</title>
<script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#ebebeb}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;background:#ebebeb}
.scene{position:absolute;inset:0;display:grid;place-items:center;background:#ebebeb}
.surface{width:900px;height:560px;border-radius:42px;background:${focalColor}}
</style></head><body>
<main id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="6">
<section id="hero" class="scene" data-scene="hero" data-start="0" data-duration="6" data-track-index="1">
<div class="surface" data-part="hero-surface" data-layout-important></div>
</section></main>
<script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
tl.set("#hero",{opacity:1},0);
window.__timelines[${JSON.stringify(id)}]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

async function inspect(id: string, focalColor: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sequences-washout-${id}-`));
  roots.push(dir);
  initializeProject(dir, { name: id, brandName: id, seedScreenshot: false });
  return inspectDirectComposition(dir, highKeyFilm(id, focalColor), { captureGuide: false });
}

describe("washout strict-polish browser policy", () => {
  it.runIf(proofGridIAvailable)(
    "clears both exact ProofGrid I focal washouts without changing the scene graph",
    async () => {
      const storyboardPayload = JSON.parse(fs.readFileSync(
        path.join(proofGridIDir, "planning", "storyboard.json"),
        "utf8",
      )) as { storyboard: DirectScene[] };
      const qaPayload = JSON.parse(fs.readFileSync(proofGridIQa, "utf8")) as {
        result: Awaited<ReturnType<typeof inspectDirectComposition>>;
      };
      const draft = {
        storyboard: storyboardPayload.storyboard,
        html: fs.readFileSync(path.join(proofGridIDir, "composition", "index.html"), "utf8"),
      };
      const repair = repairCompositionWashoutIssues(draft, qaPayload.result);
      expect(repair.repaired).toEqual([
        '[data-scene="shot-4-approval"] [data-part="approval-stat-card"]',
        '[data-scene="shot-5-ready"] [data-part="lockup-headline"]',
      ]);
      const after = await inspectDirectComposition(proofGridIDir, repair.draft, {
        captureGuide: false,
      });
      expect(after.infraError).toBeUndefined();
      expect(after.ok).toBe(true);
      expect(after.issues.filter((issue) => issue.code === "composition_washed_out"))
        .toEqual([]);
      expect(browserQualityPenalty(after)).toBeLessThan(
        browserQualityPenalty(qaPayload.result),
      );
    },
    75_000,
  );

  it("clears a measured focal washout with one guarded contrast plate", async () => {
    const priorContinuous = process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION;
    const priorComposition = process.env.SLACK_SEQUENCES_COMPOSITION;
    process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION = "0";
    process.env.SLACK_SEQUENCES_COMPOSITION = "0";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-washout-repair-"));
    roots.push(dir);
    initializeProject(dir, { name: "washout-repair", brandName: "washout-repair", seedScreenshot: false });
    try {
      const draft = highKeyFilm("washout-repair", "#dcdcdc");
      const before = await inspectDirectComposition(dir, draft, { captureGuide: false });
      expect(before.issues.some((issue) => issue.code === "composition_washed_out")).toBe(true);

      const repair = repairCompositionWashoutIssues(draft, before);
      expect(repair.repaired).toEqual([
        '[data-scene="hero"] [data-part="hero-surface"]',
      ]);
      const after = await inspectDirectComposition(dir, repair.draft, { captureGuide: false });
      expect(after.infraError).toBeUndefined();
      expect(after.ok).toBe(true);
      expect(after.issues.filter((issue) => issue.code === "composition_washed_out"))
        .toEqual([]);
      expect(browserQualityPenalty(after)).toBeLessThan(browserQualityPenalty(before));
    } finally {
      if (priorContinuous === undefined) delete process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION;
      else process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION = priorContinuous;
      if (priorComposition === undefined) delete process.env.SLACK_SEQUENCES_COMPOSITION;
      else process.env.SLACK_SEQUENCES_COMPOSITION = priorComposition;
    }
  }, 75_000);

  it("keeps washout out of paid source retries while ranking the contrasted draft", async () => {
    const priorContinuous = process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION;
    const priorComposition = process.env.SLACK_SEQUENCES_COMPOSITION;
    process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION = "0";
    process.env.SLACK_SEQUENCES_COMPOSITION = "0";
    try {
      const washed = await inspect("washed", "#dcdcdc");
      const contrasted = await inspect("contrasted", "#232832");

      const washedWarning = washed.warnings.find((warning) =>
        warning.startsWith("composition_washed_out")
      );
      expect(washed.infraError).toBeUndefined();
      expect(washed.errors).toEqual([]);
      expect(washed.ok).toBe(true);
      expect(washed.strictOk).toBe(true);
      expect(washedWarning).toBeDefined();
      const paidRetryFeedback = sourceRetryFeedbackForBrowserQa(washed);
      expect(paidRetryFeedback).not.toContain(washedWarning);
      expect(paidRetryFeedback.some((finding) =>
        finding.startsWith("composition_washed_out")
      )).toBe(false);
      const washedPenalty = browserQualityPenalty(washed);
      expect(washedPenalty).toBe(3);
      expect(earlyLeastBadPublishReason({
        draft: highKeyFilm("washed", "#dcdcdc"),
        raw: "<index_html></index_html>",
        attempts: 2,
        browserQa: washed,
        qualityPenalty: washedPenalty,
      })).toContain("early-least-bad-pick:penalty=3");

      expect(contrasted.infraError).toBeUndefined();
      expect(contrasted.errors).toEqual([]);
      expect(contrasted.ok).toBe(true);
      expect(contrasted.strictOk).toBe(true);
      expect(contrasted.issues.filter((issue) => issue.code === "composition_washed_out"))
        .toEqual([]);
      expect(contrasted.washoutEvidence?.[0]).toMatchObject({
        measured: true,
        washedOut: false,
        checks: { highKeyField: true, lowFocalSeparation: false },
      });
      expect(washedPenalty).toBeGreaterThan(
        browserQualityPenalty(contrasted),
      );
    } finally {
      if (priorContinuous === undefined) delete process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION;
      else process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION = priorContinuous;
      if (priorComposition === undefined) delete process.env.SLACK_SEQUENCES_COMPOSITION;
      else process.env.SLACK_SEQUENCES_COMPOSITION = priorComposition;
    }
  }, 60_000);
});
