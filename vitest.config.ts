import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "packages/platform/test/architecture.test.ts",
    ],
    watch: false,
    // Browser-heavy Slack QA must not saturate shared CI runners and turn
    // fixed per-test deadlines into scheduler-dependent failures.
    maxWorkers: 4,
    server: {
      deps: {
        inline: [/@hyperframes[\\/]core/],
      },
    },
  },
});
