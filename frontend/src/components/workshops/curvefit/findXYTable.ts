// Find X/Y query history as a table for the clipboard (pure). One row per
// crossing so a "X at Y" query with two crossings pastes as two rows a
// spreadsheet can use directly; a query with no crossing keeps one row with
// an empty result. Serialized by lib/statsTestsResults (formula-neutralized).

import { tablesToCSV, tablesToTSV, type Cell } from "../../../lib/statsTestsResults";
import type { FindXYEntry } from "./useFindXY";

export function findXYTable(history: readonly FindXYEntry[], format: "tsv" | "csv"): string {
  const rows: Cell[][] = [];
  // Oldest first: the order the queries were asked.
  for (const e of [...history].reverse()) {
    const label = e.find === "y" ? "Y at X" : "X at Y";
    if (e.results.length === 0) rows.push([label, e.input, null]);
    for (const r of e.results) rows.push([label, e.input, r]);
  }
  const table = { title: "Find X/Y", columns: ["Find", "Input", "Result"], rows };
  return format === "tsv" ? tablesToTSV([table]) : tablesToCSV([table]);
}
