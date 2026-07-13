import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FEATURE_FLAG_REGISTRY,
  featureFlagDefinition,
  featureFlagSnapshot,
  isFeatureFlagName,
  isOperationalEnvName,
  OPERATIONAL_ENV_REGISTRY,
  operationalEnvSnapshot,
  REGISTERED_SLACK_SEQUENCES_ENV_NAMES,
  slackSequencesEnvDefinition,
  slackSequencesEnvRawValue,
  slackSequencesEnvSnapshot,
} from "../src/engine/featureFlags.ts";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

/**
 * Registered accessor calls plus the intentional typed dynamic reader
 * (`thinkingOverride`). Direct reads remain included so registry exactness and
 * the no-raw-read invariant fail independently during a migration.
 */
function sourceReadFlagNames(): string[] {
  const names = new Set<string>();
  const patterns = [
    /slackSequencesEnvRawValue\(\s*["'](SLACK_SEQUENCES_[A-Z0-9_]+)["']/g,
    /resolveFeatureFlag\(\s*["'](SLACK_SEQUENCES_[A-Z0-9_]+)["']/g,
    /process\.env\s*\.\s*(SLACK_SEQUENCES_[A-Z0-9_]+)/g,
    /process\.env\s*\[\s*["'](SLACK_SEQUENCES_[A-Z0-9_]+)["']\s*\]/g,
    /thinkingOverride\(\s*["'](SLACK_SEQUENCES_[A-Z0-9_]+)["']/g,
  ];
  for (const file of sourceFiles(SRC_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) names.add(match[1]!);
    }
  }
  return [...names].sort();
}

function rawSlackReadLocations(): string[] {
  const locations: string[] = [];
  const flagsModule = path.resolve(SRC_ROOT, "engine/featureFlags.ts");
  const patterns = [
    /process\.env\s*\.\s*(SLACK_SEQUENCES_[A-Z0-9_]+)/g,
    /process\.env\s*\[\s*["'](SLACK_SEQUENCES_[A-Z0-9_]+)["']\s*\]/g,
  ];
  for (const file of sourceFiles(SRC_ROOT)) {
    if (path.resolve(file) === flagsModule) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        locations.push(`${path.relative(SRC_ROOT, file)}:${line}:${match[1]}`);
      }
    }
  }
  return locations.sort();
}

describe("central SLACK_SEQUENCES feature-flag registry", () => {
  it("classifies every source-read variable and carries no stale registrations", () => {
    expect(sourceReadFlagNames()).toEqual([...REGISTERED_SLACK_SEQUENCES_ENV_NAMES]);
    expect(sourceReadFlagNames()).toHaveLength(55);
  });

  it("forbids raw Slack env reads outside the centralized flags module", () => {
    expect(rawSlackReadLocations()).toEqual([]);
  });

  it("provides exact typed raw access without parsing or defaulting", () => {
    const env = { SLACK_SEQUENCES_CONTINUITY_GRAPH: " 0 " };
    expect(slackSequencesEnvRawValue("SLACK_SEQUENCES_CONTINUITY_GRAPH", env)).toBe(" 0 ");
    expect(slackSequencesEnvRawValue("SLACK_SEQUENCES_QA_CACHE", env)).toBeUndefined();
  });

  it("requires ownership, values, defaults, descriptions, and rollback for every flag", () => {
    for (const [name, definition] of Object.entries(FEATURE_FLAG_REGISTRY)) {
      expect(name).toMatch(/^SLACK_SEQUENCES_[A-Z0-9_]+$/);
      expect(definition.kind).toBe("feature");
      expect(definition.values).toContain(definition.defaultValue);
      expect(definition.owner.trim()).not.toBe("");
      expect(definition.description.trim()).not.toBe("");
      expect(definition.rollback.trim()).not.toBe("");
    }
  });

  it("documents why every operational input is an explicit non-feature exception", () => {
    for (const [name, definition] of Object.entries(OPERATIONAL_ENV_REGISTRY)) {
      expect(name).toMatch(/^SLACK_SEQUENCES_[A-Z0-9_]+$/);
      expect(definition.kind).toBe("operational");
      expect(definition.defaultValue.trim()).not.toBe("");
      expect(definition.values.length).toBeGreaterThan(0);
      expect(definition.owner.trim()).not.toBe("");
      expect(definition.description.trim()).not.toBe("");
      expect(definition.rollback.trim()).not.toBe("");
      expect(definition.exceptionReason.trim()).not.toBe("");
    }
  });

  it("resolves actual opt-out and multi-mode semantics without mutating process.env", () => {
    const snapshot = featureFlagSnapshot({
      SLACK_SEQUENCES_CONTINUITY_GRAPH: "0",
      SLACK_SEQUENCES_COMPOSITION: "BLOCK",
      SLACK_SEQUENCES_EYE_TRACE: "off",
      SLACK_SEQUENCES_RENDER_SUPERSAMPLE: "1",
      // The current interaction call site treats every non-audit value as block.
      SLACK_SEQUENCES_INTERACTION_QA: "0",
      SLACK_SEQUENCES_ASSETS: "unexpected",
    });

    expect(snapshot.SLACK_SEQUENCES_CONTINUITY_GRAPH).toMatchObject({
      value: "off",
      rawValue: "0",
      defaulted: false,
      valid: true,
    });
    expect(snapshot.SLACK_SEQUENCES_COMPOSITION.value).toBe("block");
    expect(snapshot.SLACK_SEQUENCES_EYE_TRACE.value).toBe("off");
    expect(snapshot.SLACK_SEQUENCES_RENDER_SUPERSAMPLE.value).toBe("forced");
    expect(snapshot.SLACK_SEQUENCES_INTERACTION_QA).toMatchObject({
      value: "block",
      valid: false,
    });
    expect(snapshot.SLACK_SEQUENCES_ASSETS).toMatchObject({
      value: "on",
      valid: false,
    });
    expect(snapshot.SLACK_SEQUENCES_QA_CACHE).toMatchObject({
      value: "on",
      defaulted: true,
      valid: true,
    });
  });

  it("exposes typed feature, operational, and combined snapshots", () => {
    const env = {
      SLACK_SEQUENCES_DATA_DIR: "  D:/sequences-data  ",
      SLACK_SEQUENCES_HEDGE_MAX_PER_RUN: "4",
      SLACK_SEQUENCES_TEMPORAL_JUDGE: "0",
    };
    const operational = operationalEnvSnapshot(env);
    const combined = slackSequencesEnvSnapshot(env);

    expect(operational.SLACK_SEQUENCES_DATA_DIR).toEqual({
      name: "SLACK_SEQUENCES_DATA_DIR",
      value: "D:/sequences-data",
      rawValue: "D:/sequences-data",
      defaulted: false,
    });
    expect(operational.SLACK_SEQUENCES_HEDGE_MAX_PER_RUN.value).toBe("4");
    expect(combined.features.SLACK_SEQUENCES_TEMPORAL_JUDGE.value).toBe("off");
    expect(combined.operational.SLACK_SEQUENCES_STREAM_IDLE_TIMEOUT_MS).toMatchObject({
      value: "90000",
      defaulted: true,
    });
  });

  it("provides typed lookup and classification guards", () => {
    expect(isFeatureFlagName("SLACK_SEQUENCES_CONTINUITY_GRAPH")).toBe(true);
    expect(isOperationalEnvName("SLACK_SEQUENCES_DATA_DIR")).toBe(true);
    expect(isFeatureFlagName("SLACK_SEQUENCES_DATA_DIR")).toBe(false);
    expect(featureFlagDefinition("SLACK_SEQUENCES_CONTINUITY_GRAPH").owner)
      .toBe("continuity + camera blocking");
    expect(slackSequencesEnvDefinition("SLACK_SEQUENCES_DATA_DIR").kind)
      .toBe("operational");
  });
});
