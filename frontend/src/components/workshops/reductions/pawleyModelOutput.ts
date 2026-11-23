// The Pawley "→ Library" output (observed / model / background / residual) and
// its commit settings, built in ONE place for the panel's single run
// (usePawley) and the batch's "Create model worksheets" (PawleyModelSheets), so
// a batch row builds the same output as the single run for the same sheet and
// settings (the batch does not record a CIF start-cell preset, so a run made
// from a preset has its own commit key).

import type { AnalysisResultProducer } from "../../../lib/analysisResult";
import type { CommitSettings } from "../../../lib/committedOutput";
import { xAxisIsTwoThetaDegrees } from "../../../lib/peakTableFit";
import type { PawleyResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { pawleyVerdict, type PawleyCentering, type PawleyTie } from "./pawleyInputs";

export const PAWLEY_PRODUCER: AnalysisResultProducer = { id: "pawley", label: "Pawley refinement", version: 2 };

/** Everything the output needs, frozen when the fit returned. */
export interface PawleyModelInput {
  x: number[];
  y: number[];
  range: { min: number; max: number };
  sourceId: string;
  sourceName: string;
  col: number;
  tie: PawleyTie;
  label: string;
  unit: string;
  xLabel: string;
  symmetry: PawleyCentering;
  wavelength: number;
  profileFwhm: number;
  refineCell: boolean;
  startCellFrom: { name: string; source_name: string; space_group: string } | null;
  /** The source's own measured-wavelength keys, carried to the derived set. */
  measured: Record<string, unknown>;
  /** The intensity column by position AND name (recordedPickExtra), recorded unkeyed so a reopen can prove it is still there. */
  pick: CommitSettings;
}

export function pawleyCommitSettings(f: PawleyModelInput, result: PawleyResult): CommitSettings {
  return {
    col: f.col, tie: f.tie, symmetry: f.symmetry, refineCell: f.refineCell,
    wavelength: f.wavelength, fwhm: f.profileFwhm,
    // The refinement it produced, so a different outcome is a different output.
    cell: result.cell, rwp: result.rwp, n: f.x.length,
    // Recorded in the output's metadata, so they are part of what it is.
    cellInitial: result.cell_initial, hklMax: result.hkl_max, startCellFrom: f.startCellFrom?.name ?? null,
  };
}

export function pawleyModelOutput(f: PawleyModelInput, result: PawleyResult): { name: string; data: DataStruct } {
  // Keep the source's own name only when it alone reads as 2θ; a label that
  // passed only on its "deg" unit (e.g. "x") is replaced.
  const xName = xAxisIsTwoThetaDegrees({ xLabel: f.xLabel, xUnit: "" }) ? f.xLabel : "2Theta";
  const data: DataStruct = {
    time: f.x,
    values: f.x.map((_, i) => [f.y[i], result.model[i], result.background[i], result.residual[i]]),
    labels: [f.label, "Pawley model", "Background", "Residual"],
    units: [f.unit, f.unit, f.unit, f.unit],
    metadata: {
      // The measured wavelength (if the source had one) stays under the
      // parser keys; the value the fit USED is recorded under `pawley`, so
      // a typed default is never mistaken for an instrument reading.
      ...f.measured,
      reduction: "pawley",
      source_dataset_id: f.sourceId,
      technique: "xrd.powder",
      x_column_name: xName,
      x_column_long: xName,
      x_column_unit: "deg",
      pawley: {
        cell_initial: result.cell_initial,
        cell_refined: result.cell,
        tie: result.tie,
        symmetry: f.symmetry,
        wavelength_a: f.wavelength,
        profile_fwhm_deg: f.profileFwhm,
        refine_cell: f.refineCell,
        start_cell_from: f.startCellFrom,
        hkl_max: result.hkl_max,
        two_theta_range_deg: [f.range.min, f.range.max],
        rwp: result.rwp,
        rwp_initial: result.rwp_initial,
        converged: result.converged,
        rwp_background: result.rwp_background,
        warning: pawleyVerdict(result, f.refineCell),
        peaks: result.peaks,
      },
    },
  };
  return { name: `${f.sourceName} (Pawley)`, data };
}
