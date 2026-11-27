// Mirror columns, store half (plans/ROW_RANGE_CONTRACT.md section 6; the pure
// half is lib/mirrorColumn.ts): create, Detach and Go to Source. A mirror is a
// `sheet("Src", L)` formula column and persists nothing of its own, so create
// is `addFormula` (one undo step; its cycle, ambiguity and pending-source
// refusals apply unchanged) plus the source's unit, and Detach is the only new
// mutation. Loaded lazily with the worksheet; nothing eager imports it.

import { remapDatasetChannels, type ColumnMove } from "../lib/channelRemap";
import { baseColumns } from "../lib/formula";
import { lit } from "../lib/macro";
import { channelIndexOf, remapSurvivingFormulas } from "../lib/formulaRename";
import { editRefusalNotice, isRederived } from "../lib/rederived";
import { mirrorExpr, mirrorLink, mirrorName, mirrorSourceColumns, mirrorSourceText } from "../lib/mirrorColumn";
import type { Dataset } from "../lib/types";
import { columnRemovalRefsPatch } from "./columnRemovalRefs";
import { withRecomputedFormulas } from "./computedColumns";
import { resolvePendingEdit } from "./pendingEdit";
import { refuseMirrorEdit } from "./mirrorEditRefusal";
import { useApp } from "./useApp";
import { openedWorksheetWindowId, openWorksheet } from "./worksheetOpen";
import { useWorksheetReveal } from "./worksheetReveal";

const get = useApp.getState;

/** A refusal is a status line AND a toast (store/mirrorEditRefusal.ts). */
function refuse(msg: string): false {
  refuseMirrorEdit(msg);
  return false;
}

/** Mirror column `sourceCol` (-1 = X) of worksheet `sourceId` into `id` as a
 *  new column named and united like the source. A text column (a string name)
 *  has no letter for `sheet()` to read and is refused. One undo step. */
export function createMirror(id: string, sourceId: string, sourceCol: number | string): boolean {
  const ds = get().datasets.find((d) => d.id === id);
  const src = get().datasets.find((d) => d.id === sourceId);
  if (!ds || !src) return false;
  if (typeof sourceCol === "string") return refuse("text columns cannot be mirrored");
  if (isRederived(ds)) return refuse(editRefusalNotice(ds));
  if (src.id === ds.id) return refuse("a worksheet cannot mirror its own column — use the column letter");
  if (resolvePendingEdit(get, ds, "adding a mirror column", () => createMirror(id, sourceId, sourceCol))) return true;
  const column = mirrorSourceColumns(src).find((c) => c.col === sourceCol);
  if (!column) return refuse(`worksheet "${src.name}" has no column ${sourceCol + 1}`);
  const expr = mirrorExpr(src.name, column.letter);
  if (!expr) return refuse(`Can't mirror from "${src.name}": a name with both ' and " cannot be written inside sheet("…")`);
  const xName = String(ds.data.metadata?.["x_column_long"] || ds.data.metadata?.["x_column_name"] || "");
  const name = mirrorName(column.label, [...ds.data.labels, xName]);
  if (!get().addFormula(id, name, expr)) return false; // its own refusal is in the status line
  // The source's unit is copied at creation and does not follow later. It joins
  // the column the add just created, so the add stays the ONE undo step.
  if (column.unit) {
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => {
        if (d.id !== id || !d.formulas) return d;
        const formulas = d.formulas.map((f, i) => (i === d.formulas!.length - 1 ? { ...f, unit: column.unit } : f));
        return { ...d, formulas, ...withRecomputedFormulas(baseColumns(d.data, d.formulas.length), formulas) };
      }),
    }));
  }
  get().setStatus(`mirrored ${src.name} > ${column.letter === "x" ? "X" : column.letter} as "${name}" — Go to Source from its header; Undo removes it`);
  return true;
}

/** Detach the mirror at `ds.formulas[index]`: its values become ordinary data.
 *  Computed columns are always the LAST columns, so a detached column that is
 *  not last is a column move from its place to the end of the base columns:
 *  the later formulas' letters, hidden flags, error roles, fit specs, column
 *  properties and every outside holder follow it through the same shift as
 *  Move column. One undo step. */
export function detachMirror(id: string, index: number): void {
  const ds = get().datasets.find((d) => d.id === id);
  const f = ds?.formulas?.[index];
  if (!ds || !f) return;
  if (!mirrorLink(f)) return void get().setStatus(`"${f.name}" is not a mirror column`);
  if (isRederived(ds)) return void get().setStatus(editRefusalNotice(ds));
  if (resolvePendingEdit(get, ds, "detaching a column", () => detachMirror(id, index))) return;
  const baseCount = ds.data.labels.length - ds.formulas!.length;
  const col = baseCount + index;
  const move: ColumnMove = { from: col, to: baseCount };
  get().recordHistory("detach mirror");
  useApp.setState((s) => {
    const next = detached(s.datasets.find((d) => d.id === id)!, index, baseCount, move);
    const datasets = s.datasets.map((d) => (d.id === id ? next : d));
    return { datasets, ...columnRemovalRefsPatch(s, id, move, datasets) };
  });
  get().recordMacro(`Detach mirror "${f.name}" in ${ds.name}`, `qz.detachMirror(${lit(ds.name)}, ${col})`);
  get().touchDataset(id);
  get().setStatus(`detached "${f.name}": now ordinary values — Undo re-links it`);
}

/** `d` with its formula `index` turned into the last base column. */
function detached(d: Dataset, index: number, baseCount: number, move: ColumnMove): Dataset {
  const formulas = d.formulas!;
  const f = formulas[index];
  const base = baseColumns(d.data, formulas.length);
  const col = baseCount + index;
  const withValues = {
    ...base,
    labels: [...base.labels, f.name],
    units: [...base.units, d.data.units[col] ?? f.unit ?? ""],
    values: base.values.map((row, r) => [...row, d.data.values[r]?.[col] ?? Number.NaN]),
  };
  const { formulas: survivors, forcedErrors } = remapSurvivingFormulas(formulas.filter((_, i) => i !== index), move);
  const { data, formulaErrors } = withRecomputedFormulas(withValues, survivors);
  const next: Dataset = {
    ...d,
    formulas: survivors.length ? survivors : undefined,
    data,
    formulaErrors: Object.keys(forcedErrors).length ? { ...formulaErrors, ...forcedErrors } : formulaErrors,
  };
  return { ...next, ...remapDatasetChannels(next, move) };
}

/** Open the mirror's source worksheet and select its column. From a cell
 *  (`row` given) the same row is revealed and selected too. */
export function goToMirrorSource(id: string, index: number, row?: number): void {
  const ds = get().datasets.find((d) => d.id === id);
  const link = ds?.formulas?.[index] && mirrorLink(ds.formulas[index]);
  if (!ds || !link) return;
  const source = link.sourceId === null ? undefined : get().datasets.find((d) => d.id === link.sourceId);
  if (!source) return void refuse(`${mirrorSourceText(link)}: that worksheet was deleted — Detach this column or delete it`);
  const col = link.letter === "x" ? -1 : channelIndexOf(link.letter);
  if (col === null || col >= source.data.labels.length) return void refuse(`${mirrorSourceText(link)}: that column no longer exists`);
  openWorksheet({ datasetId: source.id });
  useWorksheetReveal.getState().requestRowReveal({
    datasetId: source.id,
    row: row ?? -1,
    column: col,
    selectColumn: true,
    select: row !== undefined,
    windowId: openedWorksheetWindowId(source.id), // the source's worksheet window in the window layout
  });
  get().setStatus(`went to ${mirrorSourceText(link)}`);
}
