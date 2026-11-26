// The in-tool result book's buttons (lane RB3), named exactly like the saved
// book's so a result offers the same actions in the tool and in the Library:
// per table Copy table / Send to report / Open as worksheet, and the header's
// Open saved result.

import { Button } from "../../primitives";
import type { ContextMenuItem } from "../../overlays/ContextMenu";
import { tableMenuItems, type Say } from "./tableMenu";
import type { ToolResultBook } from "./useToolResultBook";

/** The right-click menu of one in-tool table (UX menus audit M10): the same
 *  actions as the buttons below, with the same reasons when withheld. */
export function toolTableMenu(book: ToolResultBook, title: string, say: Say): ContextMenuItem[] {
  const busy = book.busy ? "Another table action is running." : null;
  return tableMenuItems({
    title,
    copy: { run: () => book.copy(title), blocked: busy ?? book.copyBlocked(title) },
    report: { run: () => book.report(title), blocked: busy ?? book.reportBlocked(title) },
    open: { run: () => book.openTable(title), blocked: busy ?? book.openBlocked(title) },
    csvTable: () => book.copyTable(title),
    csvBlocked: book.copyBlocked(title),
  }, say);
}

/** Plots in a tool are live charts, not saved figures: a per-figure report
 *  handoff would create a hidden figure (owner question, fail closed,
 *  provisional). The note says where the visible path is. */
export const PLOT_REPORT_NOTE = "To add this plot to a report: Save result, Open saved result, then Create editable figure; its window has Send to report.";

export function ToolTableActions({ book, title }: { book: ToolResultBook; title: string }) {
  const reportBlocked = book.reportBlocked(title);
  const openBlocked = book.openBlocked(title);
  const copyBlocked = book.copyBlocked(title);
  return <>
    <Button size="sm" disabled={book.busy || copyBlocked !== null} aria-label={`Copy table: ${title}`}
      title={copyBlocked ?? (book.copySource(title) === "saved"
        ? "Copies the saved table (what Send to report and Open as worksheet use)."
        : "Copies the full live table (the result is not saved yet).")}
      onClick={() => book.copy(title)}>Copy table</Button>
    <Button size="sm" disabled={book.busy || reportBlocked !== null} aria-label={`Send to report: ${title}`}
      title={reportBlocked ?? `Adds the “${title}” table of the saved result to the report.`}
      onClick={() => book.report(title)}>Send to report</Button>
    <Button size="sm" disabled={book.busy || openBlocked !== null} aria-label={`Open as worksheet: ${title}`}
      title={openBlocked ?? "Creates an independent worksheet from the saved table and opens it."}
      onClick={() => book.openTable(title)}>Open as worksheet</Button>
    {/* The reason and the next step, visible (a title is hover-only). */}
    {(reportBlocked ?? openBlocked) && <span className="qz-result-book-note" role="note">{reportBlocked ?? openBlocked}</span>}
  </>;
}

export function OpenSavedResultButton({ book }: { book: ToolResultBook }) {
  return <Button size="sm" disabled={!book.saved}
    title={book.saved ? "Opens the saved result in the Library on its Result book tab." : "Save the result first."}
    onClick={book.openSaved}>Open saved result</Button>;
}
