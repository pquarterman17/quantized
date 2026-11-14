// Origin's worksheet column structure edits — Insert, Delete, Move — on a
// dataset's BASE columns (the computed/formula columns already stripped by
// `baseColumns`; the store re-applies the formulas after). Pure: DataStruct
// in, DataStruct out. The store half (one undo step, the formula letters, the
// dataset's index-keyed fields and every outside reference) is
// store/worksheetColumns.ts.
//
// Every edit is described two ways that must agree: a SOURCE LIST (new column
// i takes old column `src[i]`, or is blank when `null`) that rebuilds the data,
// and the lib/channelRemap.ts `ColumnShift` that the rest of the app's
// channel-indexed state follows. Building both from one helper per operation
// is what keeps them in step.
//
// What travels with a column, beyond its numbers: its long name and unit, its
// categorical level table and display order (`cat_levels`/`level_order`), and
// the metadata a parser aligned to the value channels — Origin's short names
// (`origin_column_names`, which its designations and comments are keyed by),
// the descriptive header rows (`label_rows[].cells`), the parser's default
// plotted channels and its declared error pairs. The X column (-1) never moves.

import { type ColumnShift, remapChannel, remapChannelList, remapKeyedRecord } from "./channelRemap";
import type { DataStruct } from "./types";

/** One structure edit: how to rebuild the columns and how indices shift. */
export interface ColumnEdit {
  /** New column i is old column `src[i]`, or a blank column when `null`. */
  src: (number | null)[];
  shift: ColumnShift;
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Insert one blank column at `at` (clamped to 0..n). */
export function insertColumnEdit(n: number, at: number): ColumnEdit {
  const pos = Math.max(0, Math.min(n, Math.trunc(at)));
  const src: (number | null)[] = range(n);
  src.splice(pos, 0, null);
  return { src, shift: { inserted: pos } };
}

/** Delete column `col` (0..n-1). */
export function deleteColumnEdit(n: number, col: number): ColumnEdit {
  return { src: range(n).filter((c) => c !== col), shift: col };
}

/** Move column `from` so it sits at index `to` (both 0..n-1). */
export function moveColumnEdit(n: number, from: number, to: number): ColumnEdit {
  const src = range(n).filter((c) => c !== from);
  src.splice(to, 0, from);
  return { src, shift: { from, to } };
}

/** A short name not already used by the book (Origin keys designations and
 *  comments by short name, so a reused one would inherit a stale entry). */
function freshShortName(taken: ReadonlySet<string>): string {
  for (let i = 0; ; i++) {
    let name = "";
    for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) name = String.fromCharCode(65 + ((k - 1) % 26)) + name;
    if (!taken.has(name)) return name;
  }
}

function keysOf(v: unknown): string[] {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : [];
}

/** The channel-aligned metadata keys, rebuilt for `edit`. Anything else in
 *  `metadata` is file-level or row-indexed and is returned untouched. */
function remapMetadata(meta: Record<string, unknown>, edit: ColumnEdit): Record<string, unknown> {
  const out = { ...meta };
  const names = meta["origin_column_names"];
  if (Array.isArray(names)) {
    const taken = new Set([...names.map(String), ...keysOf(meta["column_designations"]), ...keysOf(meta["column_comments"])]);
    const mapped: unknown[] = [];
    for (const o of edit.src) {
      if (o !== null && o >= names.length) continue; // a column the book never named stays unnamed
      const name = o === null ? freshShortName(taken) : names[o];
      taken.add(String(name));
      mapped.push(name);
    }
    out["origin_column_names"] = mapped;
  }
  const rows = meta["label_rows"];
  if (Array.isArray(rows)) {
    out["label_rows"] = rows.map((r: unknown) => {
      const cells = (r as { cells?: unknown })?.cells;
      if (!Array.isArray(cells)) return r;
      return { ...(r as object), cells: edit.src.map((o) => (o === null ? "" : (cells[o] ?? ""))) };
    });
  }
  const defaults = meta["default_value_channels"];
  if (Array.isArray(defaults) && defaults.every((c) => typeof c === "number")) {
    out["default_value_channels"] = remapChannelList(defaults as number[], edit.shift);
  }
  const roles = meta["error_roles"];
  if (Array.isArray(roles)) {
    out["error_roles"] = roles.flatMap((r: unknown) => {
      const b = r as { channel?: unknown; target?: unknown };
      if (typeof b?.channel !== "number" || typeof b.target !== "number") return [r];
      const channel = remapChannel(b.channel, edit.shift);
      const target = b.target < 0 ? b.target : remapChannel(b.target, edit.shift);
      return channel === null || target === null ? [] : [{ ...(r as object), channel, target }];
    });
  }
  return out;
}

/** Rebuild `base` (no computed columns) for one structure edit. A blank
 *  column is all-NaN, named `label`, with no unit. */
export function applyColumnEdit(base: DataStruct, edit: ColumnEdit, label = ""): DataStruct {
  const pick = <T,>(xs: readonly T[], blank: T): T[] => edit.src.map((o) => (o === null ? blank : (xs[o] ?? blank)));
  const catLevels = remapKeyedRecord(base.cat_levels, edit.shift);
  const levelOrder = remapKeyedRecord(base.level_order, edit.shift);
  const next: DataStruct = {
    ...base,
    labels: pick(base.labels, label),
    units: pick(base.units, ""),
    values: base.values.map((row) => pick(row, Number.NaN)),
    metadata: remapMetadata(base.metadata ?? {}, edit),
  };
  if (catLevels) next.cat_levels = catLevels;
  else delete next.cat_levels;
  if (levelOrder) next.level_order = levelOrder;
  else delete next.level_order;
  return next;
}

/** A name for a new column: the first spreadsheet letter (A, B, …, AA, …)
 *  not already a column name — Origin's own default for Add New Column. */
export function newColumnName(taken: readonly string[]): string {
  return freshShortName(new Set(taken));
}
