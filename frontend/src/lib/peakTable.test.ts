import { describe, expect, it } from "vitest";

import {
  sanitizePeakTable,
  serializePeakTable,
  type MultiFitResult,
  type PeakTable,
} from "./peakTable";
import {
  includedPeaks,
  peakTableFromFit,
  peakTableToFitResult,
  withPeakExcluded,
} from "./peakTableFit";

function fitResult(centers: number[]): MultiFitResult {
  return {
    peaks: centers.map((c, i) => ({
      center: c,
      fwhm: 0.2 + i * 0.01,
      height: 100 - i,
      bg: 5,
      eta: null,
      area: 20 + i,
      status: "fitted(global)",
      model: "Gaussian",
    })),
    bgCoeffs: [5, 0],
    R2: 0.997,
    rmse: 0.4,
    nPeaks: centers.length,
    model: "Gaussian",
  };
}

const SOURCE = {
  datasetId: "d1",
  datasetName: "film.xrdml",
  method: "simultaneous" as const,
  bgDegree: 1,
  linkMode: "None",
  constrain: false,
  wavelengthA: 1.5406,
  now: new Date("2026-09-14T12:00:00.000Z"),
};

describe("peakTableFromFit", () => {
  it("carries every column P2.1 asks for, with uncertainty slots null", () => {
    const t = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    expect(t.version).toBe(1);
    expect(t.peaks).toHaveLength(2);
    expect(t.peaks[0].center).toBe(30.1);
    expect(t.peaks[0].fwhm).toBeCloseTo(0.2);
    expect(t.peaks[0].height).toBe(100);
    expect(t.peaks[0].model).toBe("Gaussian");
    expect(t.peaks[0].excluded).toBe(false);
    // Modelled, not measured — no fit engine reports a standard error today.
    expect(t.peaks[0].centerErr).toBeNull();
    expect(t.peaks[0].fwhmErr).toBeNull();
    expect(t.peaks[0].heightErr).toBeNull();
  });

  it("gives every peak a distinct durable id", () => {
    const t = peakTableFromFit(fitResult([30.1, 43.2, 50.5]), SOURCE);
    const ids = new Set(t.peaks.map((p) => p.id));
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id).toBeTruthy();
  });

  it("records the provenance: dataset, method, fit parameters, wavelength, time", () => {
    const t = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    expect(t.provenance).toMatchObject({
      datasetId: "d1",
      datasetName: "film.xrdml",
      method: "simultaneous",
      model: "Gaussian",
      bgDegree: 1,
      linkMode: "None",
      constrain: false,
      R2: 0.997,
      rmse: 0.4,
      wavelengthA: 1.5406,
      fittedAt: "2026-09-14T12:00:00.000Z",
    });
    expect(t.provenance.bgCoeffs).toEqual([5, 0]);
  });

  it("carries the user's exclusions across a re-fit of the same peak count", () => {
    const first = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[1].id, true);
    const refit = peakTableFromFit(fitResult([30.15, 43.25]), SOURCE, marked);
    expect(refit.peaks.map((p) => p.excluded)).toEqual([false, true]);
    // A re-fit is a NEW measurement: ids are minted fresh, never reused.
    expect(refit.peaks[0].id).not.toBe(first.peaks[0].id);
  });

  it("abandons the exclusion mapping when the peak count changed", () => {
    const first = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[0].id, true);
    const refit = peakTableFromFit(fitResult([30.1, 43.2, 55.0]), SOURCE, marked);
    expect(refit.peaks.map((p) => p.excluded)).toEqual([false, false, false]);
  });
});

describe("includedPeaks / withPeakExcluded", () => {
  it("drops excluded rows and keeps the rest in order", () => {
    let t = peakTableFromFit(fitResult([30.1, 43.2, 50.5]), SOURCE);
    t = withPeakExcluded(t, t.peaks[1].id, true);
    expect(includedPeaks(t).map((p) => p.center)).toEqual([30.1, 50.5]);
  });

  it("returns the SAME reference for an unknown id (so no pointless store write)", () => {
    const t = peakTableFromFit(fitResult([30.1]), SOURCE);
    expect(withPeakExcluded(t, "no-such-peak", true)).toBe(t);
  });

  it("un-excluding restores the row", () => {
    let t = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const id = t.peaks[0].id;
    t = withPeakExcluded(t, id, true);
    expect(includedPeaks(t)).toHaveLength(1);
    t = withPeakExcluded(t, id, false);
    expect(includedPeaks(t)).toHaveLength(2);
  });
});

describe("peakTableToFitResult", () => {
  it("round-trips a fit result losslessly, excluded peaks included", () => {
    const res = fitResult([30.1, 43.2]);
    let t = peakTableFromFit(res, SOURCE);
    t = withPeakExcluded(t, t.peaks[0].id, true);
    const back = peakTableToFitResult(t);
    expect(back).toEqual(res);
  });
});

describe("sanitizePeakTable", () => {
  const good = (): unknown => JSON.parse(JSON.stringify(peakTableFromFit(fitResult([30.1, 43.2]), SOURCE)));

  it("accepts a well-formed record", () => {
    const t = sanitizePeakTable(good());
    expect(t?.peaks).toHaveLength(2);
    expect(t?.provenance.datasetId).toBe("d1");
  });

  it("rejects a non-object, a wrong version, a missing provenance and a missing datasetId", () => {
    expect(sanitizePeakTable(null)).toBeUndefined();
    expect(sanitizePeakTable("nope")).toBeUndefined();
    const v2 = good() as Record<string, unknown>;
    v2.version = 2;
    expect(sanitizePeakTable(v2)).toBeUndefined();
    const noProv = good() as Record<string, unknown>;
    delete noProv.provenance;
    expect(sanitizePeakTable(noProv)).toBeUndefined();
    const noId = good() as { provenance: Record<string, unknown> };
    noId.provenance.datasetId = "";
    expect(sanitizePeakTable(noId)).toBeUndefined();
  });

  it("drops a row missing center/fwhm/height rather than defaulting it into a fit", () => {
    const doc = good() as { peaks: Record<string, unknown>[] };
    delete doc.peaks[0].fwhm;
    const t = sanitizePeakTable(doc);
    expect(t?.peaks).toHaveLength(1);
    expect(t?.peaks[0].center).toBe(43.2);
  });

  it("degrades to undefined when every row is unusable", () => {
    const doc = good() as { peaks: unknown[] };
    doc.peaks = [null, { center: 1 }];
    expect(sanitizePeakTable(doc)).toBeUndefined();
  });

  it("rejects a non-finite number rather than letting NaN reach a reduction", () => {
    const doc = good() as { peaks: Record<string, unknown>[] };
    doc.peaks[0].center = null; // what JSON.stringify writes for NaN/Infinity
    const t = sanitizePeakTable(doc);
    expect(t?.peaks).toHaveLength(1);
    expect(t?.peaks[0].center).toBe(43.2);
  });

  it("defaults a missing excluded flag to false and keeps a true one", () => {
    const doc = good() as { peaks: Record<string, unknown>[] };
    delete doc.peaks[0].excluded;
    doc.peaks[1].excluded = true;
    const t = sanitizePeakTable(doc);
    expect(t?.peaks.map((p) => p.excluded)).toEqual([false, true]);
  });

  it("mints a stable fallback id for a row that lost one", () => {
    const doc = good() as { peaks: Record<string, unknown>[] };
    delete doc.peaks[1].id;
    const t = sanitizePeakTable(doc);
    expect(t?.peaks[1].id).toBe("peak-restored-1");
  });
});

describe("serializePeakTable", () => {
  it("copies rather than aliasing the live record", () => {
    const t = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const out = serializePeakTable(t);
    expect(out).toEqual(t);
    expect(out.peaks[0]).not.toBe(t.peaks[0]);
    expect(out.provenance.bgCoeffs).not.toBe(t.provenance.bgCoeffs);
  });

  it("survives a JSON round trip through the sanitizer unchanged", () => {
    const t: PeakTable = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const back = sanitizePeakTable(JSON.parse(JSON.stringify(serializePeakTable(t))));
    expect(back).toEqual(t);
  });
});
