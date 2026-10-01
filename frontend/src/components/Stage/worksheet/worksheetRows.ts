import { excludedSet } from "../../../lib/rowstate";
import { asPreviewSourceRows, PREVIEW_SOURCE_ROWS } from "../../../lib/rowSidecars";
import type { Dataset } from "../../../lib/types";
import { textColumnRowCount, worksheetTextColumns } from "./textColumns";

export interface WorksheetRowRules {
  filterCol: string;
  filterOp: string;
  filterV1: string;
  filterV2: string;
  sort: { col: number; dir: 1 | -1 } | null;
}

function passes(v: number | undefined, op: string, a: number, b: number): boolean {
  if (v == null || !Number.isFinite(v)) return false;
  switch (op) {
    case ">": return v > a;
    case ">=": return v >= a;
    case "<": return v < a;
    case "<=": return v <= a;
    case "==": return v === a;
    case "!=": return v !== a;
    case "between": return v >= a && v <= b;
    default: return true;
  }
}

/** The rows the local filter keeps (all rows when it is off). Depends only on
 * the data and the filter rules, so callers can memoise on exactly those. */
export function visibleWorksheetRows(
  data: Dataset["data"],
  pending: Dataset["pending"],
  rules: Omit<WorksheetRowRules, "sort">,
): number[] {
  const textRows = textColumnRowCount(worksheetTextColumns(data, pending));
  const all = Array.from({ length: Math.max(data.time.length, textRows) }, (_, i) => i);
  if (rules.filterCol === "") return all;
  const col = Number(rules.filterCol);
  const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));
  const a = number(rules.filterV1);
  const b = number(rules.filterV2);
  if (Number.isNaN(a) || (rules.filterOp === "between" && Number.isNaN(b))) return all;
  return all.filter((row) => passes(col < 0 ? data.time[row] : data.values[row]?.[col], rules.filterOp, a, b));
}

/** A total order over extracted sort keys (NaN = blank): blanks last in either
 * direction, so cmp(a, b) === -cmp(b, a) for every pair. The old comparator
 * answered 1 for blank-vs-blank both ways, which leaves the order up to the
 * engine's sort internals. */
export function compareSortKeys(a: number, b: number, dir: 1 | -1): number {
  const blankA = Number.isNaN(a);
  const blankB = Number.isNaN(b);
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  return a < b ? -dir : a > b ? dir : 0;
}

/** `visible` in sort order. Each row's key is read from the row-major grid
 * ONCE into a typed array and an index array is sorted against it: the old
 * comparator re-read both keys per comparison (O(n log n) grid reads). Ties
 * keep row order in both directions. */
export function sortWorksheetRows(
  visible: number[],
  data: Dataset["data"],
  sort: WorksheetRowRules["sort"],
): number[] {
  if (!sort) return visible;
  const { col, dir } = sort;
  const keys = new Float64Array(visible.length);
  for (let i = 0; i < visible.length; i++) {
    const v = col < 0 ? data.time[visible[i]] : data.values[visible[i]]?.[col];
    keys[i] = v != null && Number.isFinite(v) ? v : Number.NaN; // ±Inf sorts as blank, as before
  }
  const idx = Uint32Array.from({ length: visible.length }, (_, i) => i);
  idx.sort((i, j) => compareSortKeys(keys[i], keys[j], dir) || i - j);
  return Array.from(idx, (i) => visible[i]);
}

/** `visible` minus the excluded rows (the stats/extract set). */
export function analysisWorksheetRows(visible: number[], excluded: ReadonlySet<number>): number[] {
  return excluded.size ? visible.filter((row) => !excluded.has(row)) : visible;
}

/** Rebuild the worksheet's filter/sort/exclusion view over a newly resolved
 * full Origin book. This must not reuse indices calculated from a sampled
 * preview: those indices describe preview positions, not source rows. */
export function resolveWorksheetRows(source: Dataset, rules: WorksheetRowRules) {
  const visible = visibleWorksheetRows(source.data, source.pending, rules);
  // Built ONCE: rebuilding it per row was O(rows × excluded).
  const analysis = analysisWorksheetRows(visible, excludedSet(source));
  return { visible, analysis, ordered: sortWorksheetRows(visible, source.data, rules.sort) };
}

export function worksheetTsvHeaders(source: Dataset): string[] {
  const { labels, units, metadata } = source.data;
  const xName = String(metadata?.["x_column_name"] ?? "x");
  const xUnit = String(metadata?.["x_column_unit"] ?? "");
  return [
    xUnit ? `${xName} (${xUnit})` : xName,
    ...labels.map((label, channel) => (units[channel] ? `${label} (${units[channel]})` : label)),
  ];
}

/** Translate one displayed preview row to its full-book row. Aligned previews
 * use the same index; sampled/unknown previews require a validated row map. */
export function resolvedSourceRow(source: Dataset, previewRow: number): number | null {
  if (source.pending == null) return previewRow;
  if (source.pending?.previewSampled === false) return previewRow;
  const map = asPreviewSourceRows(
    source.data.metadata?.[PREVIEW_SOURCE_ROWS],
    source.data.time.length,
    source.pending?.rows,
  );
  return map?.[previewRow] ?? null;
}
