// One flat list of everything the harness can show: the chart fixtures and core's own dashboard
// fixtures, each with the metadata the gallery filters and labels by.
//
// DOM-free on purpose. A test imports this module standalone to assert that every DecisionKind
// still has a worked example, which is what stops the coverage gap from quietly reopening the next
// time a kind is added.
import type { ChartSpec, ChartType, DashboardSpec, Decision, DecisionKind } from "@bonnard/mcp-charts";
import { dashboardFixtures } from "../../../core/src/fixtures/dashboards.js";
import { fixtures, type Fixture } from "../../test/fixtures.js";
import { buildChartSpec, type Payload } from "./pipeline.js";

export interface Example {
  id: string;
  name: string;
  kind: "chart" | "dashboard";
  /** Gallery grouping: the resolved chart type, or "dashboard". */
  category: string;
  chartType?: ChartType;
  /** Declared on the fixture. The gallery chips and the coverage test both read this. */
  demonstrates: DecisionKind[];
  /** What the built payload actually reports, which is what the overlay's table lists. */
  decisions: Decision[];
  /** Hard failures carried by the payload's items. Never audience-filtered anywhere. */
  errors: string[];
  rowsIn: number;
  rowsOut: number;
  payload: Payload;
  fixture?: Fixture;
}

const isChartCell = (item: unknown): item is { spec: ChartSpec; error?: string } =>
  !!item && typeof item === "object" && "spec" in item;

function dashboardDecisions(spec: DashboardSpec): Decision[] {
  return [...(spec.decisions ?? []), ...spec.items.filter(isChartCell).flatMap((c) => c.spec.decisions ?? [])];
}

function dashboardErrors(spec: DashboardSpec): string[] {
  return spec.items.map((i) => (i as { error?: unknown }).error).filter((e): e is string => typeof e === "string");
}

function chartExample(fixture: Fixture): Example {
  const spec = buildChartSpec(fixture.data, fixture.opts);
  return {
    id: fixture.name,
    name: fixture.name,
    kind: "chart",
    category: spec.chartType,
    chartType: spec.chartType,
    demonstrates: fixture.demonstrates ?? [],
    decisions: spec.decisions ?? [],
    errors: [],
    rowsIn: fixture.data.rows.length,
    rowsOut: spec.data.length,
    payload: spec,
    fixture,
  };
}

function dashboardExample(name: string, spec: DashboardSpec): Example {
  const decisions = dashboardDecisions(spec);
  const cells = spec.items.filter(isChartCell);
  return {
    id: `dashboard:${name}`,
    name,
    kind: "dashboard",
    category: "dashboard",
    // A dashboard fixture has no declared list: its cells are built by core, so what it reports is
    // the only honest claim about what it demonstrates.
    demonstrates: [...new Set(decisions.map((d) => d.kind as DecisionKind))],
    decisions,
    errors: dashboardErrors(spec),
    rowsIn: cells.reduce((n, c) => n + c.spec.data.length, 0),
    rowsOut: cells.reduce((n, c) => n + c.spec.data.length, 0),
    payload: spec,
  };
}

// Toy three-row fixtures are legitimate degenerate cases, but they are not what a renderer needs
// proving against, so anything production-shaped sorts to the top of its category.
const DENSE_ENOUGH = 10;

function byDensityThenOrder(a: Example, b: Example): number {
  const dense = (e: Example) => (e.rowsIn >= DENSE_ENOUGH ? 0 : 1);
  return dense(a) - dense(b);
}

function buildExamples(): Example[] {
  const charts = fixtures.map(chartExample);
  const dashboards = dashboardFixtures.map((f) => dashboardExample(f.name, f.spec));
  const all = [...charts, ...dashboards];
  const categories = [...new Set(all.map((e) => e.category))];
  // Stable within a category (Array.sort is stable), so declaration order still reads through.
  return categories.flatMap((category) => all.filter((e) => e.category === category).sort(byDensityThenOrder));
}

export const examples: Example[] = buildExamples();

export const byId = new Map(examples.map((e) => [e.id, e]));

export interface CategoryCount {
  id: string;
  count: number;
}

export const categories: CategoryCount[] = [...new Set(examples.map((e) => e.category))].map((id) => ({
  id,
  count: examples.filter((e) => e.category === id).length,
}));

/** How many examples declare each kind, for the sidebar's decision list. */
export function decisionCounts(): Map<DecisionKind, number> {
  const counts = new Map<DecisionKind, number>();
  for (const example of examples) {
    for (const kind of new Set(example.demonstrates)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

export interface Query {
  category: string;
  text: string;
  chartType?: ChartType;
  kind?: DecisionKind;
  withDecisions?: boolean;
}

export function filterExamples(query: Query): Example[] {
  const text = query.text.trim().toLowerCase();
  return examples.filter((e) => {
    if (query.category !== "all" && e.category !== query.category) return false;
    if (query.chartType && e.chartType !== query.chartType) return false;
    if (query.kind && !e.demonstrates.includes(query.kind)) return false;
    if (query.withDecisions && e.decisions.length === 0) return false;
    if (!text) return true;
    return (
      e.name.toLowerCase().includes(text) ||
      e.demonstrates.some((k) => k.includes(text)) ||
      e.decisions.some((d) => d.message.toLowerCase().includes(text))
    );
  });
}
