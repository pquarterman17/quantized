// The setup panel's pure model (lib/quickFigureSetup.ts): the no-op default
// look, the materialized series styles, and the preview transform (log axes,
// error bars off). The store merge is pinned in store/quickFigureSetup.test.ts.
import { describe, expect, it } from "vitest";

import type { ErrorSpan } from "./errorbars";
import { defaultPlotView } from "./plotview";
import type { SpecRender } from "./plotspec";
import {
  DEFAULT_QUICK_FIGURE_SETUP,
  lookSeriesStyles,
  previewWithLook,
  quickFigureLook,
} from "./quickFigureSetup";

const span: ErrorSpan = { axis: "y", plus: [9, 1], minus: [5, 2000] };
const xy: SpecRender = {
  kind: "xy",
  mark: "line",
  grouped: false,
  payload: {
    data: [[1, 100], [10, 1000]],
    series: [{ label: "R", unit: "" }],
    xLabel: "x",
    xUnit: "",
  },
  errorSpans: new Map([[1, [span]]]),
};

describe("quickFigureLook", () => {
  it("the default setup is a no-op on the default plot view", () => {
    const look = quickFigureLook(DEFAULT_QUICK_FIGURE_SETUP, "line-symbol", false);
    const view = defaultPlotView();
    expect(look).toEqual({
      xScale: view.xScale, yScale: view.yScale, showGrid: view.showGrid, showLegend: view.showLegend,
      legendPos: view.legendPos, series: [], errorBars: true,
    });
  });

  it("a palette gives one series style per colour, cycled by lookSeriesStyles", () => {
    const look = quickFigureLook({ ...DEFAULT_QUICK_FIGURE_SETUP, palette: "tableau10", lineStyle: "dashed" }, "line", false);
    expect(look.series).toHaveLength(8);
    expect(look.series[0]).toEqual({ line: "dashed", color: "#4E79A7" });
    expect(lookSeriesStyles(look, 10)?.[8]).toEqual(look.series[0]);
    expect(lookSeriesStyles(quickFigureLook(DEFAULT_QUICK_FIGURE_SETUP, "line", false), 3)).toBeUndefined();
  });
});

describe("previewWithLook", () => {
  it("passes a linear look through unchanged", () => {
    const look = quickFigureLook(DEFAULT_QUICK_FIGURE_SETUP, "line", false);
    expect(previewWithLook(xy, look)).toEqual(xy);
  });

  it("log axes re-express the data and the whiskers around each point", () => {
    const look = quickFigureLook({ ...DEFAULT_QUICK_FIGURE_SETUP, xScale: "log", yScale: "log" }, "line", false);
    const out = previewWithLook(xy, look);
    if (out.kind !== "xy") throw new Error("expected xy");
    expect(out.payload.data).toEqual([[0, 2], [1, 3]]);
    const [s] = out.errorSpans!.get(1)!;
    expect(s.plus[0]).toBeCloseTo(Math.log10(19) - 1); // 10 + 9 on a log axis
    expect(s.minus[0]).toBeCloseTo(1 - Math.log10(5)); // 10 - 5
    expect(s.minus[1]).toBeNull(); // 1000 - 2000 crosses zero: no finite log whisker
  });

  it("error bars off drops the whiskers", () => {
    const look = quickFigureLook({ ...DEFAULT_QUICK_FIGURE_SETUP, errorBars: false }, "line", false);
    const out = previewWithLook(xy, look);
    expect(out.kind === "xy" && out.errorSpans).toBeFalsy();
  });
});
