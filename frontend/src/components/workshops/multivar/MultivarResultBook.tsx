// The Multivariate result as a result book (lane RB4): the same shell and
// actions as the saved book. The first section is the existing tabbed view
// (Correlation / SPLOM / PCA, with their own exports), unchanged; then every
// table the result SAVES, in saved order, each with Copy table / Send to
// report / Open as worksheet. They are new in the tool, so they start
// collapsed (provisional, owner to confirm), and only the table whose section
// opens or that is copied is built (PCA scores can be large).

import type { ReactNode } from "react";

import { Button } from "../../primitives";
import BookTable, { LIVE_REST } from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, PLOT_REPORT_NOTE, ToolTableActions } from "../resultbook/ToolBookActions";
import type { MultivarState } from "./useMultivar";

export default function MultivarResultBook({ m, view }: { m: MultivarState; view: ReactNode }) {
  const { book } = m;
  const sections: ResultBookSectionSpec[] = [
    { key: "view", kind: "summary", title: "Correlation, SPLOM and PCA", meta: "Plots and tables",
      render: () => <>{view}<p className="qz-result-book-note">{PLOT_REPORT_NOTE}</p></> },
    ...(m.tableShapes ?? []).map((shape): ResultBookSectionSpec => ({
      key: `table:${shape.title}`, kind: "table", title: shape.title, meta: `Table · ${shape.rows} × ${shape.cols}`,
      startCollapsed: true, actions: <ToolTableActions book={book} title={shape.title} />,
      render: () => {
        const table = book.liveTable(shape.title);
        return table ? <BookTable table={table} restNote={LIVE_REST} /> : null;
      },
    })),
  ];
  return <ResultBookShell initialOpen="all" status={book.saved ? "Saved" : "Not saved"}
    method={`Multivariate: ${m.method === "pearson" ? "Pearson" : "Spearman"} correlation and PCA`}
    tools={<>
      <Button size="sm" disabled={!m.canSaveResult} title={m.saveResultDisabledReason ?? undefined} onClick={m.saveResult}>
        Save result
      </Button>
      <OpenSavedResultButton book={book} />
    </>}
    sections={sections} />;
}
