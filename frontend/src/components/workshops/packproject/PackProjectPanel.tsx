import { useEffect } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import { NOTHING_MODIFIED_NOTE, usePackProject } from "../../../store/packProject";

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = value / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && n >= 1024; i += 1) {
    n /= 1024;
    unit = units[i];
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${unit}`;
}

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

  const terminal = phase === "completed" || phase === "cancelled" || phase === "failed";
  useEffect(() => {
    if (phase === "idle") globalThis.qP(false);
  }, [phase]);
  const close = () => {
    if (terminal) {
      void reset();
      globalThis.qP(false);
    } else void cancel();
  };

  return (
    <ToolWindow id="pack-project" title="Pack Project" width={620} onClose={close}>
      {(phase === "selecting_destination" || phase === "scanning") && (
        <div role="status" aria-live="polite">
          <p>{phase === "selecting_destination" ? "Choose where to create the portable project." : "Checking source files…"}</p>
          <Button size="sm" onClick={() => void cancel()}>Cancel</Button>
        </div>
      )}

      {phase === "awaiting_confirmation" && preview && (
        <>
          <p style={{ marginTop: 0 }}>
            Review what will be copied. Your open project and original data files will not be changed.
          </p>
          <dl className="qzk-ds-meta" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 12px" }}>
            <dt>Project</dt><dd style={{ margin: 0 }}>{preview.projectName}</dd>
            <dt>Destination</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{preview.destination.bundleDir}</dd>
            <dt>Contents</dt><dd style={{ margin: 0 }}>{preview.manifest.summary.datasets} datasets · {preview.manifest.summary.sources} source files · {bytes(preview.manifest.summary.total_bytes)}</dd>
          </dl>
          {preview.destination.exists && (
            <p role="alert" style={{ color: "var(--warn)" }}>A folder already exists at the destination. Packing will refuse to overwrite it.</p>
          )}
          {preview.warnings.length > 0 && (
            <section aria-labelledby="pack-warnings"><h3 id="pack-warnings">Needs attention</h3>
              <ul>{preview.warnings.map((warning, i) => <li key={`${warning.code}-${i}`}>{warning.message}</li>)}</ul>
            </section>
          )}
          <div style={{ maxHeight: 230, overflow: "auto", border: "1px solid var(--border)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Size</th></tr></thead>
              <tbody>{preview.manifest.sources.map((source) => (
                <tr key={source.source_id}>
                  <td title={source.original_path} style={{ overflowWrap: "anywhere" }}>{source.original_path}</td>
                  <td>{source.packable ? (source.changed ? "changed" : source.unverified ? "unverified" : "ready") : statusLabel(source.status)}</td>
                  <td>{source.size === null ? "—" : bytes(source.size)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {preview.blockers.length > 0 && <p className="qzk-ds-meta">{preview.blockers.length} unavailable source{preview.blockers.length === 1 ? "" : "s"} will remain embedded-only or externally linked.</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button size="sm" onClick={() => void start(preview.manifest)} disabled={preview.destination.exists}>Pack Project</Button>
            <Button size="sm" onClick={() => void cancel()}>Cancel</Button>
          </div>
        </>
      )}

      {(phase === "packing" || phase === "cancelling") && (
        <div role="status" aria-live="polite">
          <p>{phase === "cancelling" ? "Stopping safely…" : progress.stage ? `${statusLabel(progress.stage)}…` : "Packing project…"}</p>
          <progress max={Math.max(progress.bytesTotal, 1)} value={progress.bytesCopied} aria-label="Pack project progress" style={{ width: "100%" }} />
          <p className="qzk-ds-meta">{progress.completedCount} of {progress.totalCount} files · {bytes(progress.bytesCopied)} of {bytes(progress.bytesTotal)}</p>
          {progress.currentFile && <p className="qzk-ds-meta" style={{ overflowWrap: "anywhere" }}>{progress.currentFile}</p>}
          <Button size="sm" onClick={() => void cancel()} disabled={phase === "cancelling"}>Cancel</Button>
        </div>
      )}

      {phase === "completed" && <div role="status"><h3>Portable project created</h3><p style={{ overflowWrap: "anywhere" }}>{resultPath}</p><p className="qzk-ds-meta">{NOTHING_MODIFIED_NOTE}</p><Button size="sm" onClick={() => void reset()}>Close</Button></div>}
      {phase === "cancelled" && <div role="status"><h3>Pack cancelled</h3><p>{NOTHING_MODIFIED_NOTE}</p><Button size="sm" onClick={() => void reset()}>Close</Button></div>}
      {phase === "failed" && <div role="alert"><h3>Could not pack project</h3>{errors.map((error, i) => <p key={`${error.code}-${i}`}>{error.message}</p>)}<p className="qzk-ds-meta">{NOTHING_MODIFIED_NOTE}{cleanupOk === false ? " Temporary files could not be fully removed." : ""}</p><div style={{ display: "flex", gap: 8 }}><Button size="sm" onClick={() => void retry()}>Try again</Button><Button size="sm" onClick={() => void reset()}>Close</Button></div></div>}
    </ToolWindow>
  );
}
