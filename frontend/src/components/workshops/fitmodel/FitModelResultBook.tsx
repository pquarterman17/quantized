// The Fit Model result as a result book (lane RB3 shell): the same header and
// table actions as the saved book. Sections in the book's one order: the
// summary of fit, the tables in saved order (Analysis of variance, Effect
// tests, Parameter estimates, one Least squares means table per nominal
// effect, Predicted and residuals collapsed), then the two diagnostic plots.

import { Button } from "../../primitives";
import { useProfilerStore } from "../../../store/profiler";
import BookTable, { LIVE_REST } from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, PLOT_REPORT_NOTE, ToolTableActions } from "../resultbook/ToolBookActions";
import { FIT_MODEL_METHOD, FIT_MODEL_TABLES, lsMeansTitle } from "../../../lib/fitModelAnalysisResult";
import { fmtNum } from "../../../lib/format";
import FitModelPlot from "./FitModelPlots";
import type { FitModelState } from "./useFitModel";

export default function FitModelResultBook({ m }: { m: FitModelState }) {
  const { fit, book } = m;
  if (!fit) return null;
  const responseLabel = m.labelOf(m.responseCol);
  const table = (title: string, startCollapsed = false): ResultBookSectionSpec => ({
    key: `table:${title}`, kind: "table", title, startCollapsed,
    actions: <ToolTableActions book={book} title={title} />,
    render: () => {
      const found = book.liveTable(title);
      return found ? <BookTable table={found} restNote={LIVE_REST} /> : null;
    },
  });
  const whole = fit.anova[0];
  const sections: ResultBookSectionSpec[] = [
    { key: "summary", kind: "summary", title: "Summary", render: () => (
      <p className="qzk-ds-meta">
        RSquare {fmtNum(fit.summary.r2)} · RSquare Adj {fmtNum(fit.summary.adj_r2)} · RMSE {fmtNum(fit.summary.rmse)} ·
        N {fit.n} · whole model F {fmtNum(whole?.f)}, Prob &gt; F {fmtNum(whole?.p)}
      </p>
    ) },
    table(FIT_MODEL_TABLES.summary, true),
    table(FIT_MODEL_TABLES.anova),
    table(FIT_MODEL_TABLES.effects),
    table(FIT_MODEL_TABLES.estimates),
    ...fit.ls_means.map((ls) => table(lsMeansTitle(ls.effect))),
    table(FIT_MODEL_TABLES.residuals, true),
    ...(["actual", "residual"] as const).map((kind): ResultBookSectionSpec => ({
      key: `plot:${kind}`, kind: "figure", meta: "Plot",
      title: kind === "actual" ? "Actual by predicted" : "Residual by predicted",
      render: () => <>
        <FitModelPlot kind={kind} predicted={fit.predicted} residual={fit.residual} responseLabel={responseLabel} />
        <p className="qz-result-book-note">{PLOT_REPORT_NOTE}</p>
      </>,
    })),
  ];
  const warnings = fit.n_dropped_missing > 0
    ? [`${fit.n_dropped_missing} row(s) with a missing response or factor value were left out of the fit.`] : [];
  return (
    <ResultBookShell method={FIT_MODEL_METHOD} status={book.saved ? "Saved" : "Not saved"} initialOpen="all"
      meta={`${responseLabel} by ${m.termLabels.join(", ")}`}
      settings={[{ label: "Center polynomials", value: fit.center_polynomials ? "yes" : "no" }]}
      warnings={warnings}
      tools={<>
        <Button size="sm" disabled={!m.canSaveResult} title={m.saveResultDisabledReason ?? undefined} onClick={m.saveResult}>
          Save result
        </Button>
        <Button size="sm" title="Explore this fitted model: prediction and contour profilers"
          onClick={() => useProfilerStore.getState().openWith({ model: fit.model, label: responseLabel })}>
          Profiler
        </Button>
        <OpenSavedResultButton book={book} />
      </>}
      sections={sections} />
  );
}
