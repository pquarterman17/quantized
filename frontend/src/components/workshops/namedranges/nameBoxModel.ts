// The Name box's decisions, pure (ROW_RANGE_CONTRACT 5.5): which named ranges a worksheet can see, what block its
// selection is, whether that block already has a name, and why a new name cannot be given. No store, no React, so the
// component below only wires them.
//
// Rows are SOURCE rows, 0-based (the worksheet's own row numbers), never display positions in a sorted or filtered view.

import { channelLetter } from "../../../lib/formula";
import { blockFromSelection, nameClash, namedRangeNameRefusal, type NamedRange, type NamedRangeScope } from "../../../lib/namedRanges";
import { contiguousRowRange, rowRangeLabel, type RowRange } from "../../../lib/rowRange";
import type { Dataset } from "../../../lib/types";

type Sheet = Pick<Dataset, "id" | "workbookId">;

/** The ranges whose NAME is visible from `ds`: its own sheet-scoped names, and the workbook-scoped names of its workbook. */
export function visibleRanges(ranges: readonly NamedRange[], ds: Sheet): NamedRange[] {
  return ranges.filter((r) => (r.scope.kind === "sheet" ? r.scope.datasetId === ds.id : r.scope.workbookId === ds.workbookId));
}

export interface SelectedBlock {
  /** Channel indices, ascending (-1 is X). */
  cols: number[];
  /** Null = every row (only columns were selected). */
  rows: RowRange | null;
}

export interface BlockInput {
  /** The cell cursor's rectangle, as source rows and channels; null when there is none. */
  cell: { rows: readonly number[]; cols: readonly number[] } | null;
  /** The row selection (source rows) and the column selection. */
  rows: ReadonlySet<number>;
  cols: ReadonlySet<number>;
  /** Value columns on the sheet: a row-only selection covers all of them. */
  width: number;
}

/** What the worksheet selection is as a block: null = nothing is selected; `{ reason }` = it cannot be one block. */
export function selectedBlock(input: BlockInput): SelectedBlock | { reason: string } | null {
  const { cell, rows, cols, width } = input;
  if (cell) {
    return blockFromSelection(cell.rows, cell.cols);
  }
  if (rows.size === 0 && cols.size === 0) return null;
  const colList = cols.size ? [...cols].sort((a, b) => a - b) : Array.from({ length: width }, (_v, i) => i);
  if (colList.length === 0) return { reason: "the worksheet has no columns to name" };
  if (rows.size === 0) return { cols: colList, rows: null };
  const block = contiguousRowRange(rows);
  return "range" in block ? { cols: colList, rows: { from: block.range.from, to: block.range.to } } : { reason: block.reason };
}

const sameCols = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && [...a].sort((x, y) => x - y).every((c, i) => c === [...b].sort((x, y) => x - y)[i]);
const sameRows = (a: RowRange | null, b: RowRange | null): boolean => (a === null ? b === null : b !== null && a.was === undefined && b.was === undefined && a.from === b.from && a.to === b.to);

/** The visible range that names exactly this block on this sheet (a stale range names nothing: its rows lost their meaning). */
export function rangeNamingBlock(block: SelectedBlock, visible: readonly NamedRange[], datasetId: string): NamedRange | undefined {
  return visible.find((r) => r.target.datasetId === datasetId && !r.rowsStale && sameCols(r.target.cols, block.cols) && sameRows(r.target.rows, block.rows));
}

/** The range named `typed` (case-insensitively) among the visible ones. */
export function visibleRangeNamed(typed: string, visible: readonly NamedRange[]): NamedRange | undefined {
  const lower = typed.trim().toLowerCase();
  return lower ? visible.find((r) => r.name.toLowerCase() === lower) : undefined;
}

export type NameBoxPlan =
  | { kind: "idle" }
  /** The typed name is an existing visible range: Enter selects it. */
  | { kind: "go"; range: NamedRange }
  | { kind: "define"; name: string; scope: "sheet" | "workbook" }
  /** Neither: `reason` says why the name cannot be given (empty typed text is `idle`). */
  | { kind: "refused"; reason: string };

/** What Enter (or Define) would do with `typed`, given the selection and the project's ranges. */
export function planNameBox(
  typed: string,
  scope: "sheet" | "workbook",
  block: SelectedBlock | { reason: string } | null,
  ranges: readonly NamedRange[],
  datasets: readonly Pick<Dataset, "id" | "workbookId">[],
  ds: Sheet,
): NameBoxPlan {
  const name = typed.trim();
  if (!name) return { kind: "idle" };
  const existing = visibleRangeNamed(name, visibleRanges(ranges, ds));
  if (existing) return { kind: "go", range: existing };
  const nameProblem = namedRangeNameRefusal(name);
  if (nameProblem) return { kind: "refused", reason: nameProblem };
  if (scope === "workbook" && !ds.workbookId) return { kind: "refused", reason: "this worksheet is in no workbook, so the name can only belong to the sheet" };
  if (block === null) return { kind: "refused", reason: "select the cells to name first" };
  if ("reason" in block) return { kind: "refused", reason: block.reason };
  const at: NamedRangeScope = scope === "workbook" ? { kind: "workbook", workbookId: ds.workbookId! } : { kind: "sheet", datasetId: ds.id };
  const clash = nameClash(ranges, name, at, datasets);
  if (clash) return { kind: "refused", reason: `"${clash.name}" is already a named range in this workbook` };
  return { kind: "define", name, scope };
}

/** "A:B rows 4-10": the selected block in the worksheet's own words (rows 1-based). */
export function describeBlock(block: SelectedBlock): string {
  const letters = block.cols.map((c) => (c < 0 ? "X" : channelLetter(c)));
  const cols = letters.length === 1 ? letters[0] : `${letters[0]}:${letters[letters.length - 1]}`;
  return `${cols} ${block.rows ? rowRangeLabel(block.rows) : "every row"}`;
}
