/**
 * Recipe Studio — the canvas state model (plan §2, §4).
 *
 * The canvas editor is a WYSIWYG surface for the SAME five host-owned contracts
 * the live agents emit (camera, cuts, components, interactions, timeRamp) over
 * the engine's continuous spatial world (`data-camera-world` + `data-region`
 * stations). This file is the TYPED source of truth an operator manipulates;
 * `compileCanvas.ts` turns it — deterministically, zero tokens — into a
 * `{ html, storyboard }` draft that the REAL production gate judges.
 *
 * Invariants encoded here (never relaxed downstream):
 *  - A component's `id` doubles as its `data-part`, so cameras / cuts / cursors
 *    address it — this is the engine's existing rule, not a studio invention.
 *  - A station's `region` is a `data-region` name inside the scene's world.
 *  - Camera verbs / cut styles / component kinds are the engine vocabularies,
 *    re-exported from the contracts so the editor and runtime can never drift.
 */
import type { CameraMoveStyle } from "../src/engine/cameraContract.ts";
import type { CutStyle } from "../src/engine/cutContract.ts";
import type {
  ComponentBeatKind,
  ComponentKind,
} from "../src/engine/componentContract.ts";
import { COMPONENT_KINDS } from "../src/engine/componentContract.ts";
import { CAMERA_MOVES } from "../src/engine/cameraContract.ts";

/** A typed state change on a placed component (time is scene-relative). */
export interface CanvasBeat {
  id: string;
  kind: ComponentBeatKind;
  /** Seconds after the scene starts. */
  atSec: number;
  /** type/stream/swap copy · count target · progress fraction (kind-specific). */
  text?: string;
  value?: number;
  item?: number;
  toState?: string;
  style?: string;
}

/** A catalog component placed inside a station. `id` becomes its data-part. */
export interface CanvasComponent {
  id: string;
  kind: ComponentKind;
  /** Operator copy filled into the component's primary text slot (optional). */
  copy?: string;
  role?: "hero" | "support";
  beats?: CanvasBeat[];
}

/** A camera-world station: one viewport-sized frame of content. */
export interface CanvasStation {
  /** data-region name (kebab-case, unique within the scene). */
  region: string;
  label: string;
  /** 0-based world cell, left→right. Determines the station's x position. */
  cell: number;
  components: CanvasComponent[];
}

/** A typed camera move ending on a station (scene-relative times). */
export interface CanvasCameraMove {
  id: string;
  move: CameraMoveStyle;
  /** Target station's region name. */
  toRegion: string;
  ease?: string;
  startSec: number;
  durationSec: number;
  /** push-in / pull-back multiplier on the comfortable fit zoom. */
  zoom?: number;
}

/** One scene: a set of stations (a world) plus a camera path across them. */
export interface CanvasScene {
  id: string;
  title: string;
  purpose?: string;
  durationSec: number;
  stations: CanvasStation[];
  camera: CanvasCameraMove[];
  /** Outgoing boundary cut style (the last scene's is ignored). */
  cut?: CutStyle;
}

/** A whole click-together film. */
export interface CanvasFilm {
  version: 1;
  /** frame.md-style token or hex for the committed accent. */
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  displayFont: string;
  bodyFont: string;
  scenes: CanvasScene[];
}

export const DEFAULT_CANVAS_PALETTE = {
  accent: "#59f1d2",
  background: "#071018",
  surface: "#101c27",
  text: "#f5f7fb",
  muted: "#a9b7c6",
  displayFont: "Montserrat",
  bodyFont: "Inter",
} as const;

/**
 * A small, deliberately gate-safe starter film so a blank canvas workspace is
 * immediately previewable: a hook headline, a proof station the camera pans to
 * (a stat-card that counts up + a progress bar), and a centered CTA close.
 * This is the "click-together valid film" the plan promises operators start
 * from, not a fixed template — every field below is editable in the UI.
 */
export function starterCanvasFilm(): CanvasFilm {
  return {
    version: 1,
    ...DEFAULT_CANVAS_PALETTE,
    scenes: [
      {
        id: "hook",
        title: "Hook",
        purpose: "Name the release",
        durationSec: 4.2,
        stations: [
          {
            region: "hook-stage",
            label: "Hook stage",
            cell: 0,
            components: [
              { id: "hook-headline", kind: "headline", copy: "Your release, shown", role: "hero" },
              { id: "hook-subhead", kind: "headline", copy: "Now shipping in Slack", role: "support" },
            ],
          },
        ],
        camera: [],
        cut: "hard",
      },
      {
        id: "proof",
        title: "Proof",
        purpose: "Give the shipped value room to read",
        durationSec: 5.6,
        stations: [
          {
            region: "proof-context",
            label: "Context",
            cell: 0,
            components: [
              { id: "proof-copy", kind: "headline", copy: "What changed", role: "support" },
            ],
          },
          {
            region: "proof-panel",
            label: "Proof panel",
            cell: 1,
            components: [
              {
                id: "latency-stat",
                kind: "stat-card",
                copy: "142ms",
                role: "hero",
                beats: [{ id: "stat-count", kind: "count", atSec: 3.4, value: 142 }],
              },
              {
                id: "proof-progress",
                kind: "progress",
                role: "support",
                beats: [{ id: "progress-fill", kind: "progress", atSec: 4.2, value: 1 }],
              },
            ],
          },
        ],
        camera: [
          { id: "hold-context", move: "hold", toRegion: "proof-context", startSec: 0, durationSec: 1.6 },
          { id: "pan-panel", move: "push-in", toRegion: "proof-panel", startSec: 1.8, durationSec: 1.1, zoom: 1.35 },
        ],
        cut: "hard",
      },
      {
        id: "cta",
        title: "CTA",
        purpose: "Close on a confident action",
        durationSec: 4.2,
        stations: [
          {
            region: "cta-stage",
            label: "CTA stage",
            cell: 0,
            components: [
              { id: "cta-lockup", kind: "headline", copy: "From shipped to shown", role: "hero" },
              {
                id: "cta-button",
                kind: "button",
                copy: "See what shipped",
                role: "support",
                beats: [{ id: "cta-press", kind: "press", atSec: 2.4, toState: "success" }],
              },
            ],
          },
        ],
        camera: [],
      },
    ],
  };
}

const KEBAB = /^[a-z][a-z0-9-]*$/;

/**
 * Structural validation of a canvas film — the cheap L0-ish guard before the
 * compiler runs. Returns human-readable errors (surfaced in the UI); it never
 * mutates. The real correctness referee is the gate, not this function.
 */
export function validateCanvasFilm(film: CanvasFilm): string[] {
  const errors: string[] = [];
  if (!film.scenes.length) errors.push("a film needs at least one scene");
  const sceneIds = new Set<string>();
  const partIds = new Set<string>();
  for (const scene of film.scenes) {
    if (!KEBAB.test(scene.id)) errors.push(`scene id "${scene.id}" must be kebab-case`);
    if (sceneIds.has(scene.id)) errors.push(`duplicate scene id "${scene.id}"`);
    sceneIds.add(scene.id);
    if (!(scene.durationSec > 0)) errors.push(`scene "${scene.id}" needs a positive duration`);
    if (!scene.stations.length) errors.push(`scene "${scene.id}" needs at least one station`);
    const regions = new Set<string>();
    for (const station of scene.stations) {
      if (!KEBAB.test(station.region)) {
        errors.push(`station region "${station.region}" must be kebab-case`);
      }
      if (regions.has(station.region)) {
        errors.push(`scene "${scene.id}" has a duplicate station "${station.region}"`);
      }
      regions.add(station.region);
      for (const component of station.components) {
        if (!KEBAB.test(component.id)) {
          errors.push(`component id "${component.id}" must be kebab-case`);
        }
        if (partIds.has(component.id)) {
          errors.push(`duplicate component id "${component.id}" (ids are film-global data-parts)`);
        }
        partIds.add(component.id);
        if (!COMPONENT_KINDS.has(component.kind)) {
          errors.push(`component "${component.id}" has unknown kind "${component.kind}"`);
        }
      }
    }
    for (const move of scene.camera) {
      if (!CAMERA_MOVES.has(move.move)) {
        errors.push(`camera move "${move.id}" has unknown verb "${move.move}"`);
      }
      if (!regions.has(move.toRegion)) {
        errors.push(
          `camera move "${move.id}" targets station "${move.toRegion}" which is not in scene "${scene.id}"`,
        );
      }
      if (move.startSec < 0 || move.startSec + move.durationSec > scene.durationSec + 0.011) {
        errors.push(`camera move "${move.id}" falls outside scene "${scene.id}"'s window`);
      }
    }
  }
  return errors;
}
