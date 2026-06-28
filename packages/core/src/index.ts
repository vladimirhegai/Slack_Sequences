/**
 * @sequences/core — the deterministic spine of Sequences.
 *
 * Dataflow (the whole architecture in one line):
 *   Project (scene graph, zod-validated)
 *     → materialize (archetype layout + profile motion table + overrides)
 *     → solve (choreography: staggers, overlap, settle)
 *     → compile (HyperFrames HTML + GSAP master timeline)
 *     → lint (deterministic critic; fixes are commands)
 *
 * Mutation happens ONLY through applyCommand / ProjectStore.
 */
export * from "./tokens.ts";
export * from "./schema.ts";
export * from "./migrations.ts";
export * from "./hashing.ts";
export * from "./layout.ts";
export * from "./registry/index.ts";
export * from "./materialize.ts";
export * from "./solver.ts";
export * from "./validate.ts";
export * from "./commands.ts";
export * from "./store.ts";
export * from "./compiler.ts";
export * from "./linter.ts";
export * from "./defaults.ts";
export * from "./extensionPreview.ts";
export * from "./plan.ts";
export * from "./brief.ts";
export * from "./directions.ts";
export * from "./tweak.ts";
export * from "./quality.ts";
