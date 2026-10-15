import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "./analysisResult";
import { analysisDataFingerprint, snapshotResultState } from "./analysisResultFreshness";
import type { PeakTable } from "./peakTable";
import { statisticalResultFigureDrafts } from "./statisticalResultFigures";
import type { Dataset } from "./types";
import { williamsonHallAnalysisResult } from "./williamsonHallAnalysisResult";
import { williamsonHallPeakTableFingerprint, williamsonHallRecipe } from "./williamsonHallRecipe";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const source: Dataset = {
  id: "xrd", name: "film.xrdml",
  data: { time: [20, 30, 40], values: [[10], [100], [20]], labels: ["Intensity"], units: ["cps"], metadata: {} },
};
const table: PeakTable = {
  version: 1,
  peaks: [
    { id: "p1", center: 30, centerErr: null, fwhm: 0.2, fwhmErr: null, height: 10, heightErr: null,
      area: 2, bg: 1, eta: null, model: "Gaussian", status: "fit", excluded: false },
    { id: "p2", center: 45, centerErr: null, fwhm: 0.3, fwhmErr: null, height: 8, heightErr: null,
      area: 2, bg: 1, eta: null, model: "Gaussian", status: "fit", excluded: false },
  ],
  provenance: { datasetId: "xrd", datasetName: "film.xrdml", method: "simultaneous", model: "Gaussian",
    bgDegree: 0, linkMode: "None", constrain: false, bgCoeffs: [], R2: 0.99, rmse: 0.1,
    wavelengthA: 1.5406, xLabel: "2θ", xUnit: "deg", fingerprint: "data-fp", fittedAt: "2026-10-15T00:00:00Z" },
};
const output = { grain_size_nm: 24, microstrain: 0.001, r2: 0.98,
  plot_x: [1, 2], plot_y: [0.01, 0.02], fit_line: [0.01, 0.001] as [number, number] };

describe("williamsonHallAnalysisResult", () => {
  it("round-trips exact inputs, output tables, and an editable fit figure", () => {
    const bound = { ...source, peakTable: table };
    const recipe = { rows: [{ twoTheta: 30, fwhm: 0.2 }, { twoTheta: 45, fwhm: 0.3 }],
      wavelengthA: 1.5406, kFactor: 0.9, instrumentalBroadeningDeg: 0.05,
      sourceKind: "peak-table" as const, peakTableFingerprint: williamsonHallPeakTableFingerprint(table) };
    const result = williamsonHallAnalysisResult("wh", bound, recipe, output, "2026-10-15T01:00:00Z");
    expect(result).toMatchObject({
      producer: { id: "williamson-hall" }, sourceFingerprint: analysisDataFingerprint(bound),
      scalarValues: { "Crystallite size (nm)": 24, Microstrain: 0.001, "R²": 0.98 },
      tables: [{ title: "Summary" }, { title: "Peak inputs" }, { title: "Williamson–Hall fit" }],
    });
    const [restored] = sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])));
    expect(restored).toEqual(result);
    expect(williamsonHallRecipe(restored)).toEqual(recipe);
    const reopened = parseWorkspace(serializeWorkspace({ datasets: [bound], analysisResults: [result] }));
    expect(reopened.analysisResults).toEqual([result]);
    expect(snapshotResultState(reopened.analysisResults![0], reopened.datasets)).toBe("current");
    const [draft] = statisticalResultFigureDrafts(restored);
    expect(draft.data.values).toEqual([[0.01, 0.011], [0.02, 0.021]]);
    expect(draft.view.seriesStyles).toMatchObject({ 0: { width: 0, marker: true }, 1: { width: 2 } });
  });

  it("marks a bound result stale when its fitted peak inputs change", () => {
    const bound = { ...source, peakTable: table };
    const result = williamsonHallAnalysisResult("wh", bound, {
      rows: [{ twoTheta: 30, fwhm: 0.2 }, { twoTheta: 45, fwhm: 0.3 }],
      wavelengthA: 1.5406, kFactor: 0.9, instrumentalBroadeningDeg: 0,
      sourceKind: "peak-table", peakTableFingerprint: williamsonHallPeakTableFingerprint(table),
    }, output);
    expect(snapshotResultState(result, [bound])).toBe("current");
    expect(snapshotResultState(result, [{ ...bound, peakTable: { ...table, peaks: table.peaks.map((peak, index) =>
      index ? peak : { ...peak, fwhm: 0.25 }) } }])).toBe("out-of-date");
    expect(snapshotResultState(result, [{ ...bound, peakTable: undefined }])).toBe("out-of-date");
  });

  it("rejects malformed recipes and stores an undefined size as null", () => {
    const result = williamsonHallAnalysisResult("wh", source, {
      rows: [{ twoTheta: 30, fwhm: 0.2 }, { twoTheta: 45, fwhm: 0.3 }],
      wavelengthA: 1.5406, kFactor: 0.9, instrumentalBroadeningDeg: 0, sourceKind: "manual",
    }, { ...output, grain_size_nm: null });
    expect(result.scalarValues?.["Crystallite size (nm)"]).toBeNull();
    expect(williamsonHallRecipe({ ...result, parameters: { recipe: { rows: [], wavelengthA: 1,
      kFactor: 1, instrumentalBroadeningDeg: 0, sourceKind: "manual" } } })).toBeNull();
  });
});
