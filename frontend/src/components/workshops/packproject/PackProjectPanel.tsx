import { useEffect, useRef } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { Button } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { MetaRow } from "../../primitives/MetaRow";
import { NOTHING_MODIFIED_NOTE, usePackProject } from "../../../store/packProject";
import { usePackProjectPanel } from "../../../store/packProjectPanel";
import { formatBytes as bytes } from "../../../lib/formatBytes";

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export default function PackProjectPanel() {
  const phase = usePackProject((s) => s.phase);
  const preview = usePackProject((s) => s.preview);
  const progress = usePackProject((s) => s.progress);
  const errors = usePackProject((s) => s.errors);
  const resultPath = usePackProject((s) => s.resultPath);
  const cleanupOk = usePackProject((s) => s.cleanupOk);
  const start = usePackProject((s) => s.startPackProject);
  const cancel = usePackProject((s) => s.cancelPackProject);
  const reset = usePackProject((s) => s.resetPackProject);
  const retry = usePackProject((s) => s.previewPackProject);
  const setOpen = usePackProjectPanel((s) => s.setOpen);


  // The panel opens (commands/packProjectCommands.ts) BEFORE the preview has
  // moved the phase off "idle", so an unconditional "idle -> close" here
  // would close the panel the instant it mounts. Only close on idle once an
  // ACTIVE phase has actually been observed — that is what distinguishes
  // "the native picker was cancelled / preview came back with nothing to
  // review" (close) from "we just opened and previewPackProject hasn't run
  // yet" (stay open). runPackProject's own idle check after `await
  // previewPackProject()` covers the same case from the run side; this
  // covers every OTHER path back to idle (e.g. a future retry).
  const sawActive = useRef(false);
  useEffect(() => {
    if (phase !== "idle") sawActive.current = true;
    else if (sawActive.current) setOpen(false);
  }, [phase, setOpen]);

  // The X button and every "Cancel"/"Close" control below funnel through
  // this one function so the panel's close semantics stay in one place.
  // `viaTitleBar` is true only for the ToolWindow's own X: aborting an
  // in-flight pack must be DELIBERATE (owner review on #310), and the X is
  // easy to hit by accident in a way the labelled Cancel button is not, so
  // that one path asks first. The visible Cancel button stays immediate.
  const dismiss = async (viaTitleBar = false) => {
    if (phase === "idle") {
      // Open at idle only in the microtask between runPackProject opening
      // the panel and the (preloaded) preview leaving idle. Just close; if
      // the preview still proceeds, runPackProject sees the flag is down
      // and resets the store rather than leaving it active and headless.
      setOpen(false);
    } else if (phase === "cancelling") {
      // Already stopping: there is nothing left to confirm or to ask for.
      // The X does nothing at all rather than prompting a second time and
      // reissuing `packCancel` (owner review on #310) — the window stays
      // put so "Stopping safely…" and then the outcome remain visible.
      return;
    } else if (phase === "packing") {
      // Declining must leave BOTH the operation and the panel untouched, so
      // the confirm is the only thing that happens on a "no" — no reset, no
      // close, no cancel. On a "yes" the window stays open so the
      // "Stopping safely…" -> "Pack cancelled" outcome is still visible
      // (nothing original is ever modified either way: pack only COPIES).
      if (viaTitleBar && !(await askConfirm("Cancel packing?", "", "Cancel packing", true))) {
        return;
      }
      await cancel();
    } else {
      // Terminal, or a pre-packing active phase (picker/scan/review): reset
      // is legal from all of them and goes straight to idle, so backing out
      // of the review step never flashes the "Pack cancelled" screen.
      await reset();
      setOpen(false);
    }
  };

  return (
    <ToolWindow id="pack-project" title="Pack Project" width={620} onClose={() => void dismiss(true)}>
      {(phase === "selecting_destination" || phase === "scanning") && (
        <div role="status" aria-live="polite">
          <p>{phase === "selecting_destination" ? "Choose where to create the portable project." : "Checking source files…"}</p>
          <Button size="sm" onClick={() => void dismiss()}>Cancel</Button>
        </div>
      )}

      {phase === "awaiting_confirmation" && preview && (
        <>
          <p style={{ marginTop: 0 }}>
            Review what will be copied. Your open project and original data files will not be changed.
          </p>
          <MetaRow label="Project" value={preview.projectName} />
          <MetaRow label="Destination" value={preview.destination.bundleDir} title={preview.destination.bundleDir} />
          <MetaRow
            label="Contents"
            value={`${preview.manifest.summary.datasets} datasets · ${preview.manifest.summary.sources} source files · ${bytes(preview.manifest.summary.total_bytes)}`}
          />
          {preview.destination.exists && (
            <p role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--warn)" }}>A folder already exists at the destination. Packing will refuse to overwrite it.</p>
          )}
          {preview.warnings.length > 0 && (
            <section aria-labelledby="pack-warnings"><h3 id="pack-warnings">Needs attention</h3>
              <ul>{preview.warnings.map((warning, i) => <li key={`${warning.code}-${i}`}>{warning.message}</li>)}</ul>
            </section>
          )}
          <div style={{ maxHeight: 230, overflow: "auto" }}>
            <DataTable
              columns={["Source", "Status", "Size"]}
              rows={preview.manifest.sources.map((source) => [
                <span key="p" title={source.original_path} style={{ overflowWrap: "anywhere" }}>{source.original_path}</span>,
                source.packable ? (source.changed ? "changed" : source.unverified ? "unverified" : "ready") : statusLabel(source.status),
                source.size === null ? "—" : bytes(source.size),
              ])}
            />
          </div>
          {preview.blockers.length > 0 && <p className="qzk-ds-meta qzk-msg">{preview.blockers.length === 1 ? "1 unavailable source keeps its original absolute path" : `${preview.blockers.length} unavailable sources keep their original absolute paths`} in the packed copy.</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button size="sm" onClick={() => void start(preview.manifest)} disabled={preview.destination.exists}>Pack Project</Button>
            <Button size="sm" onClick={() => void dismiss()}>Cancel</Button>
          </div>
        </>
      )}

      {(phase === "packing" || phase === "cancelling") && (
        <div role="status" aria-live="polite">
          <p>{phase === "cancelling" ? "Stopping safely…" : progress.stage ? `${statusLabel(progress.stage)}…` : "Packing project…"}</p>
          <progress max={Math.max(progress.bytesTotal, 1)} value={progress.bytesCopied} aria-label="Pack project progress" style={{ width: "100%" }} />
          <p className="qzk-ds-meta qzk-msg">{progress.completedCount} of {progress.totalCount} files · {bytes(progress.bytesCopied)} of {bytes(progress.bytesTotal)}</p>
          {progress.currentFile && <p className="qzk-ds-meta qzk-msg" style={{ overflowWrap: "anywhere" }}>{progress.currentFile}</p>}
          <Button size="sm" onClick={() => void cancel()} disabled={phase === "cancelling"}>Cancel</Button>
        </div>
      )}

      {phase === "completed" && <div role="status"><h3>Portable project created</h3><p style={{ overflowWrap: "anywhere" }}>{resultPath}</p><p className="qzk-ds-meta qzk-msg">{NOTHING_MODIFIED_NOTE}</p><Button size="sm" onClick={() => void dismiss()}>Close</Button></div>}
      {phase === "cancelled" && <div role="status"><h3>Pack cancelled</h3><p>{NOTHING_MODIFIED_NOTE}</p><Button size="sm" onClick={() => void dismiss()}>Close</Button></div>}
      {phase === "failed" && <div role="alert"><h3>Could not pack project</h3>{errors.map((error, i) => <p key={`${error.code}-${i}`}>{error.message}</p>)}<p className="qzk-ds-meta qzk-msg">{NOTHING_MODIFIED_NOTE}{cleanupOk === false ? " Temporary files could not be fully removed." : ""}</p><div style={{ display: "flex", gap: 8 }}><Button size="sm" onClick={() => void retry()}>Try again</Button><Button size="sm" onClick={() => void dismiss()}>Close</Button></div></div>}
    </ToolWindow>
  );
}
