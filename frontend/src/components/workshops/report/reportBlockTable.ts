// A report sheet's table or parameter block as a plain table, for the
// block's Copy (TSV) and Save CSV controls (fitting-workflow audit #6: the
// curve-fit report sheet's parameter/ANOVA tables must leave the app). Pure.
// Serialized by lib/statsTestsResults, whose text cells are
// formula-neutralized, so a file-derived label cannot run in a spreadsheet.

import type { ReportBlock } from "../../../lib/report";
import type { ResultTable } from "../../../lib/statsTestsResults";

/** The block as a table, or null for a block that is not tabular. */
export function reportBlockTable(block: ReportBlock): ResultTable | null {
  if (block.type === "table") return { title: block.caption, columns: [...block.columns], rows: block.rows.map((r) => [...r]) };
  if (block.type === "params") {
    const unit = block.params.some((p) => p.unit);
    return {
      title: block.caption,
      columns: ["Parameter", "Value", "Error", ...(unit ? ["Unit"] : [])],
      rows: block.params.map((p) => [p.name, p.value, p.error ?? null, ...(unit ? [p.unit ?? ""] : [])]),
    };
  }
  return null;
}
