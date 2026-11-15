// Gap audit 4 lane A review: the colour gradient's edge cases, each pinned
// against a fix seen to fail without it.
//   L6  the marks chunk (the canvas' resolver) failed: neither side draws the
//       gradient and the dash cycle past the palette comes back;
//   L7  the live-view fallback export refuses the gradient as the canvas does
//       when the focused document pins its styles;
//   L2  the greyscale export greys the curves in the gradient's order.

import { afterEach, describe, expect, it } from "vitest";

import { buildExportStyles } from "./exportStyles";
import { createFigureDocument } from "./figureDocument";
import { buildStageFigureSpec } from "./figureSpecStage";
import { defaultPlotView } from "./plotview";
import { loseRampResolver } from "./seriesRamp";
import { rampColor, rampSeriesStyles, rampView } from "./seriesRampImpl";
import { windowCyclesSeriesStyles } from "./seriesStyleCycle";
import type { Dataset } from "./types";

const n = 12;
const dataset: Dataset = {
  id: "twelve",
  name: "twelve.csv",
  data: {
    time: [0, 1, 2],
    values: [0, 1, 2].map((r) => Array.from({ length: n }, (_, c) => r + c)),
    labels: Array.from({ length: n }, (_, c) => `M ${(c * 7) % 13} K`),
    units: Array.from({ length: n }, () => ""),
    metadata: {},
  },
};
const view = { ...defaultPlotView(), seriesRamp: { map: "viridis" as const } };
const OPTS = { fmt: "pdf" as const, style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };

afterEach(() => loseRampResolver(false));

describe("L6: a failed marks chunk drops the gradient on both sides", () => {
  it("restores the dash cycle past the palette and the export skips the gradient", () => {
    expect(windowCyclesSeriesStyles(false, view, undefined, n)).toBe(false);
    loseRampResolver();
    expect(windowCyclesSeriesStyles(false, view, undefined, n)).toBe(true);
    expect(rampView(view, dataset.data, undefined, {})).toBe(view);
  });
});

describe("L7: the fallback export refuses the gradient for a pinned document", () => {
  it("routes around the document (another dataset) yet still refuses, as the canvas does", () => {
    const base = createFigureDocument({ id: "w1", name: "W", datasetId: "elsewhere", view });
    const doc = { ...base, publication: { ...base.publication, seriesStyles: null } };
    const state = {
      ...view, autoSeriesStyles: false, focusedWindowId: "w1",
      windowsForSave: () => [{ id: "w1", kind: "plot", document: doc }],
    };
    const spec = buildStageFigureSpec((() => state) as never, dataset, "twelve", OPTS);
    const colours = (spec.series_styles ?? []).map((s) => s?.color);
    expect(colours).not.toContain(rampColor({ map: "viridis" }, 0, n));
    const open = buildStageFigureSpec((() => ({ ...state, windowsForSave: () => [] })) as never, dataset, "twelve", OPTS);
    expect(open.series_styles?.[0]?.color).toBe(rampColor({ map: "viridis" }, 0, n)); // control: no pin, gradient
  });
});

describe("L2: greyscale follows the gradient's order", () => {
  it("every curve carries its gradient rank onto the wire, own colour included", () => {
    const labels = (ch: number) => dataset.data.labels[ch];
    const styles = rampSeriesStyles({ 3: { color: "#123456" } }, [0, 1, 2, 3], { map: "plasma", order: "value" }, labels);
    const wire = buildExportStyles([0, 1, 2, 3], styles).map((s) => s?.ramp_rank);
    // labels 0, 7, 1, 8 K -> ranks 0, 2, 1, 3
    expect(wire).toEqual([0, 2, 1, 3]);
  });
});
