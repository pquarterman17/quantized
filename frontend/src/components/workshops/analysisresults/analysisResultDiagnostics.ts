import type { AnalysisResult } from "../../../lib/analysisResult";
import { snapshotDataOutOfDate, snapshotResultDiagnostics, type SnapshotResultState } from "../../../lib/analysisResultFreshness";
import { fitAnalysisResult } from "../../../lib/fitAnalysisResultLive";
import { peakTableMatchesData } from "../../../lib/peakTableFit";
import { isReflFitCatalogEntry } from "../../../lib/reflFitAnalysisResult";
import { recordChangedText } from "../../../lib/resultInputsRecord";
import type { Dataset, FitSpec } from "../../../lib/types";
import { COMMITTED_OUTPUT_STALE, REFL_RECORD_TRIMMED } from "./analysisResultPanelText";
import type { ReflFitRecord } from "../reflectivity/reflFitRecord";
import type { RecordIssues } from "../reflectivity/reflFitRestore";

export interface AnalysisResultDiagnosticsInput {
  result: AnalysisResult;
  datasets: readonly Dataset[];
  source: Dataset | undefined;
  output: Dataset | undefined;
  staleDatasets: readonly string[];
  staleFits: readonly string[];
  isPeak: boolean;
  isFit: boolean;
  isRefl: boolean;
  peakTable: Dataset["peakTable"] | null;
  fitSpec: FitSpec | null;
  fitFingerprintStale: boolean;
  reflFit: ReflFitRecord | null;
  reflIssues: RecordIssues;
  /** From snapshotResultState; null for results that are not snapshots. */
  snapshotState: SnapshotResultState | null;
  /** The referenced fit / peak / reflectivity record is not the one the envelope
   *  recorded (lib/resultInputsRecord.ts): the panel withholds it. Default false. */
  recordChanged?: boolean;
  /** The named ranges this result read that have moved (lib/namedRangeResultFreshness.ts `rangeChangeNotes`); the panel
   *  computes them against the live ranges. Default: none. */
  rangeNotes?: readonly string[];
}

/** The result workspace's Diagnostics list: live producer warnings plus
 *  missing/stale reference notes, de-duplicated. Pure; the panel memoizes it. */
export function analysisResultDiagnostics({
  result, datasets, source, output, staleDatasets, staleFits, isPeak, isFit, isRefl,
  peakTable, fitSpec, fitFingerprintStale, reflFit, reflIssues, snapshotState, recordChanged = false, rangeNotes = [],
}: AnalysisResultDiagnosticsInput): string[] {
  // A multi-output result (reflectivity curves / bands) is out of date when ANY output is.
  // outputs[0] may be the deleted one: any present output carries the message.
  const presentOutputs = result.outputs.flatMap((ref) => datasets.find((dataset) => dataset.id === ref.datasetId) ?? []);
  const staleOutput = presentOutputs.find((dataset) => staleDatasets.includes(dataset.id)) ?? output ?? presentOutputs[0];
  const field = result.settingsRef?.field;
  const liveWarnings = isFit && source && fitSpec
    ? fitAnalysisResult(source, fitSpec, result.createdAt, { inputs: false }).warnings
    : result.warnings;
  return [...new Set([
    ...liveWarnings,
    ...result.sources.filter((ref) => !datasets.some((dataset) => dataset.id === ref.datasetId))
      .map((ref) => `Source worksheet ${ref.datasetId} is missing.`),
    ...result.outputs.filter((ref) => !datasets.some((dataset) => dataset.id === ref.datasetId))
      .map((ref) => `Output worksheet ${ref.datasetId} is missing.`),
    ...(staleOutput && (staleDatasets.includes(staleOutput.id) || (result.stale && !staleOutput.derivedFrom))
      ? [staleOutput.derivedFrom ? "The linked output is out of date and should be recalculated." : COMMITTED_OUTPUT_STALE]
      : []),
    ...(recordChanged && field && field !== "analysisRecipe" ? [recordChangedText(field)] : []),
    ...(peakTable?.provenance.warnings ?? []),
    ...(isPeak && source && peakTable && !peakTableMatchesData(peakTable, source)
      ? ["The source data changed after this peak fit. Re-fit before using these values."]
      : []),
    ...(isPeak && source && !peakTable && !recordChanged ? ["The fitted peak table is no longer available on the source worksheet."] : []),
    ...(isFit && source && !fitSpec && !recordChanged ? ["The saved curve fit is no longer available on the source worksheet."] : []),
    ...(isFit && source && (staleFits.includes(source.id) || fitFingerprintStale)
      ? ["The source data changed after this fit. Recalculate or re-fit before using these values."]
      : []),
    ...reflIssues.missing,
    ...reflIssues.changed,
    ...(isRefl ? reflFit?.result.warnings ?? [] : []),
    ...(isRefl && reflFit && !reflFit.result.success ? ["The optimizer did not report a successful fit."] : []),
    ...(isRefl && !reflFit && !recordChanged
      ? [isReflFitCatalogEntry(result) ? "The saved reflectivity fit record is missing from its source worksheets." : REFL_RECORD_TRIMMED]
      : []),
    ...(snapshotState ? snapshotResultDiagnostics(result, snapshotState, rangeNotes.length > 0 && !snapshotDataOutOfDate(result, datasets)) : []),
    ...rangeNotes,
  ])];
}
