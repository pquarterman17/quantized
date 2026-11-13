// Figures-audit #8 (Column/Bar charts from a summary table) and #6's axis
// double-click hit test.

import { describe, expect, it } from "vitest";

import { buildBarMatrix, withColumnErrors } from "../../lib/barMatrix";
import { errorHalfWidth, errorBarNote } from "../../lib/statMarks";
import { textAxisFallbackChannel } from "../../lib/modeling";
import type { Dataset } from "../../lib/types";
import { datasetViewDefaults } from "../../store/windowDefaults";
import { axisAtPoint } from "./axisAtPoint";
import { barSeriesChannels } from "./useStatBarSeries";

/** bar.csv as the CSV importer produces it: the text first column became a
 *  categorical channel (codes, last) and the axis a 1..N "Sample Index". */
const bar: Dataset = {
  id: "bar",
  name: "bar.csv",
  data: {
    time: [1, 2, 3, 4],
    values: [[3.2, 0.3, 0], [4.5, 0.4, 1], [2.1, 0.2, 2], [5.0, 0.6, 3]],
    labels: ["Value", "SD", "Sample"],
    units: ["", "", ""],
    metadata: { x_column_name: "Sample Index", all_column_names: ["Sample", "Value", "SD"] },
    cat_levels: { 2: ["A", "B", "C", "D"] },
  },
  errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
};

describe("Column / Bar from a Sample,Value,SD table (#8)", () => {
  it("bars are only the Y value columns: not the category codes, not the error column", () => {
    expect(barSeriesChannels([0, 1, 2], 0, [2, null], bar.errorRoles)).toEqual([0]);
  });

  it("the bound SD column becomes each one-row category's error bar, named in the note", () => {
    const bd = withColumnErrors(buildBarMatrix(bar.data, 2, [0], ["Value"]), bar.data, 2, [0], [1]);
    expect(bd.groups.map((g) => g.series[0].err)).toEqual([0.3, 0.4, 0.2, 0.6]);
    expect(errorHalfWidth("column", NaN, 1, bd.groups[0].series[0].err)).toBe(0.3);
    expect(errorHalfWidth("none", NaN, 1, 0.3)).toBeNaN();
    expect(errorBarNote("column", bd.errorColumn ?? null)).toBe("Error bars: SD (error column)");
  });

  it("cells with several rows keep their statistics", () => {
    const many = { ...bar.data, values: [...bar.data.values, [3.4, 0.9, 0]] };
    const bd = withColumnErrors(buildBarMatrix(many, 2, [0], ["Value"]), many, 2, [0], [1]);
    expect(bd.groups[0].series[0].err).toBeUndefined();
    expect(bd.groups[1].series[0].err).toBe(0.4);
  });

  it("a text first column is the default X (category labels), not codes against 1..N", () => {
    expect(textAxisFallbackChannel(bar)).toBe(2);
    expect(datasetViewDefaults(bar).xKey).toBe(2);
    const numeric: Dataset = { ...bar, data: { ...bar.data, metadata: { x_column_name: "Time" } } };
    expect(datasetViewDefaults(numeric).xKey).toBeNull();
  });
});

describe("axis double-click hit test (#6)", () => {
  const root = { left: 0, right: 500, top: 0, bottom: 400 };
  const over = { left: 60, right: 440, top: 20, bottom: 340 };
  it("finds X below, Y left, Y2 right (only when drawn), nothing inside or in corners", () => {
    expect(axisAtPoint(over, root, 200, 370, false)).toBe("x");
    expect(axisAtPoint(over, root, 30, 200, false)).toBe("y");
    expect(axisAtPoint(over, root, 470, 200, true)).toBe("y2");
    expect(axisAtPoint(over, root, 470, 200, false)).toBeNull();
    expect(axisAtPoint(over, root, 200, 200, true)).toBeNull();
    expect(axisAtPoint(over, root, 30, 370, true)).toBeNull();
  });
});
