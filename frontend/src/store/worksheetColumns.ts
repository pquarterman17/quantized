// Origin's worksheet column commands — Insert, Add New Column, Delete, Move,
// edit the Long Name / Units / Comments header rows, and the display number
// format — each ONE undo step with a status line. The data half is pure in
// lib/worksheetColumnOps.ts; this file applies it and keeps everything that
// names a column by index pointing at the same column:
//   - this dataset's own index-keyed fields (`remapDatasetChannels`: roles,
//     types, Set As, filter, error bindings, the recorded fit, columnProps);
//   - its computed columns, whose formulas name columns by LETTER
//     (`remapSurvivingFormulas`; a formula reading a deleted column becomes
//     an explicit error, never a silent re-point);
//   - everything outside the dataset — bound plot windows, saved figures and
//     specs, the live view, and other worksheets' `sheet("Name", L)` reads —
//     through the shared column-shift guard `columnRemovalRefsPatch`.
// Computed columns stay LAST (their letters follow the formula order), so an
// insert lands among the base columns and a move never crosses into them. The
// X column (-1) is the row axis here and is never deleted or moved.
// Loaded with the worksheet pane (a lazy chunk), never at first paint.

import { remapDatasetChannels, type ColumnShift } from "../lib/channelRemap";
import { patchColumnProps } from "../lib/columnProps";
import { channelLetter } from "../lib/formula";
import { baseColumns } from "../lib/formulaInputs";
import { lit } from "../lib/macro";
import { remapSurvivingFormulas } from "../lib/formulaRename";
import { isRederived, REDERIVED_EDIT_NOTICE } from "../lib/rederived";
import type { ColumnProps, NumberFormat } from "../lib/columnProps";
import type { Dataset } from "../lib/types";
import {
  applyColumnEdit,
  deleteColumnEdit,
  insertColumnEdit,
  moveColumnEdit,
  newColumnName,
  type ColumnEdit,
} from "../lib/worksheetColumnOps";
import { columnRemovalRefsPatch } from "./columnRemovalRefs";
import { withRecomputedFormulas } from "./computedColumns";
import { resolvePendingEdit } from "./pendingEdit";
import { useApp, type AppState } from "./useApp";

const get = useApp.getState;

/** The dataset, or null after saying why it can't take a structure edit (a
 *  re-derived sheet is rebuilt from its source). Each command then runs the
 *  pending-book guard itself, `resolvePendingEdit` in its own body — the
 *  architecture ratchet checks each writer, not a shared helper. */
function editable(id: string): Dataset | null {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return null;
  if (isRederived(ds)) {
    get().setStatus(REDERIVED_EDIT_NOTICE);
    return null;
  }
  return ds;
}

const formulaCount = (d: Dataset): number => d.formulas?.length ?? 0;
const baseCountOf = (d: Dataset): number => d.data.labels.length - formulaCount(d);
const columnName = (d: Dataset, col: number): string => d.data.labels[col] ?? `column ${col + 1}`;

/** One structure edit applied to dataset `d`: the rebuilt base, the formulas
 *  re-lettered and re-evaluated, and the index-keyed fields remapped. */
function withColumnEdit(d: Dataset, edit: ColumnEdit, label?: string): Dataset {
  const base = applyColumnEdit(baseColumns(d.data, formulaCount(d)), edit, label);
  const { formulas, forcedErrors } = remapSurvivingFormulas(d.formulas ?? [], edit.shift);
  const { data, formulaErrors } = withRecomputedFormulas(base, formulas);
  const errors = Object.keys(forcedErrors).length ? { ...formulaErrors, ...forcedErrors } : formulaErrors;
  return {
    ...d,
    formulas: formulas.length ? formulas : undefined,
    data,
    formulaErrors: errors,
    ...remapDatasetChannels(d, edit.shift),
  };
}

/** Dataset `d` with the computed column at full index `col` removed — the
 *  same rules as `removeFormula` (store/computedColumns.ts). */
function withoutFormula(d: Dataset, col: number): Dataset {
  const index = col - baseCountOf(d);
  const survivors = (d.formulas ?? []).filter((_, i) => i !== index);
  const { formulas, forcedErrors } = remapSurvivingFormulas(survivors, col);
  const { data, formulaErrors } = withRecomputedFormulas(baseColumns(d.data, formulaCount(d)), formulas);
  const errors = Object.keys(forcedErrors).length ? { ...formulaErrors, ...forcedErrors } : formulaErrors;
  return { ...d, formulas: formulas.length ? formulas : undefined, data, formulaErrors: errors, ...remapDatasetChannels(d, col) };
}

/** Commit a sequence of (dataset, shift) steps as ONE store write: each step
 *  replaces dataset `id` and runs the column-shift guard against the state
 *  the previous step produced, so N deletes remap outside references N times
 *  in order, exactly as N separate commands would — under one undo entry. */
function commitSteps(id: string, label: string, steps: ((d: Dataset) => [Dataset, ColumnShift])[]): void {
  get().recordHistory(label);
  useApp.setState((s) => {
    let cur: AppState = s;
    let out: Partial<AppState> = {};
    for (const step of steps) {
      const ds = cur.datasets.find((d) => d.id === id);
      if (!ds) break;
      const [next, shift] = step(ds);
      const datasets = cur.datasets.map((d) => (d.id === id ? next : d));
      const patch = { datasets, ...columnRemovalRefsPatch(cur, id, shift, datasets) };
      out = { ...out, ...patch };
      cur = { ...cur, ...patch };
    }
    return out;
  });
  get().touchDataset(id);
}

/** Insert a blank column at `at` (Origin's Insert: to the LEFT of the
 *  selected column; `at` past the base columns = Add New Column). Returns the
 *  new column's index, or null when refused. */
export function insertColumn(id: string, at: number): number | null {
  const ds = editable(id);
  if (!ds || resolvePendingEdit(get, ds, "inserting a column", () => void insertColumn(id, at))) return null;
  const pos = Math.max(0, Math.min(baseCountOf(ds), at));
  const xName = String(ds.data.metadata?.["x_column_name"] ?? "");
  // Named after the formula letter it will occupy when that name is free, so
  // "C" in a formula means the column headed "C"; else the next free letter.
  const taken = [...ds.data.labels, xName];
  const name = taken.includes(channelLetter(pos)) ? newColumnName(taken) : channelLetter(pos);
  const edit = insertColumnEdit(baseCountOf(ds), pos);
  commitSteps(id, "insert column", [(d) => [withColumnEdit(d, edit, name), edit.shift]]);
  get().setStatus(`inserted column "${name}" — Undo removes it`);
  get().recordMacro(`Insert column "${name}" in ${ds.name}`, `qz.insertColumn(${lit(ds.name)}, ${pos})`);
  return pos;
}

/** Delete columns `cols` (base or computed; -1 is refused). */
export function deleteColumns(id: string, cols: readonly number[]): void {
  const ds = editable(id);
  if (!ds || resolvePendingEdit(get, ds, "deleting columns", () => deleteColumns(id, [...cols]))) return;
  const targets = [...new Set(cols)].filter((c) => c >= 0 && c < ds.data.labels.length).sort((a, b) => b - a);
  if (targets.length === 0) {
    get().setStatus(cols.includes(-1) ? "the X column can't be deleted — Set As X another column first" : "select a column to delete");
    return;
  }
  const names = targets.map((c) => `"${columnName(ds, c)}"`).reverse();
  // Highest first: each later step's indices are still the user's.
  commitSteps(
    id,
    "delete columns",
    targets.map((col) => (d: Dataset): [Dataset, ColumnShift] =>
      col >= baseCountOf(d) ? [withoutFormula(d, col), col] : [withColumnEdit(d, deleteColumnEdit(baseCountOf(d), col)), col],
    ),
  );
  const skippedX = cols.includes(-1) ? " (the X column stays)" : "";
  get().setStatus(`deleted ${names.join(", ")}${skippedX} — Undo restores ${targets.length === 1 ? "it" : "them"}`);
  get().recordMacro(
    `Delete ${targets.length} column(s) from ${ds.name}`,
    `qz.deleteColumns(${lit(ds.name)}, ${lit(targets)})`,
  );
}

/** Move base column `from` to index `to` (Origin's Move Left/Right/First/Last). */
export function moveColumn(id: string, from: number, to: number): void {
  const ds = editable(id);
  if (!ds || resolvePendingEdit(get, ds, "moving a column", () => moveColumn(id, from, to))) return;
  const n = baseCountOf(ds);
  if (from < 0 || from >= n) {
    get().setStatus(
      from < 0 ? "the X column stays first" : "a computed column's place follows its formula order — it can't be moved",
    );
    return;
  }
  const dest = Math.max(0, Math.min(n - 1, to));
  if (dest === from) {
    get().setStatus(`"${columnName(ds, from)}" is already there`);
    return;
  }
  const edit = moveColumnEdit(n, from, dest);
  commitSteps(id, "move column", [(d) => [withColumnEdit(d, edit), edit.shift]]);
  get().setStatus(`moved "${columnName(ds, from)}" to position ${dest + 1}`);
  get().recordMacro(`Move column "${columnName(ds, from)}" in ${ds.name}`, `qz.moveColumn(${lit(ds.name)}, ${from}, ${dest})`);
}

export interface HeaderPatch {
  label?: string;
  unit?: string;
  comment?: string;
}

/** Edit a column's Long Name / Units / Comments header rows in place. A
 *  computed column's name and unit live on its formula, so they go there. */
export function setColumnHeader(id: string, col: number, patch: HeaderPatch): void {
  const ds = editable(id);
  if (!ds || resolvePendingEdit(get, ds, "editing a column header", () => setColumnHeader(id, col, patch))) return;
  if (col < -1 || col >= ds.data.labels.length) return;
  const label = patch.label?.trim();
  const unit = patch.unit?.trim();
  const props: Partial<ColumnProps> | null = patch.comment === undefined ? null : { comment: patch.comment.trim() || undefined };
  const computed = col >= baseCountOf(ds);
  if (computed && (label !== undefined || unit !== undefined)) {
    const index = col - baseCountOf(ds);
    const changed = (label && label !== ds.data.labels[col]) || (unit !== undefined && unit !== (ds.data.units[col] ?? ""));
    if (changed && !get().updateFormula(id, index, { ...(label ? { name: label } : {}), ...(unit !== undefined ? { unit } : {}) })) return;
    if (!props) return;
  }
  // Nothing changed (Apply on an untouched editor): no undo entry, no status.
  const meta = ds.data.metadata ?? {};
  const oldLabel = col < 0 ? String(meta["x_column_long"] || meta["x_column_name"] || "") : ds.data.labels[col];
  const oldUnit = col < 0 ? String(meta["x_column_unit"] ?? "") : (ds.data.units[col] ?? "");
  const sameText = computed || ((!label || label === oldLabel) && (unit === undefined || unit === oldUnit));
  if (sameText && (!props || props.comment === ds.columnProps?.[col]?.comment)) return;
  get().recordHistory("edit column header");
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => {
      if (d.id !== id) return d;
      let data = d.data;
      if (!computed && col >= 0) {
        data = {
          ...data,
          labels: label ? data.labels.map((l, i) => (i === col ? label : l)) : data.labels,
          units: unit !== undefined ? data.units.map((u, i) => (i === col ? unit : u)) : data.units,
        };
      } else if (col < 0) {
        const meta = { ...data.metadata };
        if (label) meta[meta["x_column_long"] ? "x_column_long" : "x_column_name"] = label;
        if (unit !== undefined) meta["x_column_unit"] = unit;
        data = { ...data, metadata: meta };
      }
      return { ...d, data, ...(props ? { columnProps: patchColumnProps(d.columnProps, col, props) } : {}) };
    }),
  }));
  get().touchDataset(id);
  get().setStatus(`updated the header of "${col < 0 ? label || "X" : label || columnName(ds, col)}"`);
}

/** Set Column Values on an existing computed column: its new name and
 *  formula (`updateFormula`'s checks and recalculation), with a status line. */
export function editColumnFormula(id: string, col: number, name: string, expr: string): void {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds) return;
  const index = col - baseCountOf(ds);
  const current = ds.formulas?.[index];
  if (!current) return;
  if (get().updateFormula(id, index, { name, expr })) get().setStatus(`updated the formula of "${name.trim() || current.name}"`);
}

/** Set (or, with `null`, reset to Auto) the display format of `cols`. */
export function setColumnFormat(id: string, cols: readonly number[], format: NumberFormat | null): void {
  const ds = get().datasets.find((d) => d.id === id);
  const targets = cols.filter((c) => ds && c >= -1 && c < ds.data.labels.length);
  if (!ds || targets.length === 0) return;
  get().recordHistory("number format");
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => {
      if (d.id !== id) return d;
      let columnProps = d.columnProps;
      for (const c of targets) columnProps = patchColumnProps(columnProps, c, { format: format ?? undefined });
      return { ...d, columnProps };
    }),
  }));
  const what = format ? `${format.kind === "decimal" ? "decimal places" : format.kind === "sci" ? "scientific" : "significant digits"} (${format.digits})` : "Auto";
  get().setStatus(`number format ${what} on ${targets.length} column${targets.length === 1 ? "" : "s"} — display only`);
}
