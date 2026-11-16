// UX-Q: the Axis dialog's "Title size (pt)" must reach the export request as
// the SAME points (stored px = pt x 4/3; `axisTitleWire` sends px x 0.75; the
// backend draws that number as matplotlib points -- see
// tests/test_export_axis_titles.py).
import { describe, expect, it } from "vitest";

import { axisDraft, axisPatch } from "./axisDialogModel";
import { axisTitleWire } from "./exportAxisTitles";
import { defaultPlotView } from "./plotview";

describe("axis title size: dialog pt -> export wire pt", () => {
  it.each(["10.5", "11", "9.75", "12"])("a typed %s pt is sent as %s pt", (typed) => {
    const view = defaultPlotView();
    const patch = axisPatch(view, "y", { ...axisDraft(view, "y"), titleSize: typed });
    const wired = axisTitleWire({ axisLabelStyles: patch.axisLabelStyles ?? {}, axisLabelOffsets: {} });
    expect(wired.axis_label_styles?.y?.size).toBeCloseTo(Number(typed), 3);
  });

  it("an untouched stored size round-trips exactly (even a 3-decimal px)", () => {
    const view = { ...defaultPlotView(), axisLabelStyles: { y: { size: 14.001 } } };
    const again = axisPatch(view, "y", axisDraft(view, "y")).axisLabelStyles?.y?.size ?? 0;
    expect(Math.abs(again - 14.001)).toBeLessThan(1e-9);
  });
});
