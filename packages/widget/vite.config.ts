import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Bundles the widget (cross-host adapter + renderer) into ONE inlined HTML file.
// That file becomes the `ui://` resource served by @bonnard/mcp-charts.
// singleFile is a build-only concern (it inlines assets); running it in `vite` dev throws, so gate
// it on the build command. The dev server also serves harness.html (the dev-only preview harness).
export default defineConfig(({ command }) => ({
  root: "src",
  plugins: command === "build" ? [viteSingleFile()] : [],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: { input: "src/index.html" },
  },
}));
