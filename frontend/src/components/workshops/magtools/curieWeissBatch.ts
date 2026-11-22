// Curie-Weiss over selected worksheets (lane BY3), per-worksheet run.
//
// What a worksheet means (decided, fail closed):
//  * its analysis view (excluded / filtered rows dropped, as the single run),
//    its own X axis as the temperature (must be a declared temperature in K),
//    and the response column with the panel's channel NAME;
//  * the response must be MOLAR susceptibility (cm3/mol), the one basis that
//    needs no sample quantity. A raw-moment basis needs a sample mass, a molar
//    mass and an applied-field column that belong to ONE sample, so applying
//    the panel's values to other worksheets would be a guess: blocked;
//  * the fit window (K) is the panel's, the same for every worksheet (a
//    temperature window is physical, unlike a mass); a worksheet with fewer
//    than 3 usable rows inside it is an error row. Unweighted, as the single run.
// The batch records the fit numbers only; the inverse-susceptibility worksheet
// stays a single-run output.

import { magneticCurieWeissDataFit } from "../../../lib/api/magnetic";
import { ownXKey } from "../../../lib/perSeriesX";
import { columnByName, statsBatchData } from "../../../lib/statsBatchColumns";
import type { Dataset } from "../../../lib/types";
import type { AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import { type CurieWeissBasisChoice, curieWeissProblem, responseBasis } from "./curieWeissData";

export const CURIE_WEISS_BATCH_HEADERS = ["θ_CW (K)", "C (cm³·K/mol)", "μ_eff (μB)", "R²", "n fit"] as const;

/** Why the panel's current basis cannot be batched, or null. */
export function curieWeissBatchBlockReason(choice: CurieWeissBasisChoice, unit: string): string | null {
  const basis = responseBasis(choice, unit);
  if (basis === null) return "Cannot identify the selected response as molar susceptibility; choose its basis first.";
  if (basis !== "molar_susceptibility") {
    return "A batch needs molar susceptibility (cm³/mol): a raw moment needs a sample mass, molar mass and field column that belong to one sample. Convert each worksheet in the Units tab or fit it on its own.";
  }
  return null;
}

export async function curieWeissBatchItem(
  dataset: Dataset, channel: string, choice: CurieWeissBasisChoice, fitMin: number, fitMax: number,
): Promise<AnalysisBatchOutcome> {
  const data = statsBatchData(dataset);
  const col = columnByName(data, channel);
  if (col < 0) throw new Error(`"${channel}" is the X axis of this worksheet, not a response channel.`);
  const blocked = curieWeissBatchBlockReason(choice, data.units[col] ?? "");
  if (blocked) throw new Error(blocked);
  const view = { ...dataset, data };
  const problem = curieWeissProblem(view, null, col, choice, 0, 0, fitMin, fitMax, null);
  if (problem) throw new Error(problem);
  // The temperature is the response's OWN X (R2 in T1,R1,T2,R2 reads T2): the
  // axis `curieWeissProblem` just checked, and the one the single run reads.
  const xCol = ownXKey(view, null, col);
  const temperature: number[] = [];
  const response: number[] = [];
  data.time.forEach((t0, row) => {
    const t = xCol == null ? t0 : data.values[row]![xCol]!;
    const y = data.values[row]![col]!;
    if (Number.isFinite(t) && Number.isFinite(y)) { temperature.push(t); response.push(y); }
  });
  if (temperature.length < 3) {
    throw new Error(`Only ${temperature.length} rows have finite values; the fit needs at least 3.`);
  }
  const r = await magneticCurieWeissDataFit({
    temperature, response, response_basis: "molar_susceptibility", fit_range: [fitMin, fitMax],
    field: null, field_unit: "Oe", sample_mass_g: null, molar_mass_g_mol: null, response_errors: [],
  });
  const warnings: string[] = [];
  if (r.C <= 0) warnings.push("The fitted Curie constant is non-positive; μeff is not physically meaningful.");
  if (r.excluded_nonpositive) warnings.push(`${r.excluded_nonpositive} non-positive susceptibility rows were excluded.`);
  const f = (v: number | null): number | null => (v !== null && Number.isFinite(v) ? v : null);
  return { values: [f(r.theta_cw), f(r.C), f(r.mu_eff), f(r.r2), r.n_fit], warnings };
}
