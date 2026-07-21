// Flat config (ESLint 10 + typescript-eslint 8). Base = `recommended` (syntactic); we opt INTO the
// high-value type-aware rules rather than enabling the whole `recommendedTypeChecked` set — whose
// no-unsafe-* / no-base-to-string rules fight this library's intentional handling of untyped data
// (arbitrary SQL cell values and ECharts option objects). No rules are blanket-disabled.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "packages/core/src/generated/**", // committed minified widget bundle
      "packages/core/scripts/**", // build .mjs
      "packages/create-mcp-charts/template/**", // scaffold template (has placeholders)
      "**/*.config.{js,ts,mjs}",
      "eslint.config.js",
    ],
  },
  js.configs.recommended,
  // Node ESM tooling scripts (root dev scripts + the scaffold generator bin): Node runtime globals.
  {
    files: ["scripts/**/*.mjs", "packages/create-mcp-charts/bin/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", fetch: "readonly" },
    },
  },
  // Library source: recommended + opt-in type-aware rules that catch real bugs.
  {
    files: ["packages/*/src/**/*.ts", "examples/*/src/**/*.ts"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      // (require-await intentionally NOT enabled: it conflicts with async callbacks that exist to
      // satisfy a Promise-returning interface, e.g. an async runSql wrapping a sync driver.)
    },
  },
  // Tests: recommended only (they live outside the tsconfig projects). `any` is allowed here —
  // tests intentionally read loosely-typed ECharts options and MCP SDK results via casts.
  {
    files: ["packages/*/test/**/*.ts", "**/*.test.ts"],
    extends: [...tseslint.configs.recommended],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  // Permit intentionally-unused names when prefixed with `_`.
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  prettier, // last — disables stylistic rules that conflict with Prettier
);
