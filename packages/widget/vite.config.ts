import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Bundles the widget (cross-host adapter + renderer) into ONE inlined HTML file.
// That file becomes the `ui://` resource served by @bonnard/mcp-charts.
export default defineConfig({
  root: "src",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: { input: "src/index.html" },
  },
});
