import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SENTINEL_CONTRACT,
  FINDING_SOURCE_FILES,
  NON_FINDING_LITERALS,
  extractFindingCodes,
  isRegisteredFinding,
  allRegisteredFindingPrefixes,
  type SentinelLayerName,
  type SentinelBlocking,
} from "../src/engine/sentinel.ts";

const ENGINE_DIR = path.resolve(fileURLToPath(import.meta.url), "../../src/engine");

function readSource(file: string): string {
  return fs.readFileSync(path.join(ENGINE_DIR, file), "utf8");
}

/** Every finding code emitted across the scanned validators, with its file. */
function emittedCodes(): Array<{ code: string; file: string }> {
  const out: Array<{ code: string; file: string }> = [];
  for (const file of FINDING_SOURCE_FILES) {
    for (const code of extractFindingCodes(readSource(file))) {
      out.push({ code, file });
    }
  }
  return out;
}

describe("Sentinel contract registry — closed-world finding coverage", () => {
  it("scans every registered finding-source file (they all exist)", () => {
    for (const file of FINDING_SOURCE_FILES) {
      expect(fs.existsSync(path.join(ENGINE_DIR, file)), `${file} missing`).toBe(true);
    }
  });

  it("scans canonical signatures after runner helper extraction", () => {
    const signatureSource = "runner/findingSignatures.ts";
    expect(FINDING_SOURCE_FILES).toContain(signatureSource);
    expect(extractFindingCodes(readSource(signatureSource))).toEqual(
      expect.arrayContaining(["camera_part_missing", "moment_unbound"]),
    );
  });

  it("registers EVERY finding class the validators actually emit (closed world)", () => {
    // SENTINEL.md's closed-world guarantee: a NEW finding code that
    // no row owns fails CI here. Either add/expand a row in sentinel.ts, or — if
    // it is genuinely not a finding — add it to NON_FINDING_LITERALS (a
    // conscious, reviewed act).
    const unregistered = emittedCodes().filter(({ code }) => !isRegisteredFinding(code));
    const report = unregistered
      .map(({ code, file }) => `  ${code}  (emitted in ${file})`)
      .join("\n");
    expect(
      unregistered,
      unregistered.length
        ? `Unregistered finding classes — register them in src/engine/sentinel.ts ` +
            `(or, if not a finding, add to NON_FINDING_LITERALS):\n${report}`
        : "",
    ).toEqual([]);
  });

  it("has no dead registrations — every registered prefix is actually emitted", () => {
    // The reverse direction keeps the manifest honest: a prefix that no validator
    // emits is rot. (Rows that make a class unrepresentable still list the L3/L4
    // backstop codes, which the gate still emits, so they appear here too.)
    const codes = emittedCodes().map((entry) => entry.code);
    const dead = allRegisteredFindingPrefixes().filter(
      (prefix) => !codes.some((code) => code.startsWith(prefix)),
    );
    expect(dead, `Registered prefixes no validator emits (dead rows?): ${dead.join(", ")}`).toEqual(
      [],
    );
  });

  it("bites: an unregistered code is rejected (negative control)", () => {
    // If this ever passes for a real emitted code, the closed-world test above
    // would have caught it — this proves the mechanism rejects, not just accepts.
    expect(isRegisteredFinding("brand_new_finding_class")).toBe(false);
    expect(extractFindingCodes('findings.push(`brand_new_finding_class: oops`)')).toContain(
      "brand_new_finding_class",
    );
  });

  it("keeps NON_FINDING_LITERALS lean — no entry masks a real, registered finding", () => {
    // An infra constant that also happens to be a registered finding prefix would
    // be silently swallowed. Guard against that contradiction.
    for (const literal of NON_FINDING_LITERALS) {
      expect(
        isRegisteredFinding(literal),
        `${literal} is in NON_FINDING_LITERALS but is a registered finding`,
      ).toBe(false);
    }
  });
});

describe("Sentinel contract registry — structural invariants", () => {
  const layers: SentinelLayerName[] = [
    "schema",
    "scaffold",
    "normalize",
    "static",
    "browser",
    "model-retry",
  ];
  const dispositions: SentinelBlocking[] = [
    "impossible",
    "deterministic-repair",
    "blocking",
    "advisory-late",
    "advisory",
  ];

  it("has unique ids", () => {
    const ids = SENTINEL_CONTRACT.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses only valid layers and dispositions", () => {
    for (const row of SENTINEL_CONTRACT) {
      expect(layers, `${row.id} layer`).toContain(row.layer);
      expect(dispositions, `${row.id} blocking`).toContain(row.blocking);
    }
  });

  it("names a real test file for every row", () => {
    const testDir = path.resolve(fileURLToPath(import.meta.url), "../../..");
    for (const row of SENTINEL_CONTRACT) {
      const testPath = path.join(testDir, "slack", row.test);
      expect(fs.existsSync(testPath), `${row.id} → ${row.test} missing`).toBe(true);
    }
  });

  it("only leaves findingPrefixes empty for deterministic-repair rows", () => {
    // A scaffold/static/browser row must own at least one finding class (the
    // backstop gate); only a pure normalization legitimately emits none.
    for (const row of SENTINEL_CONTRACT) {
      if (row.findingPrefixes.length === 0) {
        expect(row.blocking, `${row.id} has no findingPrefixes`).toBe("deterministic-repair");
      }
    }
  });

  it("covers all fourteen umbrella obligations from the plan", () => {
    const groups = new Set(SENTINEL_CONTRACT.map((row) => row.group));
    for (const group of [
      "cuts",
      "camera",
      "components",
      "interactions",
      "pacing",
      "moments",
      "liveness",
      "eye-trace",
      "exits",
      "coherence",
      "layout",
      "markup-audit",
      "runtime",
      "frame",
      "normalize",
    ]) {
      expect(groups, `missing obligation group: ${group}`).toContain(group);
    }
  });
});
