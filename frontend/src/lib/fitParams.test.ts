import { describe, expect, it } from "vitest";

import {
  boundsForWire,
  boundsFromWire,
  parseFitParams,
  resetRows,
  rowsAreDefault,
  rowsForModel,
  rowsFromModel,
  type FitParamRow,
} from "./fitParams";
import type { FitModel } from "./types";

const gauss: FitModel = {
  name: "Gaussian",
  category: "peak",
  paramNames: ["amp", "center", "sigma"],
  nParams: 3,
  p0: [1, 0, 1],
  lb: [null, null, 0],
  ub: [null, null, null],
};

const lorentz: FitModel = {
  ...gauss,
  name: "Lorentzian",
  paramNames: ["amp", "center", "gamma"],
  p0: [2, 0, 1],
  lb: [null, null, 0],
  ub: [null, null, null],
};

describe("rowsFromModel", () => {
  it("seeds from the registry defaults", () => {
    expect(rowsFromModel(gauss)).toEqual([
      { name: "amp", start: "1", min: "", max: "", fixed: false },
      { name: "center", start: "0", min: "", max: "", fixed: false },
      { name: "sigma", start: "1", min: "0", max: "", fixed: false },
    ]);
  });

  it("is empty with no model", () => {
    expect(rowsFromModel(undefined)).toEqual([]);
  });
});

describe("rowsForModel", () => {
  it("KEEPS an edit for a parameter that survives the model change", () => {
    // Models share names (amp, center); discarding a hand-tuned start when
    // flipping Gaussian->Lorentzian would throw away work just done.
    const edited = rowsFromModel(gauss).map((r) =>
      r.name === "amp" ? { ...r, start: "42" } : r,
    );
    const next = rowsForModel(lorentz, edited);
    expect(next.find((r) => r.name === "amp")?.start).toBe("42");
  });

  it("seeds a genuinely new parameter from the new model", () => {
    const next = rowsForModel(lorentz, rowsFromModel(gauss));
    expect(next.find((r) => r.name === "gamma")?.min).toBe("0");
    expect(next.map((r) => r.name)).toEqual(["amp", "center", "gamma"]);
  });
});

describe("resetRows", () => {
  it("discards edits", () => {
    const edited: FitParamRow[] = [{ name: "amp", start: "99", min: "1", max: "2", fixed: true }];
    expect(resetRows(gauss)).not.toEqual(edited);
    expect(resetRows(gauss)[0].start).toBe("1");
  });
});

describe("parseFitParams", () => {
  it("parses starts and bounds", () => {
    const rows = rowsFromModel(gauss);
    const out = parseFitParams(rows, gauss);
    expect(out.p0).toEqual([1, 0, 1]);
    expect(out.lower).toEqual([-Infinity, -Infinity, 0]);
    expect(out.upper).toEqual([Infinity, Infinity, Infinity]);
    expect(out.error).toBeUndefined();
  });

  it("treats a blank bound as unbounded, not as zero", () => {
    const rows = rowsFromModel(gauss).map((r) => ({ ...r, min: "", max: "" }));
    const out = parseFitParams(rows, gauss);
    expect(out.lower).toEqual([-Infinity, -Infinity, -Infinity]);
  });

  it("falls back to the model default for a blank start", () => {
    const rows = rowsFromModel(gauss).map((r) => ({ ...r, start: "" }));
    expect(parseFitParams(rows, gauss).p0).toEqual([1, 0, 1]);
  });

  it("REFUSES min above max, the one mistake that just fails confusingly", () => {
    const rows = rowsFromModel(gauss).map((r) =>
      r.name === "amp" ? { ...r, min: "5", max: "1" } : r,
    );
    expect(parseFitParams(rows, gauss).error).toContain("min is above max");
  });

  it("refuses unparseable numbers, naming the parameter", () => {
    const rows = rowsFromModel(gauss).map((r) =>
      r.name === "center" ? { ...r, start: "abc" } : r,
    );
    expect(parseFitParams(rows, gauss).error).toBe("center: start is not a number");
  });

  it("refuses an all-fixed table rather than sending a no-op fit", () => {
    const rows = rowsFromModel(gauss).map((r) => ({ ...r, fixed: true }));
    expect(parseFitParams(rows, gauss).error).toContain("nothing left to fit");
  });

  it("allows SOME parameters fixed", () => {
    const rows = rowsFromModel(gauss).map((r, i) => ({ ...r, fixed: i === 0 }));
    const out = parseFitParams(rows, gauss);
    expect(out.error).toBeUndefined();
    expect(out.fixed).toEqual([true, false, false]);
  });

  it("is empty with no model", () => {
    expect(parseFitParams([], undefined).p0).toEqual([]);
  });
});

describe("rowsAreDefault", () => {
  it("is true for untouched rows", () => {
    expect(rowsAreDefault(rowsFromModel(gauss), gauss)).toBe(true);
  });

  it("is false once a start, bound or fixed flag is changed", () => {
    const base = rowsFromModel(gauss);
    expect(rowsAreDefault(base.map((r, i) => (i ? r : { ...r, start: "9" })), gauss)).toBe(false);
    expect(rowsAreDefault(base.map((r, i) => (i ? r : { ...r, max: "9" })), gauss)).toBe(false);
    expect(rowsAreDefault(base.map((r, i) => (i ? r : { ...r, fixed: true })), gauss)).toBe(false);
  });
});

describe("bounds wire round-trip", () => {
  it("maps infinities to null, because JSON has no Infinity literal", () => {
    // Relying on JSON.stringify's silent Infinity->null is how a bound becomes
    // garbage; do it explicitly and reverse it explicitly.
    expect(boundsForWire([-Infinity, 0, Infinity])).toEqual([null, 0, null]);
  });

  it("restores the correct SIGN of infinity on the way back", () => {
    expect(boundsFromWire([null, 0], -1)).toEqual([-Infinity, 0]);
    expect(boundsFromWire([null, 0], 1)).toEqual([Infinity, 0]);
  });

  it("passes undefined through", () => {
    expect(boundsFromWire(undefined, 1)).toBeUndefined();
  });
});
