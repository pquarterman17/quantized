// Saved statistical-test, Williamson–Hall and analysis-batch results for the
// result-book tests (lane RB2). Extends resultBook.testkit.

import { ANALYSIS_RESULT_VERSION, type AnalysisResult } from "../../../lib/analysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { ANALYSIS_SELECTION_VERSION } from "../../../lib/analysisSelectionVersion";
import { peakDataFingerprint } from "../../../lib/peakTableFit";
import { statisticalTestAnalysisResult } from "../../../lib/statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../../../lib/statsTests";
import type { Dataset } from "../../../lib/types";
import { williamsonHallAnalysisResult } from "../../../lib/williamsonHallAnalysisResult";
import { williamsonHallBatchItem, williamsonHallBatchResult } from "../../../lib/williamsonHallBatch";
import { source, variabilitySource } from "./resultBook.testkit";

export const dunnett = (): AnalysisResult => statisticalTestAnalysisResult(
  "dunnett", variabilitySource, "dunnett", { ...DEFAULT_SELECTION, cols: [0, 1] }, DEFAULT_PARAMS, ["Signal", "Batch"],
  { sentence: "No group differs.", tables: [
    { title: "Comparisons", columns: ["group", "p"], rows: [["Batch", 0.4]] },
    { title: "Group means", columns: ["group", "mean"], rows: [["Signal", 2.33], ["Batch", 16.7]] },
  ] },
  "2026-10-10T00:00:00Z",
);
export const anderson = (): AnalysisResult => statisticalTestAnalysisResult(
  "anderson", source, "anderson", { ...DEFAULT_SELECTION, x: 0 }, DEFAULT_PARAMS, ["Signal"],
  { sentence: "Normal.", tables: [{ title: "Statistics", columns: ["statistic", "value"], rows: [["A²", 0.2]] }] },
  "2026-10-10T00:00:00Z",
);
export const power = (): AnalysisResult => statisticalTestAnalysisResult(
  "power", null, "power", DEFAULT_SELECTION, DEFAULT_PARAMS, [],
  { sentence: "n = 64.", tables: [{ title: "Power", columns: ["quantity", "value"], rows: [["n", 64]] }] },
  "2026-10-10T00:00:00Z",
);

export const xrd: Dataset = {
  id: "xrd", name: "film.xrdml",
  data: { time: [20, 30, 40], values: [[10], [100], [20]], labels: ["Intensity"], units: ["cps"], metadata: {} },
};
const whOutput = { grain_size_nm: 24, microstrain: 0.001, r2: 0.98,
  plot_x: [1, 2], plot_y: [0.01, 0.02], fit_line: [0.01, 0.001] as [number, number] };
export const williamsonHall = (): AnalysisResult => williamsonHallAnalysisResult(
  "wh", xrd, { rows: [{ twoTheta: 30, fwhm: 0.2 }, { twoTheta: 45, fwhm: 0.3 }],
    wavelengthA: 1.5406, kFactor: 0.9, instrumentalBroadeningDeg: 0.05, sourceKind: "manual" },
  whOutput, "2026-10-15T01:00:00Z",
);

const peak = (id: string, center: number, fwhm: number) => ({
  id, center, centerErr: null, fwhm, fwhmErr: null, height: 10, heightErr: null, area: 2, bg: 1,
  eta: null, model: "Gaussian", status: "fit" as const, excluded: false,
});
export function peakSheet(id: string): Dataset {
  const base: Dataset = { id, name: `${id}.xrdml`, data: {
    time: [30, 45], values: [[100], [80]], labels: ["Intensity"], units: ["cps"], metadata: {},
  } };
  return { ...base, peakTable: { version: 1, peaks: [peak(`${id}1`, 30, 0.2), peak(`${id}2`, 45, 0.3)],
    provenance: { datasetId: id, datasetName: base.name, method: "simultaneous", model: "Gaussian",
      bgDegree: 0, linkMode: "None", constrain: false, bgCoeffs: [], R2: 0.99, rmse: 0.1,
      wavelengthA: 1.5406, xLabel: "2θ", xUnit: "deg", fingerprint: peakDataFingerprint(base),
      fittedAt: "2026-10-15T00:00:00Z" } } };
}
export const williamsonHallBatch = (sheets: readonly Dataset[]): AnalysisResult => {
  const items = sheets.map((sheet) => williamsonHallBatchItem(sheet, 1.5406).item!);
  return williamsonHallBatchResult("wh-batch", { items, kFactor: 0.9, instrumentalBroadeningDeg: 0.05 },
    sheets.map((sheet, index) => ({ item: items[index], source: sheet, output: whOutput })),
    sheets.map((sheet) => analysisDataFingerprint(sheet)).join(":"),
    sheets.map((sheet) => ({ datasetId: sheet.id, datasetName: sheet.name, status: "Completed", warning: null })),
    [], false, "2026-10-15T01:00:00Z");
};

export const analysisBatch = (sheets: readonly Dataset[]): AnalysisResult => ({
  version: ANALYSIS_RESULT_VERSION, id: "batch", name: "Baseline - batch",
  producer: { id: "analysis-batch", label: "Baseline", version: 1 },
  sources: sheets.map((sheet) => ({ datasetId: sheet.id, role: "input" as const })), outputs: [],
  sourceFingerprint: sheets.map((sheet) => analysisDataFingerprint(sheet)).join(":"),
  parameters: { method: "linear", params: "{}", toolId: "baseline",
    selection: { version: ANALYSIS_SELECTION_VERSION, items: [] } },
  tables: [{ title: "Batch status", columns: ["Worksheet", "Status", "Rows", "Baseline min", "Warnings"],
    rows: [["a", "Completed", 3, 0.5, null], ["b", "Failed", 3, null, "no data"]] }],
  warnings: ["b: no data"], createdAt: "2026-10-16T00:00:00Z",
});
