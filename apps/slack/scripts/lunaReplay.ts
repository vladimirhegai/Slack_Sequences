/** Model-free replay of persisted Luna worker evidence through the current host gate. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import {
  normalizeLunaSourceMechanics,
  parseLunaMotionIntent,
} from "../src/engine/lunaRoute.ts";
import {
  validateDirectComposition,
  type DirectScene,
} from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import {
  auditLunaRunHistory,
  resolveLunaRunDirectories,
} from "./lib/lunaEvidence.ts";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(): string {
  return [
    "usage: npm run luna:replay -- <job-id|project-dir|runs-dir|downloaded-reports-dir> [--integrity-only]",
    "",
    "Re-hashes the raw response, receipt and every materialized file, proves exact-thread",
    "history, then replays each candidate through the current static and browser host gate.",
    "No provider or legacy repair code is called.",
  ].join("\n");
}

async function replay(): Promise<void> {
  const argv = process.argv.slice(2);
  const source = argv.find((arg) => !arg.startsWith("-"));
  if (!source || argv.some((arg) => arg !== source && arg !== "--integrity-only")) {
    throw new Error(usage());
  }
  const integrityOnly = argv.includes("--integrity-only");
  const runDirs = resolveLunaRunDirectories(source, appDir);
  const bundles = auditLunaRunHistory(runDirs);
  const results: Array<Record<string, unknown>> = [];
  for (const bundle of bundles) {
    if (integrityOnly) {
      results.push({ ...bundle.audit, validation: "not-requested" });
      continue;
    }
    if (bundle.audit.artifactKind !== "film") {
      results.push({
        ...bundle.audit,
        validation: {
          ok: true,
          applicable: false,
          contract: bundle.audit.artifactKind,
          note: "Contract integrity and kind-specific schema passed; browser film QA is not applicable.",
        },
      });
      continue;
    }
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-replay-"));
    try {
      try {
        if (!bundle.html || !bundle.storyboard || !bundle.motionIntent) {
          throw new Error("film evidence is missing its parsed host bundle");
        }
        initializeProject(projectDir, {
          name: `Luna replay ${bundle.audit.runCount}`,
          brandName: "Luna replay",
          seedScreenshot: false,
        });
        for (const asset of bundle.assetFiles) {
          const assetRoot = path.resolve(projectDir, "assets", "luna");
          const destination = path.resolve(assetRoot, ...asset.relativePath.split("/"));
          if (!destination.startsWith(`${assetRoot}${path.sep}`)) {
            throw new Error(`unsafe replay asset ${asset.relativePath}`);
          }
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, asset.bytes);
        }
        const storyboard = bundle.storyboard as unknown as DirectScene[];
        const intent = parseLunaMotionIntent(
          JSON.stringify(bundle.motionIntent),
          bundle.html,
          storyboard,
        );
        const draft = {
          html: normalizeLunaSourceMechanics(bundle.html, intent.compositionId),
          storyboard,
          declaredPrimarySelectors: Object.fromEntries(
            intent.acts.map((act) => [act.sceneId, act.primarySelector]),
          ),
          declaredInteractions: intent.interactions.map((interaction, index) => ({
            id: `luna-interaction-${String(index + 1).padStart(2, "0")}`,
            actorSelector: interaction.actorSelector,
            targetSelector: interaction.targetSelector,
            resultSelector: interaction.resultSelector,
            startSec: interaction.startSec,
            actionSec: interaction.actionSec,
            settleSec: interaction.settleSec,
            beforeSampleSec: interaction.beforeSampleSec,
            afterSampleSec: interaction.afterSampleSec,
            observableStateChange: interaction.observableStateChange,
          })),
        };
        const staticValidation = await validateDirectComposition(projectDir, draft);
        let browserValidation: {
          ok: boolean;
          strictOk?: boolean;
          errors: string[];
          warnings: string[];
          infraError?: string;
          timelineContract?: unknown;
        } | undefined;
        if (staticValidation.ok) {
          try {
            browserValidation = await inspectDirectComposition(
              projectDir,
              draft,
              { captureGuide: false },
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            browserValidation = {
              ok: false,
              errors: [message],
              warnings: [],
              infraError: `browser inspector threw: ${message}`,
            };
          }
        }
        results.push({
          ...bundle.audit,
          validation: {
            ok: staticValidation.ok && browserValidation?.ok === true,
            static: {
              ok: staticValidation.ok,
              errors: staticValidation.errors,
              warnings: staticValidation.warnings,
              frameErrors: staticValidation.frameErrors,
              frameWarnings: staticValidation.frameWarnings,
              motionWarnings: staticValidation.motionWarnings,
            },
            browser: browserValidation
              ? {
                  ok: browserValidation.ok,
                  strictOk: browserValidation.strictOk,
                  errors: browserValidation.errors,
                  warnings: browserValidation.warnings,
                  ...(browserValidation.infraError
                    ? { infraError: browserValidation.infraError }
                    : {}),
                  ...(browserValidation.timelineContract
                    ? { timelineContract: browserValidation.timelineContract }
                    : {}),
                }
              : {
                  ok: false,
                  errors: ["browser validation skipped because static validation failed"],
                  warnings: [],
                },
          },
        });
      } catch (error) {
        results.push({
          ...bundle.audit,
          validation: {
            ok: false,
            static: {
              ok: false,
              errors: [error instanceof Error ? error.message : String(error)],
              warnings: [],
              frameErrors: [],
              frameWarnings: [],
              motionWarnings: [],
            },
            browser: {
              ok: false,
              errors: ["browser validation skipped because replay preparation failed"],
              warnings: [],
            },
          },
        });
      }
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    modelCalls: 0,
    legacyRepairs: 0,
    source,
    runs: results,
  }, null, 2));
  // Earlier rejected turns are expected evidence in a recovered history. The
  // replay command is green only when the terminal candidate passes the
  // current gate; every prior rejection remains visible in the JSON.
  const terminalValidation = [...results]
    .reverse()
    .find((result) => result.artifactKind === "film")?.validation;
  if (
    terminalValidation && typeof terminalValidation === "object" &&
    (terminalValidation as { ok?: boolean }).ok === false
  ) {
    process.exitCode = 1;
  }
}

replay().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
