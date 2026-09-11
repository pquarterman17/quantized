// The server-side figure SPEC the Stat Stage exports — the same groups the
// screen drew, restated as a `routes/export_statplots` request.
//
// Extracted from `useStatStage.ts` (Group R) as the second half of funding the
// nested second factor: that hook sits on a hard line pin and this is its
// largest piece that touches no React at all. Pure in / pure out, so every
// branch unit-tests standalone.
//
// It needs no nesting parameter of its own, and that is the point: box/violin/
// strip export is PRE-AGGREGATED (`data: number[][]` + `labels: string[]`), so
// a nested plot exports by handing over the nested groups and their composite
// `lot = 1 / wafer = 3` labels. The number of boxes and what each one is called
// are the only things the backend needs to know.

import type { StatplotFigureSpec } from "../../lib/api/figures";
import type { GroupSpec } from "../../lib/statschooser";
import type { StatMode } from "../../lib/statstage";
import type { DataStruct } from "../../lib/types";

export const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

export const finiteOf = (data: DataStruct, index: number): number[] =>
  colValues(data, index).filter((v) => Number.isFinite(v));

export function buildExportSpec(
  mode: StatMode,
  data: DataStruct,
  groups: GroupSpec[],
  valueCol: number,
  valueLabel: string,
  groupLabel: string,
  dist: string,
  bins: string,
  fit: string | null,
  fmt: string,
  showPoints = false,
  pointRowIndices: number[][] | null = null,
  showMeanCI = false,
  showConnectMeans = false,
): StatplotFigureSpec | null {
  if (mode === "box" || mode === "violin" || mode === "strip") {
    const finiteGroups = groups.filter((g) => g.values.length > 0);
    if (!finiteGroups.length) return null;
    // Violin has neither mark (JMP_GAP J5 is a box/strip feature) — omit
    // rather than send `false`/`null` no-ops on every violin export. Strip's
    // points overlay is always on (no toggle for it -- it's the whole plot),
    // so `show_points` is forced true there regardless of the (box-only)
    // `showPoints` toggle state.
    const marks =
      mode === "violin"
        ? {}
        : {
            show_points: mode === "strip" ? true : showPoints,
            point_row_indices: pointRowIndices,
            show_mean_ci: showMeanCI,
            show_connect_means: showConnectMeans,
          };
    return {
      kind: mode,
      data: finiteGroups.map((g) => g.values),
      labels: finiteGroups.map((g) => g.label),
      fmt,
      title: `${valueLabel} by ${groupLabel}`,
      x_label: groupLabel,
      y_label: valueLabel,
      filename: `${mode}_${valueLabel}`,
      ...marks,
    };
  }
  const values = finiteOf(data, valueCol);
  if (mode === "qq") {
    if (values.length < 3) return null;
    return {
      kind: "qq",
      data: values,
      dist,
      fmt,
      title: `Q-Q — ${valueLabel}`,
      x_label: `Theoretical quantiles (${dist})`,
      y_label: `Sample quantiles (${valueLabel})`,
      filename: `qq_${valueLabel}`,
    };
  }
  if (values.length < 2) return null;
  return {
    kind: "histogram",
    data: values,
    bins,
    fit,
    fmt,
    title: `Histogram — ${valueLabel}`,
    x_label: valueLabel,
    y_label: fit ? "density" : "count",
    filename: `histogram_${valueLabel}`,
  };
}
