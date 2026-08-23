// L0.33 (LIBRARY_WORKBOOK_UX_PLAN PR M) — the Reimport All / Reimport
// Available Sources problem report. store/reimportAll.ts owns the entire
// two-phase stage/commit contract; this component only renders
// `reimportAllRows`/`reimportAllBusy` and offers the "Reimport Available
// Sources" follow-up as its OWN button click (never triggered automatically
// by a failed "Reimport All" — see that module's doc). The workbook menu's
// "Reimport All"/"Reimport Available Sources" commands already stage +
// commit in one gesture; this dialog only ever becomes visible when that
// commit made no progress (busy, mid-stage) or refused outright (a required
// source failed under "all") — a clean commit closes it (`reimportAllRows:
// null`) before it has anything to show.

import { useEffect } from "react";

import { Button } from "../primitives";
import { useApp } from "../../store/useApp";
import type { ReimportAllOutcome, ReimportAllRow } from "../../store/reimportAll";

// Short status words only — the row's own `message` (store/reimportAll.ts)
// carries the full sentence, so this must never restate it verbatim (that
// read as "No source recorded — no source recorded — …" before this fix).
const OUTCOME_LABEL: Record<Exclude<ReimportAllOutcome, "staged">, string> = {
  no_source: "No source",
  missing: "Missing",
  offline: "Offline",
  parse_error: "Failed",
  removed: "Removed",
  changed: "Changed",
};

function rowLabel(row: ReimportAllRow): string {
  return row.outcome === "staged" ? "Ready" : OUTCOME_LABEL[row.outcome];
}

function rowColor(row: ReimportAllRow): string {
  return row.outcome === "staged" ? "var(--ok, var(--accent))" : "var(--danger, var(--warn))";
}

// No dedicated `closeReimportAll` action (eager-bundle-size trim, store/
// reimportAll.ts's header) — this is the ONLY place that ever discards the
// report without committing, so a direct `useApp.setState` call is the same
// "standalone dialog writes its own transient UI state" idiom
// store/relink.ts's `commit()` already uses for `datasets` itself.
function closeReport(): void {
  useApp.setState({ reimportAllRows: null, reimportAllBusy: false });
}

export default function ReimportAllDialog() {
  const rows = useApp((s) => s.reimportAllRows);
  const busy = useApp((s) => s.reimportAllBusy);
  const commit = useApp((s) => s.commitReimportAll);

  useEffect(() => {
    if (!rows && !busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeReport();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rows, busy]);

  if (!rows && !busy) return null;

  const staged = rows?.filter((r) => r.outcome === "staged").length ?? 0;
  const failed = (rows?.length ?? 0) - staged;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={closeReport}>
      <div className="qzk-glass qz-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Reimport All</h2>
        {busy || !rows ? (
          <div className="qzk-ds-meta">staging sources…</div>
        ) : (
          <>
            {failed > 0 && (
              <div className="qzk-ds-meta" style={{ color: "var(--danger, #d33)" }}>
                {failed} of {rows.length} source{rows.length === 1 ? "" : "s"} could not be re-imported — the
                workbook was left unchanged.
              </div>
            )}
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
          <Button onClick={closeReport}>Close</Button>
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
