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
import type { DataStruct, Dataset } from "./types";

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

/** `fitResult` with one FWHM for every peak — the carry-over tolerance is half
 *  the smaller FWHM, so the Kα1/Kα2 cases below need to set it explicitly. */
function wide(centers: number[], fwhm: number): MultiFitResult {
  const r = fitResult(centers);
  return { ...r, peaks: r.peaks.map((p) => ({ ...p, fwhm })) };
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

  it("does NOT inherit a vanished exclusion onto the neighbour the user KEPT", () => {
    // Round 3 CONFIRMED 3, at Kα1/Kα2 spacing: 0.20° apart, FWHM 0.50°, so the
    // half-FWHM tolerance is 0.25° and the surviving 20.20 peak sits INSIDE
    // it. Nearest-from-the-exclusion's-side alone therefore excluded the peak
    // the user deliberately kept, and `includedPeaks` dropped it out of
    // Williamson-Hall in silence. 20.20's own nearest prior peak is the 20.20
    // row, not the excluded 20.00 one, so the match is not mutual.
    const first = peakTableFromFit(wide([20.0, 20.2], 0.5), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[0].id, true);
    const refit = peakTableFromFit(wide([20.2], 0.5), SOURCE, marked);
    expect(refit.peaks.map((p) => [p.center, p.excluded])).toEqual([[20.2, false]]);
  });

  it("does NOT inherit onto a peak that MERGED an excluded and a kept one", () => {
    // 30.0 (excluded) + 30.1 (kept) re-fit as one 30.05 peak: equidistant from
    // both, so the inheritance is ambiguous and is not made.
    const first = peakTableFromFit(wide([30.0, 30.1], 0.5), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[0].id, true);
    const refit = peakTableFromFit(wide([30.05], 0.6), SOURCE, marked);
    expect(refit.peaks.map((p) => p.excluded)).toEqual([false]);
  });

  it("still carries when the excluded peak IS the nearest prior row", () => {
    // The positive control for the mutual-nearest guard: same spacing and
    // tolerance as the two cases above, but the peak that survives is the
    // EXCLUDED one, so the match is mutual and the exclusion is kept.
    const first = peakTableFromFit(wide([20.0, 20.2], 0.5), SOURCE);
    const marked = withPeakExcluded(first, first.peaks[0].id, true);
    const refit = peakTableFromFit(wide([20.01], 0.5), SOURCE, marked);
    expect(refit.peaks.map((p) => [p.center, p.excluded])).toEqual([[20.01, true]]);
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

// ── Data fingerprint + x-axis identity (review rounds 2 and 3) ────────────

/** A minimal Dataset around a DataStruct — `peakDataFingerprint` digests the
 *  dataset's ANALYSIS VIEW, so it takes the dataset, not the raw struct. */
const scan = (over: Partial<DataStruct> = {}, ds: Partial<Dataset> = {}): Dataset => ({
  id: "d1",
  name: "film.xrdml",
  data: {
    time: [10, 20, 30, 40],
    values: [[1], [9], [2], [1]],
    labels: ["I"],
    units: ["cps"],
    metadata: {},
    ...over,
  },
  ...ds,
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

  it("changes when an INTERIOR x value moves and the extremes do not", () => {
    // Round 3 CONFIRMED 1: the round-2 digest reduced x to length/first/last/
    // min/max, so pasting over one interior 2-theta cell was invisible to it.
    expect(peakDataFingerprint(scan({ time: [10, 21, 30, 40] }))).not.toBe(
      peakDataFingerprint(scan({ time: [10, 20, 30, 40] })),
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

  it("changes when a column LABEL or UNIT is corrected (round 3 NIT 3)", () => {
    // The unit is what Williamson-Hall reads to decide the axis is 2-theta, so
    // correcting a mis-imported `""` to `1/A` must invalidate the table.
    expect(peakDataFingerprint(scan({ labels: ["counts"] }))).not.toBe(peakDataFingerprint(scan()));
    expect(peakDataFingerprint(scan({ units: ["a.u."] }))).not.toBe(peakDataFingerprint(scan()));
  });

  it("does not split labels ambiguously — ['ab'] and ['a','b'] differ", () => {
    const two = scan({ values: [[1, 0], [9, 0], [2, 0], [1, 0]], labels: ["a", "b"], units: ["", ""] });
    const one = scan({ values: [[1, 0], [9, 0], [2, 0], [1, 0]], labels: ["ab", ""], units: ["", ""] });
    expect(peakDataFingerprint(two)).not.toBe(peakDataFingerprint(one));
  });

  it("ignores metadata — a sidecar note is not a measurement", () => {
    expect(peakDataFingerprint(scan({ metadata: { k: 1 } }))).toBe(peakDataFingerprint(scan()));
  });

  it("changes when a row is EXCLUDED — the fit's real input is the analysis view", () => {
    // Round 3 CONFIRMED 4: the fit runs on `analysisData(ds)`, so a row
    // exclusion moves its input while the raw `ds.data` is untouched.
    expect(peakDataFingerprint(scan({}, { excludedRows: [2] }))).not.toBe(peakDataFingerprint(scan()));
    // And a DIFFERENT row excluded is a different view again.
    expect(peakDataFingerprint(scan({}, { excludedRows: [2] }))).not.toBe(
      peakDataFingerprint(scan({}, { excludedRows: [1] })),
    );
  });
});

describe("peakTableMatchesData", () => {
  const fitted = (ds: Dataset): PeakTable =>
    peakTableFromFit(fitResult([30.1]), { ...SOURCE, fingerprint: peakDataFingerprint(ds) });

  it("matches the data it was fit from", () => {
    expect(peakTableMatchesData(fitted(scan()), scan())).toBe(true);
  });

  it("still matches a structurally IDENTICAL re-import of the same numbers", () => {
    // The same-shape reimport path keeps the table; identical bytes must keep
    // it USABLE, or every re-import would demand a pointless re-fit.
    expect(peakTableMatchesData(fitted(scan()), scan({}, { id: "d1-reimported" }))).toBe(true);
  });

  it("does NOT match once a value changed", () => {
    expect(peakTableMatchesData(fitted(scan()), scan({ values: [[1], [500], [2], [1]] }))).toBe(false);
  });

  it("does NOT match once an interior x cell is pasted over", () => {
    expect(peakTableMatchesData(fitted(scan()), scan({ time: [10, 21, 30, 40] }))).toBe(false);
  });

  it("does NOT match once a column is renamed", () => {
    expect(peakTableMatchesData(fitted(scan()), scan({ labels: ["counts"] }))).toBe(false);
  });

  it("does NOT match once a row is excluded", () => {
    expect(peakTableMatchesData(fitted(scan()), scan({}, { excludedRows: [2] }))).toBe(false);
  });

  it("treats a record with no fingerprint as unknown, which reads as still valid", () => {
    // A pre-round-2 `.dwk` must still show the fit it was saved with.
    expect(peakTableFromFit(fitResult([30.1]), SOURCE).provenance.fingerprint).toBeNull();
    expect(peakTableMatchesData(peakTableFromFit(fitResult([30.1]), SOURCE), scan())).toBe(true);
  });
});

describe("peakTableXIsDegrees", () => {
  const withUnit = (xUnit: string, xLabel = "2Theta"): PeakTable =>
    peakTableFromFit(fitResult([30.1]), { ...SOURCE, xLabel, xUnit });

  it("accepts degrees in the spellings real files use", () => {
    for (const u of ["deg", "Deg", "degree", "degrees", "°", " ° "]) {
      expect(peakTableXIsDegrees(withUnit(u))).toBe(true);
    }
  });

  it("refuses a unit that merely CONTAINS a degree spelling (degC, °C)", () => {
    // Round 3 CONFIRMED 2: `includes("deg")`/`includes("°")` passed a
    // magnetometry M(T) curve in Celsius, whose 0..180 range also clears the
    // reduction's own `0 < 2θ < 180` check.
    for (const u of ["degC", "°C", "degF", "deg C", "degrees C"]) {
      expect(peakTableXIsDegrees(withUnit(u))).toBe(false);
    }
  });

  it("accepts an unrecorded unit only on 2θ LABEL evidence — most XRD files carry none", () => {
    for (const label of ["2Theta", "2-Theta", "2 theta", "2θ", "two_theta", "Two Theta"]) {
      expect(peakTableXIsDegrees(withUnit("", label))).toBe(true);
    }
  });

  it("refuses a unit-less axis with no 2θ evidence in its label", () => {
    // The case round 2 measured end to end: a unit-less q CSV loaded into the
    // 2-theta column and produced a plausible-looking grain size.
    for (const label of ["q", "Q", "d", "d-spacing", ""]) {
      expect(peakTableXIsDegrees(withUnit("", label))).toBe(false);
    }
    // ... including a record that names no axis at all.
    expect(peakTableXIsDegrees(peakTableFromFit(fitResult([30.1]), SOURCE))).toBe(false);
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
