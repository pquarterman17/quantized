// The in-tool result book's buttons (lane RB3), named exactly like the saved
// book's so a result offers the same actions in the tool and in the Library:
// per table Copy table / Send to report / Open as worksheet, and the header's
// Open saved result.

import { Button } from "../../primitives";
import type { ToolResultBook } from "./useToolResultBook";

/** Plots in a tool are live charts, not saved figures: a per-figure report
 *  handoff would create a hidden figure (owner question, fail closed,
 *  provisional). The note says where the visible path is. */
export const PLOT_REPORT_NOTE = "To add this plot to a report: Save result, Open saved result, then Create editable figure; its window has Send to report.";

export function ToolTableActions({ book, title }: { book: ToolResultBook; title: string }) {
  const reportBlocked = book.reportBlocked(title);
  const openBlocked = book.openBlocked(title);
  return <>
    <Button size="sm" disabled={book.busy || !book.hasLiveTable(title)} aria-label={`Copy table: ${title}`}
      onClick={() => book.copy(title)}>Copy table</Button>
    <Button size="sm" disabled={book.busy || reportBlocked !== null} aria-label={`Send to report: ${title}`}
      title={reportBlocked ?? `Adds the “${title}” table of the saved result to the report.`}
      onClick={() => book.report(title)}>Send to report</Button>
    <Button size="sm" disabled={book.busy || openBlocked !== null} aria-label={`Open as worksheet: ${title}`}
      title={openBlocked ?? "Creates an independent worksheet from the saved table and opens it."}
      onClick={() => book.openTable(title)}>Open as worksheet</Button>
  </>;
}

export function OpenSavedResultButton({ book }: { book: ToolResultBook }) {
  return <Button size="sm" disabled={!book.saved}
    title={book.saved ? "Opens the saved result in the Library on its Result book tab." : "Save the result first."}
    onClick={book.openSaved}>Open saved result</Button>;
}
