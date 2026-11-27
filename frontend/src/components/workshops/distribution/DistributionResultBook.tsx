// The Distribution result as a result book (lane RB3): the same shell and
// actions as the saved book. Sections follow the saved table order: Summary
// (stats, normality, the fit line), Histogram (the histogram + box strip plot;
// its table actions act on the saved "Histogram" bin table), Distribution fits
// (Compare on), Percentiles (a fit selected). The fit status line (fitting /
// error / skipped / AIC) stays above the book under the fit picker, so a
// collapsed Summary never hides a fit error. By mode: Summary by <column>
// and each level's "Histogram · <level>" bin table (new in the tool, start
// collapsed; lane RB4), then the per-level sections as before.
// The fit picker and Compare switch stay above the book (they are settings).

import type { DistFamily } from "../../../lib/distpdf";
import { fmtNum } from "../../../lib/format";
import { NumberField } from "../../primitives/NumberField";
import { Button, StatusDot } from "../../primitives";
import BookTable, { LIVE_REST } from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, PLOT_REPORT_NOTE, ToolTableActions } from "../resultbook/ToolBookActions";
import BoxStrip from "./BoxStrip";
import CompareDistributionsTable from "./CompareDistributionsTable";
import DistributionCiSection from "./DistributionCiSection";
import DistributionLevelSection from "./DistributionLevelSection";
import HistogramStrip from "./HistogramStrip";
import type { DistributionState } from "./useDistribution";

const STAT_FIELDS: { key: string; label: string }[] = [
  { key: "N", label: "N" }, { key: "mean", label: "mean" }, { key: "median", label: "median" },
  { key: "std", label: "std" }, { key: "min", label: "min" }, { key: "max", label: "max" },
];

const grid = (columns: number) => ({
  display: "grid", gridTemplateColumns: Array(columns).fill("auto").join(" "), gap: "4px 12px", fontVariantNumeric: "tabular-nums",
});

export default function DistributionResultBook({ d }: { d: DistributionState }) {
  const { book } = d;
  const byActive = d.byLevels.length > 0;
  // As before the book: no report until there is something to report.
  const hasResults = byActive ? d.byResults.length > 0 : !!d.desc;
  const liveTitle = (prefix: string) => book.liveTables()?.find((table) => table.title?.startsWith(prefix))?.title ?? prefix;
  const sections: ResultBookSectionSpec[] = byActive ? byLevelSections(d, liveTitle) : wholeColumnSections(d, liveTitle);
  return <ResultBookShell initialOpen="all" status={book.saved ? "Saved" : "Not saved"}
    method={byActive ? `Distribution: ${d.label} by ${d.byOptions.find((c) => c.index === d.byCol)?.label ?? "level"}` : `Distribution: ${d.label}`}
    tools={<>
      <Button size="sm" disabled={!d.canSaveResult} onClick={() => d.saveResult()}>Save result</Button>
      <Button size="sm" disabled={d.reportBusy || !hasResults} title={hasResults ? undefined : "Wait for the analysis to finish."}
        onClick={() => void d.toReport()}>
        {d.reportBusy ? "Reporting…" : "→ Report"}
      </Button>
      <OpenSavedResultButton book={book} />
    </>}
    sections={sections} />;
}

function byLevelSections(d: DistributionState, liveTitle: (prefix: string) => string): ResultBookSectionSpec[] {
  const summaryTitle = liveTitle("Summary by");
  const summary = d.book.liveTables()?.find((table) => table.title === summaryTitle);
  return [
    ...(summary ? [{ key: "table:summary-by", kind: "table" as const, title: summaryTitle, startCollapsed: true,
      actions: <ToolTableActions book={d.book} title={summaryTitle} />, render: () => <BookTable table={summary} restNote={LIVE_REST} /> }] : []),
    // Each level's histogram bin table, as the save writes it (lane RB4).
    ...(d.book.liveTables() ?? []).filter((table) => table.title?.startsWith("Histogram · ")).map((table): ResultBookSectionSpec => ({
      key: `table:${table.title}`, kind: "table", title: table.title!, startCollapsed: true,
      meta: `Table · ${table.rows.length} × ${table.columns.length}`,
      actions: <ToolTableActions book={d.book} title={table.title!} />, render: () => <BookTable table={table} restNote={LIVE_REST} />,
    })),
    { key: "levels", kind: "summary", title: "Levels", meta: `${d.byResults.length} of ${d.byTotalLevels}`, render: () => <>
      {d.byTotalLevels > d.byLevels.length && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          By column has {d.byTotalLevels} levels — showing the first {d.byLevels.length}
        </div>
      )}
      {d.byBusy && d.byResults.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>analyzing {d.byLevels.length} levels…</div>
      ) : (
        d.byResults.map((r) => <DistributionLevelSection key={r.label} result={r} />)
      )}
    </> },
  ];
}

function wholeColumnSections(d: DistributionState, liveTitle: (prefix: string) => string): ResultBookSectionSpec[] {
  const isNormal = d.norm ? d.norm.p >= 0.05 : null;
  const fitsTitle = liveTitle("Distribution fits");
  const sections: ResultBookSectionSpec[] = [{
    key: "table:Summary", kind: "summary", title: "Summary", actions: <ToolTableActions book={d.book} title="Summary" />,
    render: () => <>
      <div className="qzk-ds-meta" style={grid(4)}>
        {STAT_FIELDS.map((f) => (
          <span key={f.key}><span style={{ color: "var(--text-faint)" }}>{f.label} </span>{fmtNum(d.desc?.[f.key])}</span>
        ))}
      </div>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
        {d.norm ? (
          <StatusDot tone={isNormal ? "ok" : "warn"} label={<span>
            {isNormal ? "Consistent with normal" : "Not normal"} · Shapiro–Wilk W={fmtNum(d.norm.W)}, p={fmtNum(d.norm.p)}
          </span>} />
        ) : (
          <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>Normality: {d.normNote ?? "—"}</span>
        )}
      </div>
    </>,
  }];
  if (d.hist || d.desc) sections.push({
    key: "plot:histogram", kind: "figure", title: "Histogram", meta: "Plot",
    ...(d.hist ? { actions: <ToolTableActions book={d.book} title="Histogram" /> } : {}),
    render: () => <>
      {d.hist && <HistogramStrip hist={d.hist} fitCurve={d.fitCurve} brushedBins={d.brushedBins} onBrush={d.brushBins} />}
      {d.desc && <BoxStrip min={Number(d.desc.min)} q1={Number(d.desc.q1)} median={Number(d.desc.median)}
        q3={Number(d.desc.q3)} max={Number(d.desc.max)} />}
      <p className="qz-result-book-note">{PLOT_REPORT_NOTE}</p>
    </>,
  });
  if (d.desc && d.inputs.ok) {
    sections.push({
      key: "ci:intervals", kind: "table", title: "Confidence intervals", meta: "Live",
      render: () => <DistributionCiSection ci={d.ci} label={d.label} />,
    });
  }
  if (d.compareOpen) sections.push({
    key: "table:fits", kind: "table", title: "Distribution fits", actions: <ToolTableActions book={d.book} title={fitsTitle} />,
    render: () => d.fitBusy && d.rankedFits.length === 0 ? <div className="qzk-ds-meta">fitting all families…</div>
      : d.fitError ? <div className="qzk-ds-meta">{d.fitError}</div>
      : <CompareDistributionsTable rankedFits={d.rankedFits} rankingMetric={d.rankingMetric} winnerDist={d.winnerDist}
        selected={d.fitDist} onSelect={(dist: DistFamily) => d.setFitDist(dist)} skipped={d.fits?.skipped ?? []} />,
  });
  const fit = d.currentFit;
  if (fit) sections.push({
    key: "table:quantiles", kind: "table", title: `Percentiles (${fit.dist} fit)`,
    actions: <ToolTableActions book={d.book} title="Fitted quantiles" />,
    render: () => <>
      {d.quantiles && (d.quantiles.q1 == null || d.quantiles.median == null || d.quantiles.q3 == null) ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          {fit.dist} has no closed-form quantile function — residual (needs a numeric inverse-incomplete-gamma).
        </div>
      ) : d.quantiles && (
        <div className="qzk-ds-meta" style={grid(3)}>
          <span><span style={{ color: "var(--text-faint)" }}>q1 </span>{fmtNum(d.quantiles.q1)}</span>
          <span><span style={{ color: "var(--text-faint)" }}>median </span>{fmtNum(d.quantiles.median)}</span>
          <span><span style={{ color: "var(--text-faint)" }}>q3 </span>{fmtNum(d.quantiles.q3)}</span>
        </div>
      )}
      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <NumberField value={d.percentileInput} onChange={(v) => d.setPercentileInput(Number(v))} unit="%ile" width={56} />
        <span className="qzk-ds-meta">{d.percentileValue == null ? "—" : fmtNum(d.percentileValue)}</span>
      </div>
    </>,
  });
  return sections;
}
