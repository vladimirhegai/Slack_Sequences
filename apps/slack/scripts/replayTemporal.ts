/** Replay temporal/continuous-motion QA for an existing direct project. */
import path from "node:path";
import { reportTemporalEvidence } from "../src/engine/temporalInspector.ts";

const projectArg = process.argv[2];
if (!projectArg) {
  console.error("usage: npm run temporal:replay -- <project-dir>");
  process.exitCode = 2;
} else {
  const projectDir = path.resolve(projectArg);
  const report = await reportTemporalEvidence(projectDir);
  console.log(report.summary);
}
