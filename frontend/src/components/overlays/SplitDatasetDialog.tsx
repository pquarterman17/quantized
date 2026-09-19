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

import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  autoTolerance,
  columnValues,
  isCategoricalColumn,
  splitColumn,
  tooManyGroups,
  SPLIT_GROUP_CAP,
} from "../../lib/datasetsplit";
import { pickDefaultSplitColumn } from "../../lib/datasetsplitDefault";
import { NumberField } from "../primitives/NumberField";
import { Button, Select } from "../primitives";
import { useApp } from "../../store/useApp";
import { useDialogFocus } from "./useDialogFocus";

export default function SplitDatasetDialog() {
  const targetId = useApp((s) => s.splitDialogTargetId);
  const datasets = useApp((s) => s.datasets);
  const close = useApp((s) => s.closeSplitDialog);
  const splitDatasetByColumn = useApp((s) => s.splitDatasetByColumn);
  const dataset = datasets.find((d) => d.id === targetId);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  const [col, setCol] = useState(0);
  const [toleranceText, setToleranceText] = useState("0");

  // Re-seed the column every time the dialog opens for a (possibly different)
  // dataset — never carry a stale pick from the last time it was open on some
  // other row. The tolerance follows the COLUMN, in the effect below.
  useEffect(() => {
    if (!dataset) return;
    setCol(pickDefaultSplitColumn(dataset));
    // Only re-seed on a genuine open (targetId change), not every dataset edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  // A tolerance is a distance in the CHOSEN COLUMN's own units, so it is
  // meaningless the moment the column changes and has to be re-derived (found
  // in the BUG-008 review round, MEDIUM 5): since the default column is now
  // frequently a categorical one — whose tolerance field is HIDDEN — the seed
  // could be `autoTolerance` over dimensionless level codes, and switching to
  // a physical column then presented that index-scale number as, say, Tesla.
  // Measured before the fix: a field column arrived pre-filled "1 T" (from
  // codes [0,1,2]) and previewed six one-row groups where its own
  // `autoTolerance` of 1.8 previews one group. Re-seeding discards whatever
  // the user typed for the PREVIOUS column, which is correct — that number
  // described a different quantity.
  //
  // NO `col < 0` SPECIAL CASE (round-2 review, HIGH 1 — this fix's own
  // regression). The predecessor effect read `def < 0 ? "0" : ...`, where
  // `def` was `pickDefaultSplitColumn`'s return and `-1` could ONLY mean "this
  // dataset has no channels at all". Here `col` is the USER's pick, and -1 is
  // a first-class option the Select offers ("x (time/axis)"), so carrying that
  // guard over seeded tolerance 0 for a perfectly ordinary continuous x sweep:
  // measured on a PPMS-shaped x (4 setpoints x 5 wobble reads) it previewed 20
  // groups instead of 4, and Confirm was ENABLED, so it committed 20 singleton
  // datasets. `columnValues` already handles -1 (it returns a copy of
  // `data.time`), so the x column needs no special case — it needs the same
  // treatment as any other.
  //
  // Keyed on the column INDEX, not on the column's identity: if the dataset is
  // replaced while the dialog is open and a different quantity lands at the
  // same index, the tolerance stays in the old column's units. Keying on the
  // dataset as well would fix that but re-seed on EVERY edit, wiping a
  // tolerance the user typed while a recalc lands — the worse of the two, so
  // this is a deliberate trade, not an oversight.
  // NARROWED 2026-09-19 (P3.3 round 8). The sentence above is true only over a
  // NON-dialog surface. Two of these backdrop dialogs can be open at once, and
  // `stopPropagation()` does not stop a same-node, same-phase sibling, so BOTH
  // window-capture handlers run on ONE Escape — measured, 2 open dialogs to 0.
  // Tracked as BUG-018 (`plans/BUGS_AND_ISSUES.md`), pinned by
  // `stackedDialogEscape.test.tsx`. Migrating onto `useEscapeSurface` fixes
  // the ladder but is blocked on `escapeStack`'s `isEditingTarget` bail; see
  // the bug entry for that measurement before attempting it again.
  useEffect(() => {
    if (!dataset) return;
    setToleranceText(String(autoTolerance(columnValues(dataset.data, col))));
    // Keyed on the column (and the open), not on every dataset edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, col]);

  // Esc closes even when focus isn't inside the dialog. R1 (P3.3): kept as
  // its own window-capture listener rather than joining `lib/escapeStack.ts`
  // — a true backdrop modal always wins over anything mounted behind it, and
  // window-capture already guarantees that ahead of the registry's window-
  // bubble listener.
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

  // R1: focus-in, Tab trap, restore-to-opener. Landing spot: the Column
  // select — it's the FIRST decision (it also decides whether Tolerance even
  // renders below it), so the hook's default first-focusable is already the
  // meaningful one.
  useDialogFocus(dialogRef, targetId !== null && dataset !== undefined);

  // Derived values + the live-preview memo run UNCONDITIONALLY (same hook
  // count every render) — the "no dataset" case is handled by returning an
  // empty result, not by skipping the hook, so toggling the dialog
  // open/closed across renders of this ALWAYS-MOUNTED component (see
  // AppOverlays.tsx) never changes React's hook call order.
  const categorical = dataset ? isCategoricalColumn(dataset, col) : false;
  const tolerance = Number(toleranceText);
  const validTolerance = Number.isFinite(tolerance) && tolerance >= 0;
  // Non-empty text that fails to parse (or is negative) is a hard error, not
  // a silent "use auto" — the Confirm button is disabled for it below rather
  // than substituting a value the label wouldn't reflect.
  const toleranceInvalid = !categorical && toleranceText.trim() !== "" && !validTolerance;
  // ONE canonical resolved tolerance, fed to BOTH the live preview and the
  // commit call below — they can never disagree (bug: invalid tolerance
  // text used to preview as "auto" but commit as the raw NaN/negative
  // number, since `splitColumn`'s `tolerance ?? autoTolerance(...)` only
  // catches null/undefined, not NaN/negative).
  const resolvedTolerance = categorical || !validTolerance ? undefined : tolerance;
  const result = useMemo(() => {
    if (!dataset) return { groups: [], tolerance: null };
    return splitColumn(dataset, col, resolvedTolerance);
  }, [dataset, col, resolvedTolerance]);

  if (!targetId || !dataset) return null;

  const groups = result.groups;
  const overCap = tooManyGroups(groups);
  const canSplit = groups.length >= 2 && !overCap && !toleranceInvalid;

  const columnOptions = [
    { value: "-1", label: "x (time/axis)" },
    ...dataset.data.labels.map((label, i) => ({ value: String(i), label: label || `column ${i + 1}` })),
  ];

  const runSplit = (): void => {
    if (!canSplit) return;
    void splitDatasetByColumn(targetId, col, resolvedTolerance);
  };

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSplit) runSplit();
          e.stopPropagation();
        }}
      >
        <h2 id={titleId}>Split by column value</h2>
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
              aria-invalid={toleranceInvalid}
              value={toleranceText}
              onChange={setToleranceText}
              unit={col >= 0 ? dataset.data.units[col] : undefined}
            />
            {toleranceInvalid && (
              <span className="qzk-ds-meta" style={{ color: "var(--danger, #d33)" }}>
                enter a number ≥ 0
              </span>
            )}
          </div>
        )}
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, display: "grid", gap: 4 }}>
          {overCap ? (
            <div className="qzk-ds-meta" style={{ color: "var(--danger, #d33)" }}>
              {groups.length} groups detected — too many to split at once (cap {SPLIT_GROUP_CAP}).{" "}
              {/* BUG-008 review, MEDIUM 3: a categorical column has no
                  tolerance field (it is hidden right above), so telling the
                  user to widen one is impossible advice — and this case became
                  reachable exactly when the fix started routing level-table
                  and overridden columns to exact-value grouping. Recovery for
                  a categorical column is fewer levels, i.e. Recode. */}
              {categorical
                ? "Pick a different column, or use Recode… to combine levels first."
                : "Pick a different column, or widen the tolerance."}
            </div>
          ) : groups.length === 0 ? (
            <div className="qzk-ds-meta">No groups detected.</div>
          ) : groups.length === 1 ? (
            <div className="qzk-ds-meta">
              Only one group detected ({groups[0].rowIndexes.length} rows) — nothing to split.
            </div>
          ) : (
            groups.map((g) => (
              // Keyed on the group's VALUE, not its label: labels are display
              // text and need not be unique (a malformed level table with two
              // identical names, or two distinct numbers that format to the
              // same string), while `value` is the distinct grouping key by
              // construction — NaN for the single "(other)" catch-all.
              <div key={String(g.value)} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
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
