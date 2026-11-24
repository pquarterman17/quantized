// Quick Convert: the line under the list once a run has finished (or failed), and
// the progress line while it runs. Announced politely; failures are alerts.

import type { JobView } from "./useConvertJob";
import { plainError, summaryText } from "./quickConvertModel";

export default function ResultSummary({ job }: { job: JobView }) {
  if (job.phase === "idle") return null;
  if (job.phase === "running")
    return (
      <div role="status" aria-live="polite" className="qzk-qc-summary">
        <progress max={1} value={job.progress} aria-label="Conversion progress" /> {job.message || "Converting…"}
      </div>
    );
  if (job.phase === "failed")
    return (
      <p role="alert" className="qzk-qc-summary qzk-qc-danger">
        {plainError(job.error)}
      </p>
    );
  const r = job.result;
  if (!r) return null;
  const bad = r.report.summary.failed > 0 || r.report.summary.partial > 0;
  return (
    <div role="status" aria-live="polite" className="qzk-qc-summary">
      <strong className={bad ? "qzk-qc-warn" : "qzk-qc-ok"}>{r.cancelled ? "Stopped. " : ""}{summaryText(r.report.files)}.</strong>
      {r.report_path && (
        <div className="qzk-qc-dim">
          Report saved as <span className="qzk-qc-mono">{r.report_path}</span>
        </div>
      )}
      {r.report_error && <div className="qzk-qc-warn">{plainError(r.report_error)}</div>}
    </div>
  );
}
