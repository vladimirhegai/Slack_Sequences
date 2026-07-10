/**
 * Temporal evidence for direct HyperFrames compositions.
 *
 * Spatial QA can certify an animated deck: 48 clean layout samples say nothing
 * about whether a promised cut exists or a shot develops through time. This
 * inspector renders the committed composition and produces a compact,
 * developer-facing report under build/qa/temporal:
 *
 *   strip.png            one contact sheet — interior development frames per shot
 *   cut-<a>--<b>.png     before/at/after evidence for every typed cut boundary
 *   temporal.json        visual-change curve, quiet windows, promised-vs-observed cuts
 *
 * Everything is downscaled and composited into a handful of PNGs so the
 * persistent volume never accumulates per-frame archives. Pixel deltas are a
 * diagnostic for locating dead zones, not a demand that every frame move —
 * deliberate holds show up as named quiet windows for a human to judge.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { findBrowserExecutable } from "./render.ts";
import { launchHeadlessBrowser } from "./browserLifecycle.ts";
import { loadDirectComposition } from "./directComposition.ts";
import { resolveCutPlan, type CutIntentV1 } from "./cutContract.ts";
import { parseTimeRampPlan, warpInverseOf } from "./timeRamp.ts";
import {
  captureContinuousMotionEvidence,
  continuousMotionEvidenceEnabled,
  type ContinuousMotionEvidenceV1,
} from "./continuousMotion.ts";

const FRAME_WIDTH = 320;
const LABEL_HEIGHT = 26;
// Mean normalized RGB delta between consecutive downscaled frames. Calibrated
// on the golden Slack ad: a single small card revealing measures ~0.0008–0.003,
// a cut spikes to 0.01–0.05, and a genuinely frozen frame reads under 0.0002.
// Quiet windows therefore mean "visually frozen", not "insufficiently busy".
const QUIET_DELTA = 0.0002;

export interface TemporalCutEvidence {
  fromScene: string;
  toScene: string;
  style: string;
  atSec: number;
  /** The outgoing side visibly moves into the boundary (bridge motion for object-match). */
  outgoingMoved: boolean;
  /** The incoming side visibly settles out of the boundary. */
  incomingMoved: boolean;
  triptychPath: string;
}

export interface TemporalReport {
  summary: string;
  stripPath: string;
  jsonPath: string;
  cuts: TemporalCutEvidence[];
  changeCurve: Array<{ time: number; delta: number }>;
  quietWindows: Array<{ start: number; end: number }>;
  continuousMotion?: ContinuousMotionEvidenceV1;
}

/** DOM target whose visible state should change on the outgoing cut leg. */
export function temporalOutgoingCutSelector(
  cut: Pick<CutIntentV1, "style" | "fromScene">,
): string {
  // Resolved plans speak canonical `match`/`morph`; retain the legacy aliases
  // for exact replays of older persisted plans. Both bridge styles animate the
  // host runtime clone, not the outgoing scene wrapper itself.
  if (["match", "morph", "object-match", "shape-match"].includes(cut.style)) {
    return '[data-sequences-runtime-cut="bridge"]';
  }
  if (cut.style === "flash-white") return '[data-sequences-runtime-cut="flash"]';
  return `[data-scene="${cut.fromScene}"]`;
}

function serveDir(dir: string): Promise<{ url: string; close: () => void }> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dir, "." + pathname.replace(/\/$/, "/index.html"));
      const root = path.resolve(dir);
      if (
        (file !== root && !file.startsWith(root + path.sep)) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": mime[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      res.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not bind temporal inspector server"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${address.port}`, close: () => server.close() });
    });
  });
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function writeJsonAtomic(file: string, value: unknown): void {
  const temporary = `${file}.temporal-${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  try {
    fs.renameSync(temporary, file);
  } catch {
    fs.rmSync(file, { force: true });
    fs.renameSync(temporary, file);
  }
}

async function seekTo(page: import("puppeteer-core").Page, time: number): Promise<void> {
  await page.evaluate((at: number) => {
    const timelines = (window as unknown as {
      __timelines?: Record<string, { pause?: () => void; seek?: (t: number, suppress?: boolean) => void }>;
    }).__timelines ?? {};
    for (const timeline of Object.values(timelines)) {
      timeline.pause?.();
      timeline.seek?.(at, false);
    }
  }, time);
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  await new Promise((resolve) => setTimeout(resolve, 40));
}

interface WrapperState {
  transform: string;
  opacity: string;
}

async function wrapperState(
  page: import("puppeteer-core").Page,
  selector: string,
): Promise<WrapperState | undefined> {
  return await page.evaluate((sel: string) => {
    const element = document.querySelector(sel);
    if (!element) return undefined;
    const style = getComputedStyle(element as Element);
    return { transform: style.transform, opacity: style.opacity };
  }, selector);
}

function stateMoved(a: WrapperState | undefined, b: WrapperState | undefined): boolean {
  if (!a || !b) return false;
  return a.transform !== b.transform || a.opacity !== b.opacity;
}

/** Group consecutive low-delta curve points into named quiet windows. */
export function quietWindowsFromCurve(
  curve: Array<{ time: number; delta: number }>,
  threshold = QUIET_DELTA,
  minimumSpanSec = 0.8,
): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  for (let index = 0; index < curve.length; index += 1) {
    const point = curve[index]!;
    if (point.delta < threshold) {
      start ??= curve[index - 1]?.time ?? point.time;
      continue;
    }
    // This sample saw change again, so the frozen span ended at the previous
    // sample — the current interval is active and must not pad the window.
    const end = curve[index - 1]?.time ?? point.time;
    if (start !== undefined && end - start >= minimumSpanSec) {
      windows.push({ start: roundTime(start), end: roundTime(end) });
    }
    start = undefined;
  }
  const last = curve[curve.length - 1];
  if (start !== undefined && last && last.time - start >= minimumSpanSec) {
    windows.push({ start: roundTime(start), end: roundTime(last.time) });
  }
  return windows;
}

export async function reportTemporalEvidence(
  projectDir: string,
  options: { framesPerShot?: number; curveStepSec?: number } = {},
): Promise<TemporalReport> {
  const browserPath = findBrowserExecutable();
  if (!browserPath) throw new Error("no Chrome/Edge found for temporal evidence capture");
  const current = loadDirectComposition(projectDir);
  const { manifest } = current;
  const cuts = resolveCutPlan(manifest.scenes).cuts;
  const outDir = path.join(projectDir, "build", "qa", "temporal");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const framesPerShot = Math.max(3, Math.min(7, options.framesPerShot ?? 5));
  const interiorFractions = Array.from(
    { length: framesPerShot },
    (_, index) => 0.08 + (0.84 * index) / (framesPerShot - 1),
  );
  const shotFrames = manifest.scenes.map((scene) => ({
    scene,
    times: interiorFractions.map((fraction) =>
      roundTime(scene.startSec + scene.durationSec * fraction)
    ),
  }));
  const cutFrames = cuts.map((cut) => ({
    cut,
    times: [
      cut.atSec - cut.exitSec,
      cut.atSec - 0.04,
      cut.atSec + 0.04,
      cut.atSec + cut.entrySec / 2,
      cut.atSec + cut.entrySec,
    ].map((time) => roundTime(Math.min(Math.max(time, 0), manifest.durationSec))),
  }));
  const curveStep = Math.max(0.2, options.curveStepSec ?? manifest.durationSec / 56);
  const curveTimes: number[] = [];
  for (let time = 0; time <= manifest.durationSec + 0.001; time += curveStep) {
    curveTimes.push(roundTime(Math.min(time, manifest.durationSec)));
  }
  const allTimes = [...new Set([
    ...shotFrames.flatMap((entry) => entry.times),
    ...cutFrames.flatMap((entry) => entry.times),
    ...curveTimes,
  ])].sort((a, b) => a - b);

  // Evidence times are content (timeline) time; the registered timeline is
  // the warped master (output time) when the film ramps, so the physical
  // seek converts. Strip labels carry both bases when they differ.
  const timeRampPlan = parseTimeRampPlan(current.html).plan;
  const toOutputTime = warpInverseOf(timeRampPlan);
  const frameLabel = (time: number): string => {
    const viewer = toOutputTime(time);
    return Math.abs(viewer - time) > 0.01
      ? `${time.toFixed(2)}s→${viewer.toFixed(2)}v`
      : `${time.toFixed(2)}s`;
  };

  const server = await serveDir(path.join(projectDir, "composition"));
  let browser: import("puppeteer-core").Browser | undefined;
  try {
    browser = await launchHeadlessBrowser({
      executablePath: browserPath,
      headless: true,
      args: [
        "--hide-scrollbars",
        "--mute-audio",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({
      width: manifest.width,
      height: manifest.height,
      deviceScaleFactor: FRAME_WIDTH / manifest.width,
    });
    await page.goto(`${server.url}/index.html`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForFunction(
      (id: string) => Boolean(
        (window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.[id],
      ),
      { timeout: 15_000 },
      manifest.compositionId,
    );
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready);

    // Promised-versus-observed: measure each boundary's wrapper (or bridge)
    // state on both sides of its motion window before any screenshot pass.
    const cutObservations: Array<{ cut: CutIntentV1; outgoingMoved: boolean; incomingMoved: boolean }> = [];
    for (const cut of cuts) {
      const toSelector = `[data-scene="${cut.toScene}"]`;
      const outgoingSelector = temporalOutgoingCutSelector(cut);
      await seekTo(page, toOutputTime(Math.max(0, cut.atSec - cut.exitSec + 0.02)));
      const outgoingBefore = await wrapperState(page, outgoingSelector);
      await seekTo(page, toOutputTime(cut.atSec - 0.02));
      const outgoingAfter = await wrapperState(page, outgoingSelector);
      await seekTo(page, toOutputTime(cut.atSec + 0.02));
      const incomingBefore = await wrapperState(page, toSelector);
      await seekTo(page, toOutputTime(Math.min(manifest.durationSec, cut.atSec + cut.entrySec - 0.02)));
      const incomingAfter = await wrapperState(page, toSelector);
      cutObservations.push({
        cut,
        outgoingMoved: stateMoved(outgoingBefore, outgoingAfter),
        incomingMoved: stateMoved(incomingBefore, incomingAfter),
      });
    }

    const frames = new Map<number, string>();
    for (const time of allTimes) {
      await seekTo(page, toOutputTime(time));
      const shot = await page.screenshot({ encoding: "base64", type: "png" });
      frames.set(time, `data:image/png;base64,${shot}`);
    }

    // Higher-resolution playback evidence for developer A/B review. Browser
    // QA already records a bounded 5 Hz advisory series at publication; the
    // explicit temporal inspector can afford a denser 8 Hz pass (still capped)
    // and persists it beside the direction score in motion-plan.json.
    let continuousMotion: ContinuousMotionEvidenceV1 | undefined;
    if (continuousMotionEvidenceEnabled() && manifest.durationSec >= 8) {
      continuousMotion = await captureContinuousMotionEvidence(
        page,
        manifest.scenes,
        manifest.durationSec,
        { width: manifest.width, height: manifest.height },
        { sampleHz: 8, maxSamples: 220, mapSeekTime: toOutputTime },
      );
    }

    // A blank compositor page assembles the sheets and computes pixel deltas;
    // the composition page itself stays untouched.
    const compositor = await browser.newPage();
    await compositor.goto("about:blank");
    const frameHeight = Math.round((manifest.height / manifest.width) * FRAME_WIDTH);
    await compositor.evaluate(`(() => {
      const FRAME_W = ${FRAME_WIDTH};
      const FRAME_H = ${frameHeight};
      const LABEL_H = ${LABEL_HEIGHT};
      const cache = new Map();
      const load = (dataUrl) => {
        if (cache.has(dataUrl)) return cache.get(dataUrl);
        const promise = new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("frame decode failed"));
          image.src = dataUrl;
        });
        cache.set(dataUrl, promise);
        return promise;
      };
      window.__composeSheet = async (rows) => {
        const columns = Math.max(...rows.map((row) => row.frames.length));
        const canvas = document.createElement("canvas");
        canvas.width = columns * (FRAME_W + 8) + 8;
        canvas.height = rows.length * (FRAME_H + LABEL_H + 8) + 8;
        const context = canvas.getContext("2d");
        context.fillStyle = "#131017";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.textBaseline = "middle";
        for (let r = 0; r < rows.length; r += 1) {
          const row = rows[r];
          const y = 8 + r * (FRAME_H + LABEL_H + 8);
          for (let c = 0; c < row.frames.length; c += 1) {
            const frame = row.frames[c];
            const x = 8 + c * (FRAME_W + 8);
            const image = await load(frame.dataUrl);
            context.drawImage(image, x, y, FRAME_W, FRAME_H);
            context.fillStyle = "#9b92a8";
            context.font = "11px monospace";
            context.fillText(frame.label, x + 2, y + FRAME_H + LABEL_H / 2);
          }
          context.fillStyle = "#f4f1f7";
          context.font = "bold 11px monospace";
          context.fillText(row.title, 8, y + FRAME_H + LABEL_H / 2 - 11);
        }
        return canvas.toDataURL("image/png");
      };
      window.__frameDelta = async (aUrl, bUrl) => {
        const w = 160;
        const h = Math.round((FRAME_H / FRAME_W) * 160);
        const canvasA = document.createElement("canvas");
        const canvasB = document.createElement("canvas");
        canvasA.width = canvasB.width = w;
        canvasA.height = canvasB.height = h;
        const [imageA, imageB] = await Promise.all([load(aUrl), load(bUrl)]);
        const contextA = canvasA.getContext("2d", { willReadFrequently: true });
        const contextB = canvasB.getContext("2d", { willReadFrequently: true });
        contextA.drawImage(imageA, 0, 0, w, h);
        contextB.drawImage(imageB, 0, 0, w, h);
        const a = contextA.getImageData(0, 0, w, h).data;
        const b = contextB.getImageData(0, 0, w, h).data;
        let total = 0;
        for (let index = 0; index < a.length; index += 4) {
          total += Math.abs(a[index] - b[index]) +
            Math.abs(a[index + 1] - b[index + 1]) +
            Math.abs(a[index + 2] - b[index + 2]);
        }
        return total / (a.length / 4) / (3 * 255);
      };
    })()`);

    const composeSheet = async (
      rows: Array<{ title: string; frames: Array<{ label: string; dataUrl: string }> }>,
      file: string,
    ): Promise<string> => {
      const dataUrl = await compositor.evaluate(
        (payload: unknown) => (window as unknown as {
          __composeSheet: (rows: unknown) => Promise<string>;
        }).__composeSheet(payload),
        rows,
      );
      const target = path.join(outDir, file);
      fs.writeFileSync(target, Buffer.from(dataUrl.split(",", 2)[1]!, "base64"));
      return target;
    };

    const stripPath = await composeSheet(
      shotFrames.map(({ scene, times }) => ({
        title: `${scene.id} (${scene.startSec}–${roundTime(scene.startSec + scene.durationSec)}s)`,
        frames: times.map((time) => ({ label: frameLabel(time), dataUrl: frames.get(time)! })),
      })),
      "strip.png",
    );

    const cutEvidence: TemporalCutEvidence[] = [];
    for (const [index, { cut, times }] of cutFrames.entries()) {
      const labels = ["exit start", "pre-cut", "post-cut", "mid entry", "settled"];
      const file = `cut-${cut.fromScene}--${cut.toScene}.png`;
      const triptychPath = await composeSheet(
        [{
          title: `${cut.fromScene} → ${cut.toScene} · ${cut.style} @ ${cut.atSec}s`,
          frames: times.map((time, column) => ({
            label: `${labels[column]} ${time.toFixed(2)}s`,
            dataUrl: frames.get(time)!,
          })),
        }],
        file,
      );
      const observed = cutObservations[index]!;
      cutEvidence.push({
        fromScene: cut.fromScene,
        toScene: cut.toScene,
        style: cut.style,
        atSec: cut.atSec,
        outgoingMoved: observed.outgoingMoved,
        incomingMoved: observed.incomingMoved,
        triptychPath,
      });
    }

    const changeCurve: Array<{ time: number; delta: number }> = [];
    for (let index = 1; index < curveTimes.length; index += 1) {
      const previous = curveTimes[index - 1]!;
      const time = curveTimes[index]!;
      const delta = await compositor.evaluate(
        (a: string, b: string) => (window as unknown as {
          __frameDelta: (a: string, b: string) => Promise<number>;
        }).__frameDelta(a, b),
        frames.get(previous)!,
        frames.get(time)!,
      );
      changeCurve.push({ time, delta: Math.round(delta * 100000) / 100000 });
    }
    const quietWindows = quietWindowsFromCurve(changeCurve);

    const jsonPath = path.join(outDir, "temporal.json");
    fs.writeFileSync(jsonPath, JSON.stringify({
      version: 2,
      compositionId: manifest.compositionId,
      revision: manifest.revision,
      durationSec: manifest.durationSec,
      cuts: cutEvidence.map(({ triptychPath: _path, ...cut }) => cut),
      changeCurve,
      quietWindows,
      ...(continuousMotion ? { continuousMotion } : {}),
    }, null, 2) + "\n");
    if (continuousMotion) {
      const motionPlanPath = path.join(projectDir, "composition", "motion-plan.json");
      try {
        const motionPlan = JSON.parse(fs.readFileSync(motionPlanPath, "utf8")) as Record<string, unknown>;
        writeJsonAtomic(motionPlanPath, { ...motionPlan, continuousMotion });
      } catch (error) {
        process.stderr.write(
          `[temporal] could not persist continuous motion evidence: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    }

    const cutLines = cutEvidence.map((cut) =>
      `  ${cut.fromScene} → ${cut.toScene} · ${cut.style}: ` +
      `outgoing ${cut.outgoingMoved ? "MOVES" : "STATIC ⚠"} · ` +
      `incoming ${cut.incomingMoved ? "SETTLES" : "STATIC ⚠"}`
    );
    const quietLines = quietWindows.length
      ? quietWindows.map((window) => `  ${window.start}s–${window.end}s`)
      : ["  none"];
    const summary = [
      `temporal evidence · revision ${manifest.revision} · ${allTimes.length} frames sampled`,
      `strip: ${stripPath}`,
      `cut boundaries (${cutEvidence.length}):`,
      ...cutLines,
      "quiet windows (verify each is an intentional hold):",
      ...quietLines,
      ...(continuousMotion
        ? [
            "continuous motion (advisory):",
            `  focal visible min/mean ${(continuousMotion.summary.minimumVisibleFraction * 100).toFixed(1)}%/` +
              `${(continuousMotion.summary.meanVisibleFraction * 100).toFixed(1)}% · ` +
              `occupancy min/mean ${(continuousMotion.summary.minimumOccupancyFraction * 100).toFixed(1)}%/` +
              `${(continuousMotion.summary.meanOccupancyFraction * 100).toFixed(1)}%`,
            `  peak speed ${continuousMotion.summary.peakSpeed.toFixed(3)} diag/s · ` +
              `${continuousMotion.summary.reversalCount} reversal(s) · ` +
              `${continuousMotion.summary.jerkMarkerCount} jerk marker(s)`,
            `  settles ${continuousMotion.summary.settledByWindowEndCount}/` +
              `${continuousMotion.summary.measuredSettleWindowCount} measured ` +
              `(${continuousMotion.summary.settleWindowCount} directed) · ` +
              `max independent motion ${continuousMotion.summary.maxIndependentMotionCount}`,
            ...continuousMotion.advisories.map((entry) => `  advisory: ${entry}`),
          ]
        : []),
    ].join("\n");
    return {
      summary,
      stripPath,
      jsonPath,
      cuts: cutEvidence,
      changeCurve,
      quietWindows,
      ...(continuousMotion ? { continuousMotion } : {}),
    };
  } finally {
    await browser?.close().catch(() => {});
    server.close();
  }
}
