// The Fit Y by X result as a result book (lane RB4): the same shell and
// actions as the saved book. The first section is the leg's own view (its
// plot and test readouts: oneway, bivariate or contingency; in By mode the
// per-level sections), unchanged; then every table the result SAVES, in saved
// order, each with Copy table / Send to report / Open as worksheet. Those
// tables are new in the tool, so they start collapsed (provisional, owner to
// confirm). Plots stay inside the view section, with the shared note on where
// a figure's Send to report is (no hidden figure).

import { Button } from "../../primitives";
import BookTable, { LIVE_REST } from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, PLOT_REPORT_NOTE, ToolTableActions } from "../resultbook/ToolBookActions";
import BivariateView from "./BivariateView";
import ContingencyView from "./ContingencyView";
import FitYByXLevelSection from "./FitYByXLevelSection";
import OnewayView from "./OnewayView";
import type { FitYByXState } from "./useFitYByX";

const VIEW_TITLE: Readonly<Record<string, string>> = {
  oneway: "Group comparison", bivariate: "Regression fit", contingency: "Association", unsupported: "Analysis",
};

export default function FitYByXResultBook({ f }: { f: FitYByXState }) {
  const { book } = f;
  const byActive = f.byLevels.length > 0;
  const hasResults = byActive ? f.byResults.length > 0 : !!(f.oneway || f.bivariate || f.contingency);
  const viewReady = !f.busy && !f.error;
  const view = !byActive && viewReady ? (
    f.kind === "oneway" && f.oneway ? <OnewayView result={f.oneway} />
      : f.kind === "bivariate" && f.bivariate
        ? <BivariateView result={f.bivariate} bandInterval={f.bandInterval} onBandIntervalChange={f.setBandInterval} />
        : f.kind === "contingency" && f.contingency ? <ContingencyView result={f.contingency} /> : null
  ) : null;
  const sections: ResultBookSectionSpec[] = [];
  if (byActive) sections.push({
    key: "levels", kind: "summary", title: `Levels of ${f.byOptions.find((c) => c.index === f.byCol)?.label ?? "By"}`,
    meta: `${f.byResults.length} of ${f.byTotalLevels}`,
    render: () => <>
      {f.byTotalLevels > f.byLevels.length && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          By column has {f.byTotalLevels} levels — showing the first {f.byLevels.length}
        </div>
      )}
      {f.byBusy && f.byResults.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>analyzing {f.byLevels.length} levels…</div>
      ) : f.byResults.map((r) => (
        <FitYByXLevelSection key={r.label} result={r} kind={f.kind} bandInterval={f.bandInterval}
          onBandIntervalChange={f.setBandInterval} />
      ))}
      <p className="qz-result-book-note">{PLOT_REPORT_NOTE}</p>
    </>,
  });
  else if (view) sections.push({
    key: "view", kind: "summary", title: VIEW_TITLE[f.kind], meta: "Plot and tests",
    render: () => <>{view}<p className="qz-result-book-note">{PLOT_REPORT_NOTE}</p></>,
  });
  for (const table of book.liveTables() ?? []) {
    const title = table.title ?? "";
    sections.push({
      key: `table:${title}`, kind: "table", title, meta: `Table · ${table.rows.length} × ${table.columns.length}`,
      startCollapsed: true, actions: <ToolTableActions book={book} title={title} />,
      render: () => <BookTable table={table} restNote={LIVE_REST} />,
    });
  }
  return <ResultBookShell initialOpen="all" status={book.saved ? "Saved" : "Not saved"}
    method={`Fit Y by X: ${f.yLabel} by ${f.xLabel}`}
    tools={<>
      <Button size="sm" disabled={!f.canSaveResult} onClick={() => f.saveResult()}>Save result</Button>
      <Button size="sm" disabled={f.reportBusy || !hasResults} title={hasResults ? undefined : "Wait for the analysis to finish."}
        onClick={() => void f.toReport()}>
        {f.reportBusy ? "Reporting…" : "→ Report"}
      </Button>
      <OpenSavedResultButton book={book} />
    </>}
    sections={sections} empty={<p className="qz-analysis-empty">No result yet.</p>} />;
}
