// Gap-audit-2 #17: the plot-type gallery lists the types the app already
// draws through separate commands -- double-Y, polar, violin, waterfall,
// stacked panels, ternary -- and each tile reaches that machinery.

import { beforeEach, describe, expect, it } from "vitest";

import { useAuxFigureStore } from "../components/workshops/ternary/auxFigureStore";
import { applyPlotType } from "./figureDialogActions";
import { defaultPlotView } from "./plotview";
import { PLOT_TYPES, plotTypePatch, plotTypeUnavailable } from "./plotTypes";
import type { Dataset } from "./types";
import { useApp } from "../store/useApp";

const ds = (labels: string[]): Dataset => ({
  id: "d",
  name: "d.csv",
  data: { time: [0, 1, 2], values: [[1, 2, 3], [2, 3, 4], [3, 4, 5]].map((r) => r.slice(0, labels.length)), labels, units: labels.map(() => ""), metadata: {} },
});
const s = useApp.getState;

beforeEach(() => {
  useApp.setState({ ...defaultPlotView(), datasets: [ds(["A", "B", "C"])], activeId: "d", history: [], future: [], status: "", waterfallOpen: false });
  useAuxFigureStore.getState().setTernaryOpen(false);
});

describe("plot-type gallery: the types behind separate commands", () => {
  it("lists them", () => {
    const ids = PLOT_TYPES.map((t) => t.id);
    for (const id of ["doubleY", "polar", "violin", "waterfall", "stacked", "ternary"]) expect(ids).toContain(id);
  });

  it("patches: polar and violin switch modes; double-Y puts the last plotted column on the right", () => {
    const view = { seriesStyles: {}, statPicks: {} };
    expect(plotTypePatch("polar", view, [0, 1])).toEqual({ statMode: false, polarMode: true });
    expect(plotTypePatch("violin", view, [0])).toMatchObject({ statMode: true, polarMode: false, statPicks: { mode: "violin" } });
    expect(plotTypePatch("doubleY", view, [0, 2, 1]).y2Keys).toEqual([1]);
    expect(plotTypePatch("line", view, [0]).polarMode).toBe(false); // leaving polar
  });

  it("is unavailable when the data cannot draw it", () => {
    const one = ds(["A"]);
    expect(plotTypeUnavailable("doubleY", one)).toMatch(/two Y/);
    expect(plotTypeUnavailable("ternary", ds(["A", "B"]))).toMatch(/three/);
    expect(plotTypeUnavailable("polar", one)).toBeNull();
  });

  it("each tile reaches the existing machinery", () => {
    applyPlotType("doubleY");
    expect(s().y2Keys).toEqual([2]);
    applyPlotType("polar");
    expect(s().polarMode).toBe(true);
    applyPlotType("waterfall");
    expect(s().waterfallOpen).toBe(true);
    applyPlotType("stacked");
    expect(s().stackMode).toBe(true);
    applyPlotType("ternary", () => useAuxFigureStore.getState().setTernaryOpen(true));
    expect(useAuxFigureStore.getState().ternaryOpen).toBe(true);
  });
});
