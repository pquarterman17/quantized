// The Standard curve results as a table for the clipboard (pure): one row per
// unknown, in the order typed. Serialized by lib/statsTestsResults (formula-neutralized).

import type { StandardCurveResult } from "../../../lib/api/standardCurve";
import { tablesToCSV, tablesToTSV, type Cell } from "../../../lib/statsTestsResults";

/** Unknown responses typed as numbers separated by commas, semicolons, spaces or new lines.
 *  Returns the numbers, or the first token that is not one. */
export function parseResponses(text: string): { values: number[] } | { bad: string } {
  const tokens = text.split(/[\s,;]+/).filter((t) => t !== "");
  const values: number[] = [];
  for (const t of tokens) {
    const v = Number(t);
    if (!Number.isFinite(v)) return { bad: t };
    values.push(v);
  }
  return { values };
}

export function standardCurveTable(r: StandardCurveResult, format: "tsv" | "csv"): string {
  const pct = `${Math.round(r.confidence * 100)}%`;
  const rows: Cell[][] = r.unknowns.map((u) => [
    u.y, u.x, u.lower, u.upper, u.status === "ok" ? "" : [u.status, u.reason].filter(Boolean).join(": "),
  ]);
  const table = {
    title: `Standard curve (${r.model}, n = ${r.n})`,
    columns: ["Response", "Concentration", `Lower ${pct}`, `Upper ${pct}`, "Note"],
    rows,
  };
  return format === "tsv" ? tablesToTSV([table]) : tablesToCSV([table]);
}
