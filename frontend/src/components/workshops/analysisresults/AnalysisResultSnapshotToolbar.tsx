import type { AnalysisResult } from "../../../lib/analysisResult";
import type { SnapshotResultState } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import { snapshotRecovery } from "../../../lib/snapshotRecovery";
import { Button } from "../../primitives";
import type { Dispatch, SetStateAction } from "react";
import AnalysisResultFreeze from "./AnalysisResultFreeze";
import type { AnalysisResultBusy } from "./useAnalysisResultInlineTableActions";

export default function AnalysisResultSnapshotToolbar({ result, source, recipeReady, state, busy, onOpen, onEdit, onDuplicate, onReport, setBusy, onFrozen }: {
  result: AnalysisResult;
  source: Dataset | undefined;
  recipeReady: boolean;
  /** From snapshotResultState — the same authority the report action re-checks. */
  state: SnapshotResultState;
  busy: AnalysisResultBusy;
  setBusy: Dispatch<SetStateAction<AnalysisResultBusy>>;
  onFrozen: (datasetId: string) => void;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onReport: () => void;
}) {
  // Same description as the result book's button (lib/snapshotRecovery): a
  // pending source is loaded by the rerun itself; a stale one reopens for review.
  const recovery = snapshotRecovery(state, recipeReady, result.producer.label, source?.name);
  // Report handoff sends the primary (first) table only — say so.
  const summaryTitle = result.tables?.[0]?.title ?? (result.tables?.length ? "first" : null);
  const reportBlocked = state === "out-of-date" ? "Run the analysis again before adding these values to a report."
    : state === "pending" ? "Load the full source worksheet before adding these values to a report."
    : state === "source-missing" ? "The source worksheet is missing, so these values can't be verified." : null;
  return <>
    {result.sources.length > 0 && <Button disabled={!source || busy !== null} onClick={onOpen}>Open data</Button>}
    <Button disabled={!recovery.canReopen || busy !== null} title={recovery.title}
      onClick={onEdit}>{recovery.kind === "review-rerun" ? "Review and rerun…" : "Edit / rerun…"}</Button>
    <Button disabled={!result.tables?.length || busy !== null} onClick={onDuplicate}>{busy === "duplicate" ? "Duplicating…" : "Duplicate"}</Button>
    {!!result.tables?.length && <AnalysisResultFreeze result={result} busy={busy} setBusy={setBusy} onFrozen={onFrozen} />}
    <Button disabled={!result.tables?.length || state !== "current" || busy !== null}
      title={reportBlocked
        ?? (summaryTitle ? `Adds only the “${summaryTitle}” table to the report; Export all tables includes every table.` : undefined)}
      onClick={onReport}>{busy === "report" ? "Adding…" : "Send summary to report"}</Button>
  </>;
}
