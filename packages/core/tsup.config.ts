import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/bigquery.ts",
    "src/duckdb.ts",
    "src/postgres.ts",
    "src/snowflake.ts",
    "src/databricks.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
