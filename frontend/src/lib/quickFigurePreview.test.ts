import { describe, expect, it } from "vitest";

import { quickFigurePreview } from "./quickFigurePreview";
import type { QuickFigureMapping } from "./quickFigureMapping";
import type { DataStruct } from "./types";

const data: DataStruct = {
  time: [0, 1],
  values: [[10, .5, .2, 100], [20, .6, .3, 200]],
  labels: ["Y", "Y+", "Y-", "alternate X"],
  units: ["V", "V", "V", "s"],
  metadata: { x_column_name: "time", x_column_unit: "s" },
};

const mapping: QuickFigureMapping = {
  xKey: 3,
  yKeys: [0],
  errorBindings: [
    { channel: 1, target: 0, axis: "y", side: "+" },
    { channel: 2, target: 0, axis: "y", side: "-" },
  ],
  ignoredKeys: [],
};

describe("quickFigurePreview", () => {
  it("uses the canonical payload with the selected X/Y and asymmetric errors", () => {
    const render = quickFigurePreview(data, mapping, "line-symbol");
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    expect(render.payload.xLabel).toBe("alternate X");
    expect(render.payload.data).toEqual([[100, 200], [10, 20]]);
    expect(render.mark).toBe("line");
    expect(render.showMarkers).toBe(true);
    expect(render.errorSpans?.get(1)?.[0]).toMatchObject({ axis: "y", plus: [.5, .6], minus: [.2, .3] });
  });

  it("returns the shared factual hint when no Y is assigned", () => {
    const render = quickFigurePreview(data, { ...mapping, yKeys: [] }, "scatter");
    expect(render).toEqual({
      kind: "message",
      tone: "hint",
      message: "Assign at least one Y series to preview the figure.",
    });
  });
});
