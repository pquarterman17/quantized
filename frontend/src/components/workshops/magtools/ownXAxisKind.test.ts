// Field-vs-temperature qualification reads the Y's OWN X (H1,M1,T2,M2): the
// plot's shared X must not decide it, in either direction.
import { describe, expect, it } from "vitest";

import { byColumnOptions } from "../curvefit/byColumnOptions";
import { ownXChannels } from "../../../lib/ownXChannels";
import type { Dataset } from "../../../lib/types";
import { curieWeissProblem } from "./curieWeissData";

// time = field H1 (Oe); columns: M1 (0), Temperature (1, X, K), M2 (2), applied field (3).
function sheet(): Dataset {
  return {
    id: "ax",
    name: "ax",
    data: {
      time: [300, 100, 200],
      values: [[1, 50, 0.5, 1000], [2, 300, 0.4, 1000], [3, 100, 0.3, 1000]],
      labels: ["M1", "Temperature", "M2", "Magnetic Field"],
      units: ["emu", "K", "emu", "Oe"],
      metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
    },
    columnDesignations: { 1: "X" },
  };
}

describe("curieWeissProblem validates the fitted Y's own X", () => {
  it("M2 (on the K column) qualifies even though the plot X is a field", () => {
    expect(curieWeissProblem(sheet(), null, 2, "auto", 0.001, 100, 50, 300, 3)).toBeNull();
  });

  it("M1 (on the field X) is refused even if the plot X were pointed at the temperature column", () => {
    expect(curieWeissProblem(sheet(), 1, 0, "auto", 0.001, 100, 50, 300, 3)).toMatch(/not a declared temperature/);
  });

  it("a Celsius own X is refused although the plot X is Kelvin", () => {
    const ds = sheet();
    ds.data.units = ["emu", "°C", "emu", "Oe"];
    expect(curieWeissProblem(ds, null, 2, "auto", 0.001, 100, 50, 300, 3)).toMatch(/absolute temperature in K/);
  });
});

describe("ownXChannels", () => {
  it("names the Y's own X column and index", () => {
    expect(ownXChannels(sheet(), null, [2], null)).toEqual({ xLabel: "Temperature", yLabel: "M2", xIndex: 1, yIndex: 2 });
    expect(ownXChannels(sheet(), null, [0], null)).toEqual({ xLabel: null, yLabel: "M1", xIndex: null, yIndex: 0 });
  });
});

describe("Curve Fit By candidates", () => {
  it("exclude the fit's own X, and keep the plot X when it is not the fit's X", () => {
    // Fit M2 (own X = col 1); the plot X is the time axis (null): nothing to remove for it.
    expect(byColumnOptions(sheet(), null, 2).map((c) => c.index)).toEqual([0, 3]);
    // Plot X pointed at col 3; M2 still fits against col 1, so col 3 stays a candidate.
    expect(byColumnOptions(sheet(), 3, 2).map((c) => c.index)).toEqual([0, 3]);
    // M1 on the plot X (col 3 is a non-X column -> shared) removes col 3.
    expect(byColumnOptions(sheet(), 3, 0).map((c) => c.index)).toEqual([1, 2]);
  });
});
