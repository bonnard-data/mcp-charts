// Authoring-error / feedback map (Track B). A deliberately-wrong or ambiguous authoring input per
// case, asserted against the CURRENT behavior of the library so the feedback map is runnable and any
// future change to it is visible in a diff. This DOCUMENTS reality; it is not a wishlist.
//
// Categories (mirrors docs/authoring-error-map.md):
//   TS-error         -> tsc rejects the snippet at author time (see the `// @ts-expect-error` cases)
//   runtime-error    -> resolve/chart throws, or render_view returns isError
//   note-on-spec     -> renders, but spec.notes carries a relevant warning the dev/agent can see
//   silent-but-wrong -> renders with NO error and NO relevant note, but the spec does NOT match the
//                       authored "correct interpretation" (the DX danger zone)
//   correct          -> handled sensibly, matches the oracle
//
// Lines marked `// SILENT-WRONG` are the risky cases: a wrong chart with no signal to the author.
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { chart, addDashboardViews } from "../src/dashboard-tool.js";
import { inferFields } from "../src/resolve/infer.js";
import type { ChartSpec } from "../src/types.js";

// Convenience: capture a resolve/chart outcome as either a spec or a thrown message.
function run(fn: () => ChartSpec): { spec?: ChartSpec; threw?: string } {
  try {
    return { spec: fn() };
  } catch (e) {
    return { threw: (e as Error).message };
  }
}
const keys = (s: ChartSpec) => s.series.map((x) => x.key);

async function viewsClient(configure: Parameters<typeof addDashboardViews>[1]): Promise<Client> {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  addDashboardViews(server, configure);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

// =============================================================================================
// 1. ENCODE MISTAKES
// =============================================================================================
describe("encode mistakes", () => {
  // E1: typo'd encode.x is the ONLY mapping -> no x survives -> degrades to a table, but a NOTE
  // names the bad column. note-on-spec.
  it("E1 typo'd encode.x -> table + 'Ignored unknown encode column' note", () => {
    const rows = [
      { month: "2026-01", revenue: 10 },
      { month: "2026-02", revenue: 20 },
    ];
    const { spec } = run(() => chart(rows, { encode: { x: "moneth", y: "revenue" } }));
    expect(spec!.chartType).toBe("table");
    expect(spec!.notes?.some((n) => /Ignored unknown encode column "moneth"/.test(n))).toBe(true);
  });

  // E2 (FIXED): encode.y names a column not present in the rows; the valid encode.x still plots. The
  // phantom "profit" series is now DROPPED (it was already flagged as ignored), so the spec and the
  // note agree: no series key without a backing column. With no measure left, the zero-series guard
  // also fires. note-on-spec (two aligned notes, no phantom series).
  it("E2 encode column absent from rows -> ignored note, no phantom series, zero-series note", () => {
    const rows = [
      { region: "EU", sales: 10 },
      { region: "US", sales: 20 },
    ];
    const { spec } = run(() => chart(rows, { encode: { x: "region", y: "profit" } }));
    expect(spec!.chartType).toBe("bar");
    expect(keys(spec!)).toEqual([]); // no phantom series
    expect(spec!.notes?.some((n) => /Ignored unknown encode column "profit"/.test(n))).toBe(true);
    expect(spec!.notes?.some((n) => /No measure column to plot/.test(n))).toBe(true);
  });

  // E3: x/y swapped — dev put the measure on x and the dimension on y. Both columns exist, so NO
  // note fires; the library dutifully plots a "region" series over a numeric "sales" x. The chart
  // is nonsense (a string measure), and nothing tells the author. SILENT-WRONG.
  it("E3 swapped x/y -> renders nonsense, no note", () => {
    const rows = [
      { region: "EU", sales: 10 },
      { region: "US", sales: 20 },
    ];
    const { spec } = run(() => chart(rows, { encode: { x: "sales", y: "region" } }));
    expect(spec!.chartType).toBe("bar");
    expect(spec!.x).toBe("sales"); // measure used as the axis
    expect(keys(spec!)).toEqual(["region"]); // a string column plotted as a measure
    expect(spec!.notes ?? []).toEqual([]); // SILENT-WRONG
  });
});

// =============================================================================================
// 2. CHART-TYPE vs DATA MISMATCH
// =============================================================================================
describe("chartType vs data mismatch", () => {
  // C1 (SIGNALLED): pie forced onto 3 measures with no dimension. The all-measures path promotes the
  // lowest-cardinality measure ("a") to the x/label, then plots b AND c as slices of a multi-series
  // pie. The forced-type precondition guard now NOTES the multi-measure pie. note-on-spec.
  it("C1 pie with 3 measures / no dimension -> multi-slice + precondition note", () => {
    const rows = [
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: 6 },
    ];
    const { spec } = run(() => chart(rows, { chartType: "pie" }));
    expect(spec!.chartType).toBe("pie");
    expect(spec!.x).toBe("a");
    expect(keys(spec!)).toEqual(["b", "c"]);
    expect(spec!.notes?.some((n) => /A pie needs one category \+ one measure/.test(n))).toBe(true);
  });

  // C2: scatter with a single numeric column. The scatter branch requires two numeric columns and
  // THROWS a clear message. runtime-error (good).
  it("C2 scatter with one numeric column -> throws", () => {
    const rows = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const { threw } = run(() => chart(rows, { chartType: "scatter" }));
    expect(threw).toMatch(/scatter chart needs two numeric columns/);
  });

  // C3 (SIGNALLED): line over a purely categorical x. The library honors the forced type and draws a
  // line connecting categories (A-B-C), but now NOTES that a line implies an order the categories
  // may not have and suggests a bar. note-on-spec (the honored-forced-type is kept).
  it("C3 line with categorical x -> line over categories + precondition note", () => {
    const rows = [
      { cat: "A", v: 1 },
      { cat: "B", v: 2 },
      { cat: "C", v: 3 },
    ];
    const { spec } = run(() => chart(rows, { chartType: "line" }));
    expect(spec!.chartType).toBe("line");
    expect(spec!.x).toBe("cat");
    expect(spec!.notes?.some((n) => /implies an order that may not exist/.test(n))).toBe(true);
  });

  // C4 (SIGNALLED): funnel with two measures / no dimension. The all-measures promotion makes "a" a
  // dimension, so the funnel treats a's values as stage labels and "b" as the value. The precondition
  // guard now NOTES that only measures were supplied and a's values became the stages. note-on-spec.
  it("C4 funnel with wrong shape (two measures) -> uses a as stages + precondition note", () => {
    const rows = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ];
    const { spec } = run(() => chart(rows, { chartType: "funnel" }));
    expect(spec!.chartType).toBe("funnel");
    expect(spec!.x).toBe("a");
    expect(keys(spec!)).toEqual(["b"]);
    expect(spec!.notes?.some((n) => /A funnel needs a stage\/label column and one measure/.test(n))).toBe(true);
  });

  // C5: waterfall with a single row -> throws (needs a start + one step). runtime-error (good).
  it("C5 waterfall single row -> throws", () => {
    const { threw } = run(() => chart([{ step: "start", d: 100 }], { chartType: "waterfall" }));
    expect(threw).toMatch(/at least a start total and one change step/);
  });

  // C6: waterfall with no dimension (only measures) -> throws (needs a step label). runtime-error.
  it("C6 waterfall with no label column -> throws", () => {
    const { threw } = run(() => chart([{ a: 1 }, { b: 2 }], { chartType: "waterfall" }));
    expect(threw).toMatch(/needs a step label and a numeric value/);
  });

  // C7: table is the always-ok raw-grid baseline. correct.
  it("C7 table baseline -> passthrough grid", () => {
    const rows = [
      { region: "EU", sales: 10 },
      { region: "US", sales: 20 },
    ];
    const { spec } = run(() => chart(rows, { chartType: "table" }));
    expect(spec!.chartType).toBe("table");
    expect(spec!.data.length).toBe(2);
    expect(spec!.columns?.map((c) => c.key)).toEqual(["region", "sales"]);
  });
});

// =============================================================================================
// 3. TYPE-INFERENCE TRAPS
// =============================================================================================
describe("type inference traps", () => {
  // T1: {year, revenue}. year sniffs as a MEASURE (it's a number), but the all-measures
  // numeric-grouping path rescues it: the lowest-cardinality numeric becomes the x dimension, so
  // year ends up as the x-axis of a bar chart. correct (the intended save).
  it("T1 {year, revenue} -> year rescued as x", () => {
    const rows = [
      { year: 2021, revenue: 10 },
      { year: 2022, revenue: 20 },
      { year: 2023, revenue: 30 },
    ];
    const { spec } = run(() => chart(rows));
    expect(spec!.chartType).toBe("bar");
    expect(spec!.x).toBe("year");
    expect(keys(spec!)).toEqual(["revenue"]);
  });

  // T2: {store_id, sales}. Same numeric-grouping rescue: store_id (lower cardinality tie -> first
  // column) becomes x. Sensible for THIS data, but note it is a heuristic, not a guarantee. correct.
  it("T2 {store_id, sales} -> store_id rescued as x", () => {
    const rows = [
      { store_id: 101, sales: 10 },
      { store_id: 102, sales: 20 },
      { store_id: 103, sales: 30 },
    ];
    const { spec } = run(() => chart(rows));
    expect(spec!.x).toBe("store_id");
    expect(keys(spec!)).toEqual(["sales"]);
  });

  // T3 (RECOVERED): numeric-string measure ("1234"). Inference now recovers a string column whose
  // values are all numeric strings (and not year-like) to a NUMBER measure, so resolve's
  // measure-coercion plots it. The chart renders `sales` as a real bar series, and an advisory note
  // records that the column arrived as strings and was coerced. note-on-spec (advisory, not silent).
  it("T3 numeric-string measure -> recovered to measure, renders + advisory note", () => {
    const rows = [
      { region: "EU", sales: "1234" },
      { region: "US", sales: "5678" },
    ];
    const fields = inferFields({ rows });
    expect(fields.find((f) => f.name === "sales")!.role).toBe("measure");
    const { spec } = run(() => chart(rows));
    expect(keys(spec!)).toEqual(["sales"]); // plotted, not blank
    expect(spec!.data.map((r) => r.sales)).toEqual([1234, 5678]); // coerced to numbers
    expect(spec!.notes?.some((n) => /arrived as numbers stored as strings/.test(n))).toBe(true);
  });

  // T4 (SIGNALLED): date as a string in an unusual format ("01/15/2026"). sniffTimeGranularity only
  // recognizes ISO-ish shapes, so this is typed a plain string DIMENSION (not time) and rendered as
  // a bar over categories in SOURCE order (no chronological sort — MM/DD vs DD/MM is ambiguous, so
  // we do NOT parse). The loose-date guard now NOTES it and points at ISO dates. note-on-spec.
  it("T4 date-as-string unusual format -> category, source order, loose-date note", () => {
    const rows = [
      { d: "02/15/2026", v: 2 },
      { d: "01/15/2026", v: 1 },
    ];
    const fields = inferFields({ rows });
    expect(fields.find((f) => f.name === "d")!.kind).toBe("string");
    const { spec } = run(() => chart(rows));
    expect(spec!.chartType).toBe("bar");
    expect(spec!.data.map((r) => r.d)).toEqual(["02/15/2026", "01/15/2026"]); // NOT sorted (unparsed)
    expect(spec!.notes?.some((n) => /looks like non-ISO dates/.test(n))).toBe(true);
  });

  // T5: a boolean column as x. It types as boolean -> dimension, and resolve normalizes true/false
  // to "Yes"/"No" for the axis. Sensible. correct.
  it("T5 boolean column -> Yes/No axis", () => {
    const rows = [
      { active: true, v: 1 },
      { active: false, v: 2 },
    ];
    const { spec } = run(() => chart(rows));
    expect(spec!.x).toBe("active");
    expect(spec!.data.map((r) => r.active).sort()).toEqual(["No", "Yes"]);
  });

  // T6 (SIGNALLED): an all-null column. sniffKind never sees a non-null value -> defaults to
  // "string" -> dimension. So {region, val:null} becomes two dimensions, no measure: empty series.
  // The zero-series guard now NOTES the blank chart instead of leaving it silent. note-on-spec.
  it("T6 all-null column -> string dimension, empty series, zero-series note", () => {
    const rows = [
      { region: "EU", val: null },
      { region: "US", val: null },
    ];
    const fields = inferFields({ rows });
    expect(fields.find((f) => f.name === "val")!.role).toBe("dimension");
    const { spec } = run(() => chart(rows));
    expect(keys(spec!)).toEqual([]);
    expect(spec!.notes?.some((n) => /No measure column to plot/.test(n))).toBe(true);
  });

  // T7: a mixed-type x column (numbers and a string). Consensus sniffing sees disagreement -> types
  // it "string" (dimension). The measure v still plots; x is treated as categories. Reasonable
  // fallback, and the measure is intact. correct (defensive).
  it("T7 mixed-type x column -> string dimension, measure intact", () => {
    const rows = [
      { x: 1, v: 10 },
      { x: "two", v: 20 },
      { x: 3, v: 30 },
    ];
    const fields = inferFields({ rows });
    expect(fields.find((f) => f.name === "x")!.kind).toBe("string");
    const { spec } = run(() => chart(rows));
    expect(keys(spec!)).toEqual(["v"]);
  });

  // T8: a dimension that is entirely one repeated value. Every row shares the same x, so the
  // unaggregated-duplicate path SUMS them into a single bar and emits a note. note-on-spec.
  it("T8 single repeated dimension value -> summed to one bar + note", () => {
    const rows = [
      { region: "EU", v: 1 },
      { region: "EU", v: 2 },
      { region: "EU", v: 3 },
    ];
    const { spec } = run(() => chart(rows));
    expect(spec!.data.length).toBe(1);
    expect(spec!.notes?.some((n) => /Summed 2 row\(s\) that shared the same region/.test(n))).toBe(true);
  });
});

// =============================================================================================
// 4. SHAPE / DEGENERATE
// =============================================================================================
describe("shape / degenerate", () => {
  // S1: empty rows. No columns to infer -> detectChartType falls to table; renders an empty table.
  // No throw, no note. Arguably the caller wanted a chart of nothing; a table of zero rows is a
  // reasonable, honest outcome. correct (degenerate-but-honest).
  it("S1 empty rows -> empty table, no throw", () => {
    const { spec } = run(() => chart([]));
    expect(spec!.chartType).toBe("table");
    expect(spec!.data.length).toBe(0);
  });

  // S2: a single row {region, sales} -> a one-bar bar chart. correct.
  it("S2 single row -> single-bar chart", () => {
    const { spec } = run(() => chart([{ region: "EU", sales: 10 }]));
    expect(spec!.chartType).toBe("bar");
    expect(spec!.data.length).toBe(1);
  });

  // S3: a single (measure-only) column -> no x-axis to plot against -> falls back to a table.
  // correct (the documented single-measure -> table path).
  it("S3 single column -> table fallback", () => {
    const { spec } = run(() => chart([{ sales: 10 }, { sales: 20 }]));
    expect(spec!.chartType).toBe("table");
  });

  // S4: rows with inconsistent keys (some missing b). inferFields reads column names from the FIRST
  // row only, so b is still typed; missing cells are treated as gaps. Renders without error or note.
  // The b series has a hole. Defensible, but a dev with ragged rows gets no warning. Classified
  // correct here (renders the intended chart; the gap is a data property, not a mis-encode).
  it("S4 inconsistent keys -> renders, first-row schema, no throw", () => {
    const rows = [{ a: 1, b: 2 }, { a: 3 }, { a: 5, b: 6 }];
    const { spec } = run(() => chart(rows));
    expect(spec!.x).toBe("a");
    expect(keys(spec!)).toEqual(["b"]);
  });

  // S5: very high cardinality categorical bar. Does NOT error (the requirement): it caps to the top
  // 30 by value and emits a note. It also flips horizontal for label readability. note-on-spec.
  it("S5 high-cardinality bar -> top-N cap + note, no error", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ cat: `c${i}`, v: i }));
    const { spec } = run(() => chart(rows, { chartType: "bar" }));
    expect(spec!.data.length).toBe(30);
    expect(spec!.notes?.some((n) => /Showing the top 30 of 500 categories/.test(n))).toBe(true);
  });
});

// =============================================================================================
// 5. THE fields / encode ESCAPE HATCHES
// =============================================================================================
describe("fields / encode escape hatches", () => {
  // F1: declaring fields fixes a bad inference. {year, revenue} with year declared as a dimension
  // pins it as the x-axis explicitly (not relying on the numeric-grouping heuristic). correct.
  it("F1 fields override -> year pinned as dimension", () => {
    const rows = [
      { year: 2021, revenue: 10 },
      { year: 2022, revenue: 20 },
    ];
    const { spec } = run(() =>
      chart(rows, {
        fields: [
          { name: "year", role: "dimension", kind: "number" },
          { name: "revenue", role: "measure", kind: "number" },
        ],
      }),
    );
    expect(spec!.x).toBe("year");
    expect(keys(spec!)).toEqual(["revenue"]);
  });

  // F2 (SIGNALLED): a WRONG fields declaration. Declaring revenue as a string dimension makes the
  // measure vanish -> empty series. The escape hatch is still trusted verbatim (the declaration
  // wins), but the zero-series guard now NOTES the resulting blank chart. note-on-spec.
  it("F2 wrong fields declaration -> measure lost, empty series, zero-series note", () => {
    const rows = [
      { region: "EU", revenue: 10 },
      { region: "US", revenue: 20 },
    ];
    const { spec } = run(() => chart(rows, { fields: [{ name: "revenue", role: "dimension", kind: "string" }] }));
    expect(keys(spec!)).toEqual([]);
    expect(spec!.notes?.some((n) => /No measure column to plot/.test(n))).toBe(true);
  });
});

// =============================================================================================
// 6. DASHBOARD / KPI / VIEW-LEVEL (via a real in-memory MCP client)
// =============================================================================================
describe("view-level (render_view / addDashboardViews)", () => {
  // V1: unknown view_id. The tool's inputSchema is a z.enum of the known ids, so the MCP layer
  // rejects it BEFORE the handler with a validation error. runtime-error (author-visible at
  // call-time). This is the enum-blocks-it case.
  it("V1 unknown view_id -> schema validation error", async () => {
    const client = await viewsClient({
      views: [{ id: "sales", title: "Sales", description: "d", render: () => chart([{ region: "EU", v: 1 }]) }],
    });
    const res = (await client.callTool({ name: "render_view", arguments: { view_id: "nope" } })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/validation error|Invalid/i);
  });

  // V2: an undeclared/typo'd params key. The handler parses params with .strict(), so an extra key
  // is rejected with a clear "Unrecognized key" message. runtime-error (good; call-time).
  it("V2 undeclared param key -> strict rejects", async () => {
    const client = await viewsClient({
      views: [
        {
          id: "sales",
          title: "Sales",
          description: "d",
          params: { region: z.string() },
          render: (a) => chart([{ region: String(a.region), v: 1 }]),
        },
      ],
    });
    const res = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales", params: { region: "EU", bogus: 1 } },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Unrecognized key: "bogus"/);
  });

  // V3: a param of the wrong type. zod parse rejects with an author-readable message. runtime-error.
  it("V3 wrong-type param -> zod rejects", async () => {
    const client = await viewsClient({
      views: [
        {
          id: "sales",
          title: "Sales",
          description: "d",
          params: { region: z.string() },
          render: (a) => chart([{ region: String(a.region), v: 1 }]),
        },
      ],
    });
    const res = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales", params: { region: 123 } },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/invalid param "region"/);
  });

  // V4: a missing required param. Same strict-parse path rejects. runtime-error.
  it("V4 missing required param -> zod rejects", async () => {
    const client = await viewsClient({
      views: [
        {
          id: "sales",
          title: "Sales",
          description: "d",
          params: { region: z.string() },
          render: (a) => chart([{ region: String(a.region), v: 1 }]),
        },
      ],
    });
    const res = (await client.callTool({
      name: "render_view",
      arguments: { view_id: "sales", params: {} },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/invalid param "region"/);
  });

  // V5: a view whose render returns something that is neither a ChartSpec nor a DashboardSpec. The
  // handler detects it and returns an isError result with a clear message. runtime-error (good).
  it("V5 render returns non-spec -> isError", async () => {
    const client = await viewsClient({
      views: [{ id: "bad", title: "Bad", description: "d", render: () => ({ foo: "bar" }) as never }],
    });
    const res = (await client.callTool({ name: "render_view", arguments: { view_id: "bad" } })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/neither a ChartSpec nor a DashboardSpec/);
  });
});

// =============================================================================================
// 7. TS-ERROR cases: which mistakes tsc catches at author time.
// Rows are Record<string, unknown>[], so WRONG-DATA never fails tsc; only shape/opts do.
// The `@ts-expect-error` lines below are compiled by `pnpm typecheck` (tsc --noEmit). If any of
// these mistakes STOPPED being a type error, the expect-error would go unused and tsc would fail —
// so these double as assertions that TS still catches (or still does NOT catch) each case.
// =============================================================================================
describe("TS-error boundary (compiled by tsc, asserted structurally here)", () => {
  it("bad ResolveOptions.chartType is a TS error; wrong DATA is NOT", () => {
    const rows = [{ region: "EU", sales: 10 }];

    // TS-ERROR: an unknown chartType is rejected by the ChartType union.
    // @ts-expect-error chartType "piechart" is not a ChartType
    chart(rows, { chartType: "piechart" });

    // TS-ERROR: an unknown FieldRole is rejected.
    // @ts-expect-error role "metric" is not a FieldRole
    chart(rows, { fields: [{ name: "sales", role: "metric" }] });

    // NOT a TS-error: a data-level mistake. Numeric-string values satisfy `unknown`, so tsc is
    // silent — inference recovers T3 at runtime (see the type-inference traps), not at author time.
    const numericStrings: Record<string, unknown>[] = [{ region: "EU", sales: "1234" }];
    chart(numericStrings); // compiles fine

    // NOT a TS-error: a KPI value can be number | string | null, so an object value would be a TS
    // error, but a mistyped-yet-valid primitive is not. (The object case is asserted below.)
    expect(true).toBe(true);
  });

  it("KpiTile.value as an object is a TS error", () => {
    // @ts-expect-error KpiTile.value is number | string | null, not an object
    const tile: import("../src/types.js").KpiTile = { type: "kpi", label: "x", value: { nested: 1 } };
    void tile;
    // @ts-expect-error KpiTile.value is number | string | null, not an array
    const tile2: import("../src/types.js").KpiTile = { type: "kpi", label: "x", value: [1, 2] };
    void tile2;
  });

  it("DashboardSpec.columns / span accept any number (NO range TS-guard)", () => {
    // NOT a TS-error: columns and span are plain `number`, so out-of-range values (0, 99) compile.
    // The renderer clamps at runtime; there is no author-time signal. Documents the gap.
    const spec: import("../src/types.js").DashboardSpec = {
      columns: 99,
      items: [{ type: "kpi", label: "x", value: 1, span: 99 }],
    };
    expect(spec.columns).toBe(99);
  });
});
