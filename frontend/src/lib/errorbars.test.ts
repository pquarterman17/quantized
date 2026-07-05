import { describe, expect, it } from "vitest";

import {
  buildErrorColumns,
  defaultErrKeys,
  originErrKeys,
  originHiddenChannels,
} from "./errorbars";
import type { DataStruct } from "./types";

/** Build an Origin-shaped DataStruct carrying only the metadata originErrKeys
 *  reads (value-column short names in channel order + their designations). */
function origin(names: string[], desig: Record<string, string>): DataStruct {
  return {
    time: [0, 1],
    values: [names.map(() => 0), names.map(() => 0)],
    labels: [...names],
    units: names.map(() => ""),
    metadata: { origin_column_names: names, column_designations: desig },
  };
}

const ds: DataStruct = {
  time: [0, 1, 2],
  values: [
    [10, 0.5, 100],
    [20, 0.6, 200],
    [30, -0.7, 300], // signed error → magnitude
  ],
  labels: ["M", "dM", "T"],
  units: ["emu", "emu", "K"],
  metadata: {},
};

describe("buildErrorColumns", () => {
  it("keys errors by display column (p+1) for channels with an err mapping", () => {
    // Plot M (ch 0) and T (ch 2); M's error is ch 1, T has none.
    const m = buildErrorColumns(ds, [0, 2], { 0: 1 });
    expect([...m.keys()]).toEqual([1]); // only the first plotted series (column 1)
    expect(m.get(1)).toEqual([0.5, 0.6, 0.7]); // abs of dM
  });

  it("respects plotted order when assigning columns", () => {
    // Plot T (ch 2) first, then M (ch 0). M's error (ch 1) lands on column 2.
    const m = buildErrorColumns(ds, [2, 0], { 0: 1 });
    expect([...m.keys()]).toEqual([2]);
    expect(m.get(2)).toEqual([0.5, 0.6, 0.7]);
  });

  it("returns an empty map when no channel has an error mapping", () => {
    expect(buildErrorColumns(ds, [0, 2], {}).size).toBe(0);
  });

  it("maps non-finite error values to null", () => {
    const withNaN: DataStruct = {
      ...ds,
      values: [
        [10, NaN, 100],
        [20, Infinity, 200],
        [30, 0.7, 300],
      ],
    };
    expect(buildErrorColumns(withNaN, [0], { 0: 1 }).get(1)).toEqual([null, null, 0.7]);
  });
});

// Patterns below are the actual designations decoded from the reflectometry
// corpus (probed 2026-07-05), so the expected pairings are ground truth.
describe("originErrKeys (Origin Y-error → error-bar defaults)", () => {
  it("pairs each Y-error with the nearest preceding Y (Fixed Lambdas layout)", () => {
    // A=X (→time, excluded); value cols: dQ, R++, dR++, R--, dR--, T++, T--, SA, dSA, T-SA
    const ds = origin(["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"], {
      A: "X",
      B: "Y-error", // dQ — leading, no preceding Y → skipped
      C: "Y", // R++
      D: "Y-error", // dR++ → C
      E: "Y", // R--
      F: "Y-error", // dR-- → E
      G: "Y", // T++
      H: "Y", // T--
      I: "Y", // SA
      J: "Y-error", // dSA → I
      K: "Y", // T SA
    });
    expect(originErrKeys(ds)).toEqual({ 1: 2, 3: 4, 7: 8 });
  });

  it("ignores X-error columns (MnN Book1 layout: dQ is X-error)", () => {
    const ds = origin(["B", "C", "D", "E", "F", "G"], {
      A: "X",
      B: "X-error", // dQ — X-error, ignored
      C: "Y", // R++
      D: "Y-error", // dR++ → C
      E: "Y", // R--
      F: "Y-error", // dR-- → E
      G: "Y",
    });
    expect(originErrKeys(ds)).toEqual({ 1: 2, 3: 4 });
  });

  it("pairs a lone Y-error to its preceding Y (UnpolPlots layout)", () => {
    const ds = origin(["B", "C", "D", "E", "F", "G", "H", "I"], {
      A: "X",
      B: "Y",
      C: "Y",
      D: "Y",
      E: "Y",
      F: "Y",
      G: "Y", // R/Rsub
      H: "Y-error", // dR Fresnel → G
      I: "Y",
    });
    expect(originErrKeys(ds)).toEqual({ 5: 6 });
  });

  it("returns empty for a multi-XY book with no error columns (RockingCurve)", () => {
    const ds = origin(["B", "C", "D", "E", "F"], {
      A: "X",
      B: "Y",
      C: "X",
      D: "Y",
      E: "X",
      F: "Y",
    });
    expect(originErrKeys(ds)).toEqual({});
  });

  it("returns empty for non-Origin data (no designation metadata)", () => {
    const plain: DataStruct = {
      time: [0],
      values: [[1, 2]],
      labels: ["a", "b"],
      units: ["", ""],
      metadata: {},
    };
    expect(originErrKeys(plain)).toEqual({});
  });

  it("skips a Y-error with no preceding Y", () => {
    const ds = origin(["B", "C"], { A: "X", B: "Y-error", C: "Y" });
    expect(originErrKeys(ds)).toEqual({}); // B has no preceding Y (A is X, excluded)
  });

  it("originHiddenChannels hides ALL error columns incl. unpaired X-error (MnN Book1)", () => {
    const ds = origin(["B", "C", "D", "E", "F", "G"], {
      A: "X",
      B: "X-error", // ch0 — dQ, unpaired but still an error → hidden
      C: "Y",
      D: "Y-error", // ch2 — dR++
      E: "Y",
      F: "Y-error", // ch4 — dR--
      G: "Y",
    });
    expect(originHiddenChannels(ds)).toEqual([0, 2, 4]);
  });

  it("originHiddenChannels hides a leading Y-error (Fixed Lambdas dQ) even though it has no pair", () => {
    // B=dQ is Y-error but has no preceding Y → not in errKeys, yet still hidden.
    const ds = origin(["B", "C", "D"], { A: "X", B: "Y-error", C: "Y", D: "Y-error" });
    expect(originErrKeys(ds)).toEqual({ 1: 2 }); // only D pairs (to C)
    expect(originHiddenChannels(ds)).toEqual([0, 2]); // BOTH error columns hidden
  });

  it("originHiddenChannels is empty for data with no error/secondary-X columns", () => {
    expect(originHiddenChannels(origin(["B", "C"], { A: "X", B: "Y", C: "Y" }))).toEqual([]);
  });

  it("originHiddenChannels hides secondary X columns of a multi-XY book (Moke loops)", () => {
    // A magnetometry book storing several hysteresis loops as X,Y,X,Y: the first
    // X (A) is the axis (→time, not a value col); the further X columns are
    // repeated H sweeps, not data — Origin draws them as the shared abscissa,
    // never as flat Y lines, so they're hidden.
    const ds = origin(["B", "C", "D", "E", "F"], {
      A: "X", // primary X → time
      B: "Y", // Kerr signal
      C: "X", // secondary H sweep → hidden
      D: "Y", // Kerr signal
      E: "X", // secondary H sweep → hidden
      F: "Y", // Kerr signal
    });
    expect(originHiddenChannels(ds)).toEqual([1, 3]);
  });
});

describe("defaultErrKeys (Origin designations + parser error_channels hint)", () => {
  it("reads a parser error_channels hint (e.g. reflectometry R←dR)", () => {
    const ds: DataStruct = {
      time: [0, 1],
      values: [
        [0, 0, 0],
        [1, 1, 1],
      ],
      labels: ["dQ", "R", "dR"],
      units: ["", "", ""],
      metadata: { error_channels: { 1: 2 } },
    };
    expect(defaultErrKeys(ds)).toEqual({ 1: 2 });
  });

  it("merges Origin Y-error designations with the hint", () => {
    const ds = origin(["A", "B", "C"], { A: "X", B: "Y", C: "Y-error" });
    (ds.metadata as Record<string, unknown>).error_channels = { 5: 6 };
    expect(defaultErrKeys(ds)).toEqual({ 1: 2, 5: 6 });
  });

  it("falls back to Origin-only when no hint is present", () => {
    const ds = origin(["A", "B", "C"], { A: "X", B: "Y", C: "Y-error" });
    expect(defaultErrKeys(ds)).toEqual({ 1: 2 });
  });
});
