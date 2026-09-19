// L0.33 (LIBRARY_WORKBOOK_UX_PLAN PR M) — the Reimport All / Reimport
// Available Sources problem report. store/reimportAll.ts owns the entire
// two-phase stage/commit contract; this component only renders
// `reimportAllRows`/`reimportAllBusy`/`reimportAllCommitted` and offers the
// "Reimport Available Sources" follow-up as its OWN button click (never
// triggered automatically by a failed "Reimport All" — see that module's
// doc). The workbook menu's "Reimport All"/"Reimport Available Sources"
// commands already stage + commit in one gesture; this dialog only ever
// becomes visible when that commit made no progress (busy, mid-stage) or
// refused/partially-committed (a required source failed under "all", or
// something was skipped under "available") — a fully clean commit closes
// it (`reimportAllRows: null`) before it has anything to show.
//
// Coordinator review G1: every close path (Escape, backdrop click, the
// Close button) calls `cancelReimportAll()` — never a raw `useApp.setState`
// — so a report closed WHILE staging is still in flight actually cancels
// that stage (bumps the generation) instead of letting it silently resolve,
// reopen, and report `survived: true` to a caller that then chains a commit
// the user already dismissed.

import { useId, useRef } from "react";

import { Button } from "../primitives";
import { useApp } from "../../store/useApp";
import type { ReimportAllOutcome, ReimportAllRow } from "../../store/reimportAll";
import { useDialogFocus } from "./useDialogFocus";
import { useEscapeSurface } from "../../lib/escapeStack";

// Short status words only — the row's own `message` (store/reimportAll.ts)
// carries the full sentence, so this must never restate it verbatim (that
// read as "No source recorded — no source recorded — …" before this fix).
const OUTCOME_LABEL: Record<Exclude<ReimportAllOutcome, "staged">, string> = {
  no_source: "No source",
  missing: "Missing",
  offline: "Offline",
  denied: "No access",
  parse_error: "Failed",
  removed: "Removed",
  changed: "Changed",
  disk_changed: "Changed on disk",
};

function rowLabel(row: ReimportAllRow): string {
  return row.outcome === "staged" ? "Ready" : OUTCOME_LABEL[row.outcome];
}

function rowColor(row: ReimportAllRow): string {
  return row.outcome === "staged" ? "var(--ok, var(--accent))" : "var(--danger, var(--warn))";
}

export default function ReimportAllDialog() {
  const rows = useApp((s) => s.reimportAllRows);
  const busy = useApp((s) => s.reimportAllBusy);
  const committed = useApp((s) => s.reimportAllCommitted);
  const commit = useApp((s) => s.commitReimportAll);
  // Coordinator review G1: the ONLY sanctioned way to close this report —
  // never a raw `useApp.setState`, which cannot bump the generation cell
  // that tells a genuinely in-flight `stageReimportAll` call it was
  // cancelled (store/reimportAll.ts's own doc has the full race).
  const cancel = useApp((s) => s.cancelReimportAll);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const open = rows !== null || busy;

  // Esc closes even when focus isn't inside the dialog. R1 (P3.3): a `modal`
  // surface in `lib/escapeStack.ts` — a true backdrop modal outranks every
  // other registry surface, and the registry is what orders two of these
  // against EACH OTHER, which window-capture could not. Also the
  // coordinator-review G1 discipline above: this must stay `cancel()`, never
  // a raw close, so an in-flight stage is actually cancelled.
  // FIXED 2026-09-19 (BUG-018, P3.3 round 9). Escape now goes through the
  // app's one ordered registry on its `modal` layer, so the innermost open
  // dialog closes and nothing below it acts on the same keystroke. The
  // per-dialog `window`-capture listener this replaces used
  // `stopPropagation()`, which does not stop a same-node, same-phase sibling,
  // so two open dialogs both closed on ONE Escape.
  useEscapeSurface(
    "modal",
    () => {
      cancel();
      return true;
    },
    open,
  );

  // R1: focus-in, Tab trap, restore-to-opener. No per-dialog landing-spot
  // decision needed: while staging (`busy`) the only control is Close, and
  // once rows land the hook's default (first focusable) is still Close or
  // "Reimport Available Sources" in DOM order — both meaningful, no field to
  // prefer over them.
  useDialogFocus(dialogRef, open);

  if (!rows && !busy) return null;

  const staged = rows?.filter((r) => r.outcome === "staged").length ?? 0;
  const failed = (rows?.length ?? 0) - staged;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={cancel}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Reimport All</h2>
        {busy || !rows ? (
          <div className="qzk-ds-meta">staging sources…</div>
        ) : (
          <>
            {failed > 0 &&
              (committed !== null ? (
                // Coordinator review G2: a genuine partial success (some
                // sources committed, some skipped) reads nothing like the
                // outright-refusal banner below — "N of N" here would name
                // the SKIPPED subset as if it were the whole request.
                <div className="qzk-ds-meta">
                  re-imported {committed} source{committed === 1 ? "" : "s"}; {failed} skipped:
                </div>
              ) : (
                <div className="qzk-ds-meta" style={{ color: "var(--danger, #d33)" }}>
                  {failed} of {rows.length} source{rows.length === 1 ? "" : "s"} could not be re-imported — the
                  workbook was left unchanged.
                </div>
              ))}
            <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 4, marginTop: 8 }}>
              {rows.map((row) => (
                <div key={row.datasetId} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>{row.datasetName}</span>
                  <span style={{ color: rowColor(row) }}>
                    {rowLabel(row)}
                    {row.outcome !== "staged" ? ` — ${row.message}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="qz-btn-row">
          <Button onClick={cancel}>Close</Button>
          {!busy && rows && failed > 0 && (
            <Button
              variant="primary"
              disabled={staged === 0}
              title={staged === 0 ? "no source staged cleanly" : undefined}
              onClick={() => void commit("available")}
            >
              Reimport Available Sources
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
