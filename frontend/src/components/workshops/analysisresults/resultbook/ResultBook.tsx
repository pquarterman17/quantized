// The result book (lane RB): one expandable view of a saved statistics result
// inside the result workspace (a tab, not a new window). One header names the
// inputs (the shared input line while the result is current), the method, the
// settings and the freshness; below it, one collapsible section per saved
// table and figure in the fixed order of lib/resultBook. Opens with the first
// section expanded; the collapse state belongs to this view of this result.

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { AnalysisResult } from "../../../../lib/analysisResult";
import { SNAPSHOT_RESULT_STATUS, type SnapshotResultState } from "../../../../lib/analysisResultFreshness";
import { resultBookInputs, resultBookModel, resultBookSavedColumns } from "../../../../lib/resultBook";
import type { Dataset } from "../../../../lib/types";
import { Button } from "../../../primitives";
import AnalysisInputSummary from "../../analysisselection/AnalysisInputSummary";
import { formatDate } from "../analysisResultPanelText";
import type { AnalysisResultBusy } from "../useAnalysisResultInlineTableActions";
import ResultBookSection from "./ResultBookSection";
import { useResultBookActions } from "./useResultBookActions";
import "./resultBook.css";

const NOT_CURRENT: Readonly<Record<Exclude<SnapshotResultState, "current">, string>> = {
  "out-of-date": "The source changed since this result was saved. The values below are the saved ones; reopen in the tool to analyse the current data.",
  "pending": "The full source worksheet is still loading, so the saved input cannot be verified yet. The values below are the saved ones.",
  "source-missing": "The source worksheet is missing. The values below are the saved ones and cannot be verified.",
};
const REPORT_BLOCKED: Readonly<Record<Exclude<SnapshotResultState, "current">, string>> = {
  "out-of-date": "Run the analysis again before adding these values to a report.",
  "pending": "Load the full source worksheet before adding these values to a report.",
  "source-missing": "The source worksheet is missing, so these values can't be verified.",
};

export default function ResultBook({
  result, source, state, busy, setBusy, recipeReady, figureBlocked, onReopen, onClose,
}: {
  result: AnalysisResult;
  source: Dataset | undefined;
  /** From snapshotResultState: the one freshness authority. */
  state: SnapshotResultState;
  busy: AnalysisResultBusy;
  setBusy: Dispatch<SetStateAction<AnalysisResultBusy>>;
  /** The saved question parses, so the tool can reopen on it. */
  recipeReady: boolean;
  figureBlocked?: string;
  onReopen: () => void;
  onClose: () => void;
}) {
  const model = useMemo(() => resultBookModel(result, source), [result, source]);
  const inputs = useMemo(() => model ? resultBookInputs(model, source, state) : null, [model, source, state]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(model?.sections[0] ? [model.sections[0].key] : []));
  const actions = useResultBookActions(result, busy, setBusy, onClose);
  if (!model) {
    return <p className="qz-analysis-empty">This saved result has no readable recipe, so it has no result book. The other tabs still show it.</p>;
  }
  const reopenable = recipeReady && (state === "current" || state === "pending");
  const status = SNAPSHOT_RESULT_STATUS[state];
  const toggle = (key: string) => setOpen((now) => {
    const next = new Set(now);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const columns = resultBookSavedColumns(result);
  return <div className="qz-result-book">
    <header className="qz-result-book-head">
      <div className="qz-result-book-title">
        <h3>{model.method}</h3>
        <span className={`qz-analysis-status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
        <span className="qz-result-book-meta">Saved {formatDate(result.createdAt)}</span>
      </div>
      {inputs ? <AnalysisInputSummary inputs={inputs} /> : <>
        <p className="qz-result-book-saved-input">Input: {source?.name ?? "missing source"}{columns ? ` · ${columns}` : ""}</p>
        {state !== "current" && <p className="qz-analysis-missing" role="note">{NOT_CURRENT[state]}</p>}
      </>}
      {!!model.settings.length && <dl className="qz-result-book-settings" aria-label="Settings">
        {model.settings.map((setting) => <div key={setting.label}><dt>{setting.label}</dt><dd>{setting.value}</dd></div>)}
      </dl>}
      {!!result.warnings.length && <ul className="qz-result-book-warnings" aria-label="Warnings">
        {result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
      </ul>}
      <div className="qz-result-book-tools">
        <Button size="sm" disabled={!reopenable || busy !== null}
          title={!recipeReady ? "This result does not contain a compatible saved question."
            : state === "out-of-date" ? "The source changed; start a new analysis from the current data instead."
            : state === "source-missing" ? "The source worksheet is missing." : `Reopen ${result.producer.label} with this result's source and settings.`}
          onClick={onReopen}>Reopen in tool</Button>
        <Button size="sm" disabled={!model.sections.length} onClick={() => setOpen(new Set(model.sections.map((section) => section.key)))}>Expand all</Button>
        <Button size="sm" disabled={!model.sections.length} onClick={() => setOpen(new Set())}>Collapse all</Button>
      </div>
    </header>
    {model.sections.length ? model.sections.map((section) => <ResultBookSection key={section.key} section={section}
      table={section.kind === "table" ? result.tables?.[section.tableIndex] : undefined}
      open={open.has(section.key)} onToggle={() => toggle(section.key)}
      actions={{
        disabled: busy !== null,
        reportBlocked: state === "current" ? null : REPORT_BLOCKED[state],
        figureBlocked,
        onCopy: (index) => void actions.copy(index),
        onReport: (index) => void actions.report(index),
        onOpenTable: (index) => void actions.openTable(index),
        onCreateFigure: (draft) => void actions.createFigure(draft),
      }} />)
      : <p className="qz-analysis-empty">No saved tables or figures are available.</p>}
  </div>;
}
