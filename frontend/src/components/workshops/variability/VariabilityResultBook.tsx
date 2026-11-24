// The Variability result as a result book (lane RB3): the same shell and
// actions as the saved book. Sections in the book's one order: summary, the
// tables in saved order (Nested ANOVA, Variance components, Cell and Factor A
// summaries; the last two start collapsed, the tool did not show them before
// the book), the chart, then the notes.

import type { ReactNode } from "react";

import { Button } from "../../primitives";
import BookTable from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, PLOT_REPORT_NOTE, ToolTableActions } from "../resultbook/ToolBookActions";
import VariabilityChart from "./VariabilityChart";
import { NestedAnovaTable, VariabilitySummaryLine, VarianceComponentsTable } from "./VarianceComponentsView";
import type { VariabilityState } from "./useVariability";

export const VARIABILITY_METHOD = "Variability: nested ANOVA and variance components";

export default function VariabilityResultBook({ v }: { v: VariabilityState }) {
  const { anova, summary, varComp, book } = v;
  if (!anova || !summary) return null;
  const table = (title: string, shown: string, render: () => ReactNode, startCollapsed = false): ResultBookSectionSpec => ({
    key: `table:${title}`, kind: "table", title: shown, startCollapsed,
    actions: <ToolTableActions book={book} title={title} />, render,
  });
  const live = (title: string) => () => {
    const found = book.liveTables()?.find((candidate) => candidate.title === title);
    return found ? <BookTable table={found} /> : null;
  };
  const sections: ResultBookSectionSpec[] = [
    { key: "summary", kind: "summary", title: "Summary", render: () => <VariabilitySummaryLine anova={anova} summary={summary} /> },
    table("Nested ANOVA", "Nested ANOVA", () => <NestedAnovaTable anova={anova} />),
    ...(varComp ? [table("Variance components", `Variance components (${varComp.method})`, () => <VarianceComponentsTable varComp={varComp} />)] : []),
    table("Cell summaries", "Cell summaries", live("Cell summaries"), true),
    table("Factor A summaries", "Factor A summaries", live("Factor A summaries"), true),
    { key: "plot:chart", kind: "figure", title: "Variability chart", meta: "Plot", render: () => <>
      <VariabilityChart levels={v.levels} summary={summary} />
      <p className="qz-result-book-note">{PLOT_REPORT_NOTE}</p>
    </> },
    ...(v.varCompNote ? [{ key: "notes", kind: "notes" as const, title: "Notes", render: () =>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>{v.varCompNote}</div> }] : []),
  ];
  return <ResultBookShell method={VARIABILITY_METHOD} status={book.saved ? "Saved" : "Not saved"} initialOpen="all"
    meta={`${v.responseLabel} by ${v.factorALabel} / ${v.factorBLabel}`}
    tools={<>
      <Button size="sm" disabled={!v.canSaveResult} title={v.saveResultDisabledReason ?? undefined} onClick={v.saveResult}>
        Save result
      </Button>
      <Button size="sm" disabled={v.reportBusy} onClick={() => void v.toReport()}>
        {v.reportBusy ? "Reporting…" : "→ Report"}
      </Button>
      <OpenSavedResultButton book={book} />
    </>}
    sections={sections} />;
}
