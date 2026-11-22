// Signal Processing: one operation run on arbitrary data without creating a
// worksheet, for the per-level (By) and per-worksheet (batch) summaries. Uses
// the same requests the live preview sends (applyCorrections /
// runSpectralWorkbench), so a summary describes what Create would produce.

import { applyCorrections } from "../../../lib/api";
import { runSpectralWorkbench } from "../../../lib/api/spectralWorkbench";
import type { Dataset, DataStruct } from "../../../lib/types";
import type { ByCell } from "../byrun/useByLevelRun";
import { isSpectralOperation, settingsToParams, type SignalSettings } from "./signalProcessingModel";
import { buildSpectralRecipe, type SpectralUiSettings } from "./spectralSettings";

export const SIGNAL_SUMMARY_HEADERS = ["Rows out", "Finite outputs", "Mean (first output)"] as const;

/** Run the configured operation on `data` (a level or a selected worksheet's
 *  rows) over `channels` of `source`; spectral outputs come back as the
 *  workbench's own table. */
export async function runSignalOn(
  settings: SignalSettings,
  spectral: SpectralUiSettings,
  channels: number[],
  source: Dataset,
  data: DataStruct,
  signal?: AbortSignal,
): Promise<DataStruct> {
  if (isSpectralOperation(settings.operation)) {
    return runSpectralWorkbench(data, buildSpectralRecipe(settings.operation, spectral, channels, source), signal, true);
  }
  return applyCorrections({
    dataset: data,
    params: settingsToParams(settings, channels),
    ...(source.errorRoles ? { error_bindings: source.errorRoles } : {}),
  }, signal);
}

/** Rows out, finite outputs and the first output column's mean. */
export function signalSummary(out: DataStruct): ByCell[] {
  let sum = 0;
  let finite = 0;
  for (const row of out.values) {
    const v = row[0];
    if (v !== undefined && Number.isFinite(v)) {
      sum += v;
      finite++;
    }
  }
  if (finite === 0) throw new Error("no finite output was produced");
  return [out.values.length, finite, sum / finite];
}
