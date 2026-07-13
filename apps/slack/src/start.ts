import "dotenv/config";
import { startAppHttpServer } from "./httpServer.ts";
import { assertHyperframesSubmissionCompatibility } from "./engine/hyperframesCompatibility.ts";
import { resolveAuthorRoute } from "./engine/lunaRoute.ts";
import {
  inspectLunaWorkerHealth,
  lunaWorkerHealthIsExact,
  resolveLunaWorkerConfig,
} from "./engine/lunaWorkerClient.ts";

assertHyperframesSubmissionCompatibility();
if (resolveAuthorRoute() === "luna-direct") {
  const health = await inspectLunaWorkerHealth(resolveLunaWorkerConfig());
  if (!lunaWorkerHealthIsExact(health)) {
    throw new Error(
      `Luna worker is not exact/ready: ${health.status ?? "unknown status"}; ` +
      `model=${health.model ?? "missing"}; reasoning=${health.reasoningEffort ?? "missing"}; ` +
      `version=${health.version ?? "missing"}`,
    );
  }
  console.log(
    `[luna] worker ready; model=${health.model ?? "gpt-5.6-sol"}; version=${health.version ?? "unknown"}`,
  );
}
const httpServer = await startAppHttpServer();

try {
  // The Socket Mode app remains isolated in index.ts. Keeping deployment
  // plumbing here lets scripts and tests import application modules without
  // unexpectedly opening a network listener.
  await import("./index.ts");
  httpServer.markReady();
} catch (error) {
  await httpServer.close();
  throw error;
}
