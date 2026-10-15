import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { curieWeissProblem, fieldColumns, isMolarSusceptibilityUnit, responseBasis } from "./curieWeissData";

function dataset(xLabel = "Temperature", xUnit = "K", yUnit = "emu"): Dataset {
  return {
    id: "mt", name: "mt.dat",
    data: {
      time: [100, 200, 300],
      values: [[1, 1000], [0.5, 1000], [0.25, 1000]],
      labels: ["DC Moment", "Magnetic Field"], units: [yUnit, "Oe"],
      metadata: { x_column_name: xLabel, x_column_unit: xUnit },
    },
  };
}

describe("loaded-data Curie-Weiss qualification", () => {
  it("recognizes common molar-susceptibility spellings but not raw susceptibility", () => {
    expect(isMolarSusceptibilityUnit("cm³/mol")).toBe(true);
    expect(isMolarSusceptibilityUnit("emu / Oe / mol")).toBe(true);
    expect(isMolarSusceptibilityUnit("emu/Oe")).toBe(false);
    expect(responseBasis("auto", "emu")).toBe("total_moment");
    expect(responseBasis("auto", "emu/g")).toBe("mass_moment");
  });

  it("finds only declared, supported field channels", () => {
    const data = dataset().data;
    data.labels.push("Field note", "Magnetic Field");
    data.units.push("", "G");
    data.values.forEach((row) => row.push(1, 2));
    expect(fieldColumns(data, 0)).toEqual([{ index: 1, label: "Magnetic Field", unit: "Oe" }]);
  });

  it("fails closed on a non-temperature x and missing sample context", () => {
    expect(curieWeissProblem(dataset("Magnetic Field", "Oe"), null, 0, "auto", 0, 0, 100, 300, 1))
      .toMatch(/not a declared temperature/);
    expect(curieWeissProblem(dataset(), null, 0, "auto", 0, 0, 100, 300, 1))
      .toMatch(/molar mass/);
    expect(curieWeissProblem(dataset(), null, 0, "auto", 0.001, 100, 100, 300, 1)).toBeNull();
  });

  it("requires absolute temperature rather than silently treating Celsius as kelvin", () => {
    expect(curieWeissProblem(dataset("Temperature", "°C"), null, 0, "auto", 0.001, 100, 100, 300, 1))
      .toMatch(/absolute temperature in K/);
  });

  it("treats an explicit molar choice as the user's unit override", () => {
    expect(curieWeissProblem(dataset("Temperature", "K", "mystery"), null, 0, "molar", 0, 0, 100, 300, null))
      .toBeNull();
  });

  it("refuses known SI molar susceptibility rather than misreading it as CGS", () => {
    expect(curieWeissProblem(dataset("Temperature", "K", "m³/mol"), null, 0, "molar", 0, 0, 100, 300, null))
      .toMatch(/convert it to cm³\/mol/);
  });
});
