import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultValue } from "./analysisResult";
import { peakTableMatchesData, peakTableXIsDegrees } from "./peakTableFit";
import type { WilliamsonHallResult } from "./reductionTypes";
import type { Dataset } from "./types";
import { williamsonHallPeakTableFingerprint, type WilliamsonHallPeakRow } from "./williamsonHallRecipe";

export const WILLIAMSON_HALL_BATCH_LIMIT = 25;
export const WILLIAMSON_HALL_BATCH_PEAK_LIMIT = 500;

export interface WilliamsonHallBatchItem {
  datasetId: string;
  datasetName: string;
  rows: WilliamsonHallPeakRow[];
  wavelengthA: number;
  peakTableFingerprint: string;
}

export interface WilliamsonHallBatchRecipe {
  items: WilliamsonHallBatchItem[];
  kFactor: number;
  instrumentalBroadeningDeg: number;
}

export interface WilliamsonHallBatchOutcome {
  item: WilliamsonHallBatchItem;
  source: Dataset;
  output: WilliamsonHallResult;
  warning?: string;
}

export interface WilliamsonHallBatchStatusRow {
  datasetId: string;
  datasetName: string;
  status: string;
  warning: string | null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function williamsonHallBatchItem(
  source: Dataset, fallbackWavelengthA: number,
): { item: WilliamsonHallBatchItem | null; issue: string | null; warning: string | null } {
  const table = source.peakTable;
  if (!table) return { item: null, issue: "No fitted peak table. Fit and publish peaks first.", warning: null };
  if (!peakTableMatchesData(table, source)) {
    return { item: null, issue: "The fitted peak table is out of date. Re-fit and publish peaks first.", warning: null };
  }
  if (!peakTableXIsDegrees(table)) {
    return { item: null, issue: "The fitted peak table must use a 2θ axis in degrees.", warning: null };
  }
  const rows = table.peaks.filter((peak) => !peak.excluded).map((peak) => ({ twoTheta: peak.center, fwhm: peak.fwhm }));
  if (rows.length < 2) return { item: null, issue: "At least two included fitted peaks are required.", warning: null };
  if (rows.some((row) => !finite(row.twoTheta) || row.twoTheta <= 0 || row.twoTheta >= 180 ||
      !finite(row.fwhm) || row.fwhm <= 0)) {
    return { item: null, issue: "Included fitted peaks contain an invalid 2θ or FWHM value.", warning: null };
  }
  if (rows.length > WILLIAMSON_HALL_BATCH_PEAK_LIMIT) {
    return { item: null, issue: `Reduce the included peak table to ${WILLIAMSON_HALL_BATCH_PEAK_LIMIT} peaks or fewer.`, warning: null };
  }
  const wavelength = table.provenance.wavelengthA;
  const wavelengthA = finite(wavelength) && wavelength > 0 ? wavelength : fallbackWavelengthA;
  if (!finite(wavelengthA) || wavelengthA <= 0) {
    return { item: null, issue: "No valid wavelength is available.", warning: null };
  }
  return {
    item: {
      datasetId: source.id, datasetName: source.name, rows,
      wavelengthA, peakTableFingerprint: williamsonHallPeakTableFingerprint(table),
    },
    issue: null,
    warning: wavelength === wavelengthA ? null : `No peak-table wavelength; used the shared ${wavelengthA} Å fallback.`,
  };
}
export function williamsonHallBatchResult(
  id: string, recipe: WilliamsonHallBatchRecipe, outcomes: readonly WilliamsonHallBatchOutcome[],
  sourceFingerprint: string, statuses: readonly WilliamsonHallBatchStatusRow[],
  runWarnings: readonly string[], stale = false,
  createdAt = new Date().toISOString(),
): AnalysisResult {
  const byId = new Map(outcomes.map((outcome) => [outcome.item.datasetId, outcome]));
  return {
    version: ANALYSIS_RESULT_VERSION,
    id,
    name: `Williamson–Hall comparison · ${outcomes.length} worksheet${outcomes.length === 1 ? "" : "s"}`,
    producer: { id: "williamson-hall-batch", label: "Williamson–Hall comparison", version: 1 },
    sources: outcomes.map((outcome) => ({ datasetId: outcome.source.id, role: "input" as const })),
    outputs: [],
    sourceFingerprint,
    parameters: { recipe: recipe as unknown as AnalysisResultValue },
    scalarValues: {
      Analysis: "Williamson–Hall comparison",
      Worksheets: outcomes.length,
      "K factor": recipe.kFactor,
      "Instrumental broadening (°)": recipe.instrumentalBroadeningDeg,
      Interpretation: "Compare crystallite size, microstrain, and fit quality across the selected XRD worksheets.",
    },
    tables: [{
      title: "Crystallite comparison",
      columns: ["Worksheet", "Crystallite size (nm)", "Microstrain", "R²", "Peaks", "Wavelength (Å)", "Status", "Warning"],
      rows: statuses.map((status) => {
        const outcome = byId.get(status.datasetId);
        const item = outcome?.item;
        if (!outcome || !item) return [status.datasetName, null, null, null, null, null, status.status, status.warning];
        const size = finite(outcome.output.grain_size_nm) ? outcome.output.grain_size_nm : null;
        return [item.datasetName, size, outcome.output.microstrain, outcome.output.r2,
          item.rows.length, item.wavelengthA, status.status, outcome.warning ?? status.warning];
      }),
    }],
    warnings: [
      "Williamson–Hall comparisons use unweighted linear fits; saved peak uncertainties are not used.",
      ...runWarnings,
    ],
    createdAt,
    ...(stale ? { stale: true as const } : {}),
  };
}

