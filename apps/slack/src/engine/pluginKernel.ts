/**
 * Plugin kernel — Foundation A of the plugin system (INTERNAL helpers, never
 * invokable — the layoutPosition/childItems disposition). One distribution
 * primitive (grid | stack | scatter — grid and scatter are the SAME primitive
 * with different jitter) plus proportion/spacing math, so every positional
 * plugin composes consistent rhythm instead of reinventing geometry. Also
 * hosts the deterministic seeded PRNG both foundations share: a plugin's
 * output must be a pure function of (scene, declaration) so the host can strip
 * and re-inject byte-identical markup on every repair pass.
 */

/* ------------------------------------------------------------ seeded PRNG */

/** FNV-1a 32-bit — stable, dependency-free string hash for seeds. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface SeededRandom {
  /** Uniform [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** One element (deterministic; throws on an empty list). */
  pick<T>(items: readonly T[]): T;
  /** New shuffled copy (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * `count` distinct elements, cycling with re-shuffle when count exceeds the
   * pool so long lists never show back-to-back repeats.
   */
  take<T>(items: readonly T[], count: number): T[];
}

/** mulberry32 over an FNV seed — tiny, deterministic, good enough for content. */
export function createSeededRandom(seedText: string): SeededRandom {
  let state = hashSeed(seedText) || 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number =>
    Math.floor(next() * (max - min + 1)) + min;
  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      if (!items.length) throw new Error("pick() from an empty list");
      return items[int(0, items.length - 1)]!;
    },
    shuffle,
    take: <T>(items: readonly T[], count: number): T[] => {
      const out: T[] = [];
      let pool = shuffle(items);
      while (out.length < count) {
        if (!pool.length) pool = shuffle(items);
        out.push(pool.shift()!);
      }
      return out;
    },
  };
}

/* --------------------------------------------------------- proportion math */

/**
 * The shared spacing rhythm (Fibonacci ≈ golden-ratio steps, px). Plugins index
 * into this instead of inventing gaps so adjacent plugins never carry
 * near-miss spacing (13px beside 14px reads as sloppy; 13 beside 21 reads as
 * hierarchy).
 */
export const SPACE_SCALE_PX = [8, 13, 21, 34, 55] as const;

export function spacePx(index: 0 | 1 | 2 | 3 | 4): number {
  return SPACE_SCALE_PX[index];
}

/**
 * Balanced grid shape for n cells: prefer wider-than-tall (16:9 canvas),
 * never leave a lonely orphan row when a rectangle exists.
 */
export function gridShape(n: number): { cols: number; rows: number } {
  const count = Math.max(1, Math.round(n));
  if (count <= 3) return { cols: count, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 8) return { cols: 4, rows: 2 };
  const cols = Math.ceil(Math.sqrt(count * (16 / 9)));
  return { cols, rows: Math.ceil(count / cols) };
}

export type DistributionMode = "grid" | "stack" | "scatter";

/** One child's fractional placement inside the unit box (0..1 center point). */
export interface DistributionCell {
  x: number;
  y: number;
  col: number;
  row: number;
}

/**
 * THE distribution primitive. `grid` centers each child in its cell; `scatter`
 * is the same lattice with seeded jitter (so scattered children keep a minimum
 * separation by construction — no rejection sampling, deterministic);
 * `stack` is a single column top-down.
 */
export function distribute(
  n: number,
  mode: DistributionMode,
  rng?: SeededRandom,
): DistributionCell[] {
  const count = Math.max(1, Math.round(n));
  if (mode === "stack") {
    return Array.from({ length: count }, (_, i) => ({
      x: 0.5,
      y: (i + 0.5) / count,
      col: 0,
      row: i,
    }));
  }
  const { cols, rows } = gridShape(count);
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Jitter stays inside ±30% of the cell, so neighbors can never collide.
    const jx = mode === "scatter" && rng ? (rng.next() - 0.5) * 0.6 : 0;
    const jy = mode === "scatter" && rng ? (rng.next() - 0.5) * 0.6 : 0;
    return {
      x: (col + 0.5 + jx) / cols,
      y: (row + 0.5 + jy) / rows,
      col,
      row,
    };
  });
}

/**
 * Inline style for a grid unit wrapper. Width defaults to a content-measure
 * that reads at fit zoom inside one 1400x800 station or a centered scene.
 */
export function gridWrapperStyle(
  n: number,
  options: { maxWidthPx?: number; gapIndex?: 0 | 1 | 2 | 3 | 4 } = {},
): string {
  const { cols } = gridShape(n);
  const gap = spacePx(options.gapIndex ?? 2);
  const maxWidth = options.maxWidthPx ?? Math.min(1240, cols * 380 + (cols - 1) * gap);
  return (
    `display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));` +
    `gap:${gap}px;width:min(100%,${maxWidth}px);margin:0 auto;align-content:center`
  );
}

/** Inline style for a stacked (single-column flow) unit wrapper. */
export function stackWrapperStyle(
  options: { widthPx?: number; gapIndex?: 0 | 1 | 2 | 3 | 4; align?: "start" | "center" | "end" } = {},
): string {
  const gap = spacePx(options.gapIndex ?? 1);
  const width = options.widthPx ?? 460;
  const align = options.align ?? "stretch";
  return (
    `display:flex;flex-direction:column;gap:${gap}px;` +
    `width:min(100%,${width}px);align-items:${align}`
  );
}

/* ------------------------------------------------------- entrance timing */

/**
 * The shared entrance anchor for a plugin/asset unit: shortly after the scene
 * opens, scaled to short scenes — or, when the scene's camera only reaches the
 * unit's station later (`arrivalSec`), just before the camera settles there
 * (the plugin-live-1 lesson: beats fired at scene entrance while the camera
 * arrived seconds later, landing on a static number). The delay is capped at
 * 60% of the scene (the pacing gate's introduction deadline) and always leaves
 * >=1.2s of beat room. Single owner — pluginContract and assetContract both
 * anchor here so the two unit families never drift apart.
 */
export function entranceAnchorSec(ctx: {
  startSec: number;
  durationSec: number;
  arrivalSec?: number;
}): number {
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));
  const base = ctx.startSec + clamp(ctx.durationSec * 0.12, 0.2, 0.6);
  if (ctx.arrivalSec === undefined) return base;
  const introductionCap = ctx.startSec + ctx.durationSec * 0.6;
  const beatRoomCap = ctx.startSec + ctx.durationSec - 1.2;
  return Math.round(clamp(
    Math.max(base, ctx.arrivalSec - 0.2),
    base,
    Math.max(base, Math.min(introductionCap, beatRoomCap)),
  ) * 1000) / 1000;
}

/**
 * Stagger seconds for n children entering as ONE gesture: the whole cascade
 * lands inside `windowSec`, each child keeps a readable beat of its own, and
 * the rhythm slows slightly toward the end (the settle reads as intentional).
 */
export function cascadeOffsets(n: number, windowSec: number): number[] {
  const count = Math.max(1, Math.round(n));
  if (count === 1) return [0];
  const step = Math.min(0.22, Math.max(0.08, windowSec / (count + 1)));
  return Array.from({ length: count }, (_, i) => {
    const ease = 1 + (i / (count - 1)) * 0.25; // widen late gaps ~25%
    return Math.round(i * step * ease * 1000) / 1000;
  });
}
