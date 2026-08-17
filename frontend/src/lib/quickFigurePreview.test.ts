import { describe, expect, it } from "vitest";

import {
  assignQuickFigureColumn,
  initialQuickFigureMapping,
  useAcquisitionAxis,
} from "./quickFigureMapping";
import { quickFigurePreview } from "./quickFigurePreview";
import type { QuickFigureMapping } from "./quickFigureMapping";
import type { DataStruct, Dataset } from "./types";

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

// Render-level regression probes (G3, pinning the user-visible symptom of the
// G2 P2 fixes): built through the public mapping API (assignQuickFigureColumn
// sequences), never hand-forged binding arrays, so a regression in the
// mapping layer surfaces here too.
describe("quickFigurePreview — G2 error-binding fixes stay fixed at the render layer", () => {
  it("reassigning X after an x-error binding existed leaves NO x-error span from the stale column", () => {
    const source: Dataset = {
      id: "d1",
      name: "xerr.csv",
      data: {
        time: [0, 1],
        values: [[0, 100, 10, 200], [1, 101, 11, 201]],
        labels: ["A", "B", "Y", "U"],
        units: ["", "", "", ""],
        metadata: {},
      },
    };
    let m = initialQuickFigureMapping(source);
    m = assignQuickFigureColumn(m, 0, { role: "x" }); // X = A (channel 0)
    m = assignQuickFigureColumn(m, 3, { role: "error", target: -1, axis: "x", side: "both" }); // U paired with X
    m = assignQuickFigureColumn(m, 1, { role: "x" }); // reassign X = B (channel 1) -- U's binding is now stale
    m = assignQuickFigureColumn(m, 2, { role: "y" });

    const render = quickFigurePreview(source.data, m, "line");
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    for (const spans of render.errorSpans?.values() ?? []) {
      expect(spans.some((span) => span.axis === "x")).toBe(false);
    }
  });

  it("two successive y-error bindings on the same target render exactly the LAST-assigned column's span", () => {
    const source: Dataset = {
      id: "d2",
      name: "yerr.csv",
      data: {
        time: [0, 1],
        values: [[0, 10, 1, 5], [1, 20, 1, 5]],
        labels: ["T", "Y", "C1", "C2"],
        units: ["", "", "", ""],
        metadata: {},
      },
    };
    let m = initialQuickFigureMapping(source);
    m = assignQuickFigureColumn(m, 0, { role: "ignore" });
    m = assignQuickFigureColumn(m, 1, { role: "y" });
    m = assignQuickFigureColumn(m, 2, { role: "error", target: 1, axis: "y", side: "both" }); // C1 -> Y
    m = assignQuickFigureColumn(m, 3, { role: "error", target: 1, axis: "y", side: "both" }); // C2 -> Y, replaces C1
    m = useAcquisitionAxis(m); // X stays the acquisition axis throughout

    const render = quickFigurePreview(source.data, m, "line");
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    const span = render.errorSpans?.get(1)?.[0];
    expect(span).toMatchObject({ axis: "y", plus: [5, 5], minus: [5, 5] });
  });
});
