// One collapsible section of the result book: a saved table or a saved
// figure. The header (title, size, actions) is always visible, so a section's
// actions work collapsed; the body renders only when expanded.

import type { AnalysisResultTable } from "../../../../lib/analysisResult";
import { fmtNum } from "../../../../lib/format";
import type { ResultBookSection as Section } from "../../../../lib/resultBook";
import type { StatisticalResultFigureDraft } from "../../../../lib/statisticalResultFigures";
import { Button } from "../../../primitives";
import { DataTable } from "../../../primitives/DataTable";
import { StatisticalFigureCard } from "../AnalysisResultFigures";

const PREVIEW_ROWS = 100;

export interface ResultBookSectionActions {
  disabled: boolean;
  /** Why Send to report is unavailable (the result is not current), or null. */
  reportBlocked: string | null;
  /** Why figure creation is unavailable, or undefined. */
  figureBlocked?: string;
  onCopy: (tableIndex: number) => void;
  onReport: (tableIndex: number) => void;
  onOpenTable: (tableIndex: number) => void;
  onCreateFigure: (draft: StatisticalResultFigureDraft) => void;
}

export default function ResultBookSection({ section, table, open, onToggle, actions }: {
  section: Section;
  table: AnalysisResultTable | undefined;
  open: boolean;
  onToggle: () => void;
  actions: ResultBookSectionActions;
}) {
  const bodyId = `result-book-${section.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return <section className="qz-result-book-section" data-kind={section.kind} aria-label={section.title}>
    <header>
      <h4>
        <button type="button" className="qz-result-book-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {section.title}
        </button>
      </h4>
      <span className="qz-result-book-meta">
        {section.kind === "table" ? `Table · ${section.rows} × ${section.cols}` : "Figure"}
      </span>
      <span className="qz-result-book-actions">
        {section.kind === "table" ? <>
          <Button size="sm" disabled={actions.disabled} aria-label={`Copy table: ${section.title}`}
            onClick={() => actions.onCopy(section.tableIndex)}>Copy table</Button>
          <Button size="sm" disabled={actions.disabled || actions.reportBlocked !== null}
            title={actions.reportBlocked ?? `Adds the “${section.title}” table to the report.`}
            aria-label={`Send to report: ${section.title}`}
            onClick={() => actions.onReport(section.tableIndex)}>Send to report</Button>
          <Button size="sm" disabled={actions.disabled} aria-label={`Open as worksheet: ${section.title}`}
            title="Creates an independent worksheet from this saved table and opens it."
            onClick={() => actions.onOpenTable(section.tableIndex)}>Open as worksheet</Button>
        </> : null}
      </span>
    </header>
    {open && <div id={bodyId} className="qz-result-book-body">
      {section.kind === "table"
        ? table ? <>
          <DataTable columns={table.columns} rows={table.rows.slice(0, PREVIEW_ROWS).map((row) =>
            row.map((cell) => typeof cell === "number" ? fmtNum(cell) : (cell ?? "—")))} />
          {table.rows.length > PREVIEW_ROWS && <p className="qz-analysis-caption">
            Showing {PREVIEW_ROWS} of {table.rows.length} rows. Copy and Open as worksheet use the complete table.
          </p>}
        </> : <p className="qz-analysis-empty">This saved table is unavailable.</p>
        : <StatisticalFigureCard draft={section.draft} disabled={actions.disabled || actions.figureBlocked !== undefined}
          disabledReason={actions.figureBlocked} onCreate={actions.onCreateFigure} />}
    </div>}
  </section>;
}
