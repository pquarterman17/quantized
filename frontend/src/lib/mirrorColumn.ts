// Mirror columns (plans/ROW_RANGE_CONTRACT.md section 6, decision D11): the
// column Origin calls a linked column. A mirror is NOT a new column kind and
// persists NOTHING of its own: it is a computed column whose entire formula is
// one `sheet("Src", L)` call with exactly one resolved binding. Typing that
// formula by hand gives the same column, and a release that has never heard of
// mirrors still opens it as a working, read-only `sheet()` column.
//
// This module is the PURE half — recognition, the derived link status, the
// edit-refusal sentence and the create-time naming. The store half
// (store/mirrorColumn.ts) creates, detaches and navigates; the header badge
// and menus read `mirrorStatus`. Recalculation is unchanged and is the point:
// `sheetIdsRead` already draws `ds:source -> ds:mirror` (lib/recalc.ts), and
// `linkSheets` refuses a mirror cycle at link time with the path.

import { channelLetter } from "./formula";
import { REMOVED_COLUMN } from "./sheetRefs";
import { channelIndexOf } from "./formulaRename";
import type { ComputedColumn, Dataset } from "./types";

/** `sheet("Name", L)` as the WHOLE expression. Stricter than "anything between
 *  two quotes": a name cannot contain its own quote, so
 *  `sheet("A", C) + sheet("A", D)` (one binding, two calls) is not a mirror. */
const MIRROR_SHAPE = /^\s*sheet\(\s*(?:"([^"]*)"|'([^']*)')\s*,\s*(\w+)\s*\)\s*$/;

export interface MirrorLink {
  /** The source worksheet's name as the formula text shows it. */
  sourceName: string;
  /** The source column letter (`x` for its X column, `__removed__` once the column was deleted). */
  letter: string;
  /** The linked worksheet's id; null once that worksheet was deleted. */
  sourceId: string | null;
}

/** The link a mirror column holds, or null when `f` is an ordinary column. */
export function mirrorLink(f: ComputedColumn): MirrorLink | null {
  if (f.sheets?.length !== 1 || f.recode || f.factor) return null;
  const m = MIRROR_SHAPE.exec(f.expr);
  if (!m) return null;
  const sourceName = m[1] ?? m[2];
  // The binding must be the one this call names (never trust the text alone).
  return sourceName === f.sheets[0].name ? { sourceName, letter: m[3], sourceId: f.sheets[0].id } : null;
}

export const isMirror = (f: ComputedColumn): boolean => mirrorLink(f) !== null;

/** Index in `ds.formulas` of the mirror at full column `col`, or -1. */
export function mirrorIndexAt(ds: Dataset, col: number): number {
  const index = col - (ds.data.labels.length - (ds.formulas?.length ?? 0));
  const f = ds.formulas?.[index];
  return f && index >= 0 && isMirror(f) ? index : -1;
}

/** `Run 2 > C`: how a mirror's source is named to the user. */
export const mirrorSourceText = (link: MirrorLink): string => `${link.sourceName} > ${link.letter === "x" ? "X" : link.letter}`;

export type MirrorState = "linked" | "loading" | "missing" | "removed" | "broken";

export interface MirrorStatus {
  state: MirrorState;
  /** The badge text: Linked / Source loading / Missing / Column removed / Broken. */
  label: string;
  /** The tooltip sentence (the reason, for anything but Linked). */
  detail: string;
  /** "source has 120 rows, this sheet 100: ..." when the lengths differ. */
  rowNote: string | null;
  /** The source worksheet, when it still exists. */
  sourceId: string | null;
  /** The source column's index (-1 = X), or null when it has none. */
  sourceCol: number | null;
}

const rowRun = (from: number, to: number): string => (from === to ? `row ${from}` : `rows ${from}-${to}`);

/** The row-count difference between a mirror's sheet and its source, as the
 *  header words it, or null when they match. `sheet()` pairs row i with row i:
 *  rows past the source's last are blank, rows past this sheet's are unseen. */
export function mirrorRowNote(sourceRows: number, ownRows: number): string | null {
  if (sourceRows === ownRows) return null;
  const head = `source has ${sourceRows} rows, this sheet ${ownRows}`;
  return sourceRows > ownRows
    ? `${head}: ${rowRun(ownRows + 1, sourceRows)} ${sourceRows - ownRows === 1 ? "is" : "are"} not mirrored`
    : `${head}: ${rowRun(sourceRows + 1, ownRows)} ${ownRows - sourceRows === 1 ? "is" : "are"} blank`;
}

/** The link status of the mirror at `ds.formulas[index]`, derived on every
 *  read and never persisted (contract 6.3), or null for an ordinary column. */
export function mirrorStatus(ds: Dataset, index: number, datasets: readonly Dataset[]): MirrorStatus | null {
  const f = ds.formulas?.[index];
  const link = f && mirrorLink(f);
  if (!f || !link) return null;
  const source = link.sourceId === null ? undefined : datasets.find((d) => d.id === link.sourceId);
  const at = (state: MirrorState, label: string, detail: string): MirrorStatus => ({ state, label, detail, rowNote: null, sourceId: source?.id ?? null, sourceCol: null });
  if (!source) return at("missing", "Missing", `worksheet "${link.sourceName}" was deleted, so this column has nothing to read — Detach it or delete it`);
  if (link.letter === REMOVED_COLUMN) return at("removed", "Column removed", `the column this read in "${source.name}" was deleted`);
  if (source.pending) return at("loading", "Source loading", `"${source.name}" has not loaded its full data yet`);
  const error = ds.formulaErrors?.[f.name];
  if (error) return at("broken", "Broken", error);
  const sourceCol = link.letter === "x" ? -1 : channelIndexOf(link.letter);
  const rowNote = mirrorRowNote(source.data.time.length, ds.data.time.length);
  return {
    state: "linked",
    label: "Linked",
    detail: `follows ${mirrorSourceText(link)}${rowNote ? ` (${rowNote})` : ""}`,
    rowNote,
    sourceId: source.id,
    sourceCol,
  };
}

/** Why a cell of the mirror column at full index `col` cannot be edited, or
 *  null when it is not a mirror. Origin ignores a reverse edit silently; this
 *  names the way out (contract 6.4). */
export function mirrorEditReason(ds: Dataset, col: number): string | null {
  const index = mirrorIndexAt(ds, col);
  const f = ds.formulas?.[index];
  const link = f && mirrorLink(f);
  if (!f || !link) return null;
  return link.sourceId === null
    ? `${f.name} (mirror) lost its source ${link.sourceName}: Detach to make it ordinary values`
    : `${f.name} (mirror) follows ${mirrorSourceText(link)}: edit it there (Go to Source), or Detach to make it ordinary values`;
}

/** Why a block operation (clear, cut, fill, paste) aimed at `cols` cannot run,
 *  when EVERY targeted column is computed and one of them is a mirror; else
 *  null. A block that also reaches a writable column proceeds and skips the
 *  computed ones, exactly as it does for any computed column. */
export function mirrorBlockReason(ds: Dataset, cols: readonly number[], baseCount: number): string | null {
  if (cols.length === 0 || cols.some((c) => c < baseCount)) return null;
  for (const c of cols) {
    const why = mirrorEditReason(ds, c);
    if (why) return why;
  }
  return null;
}

/** One column of a worksheet a mirror can read: its X, or a numeric channel. */
export interface MirrorSourceColumn {
  /** -1 for the worksheet's X column. */
  col: number;
  letter: string;
  label: string;
  unit: string;
}

/** The numeric columns of `src` a mirror can read (X, then every channel). A
 *  text sidecar column has no letter, so `sheet()` cannot name it. */
export function mirrorSourceColumns(src: Dataset): MirrorSourceColumn[] {
  const meta = src.data.metadata ?? {};
  const x: MirrorSourceColumn = {
    col: -1,
    letter: "x",
    label: String(meta["x_column_long"] || meta["x_column_name"] || "X"),
    unit: String(meta["x_column_unit"] ?? ""),
  };
  return [x, ...src.data.labels.map((label, col) => ({ col, letter: channelLetter(col), label, unit: src.data.units[col] ?? "" }))];
}

/** `sheet("Name", L)` for the mirror formula, or null when the name holds both
 *  quote kinds (it cannot be written inside the call in either). */
export function mirrorExpr(sourceName: string, letter: string): string | null {
  const q = !sourceName.includes('"') ? '"' : !sourceName.includes("'") ? "'" : null;
  return q ? `sheet(${q}${sourceName}${q}, ${letter})` : null;
}

/** A column name not yet used on the mirror's sheet: the source's own long name,
 *  else "<name> (mirror)", else "<name> (mirror 2)" and so on. */
export function mirrorName(label: string, taken: readonly string[]): string {
  if (!taken.includes(label)) return label;
  for (let i = 1; ; i++) {
    const name = `${label} (mirror${i > 1 ? ` ${i}` : ""})`;
    if (!taken.includes(name)) return name;
  }
}
