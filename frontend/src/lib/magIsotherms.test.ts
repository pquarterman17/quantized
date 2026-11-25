import { describe, expect, it } from "vitest";

import type { ArrottResult, EntropyChangeResult } from "./api/magnetic";
import {
  arrottLines, arrottWorksheet, commonMaxField, entropyLines, entropyWorksheet, isothermBody, parseMaxFields,
  readIsotherm, suggestTemperature, temperatureProblem, uncertaintyStatus,
} from "./magIsotherms";
import { readCompareSeries } from "./magSeriesCompare";
import type { Dataset } from "./types";

function loop(over: Partial<Dataset["data"]> = {}, roles: Dataset["errorRoles"] = []): Dataset {
  return {
    id: "a", name: "a.dat",
    data: {
      time: [0, 100, 200], values: [[0, 0.1, 50], [10, 0.2, 50.2], [20, 0.3, 49.9]],
      labels: ["Moment", "Moment err", "Temperature"], units: ["emu/cm3", "emu/cm3", "K"],
      metadata: { x_column_name: "Magnetic field", x_column_unit: "Oe" },
      ...over,
    },
    errorRoles: roles,
  };
}
const symmetric: Dataset["errorRoles"] = [{ channel: 1, target: 0, axis: "y", side: "both" }];

describe("suggestTemperature", () => {
  it("takes the mean of a steady K column", () => expect(suggestTemperature(loop())).toBeCloseTo(50.033333, 5));
  it("refuses a drifting column (not one isotherm)", () => {
    const d = loop();
    d.data.values[2]![2] = 53;
    expect(suggestTemperature(d)).toBeNull();
  });
  it("gives nothing without exactly one declared K temperature column", () => {
    expect(suggestTemperature(loop({ units: ["emu/cm3", "emu/cm3", "Oe"] }))).toBeNull();
    expect(suggestTemperature(loop({ labels: ["Moment", "Moment err", "Temperature"], units: ["emu/cm3", "K", "K"] }))).toBeNull();
  });
});

describe("readIsotherm", () => {
  it("reads a field-axis worksheet with its suggested temperature", () => {
    const r = readIsotherm(loop({}, symmetric), "Moment");
    expect(r.series.axis).toBe("field");
    expect(r.suggestedT).not.toBeNull();
  });
  it("refuses M(T) data with the reason", () => {
    const d = loop({ metadata: { x_column_name: "Temperature", x_column_unit: "K" } });
    expect(() => readIsotherm(d, "Moment")).toThrow(/temperature X axis/);
  });
});

describe("uncertaintyStatus (fail closed: no ± without complete symmetric uncertainty)", () => {
  const withErr = readCompareSeries(loop({}, symmetric), "Moment");
  const none = readCompareSeries(loop(), "Moment");
  it("is usable when every isotherm has one symmetric column", () => expect(uncertaintyStatus([withErr, withErr]).usable).toBe(true));
  it("is not usable with none, some, asymmetric or several columns", () => {
    expect(uncertaintyStatus([none, none])).toMatchObject({ usable: false, reason: expect.stringMatching(/No committed/) });
    expect(uncertaintyStatus([withErr, none]).reason).toMatch(/Only some/);
    const asym = { ...withErr, yErrors: [{ ...withErr.yErrors[0]!, side: "+" as const }] };
    expect(uncertaintyStatus([withErr, asym]).reason).toMatch(/asymmetric/);
    const two = { ...withErr, yErrors: [withErr.yErrors[0]!, withErr.yErrors[0]!] };
    expect(uncertaintyStatus([withErr, two]).reason).toMatch(/more than one/);
  });
});

describe("temperatureProblem / parseMaxFields / body", () => {
  it("names a blank, non-positive or repeated temperature", () => {
    expect(temperatureProblem(["a", "b"], [10, null])).toMatch(/"b"/);
    expect(temperatureProblem(["a", "b"], [10, 0])).toMatch(/"b"/);
    expect(temperatureProblem(["a", "b"], [10, 10])).toMatch(/same temperature/);
    expect(temperatureProblem(["a", "b"], [10, 20])).toBeNull();
  });
  it("parses maximum fields and refuses bad ones", () => {
    expect(parseMaxFields("1, 2.5 5")).toEqual([1, 2.5, 5]);
    expect(parseMaxFields("")).toMatch(/at least one/);
    expect(parseMaxFields("1, -2")).toMatch(/positive/);
    expect(parseMaxFields("x")).toMatch(/positive/);
  });
  it("scales field, M and uncertainty by the plan and sends uncertainty only when usable", () => {
    const s = readCompareSeries(loop({}, symmetric), "Moment");
    const plan = [{ x_factor: 2, y_factor: -3 }];
    const on = isothermBody([s], [50], plan, true)[0]!;
    expect(on.field).toEqual([0, 200, 400]);
    expect(on.magnetization.map((v) => v + 0)).toEqual([0, -30, -60]);
    expect(on.magnetization_error).toEqual([0.1 * 3, 0.2 * 3, 0.3 * 3].map((v) => expect.closeTo(v, 12)));
    expect("magnetization_error" in isothermBody([s], [50], plan, false)[0]!).toBe(false);
  });
  it("starts the field box at the largest field every isotherm reaches", () => {
    const s = readCompareSeries(loop(), "Moment");
    expect(commonMaxField([s, s], [{ x_factor: 1 }, { x_factor: 0.5 }])).toBe(100);
  });
});

const entropy = (sigma: number[] | null): EntropyChangeResult => ({
  temperature: [15, 25], unit: "J/(m^3 K)", field_unit: "T", method: "Maxwell",
  curves: [{ max_field: 1, delta_s: [-1, -2], delta_s_sigma: sigma, peak_delta_s: -2, peak_delta_s_sigma: sigma ? sigma[1]! : null, peak_temperature: 25, t_cold: null, t_hot: null, fwhm: null, rcp: null }],
  uncertainty: sigma ? { propagated: true, method: "first-order (linear) propagation", reason: null } : { propagated: false, method: null, reason: "none" },
});

describe("worksheets and readouts", () => {
  it("adds a Y-error column and role for a propagated ΔS and none otherwise", () => {
    const withS = entropyWorksheet(entropy([0.1, 0.2]), {});
    expect(withS.data.labels).toEqual(["ΔS_M (H = 1 T)", "ΔS_M ± (H = 1 T)"]);
    expect(withS.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(withS.data.values).toEqual([[-1, 0.1], [-2, 0.2]]);
    const without = entropyWorksheet(entropy(null), {});
    expect(without.data.labels).toHaveLength(1);
    expect(without.errorRoles).toEqual([]);
  });
  it("prints ± only when propagated (and states the method)", () => {
    expect(entropyLines(entropy([0.1, 0.25])).join("\n")).toMatch(/-2 ± 0\.25 J\/\(m\^3 K\)/);
    expect(entropyLines(entropy([0.1, 0.25])).join("\n")).toMatch(/first-order/);
    expect(entropyLines(entropy(null)).join("\n")).not.toMatch(/\d ± \d/);
  });
  const arrott = (sig: number | null): ArrottResult => ({
    beta: 0.5, gamma: 1, x_label: "(H/M)^(1/1)", y_label: "M^(1/0.5)", magnetization_si_unit: "A/m",
    isotherms: [10, 20].map((t) => ({ temperature: t, n_points: 2, x: [1, 2], y: [3, 4], slope: 1, intercept: 7 - t / 10, slope_se: null, intercept_se: null, r2: 0.99, intercept_sigma_m: sig, spontaneous_magnetization: 1 })),
    tc: 17.5, tc_sigma: sig, tc_method: "interp",
    uncertainty: sig === null ? { propagated: false, method: null, reason: "none" } : { propagated: true, method: "first-order (linear) propagation", reason: null },
  });
  it("lays out one X,Y pair per isotherm and reports Tc ±", () => {
    const w = arrottWorksheet(arrott(0.3), {});
    expect(w.data.labels).toEqual(["M^(1/0.5) [T = 10 K]", "(H/M)^(1/1) [T = 20 K]", "M^(1/0.5) [T = 20 K]"]);
    expect(w.columnDesignations).toEqual({ 0: "Y", 1: "X", 2: "Y" });
    expect(w.data.units[0]).toBe("(A/m)^2");
    expect(arrottLines(arrott(0.3))[0]).toBe("Tc = 17.5 ± 0.3 K (interp)");
    expect(arrottLines(arrott(null)).join("\n")).not.toMatch(/\d ± \d/);
  });
});
