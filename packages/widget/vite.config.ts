import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// index.html's CSP describes the SHIPPED artifact, where every script is inlined: it grants
// 'unsafe-inline' but no origin, and denies connect-src. Served from the dev server the widget is a
// module graph instead (/main.ts, the HMR client, its websocket), so the CSP blocks the renderer
// from booting and the harness iframe stays blank with nothing thrown on the parent side. Strip it
// while serving; the built file keeps it verbatim.
function dropWidgetCspInDev(): Plugin {
  return {
    name: "bonnard:drop-widget-csp-in-dev",
    transformIndexHtml(html) {
      return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "");
    },
  };
}

// Bundles the widget (cross-host adapter + renderer) into ONE inlined HTML file.
// That file becomes the `ui://` resource served by @bonnard/mcp-charts.
// singleFile is a build-only concern (it inlines assets); running it in `vite` dev throws, so gate
// it on the build command. The dev server also serves harness.html (the dev-only preview harness).
export default defineConfig(({ command }) => ({
  root: "src",
  plugins: command === "build" ? [viteSingleFile()] : [dropWidgetCspInDev()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: { input: "src/index.html" },
  },
}));
