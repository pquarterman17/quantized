// The saved book's section specs (lane RB; on the shared shell since RB3): a
// saved table or a saved figure draft as a ResultBookSectionSpec. Every action
// sits in the section header, so it works collapsed.

import type { AnalysisResultTable } from "../../../../lib/analysisResult";
import type { ResultBookSection as Section } from "../../../../lib/resultBook";
import type { StatisticalResultFigureDraft } from "../../../../lib/statisticalResultFigures";
import { Button } from "../../../primitives";
import BookTable from "../../resultbook/BookTable";
import { tableMenuItems } from "../../resultbook/tableMenu";
import { StatisticalFigureCard } from "../AnalysisResultFigures";
import type { ResultBookSectionSpec } from "../../resultbook/ResultBookShell";

/** Per-figure "Send to report" would create a hidden figure first (owner
 *  question, RB3): fail closed, provisional, owner to confirm. The book offers
 *  only the visible path and says where Send to report is. */
export const FIGURE_REPORT_NOTE = "To add this figure to a report, create the editable figure; its window has Send to report.";

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

export function savedBookSection(
  section: Section, table: AnalysisResultTable | undefined, actions: ResultBookSectionActions,
): ResultBookSectionSpec {
  if (section.kind === "figure") {
    return {
      key: section.key, kind: "figure", title: section.title, meta: "Figure",
      actions: <Button size="sm" variant="primary" disabled={actions.disabled || actions.figureBlocked !== undefined}
        title={actions.figureBlocked} aria-label={`Create editable figure: ${section.title}`}
        onClick={() => actions.onCreateFigure(section.draft)}>Create editable figure</Button>,
      render: () => <>
        <StatisticalFigureCard draft={section.draft} disabled previewOnly onCreate={actions.onCreateFigure} />
        <p className="qz-analysis-caption">{FIGURE_REPORT_NOTE}</p>
      </>,
    };
  }
  return {
    key: section.key, kind: "table", title: section.title, meta: `Table · ${section.rows} × ${section.cols}`,
    actions: <>
      <Button size="sm" disabled={actions.disabled} aria-label={`Copy table: ${section.title}`}
        onClick={() => actions.onCopy(section.tableIndex)}>Copy table</Button>
      <Button size="sm" disabled={actions.disabled || actions.reportBlocked !== null}
        title={actions.reportBlocked ?? `Adds the “${section.title}” table to the report.`}
        aria-label={`Send to report: ${section.title}`}
        onClick={() => actions.onReport(section.tableIndex)}>Send to report</Button>
      <Button size="sm" disabled={actions.disabled || section.freezeBlocked !== null} aria-label={`Open as worksheet: ${section.title}`}
        title={section.freezeBlocked ? `Can't open as a worksheet: ${section.freezeBlocked}.` : "Creates an independent worksheet from this saved table and opens it."}
        onClick={() => actions.onOpenTable(section.tableIndex)}>Open as worksheet</Button>
    </>,
    menu: (say) => {
      const busy = actions.disabled ? "Another action is running." : null;
      return tableMenuItems({
        title: section.title,
        copy: { run: () => actions.onCopy(section.tableIndex), blocked: busy },
        report: { run: () => actions.onReport(section.tableIndex), blocked: busy ?? actions.reportBlocked },
        open: { run: () => actions.onOpenTable(section.tableIndex), blocked: busy ?? (section.freezeBlocked ? `Can't open as a worksheet: ${section.freezeBlocked}.` : null) },
        csvTable: () => table ?? null,
        csvBlocked: table ? null : "This saved table is unavailable.",
      }, say);
    },
    render: () => table ? <BookTable table={table} /> : <p className="qz-analysis-empty">This saved table is unavailable.</p>,
  };
}
