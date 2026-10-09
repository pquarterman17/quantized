import { migrateLegacySignalResults, sanitizeAnalysisResults, type AnalysisResult } from "./analysisResult";
import { migrateFitAnalysisResults } from "./fitAnalysisResult";
import { migratePeakAnalysisResults } from "./peakAnalysisResult";
import type { Dataset } from "./types";

/** Read-side, one-time catalog migrations kept outside workspace.ts's general
 * document parser. Each adapter version is its tombstone boundary: v2 keeps a
 * deleted peak result deleted; v3 does the same for curve fits. */
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
  return value !== undefined && version >= 3
    ? withPeaks
    : migrateFitAnalysisResults(datasets, withPeaks, createdAt);
}
