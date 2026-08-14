// Synthetic data at a chosen density, so a cap can be walked up to and over without hand-writing
// 3,000 rows. It learns the fixture's own shape (its fields and encoding) and generates plausible
// values for it; the fixture itself is never touched, and clearing the synth state restores it.
//
// The generator is seeded, so "it broke at 5,000 rows" is a seed and a count, not a story.
import type { ChartData, ChartType, FieldMeta, TimeGranularity } from "@bonnard/mcp-charts";
import { inferFields } from "../../../core/src/resolve/infer.js";
import type { Fixture } from "../../test/fixtures.js";

// Fixed snap points rather than a slider: these straddle the real caps (MAX_BARS 30, MAX_POINTS
// and MAX_SCATTER_POINTS 2000, EMBED_LIMITS.maxRows 20000). On a continuous slider, landing on a
// boundary is a matter of luck.
export const DENSITY_STEPS = [10, 50, 500, 2000, 5000, 20000] as const;

// Share, monotonic-stage and signed-bridge semantics do not survive random values: a pie of noise
// or a funnel that widens says nothing about the renderer.
const SYNTHESIZABLE = new Set<ChartType>(["bar", "line", "area", "scatter", "table"]);

export function supportsSynth(chartType: ChartType | undefined): boolean {
  return !!chartType && SYNTHESIZABLE.has(chartType);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller, for scatter clouds that look like a relationship. */
function gaussian(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface Stats {
  mean: number;
  spread: number;
  min: number;
}

function statsFor(rows: Record<string, unknown>[], key: string): Stats {
  const values = rows.map((r) => Number(r[key])).filter((v) => Number.isFinite(v));
  if (values.length === 0) return { mean: 1000, spread: 300, min: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, spread: Math.sqrt(variance) || Math.abs(mean) * 0.2 || 1, min: Math.min(...values) };
}

const DAY_MS = 86_400_000;

function stepFrom(start: Date, i: number, granularity: TimeGranularity): string {
  const d = new Date(start.getTime());
  if (granularity === "month") d.setUTCMonth(d.getUTCMonth() + i);
  else if (granularity === "quarter") d.setUTCMonth(d.getUTCMonth() + i * 3);
  else if (granularity === "year") d.setUTCFullYear(d.getUTCFullYear() + i);
  else return new Date(start.getTime() + i * (granularity === "week" ? 7 : 1) * DAY_MS).toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function firstDate(rows: Record<string, unknown>[], key: string): Date {
  const raw = String(rows[0]?.[key] ?? "").slice(0, 10);
  const d = new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "2024-01-01"}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? new Date(Date.UTC(2024, 0, 1)) : d;
}

/** The fixture's own distinct values for a column, so a synthetic series keeps its real labels. */
function distinct(rows: Record<string, unknown>[], key: string): string[] {
  const seen = [...new Set(rows.map((r) => String(r[key] ?? "(No value)")))];
  return seen.length ? seen : ["(No value)"];
}

interface Shape {
  fields: FieldMeta[];
  time?: FieldMeta;
  dimension?: FieldMeta;
  series?: FieldMeta;
  measures: FieldMeta[];
}

function shapeOf(fixture: Fixture): Shape {
  const fields = inferFields(fixture.data);
  const encode = fixture.data.encode ?? {};
  const time = fields.find((f) => f.role === "time");
  const seriesName = encode.series;
  const series = seriesName ? fields.find((f) => f.name === seriesName && f.kind !== "number") : undefined;
  const dimension = fields.find((f) => f.role === "dimension" && f.name !== series?.name);
  return { fields, time, dimension, series, measures: fields.filter((f) => f.role === "measure") };
}

/**
 * Generate `rows` rows in the fixture's shape. Time x steps at the declared granularity with the
 * measures on a random walk around their original level; a categorical x gets a long-tailed value
 * distribution, so a bar cap trips the way real ranked data trips it; a scatter gets correlated
 * points around the original ranges.
 */
export function synthesize(fixture: Fixture, rows: number, seed: number): ChartData {
  const rnd = mulberry32(seed);
  const shape = shapeOf(fixture);
  const source = fixture.data.rows;
  const stats = new Map(shape.measures.map((m) => [m.name, statsFor(source, m.name)]));
  const out: Record<string, unknown>[] = [];

  const isScatter = fixture.opts.chartType === "scatter";
  if (isScatter && shape.measures.length >= 2) {
    const [xm, ym] = shape.measures as [FieldMeta, FieldMeta];
    const xs = stats.get(xm.name)!;
    const ys = stats.get(ym.name)!;
    const groups = shape.series ? distinct(source, shape.series.name) : null;
    for (let i = 0; i < rows; i++) {
      const g = gaussian(rnd);
      const x = Math.max(0, Math.round(xs.mean + g * xs.spread));
      // Correlated, not independent: an unrelated cloud hides everything the renderer does with one.
      const y = Math.max(0, Math.round(ys.mean + g * ys.spread * 0.75 + gaussian(rnd) * ys.spread * 0.55));
      out.push({
        ...(groups && shape.series ? { [shape.series.name]: groups[i % groups.length]! } : {}),
        [xm.name]: x,
        [ym.name]: y,
        ...Object.fromEntries(shape.measures.slice(2).map((m) => [m.name, Math.round(stats.get(m.name)!.mean)])),
      });
    }
    return { rows: out, fields: shape.fields, ...(fixture.data.encode && { encode: fixture.data.encode }) };
  }

  const seriesValues = shape.series ? distinct(source, shape.series.name) : shape.time ? null : null;
  const perX = seriesValues?.length ?? 1;
  const xCount = Math.max(1, Math.ceil(rows / perX));
  const start = shape.time ? firstDate(source, shape.time.name) : null;
  const granularity = shape.time?.granularity ?? "day";
  // A random walk keeps consecutive points related, which is what makes a line worth looking at.
  const walk = new Map(shape.measures.map((m) => [m.name, stats.get(m.name)!.mean]));

  for (let i = 0; i < xCount && out.length < rows; i++) {
    const x = start
      ? stepFrom(start, i, granularity)
      : `${shape.dimension?.name ?? "category"}-${String(i + 1).padStart(4, "0")}`;
    for (let s = 0; s < perX && out.length < rows; s++) {
      const row: Record<string, unknown> = {};
      if (start && shape.time) row[shape.time.name] = x;
      else if (shape.dimension) row[shape.dimension.name] = x;
      if (seriesValues && shape.series) row[shape.series.name] = seriesValues[s]!;
      for (const m of shape.measures) {
        const st = stats.get(m.name)!;
        let value: number;
        if (start) {
          value = Math.max(st.min, walk.get(m.name)! + (rnd() - 0.5) * st.spread * 0.8);
          if (s === perX - 1) walk.set(m.name, value);
        } else {
          // Power law: a few large categories and a long thin tail, so a top-N cap is meaningful.
          value = st.mean * 4 * Math.pow(i + 1, -1.1) * (0.7 + rnd() * 0.6);
        }
        row[m.name] = m.format === "percent" ? Math.round(value * 1000) / 1000 : Math.round(value);
      }
      out.push(row);
    }
  }

  return { rows: out, fields: shape.fields, ...(fixture.data.encode && { encode: fixture.data.encode }) };
}
