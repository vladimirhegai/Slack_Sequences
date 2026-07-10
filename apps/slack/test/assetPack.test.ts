/**
 * Pack-wide contract coverage: every library asset (not just the reference)
 * proves determinism, param clamping/escaping, brand-token theming, spring
 * (never linear) motion, an in-film choreography (exactly one trigger:"enter",
 * sequenced payoffs), and an honest silhouette family. Generic by design —
 * a newly registered asset is covered the moment it joins ASSET_LIBRARY.
 */
import { describe, expect, it } from "vitest";
import {
  assetAnimationTotalSec,
  assetPluginSpecs,
  compileAssetAnimationGsap,
  renderAssetInstance,
} from "../src/engine/assetContract.ts";
import { ASSET_LIBRARY } from "../src/engine/assets/index.ts";
import { deriveTopic } from "../src/engine/seedContent.ts";
import { createSeededRandom } from "../src/engine/pluginKernel.ts";
import type { PluginLowerContext } from "../src/engine/pluginContract.ts";

const FAMILIES = new Set(["pill", "bar", "card", "circle", "window"]);

function lowerContext(overrides: Partial<PluginLowerContext> = {}): PluginLowerContext {
  return {
    sceneId: "s1",
    startSec: 4,
    durationSec: 6,
    id: "unit",
    uid: "s1-unit",
    params: {},
    topic: deriveTopic("probe"),
    rng: createSeededRandom("probe"),
    ...overrides,
  };
}

describe("asset pack", () => {
  it("covers all five silhouette families", () => {
    const families = new Set(ASSET_LIBRARY.map((asset) => asset.family));
    expect([...families].sort()).toEqual([...FAMILIES].sort());
    expect(ASSET_LIBRARY.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps a complete SaaS award claim instead of truncating the product category", () => {
    const laurel = ASSET_LIBRARY.find((asset) => asset.id === "laurel-badge")!;
    const rendered = renderAssetInstance(laurel, { title: "#1 Revenue Analytics" });
    expect(rendered.markup).toContain("#1 Revenue Analytics");
    expect(rendered.notes).toEqual([]);
    expect(laurel.style).toContain("text-wrap: balance");
  });

  for (const asset of ASSET_LIBRARY) {
    describe(asset.id, () => {
      it("renders deterministically with defaults and escapes injected copy", () => {
        const a = renderAssetInstance(asset, {}, { partId: "probe" });
        const b = renderAssetInstance(asset, {}, { partId: "probe" });
        expect(a.markup).toBe(b.markup);
        expect(a.markup).toContain(`data-asset="${asset.id}"`);
        expect(a.markup).toContain(`data-component="asset"`);
        expect(a.markup).toContain(`data-part="probe"`);
        const textParam = asset.params.find((param) => param.kind === "text");
        if (textParam) {
          const hostile = renderAssetInstance(asset, {
            [textParam.name]: `<script>alert(1)</script>`,
          });
          expect(hostile.markup).not.toContain("<script>alert(1)");
        }
      });

      it("clamps numeric params and rejects unsafe colors", () => {
        const raw: Record<string, string | number> = {};
        for (const param of asset.params) {
          if (param.kind === "number") raw[param.name] = 1e9;
          if (param.kind === "color") raw[param.name] = "red;}body{background:url(evil)";
          if (param.kind === "enum") raw[param.name] = "not-an-option";
        }
        const instance = renderAssetInstance(asset, raw);
        for (const param of asset.params) {
          if (param.kind === "number" && param.max !== undefined) {
            expect(Number(instance.params[param.name])).toBeLessThanOrEqual(param.max);
          }
          if (param.kind === "color" || param.kind === "enum") {
            expect(instance.params[param.name]).toBe(param.default);
          }
        }
      });

      it("themes through brand tokens with fallbacks", () => {
        // Every asset must retheme from frame.md for free: its stylesheet
        // reads at least one shared token, always with a fallback.
        expect(asset.style).toMatch(
          /var\(--(accent-text|accent|surface-2|surface|text|muted|canvas|cinema-radius|cinema-edge)[,)]/,
        );
      });

      it("declares exactly one enter animation and only spring motion", () => {
        const enters = asset.animations.filter((animation) => animation.trigger === "enter");
        expect(enters).toHaveLength(1);
        for (const animation of asset.animations) {
          const compiled = compileAssetAnimationGsap(animation, {});
          expect(compiled.ease[0]).toBe(0);
          expect(compiled.ease[compiled.ease.length - 1]).toBe(1);
          expect(compiled.legSec).toBeGreaterThan(0.05);
          // A pure line 0→1 would mean a linear curve slipped in: the sampled
          // spring must deviate from linearity somewhere.
          const linearDeviation = compiled.ease.reduce((worst, value, index) => {
            const linear = index / (compiled.ease.length - 1);
            return Math.max(worst, Math.abs(value - linear));
          }, 0);
          expect(linearDeviation).toBeGreaterThan(0.02);
        }
        // Enter animations never start from scale(0) — unnatural motion.
        const enter = enters[0]!;
        const scaleTrack = enter.tracks.find((track) => track.property === "scale");
        if (scaleTrack && typeof scaleTrack.from === "number") {
          expect(scaleTrack.from).toBeGreaterThanOrEqual(0.5);
        }
      });

      it("lowers to one internal asset component plus sequenced animate beats", () => {
        const spec = assetPluginSpecs([asset])[0]!;
        expect(spec.kind).toBe(`asset-${asset.id}`);
        const lowering = spec.lower(lowerContext());
        expect(lowering.components).toHaveLength(1);
        expect(lowering.components[0]).toMatchObject({
          id: "unit-core",
          kind: "asset",
          pluginUid: "s1-unit",
        });
        const payoffs = asset.animations.filter((animation) => animation.trigger === "payoff");
        expect(lowering.beats).toHaveLength(1 + payoffs.length);
        for (const beat of lowering.beats) {
          expect(beat.kind).toBe("animate");
          expect(beat.component).toBe("unit-core");
          expect(beat.animation).toBeTruthy();
          expect(beat.atSec).toBeGreaterThanOrEqual(4);
          expect(beat.atSec).toBeLessThanOrEqual(10);
        }
        // Sequenced, never overlapping: each beat starts after the previous
        // one's window (same dedupe channel — overlap would drop the payoff).
        for (let i = 1; i < lowering.beats.length; i += 1) {
          const previous = lowering.beats[i - 1]!;
          expect(lowering.beats[i]!.atSec).toBeGreaterThanOrEqual(
            previous.atSec + (previous.durationSec ?? 0),
          );
        }
        // Purity: same context, same bytes and beats.
        const again = spec.lower(lowerContext());
        expect(again.markup).toBe(lowering.markup);
        expect(again.beats).toEqual(lowering.beats);
      });

      it("waits for the camera arrival when the unit is framed late", () => {
        const spec = assetPluginSpecs([asset])[0]!;
        const early = spec.lower(lowerContext());
        const late = spec.lower(lowerContext({ arrivalSec: 6.4 }));
        expect(late.beats[0]!.atSec).toBeGreaterThan(early.beats[0]!.atSec);
      });

      it("keeps a sane total choreography for a 6s shot", () => {
        const total = asset.animations
          .filter((animation) => animation.trigger === "enter" || animation.trigger === "payoff")
          .reduce((sum, animation) => sum + assetAnimationTotalSec(animation), 0);
        expect(total).toBeLessThanOrEqual(3.5);
      });
    });
  }
});
