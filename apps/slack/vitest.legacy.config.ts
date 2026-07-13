import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Explicit rollback-route suite. The ordinary full suite still covers every
 * shared contract; this config gives operators a stable way to qualify the
 * frozen provider committee without conflating it with Luna route health. */
export default defineConfig({
  root: repositoryRoot,
  test: {
    watch: false,
    include: ["apps/slack/test/**/*.test.ts"],
    exclude: ["apps/slack/test/luna*.test.ts"],
    server: {
      deps: {
        inline: [/@hyperframes[\\/]core/],
      },
    },
  },
});
