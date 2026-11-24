// The shared batch section for the statistics tools (lane BY): an opt-in
// "Batch" toggle that, once opened, takes this tool's analysis selection (the
// worksheets selected in the Library) and runs the tool's own computation over
// each through the shared AnalysisBatchControls -- preflight, sequential runs,
// Cancel between worksheets, a failed worksheet as an error row, and ONE
// analysis-batch result in the Library and the Result book.
//
// Opt-in so that merely opening a statistics tool never claims the shared
// analysis selection from another open tool, and the single run's defaults are
// untouched. Inputs follow the statistics contract (AnalysisBatchControls
// `inputs="statistics"`): the single run's rows (the analysis view: excluded
// and filtered-out rows dropped; selected rows and the plot X range not read)
// and columns by name, so a batch row for the active worksheet matches the panel.

import { useState, type ComponentProps } from "react";

import { inputRuleSentence, ROW_POLICY } from "../../../lib/analysisInputs";
import type { AnalysisResultValue } from "../../../lib/analysisResult";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { seedAnalysisSelection, useAnalysisSelection } from "../../../store/analysisSelection";
import { Button } from "../../primitives";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "./AnalysisBatchControls";
import { useToolAnalysisSelection } from "./useToolAnalysisSelection";
import "./analysisInputReview.css";

interface Props {
  toolId: string;
  label: string;
  /** What one worksheet means for this tool (shown above the batch table). */
  meaning: string;
  summaryColumns: readonly string[];
  runItem: (dataset: Dataset, selection: AnalysisSelectionItem) => Promise<AnalysisBatchOutcome>;
  resultParameters?: Record<string, AnalysisResultValue>;
  blockedReason?: string | null;
  /** Replaces the default row-policy sentence (a tool that reads every row). */
  rowsNote?: string;
  /** Extra controls under a finished run (see AnalysisBatchControls). */
  afterRun?: ComponentProps<typeof AnalysisBatchControls>["afterRun"];
  /** Offers "Create summary worksheet" under a finished run (see AnalysisBatchControls). */
  onSummarySheet?: ComponentProps<typeof AnalysisBatchControls>["onSummarySheet"];
}

function StatsBatchBody({ toolId, label, meaning, summaryColumns, runItem, resultParameters, blockedReason, rowsNote, afterRun, onSummarySheet }: Props) {
  useToolAnalysisSelection(toolId); // seeds / keeps this tool's selection
  const owner = useAnalysisSelection((state) => state.toolId);
  if (owner !== null && owner !== toolId) {
    return <p className="qzk-ds-meta">
      Another tool is using the Library selection for its batch.{" "}
      <Button size="sm" onClick={() => seedAnalysisSelection(toolId, "tool-default")}>Use it for {label}</Button>
    </p>;
  }
  return <>
    <p className="qzk-ds-meta">
      {meaning} {rowsNote ?? inputRuleSentence(ROW_POLICY.analysisView, { counts: null })}
    </p>
    {blockedReason && <p className="qzk-analysis-input-issue error">{blockedReason}</p>}
    <AnalysisBatchControls
      // A settings change starts a fresh table: rows run with other settings
      // must not sit under the new column / method. Through `settingsKey`
      // ("drop"), not a remount key: a remount let a running batch go on
      // unseen while the fresh instance offered Run again (lane IR).
      settingsKey={JSON.stringify(resultParameters ?? {})}
      toolId={toolId}
      label={label}
      summaryColumns={[...summaryColumns]}
      runItem={runItem}
      {...(resultParameters ? { resultParameters } : {})}
      blockedReason={blockedReason ?? null}
      inputs="statistics"
      {...(afterRun ? { afterRun } : {})}
      {...(onSummarySheet ? { onSummarySheet } : {})}
      defaultExpanded
    />
  </>;
}

export default function StatsBatchSection(props: Props) {
  const [open, setOpen] = useState(false);
  return <section aria-label={`${props.label} over selected worksheets`} style={{ marginTop: 12 }}>
    <button type="button" className="qzk-analysis-input-review-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span><strong>Batch over selected worksheets</strong></span>
      <span>{open ? "▾" : "▸"}</span>
    </button>
    {open && <StatsBatchBody {...props} />}
  </section>;
}
