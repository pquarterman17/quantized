import type { AnalysisResult } from "../../../lib/analysisResult";
import { fitAnalysisResult } from "../../../lib/fitAnalysisResultLive";
import { peakTableMatchesData } from "../../../lib/peakTableFit";
import type { Dataset, FitSpec } from "../../../lib/types";
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
  isDistribution: boolean;
  peakTable: Dataset["peakTable"] | null;
  fitSpec: FitSpec | null;
  fitFingerprintStale: boolean;
  reflFit: ReflFitRecord | null;
  reflIssues: RecordIssues;
  snapshotUnverified: boolean;
  snapshotOutdated: boolean;
}

/** The result workspace's Diagnostics list: live producer warnings plus
 *  missing/stale reference notes, de-duplicated. Pure; the panel memoizes it. */
export function analysisResultDiagnostics({
  result, datasets, source, output, staleDatasets, staleFits, isPeak, isFit, isRefl, isDistribution,
  peakTable, fitSpec, fitFingerprintStale, reflFit, reflIssues, snapshotUnverified, snapshotOutdated,
}: AnalysisResultDiagnosticsInput): string[] {
  const liveWarnings = isFit && source && fitSpec
    ? fitAnalysisResult(source, fitSpec, result.createdAt).warnings
    : result.warnings;
  return [...new Set([
    ...liveWarnings,
    ...result.sources.filter((ref) => !datasets.some((dataset) => dataset.id === ref.datasetId))
      .map((ref) => `Source worksheet ${ref.datasetId} is missing.`),
    ...result.outputs.filter((ref) => !datasets.some((dataset) => dataset.id === ref.datasetId))
      .map((ref) => `Output worksheet ${ref.datasetId} is missing.`),
    ...(output && staleDatasets.includes(output.id) ? ["The linked output is out of date and should be recalculated."] : []),
    ...(peakTable?.provenance.warnings ?? []),
    ...(isPeak && source && peakTable && !peakTableMatchesData(peakTable, source)
      ? ["The source data changed after this peak fit. Re-fit before using these values."]
      : []),
    ...(isPeak && source && !peakTable ? ["The fitted peak table is no longer available on the source worksheet."] : []),
    ...(isFit && source && !fitSpec ? ["The saved curve fit is no longer available on the source worksheet."] : []),
    ...(isFit && source && (staleFits.includes(source.id) || fitFingerprintStale)
      ? ["The source data changed after this fit. Recalculate or re-fit before using these values."]
      : []),
    ...reflIssues.missing,
    ...reflIssues.changed,
    ...(isRefl ? reflFit?.result.warnings ?? [] : []),
    ...(isRefl && reflFit && !reflFit.result.success ? ["The optimizer did not report a successful fit."] : []),
    ...(isRefl && !reflFit ? ["The saved reflectivity fit record is missing from its source worksheets."] : []),
    ...(snapshotUnverified ? [source?.pending
        ? `Load the full source worksheet to verify this ${isDistribution ? "distribution analysis" : "statistical test"}.`
        : `This saved ${isDistribution ? "distribution analysis" : "statistical test"} has no source fingerprint and cannot be verified.`]
      : snapshotOutdated
        ? [`The source data changed after this ${isDistribution ? "distribution analysis" : "statistical test"}. Run it again before using these values.`]
      : []),
  ])];
}
