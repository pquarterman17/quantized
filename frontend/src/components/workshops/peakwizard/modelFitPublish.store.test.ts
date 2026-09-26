// The model-fit table through the REAL store writers (store/peakTablePublish.ts, store/peakTables.ts):
// publishing stamps the live dataset and records one undo step, and a manual
// edit clears exactly the changed fields' errors — tested on a table whose
// errors are real non-null model-fit errors, not hand-planted ones.

import { beforeEach, describe, expect, it } from "vitest";

import { sanitizePeakTable, serializePeakTable, type PeakTable } from "../../../lib/peakTable";
import { MANUAL_EDIT_REASON, peakDataFingerprint, peakTableFromFit } from "../../../lib/peakTableFit";
import type { DataStruct } from "../../../lib/types";
import { editPeak, publishFitResult, removePeaks } from "../../../store/peakTables";
import { publishBuiltTable } from "../../../store/peakTablePublish";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import { modelFitDraft } from "./modelFitPublish";
import { publishModelFit } from "./modelFitPublishRun";

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0.5], [1], [5.7], [1.2], [2.6], [0.6]],
  labels: ["I"],
  units: ["cps"],
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg", wavelength_a: 1.5406 },
};

function publish(res = modelFitResponse()): PeakTable | null {
  return publishModelFit("d1", null, modelFitDraft(res)) === null
    ? null
    : useApp.getState().datasets[0].peakTable ?? null;
}

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "film.xrdml", data: DATA }],
    activeId: "d1",
    history: [],
    future: [],
  });
});

describe("publishBuiltTable with a model fit", () => {
  it("stamps the live dataset and records one undo step", () => {
    const t = publish();
    const ds = useApp.getState().datasets[0];
    expect(ds.peakTable).toBe(t);
    expect(t?.provenance).toMatchObject({
      datasetId: "d1", datasetName: "film.xrdml", xLabel: "2-Theta", xUnit: "deg",
      wavelengthA: 1.5406, producer: "model_fit",
    });
    expect(t?.provenance.fingerprint).toBe(peakDataFingerprint(ds));
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["publish model fit"]);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].peakTable).toBeUndefined();
  });

  it("is a no-op for an unknown dataset", () => {
    expect(publishBuiltTable("gone", null, "x", () => { throw new Error("must not build"); })).toBeNull();
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("replaces a classic table, carrying its exclusions by identity", () => {
    publishFitResult("d1", {
      peaks: [
        { center: 2.0, fwhm: 0.8, height: 5, bg: 0, eta: null, area: 5, status: "fitted", model: "Gaussian" },
        { center: 4.0, fwhm: 0.8, height: 2, bg: 0, eta: null, area: 2, status: "fitted", model: "Gaussian" },
      ], bgCoeffs: [], R2: 0.9, rmse: 0.1, nPeaks: 2, model: "Gaussian",
    }, "simultaneous", { bgDegree: 0, linkMode: "None", constrain: false, xKey: null });
    const classic = useApp.getState().datasets[0].peakTable!;
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => ({ ...d, peakTable: { ...classic, peaks: classic.peaks.map((p, i) => ({ ...p, excluded: i === 0 })) } })),
    }));
    const t = publish();
    expect(t?.peaks.map((p) => p.excluded)).toEqual([true, false]);
    expect(t?.peaks[0].centerErr).toBe(0.004);
  });
});

describe("a manual edit of a model-fit row (real non-null errors)", () => {
  it("clears the changed field's error, keeps the others, and says why", () => {
    const p = publish()!.peaks[0]; // centerErr 0.004, fwhmErr 0.01, heightErr 0.05, areaErr null (eta at bound)
    const next = editPeak("d1", p.id, { center: 2.05, fwhm: p.fwhm, height: p.height, area: p.area })!;
    const q = next.peaks[0];
    expect(q.center).toBe(2.05);
    expect(q.centerErr).toBeNull();
    expect(q.errReasons?.center).toBe(MANUAL_EDIT_REASON);
    expect([q.fwhmErr, q.heightErr]).toEqual([0.01, 0.05]);
    expect(q.errReasons?.fwhm).toBeUndefined();
    expect(q.errReasons?.area).toBe(p.errReasons?.area); // untouched: the producer's reason stays
    expect(next.provenance.R2).toBeNull();
    expect(next.provenance.objective).toBeUndefined();
    expect(next.provenance.producer).toBe("model_fit");
  });

  it("a height edit also clears the error of the area it rescales", () => {
    const p = publish()!.peaks[1]; // areaErr 0.03
    expect(p.areaErr).toBe(0.03);
    const q = editPeak("d1", p.id, { center: p.center, fwhm: p.fwhm, height: 4.2, area: p.area })!.peaks[1];
    expect(q.area).toBeCloseTo(1.81 * 2, 12);
    expect([q.heightErr, q.areaErr]).toEqual([null, null]);
    expect(q.errReasons).toMatchObject({ height: MANUAL_EDIT_REASON, area: MANUAL_EDIT_REASON });
    expect(q.fwhmErr).toBe(0.01);
  });

  it("an explicit area edit clears only the area error", () => {
    const p = publish()!.peaks[1];
    const q = editPeak("d1", p.id, { center: p.center, fwhm: p.fwhm, height: p.height, area: 2.5 })!.peaks[1];
    expect(q.areaErr).toBeNull();
    expect([q.fwhmErr, q.heightErr]).toEqual([0.01, 0.04]);
  });

  it("an FWHM edit drops a Voigt row's component widths", () => {
    const res = modelFitResponse();
    res.peaks[1] = { ...res.peaks[1], shape: "voigt" };
    res.parameters = [
      ...res.parameters,
      { name: "p1.fwhm_g", value: 0.3, stderr: 0.02, vary: true, tie: null, at_bound: false },
      { name: "p1.fwhm_l", value: 0.6, stderr: 0.03, vary: true, tie: null, at_bound: false },
    ];
    const p = publish(res)!.peaks[1];
    expect([p.fwhmG, p.fwhmL]).toEqual([0.3, 0.6]);
    const q = editPeak("d1", p.id, { center: p.center, fwhm: 1.0, height: p.height, area: p.area })!.peaks[1];
    expect([q.fwhmG, q.fwhmL, q.fwhmErr]).toEqual([null, null, null]);
  });

  it("a classic row gains no reason it would have to explain", () => {
    publishFitResult("d1", {
      peaks: [{ center: 2.0, fwhm: 0.8, height: 5, bg: 0, eta: null, area: 5, status: "fitted", model: "Gaussian" }],
      bgCoeffs: [], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian",
    }, "simultaneous", { bgDegree: 0, linkMode: "None", constrain: false, xKey: null });
    const p = useApp.getState().datasets[0].peakTable!.peaks[0];
    const q = editPeak("d1", p.id, { center: 2.1, fwhm: p.fwhm, height: 6, area: p.area })!.peaks[0];
    expect(q.errReasons).toBeUndefined();
    expect("areaErr" in q).toBe(false);
  });

  it("removing a peak keeps the others' errors and clears the objective", () => {
    const t = publish()!;
    const next = removePeaks("d1", new Set([t.peaks[0].id]))!;
    expect(next.peaks[0].heightErr).toBe(0.04);
    expect(next.provenance.objective).toBeUndefined();
  });

  it("the edited table survives the .dwk codec with its errors and reasons", () => {
    const p = publish()!.peaks[0];
    const edited = editPeak("d1", p.id, { center: 2.05, fwhm: p.fwhm, height: p.height, area: p.area })!;
    const back = sanitizePeakTable(JSON.parse(JSON.stringify(serializePeakTable(edited))));
    expect(back).toEqual(edited);
  });

  it("the classic producer is untouched: every error slot stays null", () => {
    const t = peakTableFromFit(
      { peaks: [{ center: 2, fwhm: 1, height: 1, bg: 0, eta: null, area: 1, status: "fitted", model: "Gaussian" }],
        bgCoeffs: [], R2: null, rmse: null, nPeaks: 1, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x", method: "simultaneous", bgDegree: 0, linkMode: "None", constrain: false, wavelengthA: null },
    );
    expect(t.peaks[0]).toMatchObject({ centerErr: null, fwhmErr: null, heightErr: null });
    expect(t.provenance.producer).toBeUndefined();
  });
});
