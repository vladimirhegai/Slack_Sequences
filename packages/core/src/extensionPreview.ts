/**
 * Live extension previews — one tiny, real Project per registry entry, built
 * so the studio's Extensions page can COMPILE it (never pre-render it) and play
 * the result in a HyperFrames player. The same compiler/primitive/solver path
 * the product uses everywhere drives the demo, so a card can never drift from
 * what the extension actually does — and Phase-2 sliders just re-parameterize
 * the override here instead of regenerating a frozen GIF.
 *
 * Pure, zero IO: returns a `Project`; the host compiles it. Mirrors the probe
 * project in studio/thumbs.ts, but per-entry and across every extension type.
 */
import type { LayerOverride, Project, Scene, SlotValue } from "./schema.ts";
import { PRIMITIVES } from "./registry/primitives.ts";
import { ARCHETYPES } from "./registry/archetypes.ts";
import { PROFILES } from "./registry/profiles.ts";
import { CAMERA_MOVES } from "./registry/camera.ts";

export type ExtensionPreviewType = "primitive" | "archetype" | "profile" | "camera";

/** 16:9 demo stage — lighter than 1080p, plenty for a card preview. */
const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 720;

/** Human label for an id — kept in lockstep with the page's extensionTitle. */
export function extensionDisplayTitle(id: string): string {
  const raw = id.includes(".") ? (id.split(".").pop() ?? id) : id;
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "saas") return "SaaS";
      if (lower === "cta") return "CTA";
      if (lower === "ui") return "UI";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function baseProject(title: string, motionProfile: string, brandName: string): Project {
  return {
    schemaVersion: 3,
    meta: { title, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, fps: 30, background: "surface" },
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
    motionProfile,
    extensions: { enabled: null },
    scenes: [],
    transitions: {},
    assets: [],
    audio: [],
  };
}

/**
 * A single text headline that performs exactly the demoed primitive. Enter
 * primitives play on arrival; everything else gets a quiet fade-in first so the
 * demoed phase (exit / emphasis / continuous) is the only loud motion.
 */
function primitivePreview(id: string): Project {
  const primitive = PRIMITIVES[id];
  if (!primitive) throw new Error(`unknown primitive: ${id}`);
  const title = extensionDisplayTitle(id);
  const project = baseProject(`${title} preview`, "crisp-saas", "Acme");

  const override: LayerOverride = {};
  let durationFrames: number;
  if (primitive.kind === "enter") {
    override.enterPrimitive = id;
    durationFrames = 75;
  } else {
    // Quiet arrival, then the demoed phase is the star.
    override.enterPrimitive = "enter.fadeIn";
    override.enterDuration = "quick";
    if (primitive.kind === "exit") {
      override.exitPrimitive = id;
      durationFrames = 96;
    } else if (primitive.kind === "emphasis") {
      override.emphasisPrimitive = id;
      override.emphasisAtFrame = 26;
      durationFrames = 90;
    } else {
      override.continuousPrimitive = id;
      durationFrames = 110;
    }
  }

  project.scenes.push({
    id: "demo",
    archetype: "hook-opener",
    durationFrames,
    slots: { headline: title },
    choreography: { settleGap: "instant" },
    overrides: { headline: override, "decor-glow": { hidden: true } },
  } satisfies Scene as Scene);
  return project;
}

/** Representative slot content so each archetype's layout reads on its own. */
function archetypeSlots(id: string): Record<string, SlotValue> {
  switch (id) {
    case "hook-opener":
      return { headline: "Ship insights, not spreadsheets", subline: "Product data in. Answers out." };
    case "feature-reveal":
      return {
        headline: "Your whole funnel, live",
        bullets: ["Realtime dashboards", "Alerts that matter", "One-click reports"],
      };
    case "stat-callout":
      return { stat: { value: 1280, prefix: "", suffix: "+" }, caption: "teams ship faster every week" };
    case "logo-sting-cta":
      return { tagline: "Analytics for builders", cta: "Start free" };
    case "ui-walkthrough":
      return {
        headline: "From question to answer",
        steps: ["Ask in plain English", "Watch the query build", "Share the live chart"],
      };
    case "social-proof":
      return {
        quote: "We replaced three dashboards on day one.",
        source: "Maya Chen — CTO, Northbeam",
        logos: ["NORTHBEAM", "LINEAR", "ARC"],
      };
    case "stat-chart":
      return {
        headline: "Weekly active teams",
        values: ["Mon:3", "Tue:5", "Wed:4", "Thu:7", "Fri:9"],
        caption: "Up and to the right",
      };
    default:
      return { headline: extensionDisplayTitle(id) };
  }
}

function archetypePreview(id: string): Project {
  const archetype = ARCHETYPES[id];
  if (!archetype) throw new Error(`unknown archetype: ${id}`);
  const project = baseProject(`${extensionDisplayTitle(id)} preview`, "crisp-saas", "Acme");
  project.scenes.push({
    id: "demo",
    archetype: id,
    durationFrames: 120,
    slots: archetypeSlots(id),
    choreography: {},
    overrides: {},
  } satisfies Scene as Scene);
  return project;
}

/**
 * One closing beat (brand · tagline · CTA) animated under the chosen profile —
 * hero, support, and badge roles all show, so the profile's whole selection
 * table is on screen at once.
 */
function profilePreview(id: string): Project {
  const profile = PROFILES[id];
  if (!profile) throw new Error(`unknown profile: ${id}`);
  const project = baseProject(`${extensionDisplayTitle(id)} preview`, id, extensionDisplayTitle(id));
  project.scenes.push({
    id: "demo",
    archetype: "logo-sting-cta",
    durationFrames: 120,
    slots: { tagline: profile.summary.split(".")[0] ?? "Motion profile", cta: "Get started" },
    choreography: {},
    overrides: {},
  } satisfies Scene as Scene);
  return project;
}

/**
 * A held composition the camera move travels across the whole frame. Uses a
 * visible (`hero`) travel — the shipping `subtle` default is sub-perceptual by
 * design and would read as a still in a short loop.
 */
function cameraPreview(id: string): Project {
  const move = CAMERA_MOVES[id as keyof typeof CAMERA_MOVES];
  if (!move) throw new Error(`unknown camera move: ${id}`);
  const project = baseProject(`${extensionDisplayTitle(id)} preview`, "crisp-saas", "Acme");
  project.scenes.push({
    id: "demo",
    archetype: "hook-opener",
    durationFrames: 120,
    slots: { headline: extensionDisplayTitle(id), subline: move.summary.split(".")[0] ?? "" },
    choreography: {},
    overrides: {},
    camera: { move: move.id, scale: "hero" },
  } satisfies Scene as Scene);
  return project;
}

/** Build the throwaway preview Project for one registry entry. Throws if unknown. */
export function extensionPreviewProject(type: ExtensionPreviewType, id: string): Project {
  switch (type) {
    case "primitive":
      return primitivePreview(id);
    case "archetype":
      return archetypePreview(id);
    case "profile":
      return profilePreview(id);
    case "camera":
      return cameraPreview(id);
    default:
      throw new Error(`unknown extension preview type: ${type as string}`);
  }
}
