// The Time series result as a result book (owner decision 2026-11-25, the
// RB3 shell): the same header and table actions as the saved book. Sections in
// the book's one order: the summary (the tool's readout), the tables in saved
// order (collapsed: the summary already shows the key numbers), then the plots.

import SmallUPlot from "../SmallUPlot";
import { Button } from "../../primitives";
import BookTable, { LIVE_REST } from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, PLOT_REPORT_NOTE, ToolTableActions } from "../resultbook/ToolBookActions";
import { TS_TOOL_LABEL } from "../../../lib/timeSeriesAnalysisResult";
import { Summary } from "./TsResults";
import type { TimeSeriesState } from "./useTimeSeries";

const warn = { color: "var(--warn, var(--text-faint))" } as const;

export default function TsResultBook({ t }: { t: TimeSeriesState }) {
  const { result, book } = t;
  if (!result) return null;
  const titles = book.liveTables()?.map((table) => table.title ?? "") ?? [];
  const sections: ResultBookSectionSpec[] = [
    { key: "summary", kind: "summary", title: "Summary", render: () => <>
      {result.data.irregular && <div className="qzk-ds-meta" style={warn}>X is unevenly spaced: points were treated as equally spaced, so results are approximate.</div>}
      <Summary r={result} />
    </> },
    ...titles.map((title): ResultBookSectionSpec => ({
      key: `table:${title}`, kind: "table", title, startCollapsed: true,
      actions: <ToolTableActions book={book} title={title} />,
      render: () => {
        const found = book.liveTable(title);
        return found ? <BookTable table={found} restNote={LIVE_REST} /> : null;
      },
    })),
    ...t.figures.map((f): ResultBookSectionSpec => ({
      key: `plot:${f.key}`, kind: "figure", meta: "Plot", title: f.title, render: () => <>
        <SmallUPlot payload={f.payload} label={f.title} height={170} refLines={f.refLines} compact />
        <p className="qz-result-book-note">{PLOT_REPORT_NOTE}</p>
      </>,
    })),
  ];
  return <div style={{ marginTop: 12 }}>
    <ResultBookShell method={`Time series: ${TS_TOOL_LABEL[result.tab]}`} status={book.saved ? "Saved" : "Not saved"} initialOpen="all"
      meta={`${t.yLabel} against ${t.xName}`}
      tools={<>
        <Button size="sm" disabled={!t.canSaveResult} title={t.saveResultDisabledReason ?? undefined} onClick={t.saveResult}>Save result</Button>
        <OpenSavedResultButton book={book} />
      </>}
      sections={sections} />
  </div>;
}
