// Embed-mode cases: one source of truth for the structural/snapshot tests and the runnable gallery
// at examples/embed/. Each entry is exactly what a consumer posts in `bonnard:render`.
import type { ChartSpec, DashboardItem, DashboardSpec } from "@bonnard/mcp-charts";

export interface EmbedFixture {
  name: string;
  /** How the consumer would size the container: `fill` for charts, `content` for intrinsic cells. */
  sizing: "fill" | "content";
  payload: ChartSpec | DashboardSpec | DashboardItem;
  /** Select one cell of a DashboardSpec payload. */
  item?: number;
}

const revenueByRegion: ChartSpec = {
  chartType: "bar",
  title: "Revenue by region",
  data: [
    { region: "EMEA", revenue: 43700 },
    { region: "AMER", revenue: 31200 },
    { region: "APAC", revenue: 18400 },
  ],
  x: "region",
  series: [{ key: "revenue", label: "Revenue", format: "currency", currency: "USD" }],
  legend: false,
};

const signupsByWeek: ChartSpec = {
  chartType: "line",
  title: "Signups by week",
  data: [
    { week: "2026-06-01", signups: 120 },
    { week: "2026-06-08", signups: 164 },
    { week: "2026-06-15", signups: 152 },
    { week: "2026-06-22", signups: 209 },
  ],
  x: "week",
  series: [{ key: "signups", label: "Signups" }],
  legend: false,
};

const churnTable: ChartSpec = {
  chartType: "table",
  data: [
    { plan: "Team", accounts: 412, churn: 0.021 },
    { plan: "Business", accounts: 188, churn: 0.014 },
  ],
  columns: [
    { key: "plan", label: "Plan" },
    { key: "accounts", label: "Accounts" },
    { key: "churn", label: "Churn", format: "percent" },
  ],
  x: "plan",
  series: [],
  legend: false,
};

const twoUp: DashboardSpec = {
  title: "Q2 performance",
  columns: 2,
  items: [
    {
      type: "kpi",
      label: "MRR",
      value: 128400,
      format: "currency",
      currency: "USD",
      delta: 0.12,
      caption: "vs last month",
    },
    { type: "chart", spec: signupsByWeek },
  ],
};

export const embedFixtures: EmbedFixture[] = [
  {
    name: "kpi",
    sizing: "content",
    payload: {
      type: "kpi",
      label: "Revenue",
      value: 128400,
      format: "currency",
      currency: "USD",
      delta: 0.12,
      caption: "vs last month",
    },
  },
  { name: "chart", sizing: "fill", payload: { type: "chart", spec: revenueByRegion } },
  { name: "bare-chart-spec", sizing: "fill", payload: revenueByRegion },
  { name: "table", sizing: "content", payload: { type: "chart", spec: churnTable } },
  {
    name: "text",
    sizing: "content",
    payload: {
      type: "text",
      heading: "What changed",
      text: "EMEA carried the quarter; APAC softened after the June price change.",
    },
  },
  { name: "dashboard-item-1", sizing: "fill", payload: twoUp, item: 1 },
  { name: "dashboard-item-0", sizing: "content", payload: twoUp, item: 0 },
  { name: "whole-dashboard", sizing: "content", payload: twoUp },
  {
    name: "chart-with-notes",
    sizing: "fill",
    payload: {
      type: "chart",
      spec: { ...revenueByRegion, notes: ["Coerced revenue to numbers.", "Showing the top 3 of 12 regions."] },
    },
  },
];
