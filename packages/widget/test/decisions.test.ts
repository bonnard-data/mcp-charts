// Audience filtering: which decisions become captions on a rendered surface, how an older
// notes-only spec still renders, and how a cell's hard error differs from an advisory.
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import type { ChartSpec, DashboardSpec, Decision } from "@bonnard/mcp-charts";
import { captionsFor } from "../src/decisions.js";
import { renderChartNotes, renderDashboardShell, renderSingleItem } from "../src/dashboard.js";
import { validatePayload } from "../src/embed-protocol.js";

const doc = (html: string): Document => parseHTML(`<div>${html}</div>`).document as unknown as Document;

const decisions: Decision[] = [
  { kind: "bar_cap", audiences: ["viewer", "agent"], message: "Showing the top 30 of 500 categories by value." },
  { kind: "encode_unknown_column", audiences: ["author"], message: 'Ignored unknown encode column "regoin".' },
  { kind: "dedupe_sum", audiences: ["agent"], message: "Summed 2 row(s) that shared the same region." },
];

const specWithDecisions: ChartSpec = {
  chartType: "bar",
  data: [{ region: "EMEA", revenue: 10 }],
  x: "region",
  series: [{ key: "revenue", label: "Revenue" }],
  legend: false,
  notes: decisions.map((d) => d.message),
  decisions,
};

const legacySpec: ChartSpec = {
  chartType: "bar",
  data: [{ region: "EMEA", revenue: 10 }],
  x: "region",
  series: [{ key: "revenue", label: "Revenue" }],
  legend: false,
  notes: ["Coerced revenue to numbers."],
};

describe("captionsFor", () => {
  it("keeps only the decisions addressed to the given audiences", () => {
    expect(captionsFor(specWithDecisions, ["viewer"])).toEqual(["Showing the top 30 of 500 categories by value."]);
    expect(captionsFor(specWithDecisions, ["author"])).toEqual(['Ignored unknown encode column "regoin".']);
    expect(captionsFor(specWithDecisions, ["viewer", "agent"])).toEqual([
      "Showing the top 30 of 500 categories by value.",
      "Summed 2 row(s) that shared the same region.",
    ]);
    expect(captionsFor(specWithDecisions, [])).toEqual([]);
  });

  it("falls back to a legacy spec's flat notes when it carries no decisions", () => {
    expect(captionsFor(legacySpec, ["viewer"])).toEqual(["Coerced revenue to numbers."]);
    expect(captionsFor(legacySpec, [])).toEqual([]);
  });
});

describe("caption rendering", () => {
  it("a chart cell captions only its viewer decisions by default in embed mode", () => {
    const html = renderSingleItem({ spec: specWithDecisions }, { audiences: ["viewer"] });
    const text = doc(html).querySelector(".cell-notes")?.textContent ?? "";
    expect(text).toContain("Showing the top 30 of 500");
    expect(text).not.toContain("Ignored unknown encode column");
    expect(text).not.toContain("Summed 2 row(s)");
  });

  it("back-compat: an old notes-only spec still renders its captions", () => {
    const html = renderSingleItem({ spec: legacySpec }, { audiences: ["viewer"] });
    expect(doc(html).querySelector(".cell-notes")?.textContent).toContain("Coerced revenue to numbers.");
  });

  it("renderChartNotes shows every audience when none is specified (the MCP host surface)", () => {
    const text = doc(renderChartNotes(specWithDecisions)).querySelector(".cell-notes")?.textContent ?? "";
    for (const d of decisions) expect(text).toContain(d.message);
  });

  it("a dashboard filters its own decisions and its cells' by the same audiences", () => {
    const spec: DashboardSpec = {
      title: "Ops",
      items: [{ spec: specWithDecisions }],
      notes: ["Result truncated at the row cap."],
      decisions: [
        { kind: "result_truncated", audiences: ["agent"], message: "Result truncated at the row cap." },
        { kind: "consumer_note", audiences: ["viewer", "agent"], message: "Figures are illustrative." },
      ],
    };
    const viewer = doc(renderDashboardShell(spec, { audiences: ["viewer"] }));
    expect(viewer.querySelector(".dash-notes")?.textContent).toBe("Figures are illustrative.");
    expect(viewer.querySelector(".cell-notes")?.textContent).toBe("Showing the top 30 of 500 categories by value.");

    const none = doc(renderDashboardShell(spec, { audiences: [] }));
    expect(none.querySelector(".dash-notes")).toBeNull();
    expect(none.querySelector(".cell-notes")).toBeNull();
  });
});

describe("item errors", () => {
  it("renders a failed chart cell's error even when no audience is shown", () => {
    const html = renderSingleItem({ spec: specWithDecisions, error: "Query timed out" }, { audiences: [] });
    const el = doc(html);
    expect(el.querySelector(".cell-error")?.textContent).toBe("Query timed out");
    expect(el.querySelector(".cell-notes")).toBeNull();
  });

  it("renders a failed KPI tile's error alongside its label", () => {
    const html = renderSingleItem({ type: "kpi", label: "Revenue", value: null, error: "No rows" }, { audiences: [] });
    const el = doc(html);
    expect(el.querySelector(".kpi-label")?.textContent).toBe("Revenue");
    expect(el.querySelector(".cell-error")?.textContent).toBe("No rows");
  });

  it("escapes an error string", () => {
    const html = renderSingleItem({ spec: specWithDecisions, error: "<img src=x onerror=1>" });
    expect(html).not.toContain("<img");
  });
});

describe("payload validation", () => {
  const chart = (extra: Record<string, unknown>): ChartSpec => ({ ...specWithDecisions, ...extra }) as ChartSpec;

  it("accepts well-formed decisions, including a kind it has never heard of", () => {
    expect(validatePayload(specWithDecisions)).toBeNull();
    expect(
      validatePayload(
        chart({ decisions: [{ kind: "org_specific_thing", audiences: ["viewer"], message: "hi", data: { n: 1 } }] }),
      ),
    ).toBeNull();
  });

  it("refuses a malformed decision", () => {
    expect(validatePayload(chart({ decisions: "nope" }))?.code).toBe("invalid-payload");
    expect(validatePayload(chart({ decisions: [{ audiences: ["viewer"], message: "no kind" }] }))?.code).toBe(
      "invalid-payload",
    );
    expect(validatePayload(chart({ decisions: [{ kind: "bar_cap", audiences: ["viewer"] }] }))?.code).toBe(
      "invalid-payload",
    );
    expect(validatePayload(chart({ decisions: [{ kind: "bar_cap", audiences: "viewer", message: "m" }] }))?.code).toBe(
      "invalid-payload",
    );
    expect(
      validatePayload(chart({ decisions: [{ kind: "bar_cap", audiences: ["everyone"], message: "m" }] }))?.code,
    ).toBe("invalid-payload");
  });

  it("caps the decision count like notes", () => {
    const many = Array.from({ length: 51 }, () => ({ kind: "bar_cap", audiences: ["viewer"], message: "m" }));
    expect(validatePayload(chart({ decisions: many }))?.code).toBe("payload-too-large");
  });

  it("refuses a non-string item error", () => {
    expect(validatePayload({ spec: specWithDecisions, error: 42 })?.code).toBe("invalid-payload");
    expect(validatePayload({ spec: specWithDecisions, error: "Query timed out" })).toBeNull();
  });
});
