// "Split by column value…" dialog (MAIN_PLAN #26). Opened from a
// DatasetRow's context menu or the Analyze-menu/⌘K "Split by column
// value…" command (appCommands.ts) via `useApp.openSplitDialog(id)`, which
// sets `splitDialogTargetId` (store/split.ts). Modal-backdrop convention
// borrowed from ParamDialog/ConfirmDialog, but custom-bodied — neither
// generic dialog fits a column picker + tolerance field + a LIVE preview
// list that recomputes on every keystroke (the plan's discoverability
// requirement: show the detected groups — value -> row count — before
// anything commits). All grouping math is lib/datasetsplit.ts (unit-tested
// there); this file only renders it and calls the store action on confirm.

import { useEffect, useMemo, useState } from "react";

import {
  autoTolerance,
  columnValues,
  isCategoricalColumn,
  pickDefaultSplitColumn,
  splitColumn,
  tooManyGroups,
  SPLIT_GROUP_CAP,
} from "../../lib/datasetsplit";
import { Button, NumberField, Select } from "../primitives";
import { useApp } from "../../store/useApp";

export default function SplitDatasetDialog() {
  const targetId = useApp((s) => s.splitDialogTargetId);
  const datasets = useApp((s) => s.datasets);
  const close = useApp((s) => s.closeSplitDialog);
  const splitDatasetByColumn = useApp((s) => s.splitDatasetByColumn);
  const dataset = datasets.find((d) => d.id === targetId);

  const [col, setCol] = useState(0);
  const [toleranceText, setToleranceText] = useState("0");

  // Re-seed column + tolerance every time the dialog opens for a (possibly
  // different) dataset — never carry a stale pick from the last time it
  // was open on some other row.
  useEffect(() => {
    if (!dataset) return;
    const def = pickDefaultSplitColumn(dataset.data);
    setCol(def);
    setToleranceText(def < 0 ? "0" : String(autoTolerance(columnValues(dataset.data, def))));
    // Only re-seed on a genuine open (targetId change), not every dataset edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  useEffect(() => {
    if (!targetId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [targetId, close]);

  // Derived values + the live-preview memo run UNCONDITIONALLY (same hook
  // count every render) — the "no dataset" case is handled by returning an
  // empty result, not by skipping the hook, so toggling the dialog
  // open/closed across renders of this ALWAYS-MOUNTED component (see
  // AppOverlays.tsx) never changes React's hook call order.
  const categorical = dataset ? isCategoricalColumn(dataset.data, col) : false;
  const tolerance = Number(toleranceText);
  const validTolerance = Number.isFinite(tolerance) && tolerance >= 0;
  const result = useMemo(() => {
    if (!dataset) return { groups: [], tolerance: null };
    return splitColumn(dataset.data, col, categorical || !validTolerance ? undefined : tolerance);
  }, [dataset, col, categorical, tolerance, validTolerance]);

  if (!targetId || !dataset) return null;

  const groups = result.groups;
  const overCap = tooManyGroups(groups);
  const canSplit = groups.length >= 2 && !overCap;

  const columnOptions = [
    { value: "-1", label: "x (time/axis)" },
    ...dataset.data.labels.map((label, i) => ({ value: String(i), label: label || `column ${i + 1}` })),
  ];

  const runSplit = (): void => {
    if (!canSplit) return;
    void splitDatasetByColumn(targetId, col, categorical ? undefined : tolerance);
  };

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSplit) runSplit();
          e.stopPropagation();
        }}
      >
        <h2>Split by column value</h2>
        <div className="qz-ws-row">
          <span className="k">Column</span>
          <Select
            aria-label="Split column"
            options={columnOptions}
            value={String(col)}
            onChange={(e) => setCol(Number(e.target.value))}
          />
        </div>
        {!categorical && (
          <div className="qz-ws-row">
            <span className="k">Tolerance</span>
            <NumberField
              aria-label="Tolerance"
              value={toleranceText}
              onChange={setToleranceText}
              unit={col >= 0 ? dataset.data.units[col] : undefined}
            />
          </div>
        )}
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, display: "grid", gap: 4 }}>
          {overCap ? (
            <div className="qzk-ds-meta" style={{ color: "var(--danger, #d33)" }}>
              {groups.length} groups detected — too many to split at once (cap {SPLIT_GROUP_CAP}). Pick
              a different column, or widen the tolerance.
            </div>
          ) : groups.length === 0 ? (
            <div className="qzk-ds-meta">No groups detected.</div>
          ) : groups.length === 1 ? (
            <div className="qzk-ds-meta">
              Only one group detected ({groups[0].rowIndexes.length} rows) — nothing to split.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{g.label}</span>
                <span className="qzk-ds-meta">{g.rowIndexes.length} rows</span>
              </div>
            ))
          )}
        </div>
        <div className="qz-btn-row">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!canSplit} onClick={runSplit}>
            Split into {groups.length} datasets
          </Button>
        </div>
      </div>
    </div>
  );
}
