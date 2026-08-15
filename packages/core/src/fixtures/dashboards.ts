// Shared dashboard fixtures. Each carries both INPUTS and the expected OUTPUT `spec`: the widget
// consumes `spec`; a platform that composes dashboards from SQL reproduces `spec` from `inputs`.
//
// Chart-cell specs are computed at module load through the library's own path (buildChartData +
// resolve), so a fixture is definitionally what core produces and cannot rot against resolve().
// Fixture names are load-bearing: both repos' tests iterate them by name.
import { buildChartData } from "../adapters/sql.js";
import type { SourceColumn } from "../adapters/sql.js";
import { resolve } from "../resolve/resolve.js";
import type {
  ChartSpec,
  DashboardItem,
  DashboardSpec,
  Decision,
  FieldKind,
  KpiTile,
  ResolveOptions,
  TextBlock,
} from "../types.js";

/** Raw inputs for a chart cell: a SQL-shaped result (rows + typed columns) + resolve options. */
export interface ChartCellInput {
  kind: "chart";
  rows: Record<string, unknown>[];
  columns: SourceColumn[];
  opts: ResolveOptions;
  span?: number;
  /** The cell failed to build. Not something resolve() decides — a hard failure the renderer shows
   *  whatever the audience filter is. */
  error?: string;
}

/** A dashboard-item input: either a chart to be built, or a final KPI/text item. */
export type DashboardItemInput = ChartCellInput | KpiTile | TextBlock;

/** Inputs from which a DashboardSpec is (re)producible without hand-authoring chart specs. */
export interface DashboardFixtureInputs {
  title?: string;
  columns?: number;
  items: DashboardItemInput[];
  notes?: string[];
  /** Dashboard-level decisions, carried through the same way `notes` is. */
  decisions?: Decision[];
}

export interface DashboardFixture {
  name: string;
  inputs: DashboardFixtureInputs;
  spec: DashboardSpec;
}

// Column-type tokens the test mapKind understands. Chart-cell inputs declare these so the fixture
// spec is built the same way an adapter would build it (typed columns -> buildChartData).
const KIND_BY_TOKEN: Record<string, FieldKind> = {
  string: "string",
  number: "number",
  time: "time",
  boolean: "boolean",
};

const mapKind = (type: unknown): FieldKind => KIND_BY_TOKEN[String(type)] ?? "string";

/** Build a ChartCell's ChartSpec through the library path: buildChartData -> resolve. */
export function buildCellSpec(input: ChartCellInput): ChartSpec {
  const data = buildChartData({ rows: input.rows, columns: input.columns, mapKind });
  return resolve(data, input.opts);
}

function isChartInput(input: DashboardItemInput): input is ChartCellInput {
  return (input as ChartCellInput).kind === "chart";
}

function toItem(input: DashboardItemInput): DashboardItem {
  if (isChartInput(input)) {
    return {
      spec: buildCellSpec(input),
      ...(input.span != null && { span: input.span }),
      ...(input.error != null && { error: input.error }),
    };
  }
  return input;
}

function toSpec(inputs: DashboardFixtureInputs): DashboardSpec {
  const spec: DashboardSpec = { items: inputs.items.map(toItem) };
  if (inputs.title != null) spec.title = inputs.title;
  if (inputs.columns != null) spec.columns = inputs.columns;
  if (inputs.notes != null) spec.notes = inputs.notes;
  if (inputs.decisions != null) spec.decisions = inputs.decisions;
  return spec;
}

const col = (name: string, type: string): SourceColumn => ({ name, type });

const chart = (
  rows: Record<string, unknown>[],
  columns: SourceColumn[],
  opts: ResolveOptions,
  span?: number,
): ChartCellInput => ({ kind: "chart", rows, columns, opts, ...(span != null && { span }) });

// --- Reusable chart-cell inputs ---

const barRevenueByStatus = chart(
  [
    { status: "shipped", revenue: 43700 },
    { status: "open", revenue: 8400 },
    { status: "cancelled", revenue: 1450 },
  ],
  [col("status", "string"), col("revenue", "number")],
  { chartType: "bar", title: "Revenue by Status" },
);

const lineMonthly = chart(
  [
    { month: "2026-04-01", revenue: 18000 },
    { month: "2026-05-01", revenue: 15500 },
    { month: "2026-06-01", revenue: 20300 },
  ],
  [col("month", "time"), col("revenue", "number")],
  { chartType: "line", title: "Monthly Revenue" },
);

const pieRegion = chart(
  [
    { region: "EU", revenue: 29300 },
    { region: "US", revenue: 23000 },
    { region: "APAC", revenue: 850 },
  ],
  [col("region", "string"), col("revenue", "number")],
  { chartType: "pie", title: "Revenue by Region" },
);

const tableOrders = chart(
  [
    { id: "o_1001", amount: 4200, status: "shipped" },
    { id: "o_1003", amount: 900, status: "open" },
  ],
  [col("id", "string"), col("amount", "number"), col("status", "string")],
  { chartType: "table", title: "Orders Sample" },
);

const barRegion = chart(
  [
    { region: "EU", revenue: 29300 },
    { region: "US", revenue: 23000 },
  ],
  [col("region", "string"), col("revenue", "number")],
  { chartType: "bar", title: "Revenue by Region" },
);

// An empty result: buildChartData over zero rows, then resolve as a table (matches the platform's
// emptyResult table shape for a cell that returned no rows).
const emptyTable = chart([], [col("label", "string"), col("value", "number")], { chartType: "table" });

// --- Chart cells that make resolve() decide something ---
// One cell per audience, so a surface's audience filter has all three to sort through.

// viewer: 40 categories over the 30-bar cap.
const barCapped = chart(
  Array.from({ length: 40 }, (_, i) => ({ sku: `SKU-${String(i + 1).padStart(3, "0")}`, revenue: 40000 - i * 900 })),
  [col("sku", "string"), col("revenue", "number")],
  { chartType: "bar", title: "Revenue by SKU" },
);

// author: non-ISO dates, plotted as unordered categories.
const barLooseDates = chart(
  [
    { week: "01/05/2026", revenue: 18200 },
    { week: "01/12/2026", revenue: 21400 },
    { week: "01/19/2026", revenue: 16900 },
  ],
  [col("week", "string"), col("revenue", "number")],
  { chartType: "bar", title: "Revenue by Week" },
);

// agent: unaggregated rows, summed on the way in.
const barUnaggregated = chart(
  [
    { status: "shipped", amount: 4200 },
    { status: "shipped", amount: 1800 },
    { status: "open", amount: 900 },
    { status: "open", amount: 640 },
  ],
  [col("status", "string"), col("amount", "number")],
  { chartType: "bar", title: "Amount by Status" },
);

// --- KPI + text item inputs ---

const kpiCurrency: KpiTile = {
  type: "kpi",
  label: "Revenue",
  value: 128400,
  format: "currency",
  currency: "USD",
  delta: 12400,
  caption: "vs last month",
};

const kpiPercent: KpiTile = {
  type: "kpi",
  label: "Conversion",
  value: 0.184,
  format: "percent",
  fraction: true,
  delta: -0.021,
  deltaFraction: true,
};

const kpiPlain: KpiTile = {
  type: "kpi",
  label: "Orders",
  value: 1042,
  caption: "this month",
};

const kpiNull: KpiTile = {
  type: "kpi",
  label: "Refunds",
  value: null,
};

const textIntro: TextBlock = {
  type: "text",
  heading: "Q2 Overview",
  text: "Revenue is up quarter over quarter, led by the EU region.",
  span: 2,
};

// --- The fixtures ---

export const dashboardFixtures: DashboardFixture[] = [
  {
    name: "single-chart",
    ...pack({ columns: 1, items: [barRevenueByStatus] }),
  },
  {
    name: "grid-2x2",
    ...pack({ columns: 2, items: [barRegion, lineMonthly, pieRegion, tableOrders] }),
  },
  {
    name: "kpi-row",
    ...pack({ columns: 3, items: [kpiCurrency, kpiPercent, kpiPlain] }),
  },
  {
    name: "mixed",
    ...pack({
      title: "Sales Dashboard",
      columns: 2,
      items: [textIntro, kpiCurrency, kpiPercent, { ...lineMonthly, span: 2 }],
    }),
  },
  {
    name: "narrow-stacked",
    ...pack({ columns: 1, items: [kpiPlain, barRevenueByStatus, lineMonthly] }),
  },
  {
    // Edge cases in one grid: an empty-result chart cell (renders `.empty`) + a null-value KPI
    // (renders a placeholder, not "null").
    name: "degenerate",
    ...pack({ columns: 2, items: [emptyTable, kpiNull] }),
  },
  {
    // One grid whose cells are addressed to different audiences, so a surface that narrows its
    // audiences visibly keeps some captions and drops others.
    name: "decisions-audiences",
    ...pack({
      title: "What resolve() decided",
      columns: 3,
      items: [barCapped, barLooseDates, barUnaggregated],
    }),
  },
  {
    // Hard failures next to advisories: a cell and a tile that never produced a value (rendered
    // whatever the audience filter is), plus dashboard-level decisions for each audience.
    name: "decisions-errors",
    ...pack({
      title: "Failures and advisories",
      columns: 2,
      items: [
        { ...pieRegion, error: "warehouse connection lost mid-render" },
        { ...kpiNull, error: "query timed out after 30s" },
        barRevenueByStatus,
      ],
      decisions: [
        {
          kind: "item_error",
          audiences: ["agent"],
          message: "1 of 3 items failed to build; the dashboard is incomplete.",
          data: { failed: 1, total: 3 },
        },
        {
          kind: "consumer_note",
          audiences: ["viewer", "agent"],
          message: "Figures are illustrative and exclude intercompany revenue.",
        },
      ],
    }),
  },
];

function pack(inputs: DashboardFixtureInputs): { inputs: DashboardFixtureInputs; spec: DashboardSpec } {
  return { inputs, spec: toSpec(inputs) };
}
