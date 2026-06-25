// Shared renderer fixtures: one source of truth for structural tests + visual PNGs + gallery.
// Each is ChartData + resolve options, matching production (data -> resolve() -> render()).
import type { ChartData, ResolveOptions } from "@bonnard/mcp-charts";

export interface Fixture {
  name: string;
  data: ChartData;
  opts: ResolveOptions;
}

const cur = (name: string) => ({ name, role: "measure" as const, kind: "number" as const, format: "currency" as const, currency: "USD" });

export const fixtures: Fixture[] = [
  {
    name: "bar-revenue-by-status",
    opts: { chartType: "bar", title: "Revenue by Order Status" },
    data: {
      rows: [
        { status: "shipped", revenue: 43700 },
        { status: "open", revenue: 8400 },
        { status: "cancelled", revenue: 1450 },
      ],
      fields: [{ name: "status", role: "dimension", kind: "string" }, cur("revenue")],
    },
  },
  {
    name: "bar-long-labels",
    opts: { chartType: "bar", title: "Revenue by Customer" },
    data: {
      rows: [
        { customer: "Hooli", revenue: 16400 },
        { customer: "Umbrella Health", revenue: 14200 },
        { customer: "Northwind Trading", revenue: 11200 },
        { customer: "Stark Industries", revenue: 3900 },
        { customer: "Initech", revenue: 3800 },
        { customer: "Globex", revenue: 3500 },
        { customer: "Soylent", revenue: 300 },
        { customer: "Wonka Industries", revenue: 250 },
      ],
      fields: [{ name: "customer", role: "dimension", kind: "string" }, cur("revenue")],
    },
  },
  {
    name: "bar-horizontal",
    opts: { chartType: "bar", horizontal: true, title: "Top Customers (horizontal)" },
    data: {
      rows: [
        { customer: "Hooli", revenue: 16400 },
        { customer: "Umbrella Health", revenue: 14200 },
        { customer: "Northwind Trading", revenue: 11200 },
      ],
      fields: [{ name: "customer", role: "dimension", kind: "string" }, cur("revenue")],
    },
  },
  {
    name: "grouped-bar-region-plan",
    opts: { chartType: "bar", title: "Revenue by Region and Plan" },
    data: {
      // two dimensions, no time -> the agent maps one to x and one to series via encode.
      encode: { x: "region", series: "plan" },
      rows: [
        { region: "EU", plan: "enterprise", revenue: 25400 },
        { region: "EU", plan: "pro", revenue: 3900 },
        { region: "US", plan: "enterprise", revenue: 16300 },
        { region: "US", plan: "pro", revenue: 6700 },
        { region: "APAC", plan: "free", revenue: 550 },
      ],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "plan", role: "dimension", kind: "string" },
        cur("revenue"),
      ],
    },
  },
  {
    name: "stacked-bar",
    opts: { chartType: "bar", stacking: "stacked", title: "Revenue by Region (stacked plans)" },
    data: {
      encode: { x: "region", series: "plan" },
      rows: [
        { region: "EU", plan: "enterprise", revenue: 25400 },
        { region: "EU", plan: "pro", revenue: 3900 },
        { region: "US", plan: "enterprise", revenue: 16300 },
        { region: "US", plan: "pro", revenue: 6700 },
      ],
      fields: [
        { name: "region", role: "dimension", kind: "string" },
        { name: "plan", role: "dimension", kind: "string" },
        cur("revenue"),
      ],
    },
  },
  {
    name: "line-monthly",
    opts: { chartType: "line", title: "Monthly Revenue Trend" },
    data: {
      rows: [
        { month: "2026-04-01", revenue: 18000 },
        { month: "2026-05-01", revenue: 15500 },
        { month: "2026-06-01", revenue: 20300 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        cur("revenue"),
      ],
    },
  },
  {
    name: "line-single-point",
    opts: { chartType: "line", title: "Single Point" },
    data: {
      rows: [{ month: "2026-04-01", revenue: 18000 }],
      fields: [{ name: "month", role: "time", kind: "time", granularity: "month" }, cur("revenue")],
    },
  },
  {
    name: "area-stacked-plan-over-time",
    opts: { chartType: "area", stacking: "stacked", title: "Revenue by Plan Over Time" },
    data: {
      rows: [
        { month: "2026-04-01", plan: "enterprise", revenue: 13500 },
        { month: "2026-04-01", plan: "pro", revenue: 4300 },
        { month: "2026-05-01", plan: "enterprise", revenue: 11800 },
        { month: "2026-05-01", plan: "pro", revenue: 3200 },
        { month: "2026-06-01", plan: "enterprise", revenue: 16600 },
        { month: "2026-06-01", plan: "pro", revenue: 3700 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "plan", role: "dimension", kind: "string" },
        cur("revenue"),
      ],
    },
  },
  {
    name: "stacked100-plan-mix",
    opts: { chartType: "bar", stacking: "stacked100", title: "Plan Mix by Month (% of revenue)" },
    data: {
      rows: [
        { month: "2026-04-01", plan: "enterprise", revenue: 13500 },
        { month: "2026-04-01", plan: "pro", revenue: 4300 },
        { month: "2026-05-01", plan: "enterprise", revenue: 11800 },
        { month: "2026-05-01", plan: "pro", revenue: 3200 },
        { month: "2026-06-01", plan: "enterprise", revenue: 16600 },
        { month: "2026-06-01", plan: "pro", revenue: 3700 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "plan", role: "dimension", kind: "string" },
        cur("revenue"),
      ],
    },
  },
  {
    name: "combo-revenue-margin",
    opts: { chartType: "bar", title: "Revenue and Margin %" },
    data: {
      // y2 puts margin on a secondary right axis, drawn as a line over the revenue bars.
      encode: { y2: "margin_pct" },
      rows: [
        { month: "2026-04-01", revenue: 17800, margin_pct: 0.42 },
        { month: "2026-05-01", revenue: 15450, margin_pct: 0.38 },
        { month: "2026-06-01", revenue: 20300, margin_pct: 0.45 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        cur("revenue"),
        { name: "margin_pct", role: "measure", kind: "number", format: "percent" },
      ],
    },
  },
  {
    name: "combo-actual-vs-target",
    opts: { chartType: "bar", title: "Revenue vs Target" },
    data: {
      // Same-axis combo: actual as bars, target as a line (both $ on one axis).
      encode: { y: ["revenue", "target"], line: "target" },
      rows: [
        { month: "2026-01-01", revenue: 14200, target: 15000 },
        { month: "2026-02-01", revenue: 16800, target: 15500 },
        { month: "2026-03-01", revenue: 15100, target: 16000 },
        { month: "2026-04-01", revenue: 18900, target: 16500 },
        { month: "2026-05-01", revenue: 17400, target: 17000 },
        { month: "2026-06-01", revenue: 21300, target: 17500 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        cur("revenue"),
        cur("target"),
      ],
    },
  },
  {
    name: "reference-completion-target",
    opts: { chartType: "line", title: "Completion Rate vs Target", reference: { target: 30, average: true } },
    data: {
      rows: [
        { month: "2025-07-01", completion_rate: 23.2 },
        { month: "2025-08-01", completion_rate: 5.2 },
        { month: "2025-09-01", completion_rate: 36.4 },
        { month: "2025-10-01", completion_rate: 9.1 },
        { month: "2025-11-01", completion_rate: 10.1 },
        { month: "2025-12-01", completion_rate: 26.9 },
        { month: "2026-01-01", completion_rate: 24.8 },
        { month: "2026-02-01", completion_rate: 21.8 },
        { month: "2026-03-01", completion_rate: 25.1 },
        { month: "2026-04-01", completion_rate: 20.6 },
      ],
      fields: [
        { name: "month", role: "time", kind: "time", granularity: "month" },
        { name: "completion_rate", role: "measure", kind: "number", format: "percent" },
      ],
    },
  },
  {
    name: "bar-net-flow-negatives",
    opts: { chartType: "bar", title: "Net Flow by Customer (with negatives)" },
    data: {
      rows: [
        { customer: "Hooli", net: 16400 },
        { customer: "Northwind Trading", net: 11200 },
        { customer: "Umbrella Health", net: 3400 },
        { customer: "Stark Industries", net: -300 },
        { customer: "Wonka Industries", net: -250 },
      ],
      fields: [{ name: "customer", role: "dimension", kind: "string" }, cur("net")],
    },
  },
  {
    name: "pie-region",
    opts: { chartType: "pie", title: "Revenue Share by Region" },
    data: {
      rows: [
        { region: "EU", revenue: 29300 },
        { region: "US", revenue: 23000 },
        { region: "APAC", revenue: 850 },
      ],
      fields: [{ name: "region", role: "dimension", kind: "string" }, cur("revenue")],
    },
  },
  {
    name: "pie-two-measures",
    opts: { chartType: "pie", title: "Pie With Two Measures" },
    data: {
      rows: [
        { status: "shipped", revenue: 43700, order_count: 11 },
        { status: "open", revenue: 8400, order_count: 3 },
        { status: "cancelled", revenue: 1450, order_count: 2 },
      ],
      fields: [
        { name: "status", role: "dimension", kind: "string" },
        cur("revenue"),
        { name: "order_count", role: "measure", kind: "number" },
      ],
    },
  },
  {
    name: "line-sparse-gaps",
    opts: { chartType: "line", title: "Weekly Signups (with gaps)" },
    data: {
      rows: [
        { week: "2026-01-05", signups: 40 },
        { week: "2026-01-12", signups: 55 },
        // 2026-01-19 and 01-26 missing -> rendered as a gap
        { week: "2026-02-02", signups: 30 },
        { week: "2026-02-09", signups: 48 },
      ],
      fields: [
        { name: "week", role: "time", kind: "time", granularity: "week" },
        { name: "signups", role: "measure", kind: "number" },
      ],
    },
  },
  {
    name: "pie-high-cardinality",
    opts: { chartType: "pie", title: "Revenue Share (many small slices)" },
    data: {
      rows: [
        { source: "Search", revenue: 4200 },
        { source: "Direct", revenue: 3100 },
        { source: "Social", revenue: 2200 },
        { source: "Email", revenue: 1400 },
        { source: "Referral", revenue: 900 },
        { source: "Affiliate", revenue: 120 },
        { source: "Podcast", revenue: 80 },
        { source: "Billboard", revenue: 40 },
        { source: "Radio", revenue: 25 },
        { source: "Flyer", revenue: 12 },
      ],
      fields: [{ name: "source", role: "dimension", kind: "string" }, cur("revenue")],
    },
  },
  {
    name: "bar-null-dimension",
    opts: { chartType: "bar", title: "Orders by Channel (some null)" },
    data: {
      rows: [
        { channel: "web", orders: 120 },
        { channel: null, orders: 45 },
        { channel: "mobile", orders: 90 },
      ],
      fields: [
        { name: "channel", role: "dimension", kind: "string" },
        { name: "orders", role: "measure", kind: "number" },
      ],
    },
  },
  {
    name: "table-plain",
    opts: { chartType: "table", title: "Orders Sample" },
    data: {
      rows: [
        { id: "o_1001", amount: 4200, status: "shipped" },
        { id: "o_1003", amount: 900, status: "open" },
      ],
      fields: [
        { name: "id", role: "dimension", kind: "string" },
        cur("amount"),
        { name: "status", role: "dimension", kind: "string" },
      ],
    },
  },
  {
    name: "scatter-orders-revenue",
    opts: { chartType: "scatter", title: "Orders vs Revenue" },
    data: {
      rows: [
        { customer: "Hooli", orders: 61, revenue: 354000 },
        { customer: "Umbrella", orders: 55, revenue: 312000 },
        { customer: "Tyrell", orders: 49, revenue: 246000 },
        { customer: "Acme", orders: 38, revenue: 142000 },
        { customer: "Initech", orders: 27, revenue: 96000 },
        { customer: "Globex", orders: 18, revenue: 41000 },
        { customer: "Soylent", orders: 9, revenue: 12000 },
      ],
      fields: [{ name: "customer", role: "dimension", kind: "string" }, { name: "orders", role: "measure", kind: "number" }, cur("revenue")],
    },
  },
  {
    name: "bubble-orders-revenue-aov",
    opts: { chartType: "scatter", title: "Accounts by orders, revenue & AOV" },
    data: {
      encode: { x: "orders", y: "revenue", size: "aov" },
      rows: [
        { customer: "Hooli", orders: 61, revenue: 354000, aov: 5803 },
        { customer: "Umbrella", orders: 55, revenue: 312000, aov: 5673 },
        { customer: "Tyrell", orders: 49, revenue: 246000, aov: 5020 },
        { customer: "Acme", orders: 38, revenue: 142000, aov: 3737 },
        { customer: "Initech", orders: 27, revenue: 96000, aov: 3556 },
        { customer: "Globex", orders: 18, revenue: 41000, aov: 2278 },
        { customer: "Soylent", orders: 9, revenue: 12000, aov: 1333 },
      ],
      fields: [
        { name: "customer", role: "dimension", kind: "string" },
        { name: "orders", role: "measure", kind: "number" },
        cur("revenue"),
        cur("aov"),
      ],
    },
  },
  {
    name: "funnel-activation",
    opts: { chartType: "funnel", title: "Activation funnel" },
    data: {
      rows: [
        { stage: "Visitors", users: 12000 },
        { stage: "Signups", users: 4200 },
        { stage: "Activated", users: 2100 },
        { stage: "Paid", users: 760 },
        { stage: "Renewed", users: 540 },
      ],
      fields: [{ name: "stage", role: "dimension", kind: "string" }, { name: "users", role: "measure", kind: "number" }],
    },
  },
  {
    name: "waterfall-arr-bridge",
    opts: { chartType: "waterfall", title: "ARR movement" },
    data: {
      rows: [
        { step: "Opening ARR", amount: 1800000 },
        { step: "New business", amount: 420000 },
        { step: "Expansion", amount: 180000 },
        { step: "Churn", amount: -240000 },
        { step: "Contraction", amount: -90000 },
        { step: "Closing ARR", amount: 2070000 },
      ],
      fields: [{ name: "step", role: "dimension", kind: "string" }, cur("amount")],
    },
  },
];
