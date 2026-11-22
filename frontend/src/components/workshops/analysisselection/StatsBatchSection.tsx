// The shared batch section for the statistics tools (lane BY): an opt-in
// "Batch" toggle that, once opened, takes this tool's analysis selection (the
// worksheets selected in the Library) and runs the tool's own computation over
// each through the shared AnalysisBatchControls -- preflight, sequential runs,
// Cancel between worksheets, a failed worksheet as an error row, and ONE
// analysis-batch result in the Library and the Result book.
//
// Opt-in so that merely opening a statistics tool never claims the shared
// analysis selection from another open tool, and the single run's defaults are
// untouched. Rows follow the statistics tools' single-run policy (the analysis
// view: excluded and filtered-out rows dropped; selected rows and the plot X
// range not read), so a batch row for the active worksheet matches the panel.

import { useState } from "react";

import type { AnalysisResultValue } from "../../../lib/analysisResult";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
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
}

function StatsBatchBody({ toolId, label, meaning, summaryColumns, runItem, resultParameters, blockedReason }: Props) {
  useToolAnalysisSelection(toolId); // seeds / keeps this tool's selection
  return <>
    <p className="qzk-ds-meta">
      {meaning} Excluded and filtered-out rows are left out; selected rows and the plot X range are not used.
    </p>
    {blockedReason && <p className="qzk-analysis-input-issue error">{blockedReason}</p>}
    <AnalysisBatchControls
      toolId={toolId}
      label={label}
      summaryColumns={[...summaryColumns]}
      runItem={runItem}
      {...(resultParameters ? { resultParameters } : {})}
      blockedReason={blockedReason ?? null}
      rowPolicy="analysisView"
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
