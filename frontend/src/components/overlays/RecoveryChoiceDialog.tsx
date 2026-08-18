// Crash-recovery chooser (P1.2 box "explain crash recovery source/time/
// choices"). Shown ONLY when useWorkspaceAutosave.ts's startup effect finds
// an autosave candidate newer than the last-known named project — see
// lib/recoveryChoice.ts's header for exactly when that is. Every choice is
// explicit; there is no default/auto action, and Cancel touches nothing (the
// autosave stays in storage, the last project's file stays on disk).
//
// Modeled on ConfirmDialog's backdrop + qzk-glass shell, but not built on
// askConfirm's boolean promise — three distinct outcomes, not confirm/cancel.

import {
  applyCancelRecovery,
  applyKeepLastProject,
  applyRecoverAutosave,
} from "../../lib/applyRecoveryChoice";
import { useRecoveryChoice } from "../../store/recoveryChoice";
import { Button } from "../primitives";

function formatWhen(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.valueOf()) ? "unknown time" : d.toLocaleString();
}

export default function RecoveryChoiceDialog() {
  const prompt = useRecoveryChoice((s) => s.pending);
  if (prompt === null) return null;

  const { autosaveAt, datasetCount, lastProject } = prompt;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={applyCancelRecovery}>
      <div className="qzk-glass qz-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Recover unsaved work?</h2>
        <p>
          An autosaved snapshot is newer than the last time <strong>{lastProject.name}</strong> was
          saved. Choose which one to keep working from — the other is left untouched either way.
        </p>
        <dl className="qz-recovery-summary">
          <dt>Autosave</dt>
          <dd>
            {datasetCount} dataset{datasetCount === 1 ? "" : "s"} · {formatWhen(autosaveAt)}
          </dd>
          <dt>{lastProject.name}</dt>
          <dd>
            {lastProject.path} · last saved {formatWhen(lastProject.at)}
          </dd>
        </dl>
        <div className="qz-btn-row" style={{ flexWrap: "wrap" }}>
          <Button onClick={applyCancelRecovery} title="Load neither now — decide later from the File menu">
            Cancel
          </Button>
          <Button
            onClick={() => void applyKeepLastProject(prompt)}
            title={`Reopen ${lastProject.name} from disk; discard the autosaved snapshot from this session`}
          >
            Keep {lastProject.name}
          </Button>
          <Button
            variant="primary"
            onClick={() => applyRecoverAutosave(prompt)}
            title="Load the autosaved snapshot; marked unsaved until you choose Save"
          >
            Recover autosave
          </Button>
        </div>
      </div>
    </div>
  );
}
