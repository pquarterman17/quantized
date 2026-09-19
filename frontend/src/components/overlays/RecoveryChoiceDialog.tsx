// Crash-recovery chooser (P1.2 box "explain crash recovery source/time/
// choices"). Shown ONLY when useWorkspaceAutosave.ts's startup effect finds
// an autosave candidate newer than the last-known named project — see
// lib/recoveryChoice.ts's header for exactly when that is. Every choice is
// explicit; there is no default/auto action, and Cancel touches nothing (the
// autosave stays in storage, the last project's file stays on disk).
//
// Modeled on ConfirmDialog's backdrop + qzk-glass shell, but not built on
// askConfirm's boolean promise — three distinct outcomes, not confirm/cancel.

import { useEffect, useId, useRef } from "react";

import {
  applyCancelRecovery,
  applyKeepLastProject,
  applyRecoverAutosave,
} from "../../lib/applyRecoveryChoice";
import { useRecoveryChoice } from "../../store/recoveryChoice";
import { Button } from "../primitives";
import { useDialogFocus } from "./useDialogFocus";

function formatWhen(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.valueOf()) ? "unknown time" : d.toLocaleString();
}

export default function RecoveryChoiceDialog() {
  const prompt = useRecoveryChoice((s) => s.pending);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const open = prompt !== null;

  // P3.3: this dialog had NO keyboard dismissal at all — the only way out was
  // clicking Cancel or the backdrop. It is a STARTUP modal (it appears before
  // the user has touched anything), so it was also the one place where "focus
  // is already somewhere sensible" is guaranteed false: focus sat on <body>,
  // which meant the backdrop-click escape hatch had no keyboard twin.
  //
  // Escape maps to Cancel — the choice that touches nothing (the autosave
  // stays in storage, the project file stays on disk), matching the backdrop.
  // Window capture, like ConfirmDialog, so it works wherever focus is.
  // NARROWED 2026-09-19 (P3.3 round 8). The sentence above is true only over a
  // NON-dialog surface. Two of these backdrop dialogs can be open at once, and
  // `stopPropagation()` does not stop a same-node, same-phase sibling, so BOTH
  // window-capture handlers run on ONE Escape — measured, 2 open dialogs to 0.
  // Tracked as BUG-018 (`plans/BUGS_AND_ISSUES.md`), pinned by
  // `stackedDialogEscape.test.tsx`. Migrating onto `useEscapeSurface` fixes
  // the ladder but is blocked on `escapeStack`'s `isEditingTarget` bail; see
  // the bug entry for that measurement before attempting it again.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      applyCancelRecovery();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  useDialogFocus(dialogRef, open);

  if (prompt === null) return null;

  const { autosaveAt, datasetCount, lastProject } = prompt;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={applyCancelRecovery}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Recover unsaved work?</h2>
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
            title={`Reopen ${lastProject.name} from disk without loading the autosaved snapshot — it stays in storage, unaffected, in case you want it later`}
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
