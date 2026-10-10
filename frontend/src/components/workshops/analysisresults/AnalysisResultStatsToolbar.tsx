import type { AnalysisResult } from "../../../lib/analysisResult";
import type { StatisticalSnapshotState } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import { Button } from "../../primitives";

export default function AnalysisResultStatsToolbar({ result, source, recipeReady, state, busy, onOpen, onEdit, onDuplicate, onReport }: {
  result: AnalysisResult;
  source: Dataset | undefined;
  recipeReady: boolean;
  /** From statisticalSnapshotState — the same authority the report action re-checks. */
  state: StatisticalSnapshotState;
  busy: string | null;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onReport: () => void;
}) {
  // A pending source is loaded by the rerun itself, so editing stays allowed.
  const editable = state === "current" || state === "pending";
  const reportReason = state === "out-of-date" ? "Run the test again before adding these values to a report."
    : state === "pending" ? "Load the full source worksheet before adding these values to a report."
    : state === "source-missing" ? "The source worksheet is missing, so these values can't be checked." : undefined;
  return <>
    {result.sources.length > 0 && <Button disabled={!source || busy !== null} onClick={onOpen}>Open data</Button>}
    <Button disabled={!recipeReady || !editable || busy !== null}
      title={state === "out-of-date" ? "The source changed; start a new test from the current data instead."
        : state === "source-missing" ? "The source worksheet is missing."
        : !recipeReady ? "This result does not contain a compatible saved question." : undefined}
      onClick={onEdit}>Edit / rerun…</Button>
    <Button disabled={!result.tables?.length || busy !== null} onClick={onDuplicate}>{busy === "duplicate" ? "Duplicating…" : "Duplicate"}</Button>
    <Button disabled={!result.tables?.length || state !== "current" || busy !== null}
      title={reportReason}
      onClick={onReport}>{busy === "report" ? "Adding…" : "Send to report"}</Button>
  </>;
}
