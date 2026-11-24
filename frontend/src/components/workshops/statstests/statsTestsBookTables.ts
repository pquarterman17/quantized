// Statistical tests in-tool result book (lane RB4): a live result table's
// label and the saved table it became. Pure.

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { ResultTable, TestOutput } from "../../../lib/statsTestsResults";

/** One unique label per table: its title, or "Table N"; a repeated title gets " (2)". */
export function tableLabels(tables: readonly ResultTable[]): string[] {
  const seen = new Map<string, number>();
  return tables.map((table, index) => {
    const base = table.title || `Table ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

const signature = (table: { title?: string; columns: readonly string[] }) => JSON.stringify([table.title ?? "", table.columns]);

/** The saved table a live table became: the same title and columns, the same
 *  occurrence (the save may omit or shorten tables, never reorder them). */
export function savedTableIndex(output: TestOutput, labels: readonly string[], label: string, saved: AnalysisResult): number {
  const index = labels.indexOf(label);
  if (index < 0) return -1;
  const sig = signature(output.tables[index]);
  const occurrence = output.tables.slice(0, index).filter((table) => signature(table) === sig).length;
  let seen = 0;
  return (saved.tables ?? []).findIndex((table) => signature(table) === sig && seen++ === occurrence);
}
