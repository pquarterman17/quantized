// Series comparison for magnetometry (OPEN_ITEMS row 35): overlay several M(T)
// or M(H) worksheets as ONE worksheet with a pair of columns per series
// (X, Y, X, Y ...), every series in the units of the first. Pure.
//
// Decisions (provisional, owner to confirm):
//  * NO resampling or alignment on a common grid. A hysteresis loop is not a
//    function of H, and interpolating a sweep would invent points and
//    uncertainty; each series keeps its own X and its own rows (the analysis
//    view: excluded / filtered-out rows dropped, rows without a finite X and Y
//    dropped and counted). The multi-X "X,Y,X,Y" layout is what the plot,
//    Quick Figure and Origin overlays already draw.
//  * Series are matched by the CHANNEL NAME of the active worksheet's plotted
//    response (the batch convention), against each worksheet's own X axis.
//  * The X axis must be a DECLARED field or temperature, the same kind in every
//    series; the unit conversion is the backend's (`series_unit_plan`).
//  * Committed Y uncertainty is carried, scaled by |factor| (a unit change is
//    exact). X uncertainty is NOT carried, so a worksheet that has it is
//    refused rather than shown with understated bars.

import type { ErrorBinding } from "./errorRoles";
import type { OriginDesignation } from "./columnmeta";
import { detectMagXKind, magXAxis } from "./magDataKind";
import { ownXKey } from "./perSeriesX";
import { columnByName, statsBatchData } from "./statsBatchColumns";
import type { Dataset, DataStruct } from "./types";

export interface CompareYError { values: number[]; side: ErrorBinding["side"]; label: string }

export interface CompareSeries {
  datasetId: string;
  name: string;
  channel: string;
  axis: "field" | "temperature";
  xLabel: string;
  xUnit: string;
  yUnit: string;
  x: number[];
  y: number[];
  yErrors: CompareYError[];
  rowsUsed: number;
  rowsDropped: number;
}

/** What `/series-compare-plan` returns per series (a subset). */
export interface ComparePlan {
  x_unit: string;
  y_unit: string;
  series: { x_factor: number; y_factor: number }[];
}

/** One worksheet's series for `channel` (fail closed: throws the reason). */
export function readCompareSeries(dataset: Dataset, channel: string): CompareSeries {
  const data = statsBatchData(dataset);
  const col = columnByName(data, channel);
  if (col < 0) throw new Error(`"${channel}" is the X axis of "${dataset.name}", not a response channel.`);
  const view = { ...dataset, data };
  const xCol = ownXKey(view, null, col);
  const axisInfo = magXAxis(data, xCol);
  const detected = detectMagXKind(axisInfo.label, axisInfo.unit);
  if (detected.kind === "unknown") {
    throw new Error(`"${dataset.name}": the X axis is not a declared field or temperature (${detected.reason}).`);
  }
  const yUnit = (data.units[col] ?? "").trim();
  if (!yUnit) throw new Error(`"${dataset.name}": the response "${channel}" has no declared unit.`);
  if (!axisInfo.unit.trim()) throw new Error(`"${dataset.name}": the X axis has no declared unit.`);

  const roles = (dataset.errorRoles ?? []).filter((r) => r.channel >= 0 && r.channel < data.labels.length);
  const ownXTarget = (target: number): boolean => (target === -1 ? xCol === null : target === xCol);
  if (roles.some((r) => r.axis === "x" && (ownXTarget(r.target) || r.target === col))) {
    throw new Error(`"${dataset.name}" has X uncertainty, which a comparison does not carry; remove that error binding or compare without it.`);
  }
  const yRoles = roles.filter((r, i, all) => r.axis === "y" && r.target === col &&
    all.findIndex((o) => o.channel === r.channel && o.side === r.side && o.axis === r.axis && o.target === r.target) === i);
  for (const r of yRoles) {
    const u = (data.units[r.channel] ?? "").trim();
    if (u !== "" && u !== yUnit) {
      throw new Error(`"${dataset.name}": the uncertainty column "${data.labels[r.channel]}" is in ${u}, not ${yUnit}; convert it first.`);
    }
  }

  const x: number[] = [];
  const y: number[] = [];
  const errs: number[][] = yRoles.map(() => []);
  data.time.forEach((t0, row) => {
    const values = data.values[row] ?? [];
    const xv = xCol === null ? t0 : (values[xCol] ?? Number.NaN);
    const yv = values[col] ?? Number.NaN;
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) return;
    x.push(xv);
    y.push(yv);
    yRoles.forEach((r, k) => errs[k]!.push(Math.abs(values[r.channel] ?? Number.NaN)));
  });
  if (x.length < 2) throw new Error(`"${dataset.name}": only ${x.length} rows have a finite X and ${channel}.`);
  return {
    datasetId: dataset.id, name: dataset.name, channel, axis: detected.kind, xLabel: axisInfo.label,
    xUnit: axisInfo.unit.trim(), yUnit, x, y,
    yErrors: yRoles.map((r, k) => ({ values: errs[k]!, side: r.side, label: data.labels[r.channel] ?? "uncertainty" })),
    rowsUsed: x.length, rowsDropped: data.time.length - x.length,
  };
}

/** The axis every series shares, or the reason they do not. */
export function sharedAxis(series: readonly CompareSeries[]): "field" | "temperature" {
  const kinds = new Set(series.map((s) => s.axis));
  if (kinds.size !== 1) throw new Error("The worksheets mix field and temperature X axes; an overlay needs the same kind of X in every one.");
  return series[0]!.axis;
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n} (${k})`;
  });
}

export interface CompareWorksheet {
  data: DataStruct;
  errorRoles: ErrorBinding[];
  columnDesignations: Record<number, OriginDesignation>;
}

/** The overlay worksheet: `time` is series 1's X; each later series adds its X
 *  then its Y (then its uncertainty columns). Rows beyond a series' length are
 *  gaps (NaN), never a resampled value. */
export function buildCompareWorksheet(series: readonly CompareSeries[], plan: ComparePlan): CompareWorksheet {
  if (plan.series.length !== series.length) throw new Error("The unit plan does not match the selected worksheets.");
  const names = uniqueNames(series.map((s) => s.name));
  const n = Math.max(...series.map((s) => s.x.length));
  const pad = (v: readonly number[], f: number): number[] => Array.from({ length: n }, (_, i) => (i < v.length ? v[i]! * f : Number.NaN));
  const labels: string[] = [];
  const units: string[] = [];
  const cols: number[][] = [];
  const designations: Record<number, OriginDesignation> = {};
  const errorRoles: ErrorBinding[] = [];
  let time: number[] = [];
  series.forEach((s, i) => {
    const { x_factor: xf, y_factor: yf } = plan.series[i]!;
    if (i === 0) time = pad(s.x, xf);
    else {
      designations[cols.length] = "X";
      labels.push(`${s.xLabel} [${names[i]}]`);
      units.push(plan.x_unit);
      cols.push(pad(s.x, xf));
    }
    const yCol = cols.length;
    designations[yCol] = "Y";
    labels.push(`${s.channel} [${names[i]}]`);
    units.push(plan.y_unit);
    cols.push(pad(s.y, yf));
    for (const e of s.yErrors) {
      designations[cols.length] = "Y-error";
      errorRoles.push({ channel: cols.length, target: yCol, axis: "y", side: e.side });
      labels.push(`${e.label} [${names[i]}]`);
      units.push(plan.y_unit);
      cols.push(pad(e.values, Math.abs(yf)));
    }
  });
  const values = Array.from({ length: n }, (_, r) => cols.map((c) => c[r]!));
  const first = series[0]!;
  return {
    data: {
      time, values, labels, units,
      metadata: {
        x_column_name: first.xLabel, x_column_long: first.xLabel, x_column_unit: plan.x_unit,
        error_roles: errorRoles,
        magnetometry_series_comparison: {
          version: 1, axis: first.axis, x_unit: plan.x_unit, y_unit: plan.y_unit, resampled: false,
          reference: first.name,
          series: series.map((s, i) => ({
            dataset_id: s.datasetId, name: s.name, channel: s.channel,
            from_x_unit: s.xUnit, from_y_unit: s.yUnit,
            x_factor: plan.series[i]!.x_factor, y_factor: plan.series[i]!.y_factor,
            rows_used: s.rowsUsed, rows_dropped: s.rowsDropped, y_uncertainty_columns: s.yErrors.length,
          })),
          uncertainty: "Committed Y uncertainty scaled by the unit factor (exact); X uncertainty not carried.",
        },
      },
    },
    errorRoles, columnDesignations: designations,
  };
}
