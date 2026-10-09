import { migrateLegacySignalResults, sanitizeAnalysisResults, type AnalysisResult } from "./analysisResult";
import { migrateFitAnalysisResults } from "./fitAnalysisResult";
import { migratePeakAnalysisResults } from "./peakAnalysisResult";
import { migrateReflectivityFitAnalysisResults } from "./reflFitAnalysisResult";
import type { Dataset } from "./types";

/** Read-side, one-time catalog migrations kept outside workspace.ts's general
 * document parser. Each adapter version is its tombstone boundary: v2 keeps a
 * deleted peak result deleted; v3 curve fits; v4 reflectivity fit history. */
export function workspaceAnalysisResults(
  value: unknown,
  catalogVersion: unknown,
  datasets: readonly Dataset[],
  createdAt: string,
  warnings: string[],
): AnalysisResult[] {
  const existing = value === undefined
    ? migrateLegacySignalResults(datasets, createdAt)
    : sanitizeAnalysisResults(value, warnings);
  const version = typeof catalogVersion === "number" ? catalogVersion : 0;
  const withPeaks = value !== undefined && version >= 2 ? existing : migratePeakAnalysisResults(datasets, existing);
  const withFits = value !== undefined && version >= 3
    ? withPeaks
    : migrateFitAnalysisResults(datasets, withPeaks, createdAt);
  return value !== undefined && version >= 4
    ? withFits
    : migrateReflectivityFitAnalysisResults(datasets, withFits);
}
