/**
 * Recipe Studio canvas compiler — structural guarantees (plan §11 golden-output).
 *
 * These are fast unit checks over the compiler's OUTPUT contract (no browser).
 * The end-to-end gate-green proof lives in `npm run studio:canvas` (real static
 * gate + browser QA + thumbnails); this file guards the seams a refactor could
 * silently break: catalog markup reuse, ABSOLUTE camera times, host-island
 * injection, and declared-moment derivation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  starterCanvasFilm,
  validateCanvasFilm,
  type CanvasFilm,
} from "../studio/canvasModel.ts";
import { compileCanvasFilm, renderCatalogComponent } from "../studio/compileCanvas.ts";
import { resolveCameraPlan } from "../src/engine/cameraContract.ts";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "studio-canvas-test-"));
}

describe("validateCanvasFilm", () => {
  it("accepts the starter film", () => {
    expect(validateCanvasFilm(starterCanvasFilm())).toEqual([]);
  });

  it("rejects duplicate component ids (they are film-global data-parts)", () => {
    const film = starterCanvasFilm();
    film.scenes[0].stations[0].components[0].id = "latency-stat"; // collides with proof
    expect(validateCanvasFilm(film).some((e) => /duplicate component id/.test(e))).toBe(true);
  });

  it("rejects an unknown component kind and a camera target outside the scene", () => {
    const film = starterCanvasFilm();
    (film.scenes[0].stations[0].components[0] as { kind: string }).kind = "nope";
    film.scenes[1].camera[1].toRegion = "does-not-exist";
    const errors = validateCanvasFilm(film);
    expect(errors.some((e) => /unknown kind/.test(e))).toBe(true);
    expect(errors.some((e) => /not in scene/.test(e))).toBe(true);
  });
});

describe("renderCatalogComponent", () => {
  it("reuses catalog markup verbatim, retargeting only the data-part and copy", () => {
    const markup = renderCatalogComponent({ id: "my-stat", kind: "stat-card", copy: "9.9ms" });
    expect(markup).toContain('data-component="stat-card"'); // catalog structure kept
    expect(markup).toContain('data-part="my-stat"'); // instance id substituted
    expect(markup).toContain("9.9ms"); // copy filled into the value slot
    expect(markup).not.toContain("142ms"); // catalog placeholder replaced
  });
});

describe("compileCanvasFilm", () => {
  it("compiles the starter film with ABSOLUTE camera times and injected host islands", () => {
    const dir = tempDir();
    try {
      const draft = compileCanvasFilm(dir, starterCanvasFilm());
      // Component markup is present with instance data-parts.
      expect(draft.html).toContain('data-part="latency-stat"');
      expect(draft.html).toContain('data-part="hook-headline"');
      // The camera plan island was injected → the resolver accepted the path,
      // which only happens when times are ABSOLUTE composition seconds.
      expect(draft.html).toMatch(/id="sequences-camera"/);
      expect(draft.html).toContain("SequencesCamera.compile");
      // The proof scene's camera move shifted by the scene start (4.2s).
      const proof = draft.storyboard.find((s) => s.id === "proof")!;
      expect(proof.camera).toBeDefined();
      const holdStart = proof.camera!.path[0].startSec;
      expect(holdStart).toBeGreaterThanOrEqual(proof.startSec - 0.01);
      // resolveCameraPlan yields segments for the proof scene (empty if times were relative).
      const plan = resolveCameraPlan(draft.storyboard);
      expect(plan.scenes.find((s) => s.sceneId === "proof")?.segments.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("declares moments at settled times (never at scene start) with subject ids", () => {
    const dir = tempDir();
    try {
      const draft = compileCanvasFilm(dir, starterCanvasFilm());
      const allMoments = draft.storyboard.flatMap((s) => s.moments ?? []);
      expect(allMoments.length).toBeGreaterThanOrEqual(7); // floor for a 14s film
      // No moment sits exactly on a scene boundary (the blank-frame class).
      for (const scene of draft.storyboard) {
        for (const moment of scene.moments ?? []) {
          expect(moment.atSec).toBeGreaterThan(scene.startSec + 0.05);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits a single-station scene as a flat centered stage (no camera world)", () => {
    const film: CanvasFilm = starterCanvasFilm();
    const draft = compileCanvasFilm(tempDir(), { ...film, scenes: [film.scenes[0]] });
    // Hook has one station and no camera → no data-camera-world for it.
    expect(draft.html).toContain("canvas-flat");
  });
});
