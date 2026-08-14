// Which of a spec's decisions this surface captions. A rendered chart shows `viewer` decisions by
// default: an author's config mistake and an agent's data-trust signal are real, but they are not
// footnotes for whoever is looking at a published dashboard.
import type { Decision, DecisionAudience } from "@bonnard/mcp-charts";

export const ALL_AUDIENCES: readonly DecisionAudience[] = ["viewer", "author", "agent"];

export const isAudience = (v: unknown): v is DecisionAudience =>
  typeof v === "string" && (ALL_AUDIENCES as readonly string[]).includes(v);

/** The caption lines for a spec. A spec with no `decisions` is older than this contract, so its
 *  flat `notes` are shown whole rather than dropped. */
export function captionsFor(
  source: { notes?: string[]; decisions?: Decision[] },
  audiences: readonly DecisionAudience[],
): string[] {
  if (!audiences.length) return [];
  if (!source.decisions?.length) return source.notes ?? [];
  return source.decisions.filter((d) => d.audiences?.some((a) => audiences.includes(a))).map((d) => d.message);
}
