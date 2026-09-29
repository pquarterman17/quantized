// The setup panel's pure model (lib/quickFigureSetup.ts): the no-op default
// look, the materialized series styles, and the preview transform (log axes,
// error bars off). The store merge is pinned in store/quickFigureSetup.test.ts.
import { describe, expect, it } from "vitest";

import type { ErrorSpan } from "./errorbars";
import { defaultPlotView } from "./plotview";
import type { SpecRender } from "./plotspec";
import {
  DEFAULT_QUICK_FIGURE_SETUP,
  logDropNotice,
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

  // Audit item 7: a log axis silently dropped the non-positive points.
  it("names how many points a log axis hides, in one sentence", () => {
    const withZeros: SpecRender = {
      ...xy,
      payload: { ...xy.payload, data: [[-1, 0, 5, 10], [3, 4, -2, 7], [1, null, 0, 2]], series: [{ label: "A", unit: "" }, { label: "B", unit: "" }] },
    };
    const look = (xScale: "linear" | "log", yScale: "linear" | "log") =>
      quickFigureLook({ ...DEFAULT_QUICK_FIGURE_SETUP, xScale, yScale }, "line", false);
    expect(logDropNotice(withZeros, look("linear", "linear"))).toBeNull();
    expect(logDropNotice(xy, look("log", "log"))).toBeNull();
    // Rows 0 and 1 (X -1, 0) carry three drawn points; the null is no point.
    expect(logDropNotice(withZeros, look("log", "linear"))).toBe("The log X axis hides 3 points with X ≤ 0.");
    expect(logDropNotice(withZeros, look("linear", "log"))).toBe("The log Y axis hides 2 points with Y ≤ 0.");
    // Each point is counted once: on X when its X is out, else on Y.
    expect(logDropNotice(withZeros, look("log", "log"))).toBe(
      "The log axes hide 5 points: 3 with X ≤ 0 and 2 with Y ≤ 0.",
    );
  });

  it("error bars off drops the whiskers", () => {
    const look = quickFigureLook({ ...DEFAULT_QUICK_FIGURE_SETUP, errorBars: false }, "line", false);
    const out = previewWithLook(xy, look);
    expect(out.kind === "xy" && out.errorSpans).toBeFalsy();
  });
});
