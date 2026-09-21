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

/** Rebuild the worksheet's filter/sort/exclusion view over a newly resolved
 * full Origin book. This must not reuse indices calculated from a sampled
 * preview: those indices describe preview positions, not source rows. */
export function resolveWorksheetRows(source: Dataset, rules: WorksheetRowRules) {
  const textRows = textColumnRowCount(worksheetTextColumns(source.data, source.pending));
  const all = Array.from({ length: Math.max(source.data.time.length, textRows) }, (_, i) => i);
  let visible = all;
  if (rules.filterCol !== "") {
    const col = Number(rules.filterCol);
    const number = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));
    const a = number(rules.filterV1);
    const b = number(rules.filterV2);
    if (!Number.isNaN(a) && (rules.filterOp !== "between" || !Number.isNaN(b))) {
      visible = all.filter((row) => passes(
        col < 0 ? source.data.time[row] : source.data.values[row]?.[col],
        rules.filterOp,
        a,
        b,
      ));
    }
  }
  const analysis = visible.filter((row) => !excludedSet(source).has(row));
  if (!rules.sort) return { visible, analysis, ordered: visible };
  const key = (row: number) => (
    rules.sort!.col < 0 ? source.data.time[row] : source.data.values[row]?.[rules.sort!.col]
  );
  const ordered = [...visible].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return (a - b) * rules.sort!.dir;
  });
  return { visible, analysis, ordered };
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
