/**
 * Deterministic layout helpers: 12-column grid with title-safe margins.
 * Archetypes express boxes in grid terms; everything lands on the lattice.
 */
import type { Box } from "./schema.ts";

export const GRID_COLS = 12;
/** Title-safe inset as a fraction of width (5% — also the linter's rule). */
export const SAFE_MARGIN_FRAC = 0.05;

export interface GridSpec {
  /** First column, 0-based. */
  col: number;
  /** Number of columns spanned. */
  span: number;
  /** Top edge as a fraction of canvas height. */
  y: number;
  /** Height as a fraction of canvas height. */
  h: number;
  origin?: Box["origin"];
}

export function gridBox(W: number, H: number, spec: GridSpec): Box {
  const margin = SAFE_MARGIN_FRAC * W;
  const gutter = 24 * (W / 1920);
  const colW = (W - 2 * margin - (GRID_COLS - 1) * gutter) / GRID_COLS;
  const x = margin + spec.col * (colW + gutter);
  const w = spec.span * colW + (spec.span - 1) * gutter;
  return {
    x: Math.round(x),
    y: Math.round(spec.y * H),
    w: Math.round(w),
    h: Math.round(spec.h * H),
    origin: spec.origin ?? "center center",
  };
}

export function gridMetrics(W: number): { margin: number; gutter: number; colW: number } {
  const margin = SAFE_MARGIN_FRAC * W;
  const gutter = 24 * (W / 1920);
  const colW = (W - 2 * margin - (GRID_COLS - 1) * gutter) / GRID_COLS;
  return { margin, gutter, colW };
}

/** Snap horizontal geometry to the nearest 12-column start/span. */
export function snapBoxToGrid(W: number, box: Pick<Box, "x" | "w">): { x: number; w: number } {
  const { margin, gutter, colW } = gridMetrics(W);
  const pitch = colW + gutter;
  const col = Math.max(0, Math.min(GRID_COLS - 1, Math.round((box.x - margin) / pitch)));
  const rawSpan = (box.w + gutter) / pitch;
  const span = Math.max(1, Math.min(GRID_COLS - col, Math.round(rawSpan)));
  return {
    x: Math.round(margin + col * pitch),
    w: Math.round(span * colW + (span - 1) * gutter),
  };
}

export function fullBleed(W: number, H: number): Box {
  return { x: 0, y: 0, w: W, h: H, origin: "center center" };
}

export function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}
