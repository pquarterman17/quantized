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

/** Loader for the picked columns of the FULL analysis view of dataset `id`,
 *  finite rows only (null when the dataset is gone). Taken through a selector, so a panel never
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
      const cols = picks.map((p) => (p < 0 ? d.time : d.values.map((row) => row[p])));
      // Rows with a missing value in ANY picked column are dropped together: the
      // routes take plain numbers (a JSON null is a 422), and a fit needs whole points.
      const keep = cols[0].map((_, i) => cols.every((c) => Number.isFinite(c[i])));
      return { columns: cols.map((c) => c.filter((_, i) => keep[i])), data: ds.data };
    },
    [resolve],
  );
}

/** Parse a number field: "" -> null; otherwise the number, NaN when invalid. */
export const parseField = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/** X, Y, Z picks for a parser-flagged 2-D map (an RSM): the two named axes and
 *  the default value channel (Intensity), not the first three columns, which
 *  for an RSM are 2Theta, Omega, Intensity in whatever order the file had.
 *  Null when the dataset is not a map or the names do not resolve. */
export function mapDefaults(ds: Dataset | null): [number, number, number] | null {
  const d = ds?.data;
  if (!d || d.metadata?.["is2D"] !== true) return null;
  const at = (name: unknown): number => (typeof name === "string" ? d.labels.indexOf(name) : -1);
  const dv = d.metadata["default_value_channels"];
  let z = Array.isArray(dv) && typeof dv[0] === "number" ? dv[0] : at("Intensity");
  if (z < 0 || z >= d.labels.length) z = -1;
  const a1 = at(d.metadata["axis1_name"]);
  let a2 = at(d.metadata["axis2_name"]);
  if (a2 < 0) a2 = at("2Theta");
  if (z < 0 || a1 < 0 || a2 < 0 || a1 === a2 || z === a1 || z === a2) return null;
  return [a2, a1, z];
}
