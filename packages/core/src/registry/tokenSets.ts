import {
  BLUR_TOKENS,
  DISTANCE_TOKENS,
  DURATION_TOKENS,
  EASING_TOKENS,
  SCALE_TOKENS,
  STAGGER_TOKENS,
  TYPE_TOKENS,
} from "../tokens.ts";

export interface TokenSetPlugin {
  id: string;
  version: string;
  summary: string;
  tokens: Record<string, unknown>;
}

export const TOKEN_SETS: Record<string, TokenSetPlugin> = {
  "tokens.sequences-core": {
    id: "tokens.sequences-core",
    version: "1.0.0",
    summary: "The curated Sequences Phase-1 duration, easing, distance, scale, blur, and type lattice.",
    tokens: {
      durations: DURATION_TOKENS,
      easings: EASING_TOKENS,
      distances: DISTANCE_TOKENS,
      staggers: STAGGER_TOKENS,
      scales: SCALE_TOKENS,
      blurs: BLUR_TOKENS,
      type: TYPE_TOKENS,
    },
  },
};
