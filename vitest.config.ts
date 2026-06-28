import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      // This test inspects apps/forge and apps/sequences, which are intentionally
      // absent from the public Slack-only repository.
      "packages/platform/test/architecture.test.ts",
    ],
    watch: false,
    server: {
      deps: {
        inline: [/@hyperframes[\\/]core/],
      },
    },
  },
});
