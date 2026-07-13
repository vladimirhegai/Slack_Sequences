/**
 * Compatibility facade for the direct-composition layout QA surface.
 *
 * The implementation now lives under `layout/`, while this stable entrypoint
 * keeps existing engine, script, and test imports unchanged.
 */
export * from "./layout/report.ts";
