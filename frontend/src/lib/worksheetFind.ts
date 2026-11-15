// Worksheet Find / Replace (N4) -- pure. The worksheet grid's numeric cells,
// searched either as TEXT (the cell's full-precision number text contains the
// query) or as a WHOLE CELL (the number equals the query's number; an empty
// whole-cell query finds the missing cells). The result is a list of cell
// addresses in display order; replacing turns it into `CellEdit`s the store's
// `setCellBlock` applies as ONE undo step.
//
// Categorical columns are skipped (their cells hold level codes, not what the
// grid shows); Origin text columns are not in `data` at all.

import { parseCell, type CellEdit } from "./clipboardGrid";
import { isCategoricalChannel } from "./categorical";
import type { DataStruct } from "./types";

export interface FindOptions {
  query: string;
  matchCase: boolean;
  /** The whole cell must equal the query (numerically) instead of containing it. */
  wholeCell: boolean;
  /** Allow a partial-text replace, which rewrites DIGITS inside numbers. Off by
   *  default: find still matches partial text, but replacing it is refused. */
  insideNumbers?: boolean;
}

/** A cell address: original row, column (-1 = the x / time column). */
export interface FindCell {
  row: number;
  col: number;
}

export interface FindScope {
  rows?: ReadonlySet<number> | null;
  cols?: ReadonlySet<number> | null;
}

const cellText = (v: number | undefined): string => (v === undefined || Number.isNaN(v) ? "" : String(v));

/** Every cell matching `opts`, walking `order` (the visible rows, display
 *  order) and, within a row, the x column then the value columns. */
export function findCells(data: DataStruct, opts: FindOptions, order: readonly number[], scope: FindScope = {}): FindCell[] {
  const { query, matchCase, wholeCell } = opts;
  if (query === "" && !wholeCell) return [];
  const target = wholeCell ? parseCell(query) : null;
  if (wholeCell && target === null) return [];
  const needle = matchCase ? query : query.toLowerCase();
  const matches = (v: number | undefined): boolean => {
    if (wholeCell) return Number.isNaN(target) ? v === undefined || Number.isNaN(v) : v === target;
    const text = cellText(v);
    return (matchCase ? text : text.toLowerCase()).includes(needle);
  };
  const out: FindCell[] = [];
  for (const row of order) {
    if (scope.rows && !scope.rows.has(row)) continue;
    if ((!scope.cols || scope.cols.has(-1)) && matches(data.time[row])) out.push({ row, col: -1 });
    const width = data.values[row]?.length ?? data.labels.length;
    for (let col = 0; col < width; col++) {
      if (scope.cols && !scope.cols.has(col)) continue;
      if (isCategoricalChannel(data, col)) continue;
      if (matches(data.values[row]?.[col])) out.push({ row, col });
    }
  }
  return out;
}

export interface ReplaceResult {
  edits: CellEdit[];
  /** Matches whose replaced text is not a number: left unchanged. */
  skipped: number;
  /** Matches in computed (formula) columns: read-only, left unchanged. */
  readOnly: number;
  /** Set when nothing was done at all, and why. */
  error: string | null;
  /** The first change as text, e.g. "-0.1752 → -9.752e16" (for a preview). */
  first: string | null;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Turn `hits` into edits. `writableCols` is the count of non-computed value
 *  columns; hits at or beyond it are counted, not edited. A whole-cell
 *  replacement must itself be a number (blank = missing) -- refused up front;
 *  a text replacement is applied inside the cell's number text and the result
 *  re-read, skipping any cell it would make unreadable. */
export function replaceCells(data: DataStruct, hits: readonly FindCell[], opts: FindOptions, replacement: string, writableCols: number): ReplaceResult {
  const empty = { edits: [], skipped: 0, readOnly: 0, first: null };
  if (!opts.wholeCell && !opts.insideNumbers) {
    return { ...empty, error: "Replacing part of a number would edit its digits. Tick Whole cell to replace values, or Replace inside numbers (edits digits)." };
  }
  const whole = opts.wholeCell ? parseCell(replacement) : null;
  if (opts.wholeCell && whole === null) return { ...empty, error: `"${replacement}" is not a number — nothing was replaced` };
  const re = opts.wholeCell ? null : new RegExp(escapeRe(opts.query), opts.matchCase ? "g" : "gi");
  const edits: CellEdit[] = [];
  let skipped = 0;
  let readOnly = 0;
  let first: string | null = null;
  const note = (from: number | undefined, to: number) => {
    first ??= `${cellText(from) || "(blank)"} → ${Number.isNaN(to) ? "(blank)" : String(to)}`;
  };
  for (const { row, col } of hits) {
    if (col >= writableCols) {
      readOnly++;
      continue;
    }
    if (whole !== null) {
      edits.push({ row, col, value: whole });
      note(col < 0 ? data.time[row] : data.values[row]?.[col], whole);
      continue;
    }
    const current = col < 0 ? data.time[row] : data.values[row]?.[col];
    const value = parseCell(cellText(current).replace(re as RegExp, () => replacement));
    if (value === null) skipped++;
    else {
      edits.push({ row, col, value });
      note(current, value);
    }
  }
  return { edits, skipped, readOnly, error: null, first };
}
