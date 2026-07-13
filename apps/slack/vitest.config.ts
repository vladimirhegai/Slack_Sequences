import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const allSlackTests = "apps/slack/test/**/*.test.ts";
const browserRegressions = "apps/slack/test/**/*.browser.test.ts";

export default defineConfig({
  root: repositoryRoot,
  test: {
    watch: false,
    server: {
      deps: {
        // @hyperframes/core's ESM dist uses extensionless relative imports,
        // which plain Node ESM rejects — let Vite resolve them instead.
        inline: [/@hyperframes[\\/]core/],
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [allSlackTests],
          exclude: [browserRegressions],
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: [browserRegressions],
        },
      },
    ],
  },
});
