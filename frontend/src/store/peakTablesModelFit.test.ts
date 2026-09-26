// A Peak Analyzer model-fit table in the store (audit P2.1 uncertainties):
// `publishBuiltPeakTable`'s refusal and undo contract, and the manual-edit
// contract ("an edit clears the uncertainty of each field it changes") now
// exercised with REAL non-null errors instead of the always-null legacy ones.

import { beforeEach, describe, expect, it } from "vitest";

import { modelFitResponse } from "../components/workshops/peakwizard/modelFit.testkit";
import { peakTableFromModelFit } from "../components/workshops/peakwizard/modelFitPeakTable";
import type { PeakTable } from "../lib/peakTable";
import { MANUAL_ERR_REASON, RESCALED_ERR_REASON, peakDataFingerprint } from "../lib/peakTableFit";
import type { Dataset } from "../lib/types";
import { editPeak, publishBuiltPeakTable, removePeaks, setPeakExcluded } from "./peakTables";
import { useApp } from "./useApp";

const DS: Dataset = {
  id: "d1",
  name: "film.xrdml",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [6], [2], [3], [1]], labels: ["I"], units: ["cts"], metadata: {} },
};
const FP = peakDataFingerprint(DS);
const build = (ds: Dataset): PeakTable =>
  peakTableFromModelFit(modelFitResponse(), ds, {
    xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: FP,
  }, ds.peakTable);
const table = () => useApp.getState().datasets[0].peakTable!;

beforeEach(() => {
  useApp.setState({ datasets: [DS], activeId: "d1", history: [], future: [] });
});

describe("publishBuiltPeakTable", () => {
  it("publishes the built table as one undo step", async () => {
    expect(await publishBuiltPeakTable("d1", FP, build)).toBeNull();
    expect(table().provenance.producer).toBe("model_fit");
    expect(table().peaks[0].centerErr).toBe(0.004);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["publish model fit to peak table"]);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("refuses, writing nothing, when the data changed since the fit", async () => {
    const edited = { ...DS, data: { ...DS.data, values: [[1], [2], [7], [2], [3], [1]] } };
    useApp.setState({ datasets: [edited] });
    expect(await publishBuiltPeakTable("d1", FP, build)).toMatch(/changed since this fit/);
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("refuses for a dataset that is gone", async () => {
    expect(await publishBuiltPeakTable("gone", FP, build)).toMatch(/no longer available/);
  });

  it("builds against the LIVE record, so a re-publish keeps the user's exclusions", async () => {
    await publishBuiltPeakTable("d1", FP, build);
    setPeakExcluded("d1", table().peaks[1].id, true);
    await publishBuiltPeakTable("d1", FP, build);
    expect(table().peaks.map((p) => p.excluded)).toEqual([false, true]);
  });
});

describe("manual edits of a published model-fit row (real errors)", () => {
  beforeEach(async () => {
    await publishBuiltPeakTable("d1", FP, build);
  });

  it("clears ONLY the changed field's error, and says why", () => {
    const p1 = table().peaks[1]; // gaussian: fwhm 0.01, height 0.04, area 0.03 errors
    expect([p1.fwhmErr, p1.heightErr, p1.areaErr]).toEqual([0.01, 0.04, 0.03]);
    const next = editPeak("d1", p1.id, { center: 4.2, fwhm: p1.fwhm, height: p1.height, area: p1.area })!;
    const row = next.peaks[1];
    expect(row.center).toBe(4.2);
    expect(row.centerErr).toBeNull();
    expect(row.errReasons?.center).toBe(MANUAL_ERR_REASON);
    // untouched fields keep their measured errors
    expect([row.fwhmErr, row.heightErr, row.areaErr]).toEqual([0.01, 0.04, 0.03]);
    expect(row.errReasons?.fwhm).toBeUndefined();
  });

  it("clears the area error too when a height edit rescales the area", () => {
    const p1 = table().peaks[1];
    const row = editPeak("d1", p1.id, { center: p1.center, fwhm: p1.fwhm, height: 4.2, area: p1.area })!.peaks[1];
    expect(row.area).toBeCloseTo(p1.area * 2, 12);
    expect(row.heightErr).toBeNull();
    expect(row.areaErr).toBeNull();
    // the area was RESCALED, not typed — its reason says so
    expect(row.errReasons?.area).toBe(RESCALED_ERR_REASON);
    expect(row.errReasons?.height).toBe(MANUAL_ERR_REASON);
    expect([row.centerErr, row.fwhmErr]).toEqual([p1.centerErr, 0.01]);
  });

  it("a FWHM edit forgets a Voigt row's G/L split and its errors", () => {
    const t = table();
    const voigt = { ...t, peaks: t.peaks.map((p, i) => (i === 0 ? { ...p, fwhmG: 0.5, fwhmGErr: 0.02, fwhmL: 0.4, fwhmLErr: 0.03 } : p)) };
    useApp.setState({ datasets: [{ ...DS, peakTable: voigt }] });
    const p0 = voigt.peaks[0];
    const row = editPeak("d1", p0.id, { center: p0.center, fwhm: 0.9, height: p0.height, area: p0.area })!.peaks[0];
    expect(row).toMatchObject({ fwhmErr: null, fwhmG: null, fwhmGErr: null, fwhmL: null, fwhmLErr: null });
  });

  it("clears the model fit's SSR/χ² with R²/RMSE on an edit or a removal", () => {
    expect(table().provenance.ssr).toBe(0.012);
    const p0 = table().peaks[0];
    const edited = editPeak("d1", p0.id, { center: 2.05 })!;
    expect(edited.provenance).toMatchObject({ R2: null, rmse: null, ssr: null, chi2: null });
    useApp.getState().undo();
    const removed = removePeaks("d1", new Set([table().peaks[0].id]))!;
    expect(removed.provenance).toMatchObject({ R2: null, rmse: null, ssr: null });
  });
});
