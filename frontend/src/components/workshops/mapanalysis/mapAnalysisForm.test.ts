import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildPeaksRequest, buildVolumeRequest, drawnBounds, emptyForm, summarize } from "./mapAnalysisForm";

describe("buildPeaksRequest", () => {
  it("defaults and a chosen model", () => {
    expect(buildPeaksRequest(emptyForm()).req).toEqual({ n_peaks: null, threshold: 0.05, min_separation: 4, model: "gaussian", rotate: false, smooth_sigma: 1, fit_window: 8 });
    const f = { ...emptyForm(), model: "lorentzian" as const, rotate: true, nPeaks: "3" };
    expect(buildPeaksRequest(f).req).toMatchObject({ model: "lorentzian", rotate: true, n_peaks: 3 });
  });
  it("refuses junk with a reason", () => {
    expect(buildPeaksRequest({ ...emptyForm(), nPeaks: "0" }).error).toMatch(/1 to 100/);
    expect(buildPeaksRequest({ ...emptyForm(), threshold: "1" }).error).toMatch(/Threshold/);
    expect(buildPeaksRequest({ ...emptyForm(), minSep: "1.5" }).error).toMatch(/separation/);
    expect(buildPeaksRequest({ ...emptyForm(), window: "2" }).error).toMatch(/window/);
  });
});

describe("buildVolumeRequest", () => {
  const filled = { ...emptyForm(), mode: "volume" as const, x0: "0", x1: "2", y0: "1", y1: "3" };
  it("builds a rectangle with its background", () => {
    expect(buildVolumeRequest(filled).req).toMatchObject({ region: { kind: "rect", x0: 0, x1: 2, y0: 1, y1: 3 }, background: { kind: "none" }, on_nan: "refuse" });
    expect(buildVolumeRequest({ ...filled, bg: "constant", bgValue: "4" }).req?.background).toEqual({ kind: "constant", value: 4 });
    expect(buildVolumeRequest({ ...filled, bg: "constant" }).req?.background).toEqual({ kind: "constant" });
    expect(buildVolumeRequest({ ...filled, bg: "plane", skipEmpty: true }).req).toMatchObject({ background: { kind: "plane" }, on_nan: "skip" });
  });
  it("sends the pixel rule by default and the trapezoid rule when chosen", () => {
    expect(buildVolumeRequest(filled).req?.rule).toBe("pixel");
    expect(buildVolumeRequest({ ...filled, rule: "trapezoid" }).req?.rule).toBe("trapezoid");
  });
  it("refuses missing bounds and bad numbers", () => {
    expect(buildVolumeRequest(emptyForm()).error).toMatch(/four rectangle bounds/);
    expect(buildVolumeRequest({ ...filled, bg: "constant", bgValue: "x" }).error).toMatch(/constant/);
    expect(buildVolumeRequest({ ...filled, border: "0" }).error).toMatch(/Border/);
  });
});

describe("drawnBounds and summarize", () => {
  const map: DataStruct = { time: [0], values: [[0, 0, 1]], labels: ["Qx", "Qz", "Intensity"], units: ["", "", ""], metadata: { is2D: true } };
  it("orders the corners and names the columns; refuses no box / missing axes", () => {
    const r = drawnBounds(map, { space: "q", x0: 2, x1: 1, y0: 5, y1: 3 });
    expect(r.bounds).toEqual([1, 2, 3, 5]);
    expect(r.cols).toEqual([0, 1, 2]);
    expect(drawnBounds(map, null).error).toMatch(/Draw a box/);
    expect(drawnBounds(map, { space: "angular", x0: 0, x1: 1, y0: 0, y1: 1 }).error).toMatch(/does not have/);
  });
  it("summarizes peaks, failures and a volume", () => {
    const peaks = { ...map, metadata: { map_peaks: { n_found: 3, peaks: [
      { rank: 1, ok: true, x0: 1, x0_err: 0.01, y0: 2, y0_err: null, volume: 9.5, volume_err: 0.2 },
      { rank: 2, ok: false, message: "flat window" },
    ] } } };
    expect(summarize(peaks, "peaks")).toEqual(["2 peaks fitted (3 found)", "#1: x 1 ± 0.01, y 2, volume 9.5 ± 0.2", "#2: fit failed (flat window)"]);
    const vol = { ...map, metadata: { map_volume: { volume: 12.5, area: 4, n_cells: 16, n_nan: 2, mean: 3.125 } } };
    expect(summarize(vol, "volume")).toEqual(["Volume 12.5", "Area 4 over 16 cells (2 empty skipped)", "Mean 3.125"]);
    const trap = { ...map, metadata: { map_volume: { volume: 12.5, area: 4, n_cells: 9, n_nan: 0, mean: 3.125, rule: "trapezoid" } } };
    expect(summarize(trap, "volume")[0]).toBe("Volume 12.5 (trapezoid rule)");
  });
});
