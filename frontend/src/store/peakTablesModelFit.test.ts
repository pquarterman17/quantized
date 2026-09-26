// A Peak Analyzer model-fit table in the store (audit P2.1 uncertainties):
// `publishBuiltPeakTable`'s refusal and undo contract, and the manual-edit
// contract ("an edit clears the uncertainty of each field it changes") now
// exercised with REAL non-null errors instead of the always-null legacy ones.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { modelFitResponse } from "../components/workshops/peakwizard/modelFit.testkit";
import { peakTableFromModelFit } from "../components/workshops/peakwizard/modelFitPeakTable";
import type { PeakTable } from "../lib/peakTable";
import { MANUAL_ERR_REASON, RESCALED_ERR_REASON, peakDataFingerprint, peakTableFromFit } from "../lib/peakTableFit";
import type { Dataset } from "../lib/types";
import { editPeak, publishBuiltPeakTable, removePeaks, setPeakExcluded } from "./peakTables";
import { useApp } from "./useApp";

// Counted, not replaced: the real digest runs; the count proves how many
// full-dataset hashes one publish costs.
vi.mock("../lib/peakTableFit", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/peakTableFit")>();
  return { ...real, peakDataFingerprint: vi.fn(real.peakDataFingerprint) };
});

const DS: Dataset = {
  id: "d1",
  name: "film.xrdml",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [6], [2], [3], [1]], labels: ["I"], units: ["cts"], metadata: {} },
};
const FP = peakDataFingerprint(DS);
const build = (ds: Dataset, fingerprint: string): PeakTable =>
  peakTableFromModelFit(modelFitResponse(), ds, {
    xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint,
  }, ds.peakTable);
const table = () => useApp.getState().datasets[0].peakTable!;
const publish = (fitDs: Dataset = DS, current?: () => boolean) => publishBuiltPeakTable(fitDs, build, current);

beforeEach(() => {
  useApp.setState({ datasets: [DS], activeId: "d1", history: [], future: [] });
  vi.mocked(peakDataFingerprint).mockClear();
});

describe("publishBuiltPeakTable", () => {
  it("publishes the built table, stamped with the fit-time fingerprint, as one undo step", async () => {
    const out = await publish();
    expect("table" in out && out.table).toBe(table());
    expect(table().provenance.producer).toBe("model_fit");
    expect(table().provenance.fingerprint).toBe(FP);
    expect(table().peaks[0].centerErr).toBe(0.004);
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["publish model fit to peak table"]);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("hashes the dataset ONCE when the live record is the fit-time record", async () => {
    await publish();
    expect(peakDataFingerprint).toHaveBeenCalledTimes(1);
  });

  it("compares by hash when the record was replaced, and still publishes identical data", async () => {
    useApp.setState({ datasets: [{ ...DS, data: { ...DS.data } }] }); // a same-numbers re-import
    await publish();
    expect(peakDataFingerprint).toHaveBeenCalledTimes(2);
    expect(table().provenance.fingerprint).toBe(FP);
  });

  it("refuses, writing nothing, when the data changed since the fit", async () => {
    const edited = { ...DS, data: { ...DS.data, values: [[1], [2], [7], [2], [3], [1]] } };
    useApp.setState({ datasets: [edited] });
    expect(await publish()).toEqual({ reason: expect.stringMatching(/changed since this fit/) });
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("refuses for a dataset that is gone", async () => {
    expect(await publish({ ...DS, id: "gone" })).toEqual({ reason: expect.stringMatching(/no longer available/) });
  });

  it("a publish SUPERSEDED during its await writes nothing (the token is re-checked before the write)", async () => {
    let current = true;
    useApp.setState({
      resolveDataset: async (id: string) => {
        current = false; // a re-fit/reset lands while the dataset resolves
        return useApp.getState().datasets.find((d) => d.id === id);
      },
    });
    const real = useApp.getState().resolveDataset;
    try {
      expect(await publish(DS, () => current)).toEqual({ reason: expect.stringMatching(/superseded/) });
      expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
      expect(useApp.getState().history).toHaveLength(0);
    } finally {
      useApp.setState({ resolveDataset: real });
    }
  });

  it("a builder that throws writes nothing and leaves NO undo step", async () => {
    const boom = () => {
      throw new Error("bad response");
    };
    await expect(publishBuiltPeakTable(DS, boom)).rejects.toThrow("bad response");
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("builds against the LIVE record, so a re-publish keeps the user's exclusions", async () => {
    await publish();
    setPeakExcluded("d1", table().peaks[1].id, true);
    await publish();
    expect(table().peaks.map((p) => p.excluded)).toEqual([false, true]);
  });
});

describe("manual edits of a published model-fit row (real errors)", () => {
  beforeEach(async () => {
    await publish();
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
    const voigt = { ...t, peaks: t.peaks.map((p, i) => (i === 0
      ? { ...p, fwhmG: 0.5, fwhmGErr: 0.02, fwhmL: 0.4, fwhmLErr: null, errReasons: { ...p.errReasons, fwhmL: "fixed" } }
      : p)) };
    useApp.setState({ datasets: [{ ...DS, peakTable: voigt }] });
    const p0 = voigt.peaks[0];
    const row = editPeak("d1", p0.id, { center: p0.center, fwhm: 0.9, height: p0.height, area: p0.area })!.peaks[0];
    expect(row).toMatchObject({ fwhmErr: null, fwhmG: null, fwhmGErr: null, fwhmL: null, fwhmLErr: null });
    // the widths are gone, so is the reason for their (now meaningless) errors
    expect(row.errReasons?.fwhmL).toBeUndefined();
    expect(row.errReasons?.fwhm).toBe(MANUAL_ERR_REASON);
  });

  it("a LEGACY row's area edit clears no error it never had (no areaErr materialised)", async () => {
    const legacy = peakTableFromFit(
      { peaks: [{ center: 2, fwhm: 0.8, height: 5, bg: 0.5, eta: null, area: 4, status: "fitted", model: "Gaussian" }],
        bgCoeffs: [0.5], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x", method: "simultaneous", bgDegree: 0, linkMode: "None", constrain: false, wavelengthA: null },
    );
    useApp.setState({ datasets: [{ ...DS, peakTable: legacy }] });
    const row = editPeak("d1", legacy.peaks[0].id, { height: 10 })!.peaks[0];
    expect(row.heightErr).toBeNull();
    expect(row.area).toBeCloseTo(8, 12); // rescaled
    expect(Object.keys(row)).not.toContain("areaErr");
    expect(Object.keys(row)).not.toContain("errReasons");
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
