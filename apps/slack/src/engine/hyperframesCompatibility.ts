/**
 * Hackathon submission freeze for the HyperFrames substrate.
 *
 * Judges must run the exact tested stack even if newer HyperFrames packages or
 * CLI releases appear after submission. Keep this constant unchanged unless a
 * deliberate pre-submission migration updates code, lockfile, audits, and tests
 * together.
 */
import fs from "node:fs";
import path from "node:path";

export const HYPERFRAMES_SUBMISSION_VERSION = "0.6.86";
export const HYPERFRAMES_RUNTIME_PACKAGES = [
  "@hyperframes/core",
  "@hyperframes/engine",
  "@hyperframes/player",
  "@hyperframes/producer",
] as const;

function installedPackageVersion(packageName: string): string | null {
  let current = import.meta.dirname;
  const root = path.parse(current).root;
  while (current !== root) {
    const manifest = path.join(current, "node_modules", ...packageName.split("/"), "package.json");
    if (fs.existsSync(manifest)) {
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (parsed.name === packageName) return parsed.version ?? null;
    }
    current = path.dirname(current);
  }
  return null;
}

export function assertHyperframesSubmissionCompatibility(): void {
  const mismatches = HYPERFRAMES_RUNTIME_PACKAGES.flatMap((packageName) => {
    const installed = installedPackageVersion(packageName);
    return installed === HYPERFRAMES_SUBMISSION_VERSION
      ? []
      : `${packageName}=${installed ?? "missing"} (expected ${HYPERFRAMES_SUBMISSION_VERSION})`;
  });
  if (mismatches.length > 0) {
    throw new Error(
      `HyperFrames submission compatibility check failed: ${mismatches.join(", ")}. ` +
      "Do not fetch a newer CLI/runtime during judge execution.",
    );
  }
}
