export interface TransitionPlugin {
  id: string;
  version: string;
  summary: string;
  source: "sequences" | "hyperframes";
  shader?: string;
}

export const TRANSITION_PLUGINS: Record<string, TransitionPlugin> = {
  cut: {
    id: "cut",
    version: "1.0.0",
    summary: "Compatibility alias for cutHold; use for imported plans that still say cut.",
    source: "sequences",
  },
  fade: {
    id: "fade",
    version: "1.0.0",
    summary: "Compatibility alias for crossFade; use for imported plans that still say fade.",
    source: "sequences",
  },
  cutHold: {
    id: "cutHold",
    version: "1.0.0",
    summary: "A decisive cut with incoming motion pre-rolled four frames across the boundary.",
    source: "sequences",
  },
  crossFade: {
    id: "crossFade",
    version: "1.0.0",
    summary: "A true overlapping crossfade on alternating HyperFrames tracks.",
    source: "sequences",
  },
  wipeDirectional: {
    id: "wipeDirectional",
    version: "1.0.0",
    summary: "A clean directional wipe for crisp product-story transitions.",
    source: "sequences",
  },
  slidePush: {
    id: "slidePush",
    version: "1.0.0",
    summary: "The incoming scene pushes the outgoing scene aside with tokenized movement.",
    source: "sequences",
  },
  "shader.flashThroughWhite": {
    id: "shader.flashThroughWhite",
    version: "1.0.0",
    summary: "HyperFrames flash-through-white shader wrapper for one launch-level accent.",
    source: "hyperframes",
    shader: "flash-through-white",
  },
  "shader.pixelMelt": {
    id: "shader.pixelMelt",
    version: "1.0.0",
    summary: "HyperFrames chromatic-split shader wrapper for a controlled digital break.",
    source: "hyperframes",
    shader: "chromatic-split",
  },
};
