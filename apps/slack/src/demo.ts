/**
 * The `/sequences demo` payload — a curated, deterministic launch reel.
 *
 * This is the one path that must NEVER fail a demo: no modal to fill, no model
 * call, no API key. We hand-author a known-good Plan (still routed through
 * planToCommands → ProjectStore.apply → solver → linter, so the 9 laws and the
 * quality story hold) and let the engine produce thumbnails + MP4. It doubles as
 * the smoke fixture for the create → thumbnails → upload path.
 */
import type { Plan, Project } from "@sequences/core";
import type { BriefFields } from "./orchestrator.ts";

/** Product identity for the canned demo (a believable release: "Relay v2"). */
export const DEMO_BRIEF: BriefFields & { brandName: string } = {
  product: "Relay",
  brandName: "Relay",
  whatShipped: "Relay v2: sub-100ms traces, 1-click rollback, 40% faster cold starts",
  audience: "backend engineers evaluating observability tools",
  tone: "crisp-saas",
  lengthSec: 30,
};

/**
 * Build the curated five-beat reel: hook → feature proof → metric → trust → CTA.
 * The feature scene references the seeded dashboard screenshot when present (the
 * project is initialized with `seedScreenshot: true`), and is skipped otherwise
 * so the plan still validates without media.
 */
export function buildDemoPlan(project: Project): Plan {
  const screenshot = project.assets.find((asset) => asset.kind === "image");

  const scenes: Plan["scenes"] = [
    {
      archetype: "hook-opener",
      slots: {
        headline: "Relay v2 is live",
        // Kept short so it reads inside the 3s hook (the 40% metric gets its own
        // stat beat below — no need to cram it here).
        subline: "Sub-100ms traces, 1-click rollback",
      },
      camera: { move: "pushIn", scale: "subtle" },
    },
  ];

  if (screenshot) {
    scenes.push({
      archetype: "feature-reveal",
      layout: "media-right",
      slots: {
        headline: "See every trace in real time",
        media: { assetId: screenshot.id },
        bullets: ["Sub-100ms traces", "1-click rollback", "Live flamegraphs"],
      },
    });
  }

  scenes.push(
    {
      archetype: "stat-callout",
      slots: {
        stat: { value: 40, prefix: "", suffix: "%" },
        caption: "faster cold starts",
      },
    },
    {
      archetype: "social-proof",
      slots: {
        quote: "We cut incident response from hours to minutes.",
        source: "Platform lead, Northwind",
      },
    },
    {
      archetype: "logo-sting-cta",
      slots: {
        tagline: "Ship with confidence",
        cta: "Try Relay",
      },
    },
  );

  return { motionProfile: "crisp-saas", scenes };
}
