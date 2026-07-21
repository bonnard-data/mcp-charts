// Spec-file loading + validation for the preview CLI.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpecFile, parseSpec, coerceSpec, SpecLoadError } from "../src/cli/load-spec.js";
import { chart } from "../src/views.js";
import { dashboardFixtures } from "../src/fixtures/dashboards.js";

const dir = mkdtempSync(join(tmpdir(), "mcp-charts-cli-"));
const write = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

const chartSpec = chart(
  [
    { region: "EU", revenue: 100 },
    { region: "US", revenue: 200 },
  ],
  { chartType: "bar", title: "Revenue" },
);

describe("loadSpecFile", () => {
  it("accepts a valid ChartSpec file", () => {
    const path = write("chart.json", JSON.stringify(chartSpec));
    const spec = loadSpecFile(path);
    expect(spec).toEqual(chartSpec);
  });

  it("accepts a valid DashboardSpec file", () => {
    const dash = dashboardFixtures.find((f) => f.name === "grid-2x2")!.spec;
    const path = write("dash.json", JSON.stringify(dash));
    expect(loadSpecFile(path)).toEqual(JSON.parse(JSON.stringify(dash)));
  });

  it("rejects a missing file with the path in the message", () => {
    const missing = join(dir, "nope.json");
    expect(() => loadSpecFile(missing)).toThrowError(SpecLoadError);
    expect(() => loadSpecFile(missing)).toThrowError(/cannot read .*nope\.json/);
  });

  it("rejects invalid JSON with a parse message", () => {
    const path = write("junk.json", "{not json");
    expect(() => loadSpecFile(path)).toThrowError(/is not valid JSON/);
  });

  it("rejects valid JSON that is not a spec, naming what it found", () => {
    const path = write("notspec.json", JSON.stringify({ hello: "world", n: 1 }));
    expect(() => loadSpecFile(path)).toThrowError(/not a ChartSpec or DashboardSpec/);
    expect(() => loadSpecFile(path)).toThrowError(/keys hello, n/);
  });
});

describe("parseSpec / coerceSpec", () => {
  it("suggests the raw-rows mistake for an array", () => {
    expect(() => parseSpec('[{"a":1}]', "input")).toThrowError(/did you pass raw rows/);
  });

  it("rejects primitives and null", () => {
    for (const v of [null, 1, "x", true]) {
      expect(() => coerceSpec(v, "input")).toThrowError(SpecLoadError);
    }
  });

  it("passes a dashboard through untouched", () => {
    const dash = { title: "d", items: [{ type: "kpi", label: "A", value: 1 }] };
    expect(coerceSpec(dash, "input")).toBe(dash);
  });
});
