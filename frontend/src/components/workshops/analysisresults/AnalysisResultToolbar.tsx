import type { AnalysisResult } from "../../../lib/analysisResult";
import type { SnapshotResultState } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import { Button } from "../../primitives";
import AnalysisResultSnapshotToolbar from "./AnalysisResultSnapshotToolbar";
import type { AnalysisResultBusy } from "./useAnalysisResultInlineTableActions";

export default function AnalysisResultToolbar({
  result, source, status, busy, mode, snapshotState, recipeReady,
  hasReflFit, hasFitSpec, fitReplayable, hasOutput, outputHasRecipe,
  outputDerived, blocked, freezeReason,
  onOpenSource, onOpenOutput, onEdit, onRecalculate, onRerun,
  onDuplicate, onFreeze, onReport, onRename, onRemove,
}: {
  result: AnalysisResult;
  source?: Dataset;
  status: string;
  busy: AnalysisResultBusy;
  mode: "snapshot" | "reflectivity" | "peaks" | "fit" | "linked";
  snapshotState: SnapshotResultState;
  recipeReady: boolean;
  hasReflFit: boolean;
  hasFitSpec: boolean;
  fitReplayable: boolean;
  hasOutput: boolean;
  outputHasRecipe: boolean;
  outputDerived: boolean;
  blocked?: string;
  freezeReason: string;
  onOpenSource: () => void;
  onOpenOutput: () => void;
  onEdit: () => void;
  onRecalculate: () => void;
  onRerun: () => void;
  onDuplicate: () => void;
  onFreeze: () => void;
  onReport: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  return <div className="qz-analysis-toolbar">
    <span className={`qz-analysis-status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
    {mode === "snapshot" ? <AnalysisResultSnapshotToolbar result={result} source={source} recipeReady={recipeReady}
      state={snapshotState} busy={busy} onOpen={onOpenSource} onEdit={onEdit}
      onDuplicate={onDuplicate} onReport={onReport} /> : mode === "reflectivity" ? <>
      <Button disabled={!hasReflFit || busy !== null} onClick={onEdit}>Open fit workbench</Button>
    </> : mode === "peaks" ? <>
      <Button disabled={!source || busy !== null} onClick={onOpenSource}>Open data</Button>
      <Button disabled={!source || busy !== null} onClick={onEdit}>Edit / Re-fit…</Button>
    </> : mode === "fit" ? <>
      <Button disabled={!source || busy !== null} onClick={onOpenSource}>Open data</Button>
      <Button disabled={!source || !hasFitSpec || busy !== null} onClick={onEdit}>Edit / Re-fit…</Button>
      <Button disabled={!source || !fitReplayable || busy !== null}
        title={!fitReplayable && hasFitSpec ? "This legacy fit does not record exact X/Y channels; use Edit / Re-fit first." : undefined}
        onClick={onRecalculate}>{busy === "recalculate" ? "Recalculating…" : "Recalculate"}</Button>
    </> : <>
      <Button disabled={!hasOutput} onClick={onOpenOutput}>Open worksheet</Button>
      <Button disabled={!source || !hasOutput || busy !== null} title={blocked} onClick={onRecalculate}>{busy === "recalculate" ? "Recalculating…" : "Recalculate"}</Button>
      <Button disabled={!source || !outputHasRecipe || busy !== null} title={blocked} onClick={onRerun}>{busy === "rerun" ? "Rerunning…" : "Rerun as new"}</Button>
      <Button disabled={result.outputs.length !== 1 || !hasOutput || busy !== null} title="Create a separate linked output worksheet and result." onClick={onDuplicate}>{busy === "duplicate" ? "Duplicating…" : "Duplicate"}</Button>
      <Button disabled={result.outputs.length !== 1 || !outputDerived || busy !== null} title={freezeReason} onClick={onFreeze}>{busy === "freeze" ? "Freezing…" : "Freeze data"}</Button>
    </>}
    <Button disabled={busy !== null} onClick={onRename}>Rename…</Button>
    <Button disabled={busy !== null} variant="danger" onClick={onRemove}>Delete…</Button>
  </div>;
}
