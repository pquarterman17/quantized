// Shared workbench shell (lane WB): the display parts every previewing tool
// composes with its own input summary (AnalysisInputSummary or the tool's
// summary) and its own parameter fields. State lives in useWorkbenchPreview /
// useWorkbenchCommit / useAnalysisCommit; these are presentation only.
//
// - WorkbenchPreviewFrame: marks a preview as PROVISIONAL ("Preview (not
//   saved)"), says when it is loading, and when it is out of date.
// - OutOfDateNote: the one "Out of date" wording, also used on its own by a
//   tool whose result is not a provisional preview (a recorded fit).
// - WorkbenchMessage: one place for "why it cannot run" (a refusal, from the
//   tool's validation) and "the run failed" (an error, from the backend).
// - WorkbenchActions: Cancel + extra buttons + the commit button, which is
//   disabled WITH its reason (title) rather than silently.
// - WorkbenchProgress: determinate progress (done / total, or a fraction the
//   backend reports) with an optional Stop; indeterminate only when the
//   backend reports no fraction.

import type { ReactNode } from "react";

import { Button } from "../../primitives";

export const PROVISIONAL_LABEL = "Preview (not saved)";

/** The shared "Out of date" marker: a result whose inputs or settings changed
 *  after it was computed. `children` says what changed (a lower-case clause).
 *  A tool whose result is not a provisional preview (a fit already recorded)
 *  uses this on its own; it must also withhold what would commit the result. */
export function OutOfDateNote({ children, block = false }: { children: ReactNode; block?: boolean }) {
  return block
    ? <div className="qzk-helptext qz-wb-preview-stale" role="status" data-stale="true">Out of date: {children}</div>
    : <span className="qz-wb-preview-stale" data-stale="true">Out of date: {children}</span>;
}

export function WorkbenchPreviewFrame({ loading = false, stale = false, children }: {
  loading?: boolean;
  /** The shown preview was computed for inputs that have since changed. */
  stale?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="qz-wb-preview" data-provisional="true" data-stale={stale ? "true" : undefined} aria-label={PROVISIONAL_LABEL}>
      <div className="qz-wb-preview-badge">
        <span className="qz-wb-preview-tag">{PROVISIONAL_LABEL}</span>
        {loading && <span aria-live="polite">Previewing…</span>}
        {stale && !loading && <OutOfDateNote>the inputs changed since this preview.</OutOfDateNote>}
      </div>
      {children}
    </section>
  );
}

/** A refusal (the tool will not run on these inputs) wins over an error
 *  (the run failed); nothing renders when there is neither. */
export function WorkbenchMessage({ refusal, error }: { refusal?: string | null; error?: string | null }) {
  const text = refusal || error;
  if (!text) return null;
  return (
    <p className="qz-error qz-wb-message" role="alert" data-kind={refusal ? "refusal" : "error"}>
      {text}
    </p>
  );
}

export function WorkbenchActions({
  onCancel, cancelLabel = "Cancel", commitLabel, busyLabel, busy, disabledReason, onCommit, children,
}: {
  onCancel?: () => void;
  cancelLabel?: string;
  commitLabel: string;
  busyLabel: string;
  busy: boolean;
  /** Why the commit is unavailable; null/"" when it is enabled. */
  disabledReason: string | null | undefined;
  onCommit: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="qz-dialog-actions">
      {onCancel && <Button onClick={onCancel}>{cancelLabel}</Button>}
      {children}
      <Button variant="primary" disabled={Boolean(disabledReason) || busy} title={disabledReason || undefined} onClick={onCommit}>
        {busy ? busyLabel : commitLabel}
      </Button>
    </div>
  );
}

export type WorkbenchProgressValue =
  | { done: number; total: number; current?: string | null }
  | { fraction: number | null; message?: string | null };

export function WorkbenchProgress({ progress, label, onStop, stopLabel = "Stop after current" }: {
  progress: WorkbenchProgressValue | null;
  /** Accessible name of the progress bar. */
  label: string;
  onStop?: () => void;
  stopLabel?: string;
}) {
  if (!progress) return null;
  const counted = "done" in progress;
  // A job that reports NaN / out of range is shown as indeterminate / clamped.
  const fraction = "done" in progress ? null : Number.isFinite(progress.fraction) ? Math.min(1, Math.max(0, progress.fraction as number)) : null;
  const text = counted
    ? `${progress.done}/${progress.total}${progress.current ? ` — ${progress.current}` : ""}`
    : `${fraction == null ? "" : `${Math.round(fraction * 100)}%`}${progress.message ? ` ${progress.message}` : ""}`.trim();
  const bar = counted
    ? <progress aria-label={label} value={progress.done} max={progress.total} style={{ width: "100%" }} />
    : fraction == null
      ? <progress aria-label={label} style={{ width: "100%" }} />
      : <progress aria-label={label} value={fraction} max={1} style={{ width: "100%" }} />;
  return (
    <div className="qzk-ds-meta qz-wb-progress" aria-live="polite" style={{ marginTop: 8 }}>
      {text}
      {bar}
      {onStop && <Button size="sm" onClick={onStop} style={{ marginTop: 4 }}>{stopLabel}</Button>}
    </div>
  );
}
