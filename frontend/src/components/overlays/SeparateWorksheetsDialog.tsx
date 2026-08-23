// Separate dialog UI (LIBRARY_WORKBOOK_UX_PLAN PR J slice 2 — L0.51). The
// store already owns the full preview-before-commit contract (this file's
// only job is to surface it): `previewSeparateWorksheets` (called by the
// invoking action, not from here — see lib/combineSeparateActions.ts) opens
// `separatePreview` (store/workbookSeparate.ts); this component renders that
// plan's affected-item list — what moves, what stays and why (L0.51's "the
// store already computes it") — and calls `commitSeparateWorksheets` on
// confirm, which re-validates liveness and applies EXACTLY the previewed
// plan (never re-derives one of its own).
//
// A stale preview (a previewed worksheet removed by some other gesture
// before commit) is surfaced HONESTLY, not swallowed: `commitSeparateWorksheets`
// already fails closed (returns null, `setStatus` explains why, the preview
// stays open) — this dialog mirrors that exact message inline rather than
// leaving the user to notice a distant status bar, and never pretends the
// commit half-succeeded.

import { useEffect, useState } from "react";

import { Button } from "../primitives";
import { useApp } from "../../store/useApp";

export default function SeparateWorksheetsDialog() {
  const plan = useApp((s) => s.separatePreview);
  const close = useApp((s) => s.closeSeparatePreview);
  const commit = useApp((s) => s.commitSeparateWorksheets);

  const [name, setName] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);

  // Re-seed the name field (and clear any stale error) every time a NEW
  // preview opens — mirrors CombineWorkbooksDialog/SplitDatasetDialog's own
  // re-seed-on-open discipline. Keyed on the plan's requested ids (not
  // object identity — commitSeparateWorksheets replaces separatePreview with
  // `null` on both success and a fresh open still carries a NEW plan object
  // the same requested set could legitimately re-trigger).
  const requestedKey = plan?.requestedWorksheetIds.join(",");
  useEffect(() => {
    setName("");
    setCommitError(null);
  }, [requestedKey]);

  useEffect(() => {
    if (!plan) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [plan, close]);

  if (!plan) return null;

  const canSeparate = plan.movingDatasetIds.length > 0;

  const runSeparate = (): void => {
    if (!canSeparate) return;
    const trimmed = name.trim();
    const newId = commit(trimmed || undefined);
    if (newId) return; // dialog closes itself — separatePreview goes null
    // Fails closed: mirror the store's own explanation (setStatus already
    // ran) instead of silently doing nothing.
    setCommitError(useApp.getState().status);
  };

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSeparate) runSeparate();
          e.stopPropagation();
        }}
      >
        <h2>Separate into new workbook</h2>
        <div className="qz-ws-row">
          <span className="k">Name</span>
          <input
            className="qz-input"
            aria-label="Workbook name"
            placeholder={plan.suggestedName}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {plan.warnings.length > 0 && (
          <div className="qzk-ds-meta" style={{ color: "var(--danger, #d33)" }}>
            {plan.warnings.join("; ")}
          </div>
        )}
        <div className="qzk-ds-meta" style={{ marginTop: 8 }}>
          Affected items:
        </div>
        <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 4 }}>
          {plan.items.length === 0 ? (
            <div className="qzk-ds-meta">nothing to separate</div>
          ) : (
            plan.items.map((item) => (
              <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>
                  <span aria-hidden="true">{item.action === "move" ? "→" : "·"}</span> {item.name}
                </span>
                <span className="qzk-ds-meta">{item.reason}</span>
              </div>
            ))
          )}
        </div>
        {commitError && (
          <div className="qzk-ds-meta" style={{ color: "var(--danger, #d33)", marginTop: 8 }}>
            {commitError}
          </div>
        )}
        <div className="qz-btn-row">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!canSeparate} onClick={runSeparate}>
            Separate
          </Button>
        </div>
      </div>
    </div>
  );
}
