// The harness catalog is the gallery's index, and this is the test that keeps it honest.
//
// The gap it closes: before the gallery existed, 14 of the 19 decision kinds had no example
// anywhere, so a change to one of their messages, audiences or thresholds could not be looked at.
// Adding a kind without a fixture now fails here rather than quietly shipping an unreachable case.
import { describe, it, expect } from "vitest";
import { DECISION_KINDS, audiencesFor } from "../../core/src/resolve/decisions.js";
import { examples } from "../src/harness/catalog.js";
import { fixtures } from "./fixtures.js";

describe("harness catalog coverage", () => {
  it("every decision kind has at least one example that declares it", () => {
    const declared = new Set(examples.flatMap((e) => e.demonstrates));
    const missing = DECISION_KINDS.filter((kind) => !declared.has(kind));
    expect(missing, "kinds with no worked example in the harness gallery").toEqual([]);
  });

  it("every declared demonstrates kind is actually reported by that example's render", () => {
    for (const example of examples) {
      const reported = new Set(example.decisions.map((d) => String(d.kind)));
      for (const kind of example.demonstrates) {
        expect([...reported], `${example.name} declares ${kind}`).toContain(kind);
      }
    }
  });

  it("a fixture's declared decisions carry the audiences core assigns to their kind", () => {
    // Hand-authored decisions on a fixture (a truncated result, a consumer note) must not drift
    // from the audience map, or the harness would demo a filter that does not exist.
    for (const fixture of fixtures) {
      for (const decision of fixture.data.decisions ?? []) {
        expect(decision.audiences, `${fixture.name}: ${decision.kind}`).toEqual(
          audiencesFor(decision.kind as (typeof DECISION_KINDS)[number]),
        );
      }
    }
  });

  it("groups every example under a category and gives each a unique id", () => {
    const ids = examples.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const example of examples) expect(example.category, example.name).toBeTruthy();
  });

  it("stays DOM-free, so it can be imported outside a browser", () => {
    // The import above already proves it: this suite runs with no DOM, and a stray `document`
    // reference in the catalog (or anything it pulls in) would have thrown at module load.
    expect(typeof globalThis.document).toBe("undefined");
    expect(examples.length).toBeGreaterThan(30);
  });
});
