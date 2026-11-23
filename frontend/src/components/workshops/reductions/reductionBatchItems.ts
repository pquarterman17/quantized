// Per-worksheet runs for the reductions batch (lane BY3): FFT film thickness,
// reflectivity FFT and Pawley, each over the worksheets selected in the
// Library through StatsBatchSection.
//
// What a worksheet means (decided, fail closed):
//  * its scan is the worksheet's ANALYSIS VIEW (excluded and filtered-out rows
//    dropped, exactly what the single run reads) with its X axis as 2θ / Q, and
//    its intensity / reflectivity is the column with the panel's channel NAME
//    (lib/statsBatchColumns: missing or duplicated is an error row);
//  * every setting (wavelength, window, range, preprocessing, cell, tie,
//    centering, profile width, refine flag) is the panel's, the same for every
//    worksheet. Thickness and cell both scale with lambda, so a worksheet whose
//    file records a DIFFERENT wavelength is an error row, never silently run
//    with the panel's;
//  * an FFT-thickness worksheet whose x is not 2θ in degrees, a Reflectivity FFT
//    x range typed in another x unit than the worksheet's, a Q-versus-2θ mismatch between the panel's mode and the worksheet's own
//    axis, and a Pawley worksheet whose x is not 2θ in degrees, are error rows.
// The request bodies are the single run's own (reductionRequests, pawleyBody).

import { dropGapRows } from "../../../lib/api/finitePairs";
import { pawleyRefine, fftThickness, reflectivityFft } from "../../../lib/api/reductions";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { PawleyResult } from "../../../lib/reductionTypes";
import { xAxisIsTwoThetaDegrees, xChannelIdentity } from "../../../lib/peakTableFit";
import { columnByName, statsBatchData } from "../../../lib/statsBatchColumns";
import type { DataStruct, Dataset } from "../../../lib/types";
import { wavelengthFromMetadata } from "../../../lib/xrdWavelength";
import type { AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import {
  type FftThicknessSettings, type ReflectivityFftSettings,
  fftThicknessBody, gapProblem, reflectivityFftBody, unitOf, xIsQ,
} from "./reductionRequests";
import type { PawleyModelInput } from "./pawleyModelOutput";
import {
  PAWLEY_MAX_POINTS, type PawleyRunSettings, pawleyAxisProblem, pawleyBody, pawleyVerdict, scanRange,
} from "./pawleyInputs";

export const FFT_THICKNESS_BATCH_HEADERS = ["Thickness (nm)", "Uncertainty (nm)", "Points used"] as const;
export const REFLECTIVITY_FFT_BATCH_HEADERS = [
  "Thickness (nm)", "Peaks", "All thicknesses (nm)", "Superlattice period (nm)",
] as const;
export const PAWLEY_BATCH_HEADERS = ["a (Å)", "b (Å)", "c (Å)", "Rwp", "Rwp (background only)", "Reflections"] as const;

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A worksheet's analysis view and the index of its intensity channel. */
function readScan(dataset: Dataset, channel: string): { data: DataStruct; col: number } {
  const data = statsBatchData(dataset);
  const col = columnByName(data, channel);
  if (col < 0) throw new Error(`"${channel}" is the X axis of this worksheet, not an intensity channel.`);
  return { data, col };
}

/** Why this worksheet's own recorded wavelength rules out the panel's, or null
 *  (a file that records none is run with the panel's, as the single run does). */
export function wavelengthProblem(data: DataStruct, wavelength: number): string | null {
  const measured = wavelengthFromMetadata(data.metadata);
  if (measured == null || Math.abs(measured - wavelength) <= 1e-4) return null;
  return `this worksheet records a wavelength of ${measured} Å but the batch uses ${wavelength} Å; run it on its own or batch only worksheets measured with one wavelength.`;
}

export async function fftThicknessBatchItem(
  dataset: Dataset, channel: string, s: FftThicknessSettings,
): Promise<AnalysisBatchOutcome> {
  const { data, col } = readScan(dataset, channel);
  const axis = xChannelIdentity(data, null);
  if (!xAxisIsTwoThetaDegrees(axis)) {
    throw new Error(`the x axis is ${axis.xLabel || "unlabeled"} (${axis.xUnit || "no unit recorded"}), not 2θ in degrees.`);
  }
  const problem = wavelengthProblem(data, s.wavelength);
  if (problem) throw new Error(problem);
  // Same refusal as the single run (#907): a gappy scan is not resampled or dropped.
  const gap = gapProblem(data, col);
  if (gap) throw new Error(gap);
  const r = await fftThickness(fftThicknessBody(data, col, s));
  return {
    values: [num(r.thickness_nm), num(r.uncertainty_nm), r.n_points],
    warnings: r.uncertainty_nm == null ? ["Uncertainty: the FFT peak width could not be bracketed."] : [],
  };
}

export async function reflectivityFftBatchItem(
  dataset: Dataset, channel: string, s: ReflectivityFftSettings, rangeUnit: string,
): Promise<AnalysisBatchOutcome> {
  const { data, col } = readScan(dataset, channel);
  if (xIsQ(data) !== s.isNeutron) {
    throw new Error(`this worksheet's x axis reads as ${xIsQ(data) ? "Q (neutron)" : "2θ (X-ray)"} but the batch is set to ${s.isNeutron ? "Q (neutron)" : "2θ (X-ray)"}.`);
  }
  // The panel's x range was typed in the PANEL worksheet's x unit; another
  // unit (nm-1 versus 1/Å) would silently rescale the window.
  if ((s.xMin != null || s.xMax != null) && unitOf(data).trim() !== rangeUnit.trim()) {
    throw new Error(`the x range was set in "${rangeUnit || "no unit"}" but this worksheet's x unit is "${unitOf(data).trim() || "no unit"}".`);
  }
  if (!s.isNeutron) {
    const problem = wavelengthProblem(data, s.wavelength);
    if (problem) throw new Error(problem);
  }
  const gap = gapProblem(data, col);
  if (gap) throw new Error(gap);
  const r = await reflectivityFft(reflectivityFftBody(data, col, s));
  const t = r.thicknesses_nm.filter((v) => Number.isFinite(v));
  return {
    values: [
      t[0] ?? null, t.length, t.map((v) => Number(v.toPrecision(4))).join(", ") || null,
      r.superlattice.detected ? num(r.superlattice.bilayer_period_nm) : null,
    ],
    warnings: t.length === 0 ? ["No thickness peak was found."] : [],
  };
}

/** What a Pawley batch row keeps so "Create model worksheets" can write its
 *  observed / model / background / residual worksheet without refitting. */
export interface PawleyBatchModel {
  result: PawleyResult;
  input: PawleyModelInput;
  /** The worksheet's analysis-view fingerprint when the row ran (the commit's out-of-date stamp). */
  computedOn: string;
}

export async function pawleyBatchItem(
  dataset: Dataset, channel: string, s: PawleyRunSettings,
  onModel?: (datasetId: string, model: PawleyBatchModel | null) => void,
): Promise<AnalysisBatchOutcome> {
  onModel?.(dataset.id, null); // a failing row must not keep an earlier run's model
  const { data, col } = readScan(dataset, channel);
  const pairs = dropGapRows(data.time, data.values.map((row) => row[col]));
  if (pairs.keep.length < 3) throw new Error("Pawley refinement needs at least 3 finite points.");
  if (pairs.keep.length > PAWLEY_MAX_POINTS) {
    throw new Error(`the scan has ${pairs.keep.length} points; the limit is ${PAWLEY_MAX_POINTS}`);
  }
  const range = scanRange(pairs.x);
  const axis = pawleyAxisProblem(xChannelIdentity(data, null), data.metadata, range);
  if (axis) throw new Error(axis);
  if (!(range.max > range.min)) throw new Error("The scan covers a single 2θ value.");
  const problem = wavelengthProblem(data, s.n.wavelength);
  if (problem) throw new Error(problem);
  const r = await pawleyRefine(pawleyBody(pairs.x, pairs.y, range, s));
  const verdict = pawleyVerdict(r, s.refineCell);
  const len = pairs.x.length;
  // The row's numbers stand either way; only a model that does not line up with
  // the observed points is not kept (the model list then says so for the row).
  if (onModel && r.model.length === len && r.residual.length === len && r.background.length === len) {
    const measured: Record<string, unknown> = {};
    for (const k of ["wavelength_a", "alpha_average"] as const) {
      if (dataset.data.metadata?.[k] != null) measured[k] = dataset.data.metadata[k];
    }
    onModel(dataset.id, {
      result: r, computedOn: analysisDataFingerprint(dataset),
      input: {
        x: pairs.x, y: pairs.y, range, sourceId: dataset.id, sourceName: dataset.name, col, tie: s.tie,
        label: data.labels[col] || "Observed", unit: data.units[col] || "",
        xLabel: xChannelIdentity(data, null).xLabel, symmetry: s.symmetry, wavelength: s.n.wavelength,
        profileFwhm: s.n.fwhm, refineCell: s.refineCell, startCellFrom: null, measured,
      },
    });
  }
  return {
    values: [num(r.cell[0]), num(r.cell[1]), num(r.cell[2]), num(r.rwp), num(r.rwp_background), r.n_peaks],
    warnings: verdict ? [verdict] : [],
  };
}
