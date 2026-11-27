// The Outlier screening result as a result book (lane RB3): the same shell
// and actions as the saved book. Sections: Summary (the test statistic), the
// tables in saved order (Flagged rows; Rosner sequence, new in the tool, starts
// collapsed). Header: Select flagged rows, Save result, Open saved result.
// Screening never excludes rows: Select flagged rows only selects them.

import { Button } from "../../primitives";
import BookTable, { LIVE_REST } from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, ToolTableActions } from "../resultbook/ToolBookActions";
import { worksheetRowNumber } from "../../../lib/worksheetRowNumber";
import type { OutlierScreeningState } from "./useOutlierScreening";

const METHOD_NAMES: Readonly<Record<OutlierScreeningState["method"], string>> = {
  grubbs: "Grubbs", rosner: "Rosner generalized ESD", "dixon-q": "Dixon Q", mad: "MAD (robust z)",
};

function fmt(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(digits)).toString();
}

export default function OutlierResultBook({ o }: { o: OutlierScreeningState }) {
  const { result, book } = o;
  if (!result) return null;
  const rosner = book.liveTables()?.find((table) => table.title === "Rosner sequence");
  const sections: ResultBookSectionSpec[] = [
    { key: "summary", kind: "summary", title: "Summary", render: () => <ResultSummary result={result} /> },
    { key: "table:Flagged rows", kind: "table", title: `Flagged rows (${o.flaggedRowValues.length})`,
      actions: <ToolTableActions book={book} title="Flagged rows" />,
      render: () => o.flaggedRowValues.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>none flagged</div>
      ) : (
        <table className="qzk-rsm-table" style={{ width: "100%", fontSize: 11 }}>
          <thead style={{ color: "var(--text-faint)", textAlign: "right" }}>
            <tr><th style={{ textAlign: "left" }}>row</th><th>value</th></tr>
          </thead>
          <tbody style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
            {o.flaggedRowValues.map((p) => (
              <tr key={p.rowIndex}><td style={{ textAlign: "left" }}>{worksheetRowNumber(p.rowIndex)}</td><td>{fmt(p.value)}</td></tr>
            ))}
          </tbody>
        </table>
      ) },
    ...(rosner ? [{ key: "table:Rosner sequence", kind: "table" as const, title: "Rosner sequence", startCollapsed: true,
      actions: <ToolTableActions book={book} title="Rosner sequence" />, render: () => <BookTable table={rosner} restNote={LIVE_REST} /> }] : []),
  ];
  return <ResultBookShell method={`Outlier screening: ${METHOD_NAMES[result.method]}`} status={book.saved ? "Saved" : "Not saved"}
    initialOpen="all" meta={o.columns.find((column) => column.index === o.col)?.label}
    tools={<>
      <Button size="sm" disabled={o.flaggedRowIndices.length === 0} onClick={o.selectFlaggedRows}
        title="Highlight the flagged rows in the worksheet + plot (does NOT exclude or delete them)">
        Select flagged rows
      </Button>
      <Button size="sm" disabled={!o.canSaveResult} title={o.saveResultDisabledReason ?? undefined} onClick={o.saveResult}>
        Save result
      </Button>
      <OpenSavedResultButton book={book} />
    </>}
    sections={sections} />;
}

function ResultSummary({ result }: { result: NonNullable<OutlierScreeningState["result"]> }) {
  if (result.method === "grubbs") {
    const r = result.data;
    return <div className="qzk-ds-meta">G = {fmt(r.G)}, G_critical = {fmt(r.G_critical)} — {r.flagged ? "flagged" : "no outlier"} (N={r.N})</div>;
  }
  if (result.method === "dixon-q") {
    const r = result.data;
    return <div className="qzk-ds-meta">
      Q = {fmt(r.Q)}, Q_critical = {fmt(r.Q_critical)} ({r.ratio}, {r.tail} tail) —{" "}
      {r.flagged ? "flagged" : "no outlier"} (N={r.N})
    </div>;
  }
  if (result.method === "rosner") {
    const r = result.data;
    return <div className="qzk-ds-meta">{r.num_outliers} of up to {r.k} tested exceed their critical lambda (N={r.N})</div>;
  }
  const r = result.data;
  return <div className="qzk-ds-meta">
    median = {fmt(r.median)}, MAD = {fmt(r.mad)} ({r.scale_method}), threshold = {fmt(r.threshold)} — N={r.N}
  </div>;
}
