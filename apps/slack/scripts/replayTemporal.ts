/** Replay temporal/continuous-motion QA for an existing direct project. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportTemporalEvidence } from "../src/engine/temporalInspector.ts";

const projectArg = process.argv[2];
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!projectArg) {
  console.error("usage: npm run temporal:replay -- <project-dir-or-id>");
  process.exitCode = 2;
} else {
  const candidates = [
    path.resolve(projectArg),
    path.resolve(appDir, projectArg),
    path.resolve(appDir, "..", "..", projectArg),
    path.join(appDir, ".data", "projects", projectArg),
  ];
  const projectDir = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
  const report = await reportTemporalEvidence(projectDir);
  console.log(report.summary);
}
