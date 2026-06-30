import "dotenv/config";
import { startAppHttpServer } from "./httpServer.ts";
import { assertHyperframesSubmissionCompatibility } from "./engine/hyperframesCompatibility.ts";

assertHyperframesSubmissionCompatibility();
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
