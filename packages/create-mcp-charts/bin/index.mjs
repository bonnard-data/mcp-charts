#!/usr/bin/env node
// Scaffold a minimal MCP server with agent-ready charts. Node built-ins only — no scaffolding
// framework, no network. Copies template/ into a target dir, substitutes the project name, and
// unhides the dotfiles npm would otherwise strip from the published tarball.
//
//   npm create @bonnard/mcp-charts my-charts-server
//   npm create @bonnard/mcp-charts            # prompts for a directory
import { cp, readFile, writeFile, rename, readdir, access } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { stdin, stdout, argv, exit } from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, "..", "template");

// The core version the template pins. Bump alongside a core release before publishing this package.
const CORE_VERSION = "^0.1.2";

// Files renamed on copy: npm excludes .gitignore/.npmrc from a package tarball, so ship them with a
// leading underscore in the template and restore the dotted name in the generated project.
const RENAME = { _gitignore: ".gitignore" };

/** @param {string} p */
async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let target = argv[2];
  if (!target) {
    const rl = createInterface({ input: stdin, output: stdout });
    target = (await rl.question("Project directory (default: mcp-charts-server): ")).trim() || "mcp-charts-server";
    rl.close();
  }

  const dir = resolve(process.cwd(), target);
  const name =
    basename(dir)
      .replace(/[^a-z0-9-]/gi, "-")
      .toLowerCase() || "mcp-charts-server";

  if (await pathExists(dir)) {
    const entries = await readdir(dir);
    if (entries.length > 0) {
      console.error(`refusing to scaffold into non-empty directory: ${dir}`);
      exit(1);
    }
  }

  await cp(TEMPLATE, dir, { recursive: true });

  for (const [from, to] of Object.entries(RENAME)) {
    const src = join(dir, from);
    if (await pathExists(src)) await rename(src, join(dir, to));
  }

  // Substitute placeholders across the generated text files: __PROJECT_NAME__ everywhere,
  // __CORE_VERSION__ (only in package.json) for the pinned core dependency.
  const substituted = ["package.json", "README.md", join("src", "server.ts")];
  for (const rel of substituted) {
    const p = join(dir, rel);
    if (!(await pathExists(p))) continue;
    const out = (await readFile(p, "utf8"))
      .replaceAll("__PROJECT_NAME__", name)
      .replaceAll("__CORE_VERSION__", CORE_VERSION);
    await writeFile(p, out);
  }

  console.log(`\nScaffolded ${name} in ${dir}\n`);
  console.log("Next steps:");
  console.log(`  cd ${target}`);
  console.log("  npm install");
  console.log("  npm start        # serves MCP over Streamable HTTP at http://localhost:3000/mcp");
  console.log("\nThen point Claude Desktop / Cursor / the MCP Inspector at that URL.\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  exit(1);
});
