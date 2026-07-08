// Local data filter (#53) — state hook. Builds a per-column control descriptor
// for the active dataset (range for continuous columns, a level checklist for
// categorical ones) and writes edits straight to the dataset's `filter` via the
// store. Because analysisData folds filter-failed rows into the analysis view,
// every downstream consumer (Tabulate, Distribution, …) honors the filter with
// no extra wiring. The filter never mutates the dataset's rows.

import { useMemo } from "react";

import { filteredOutRows, isActive } from "../../../lib/datafilter";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import type { ColumnFilter, DataFilter } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface FilterColumn {
  index: number;
  label: string;
  kind: "range" | "set";
  /** Distinct sorted levels (set columns only). */
  levels: number[];
  /** Current predicate for this column (undefined = no constraint). */
  current?: ColumnFilter;
  /** The column's own finite value range (range columns only) — the domain
   *  a RangeSlider clamps into. Ignores the current filter (it's the full
   *  data's range, not the kept subset's). */
  dataMin?: number;
  dataMax?: number;
}

export interface DataFilterState {
  hasData: boolean;
  columns: FilterColumn[];
  kept: number;
  total: number;
  active: boolean;
  setRange: (col: number, min: number | undefined, max: number | undefined) => void;
  toggleLevel: (col: number, value: number) => void;
  clear: () => void;
}

const distinctLevels = (col: number[]): number[] =>
  [...new Set(col.filter((v) => Number.isFinite(v)))].sort((a, b) => a - b);

/** [min, max] of the finite values in `col`, or null if none are finite. */
const dataRange = (col: number[]): [number, number] | null => {
  let min = Infinity;
  let max = -Infinity;
  for (const v of col) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : null;
};

export function useDataFilter(): DataFilterState {
  const active = useActiveDataset();
  const setDatasetFilter = useApp((s) => s.setDatasetFilter);
  const clearDatasetFilter = useApp((s) => s.clearDatasetFilter);

  const filter = active?.filter ?? [];
  const currentOf = (col: number) => filter.find((f) => f.col === col);

  const columns = useMemo<FilterColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    const xRange = dataRange(active.data.time);
    const cols: FilterColumn[] = [
      {
        index: -1,
        label: xName,
        kind: "range",
        levels: [],
        current: currentOf(-1),
        dataMin: xRange?.[0],
        dataMax: xRange?.[1],
      },
    ];
    for (let i = 0; i < active.data.labels.length; i++) {
      const cat = isCategorical(channelModelingType(active, i));
      const colVals = active.data.values.map((r) => r[i]);
      const range = cat ? null : dataRange(colVals);
      cols.push({
        index: i,
        label: active.data.labels[i],
        kind: cat ? "set" : "range",
        levels: cat ? distinctLevels(colVals) : [],
        current: currentOf(i),
        dataMin: range?.[0],
        dataMax: range?.[1],
      });
    }
    return cols;
    // filter is captured via currentOf; recompute when the dataset or filter changes.
  }, [active, filter]);

  const { kept, total } = useMemo(() => {
    const n = active?.data.time.length ?? 0;
    const out = active ? filteredOutRows(active.filter, active.data).size : 0;
    return { kept: n - out, total: n };
  }, [active]);

  /** Replace the whole filter with `next`, dropping inactive predicates. */
  function commit(next: DataFilter): void {
    if (!active) return;
    setDatasetFilter(active.id, next.filter(isActive));
  }

  function setRange(col: number, min: number | undefined, max: number | undefined): void {
    const rest = filter.filter((f) => f.col !== col);
    const pred: ColumnFilter = { col, kind: "range" };
    if (min !== undefined && Number.isFinite(min)) pred.min = min;
    if (max !== undefined && Number.isFinite(max)) pred.max = max;
    commit(isActive(pred) ? [...rest, pred] : rest);
  }

  function toggleLevel(col: number, value: number): void {
    const colDesc = columns.find((c) => c.index === col);
    const levels = colDesc?.levels ?? [];
    const cur = currentOf(col);
    // Start from the current allowed set; default (no predicate) = all levels.
    const allowed = new Set(cur?.kind === "set" && cur.values ? cur.values : levels);
    if (allowed.has(value)) allowed.delete(value);
    else allowed.add(value);
    const rest = filter.filter((f) => f.col !== col);
    // All levels allowed → no constraint (drop the predicate).
    if (allowed.size === 0 || allowed.size === levels.length) {
      commit(rest);
    } else {
      commit([...rest, { col, kind: "set", values: [...allowed].sort((a, b) => a - b) }]);
    }
  }

  function clear(): void {
    if (active) clearDatasetFilter(active.id);
  }

  return {
    hasData: !!active,
    columns,
    kept,
    total,
    active: filter.some(isActive),
    setRange,
    toggleLevel,
    clear,
  };
}
