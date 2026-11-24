// The result-table right-click menu (UX menus audit M10): the actions that
// were only header buttons (Copy table, Send to report, Open as worksheet), plus
// Copy as CSV and Export CSV…. One item builder for the in-tool book and the
// saved book, so both menus read the same. Every disabled item carries its
// reason (audit N1). Not offered, on purpose: saving the result on the user's
// behalf ("Open as worksheet" without a prior Save result): fail closed
// (provisional, owner to confirm); a LaTeX copy waits for a table-to-LaTeX
// serializer (provisional, owner to confirm).

import type { AnalysisResultTable } from "../../../lib/analysisResult";
import { copyText } from "../../../lib/clipboard";
import { saveBlob } from "../../../lib/download";
import { tablesToCSV } from "../../../lib/statsTestsResults";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

/** One table's actions, each with the reason it is unavailable (or null). */
export interface TableMenuSpec {
  title: string;
  copy: { run: () => void; blocked: string | null };
  report: { run: () => void; blocked: string | null };
  open: { run: () => void; blocked: string | null };
  /** The table the CSV items serialize (null: not available yet). */
  csvTable: () => AnalysisResultTable | null;
  csvBlocked: string | null;
}

const fileStem = (title: string): string => title.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "table";

/** The status-line writer the menu reports through (the app's `setStatus`). */
export type Say = (message: string) => void;

export async function copyTableCsv(table: AnalysisResultTable, say: Say): Promise<void> {
  const ok = await copyText(tablesToCSV([table]));
  say(ok ? `copied ${table.title ?? "table"} as CSV` : "clipboard unavailable: use Export CSV instead");
}

export function exportTableCsv(table: AnalysisResultTable, title: string, say: Say): void {
  saveBlob(new Blob([tablesToCSV([table])], { type: "text/csv;charset=utf-8" }), `${fileStem(title)}.csv`);
  say(`exported ${title} as CSV`);
}

export function tableMenuItems(spec: TableMenuSpec, say: Say): ContextMenuItem[] {
  const table = spec.csvBlocked ? null : spec.csvTable();
  const csvReason = spec.csvBlocked ?? (table ? undefined : "This table is not available yet.");
  return [
    { header: spec.title },
    { label: "Copy table", run: spec.copy.run, disabled: spec.copy.blocked !== null, title: spec.copy.blocked ?? undefined },
    { label: "Copy as CSV", run: () => table && void copyTableCsv(table, say), disabled: !!csvReason, title: csvReason },
    { label: "Export CSV…", run: () => table && exportTableCsv(table, spec.title, say), disabled: !!csvReason, title: csvReason },
    { separator: true },
    { label: "Send to report", run: spec.report.run, disabled: spec.report.blocked !== null, title: spec.report.blocked ?? undefined },
    { label: "Open as worksheet", run: spec.open.run, disabled: spec.open.blocked !== null, title: spec.open.blocked ?? undefined },
  ];
}
