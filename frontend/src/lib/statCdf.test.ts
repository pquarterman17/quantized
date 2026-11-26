import { describe, expect, it } from "vitest";

import { plotTypeGroups, plotTypePatch, plotTypeUnavailable, PLOT_TYPES } from "./plotTypes";
import { sanitizeStatPicks } from "./plotviewSanitize";
import { cdfGeometry, resolveRug, rugTicks, sanitizeRugPick, stairPath, type CdfWire } from "./statCdf";

describe("stairPath", () => {
  it("runs level, rises at each value, and levels out", () => {
    expect(stairPath([1, 2], [0.5, 1], 0, 3, 0)).toEqual([[0, 0], [1, 0], [1, 0.5], [2, 0.5], [2, 1], [3, 1]]);
  });
});

describe("cdfGeometry", () => {
  const wire: CdfWire = {
    y: "proportion", domain: [0, 4], y_max: 1, alpha: 0.05, fit: null,
    series: [{ n: 2, x: [1, 2], y: [0.5, 1], band: { eps: 0.1, lo: [0.4, 0.9], hi: [0.6, 1], lo0: 0, hi0: 0.1 } }],
  };
  it("builds the band as the upper stairs, then the lower ones back", () => {
    const g = cdfGeometry(wire).series[0];
    expect(g.band).toHaveLength(12);
    expect(g.band![0]).toEqual([0, 0.1]);
    expect(g.band![11]).toEqual([0, 0]);
    expect(g.fit).toBeNull();
  });
});

describe("rug", () => {
  it("one tick per finite value, a row per column", () => {
    expect(rugTicks([1, 2, Number.NaN, 2], 1, 0.1)).toEqual([[1, 0.1, 0.2], [2, 0.1, 0.2], [2, 0.1, 0.2]]);
  });
  it("is off unless asked, with defaults for unset numbers", () => {
    expect(resolveRug(undefined)).toBeNull();
    expect(resolveRug({ length: 0.1 })).toBeNull();
    expect(resolveRug({ on: true })).toEqual({ length: 0.04, opacity: 0.5 });
  });
  it("sanitizes a persisted option field by field", () => {
    expect(sanitizeRugPick({ on: true, length: 9, opacity: 0.2 })).toEqual({ on: true, opacity: 0.2 });
    expect(sanitizeRugPick({ on: "yes" })).toBeUndefined();
    expect(sanitizeRugPick(null)).toBeUndefined();
  });
  it("rides statPicks through its sanitizer", () => {
    expect(sanitizeStatPicks({ mode: "cdf", cdfY: "count", cdfBand: true, rug: { on: true } })).toEqual({
      mode: "cdf", cdfY: "count", cdfBand: true, rug: { on: true },
    });
    expect(sanitizeStatPicks({ mode: "cdf", cdfY: "pct", cdfBand: 1 })).toEqual({ mode: "cdf" });
  });
});

describe("the CDF gallery tile", () => {
  const ds = { id: "d", name: "d", data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
  it("is listed once, under Statistical", () => {
    expect(PLOT_TYPES.filter((t) => t.id === "cdf")).toHaveLength(1);
    expect(plotTypeGroups().find((g) => g.label === "Statistical")!.types.map((t) => t.id)).toContain("cdf");
  });
  it("is available with a dataset and not without", () => {
    expect(plotTypeUnavailable("cdf", ds)).toBeNull();
    expect(plotTypeUnavailable("cdf", null)).not.toBeNull();
  });
  it("switches the Stat Stage to CDF mode and keeps the other picks", () => {
    const patch = plotTypePatch("cdf", { seriesStyles: {}, statPicks: { fit: "norm", rug: { on: true } } }, [0]);
    expect(patch).toMatchObject({ statMode: true, statPicks: { mode: "cdf", cdfY: "proportion", fit: "norm", rug: { on: true } } });
  });
});
