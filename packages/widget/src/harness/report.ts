// "Copy for AI": everything an agent needs to act on "this chart looks wrong", in one paste.
//
// Markdown with fenced JSON rather than raw JSON, because the surrounding facts (which audience
// was showing, whether the data was synthetic, what the human actually saw) are the half a bare
// spec dump always loses. Long arrays are truncated so the paste stays readable, but every
// truncation is declared in the JSON itself, so nothing silently looks shorter than it is.
import type { DecisionAudience } from "@bonnard/mcp-charts";
import type { Example } from "./catalog.js";
import type { AudienceFilter, SynthState } from "./state.js";
import type { Payload } from "./pipeline.js";

export interface ReportContext {
  example: Example;
  payload: Payload;
  /** The input side: `{ data, opts }` for a fixture, absent for a hand-written spec. */
  input?: unknown;
  audience: AudienceFilter;
  activeAudiences: readonly DecisionAudience[];
  theme: "light" | "dark";
  synth: SynthState | null;
  edited: boolean;
  /** The human's own words about what looks wrong. */
  note?: string;
}

const KEEP_HEAD = 10;
const KEEP_TAIL = 10;
const TRUNCATE_OVER = KEEP_HEAD + KEEP_TAIL;

// Advisory arrays are the point of the paste, so they are never shortened however long they get.
const NEVER_TRUNCATE = new Set(["decisions", "notes"]);

interface TruncationNote {
  shown: number;
  total: number;
  note: string;
}

/**
 * Shorten long arrays to their head and tail, recording each cut in a `_truncated` key on the
 * object that held the array. The result is still valid JSON, and still says how much is missing.
 */
export function truncateArrays(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(truncateArrays);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  const cuts: Record<string, TruncationNote> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(raw) && raw.length > TRUNCATE_OVER && !NEVER_TRUNCATE.has(key)) {
      out[key] = [...raw.slice(0, KEEP_HEAD), ...raw.slice(-KEEP_TAIL)].map(truncateArrays);
      cuts[key] = {
        shown: KEEP_HEAD + KEEP_TAIL,
        total: raw.length,
        note: `first ${KEEP_HEAD} and last ${KEEP_TAIL} of ${raw.length}`,
      };
    } else {
      out[key] = truncateArrays(raw);
    }
  }
  if (Object.keys(cuts).length > 0) out._truncated = cuts;
  return out;
}

const fence = (value: unknown) => "```json\n" + JSON.stringify(value, null, 2) + "\n```";

function decisionTable(ctx: ReportContext): string {
  const decisions = ctx.example.decisions;
  if (decisions.length === 0) return "No decisions were reported for this render.";
  const rows = decisions.map((d) => {
    const shown = d.audiences.some((a) => ctx.activeAudiences.includes(a)) ? "yes" : "no";
    return `| \`${d.kind}\` | ${d.audiences.join(", ")} | ${shown} | ${d.message.replace(/\|/g, "\\|")} |`;
  });
  return ["| kind | audiences | shown here | message |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

export function buildAiReport(ctx: ReportContext): string {
  const { example } = ctx;
  const source = ctx.synth
    ? `synthetic (${ctx.synth.rows} rows, seed ${ctx.synth.seed})`
    : `the \`${example.name}\` fixture`;

  const facts = [
    `- package: \`@bonnard/mcp-charts-widget\` dev harness, rendering the real widget`,
    `- example: \`${example.name}\` (${example.kind}${example.chartType ? `, ${example.chartType}` : ""})`,
    `- rows: ${example.rowsIn} in -> ${example.rowsOut} rendered`,
    `- data source: ${source}`,
    `- audience filter: ${ctx.audience} (showing: ${ctx.activeAudiences.join(", ") || "none"})`,
    `- theme: ${ctx.theme}`,
    ctx.edited ? "- the JSON below was hand-edited in the harness, so it is not the fixture verbatim" : null,
  ].filter((line): line is string => line !== null);

  const sections = [
    `# Chart render review: ${example.name}`,
    "",
    ...(ctx.note ? [`**What looks wrong:** ${ctx.note}`, ""] : []),
    ...facts,
    "",
    "## Decisions reported",
    "",
    decisionTable(ctx),
    "",
  ];

  // Errors are hard failures, not advisories, so they are listed whatever the audience filter is.
  if (example.errors.length > 0) {
    sections.push("## Errors", "", ...example.errors.map((e) => `- ${e}`), "");
  }

  if (ctx.input !== undefined) {
    sections.push("## Input (data + resolve options)", "", fence(truncateArrays(ctx.input)), "");
  }
  sections.push("## Resolved spec (what the renderer was given)", "", fence(truncateArrays(ctx.payload)), "");

  return sections.join("\n");
}

/** The untruncated resolved spec, for pasting somewhere that will parse it. */
export function specJson(payload: Payload): string {
  return JSON.stringify(payload, null, 2);
}

/** Clipboard write with the execCommand fallback, since the harness is often opened over plain
 *  http where the async clipboard API is not available. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok: boolean;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
