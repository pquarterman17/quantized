// Average multiple curves as a recordable transform (origin gap audit 2 #9,
// Origin's "Average Multiple Curves"). The `average` op of lib/transformRun:
// N datasets each contribute ONE y column (by name, or each one's first
// numeric column), linearly interpolated onto a common grid by the backend
// (`calc.curve_average`, through the resample guards: no extrapolation, a
// direction reversal refused unless sorting is chosen). The result is one
// linked derived dataset: `<y> mean`, `<y> SD`, `<y> SEM`, `N`, with SEM BOUND
// as the mean's error (so it draws as error bars, weights a fit and exports),
// and SD / N kept in the sheet but off the default plot.
//
// The OTHER datasets are references (`with`, the pipeline's one reference
// model, as merge's / simscompare's are), resolved or refused by name on
// replay. A unit disagreement is refused unless the user acknowledged it.
// Lazy: only the Dataset Math workshop and the transform runner import this.

import { averageCurves } from "./api/curveAverage";
import { blanksToNaN } from "./blankCells";
import type { ErrorBinding } from "./errorRoles";
import type { DatasetRef } from "./transformRun";
import type { TransformWarning, TransformWarningCode } from "./transformWarnings";
import type { DataStruct, Dataset } from "./types";

export type AverageGrid = "union" | "step";

export interface AverageParams {
  op: "average";
  /** The y column (by name) every curve contributes; "" = each one's first. */
  channel: string;
  grid: AverageGrid;
  /** `grid: "step"`: the step over the curves' x overlap (> 0). */
  step?: number;
  /** Sort an x that changes direction (merging loop branches) instead of refusing. */
  sortUnsorted: boolean;
  /** Average despite a unit disagreement between the curves. */
  allowUnitMismatch?: boolean;
  /** The OTHER curves (the primary is the transform's input). */
  with: DatasetRef[];
}

export interface AverageComputed {
  data: DataStruct;
  name: string;
  warnings: TransformWarning[];
  datasetPatch: Partial<Dataset>;
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

/** SEM (column 2) bound as the mean's (column 0) symmetric Y error. */
export const AVERAGE_SEM_BINDING: ErrorBinding = { channel: 2, target: 0, axis: "y", side: "both" };

export function averageGridText(p: Pick<AverageParams, "grid" | "step">): string {
  return p.grid === "step" ? `step ${p.step ?? "?"} over the overlap` : "the union of x";
}

export function averageLabel(p: AverageParams, primaryName: string): string {
  const n = p.with.length + 1;
  return `Average ${p.channel || "first column"} of ${n} datasets (${primaryName}${p.with.length ? ", …" : ""}) on ${averageGridText(p)}`;
}

export function averageOutputName(primaryName: string, n: number, channel: string): string {
  return `${channel ? `${channel} ` : ""}average of ${n} (${stem(primaryName)}, …)`;
}

/** THE compute for the workshop's preview, the commit and the replay:
 *  `curves[0]` is the primary. `preview` asks with a unit mismatch allowed so
 *  the warning can be SHOWN before the user decides. Throws the backend's
 *  refusal message. */
export async function computeAverage(
  p: AverageParams,
  curves: readonly { name: string; data: DataStruct }[],
  opts: { preview?: boolean; signal?: AbortSignal } = {},
): Promise<AverageComputed> {
  const res = await averageCurves(
    {
      curves: curves.map((c) => ({
        name: c.name,
        dataset: {
          time: c.data.time, values: c.data.values, labels: c.data.labels, units: c.data.units,
          metadata: c.data.metadata, cat_levels: c.data.cat_levels, level_order: c.data.level_order,
        },
      })),
      channel: p.channel,
      grid: p.grid,
      ...(p.grid === "step" ? { step: p.step } : {}),
      unsorted: p.sortUnsorted ? "sort" : "refuse",
      allow_unit_mismatch: Boolean(opts.preview || p.allowUnitMismatch),
    },
    opts.signal,
  );
  const warnings = res.warnings.map((w): TransformWarning => ({
    code: w.code as TransformWarningCode,
    text: w.text,
    ...(w.count != null ? { count: w.count } : {}),
    ...(w.columns != null ? { columns: w.columns } : {}),
    ...(w.confirm ? { confirm: true } : {}),
    ...(w.info ? { info: true } : {}),
  }));
  return {
    // A blank SD (one curve at a point) arrives as JSON null; stored as NaN
    // so the .dwk reopens (lib/blankCells.ts).
    data: blanksToNaN(res.dataset),
    name: averageOutputName(curves[0]?.name ?? "", curves.length, p.channel),
    warnings,
    datasetPatch: {
      errorRoles: [AVERAGE_SEM_BINDING],
      columnDesignations: { 0: "Y", 1: "disregard", 2: "Y-error", 3: "disregard" },
    },
  };
}

/** Validate a recorded `average` step (user-editable JSON), or throw. */
export function averageParamsOf(raw: Record<string, unknown>): AverageParams {
  const grid = String(raw.grid ?? "union");
  if (grid !== "union" && grid !== "step") throw new Error(`unknown average grid "${grid}"`);
  const step = raw.step;
  if (grid === "step" && (typeof step !== "number" || !Number.isFinite(step) || step <= 0)) {
    throw new Error('average on a set step needs a positive "step"');
  }
  const w = raw.with ?? [];
  if (!Array.isArray(w) || !w.length) throw new Error('average "with" must list the other datasets');
  const refs = w.map((v) => {
    const o = (v ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) throw new Error("average has a recorded dataset with no id");
    return { id: o.id, name: typeof o.name === "string" ? o.name : o.id };
  });
  return {
    op: "average",
    channel: typeof raw.channel === "string" ? raw.channel : "",
    grid,
    ...(grid === "step" ? { step: step as number } : {}),
    sortUnsorted: raw.sortUnsorted === true,
    ...(raw.allowUnitMismatch === true ? { allowUnitMismatch: true } : {}),
    with: refs,
  };
}
