import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Fast route-owned qualification for the production Luna path. Shared engine
 * coverage remains in the normal Slack suite; this lane answers the narrower
 * question "can the default Slack/Luna route transport, accept, recover and
 * report honestly?" without pulling the legacy author committee into the
 * signal.
 */
export default defineConfig({
  root: repositoryRoot,
  test: {
    watch: false,
    include: [
      "apps/slack/test/luna*.test.ts",
      "apps/slack/test/sequenceCheckStatus.test.ts",
      "apps/slack/test/orchestrator.test.ts",
      "apps/slack/test/blocks.test.ts",
      "apps/slack/test/stageTimings.test.ts",
      "apps/slack/test/featureFlags.test.ts",
      "apps/slack/test/assetBrief.test.ts",
      "apps/slack/test/assetPack.test.ts",
    ],
    server: {
      deps: {
        inline: [/@hyperframes[\\/]core/],
      },
    },
  },
});
