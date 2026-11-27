import type { AnalysisResult } from "../../../lib/analysisResult";
import type { SnapshotResultState } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import { Button } from "../../primitives";
import AnalysisResultFreeze from "./AnalysisResultFreeze";
import AnalysisResultSnapshotToolbar from "./AnalysisResultSnapshotToolbar";
import ReopenInToolButton from "./ReopenInToolButton";
import { isCommittedOutputResult } from "../../../lib/committedOutputGraph";
import { NOT_RECOMPUTABLE, OPEN_DATA_MISSING } from "./analysisResultPanelText";
import type { Dispatch, SetStateAction } from "react";
import type { AnalysisResultBusy } from "./useAnalysisResultInlineTableActions";

export default function AnalysisResultToolbar({
  result, source, status, busy, mode, snapshotState, recipeReady,
  hasReflFit, hasFitSpec, fitReplayable, hasOutput, outputHasRecipe, outputRecomputable,
  blocked, setBusy, onFrozen,
  onOpenSource, onOpenOutput, onEdit, onRecalculate, onRerun,
  onDuplicate, onReport, onRename, onRemove,
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
  /** The output can be re-derived in place (it has `derivedFrom`); a committed
   *  analysis output cannot, only its tool can replace it. */
  outputRecomputable: boolean;
  blocked?: string;
  setBusy: Dispatch<SetStateAction<AnalysisResultBusy>>;
  onFrozen: (datasetId: string) => void;
  onOpenSource: () => void;
  onOpenOutput: () => void;
  onEdit: () => void;
  onRecalculate: () => void;
  onRerun: () => void;
  onDuplicate: () => void;
  onReport: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  return <div className="qz-analysis-toolbar">
    <span className={`qz-analysis-status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
    {mode === "snapshot" ? <AnalysisResultSnapshotToolbar result={result} source={source} recipeReady={recipeReady}
      state={snapshotState} busy={busy} onOpen={onOpenSource} onEdit={onEdit}
      onDuplicate={onDuplicate} onReport={onReport} setBusy={setBusy} onFrozen={onFrozen} /> : mode === "reflectivity" ? <>
      <Button disabled={!hasReflFit || busy !== null} onClick={onEdit}>Open fit workbench</Button>
    </> : mode === "peaks" ? <>
      <Button disabled={!source || busy !== null} title={source ? undefined : OPEN_DATA_MISSING} onClick={onOpenSource}>Open data</Button>
      <Button disabled={!source || busy !== null} onClick={onEdit}>Edit / Re-fit…</Button>
    </> : mode === "fit" ? <>
      <Button disabled={!source || busy !== null} title={source ? undefined : OPEN_DATA_MISSING} onClick={onOpenSource}>Open data</Button>
      <Button disabled={!source || !hasFitSpec || busy !== null} onClick={onEdit}>Edit / Re-fit…</Button>
      <Button disabled={!source || !fitReplayable || busy !== null}
        title={!fitReplayable && hasFitSpec ? "This legacy fit does not record exact X/Y channels; use Edit / Re-fit first." : undefined}
        onClick={onRecalculate}>{busy === "recalculate" ? "Recalculating…" : "Recalculate"}</Button>
    </> : <>
      <Button disabled={!hasOutput} onClick={onOpenOutput}>Open worksheet</Button>
      {isCommittedOutputResult(result) && <ReopenInToolButton result={result} disabled={busy !== null} />}
      <Button disabled={!source || !hasOutput || !outputRecomputable || busy !== null} title={blocked ?? (hasOutput && !outputRecomputable ? NOT_RECOMPUTABLE : undefined)} onClick={onRecalculate}>{busy === "recalculate" ? "Recalculating…" : "Recalculate"}</Button>
      <Button disabled={!source || !outputHasRecipe || busy !== null} title={blocked} onClick={onRerun}>{busy === "rerun" ? "Rerunning…" : "Rerun as new"}</Button>
      <Button disabled={result.outputs.length !== 1 || !hasOutput || busy !== null} title="Create a separate linked output worksheet and result." onClick={onDuplicate}>{busy === "duplicate" ? "Duplicating…" : "Duplicate"}</Button>
      <AnalysisResultFreeze result={result} busy={busy} setBusy={setBusy} onFrozen={onFrozen} />
    </>}
    <Button disabled={busy !== null} onClick={onRename}>Rename…</Button>
    <Button disabled={busy !== null} variant="danger" onClick={onRemove}>Delete…</Button>
  </div>;
}
