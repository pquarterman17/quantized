import { migrateLegacySignalResults, sanitizeAnalysisResults, type AnalysisResult } from "./analysisResult";
import { migratePeakAnalysisResults } from "./peakAnalysisResult";
import type { Dataset } from "./types";

/** Read-side, one-time catalog migrations kept outside workspace.ts's general
 * document parser. A saved v2 marker is the tombstone boundary: once present,
 * an intentionally deleted result is never reconstructed from its authority. */
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
  const current = value !== undefined && typeof catalogVersion === "number" && catalogVersion >= 2;
  return current ? existing : migratePeakAnalysisResults(datasets, existing);
}
