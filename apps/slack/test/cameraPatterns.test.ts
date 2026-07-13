import { describe, expect, it } from "vitest";
import { CAMERA_MOVES, resolveCameraPlan } from "../src/engine/cameraContract.ts";
import { CAMERA_PATTERNS } from "../src/engine/cameraPatterns.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

describe("camera pattern catalog", () => {
  it("exposes the curated discovery patterns", () => {
    expect(CAMERA_PATTERNS.map((pattern) => pattern.id)).toEqual([
      "text-runway",
      "push-and-hold",
      "pullback-system-reveal",
      "lateral-stations",
      "proof-track",
      "snap-to-proof",
      "hero-arc-landing",
      "compare-swing",
      "vertical-feature-descent",
      "cursor-result-chase",
      "notification-escalation",
      "logo-product-reveal",
      "pricing-choice-focus",
      "integration-depth-network",
    ]);
  });

  it("keeps schematic stations and typed camera targets in one closed world", () => {
    for (const pattern of CAMERA_PATTERNS) {
      const stationIds = new Set(pattern.stations.map((station) => station.id));
      expect(stationIds.size, pattern.id).toBe(pattern.stations.length);
      expect(pattern.camera.version, pattern.id).toBe(1);
      expect(pattern.camera.path[0]?.startSec, pattern.id).toBe(0);

      let cursor = 0;
      for (const move of pattern.camera.path) {
        expect(move.version, `${pattern.id}/${move.move}`).toBe(1);
        expect(CAMERA_MOVES.has(move.move), `${pattern.id}/${move.move}`).toBe(true);
        expect(move.startSec, `${pattern.id}/${move.move}`).toBeCloseTo(cursor, 6);
        expect(move.durationSec, `${pattern.id}/${move.move}`).toBeGreaterThan(0);
        for (const target of [move.fromRegion, move.toRegion]) {
          if (target) expect(stationIds.has(target), `${pattern.id}/${target}`).toBe(true);
        }
        cursor = move.startSec + move.durationSec;
      }
      expect(cursor, pattern.id).toBeCloseTo(pattern.durationSec, 6);
    }
  });

  it("resolves every pattern through the production camera contract", () => {
    for (const pattern of CAMERA_PATTERNS) {
      const scene: DirectScene = {
        id: pattern.id,
        title: pattern.title,
        purpose: pattern.purpose,
        startSec: 0,
        durationSec: pattern.durationSec,
        camera: pattern.camera,
      };
      const resolved = resolveCameraPlan([scene]);
      expect(resolved.scenes, pattern.id).toHaveLength(1);
      const segments = resolved.scenes[0]!.segments;
      expect(segments.length, pattern.id).toBeGreaterThan(0);
      expect(segments[0]!.startSec, pattern.id).toBe(0);
      expect(segments.at(-1)!.endSec, pattern.id).toBeCloseTo(pattern.durationSec, 6);
    }
  });
});
