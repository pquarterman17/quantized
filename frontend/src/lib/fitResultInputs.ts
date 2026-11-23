// The C9 input record of a curve-fit result (acceptance C9, audit row 35): the
// source, channels, units, the rows the fit consumed and their X range, through
// the shared `recordedInputs` helper. The rows are rebuilt the way the fit
// selects them (lib/analysisInputs.ts, ROW_POLICY.selection: the analysis view,
// narrowed to the spec's recorded rows and its inclusive X range, finite X/Y
// pairs only) and must come to exactly the point count the fit recorded. Absent
// (fail closed, never a guess) for a legacy spec without recorded channels or
// point count, a lazy preview, or rows that no longer rebuild to what the fit
// consumed. Self-contained on purpose: importing the fit-selection module here
// pulled it into the startup preload map.

import type { AnalysisResultValue } from "./analysisResult";
import { recordedInputs } from "./resultInputsRecord";
import { analysisView } from "./rowstate";
import type { Dataset, FitSpec } from "./types";

export function fitResultInputs(dataset: Dataset, spec: FitSpec): AnalysisResultValue | undefined {
  const { xKey, yKey, nPoints } = spec;
  const width = dataset.data.labels.length;
  if (dataset.pending || yKey === undefined || xKey === undefined || nPoints === undefined) return undefined;
  if (yKey < 0 || yKey >= width || (xKey !== null && (xKey < 0 || xKey >= width))) return undefined;
  const view = analysisView(dataset);
  if (!view.data) return undefined;
  const picked = spec.rowIds ? new Set(spec.rowIds) : null;
  const rows: number[] = [];
  view.data.time.forEach((t, index) => {
    const row = view.rowIds ? view.rowIds[index]! : index;
    const x = xKey === null ? t : view.data!.values[index]?.[xKey];
    const y = view.data!.values[index]?.[yKey];
    if (picked && !picked.has(row)) return;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (spec.range && (x < spec.range[0] || x > spec.range[1])) return;
    rows.push(row);
  });
  if (rows.length !== nPoints) return undefined;
  const { data } = dataset;
  return recordedInputs([dataset], { xKey, views: [{ ...data, time: rows.map((r) => data.time[r]!), values: rows.map((r) => data.values[r]!) }] });
}
