// Shared column-pick plumbing for the analysis-extras panels (surface fit,
// optical gap, ellipse fit; gap audit 5 lane I). Every pick is an index into
// the active dataset: -1 is the X/time axis, 0.. are the value channels (the
// same convention as the outlier / distribution workshops). Data is read through
// lib/rowstate.analysisData (excluded / filtered rows never reach a fit) after
// resolving the FULL dataset, never a large file's small preview.

import { useCallback } from "react";

import { analysisData } from "../../../lib/rowstate";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export interface PickColumn {
  index: number;
  label: string;
}

const meta = (d: DataStruct, key: string): string => String(d.metadata?.[key] ?? "");

/** X axis first (index -1), then every value channel. */
export function pickColumns(ds: Dataset | null): PickColumn[] {
  if (!ds) return [];
  const xName = meta(ds.data, "x_column_name") || "x";
  return [{ index: -1, label: xName }, ...ds.data.labels.map((l, i) => ({ index: i, label: l || `Column ${i + 1}` }))];
}

export const pickOptions = (cols: PickColumn[]): { value: string; label: string }[] =>
  cols.map((c) => ({ value: String(c.index), label: c.label }));

export const pickLabel = (cols: PickColumn[], index: number): string =>
  cols.find((c) => c.index === index)?.label ?? "";

/** Unit of a pick ("" when the dataset declares none). */
export function pickUnit(d: DataStruct, index: number): string {
  return index < 0 ? meta(d, "x_column_unit") : (d.units[index] ?? "");
}

/** Clamp a pick to a column that exists (a dataset swap or a removed column). */
export const validPick = (cols: PickColumn[], index: number, fallback: number): number =>
  cols.some((c) => c.index === index) ? index : fallback;

/** Loader for the picked columns of the FULL analysis view of dataset `id`
 *  (null when the dataset is gone). Taken through a selector, so a panel never
 *  reads the store imperatively in render. */
export function useLoadColumns(): (
  id: string,
  picks: readonly number[],
) => Promise<{ columns: number[][]; data: DataStruct } | null> {
  const resolve = useApp((s) => s.resolveDataset);
  return useCallback(
    async (id, picks) => {
      const ds = await resolve(id);
      if (!ds) return null;
      const d = analysisData(ds) ?? ds.data;
      return { columns: picks.map((p) => (p < 0 ? d.time : d.values.map((row) => row[p]))), data: ds.data };
    },
    [resolve],
  );
}

/** Parse a number field: "" -> null; otherwise the number, NaN when invalid. */
export const parseField = (s: string): number | null => (s.trim() === "" ? null : Number(s));
