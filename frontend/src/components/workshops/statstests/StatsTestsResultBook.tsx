// The Statistical tests result as a result book (lane RB4): the same shell and
// actions as the saved book. Sections: Result (the one-sentence reading), then
// every result table, open as before, each with Copy table / Send to report /
// Open as worksheet, then (Kaplan-Meier) the survival curve's worksheet / plot
// actions. Every Run already saves a Library result, so the table actions use
// THAT run's result (`savedId`, cleared with the output), never a lookup that
// could match another run. Run again re-runs the test (picking another test
// clears the output, so it is always the test shown). The header keeps the whole-result Copy table /
// Export CSV / → Report and adds Open saved result. An out-of-date output
// withholds every action, as before.

import { useMemo } from "react";

import type { AnalysisResultTable } from "../../../lib/analysisResult";
import { fmtNum } from "../../../lib/format";
import { testDef } from "../../../lib/statsTests";
import type { TestOutput } from "../../../lib/statsTestsResults";
import { Button } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, ToolTableActions } from "../resultbook/ToolBookActions";
import { useToolResultBook } from "../resultbook/useToolResultBook";
import KmCurveActions from "./KmCurveActions";
import SpcView from "./SpcView";
import { savedTableIndex, tableLabels } from "./statsTestsBookTables";
import type { StatsTestsState } from "./useStatsTests";

const STALE = "Out of date: run the test again";
const GONE = "The saved result of this run was deleted or undone; run the test again.";

export default function StatsTestsResultBook({ t, output }: { t: StatsTestsState; output: TestOutput }) {
  const labels = useMemo(() => tableLabels(output.tables), [output]);
  const live = useMemo<AnalysisResultTable[]>(() => output.tables.map((table, index) => ({ ...table, title: labels[index] })), [labels, output]);
  const book = useToolResultBook({
    savedId: t.savedId, liveTables: () => live, blocked: t.stale ? STALE : null, unsavedReason: t.saveError ?? GONE,
    resolveSaved: (label, saved) => savedTableIndex(output, labels, label, saved),
  });
  const sections: ResultBookSectionSpec[] = [
    { key: "result", kind: "summary", title: "Result", render: () => <div style={{ fontWeight: 600 }}>{output.sentence}</div> },
    ...(output.spc ? [{ key: "spc-figure", kind: "figure" as const, title: output.spc.kind === "chart" ? "Control chart" : "Capability histogram",
      meta: "Plot", render: () => <SpcView spc={output.spc!} /> }] : []),
    ...output.tables.map((table, index): ResultBookSectionSpec => ({
      key: `table:${labels[index]}`, kind: "table", title: labels[index], meta: `Table · ${table.rows.length} × ${table.columns.length}`,
      actions: <ToolTableActions book={book} title={labels[index]} />,
      render: () => <DataTable columns={table.columns}
        rows={table.rows.map((r) => r.map((v) => (typeof v === "number" ? fmtNum(v) : (v ?? "—"))))} />,
    })),
    ...(t.km ? [{ key: "km-curve", kind: "figure" as const, title: "Survival curve", meta: "Worksheet / plot",
      render: () => <KmCurveActions km={t.km} stale={t.stale} /> }] : []),
  ];
  return <ResultBookShell initialOpen="all" method={testDef(t.ranTest).label}
    status={t.stale ? "Out of date" : book.saved ? "Saved" : "Not saved"}
    meta={t.saveError ?? undefined}
    tools={<>
      <Button size="sm" disabled={t.stale} onClick={() => void t.copy()} title={t.stale ? STALE : "Copy the sentence and tables as tab-separated text."}>
        Copy table
      </Button>
      <Button size="sm" disabled={t.stale} onClick={t.exportCsv} title={t.stale ? STALE : "Save the sentence and tables as a CSV file."}>
        Export CSV
      </Button>
      <Button size="sm" disabled={t.busy || t.stale} title={t.stale ? STALE : undefined} onClick={() => void t.toReport()}>
        → Report
      </Button>
      <OpenSavedResultButton book={book} />
      <Button size="sm" disabled={t.busy || (t.def.input !== "none" && !t.active)}
        title="Run this test again on the current data and settings."
        onClick={() => void t.run()}>Run again</Button>
    </>}
    sections={sections} />;
}
