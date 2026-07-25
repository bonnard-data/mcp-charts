import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which sets root: "src" for the single-file build).
//
// Two lanes. The structural lane is linkedom and needs nothing; the browser lane drives a real
// Chrome against the BUILT dist/index.html, so it is slower and requires `pnpm build` first.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/embed-browser.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["test/embed-browser.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // One browser page drives every case in order; parallel files would fight over it.
          fileParallelism: false,
        },
      },
    ],
  },
});
