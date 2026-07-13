import { describe, expect, it } from "vitest";
import {
  summarizeSequenceCheckStatus,
  type SequenceCheckStatusInput,
} from "../src/engine/sequenceCheckStatus.ts";

const clean = (): SequenceCheckStatusInput => ({
  direct: { validation: { ok: true, motionWarnings: [] } },
  result: {
    authoringMode: "hyperframes-direct",
    thumbnailPaths: [{ exists: true, bytes: 10 }],
    fallback: null,
    stages: [{ attempts: 1 }],
    sentinelDisposition: "published",
    sentinelDegradations: [],
  },
  checks: { qaWarningCount: 0 },
  artifacts: { mp4: { exists: true, bytes: 10 } },
  options: { render: true },
});

describe("sequence-check status honesty", () => {
  it("passes only a clean, one-attempt probe", () => {
    expect(summarizeSequenceCheckStatus(clean())).toBe("pass");
  });

  it("warns for Sentinel degradation, retries, or browser warnings", () => {
    for (const mutate of [
      (value: ReturnType<typeof clean>) => { value.result.sentinelDisposition = "published-degraded"; },
      (value: ReturnType<typeof clean>) => { value.result.sentinelDegradations = ["cut-degraded"]; },
      (value: ReturnType<typeof clean>) => { value.result.stages = [{ attempts: 2 }]; },
      (value: ReturnType<typeof clean>) => { value.checks = { qaWarningCount: 1 }; },
    ]) {
      const value = clean();
      mutate(value);
      expect(summarizeSequenceCheckStatus(value)).toBe("warn");
    }
  });

  it("fails when a paid authoring run publishes the deterministic proof film", () => {
    const reported = clean();
    reported.result.fallback = { stage: "luna-repair" };
    expect(summarizeSequenceCheckStatus(reported)).toBe("fail");

    const inferred = clean();
    inferred.result.authoringMode = "deterministic-fallback";
    expect(summarizeSequenceCheckStatus(inferred)).toBe("fail");

    const ledgerOnly = clean();
    ledgerOnly.result.ledgerStatus = {
      runtimeValid: true,
      qualityResidue: 0,
      degradedAxes: [],
      repeatedQaClasses: [],
      modelRepair: false,
      proofFilm: true,
      materialDegradation: true,
      oneAttemptSuccess: false,
      disposition: "fallback",
    };
    expect(summarizeSequenceCheckStatus(ledgerOnly)).toBe("fail");
  });

  it("fails missing requested render output before reporting warnings", () => {
    const value = clean();
    value.result.sentinelDisposition = "published-degraded";
    value.artifacts.mp4 = { exists: false, bytes: 0 };
    expect(summarizeSequenceCheckStatus(value)).toBe("fail");
  });

  it("uses ledger axes and predicates instead of stage-local attempt counters", () => {
    const value = clean();
    value.result.ledgerStatus = {
      runtimeValid: true,
      qualityResidue: 8,
      degradedAxes: ["qualityResidue"],
      repeatedQaClasses: [],
      modelRepair: false,
      proofFilm: false,
      materialDegradation: false,
      oneAttemptSuccess: true,
      disposition: "published-degraded",
    };
    value.result.stages = [{ attempts: 99 }];
    expect(summarizeSequenceCheckStatus(value)).toBe("warn");
  });
});
