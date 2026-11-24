// The result book (lane RB; on the shared shell, lane RB3): one expandable view of a saved statistics result
// inside the result workspace (a tab, not a new window). One header names the
// inputs (the shared input line while the result is current), the method, the
// settings and the freshness; below it, one collapsible section per saved
// table and figure in the fixed order of lib/resultBook. Opens with the first
// section expanded; the collapse state belongs to this view of this result.

import { useMemo, type Dispatch, type SetStateAction } from "react";

import type { AnalysisResult } from "../../../../lib/analysisResult";
import { SNAPSHOT_RESULT_STATUS, type SnapshotResultState } from "../../../../lib/analysisResultFreshness";
import { resultBookInputs, resultBookModel, resultBookSavedInput } from "../../../../lib/resultBook";
import type { Dataset } from "../../../../lib/types";
import { Button } from "../../../primitives";
import AnalysisInputSummary from "../../analysisselection/AnalysisInputSummary";
import { formatDate } from "../analysisResultPanelText";
import type { AnalysisResultBusy } from "../useAnalysisResultInlineTableActions";
import type { StatisticalResultFigureDraft } from "../../../../lib/statisticalResultFigures";
import ResultBookShell from "../../resultbook/ResultBookShell";
import { savedBookSection } from "./ResultBookSection";
import { useResultBookActions } from "./useResultBookActions";

const NOT_CURRENT: Readonly<Record<"out-of-date" | "pending", string>> = {
  "out-of-date": "The source changed since this result was saved. The values below are the saved ones; reopen in the tool to analyse the current data.",
  "pending": "The full source worksheet is still loading, so the saved input cannot be verified yet. The values below are the saved ones.",
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
  const model = useMemo(() => resultBookModel(result), [result]);
  const inputs = useMemo(() => model ? resultBookInputs(model, source, state) : null, [model, source, state]);
  const actions = useResultBookActions(result, busy, setBusy, onClose);
  if (!model) {
    return <p className="qz-analysis-empty">This saved result has no readable recipe, so it has no result book. The other tabs still show it.</p>;
  }
  const reopenable = recipeReady && (state === "current" || state === "pending");
  const sectionActions = {
    disabled: busy !== null,
    reportBlocked: state === "current" ? null : REPORT_BLOCKED[state],
    figureBlocked,
    onCopy: (index: number) => void actions.copy(index),
    onReport: (index: number) => void actions.report(index),
    onOpenTable: (index: number) => void actions.openTable(index),
    onCreateFigure: (draft: StatisticalResultFigureDraft) => void actions.createFigure(draft),
  };
  return <ResultBookShell method={model.method} status={SNAPSHOT_RESULT_STATUS[state]}
    meta={`Saved ${formatDate(result.createdAt)}`} initialOpen="first"
    input={inputs ? <AnalysisInputSummary inputs={inputs} /> : <>
      <p className="qz-result-book-saved-input">{resultBookSavedInput(result, model, source)}</p>
      {/* The panel already notes a missing source above the tabs. */}
      {(state === "out-of-date" || state === "pending") && <p className="qz-analysis-missing" role="note">{NOT_CURRENT[state]}</p>}
    </>}
    settings={model.settings} warnings={result.warnings}
    tools={model.reopen && <Button size="sm" disabled={!reopenable || busy !== null}
      title={!recipeReady ? "This result does not contain a compatible saved question."
        : state === "out-of-date" ? "The source changed; start a new analysis from the current data instead."
        : state === "source-missing" ? "The source worksheet is missing." : `Reopen ${result.producer.label} with this result's source and settings.`}
      onClick={onReopen}>Reopen in tool</Button>}
    sections={model.sections.map((section) => savedBookSection(section,
      section.kind === "table" ? result.tables?.[section.tableIndex] : undefined, sectionActions))} />;
}
