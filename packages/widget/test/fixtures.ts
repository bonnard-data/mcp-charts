// Shared renderer fixtures: one source of truth for structural tests + visual PNGs + gallery.
// Each is ChartData + resolve options, matching production (data -> resolve() -> render()).
import type { ChartData, DecisionKind, ResolveOptions, TimeGranularity } from "@bonnard/mcp-charts";

export interface Fixture {
  name: string;
  data: ChartData;
  opts: ResolveOptions;
  /** Decision kinds this fixture exists to trigger. The harness gallery chips and the catalog
   *  coverage test both read this, so a kind gains a worked example the moment it gains a label. */
  demonstrates?: DecisionKind[];
  /** Declared render expectations. `blank` marks a fixture that draws no marks BY DESIGN (nothing
   *  to plot), so the UAT gate asserts the absence instead of failing on it. */
  expect?: { blank?: true };
}

const cur = (name: string) => ({
  name,
  role: "measure" as const,
  kind: "number" as const,
  format: "currency" as const,
  currency: "USD",
});

const dim = (name: string) => ({ name, role: "dimension" as const, kind: "string" as const });
const num = (name: string) => ({ name, role: "measure" as const, kind: "number" as const });
const pct = (name: string) => ({ ...num(name), format: "percent" as const });
const when = (name: string, granularity: TimeGranularity) => ({
  name,
  role: "time" as const,
  kind: "time" as const,
  granularity,
});

// Generated fixture data must be byte-identical on every run (it feeds the UAT gate and the
// structural tests), so shapes come from index arithmetic, never Math.random.
const DAY_MS = 86_400_000;
const isoDay = (i: number, from = Date.UTC(2024, 0, 1)) => new Date(from + i * DAY_MS).toISOString().slice(0, 10);
const isoMonth = (i: number, year = 2025) => `${year + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`;
const wave = (i: number, amplitude: number, period: number) => Math.round(Math.sin(i / period) * amplitude);

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
      fields: [{ name: "month", role: "time", kind: "time", granularity: "month" }, cur("revenue")],
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
      fields: [{ name: "month", role: "time", kind: "time", granularity: "month" }, cur("revenue"), cur("target")],
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
    demonstrates: ["forced_type_mismatch"],
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
    demonstrates: ["pie_fold"],
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
      fields: [
        { name: "customer", role: "dimension", kind: "string" },
        { name: "orders", role: "measure", kind: "number" },
        cur("revenue"),
      ],
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
      fields: [
        { name: "stage", role: "dimension", kind: "string" },
        { name: "users", role: "measure", kind: "number" },
      ],
    },
  },
  {
    name: "waterfall-arr-bridge",
    demonstrates: ["waterfall_totals_guess"],
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
  {
    // Decisions demo: 40 categories trips MAX_BARS (30) -> a "bar_cap" decision
    // (audiences: viewer, agent). Pick this fixture in the harness to see the viewer-facing
    // truncation caption render under the chart.
    name: "decisions-bar-cap-40-categories",
    demonstrates: ["bar_cap"],
    opts: { chartType: "bar", title: "Revenue by SKU (40 SKUs)" },
    data: {
      rows: Array.from({ length: 40 }, (_, i) => ({
        sku: `SKU-${String(i + 1).padStart(3, "0")}`,
        revenue: 40000 - i * 900 + (i % 3) * 150,
      })),
      fields: [{ name: "sku", role: "dimension", kind: "string" }, cur("revenue")],
    },
  },
  {
    // Decisions demo: `encode.x` names a column the data doesn't have -> an "encode_unknown_column"
    // decision (audience: author only). The harness shows all audiences, so the caption still
    // appears here; the point is that a published/embedded viewer surface (audiences=viewer) would
    // hide it, since this is an authoring mistake, not something to caption for an end viewer.
    name: "decisions-encode-mistake",
    demonstrates: ["encode_unknown_column"],
    opts: { chartType: "bar", title: "Revenue by Region (typo'd encode)" },
    data: {
      encode: { x: "regoin" },
      rows: [
        { region: "EU", revenue: 29300 },
        { region: "US", revenue: 23000 },
        { region: "APAC", revenue: 850 },
      ],
      fields: [{ name: "region", role: "dimension", kind: "string" }, cur("revenue")],
    },
  },

  // --- Realistic density -------------------------------------------------------------------
  // The short fixtures above are legitimate degenerate cases, but a renderer tuned only against
  // three bars hides label collision, axis crowding and legend wrap. These carry production-shaped
  // row counts and trigger no decisions.
  {
    name: "line-daily-90d",
    opts: { chartType: "line", title: "Daily active users (90 days)" },
    data: {
      rows: Array.from({ length: 90 }, (_, i) => ({
        day: isoDay(i),
        active_users: 8400 + wave(i, 900, 11) + wave(i, 340, 3) + i * 12,
      })),
      fields: [when("day", "day"), num("active_users")],
    },
  },
  {
    name: "bar-skus-24",
    opts: { chartType: "bar", title: "Revenue by SKU (24 SKUs)" },
    data: {
      rows: Array.from({ length: 24 }, (_, i) => ({
        sku: `SKU-${String(i + 1).padStart(3, "0")}`,
        revenue: 31000 - i * 1100 + wave(i, 1400, 4),
      })),
      fields: [dim("sku"), cur("revenue")],
    },
  },
  {
    name: "table-orders-200",
    opts: { chartType: "table", title: "Orders (200 rows)" },
    data: {
      rows: Array.from({ length: 200 }, (_, i) => ({
        order_id: `o_${2000 + i}`,
        placed_on: isoDay(i % 90),
        customer: ["Hooli", "Umbrella Health", "Northwind Trading", "Initech", "Globex"][i % 5]!,
        status: ["shipped", "open", "cancelled"][i % 3]!,
        amount: 420 + ((i * 137) % 4800),
      })),
      fields: [dim("order_id"), when("placed_on", "day"), dim("customer"), dim("status"), cur("amount")],
    },
  },
  {
    name: "area-stacked-12m-4-plans",
    opts: { chartType: "area", stacking: "stacked", title: "Revenue by plan (12 months)" },
    data: {
      rows: ["enterprise", "pro", "team", "free"].flatMap((plan, p) =>
        Array.from({ length: 12 }, (_, m) => ({
          month: isoMonth(m),
          plan,
          revenue: [24000, 12000, 6400, 900][p]! + wave(m + p * 3, [3800, 2100, 1200, 260][p]!, 4) + m * (140 - p * 30),
        })),
      ),
      fields: [when("month", "month"), dim("plan"), cur("revenue")],
    },
  },

  // --- Decision coverage -------------------------------------------------------------------
  // One fixture per DecisionKind resolve() can reach, each labelled with what it triggers. The
  // harness catalog test fails if a kind loses its worked example.
  {
    name: "decisions-downsample-line-3000",
    demonstrates: ["downsample"],
    opts: { chartType: "line", title: "Sessions per day (3,000 days)" },
    data: {
      rows: Array.from({ length: 3000 }, (_, i) => ({
        day: isoDay(i),
        sessions: 4200 + wave(i, 900, 30) + wave(i, 220, 7) + Math.round(i * 0.4),
      })),
      fields: [when("day", "day"), num("sessions")],
    },
  },
  {
    name: "decisions-scatter-sample-3000",
    demonstrates: ["scatter_sample"],
    opts: { chartType: "scatter", title: "Sessions vs revenue (3,000 accounts)" },
    data: {
      rows: Array.from({ length: 3000 }, (_, i) => {
        const sessions = 20 + ((i * 37) % 480);
        return { sessions, revenue: 300 + sessions * 42 + wave(i, 2600, 1) };
      }),
      fields: [num("sessions"), cur("revenue")],
    },
  },
  {
    name: "decisions-series-fold-16-plans",
    demonstrates: ["series_fold"],
    opts: { chartType: "line", title: "Revenue by plan (16 plans)" },
    data: {
      rows: Array.from({ length: 16 }, (_, p) => `plan-${String(p + 1).padStart(2, "0")}`).flatMap((plan, p) =>
        Array.from({ length: 8 }, (_, m) => ({
          month: isoMonth(m),
          plan,
          revenue: 26000 - p * 1500 + wave(m + p, 1800, 3),
        })),
      ),
      fields: [when("month", "month"), dim("plan"), cur("revenue")],
    },
  },
  {
    name: "decisions-scatter-groups-20",
    demonstrates: ["series_fold"],
    opts: { chartType: "scatter", title: "Accounts by industry (20 industries)" },
    data: {
      encode: { x: "sessions", y: "revenue", series: "industry" },
      rows: Array.from({ length: 20 }, (_, g) => `industry-${String(g + 1).padStart(2, "0")}`).flatMap((industry, g) =>
        Array.from({ length: 4 }, (_, i) => {
          const sessions = 40 + g * 18 + i * 25;
          return { industry, sessions, revenue: 1200 + sessions * (30 + g) + wave(g * 4 + i, 3000, 2) };
        }),
      ),
      fields: [dim("industry"), num("sessions"), cur("revenue")],
    },
  },
  {
    name: "decisions-loose-dates",
    demonstrates: ["loose_dates"],
    opts: { chartType: "bar", title: "Revenue by week (US-format dates)" },
    data: {
      rows: [
        { week: "01/05/2026", revenue: 18200 },
        { week: "01/12/2026", revenue: 21400 },
        { week: "01/19/2026", revenue: 16900 },
        { week: "01/26/2026", revenue: 23800 },
      ],
      fields: [dim("week"), cur("revenue")],
    },
  },
  {
    name: "decisions-dedupe-sum",
    demonstrates: ["dedupe_sum"],
    opts: { chartType: "bar", title: "Amount by status (unaggregated rows)" },
    data: {
      rows: [
        { status: "shipped", amount: 4200 },
        { status: "shipped", amount: 1800 },
        { status: "shipped", amount: 2650 },
        { status: "open", amount: 900 },
        { status: "open", amount: 640 },
        { status: "cancelled", amount: 320 },
      ],
      fields: [dim("status"), cur("amount")],
    },
  },
  {
    name: "decisions-rate-sum-hazard",
    demonstrates: ["dedupe_sum", "rate_sum_hazard"],
    opts: { chartType: "bar", title: "Conversion rate by channel (unaggregated rows)" },
    data: {
      rows: [
        { channel: "web", conversion_rate: 0.12 },
        { channel: "web", conversion_rate: 0.09 },
        { channel: "mobile", conversion_rate: 0.07 },
        { channel: "mobile", conversion_rate: 0.11 },
        { channel: "partner", conversion_rate: 0.18 },
      ],
      fields: [dim("channel"), pct("conversion_rate")],
    },
  },
  {
    name: "decisions-y2-dropped-on-pivot",
    demonstrates: ["y2_dropped_on_pivot"],
    opts: { chartType: "bar", title: "Revenue by plan, margin asked for a second axis" },
    data: {
      encode: { y2: "margin_pct" },
      rows: ["enterprise", "pro", "team"].flatMap((plan, p) =>
        Array.from({ length: 6 }, (_, m) => ({
          month: isoMonth(m),
          plan,
          revenue: 22000 - p * 6400 + wave(m + p, 2200, 3),
          margin_pct: 0.44 - p * 0.07 + m * 0.004,
        })),
      ),
      fields: [when("month", "month"), dim("plan"), cur("revenue"), pct("margin_pct")],
    },
  },
  {
    name: "decisions-no-measure",
    demonstrates: ["no_measure"],
    expect: { blank: true },
    opts: { chartType: "bar", title: "Accounts by owner (no numeric column)" },
    data: {
      rows: [
        { owner: "Dana Whitfield", account: "Hooli" },
        { owner: "Sam Okafor", account: "Umbrella Health" },
        { owner: "Priya Raman", account: "Northwind Trading" },
        { owner: "Leo Marchetti", account: "Initech" },
      ],
      fields: [dim("owner"), dim("account")],
    },
  },
  {
    name: "decisions-line-over-categories",
    demonstrates: ["forced_type_mismatch"],
    opts: { chartType: "line", title: "Revenue by region (a line over categories)" },
    data: {
      rows: [
        { region: "EU", revenue: 29300 },
        { region: "US", revenue: 23000 },
        { region: "APAC", revenue: 12400 },
        { region: "LATAM", revenue: 6100 },
        { region: "MEA", revenue: 3850 },
      ],
      fields: [dim("region"), cur("revenue")],
    },
  },
  {
    name: "decisions-funnel-numeric-stages",
    demonstrates: ["forced_type_mismatch"],
    opts: { chartType: "funnel", title: "Funnel over numeric stage ids" },
    data: {
      rows: [
        { stage_id: 1, users: 12000 },
        { stage_id: 2, users: 4200 },
        { stage_id: 3, users: 2100 },
        { stage_id: 4, users: 760 },
      ],
      fields: [num("stage_id"), num("users")],
    },
  },
  {
    name: "decisions-pie-all-negative",
    demonstrates: ["pie_negative_magnitudes"],
    opts: { chartType: "pie", title: "Churned ARR by reason (all negative)" },
    data: {
      rows: [
        { reason: "Downgrade", net: -42000 },
        { reason: "Cancellation", net: -31500 },
        { reason: "Contraction", net: -18400 },
        { reason: "Non-renewal", net: -9800 },
      ],
      fields: [dim("reason"), cur("net")],
    },
  },
  {
    // No `fields` entry for revenue: a declared kind suppresses the advisory, so the column has to
    // arrive untyped for the coercion to be worth reporting.
    name: "decisions-coerced-numeric-strings",
    demonstrates: ["coerced_numeric_strings"],
    opts: { chartType: "bar", title: "Revenue by status (numbers arrived as strings)" },
    data: {
      rows: [
        { status: "shipped", revenue: "43700" },
        { status: "open", revenue: "8400" },
        { status: "cancelled", revenue: "1450" },
      ],
      fields: [dim("status")],
    },
  },
  {
    // `raw_amount` sits after the plotted columns in row-key order, so it is carried but never
    // becomes x or a series - which is the case the advisory is for (a wrapper the chart tolerates).
    name: "decisions-driver-wrapped-values",
    demonstrates: ["driver_wrapped_values"],
    opts: { chartType: "bar", title: "Revenue by region (a driver-wrapped extra column)" },
    data: {
      rows: [
        { region: "EU", revenue: 29300, raw_amount: { value: 29300 } },
        { region: "US", revenue: 23000, raw_amount: { value: 23000 } },
        { region: "APAC", revenue: 12400, raw_amount: { value: 12400 } },
      ],
      fields: [dim("region"), cur("revenue")],
    },
  },
  {
    // Agent-only audience: nothing captions until the harness audience toggle leaves "viewer".
    name: "decisions-result-truncated",
    demonstrates: ["result_truncated"],
    opts: { chartType: "bar", title: "Revenue by account (partial result)" },
    data: {
      decisions: [
        {
          kind: "result_truncated",
          audiences: ["agent"],
          message: "Result truncated at the 10,000-row cap; the totals below are partial.",
          data: { cap: 10000 },
        },
      ],
      rows: [
        { account: "Hooli", revenue: 164000 },
        { account: "Umbrella Health", revenue: 142000 },
        { account: "Northwind Trading", revenue: 112000 },
        { account: "Initech", revenue: 38000 },
      ],
      fields: [dim("account"), cur("revenue")],
    },
  },
  {
    name: "decisions-consumer-note",
    demonstrates: ["consumer_note"],
    opts: { chartType: "bar", title: "Revenue by region (with a passed-through note)" },
    data: {
      notes: ["Figures are illustrative and exclude intercompany revenue."],
      rows: [
        { region: "EU", revenue: 29300 },
        { region: "US", revenue: 23000 },
        { region: "APAC", revenue: 12400 },
      ],
      fields: [dim("region"), cur("revenue")],
    },
  },
];
