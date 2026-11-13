// Re-audit #14: the Curve Fit model list was a flat 72 entries with
// near-duplicates. It is grouped by Origin category, and every alias is said.

import { describe, expect, it } from "vitest";

import { fitModelLabel, groupFitModels } from "./fitModelCatalog";
import type { FitModel } from "./types";

const m = (name: string, category: string): FitModel => ({ name, category, paramNames: [], nParams: 0, p0: [], lb: [], ub: [] });

describe("fit model catalog", () => {
  it("groups by Origin category in Origin's order, Quantized's own after, unknown kept last", () => {
    const groups = groupFitModels([
      m("Curie-Weiss", "Magnetic"),
      m("Gaussian", "Peak"),
      m("ExpDec1", "Exponential"),
      m("Exponential Decay", "Decay"),
      m("Gauss", "Peak Functions"),
      m("Poly5", "Polynomial"),
      m("Linear", "Linear"),
      m("Brand New", "Novel"),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["Polynomial", "Exponential", "Peak Functions", "Magnetism", "Novel"]);
    expect(groups[1].options).toEqual([
      { value: "ExpDec1", label: "ExpDec1" },
      { value: "Exponential Decay", label: "Exponential Decay (= ExpDec1)" },
    ]);
    // Values stay the registry names; only the labels explain.
    expect(groups[0].options).toEqual([{ value: "Poly5", label: "Poly 5" }, { value: "Linear", label: "Linear" }]);
  });

  it("names how each near-duplicate differs", () => {
    expect(fitModelLabel("Gaussian")).toBe("Gaussian (height form; GaussAmp with y0 = 0)");
    expect(fitModelLabel("Gauss")).toBe("Gauss (area form)");
    expect(fitModelLabel("ExpDecay1")).toBe("ExpDecay1 (ExpDec1 with an x0 offset)");
    expect(fitModelLabel("Voigt")).toBe("Voigt");
  });
});
