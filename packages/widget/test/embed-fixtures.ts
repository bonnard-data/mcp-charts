// Typed view of the embed gallery cases in examples/embed/fixtures.js, so the runnable example and
// the structural snapshots cannot drift: what you see in the browser is what the tests lock.
import type { ChartSpec, DashboardItem, DashboardSpec } from "@bonnard/mcp-charts";
// @ts-expect-error untyped JS data module, shaped by EmbedFixture below
import { embedFixtures as raw } from "../../../examples/embed/fixtures.js";

export interface EmbedFixture {
  name: string;
  /** How the consumer would size the container: `fill` for charts, `content` for intrinsic cells. */
  sizing: "fill" | "content";
  payload: ChartSpec | DashboardSpec | DashboardItem;
  /** Select one cell of a DashboardSpec payload. */
  item?: number;
}

export const embedFixtures = raw as EmbedFixture[];
