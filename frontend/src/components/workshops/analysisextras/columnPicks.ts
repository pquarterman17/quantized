// Shared column-pick plumbing for the analysis-extras panels (surface fit,
// optical gap, ellipse fit; gap audit 5 lane I). Every pick is an index into
// the active dataset: -1 is the X/time axis, 0.. are the value channels (the
// same convention as the outlier / distribution workshops). Data is read through
// the shared input contract (lib/analysisInputs, ROW_POLICY.analysisView:
// excluded / filtered rows never reach a fit) after resolving the FULL dataset, never a large file's small preview.

import { useCallback } from "react";

import { resolveAnalysisInputs, ROW_POLICY } from "../../../lib/analysisInputs";
import type { Dataset, DataStruct } from "../../../lib/types";
import { rowRangeOn } from "../../../store/analysisSelection";
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

/** The picked columns of `d` (-1 = the X/time axis), with every row dropped
 *  that has a missing value in ANY of them: the routes take plain numbers (a
 *  JSON null is a 422), and a fit needs whole points. */
export function finiteColumns(d: DataStruct, picks: readonly number[]): number[][] {
  const cols = picks.map((p) => (p < 0 ? d.time : d.values.map((row) => row[p]!)));
  const keep = cols[0]!.map((_, i) => cols.every((c) => Number.isFinite(c[i])));
  return cols.map((c) => c.filter((_, i) => keep[i]));
}

/** Loader for the picked columns of the FULL analysis view of dataset `id`,
 *  finite rows only. It REJECTS, with a reason a panel can show, when the
 *  worksheet is gone or was replaced while its full data loaded, on a refusal
 *  of the contract (deleted column, no rows left after exclusions and filters)
 *  and when no row is finite in every picked column. A fit never silently does
 *  nothing and never sends an empty series. Taken through a selector, so a
 *  panel never reads the store imperatively in render.
 *
 *  `honourRowRange`: a tool that shows the shared input line (and so says so)
 *  also narrows to the row range set on its worksheet (lib/rowRange); one that
 *  does not show it leaves the range alone, never narrowing silently. */
export function useLoadColumns(honourRowRange = false): (
  id: string,
  picks: readonly number[],
  /** False for a worksheet the tool's input line does not describe (a second curve). */
  ranged?: boolean,
) => Promise<{ columns: number[][]; data: DataStruct }> {
  const resolve = useApp((s) => s.resolveDataset);
  return useCallback(
    async (id, picks, ranged = true) => {
      const ds = await resolve(id);
      if (!ds) throw new Error("The worksheet is no longer available (it was removed or replaced while its full data loaded); nothing was run.");
      const inputs = resolveAnalysisInputs({
        datasets: [ds], activeId: ds.id, yKeys: picks, noX: true, policy: ROW_POLICY.analysisView,
        rowRange: honourRowRange && ranged ? rowRangeOn(ds.id) : null,
      });
      if (!inputs.ok) throw new Error(inputs.reason);
      const columns = finiteColumns(inputs.data, picks);
      if ((columns[0]?.length ?? 0) === 0) {
        throw new Error("No row has a finite value in every picked column (blank or non-numeric cells), so there is nothing to analyse.");
      }
      return { columns, data: ds.data };
    },
    [resolve, honourRowRange],
  );
}

/** Parse a number field: "" -> null; otherwise the number, NaN when invalid. */
export const parseField = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/** A native grid map with no axis names (a gridding result: columns x, y, Intensity): the value
 *  channel is Z and the two other columns, in order, are X and Y. */
function plainMap(d: DataStruct, z: number): [number, number, number] | null {
  if (z < 0) return null;
  const others = d.labels.map((_, i) => i).filter((i) => i !== z);
  return others.length === 2 ? [others[0]!, others[1]!, z] : null;
}

/** X, Y, Z picks for a parser-flagged 2-D map (an RSM): the two named axes and
 *  the default value channel (Intensity), not the first three columns, which
 *  for an RSM are 2Theta, Omega, Intensity in whatever order the file had.
 *  Without axis names (a gridding result) it falls back to the value channel plus the two other
 *  columns in order. Null when the dataset is not a map or nothing resolves. */
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
  if (z < 0 || a1 < 0 || a2 < 0 || a1 === a2 || z === a1 || z === a2) return plainMap(d, z);
  return [a2, a1, z];
}
