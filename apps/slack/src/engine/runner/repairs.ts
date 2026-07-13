/**
 * Stable repair facade. Domain modules live under `runner/repairs/`; this
 * entrypoint keeps the runner's existing import contract unchanged.
 */
export * from "./repairs/implementation.ts";
