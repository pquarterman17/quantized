import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import type { WilliamsonHallRecipe } from "../lib/williamsonHallRecipe";
import { publishWilliamsonHallResult } from "./williamsonHallResults";
import { useApp } from "./useApp";

const source: Dataset = { id: "xrd", name: "film.xrdml", data: {
  time: [30, 45], values: [[100], [80]], labels: ["Intensity"], units: ["cps"], metadata: {},
} };
const recipe: WilliamsonHallRecipe = { rows: [{ twoTheta: 30, fwhm: 0.2 }, { twoTheta: 45, fwhm: 0.3 }],
  wavelengthA: 1.5406, kFactor: 0.9, instrumentalBroadeningDeg: 0, sourceKind: "manual" };
const output = { grain_size_nm: 24, microstrain: 0.001, r2: 0.98,
  plot_x: [1, 2], plot_y: [0.01, 0.02], fit_line: [0.01, 0.001] as [number, number] };

beforeEach(() => useApp.setState({ datasets: [source], activeId: source.id, analysisResults: [],
  openAnalysisResultId: null, history: [], future: [], status: "" }));

describe("publishWilliamsonHallResult", () => {
  it("publishes one undoable, opened Library result", () => {
    const id = publishWilliamsonHallResult(source, recipe, output);
    expect(id).toBeTruthy();
    expect(useApp.getState()).toMatchObject({ openAnalysisResultId: id, status: "created Williamson–Hall · film.xrdml result" });
    expect(useApp.getState().analysisResults).toEqual([expect.objectContaining({ id, producer: { id: "williamson-hall", label: "Williamson–Hall", version: 1 } })]);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("refuses to bless results after the source changed during the request", () => {
    useApp.setState({ datasets: [{ ...source, data: { ...source.data, values: [[999], [80]] } }] });
    expect(publishWilliamsonHallResult(source, recipe, output)).toBeNull();
    expect(useApp.getState().analysisResults).toEqual([]);
    expect(useApp.getState().status).toMatch(/source changed/);
  });
});
