// Named range actions (ROW_RANGE_CONTRACT section 5, slice R4a). The state is one
// top-level `namedRanges` list in the app store (undoable, saved in the `.dwk`);
// this module holds its writers and is loaded on demand (the worksheet's
// "Define named range" command, and later the Name box and manager), never at
// first paint. The pure rules (legal names, scope, remaps) are lib/namedRanges.ts.
//
// Every writer records ONE undo step first (`recordHistory` snapshots
// `namedRanges`, store/historySnapshot.ts), so a define, rename, retarget or
// delete, with every link it cut, is one Ctrl+Z. A writer refuses with a reason
// in the status line and changes nothing: it never repairs, clamps or widens.
//
// DEPENDANTS: formulas (`rng()`, R4b), plot views and analysis inputs (R4c) will
// hold a range by id. Each registers a `NamedRangeDependants` consumer here, so a
// delete can list what depends on the range, ask for confirmation, and cut the
// links in the same step. Until one registers, a range has no dependants and a
// delete is immediate. A consumer's cut is what makes it error ("named range
// removed") rather than re-bind to a later range of the same name.

import {
  blockFromSelection,
  describeNamedRange,
  nameClash,
  namedRangeNameRefusal,
  newNamedRangeId,
  targetRefusal,
  type NamedRange,
  type NamedRangeScope,
} from "../lib/namedRanges";
import type { RowRange } from "../lib/rowRange";
import { formulaExtension } from "../lib/formulaExt";
import { renameRangeRefs } from "../lib/rangeRefs";
import { formulaDependants } from "./namedRangeFormulas";
import { useApp, type AppState } from "./useApp";

export interface NamedRangesSlice {
  /** Every named range of the project: top-level, like `savedRois` (saved in the `.dwk`, undoable). */
  namedRanges: NamedRange[];
}

/** One thing that holds a range by id. */
export interface NamedRangeDependant {
  /** "formula column", "plot window", "analysis input" ... */
  kind: string;
  /** Where it is, in words the delete dialog can show. */
  label: string;
}

export interface NamedRangeDependants {
  find: (state: AppState, rangeId: string) => NamedRangeDependant[];
  /** The state patch that cuts every link to `rangeId`; applied in the delete's own undo step. */
  cut: (state: AppState, rangeId: string) => Partial<AppState>;
}

const consumers = new Set<NamedRangeDependants>();

/** A later slice registers what holds a range by id; returns the unregister function. */
export function registerNamedRangeDependants(c: NamedRangeDependants): () => void {
  consumers.add(c);
  return () => void consumers.delete(c);
}

// Formulas that read a range with `rng("Name")` (R4b).
registerNamedRangeDependants(formulaDependants);

/** Everything that depends on range `id`, for the delete dialog. */
export function namedRangeDependants(id: string, state: AppState = useApp.getState()): NamedRangeDependant[] {
  return [...consumers].flatMap((c) => c.find(state, id));
}

export type NamedRangeResult = { ok: true; id: string } | { ok: false; reason: string };

const refuse = (reason: string): NamedRangeResult => {
  useApp.getState().setStatus(`named range: ${reason}`);
  return { ok: false, reason };
};

export interface DefineSpec {
  name: string;
  /** "sheet": the name is visible on the block's sheet. "workbook": on every sheet of its workbook. */
  scope: "sheet" | "workbook";
  datasetId: string;
  cols: number[];
  /** Null = every row. */
  rows: RowRange | null;
}

/** Define a named range. One undo step. Refused (nothing changed) for a bad name or scope, a name already taken within
 *  the workbook, a block that is not on the worksheet, or a workbook scope on a sheet in no workbook. */
export function defineNamedRange(spec: DefineSpec): NamedRangeResult {
  const s = useApp.getState();
  const name = spec.name.trim();
  const nameProblem = namedRangeNameRefusal(name);
  if (nameProblem) return refuse(nameProblem);
  const ds = s.datasets.find((d) => d.id === spec.datasetId);
  if (!ds) return refuse("the worksheet no longer exists");
  let scope: NamedRangeScope;
  if (spec.scope === "sheet") scope = { kind: "sheet", datasetId: ds.id };
  else if (ds.workbookId) scope = { kind: "workbook", workbookId: ds.workbookId };
  else return refuse("this worksheet is in no workbook, so the name can only belong to the sheet");
  const target = { datasetId: ds.id, cols: [...spec.cols], rows: spec.rows ? { from: spec.rows.from, to: spec.rows.to } : null };
  const problem = targetRefusal(scope, target, s.datasets, s.workbooks);
  if (problem) return refuse(problem);
  const clash = nameClash(s.namedRanges, name, scope, s.datasets);
  if (clash) return refuse(`"${clash.name}" is already a named range in this workbook`);
  const id = newNamedRangeId(new Set(s.namedRanges.map((r) => r.id)));
  s.recordHistory("define named range");
  const range: NamedRange = { id, name, scope, target };
  useApp.setState((st) => ({ namedRanges: [...st.namedRanges, range] }));
  useApp.getState().setStatus(`named range "${name}": ${describeNamedRange(range, useApp.getState().datasets)} — Undo removes it`);
  return { ok: true, id };
}

/** "Define named range from selection": the selected columns and the one contiguous block of selected rows. A selection
 *  with gaps is refused with the reason (use Extract rows, or Exclude others). */
export function defineNamedRangeFromSelection(
  datasetId: string,
  selection: { rows: Iterable<number>; cols: Iterable<number> },
  name: string,
  scope: "sheet" | "workbook" = "sheet",
): NamedRangeResult {
  const block = blockFromSelection(selection.rows, selection.cols);
  if ("reason" in block) return refuse(block.reason);
  return defineNamedRange({ name, scope, datasetId, cols: block.cols, rows: block.rows });
}

/** Rename a range. Its id is stable, so nothing that holds it breaks (a consumer that shows the name re-reads it). */
export function renameNamedRange(id: string, name: string): NamedRangeResult {
  const s = useApp.getState();
  const range = s.namedRanges.find((r) => r.id === id);
  if (!range) return refuse("that named range no longer exists");
  const next = name.trim();
  const problem = namedRangeNameRefusal(next);
  if (problem) return refuse(problem);
  if (next === range.name) return { ok: true, id };
  const clash = nameClash(s.namedRanges, next, range.scope, s.datasets, id);
  if (clash) return refuse(`"${clash.name}" is already a named range in this workbook`);
  s.recordHistory("rename named range");
  // A formula reading it shows the new name (its link is by id, so it never breaks).
  useApp.setState((st) => ({ namedRanges: st.namedRanges.map((r) => (r.id === id ? { ...r, name: next } : r)), datasets: renameRangeRefs(st.datasets, id, next).datasets }));
  useApp.getState().setStatus(`renamed named range "${range.name}" to "${next}"`);
  return { ok: true, id };
}

/** Point a range at a new block (same worksheet, or another sheet of its workbook for a workbook-scoped name). Clears
 *  `rowsStale`: choosing the rows again IS keeping them. */
export function retargetNamedRange(id: string, target: { datasetId: string; cols: number[]; rows: RowRange | null }): NamedRangeResult {
  const s = useApp.getState();
  const range = s.namedRanges.find((r) => r.id === id);
  if (!range) return refuse("that named range no longer exists");
  const next = { datasetId: target.datasetId, cols: [...target.cols], rows: target.rows ? { from: target.rows.from, to: target.rows.to } : null };
  // A sheet-scoped name travels with its block's sheet; a workbook-scoped one must stay in its workbook.
  const scope: NamedRangeScope = range.scope.kind === "sheet" ? { kind: "sheet", datasetId: next.datasetId } : range.scope;
  const problem = targetRefusal(scope, next, s.datasets, s.workbooks);
  if (problem) return refuse(problem);
  const moved = { ...range, scope, target: next };
  delete moved.rowsStale;
  const clash = nameClash(s.namedRanges, range.name, scope, s.datasets, id);
  if (clash) return refuse(`"${clash.name}" is already a named range in the destination workbook`);
  s.recordHistory("retarget named range");
  // The formulas reading it are re-evaluated against the new block, and its old and new worksheets touched so readers elsewhere follow.
  useApp.setState((st) => {
    const ranges = st.namedRanges.map((r) => (r.id === id ? moved : r));
    const ext = formulaExtension();
    return { namedRanges: ranges, ...(ext ? { datasets: ext.refreshRangeReaders(st.datasets, ranges, new Set([id])) } : {}) };
  });
  for (const touched of new Set([range.target.datasetId, next.datasetId])) useApp.getState().touchDataset(touched);
  useApp.getState().setStatus(`named range "${range.name}": ${describeNamedRange(moved, useApp.getState().datasets)}`);
  return { ok: true, id };
}

export type RemoveResult =
  | { removed: true; cut: number }
  /** Not removed: the range has dependants and the caller has not confirmed. Show them, then call again with `confirmed`. */
  | { removed: false; dependants: NamedRangeDependant[] }
  | { removed: false; reason: string };

/** Delete a range. With dependants and no `confirmed`, nothing changes and the dependants come back for the dialog.
 *  Confirmed, the range and every link to it go in ONE undo step. */
export function removeNamedRange(id: string, opts?: { confirmed?: boolean }): RemoveResult {
  const s = useApp.getState();
  const range = s.namedRanges.find((r) => r.id === id);
  if (!range) return { removed: false, reason: "that named range no longer exists" };
  const dependants = namedRangeDependants(id, s);
  if (dependants.length > 0 && !opts?.confirmed) return { removed: false, dependants };
  s.recordHistory("delete named range");
  useApp.setState((st) => ({
    ...[...consumers].reduce<Partial<AppState>>((acc, c) => ({ ...acc, ...c.cut({ ...st, ...acc }, id) }), {}),
    namedRanges: st.namedRanges.filter((r) => r.id !== id),
  }));
  const note = dependants.length ? `; ${dependants.length} dependant${dependants.length === 1 ? " was" : "s were"} cut` : "";
  useApp.getState().setStatus(`deleted named range "${range.name}"${note} — Undo restores it`);
  return { removed: true, cut: dependants.length };
}
