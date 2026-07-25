// The embed caps are declared twice on purpose: core publishes them to consumers
// (packages/core/src/embed.ts), and the widget enforces them at runtime. The widget cannot import
// core at runtime without inverting the build order (core embeds the built widget), so this test is
// what keeps the two copies honest. Same posture as the isDashboardSpec/isChartSpec duplication.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMBED_LIMITS } from "../src/embed-protocol.js";
import { EMBED_PROTOCOL_VERSION } from "../src/embed.js";

const here = dirname(fileURLToPath(import.meta.url));
const coreEmbed = readFileSync(join(here, "..", "..", "core", "src", "embed.ts"), "utf8");

/** Pull a numeric literal out of core's source, so the test reads the published value directly. */
function coreValue(key: string): number {
  const m = new RegExp(String.raw`${key}:\s*([\d_]+)`).exec(coreEmbed);
  if (!m) throw new Error(`core embed.ts does not declare ${key}`);
  return Number(m[1]!.replace(/_/g, ""));
}

describe("EMBED_LIMITS parity between core and the widget", () => {
  it("declares the same keys in both copies", () => {
    const coreKeys = [...coreEmbed.matchAll(/^\s{2}(?:\/\*\*.*\*\/\s*)?(max[A-Za-z]+):/gm)].map((m) => m[1]!);
    expect(new Set(coreKeys)).toEqual(new Set(Object.keys(EMBED_LIMITS)));
  });

  for (const key of Object.keys(EMBED_LIMITS) as (keyof typeof EMBED_LIMITS)[]) {
    it(`${key} matches core`, () => {
      expect(EMBED_LIMITS[key]).toBe(coreValue(key));
    });
  }

  it("the protocol version matches core", () => {
    const m = /EMBED_PROTOCOL_VERSION = (\d+)/.exec(coreEmbed);
    expect(Number(m![1])).toBe(EMBED_PROTOCOL_VERSION);
  });

  it("the error codes match core", () => {
    const block = /BonnardErrorCode =([\s\S]*?);/.exec(coreEmbed)![1]!;
    const coreCodes = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
    // The widget's copy lives in embed-protocol.ts as a type, so compare against the source text.
    const widgetSrc = readFileSync(join(here, "..", "src", "embed-protocol.ts"), "utf8");
    const widgetBlock = /BonnardErrorCode =([\s\S]*?);/.exec(widgetSrc)![1]!;
    const widgetCodes = [...widgetBlock.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]!);
    expect(new Set(widgetCodes)).toEqual(new Set(coreCodes));
  });
});
