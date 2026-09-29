import { describe, expect, it } from "vitest";

import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import type { Dataset } from "../../../lib/types";
import { fitResponse, makeRecord, xrrDataset } from "./reflFit.testkit";
import { buildChannel } from "./reflFitData";
import {
  curveDatasets,
  decimateIndices,
  decimationNote,
  MAX_CURVE_POINTS,
  savedCurves,
  savedOverlay,
} from "./reflFitCurves";
import { useApp } from "../../../store/useApp";
import {
  CURVE_HISTORY_LIMIT,
  channelDigest,
  decodeRecord,
  encodeRecord,
  recordsFor,
  withFitRecord,
  type ReflFitRecord,
} from "./reflFitRecord";

/** A record of a fit of `d`'s channel (R, dR, dQ columns) whose digest
 *  matches the data as it is now, carrying `fitResponse()`'s curves. */
function fittedRecord(d: Dataset): ReflFitRecord {
  const rec = makeRecord({}, [d.id]);
  const ch = rec.request.channels[0];
  Object.assign(ch, { rCol: 0, drCol: 1, dqCol: 2, rLabel: "Intensity", drLabel: "uncertainty", dqLabel: "resolution" });
  rec.request.settings = { ...rec.request.settings, qMin: null };
  ch.digest = channelDigest(buildChannel(d.data, new Set(), ch, rec.request.settings, "dr", null, "").channel);
  return { ...rec, curves: savedCurves(fitResponse()) };
}

describe("decimation", () => {
  it("keeps every point up to the cap, and thins evenly past it keeping both ends", () => {
    expect(decimateIndices(MAX_CURVE_POINTS)).toBeNull();
    const idx = decimateIndices(5000)!;
    expect(idx).toHaveLength(MAX_CURVE_POINTS);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(4999);
    expect(idx.every((v, i) => i === 0 || v > idx[i - 1])).toBe(true);
  });

  it("stores a thinned curve with its original count, and says so", () => {
    const n = 5;
    const res = fitResponse({
      curves: [{ label: "c", spin: null, q: [1, 2, 3, 4, 5], r: [5, 4, 3, 2, 1], dr: null, model: [5, null, 3, 2, 1], residual: [] }],
      sld_profiles: [{ spin: null, z: [0, 1], sld: [0, 1] }],
    });
    const c = savedCurves(res, 3);
    expect(c.channels[0]).toEqual({ label: "c", spin: null, q: [1, 3, 5], r: [5, 3, 1], model: [5, 3, 1], total: n });
    expect(c.sld[0].total).toBe(2);
    expect(decimationNote(c)).toBe("stored curves are thinned to 3 of 5 points");
    expect(decimationNote(savedCurves(res))).toBeNull();
    const [model] = curveDatasets(c, null, [], { weighting: "dr", radiation: "xray" });
    expect(model.data.metadata).toMatchObject({ decimated: { kept: 3, total: 5 } });
  });
});

describe("stored curves", () => {
  it("survive save -> reopen, NaN and null model points included", () => {
    const d = xrrDataset("xrr");
    const rec = fittedRecord(d);
    rec.curves!.channels[0].model = [0.9, Number.NaN, null];
    const [reopened] = parseWorkspace(serializeWorkspace({ datasets: withFitRecord([d], rec) })).datasets;
    const [back] = recordsFor(reopened);
    expect(back.curves).toEqual(rec.curves);
    expect(back.curves!.channels[0].model[1]).toBeNaN();
    expect(back.curves!.channels[0].model[2]).toBeNull();
    expect(back.curves!.sld[0]).toEqual({ spin: null, z: [-10, 0, 10], sld: [0, 7e-5, 2e-5], total: 3 });
  });

  it("a record written before curves were stored still loads, and says re-run to plot", () => {
    const d = xrrDataset("xrr");
    const legacy = encodeRecord(makeRecord({}, ["xrr"])) as Record<string, unknown>;
    expect("curves" in legacy).toBe(false);
    const [reopened] = parseWorkspace(serializeWorkspace({ datasets: [{ ...d, reflFits: [legacy] }] })).datasets;
    const [back] = recordsFor(reopened);
    expect(back.id).toBe("rfit-abc-1");
    expect(back.curves).toBeUndefined();
    expect(savedOverlay(back, [reopened])).toMatch(/not stored with this fit — re-run/);
  });

  it("a malformed curve costs the record its curves, never the record", () => {
    const stored = encodeRecord(fittedRecord(xrrDataset("xrr"))) as { curves: { channels: { r: unknown[] }[] } };
    stored.curves.channels[0].r = [1]; // length mismatch
    const back = decodeRecord(stored);
    expect(back?.id).toBe("rfit-abc-1");
    expect(back?.curves).toBeUndefined();
  });

  it("become named, placed, provenanced datasets without a re-run", () => {
    const d = xrrDataset("xrr", { workbookId: "wb-1" });
    const rec = fittedRecord(d);
    const out = curveDatasets(rec.curves!, rec, [d], { weighting: "dr", radiation: "xray" });
    expect(out.map((c) => c.name)).toEqual(["film.refl — refl fit #1 model", "film.refl — refl fit #1 SLD"]);
    expect(out[0].placement).toEqual({ workbookId: "wb-1" });
    expect(out[0].data.values).toEqual([[1, 0.9, -10], [0.5, 0.4, -10], [0.2, 0.1, -10]]);
    expect(out[0].data.metadata).toMatchObject({ reflFit: { fitId: rec.id, seq: 1, sourceIds: ["xrr"] } });
    expect(out[0].data.metadata).not.toHaveProperty("decimated");
  });
});

describe("stored residuals (P2.2)", () => {
  it("are stored beside the model, thinned on the same points, and survive save -> reopen", () => {
    const res = fitResponse({
      curves: [{ label: "c", spin: null, q: [1, 2, 3, 4, 5], r: [5, 4, 3, 2, 1], dr: [1, 1, 1, 1, 1], model: [5, 4, 3, 2, 1], residual: [0.5, 1, Number.NaN, 2, null] }],
    });
    expect(savedCurves(res, 3).channels[0].residual).toEqual([0.5, Number.NaN, null]);
    const d = xrrDataset("xrr");
    const rec = { ...fittedRecord(d), curves: savedCurves(res) };
    const [reopened] = parseWorkspace(serializeWorkspace({ datasets: withFitRecord([d], rec) })).datasets;
    const back = recordsFor(reopened)[0].curves!.channels[0].residual!;
    expect(back.slice(0, 2)).toEqual([0.5, 1]);
    expect(back[2]).toBeNaN();
    expect(back.slice(3)).toEqual([2, null]);
  });

  it("a residual array that does not match its points is not stored, and a bad stored one costs only itself", () => {
    const res = fitResponse();
    res.curves[0].residual = [1];
    expect(savedCurves(res).channels[0]).not.toHaveProperty("residual");
    const stored = encodeRecord(fittedRecord(xrrDataset("xrr"))) as { curves: { channels: { residual: unknown }[] } };
    for (const bad of [[1, 2], "residuals", { 0: 1 }]) {
      stored.curves.channels[0].residual = bad;
      const back = decodeRecord(stored)!;
      expect(back.curves!.channels[0].model).toEqual([0.9, 0.4, 0.1]);
      expect(back.curves!.channels[0]).not.toHaveProperty("residual");
    }
  });

  it("add a residual column to the fit-curve dataset, in the unit of the fit's weighting", () => {
    const d = xrrDataset("xrr");
    const [model] = curveDatasets(fittedRecord(d).curves!, null, [d], { weighting: "dr", radiation: "xray" });
    expect(model.data.labels).toEqual(["R", "R fit", "residual"]);
    expect(model.data.units).toEqual(["", "", "σ"]);
    expect(model.data.metadata).toMatchObject({ residual: "(R fit − R) / dR" });
  });

  it("a saved log fit from before residuals were stored gets them recomputed; a dR one keeps two columns", () => {
    const d = xrrDataset("xrr");
    const { residual: _r, ...legacy } = fittedRecord(d).curves!.channels[0];
    const curves = { channels: [legacy], sld: [] };
    const [log] = curveDatasets(curves, null, [d], { weighting: "log", radiation: "xray" });
    expect(log.data.units[2]).toBe("dex");
    expect(log.data.values[0][2]).toBeCloseTo(Math.log10(0.9), 15);
    const [dr] = curveDatasets(curves, null, [d], { weighting: "dr", radiation: "xray" });
    expect(dr.data.labels).toEqual(["R", "R fit"]);
  });
});

describe("the saved overlay", () => {
  it("aligns channel 1's stored model onto the dataset's rows", () => {
    const d = xrrDataset("xrr");
    expect(savedOverlay(fittedRecord(d), [d])).toEqual({ datasetId: "xrr", y: [0.9, null, 0.4, null, 0.1, null] });
  });

  it("refuses once the data changed or the dataset is gone", () => {
    const d = xrrDataset("xrr");
    const rec = fittedRecord(d);
    const edited = { ...d, data: { ...d.data, time: d.data.time.map((q) => q * 1.01) } };
    expect(savedOverlay(rec, [edited])).toMatch(/changed since this fit — re-run it to overlay/);
    expect(savedOverlay(rec, [])).toMatch(/no longer in the library/);
  });
});

describe("curve retention: only the newest records keep their curves", () => {
  /** `d` after `n` fits (#1..#n), each carrying curves. */
  function fitted(n: number) {
    let datasets = [xrrDataset("xrr")];
    for (let i = 1; i <= n; i++) {
      datasets = withFitRecord(datasets, { ...fittedRecord(datasets[0]), id: `rfit-${i}`, seq: i });
    }
    return datasets;
  }
  const withCurves = (d: Dataset) => recordsFor(d).map((r) => [r.seq, r.curves !== undefined]);

  it("the 4th-newest record loses its curves, the newest 3 keep theirs", () => {
    expect(CURVE_HISTORY_LIMIT).toBe(3);
    expect(withCurves(fitted(3)[0])).toEqual([[3, true], [2, true], [1, true]]);
    const [d] = fitted(5);
    expect(withCurves(d)).toEqual([[5, true], [4, true], [3, true], [2, false], [1, false]]);
    // An older record keeps its parameters and results, and reads "re-run".
    const old = recordsFor(d)[3];
    expect(old.result.parameters).toEqual(fittedRecord(xrrDataset("xrr")).result.parameters);
    expect(savedOverlay(old, [d])).toMatch(/re-run/);
  });

  it("survives save -> reopen as it was", () => {
    const [reopened] = parseWorkspace(serializeWorkspace({ datasets: fitted(4) })).datasets;
    expect(withCurves(reopened)).toEqual([[4, true], [3, true], [2, true], [1, false]]);
  });

  it("undo restores the previous state exactly, curves included", () => {
    const before = fitted(3);
    const frozen = JSON.parse(JSON.stringify(before[0].reflFits));
    useApp.setState({ datasets: before, history: [], future: [] });
    useApp.getState().recordHistory("reflectivity fit");
    useApp.setState((s) => ({ datasets: withFitRecord(s.datasets, { ...fittedRecord(s.datasets[0]), id: "rfit-4", seq: 4 }) }));
    expect(withCurves(useApp.getState().datasets[0])[3]).toEqual([1, false]);
    useApp.getState().undo();
    const restored = useApp.getState().datasets[0];
    expect(restored.reflFits).toEqual(frozen); // the stripped #1 comes back with its curves
    expect(withCurves(restored)).toEqual([[3, true], [2, true], [1, true]]);
  });
});
