// P2.2 residuals — the pure half: which residuals a channel has (stored, or
// recomputed where that is exact), and the three linked panels' payloads.

import { describe, expect, it } from "vitest";

import { channelResiduals, fitPlotPanels, linkX, residualUnit, RESIDUALS_NOT_STORED } from "./reflFitResiduals";

const CH = { label: "c", spin: null, q: [0.01, 0.03, 0.05], r: [1, 0.5, 0.2], model: [0.9, 0.4, 0.1] };

describe("channelResiduals", () => {
  it("uses the residuals the fit reported, whatever the weighting", () => {
    expect(channelResiduals({ ...CH, residual: [-10, -10, -10] }, "dr")).toEqual([-10, -10, -10]);
    expect(channelResiduals({ ...CH, residual: [1, null, 3] }, "log")).toEqual([1, null, 3]);
  });

  it("recomputes log residuals exactly as calc/refl_fit.py does when none are stored", () => {
    const got = channelResiduals({ ...CH, model: [0.9, null, 0] }, "log")!;
    expect(got[0]).toBeCloseTo(Math.log10(0.9) - Math.log10(1), 15);
    expect(got[1]).toBeNull(); // no model point reported
    // numpy's np.maximum(model, 1e-300) floor, not -Infinity
    expect(got[2]).toBeCloseTo(-300 - Math.log10(0.2), 12);
  });

  it("cannot recover dR-normalised residuals without dR, and says nothing rather than guess", () => {
    expect(channelResiduals(CH, "dr")).toBeNull();
    // a stored array of the wrong length is not a residual of these points
    expect(channelResiduals({ ...CH, residual: [] }, "dr")).toBeNull();
  });

  it("labels the units for what each weighting's residual is", () => {
    expect(residualUnit("dr")).toBe("σ");
    expect(residualUnit("log")).toBe("dex");
  });
});

describe("fitPlotPanels", () => {
  it("packs data + model, residuals and the SLD profile, the Q panels on one Q column", () => {
    const p = fitPlotPanels(
      { channels: [{ ...CH, residual: [-10, -10, -10] }], sld: [{ spin: null, z: [-10, 0, 10], sld: [0, 7e-5, null] }] },
      "dr",
    );
    expect(p.reflectivity!.data).toEqual([CH.q, CH.r, CH.model]);
    expect(p.reflectivity!.series.map((s) => [s.label, s.kind])).toEqual([["R", "points"], ["model", "line"]]);
    expect(p.residual!.data).toEqual([CH.q, [-10, -10, -10]]);
    expect(p.residual!.series).toEqual([{ label: "residual", unit: "σ", kind: "points" }]);
    expect(p.residual!.data[0]).toEqual(p.reflectivity!.data[0]); // the shared Q axis
    expect(p.residualNote).toBeNull();
    expect(p.sld!.data).toEqual([[-10, 0, 10], [0, 7e-5, null]]);
    expect([p.sld!.xLabel, p.sld!.xUnit]).toEqual(["z", "Å"]);
  });

  it("aligns a PNR pair on the union of their Q points and names each series by spin", () => {
    const p = fitPlotPanels(
      {
        channels: [
          { label: "a", spin: "+", q: [0.01, 0.02], r: [1, 0.5], model: [0.9, 0.4], residual: [1, 2] },
          { label: "b", spin: "-", q: [0.02, 0.03], r: [0.8, 0.3], model: [0.7, 0.2], residual: [3, 4] },
        ],
        sld: [],
      },
      "dr",
    );
    expect(p.reflectivity!.data).toEqual([
      [0.01, 0.02, 0.03],
      [1, 0.5, null],
      [0.9, 0.4, null],
      [null, 0.8, 0.3],
      [null, 0.7, 0.2],
    ]);
    expect(p.residual!.series.map((s) => s.label)).toEqual(["residual (+)", "residual (-)"]);
    expect(p.residual!.data.slice(1)).toEqual([[1, 2, null], [null, 3, 4]]);
    expect(p.sld).toBeNull();
  });

  it("leaves non-positive R and model points off the log-R panel but keeps their residuals", () => {
    const p = fitPlotPanels({ channels: [{ ...CH, r: [1, 0, 0.2], model: [0.9, 0.4, -1e-9], residual: [1, 2, 3] }], sld: [] }, "dr");
    expect(p.reflectivity!.data.slice(1)).toEqual([[1, null, 0.2], [0.9, 0.4, null]]);
    expect(p.residual!.data[1]).toEqual([1, 2, 3]);
  });

  it("explains a saved dR fit whose residuals were not stored instead of drawing an empty panel", () => {
    const p = fitPlotPanels({ channels: [CH], sld: [] }, "dr");
    expect(p.residual).toBeNull();
    expect(p.residualNote).toBe(RESIDUALS_NOT_STORED);
    expect(p.reflectivity).not.toBeNull();
  });

  it("has nothing to draw for a fit without curves", () => {
    expect(fitPlotPanels({ channels: [], sld: [] }, "dr")).toEqual({ reflectivity: null, residual: null, residualNote: null, sld: null });
  });
});

describe("linkX", () => {
  function fake(min: number, max: number) {
    const u = {
      scales: { x: { min, max } },
      calls: 0,
      setScale(_key: string, lim: { min: number; max: number }) {
        u.calls++;
        u.scales.x = { ...lim };
        hook(u, "x"); // uPlot fires setScale on the plot that was set
      },
    };
    return u;
  }
  const group = new Set<ReturnType<typeof fake>>();
  const hook = linkX(group);

  it("zooming one Q panel sets the other's Q range once, with no echo loop", () => {
    const a = fake(0, 1);
    const b = fake(0, 1);
    group.clear();
    group.add(a).add(b);
    a.scales.x = { min: 0.2, max: 0.4 };
    hook(a, "x");
    expect(b.scales.x).toEqual({ min: 0.2, max: 0.4 });
    expect([a.calls, b.calls]).toEqual([0, 1]);
    hook(a, "y"); // only the shared x scale is linked
    expect(b.calls).toBe(1);
  });
});
