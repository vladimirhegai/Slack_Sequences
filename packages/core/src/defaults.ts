/**
 * Factories for new projects.
 *
 * `createDefaultProject` — the minimal 4-beat arc used by `sequences init`,
 * tests, and fixtures. Deliberately plain; many tests depend on its exact
 * shape (scene ids, slots, profile).
 *
 * `createShowcaseProject` — the demo-reel arc (`init --showcase`, the
 * shipped example). Everything Phase 1 can do, hand-tuned: bold-launch
 * profile (charCascade hooks, springs, scale-away exits), product-scene
 * camera moves, kenBurns + floatIdle continuous motion, maskRevealUp where
 * it reads best, and a fade only where the story breathes.
 */
import type { Project } from "./schema.ts";

export function createDefaultProject(options?: {
  title?: string;
  brandName?: string;
  screenshotAssetId?: string | null;
}): Project {
  const title = options?.title ?? "Untitled Promo";
  const brandName = options?.brandName ?? "Acme";
  const screenshot = options?.screenshotAssetId;

  const project: Project = {
    schemaVersion: 3,
    meta: { title, width: 1920, height: 1080, fps: 30, background: "surface" },
    brand: {
      name: brandName,
      colors: {
        primary: "#5B5BF0",
        surface: "#0E1016",
        text: "#F4F5F7",
        muted: "#9BA0AC",
        accent: "#27D9A1",
      },
      fonts: { display: "Segoe UI", body: "Segoe UI" },
    },
    motionProfile: "crisp-saas",
    extensions: { enabled: null },
    scenes: [
      {
        id: "hook",
        archetype: "hook-opener",
        durationFrames: 96, // headroom over the subline's readability minimum
        slots: {
          headline: "Ship insights, not spreadsheets",
          subline: `${brandName} turns raw product data into answers`,
        },
        choreography: {},
        overrides: {},
      },
      ...(screenshot
        ? [
            {
              id: "feature",
              archetype: "feature-reveal",
              durationFrames: 150,
              slots: {
                headline: "Your whole funnel, live",
                media: { assetId: screenshot },
                bullets: ["Realtime dashboards", "Alerts that matter", "One-click reports"],
              },
              choreography: {},
              overrides: {},
              // Slow whole-frame push on the hero beat — the camera demo.
              camera: { move: "pushIn", scale: "subtle" },
            } satisfies Project["scenes"][number],
          ]
        : []),
      {
        id: "stat",
        archetype: "stat-callout",
        durationFrames: 90,
        slots: {
          stat: { value: 12480, prefix: "", suffix: "+" },
          caption: "teams ship faster with " + brandName,
        },
        choreography: {},
        overrides: {},
      },
      {
        id: "sting",
        archetype: "logo-sting-cta",
        durationFrames: 105,
        slots: {
          tagline: "Analytics for builders",
          cta: "Start free today",
        },
        choreography: {},
        overrides: {},
      },
    ],
    transitions: {},
    assets: [],
    audio: [],
  };
  return project;
}

/**
 * The showcase arc — 6 beats, ~22s, steady motion:
 *
 *   hook (charCascade) → feature (maskRevealUp headline, kenBurns hero shot,
 *   pushIn) → walkthrough (pullBack reveal, floating hotspots) → stat
 *   (countUp punch) → social proof (fade out of it) → logo sting
 *   (springy CTA release).
 *
 * Stays strictly on the Phase-1 lattice: every choice here is a token,
 * primitive, or archetype the agent could also have picked.
 */
export function createShowcaseProject(options?: {
  title?: string;
  brandName?: string;
  screenshotAssetId?: string | null;
}): Project {
  const title = options?.title ?? "Launch Promo";
  const brandName = options?.brandName ?? "Pulse";
  const screenshot = options?.screenshotAssetId;

  const project: Project = {
    schemaVersion: 3,
    meta: { title, width: 1920, height: 1080, fps: 30, background: "surface" },
    brand: {
      name: brandName,
      colors: {
        primary: "#5B5BF0",
        surface: "#0E1016",
        text: "#F4F5F7",
        muted: "#9BA0AC",
        accent: "#27D9A1",
      },
      fonts: { display: "Segoe UI", body: "Segoe UI" },
    },
    motionProfile: "bold-launch",
    extensions: { enabled: null },
    scenes: [
      {
        id: "hook",
        archetype: "hook-opener",
        durationFrames: 84,
        slots: {
          headline: "Stop guessing. Start shipping.",
          subline: "Product data in. Answers out.",
        },
        choreography: {},
        overrides: {},
      },
      ...(screenshot
        ? [
            {
              id: "feature",
              archetype: "feature-reveal",
              durationFrames: 126,
              slots: {
                headline: "Your whole funnel. Live.",
                media: { assetId: screenshot },
                bullets: ["Realtime dashboards", "Alerts that matter", "One-click reports"],
              },
              choreography: {},
              // The signature wipe on the headline — contrast against the
              // charCascade heroes around it. Slow duration keeps the hero
              // the loudest motion in the scene (one-loud-motion rule).
              overrides: {
                headline: { enterPrimitive: "enter.maskRevealUp", enterDuration: "slow" },
              },
              camera: { move: "pushIn", scale: "subtle" },
            } satisfies Project["scenes"][number],
            {
              id: "walkthrough",
              archetype: "ui-walkthrough",
              layout: "media-left",
              durationFrames: 150,
              slots: {
                headline: "From question to answer in three clicks",
                media: { assetId: screenshot },
                steps: ["Ask in plain English", "Watch the query build", "Share the live chart"],
              },
              choreography: {},
              // Two floating hotspots are plenty — the third pushes the
              // scene over the motion-density ceiling.
              overrides: { "hotspot-2": { hidden: true } },
              // Open tight on the UI, release wide as the steps land.
              camera: { move: "pullBack", scale: "subtle" },
            } satisfies Project["scenes"][number],
          ]
        : []),
      {
        id: "stat",
        archetype: "stat-callout",
        durationFrames: 90,
        slots: {
          stat: { value: 12480, prefix: "", suffix: "+" },
          caption: `teams ship faster with ${brandName}`,
        },
        choreography: {},
        overrides: {},
      },
      {
        id: "social",
        archetype: "social-proof",
        durationFrames: 108,
        slots: {
          quote: `We replaced three dashboards with ${brandName} on day one.`,
          source: "Maya Chen - CTO, Northbeam",
          logos: ["NORTHBEAM", "LINEAR", "RAYCAST", "ARC"],
        },
        choreography: {},
        overrides: {},
      },
      {
        id: "sting",
        archetype: "logo-sting-cta",
        durationFrames: 105,
        slots: {
          tagline: "Analytics for builders",
          cta: "Start free today",
        },
        choreography: {},
        overrides: {},
      },
    ],
    // Hard cuts everywhere except one fade where the story exhales.
    transitions: { social: "fade" },
    assets: [],
    audio: [],
  };
  return project;
}
