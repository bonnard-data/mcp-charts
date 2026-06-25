import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which sets root: "src" for the single-file build).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
