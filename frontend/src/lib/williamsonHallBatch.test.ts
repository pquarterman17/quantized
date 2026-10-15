import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "./analysisResult";
import { analysisDataFingerprint, snapshotResultState } from "./analysisResultFreshness";
import { peakDataFingerprint } from "./peakTableFit";
import { statisticalResultFigureDrafts } from "./statisticalResultFigures";
import type { Dataset } from "./types";
import { williamsonHallBatchItem, williamsonHallBatchResult } from "./williamsonHallBatch";

function source(id: string, wavelengthA: number | null = 1.5406): Dataset {
  const base: Dataset = { id, name: `${id}.xrdml`, data: {
    time: [30, 45], values: [[100], [80]], labels: ["Intensity"], units: ["cps"], metadata: {},
  } };
  return { ...base, peakTable: {
    version: 1,
    peaks: [
      { id: `${id}-p1`, center: 30, centerErr: null, fwhm: 0.2, fwhmErr: null, height: 10,
        heightErr: null, area: 2, bg: 1, eta: null, model: "Gaussian", status: "fit", excluded: false },
      { id: `${id}-p2`, center: 45, centerErr: null, fwhm: 0.3, fwhmErr: null, height: 8,
        heightErr: null, area: 2, bg: 1, eta: null, model: "Gaussian", status: "fit", excluded: false },
    ],
    provenance: { datasetId: id, datasetName: base.name, method: "simultaneous", model: "Gaussian",
      bgDegree: 0, linkMode: "None", constrain: false, bgCoeffs: [], R2: 0.99, rmse: 0.1,
      wavelengthA, xLabel: "2θ", xUnit: "deg", fingerprint: peakDataFingerprint(base),
      fittedAt: "2026-10-15T00:00:00Z" },
  } };
}

describe("Williamson–Hall batch comparison", () => {
  it("preflights exact fitted-peak inputs and discloses a wavelength fallback", () => {
    const prepared = williamsonHallBatchItem(source("a"), 1.2);
    expect(prepared).toMatchObject({ item: { datasetId: "a", wavelengthA: 1.5406 }, warning: null });
    expect(prepared.item?.rows).toEqual([{ twoTheta: 30, fwhm: 0.2 }, { twoTheta: 45, fwhm: 0.3 }]);
    expect(williamsonHallBatchItem(source("b", null), 1.2)).toMatchObject({
      item: { datasetId: "b", wavelengthA: 1.2 }, warning: expect.stringMatching(/fallback/),
    });
  });

  it("round-trips status rows, detects peak-table drift, and creates comparison figures", () => {
    const a = source("a"), b = source("b");
    const aItem = williamsonHallBatchItem(a, 1.5406).item!;
    const bItem = williamsonHallBatchItem(b, 1.5406).item!;
    const outputA = { grain_size_nm: 24, microstrain: 0.001, r2: 0.98,
      plot_x: [1, 2], plot_y: [0.01, 0.02], fit_line: [0.01, 0.001] as [number, number] };
    const outputB = { ...outputA, grain_size_nm: 35, microstrain: 0.002, r2: 0.91 };
    const result = williamsonHallBatchResult("batch", {
      items: [aItem, bItem], kFactor: 0.9, instrumentalBroadeningDeg: 0.05,
    }, [
      { item: aItem, source: a, output: outputA },
      { item: bItem, source: b, output: outputB, warning: "review this fit" },
    ], [analysisDataFingerprint(a), analysisDataFingerprint(b)].join(":"), [
      { datasetId: "a", datasetName: a.name, status: "Completed", warning: null },
      { datasetId: "b", datasetName: b.name, status: "Completed", warning: "review this fit" },
      { datasetId: "missing", datasetName: "missing.xrdml", status: "Failed", warning: "No peak table" },
    ], ["b.xrdml: review this fit"], false, "2026-10-15T01:00:00Z");
    const [restored] = sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])));
    expect(restored.tables?.[0].rows).toHaveLength(3);
    expect(snapshotResultState(restored, [a, b])).toBe("current");
    expect(statisticalResultFigureDrafts(restored)).toHaveLength(3);
    const changed = { ...a, peakTable: { ...a.peakTable!, peaks: a.peakTable!.peaks.map((peak, index) =>
      index ? peak : { ...peak, fwhm: 0.25 }) } };
    expect(snapshotResultState(restored, [changed, b])).toBe("out-of-date");
  });
});
