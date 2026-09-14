import { describe, expect, it } from "vitest";

import {
  sanitizePeakTable,
  serializePeakTable,
  type MultiFitResult,
  type PeakTable,
} from "./peakTable";
import {
  includedPeaks,
  peakDataFingerprint,
  peakTableFromFit,
  peakTableMatchesData,
  peakTableToFitResult,
  peakTableXIsDegrees,
  withPeakExcluded,
} from "./peakTableFit";
import type { DataStruct } from "./types";

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
    // Unknown by default — an omitted source field must never be invented.
    expect(t.provenance.xLabel).toBe("");
    expect(t.provenance.xUnit).toBe("");
    expect(t.provenance.fingerprint).toBeNull();
  });

  it("records the x-axis identity and the data fingerprint when the caller supplies them", () => {
    const t = peakTableFromFit(fitResult([30.1]), {
      ...SOURCE,
      xLabel: "2Theta",
      xUnit: "deg",
      fingerprint: "fp-abc",
    });
    expect(t.provenance.xLabel).toBe("2Theta");
    expect(t.provenance.xUnit).toBe("deg");
    expect(t.provenance.fingerprint).toBe("fp-abc");
  });

  it("carries the user's exclusions across a re-fit of the same peak count", () => {
    const first = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[1].id, true);
    const refit = peakTableFromFit(fitResult([30.15, 43.25]), SOURCE, marked);
    expect(refit.peaks.map((p) => p.excluded)).toEqual([false, true]);
    // A re-fit is a NEW measurement: ids are minted fresh, never reused.
    expect(refit.peaks[0].id).not.toBe(first.peaks[0].id);
  });

  it("carries an exclusion onto the peak at the same CENTRE, not the same ROW", () => {
    // The reviewer's measured hole: `fitEach` publishes only the SUCCESSES, so
    // an N-of-M re-fit can land the SAME ROW COUNT on different physical peaks.
    // Here the user excluded 43.2 (row 1 of two); the re-fit drops 30.1 and
    // gains 55.0, so row 1 is now 55.0. Positional carry-over excluded the
    // wrong peak in silence.
    const first = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[1].id, true);
    const refit = peakTableFromFit(fitResult([43.2, 55.0]), SOURCE, marked);
    expect(refit.peaks.map((p) => [p.center, p.excluded])).toEqual([
      [43.2, true],
      [55.0, false],
    ]);
  });

  it("keeps carrying exclusions when the peak count CHANGES (identity, not length)", () => {
    const first = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[0].id, true);
    const refit = peakTableFromFit(fitResult([30.1, 43.2, 55.0]), SOURCE, marked);
    expect(refit.peaks.map((p) => p.excluded)).toEqual([true, false, false]);
  });

  it("drops an exclusion whose peak the re-fit no longer found", () => {
    const first = peakTableFromFit(fitResult([30.1, 43.2]), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[0].id, true);
    const refit = peakTableFromFit(fitResult([43.2, 55.0]), SOURCE, marked);
    expect(refit.peaks.map((p) => p.excluded)).toEqual([false, false]);
  });

  it("refuses to carry an exclusion onto a centre that moved more than half a FWHM", () => {
    // fitResult()'s first peak has FWHM 0.2, so the tolerance is 0.1.
    const first = peakTableFromFit(fitResult([30.1]), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[0].id, true);
    expect(peakTableFromFit(fitResult([30.19]), SOURCE, marked).peaks[0].excluded).toBe(true);
    expect(peakTableFromFit(fitResult([30.25]), SOURCE, marked).peaks[0].excluded).toBe(false);
  });

  it("never gives two exclusions the same row", () => {
    const first = peakTableFromFit(fitResult([30.1, 30.15]), SOURCE);
    let marked = withPeakExcluded(first, first.peaks[0].id, true);
    marked = withPeakExcluded(marked, first.peaks[1].id, true);
    // Only one row survives the re-fit; the second exclusion finds it taken.
    const refit = peakTableFromFit(fitResult([30.12]), SOURCE, marked);
    expect(refit.peaks.map((p) => p.excluded)).toEqual([true]);
  });
});

// ── Data fingerprint + x-axis identity (review round 2) ───────────────────

const scan = (over: Partial<DataStruct> = {}): DataStruct => ({
  time: [10, 20, 30, 40],
  values: [[1], [9], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
  ...over,
});

describe("peakDataFingerprint", () => {
  it("is deterministic for identical data and equal across separate objects", () => {
    expect(peakDataFingerprint(scan())).toBe(peakDataFingerprint(scan()));
  });

  it("changes when a single measured value is edited", () => {
    expect(peakDataFingerprint(scan({ values: [[1], [500], [2], [1]] }))).not.toBe(
      peakDataFingerprint(scan()),
    );
  });

  it("changes when the x channel is shifted, with the row count unchanged", () => {
    // The xOff-correction case: every 2-theta moves, nothing else does.
    expect(peakDataFingerprint(scan({ time: [10.5, 20.5, 30.5, 40.5] }))).not.toBe(
      peakDataFingerprint(scan()),
    );
  });

  it("changes when rows are added or removed", () => {
    expect(peakDataFingerprint(scan({ time: [10, 20, 30], values: [[1], [9], [2]] }))).not.toBe(
      peakDataFingerprint(scan()),
    );
  });

  it("changes when a column is added", () => {
    expect(
      peakDataFingerprint(scan({ values: [[1, 0], [9, 0], [2, 0], [1, 0]], labels: ["I", "b"] })),
    ).not.toBe(peakDataFingerprint(scan()));
  });

  it("does not confuse NaN with 0, or -0 with 0", () => {
    const zero = peakDataFingerprint(scan({ values: [[0], [0], [0], [0]] }));
    expect(peakDataFingerprint(scan({ values: [[NaN], [NaN], [NaN], [NaN]] }))).not.toBe(zero);
    expect(peakDataFingerprint(scan({ values: [[-0], [-0], [-0], [-0]] }))).not.toBe(zero);
  });

  it("ignores labels/units/metadata — a rename is not a data change", () => {
    expect(peakDataFingerprint(scan({ labels: ["counts"], units: ["a.u."], metadata: { k: 1 } }))).toBe(
      peakDataFingerprint(scan()),
    );
  });
});

describe("peakTableMatchesData", () => {
  const fitted = (data: DataStruct): PeakTable =>
    peakTableFromFit(fitResult([30.1]), { ...SOURCE, fingerprint: peakDataFingerprint(data) });

  it("matches the data it was fit from", () => {
    expect(peakTableMatchesData(fitted(scan()), scan())).toBe(true);
  });

  it("does NOT match once a value changed", () => {
    expect(peakTableMatchesData(fitted(scan()), scan({ values: [[1], [500], [2], [1]] }))).toBe(false);
  });

  it("treats a record with no fingerprint as unknown, which reads as still valid", () => {
    // A pre-round-2 `.dwk` must still show the fit it was saved with.
    expect(peakTableFromFit(fitResult([30.1]), SOURCE).provenance.fingerprint).toBeNull();
    expect(peakTableMatchesData(peakTableFromFit(fitResult([30.1]), SOURCE), scan())).toBe(true);
  });
});

describe("peakTableXIsDegrees", () => {
  const withUnit = (xUnit: string): PeakTable =>
    peakTableFromFit(fitResult([30.1]), { ...SOURCE, xLabel: "2Theta", xUnit });

  it("accepts degrees in the spellings real files use", () => {
    for (const u of ["deg", "Deg", "degrees", "°", " ° "]) {
      expect(peakTableXIsDegrees(withUnit(u))).toBe(true);
    }
  });

  it("accepts an unrecorded unit — most XRD files carry none", () => {
    expect(peakTableXIsDegrees(withUnit(""))).toBe(true);
    expect(peakTableXIsDegrees(peakTableFromFit(fitResult([30.1]), SOURCE))).toBe(true);
  });

  it("refuses a reciprocal-space or real-space axis", () => {
    for (const u of ["1/A", "Å⁻¹", "nm", "1/nm"]) {
      expect(peakTableXIsDegrees(withUnit(u))).toBe(false);
    }
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

describe("sanitizePeakTable — the round-2 provenance fields", () => {
  it("round-trips the x identity and the fingerprint", () => {
    const t = peakTableFromFit(fitResult([30.1, 43.2]), {
      ...SOURCE,
      xLabel: "2Theta",
      xUnit: "deg",
      fingerprint: "fp-abc",
    });
    const back = sanitizePeakTable(JSON.parse(JSON.stringify(serializePeakTable(t))));
    expect(back?.provenance.xLabel).toBe("2Theta");
    expect(back?.provenance.xUnit).toBe("deg");
    expect(back?.provenance.fingerprint).toBe("fp-abc");
  });

  it("degrades a missing or non-string fingerprint to null, not to a match", () => {
    const doc = JSON.parse(
      JSON.stringify(peakTableFromFit(fitResult([30.1]), { ...SOURCE, fingerprint: "fp-abc" })),
    ) as { provenance: Record<string, unknown> };
    delete doc.provenance.fingerprint;
    expect(sanitizePeakTable(doc)?.provenance.fingerprint).toBeNull();
    doc.provenance.fingerprint = 7;
    expect(sanitizePeakTable(doc)?.provenance.fingerprint).toBeNull();
    doc.provenance.xUnit = 7;
    expect(sanitizePeakTable(doc)?.provenance.xUnit).toBe("");
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
