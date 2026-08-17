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

// G4 review round, FIX 2 (P2, RED-FIRST): verified that the Quick Figure
// Builder's own mapping UI (`QuickMappingPanel`) is agnostic of
// `Dataset.channelRoles` -- a user CAN explicitly assign a role-carrying
// (label/ignore) channel to Y there. The created figure renders through
// `effectiveChannels` (lib/plotdata.ts), which drops any such channel EVEN
// when explicitly listed in `yKeys` -- so the preview must apply the SAME
// filter, or it shows a series the real figure silently drops.
describe("quickFigurePreview — G4 review round: matches the created figure's channelRoles filtering (FIX 2)", () => {
  const roleData: DataStruct = {
    time: [0, 1, 2],
    values: [[1, 2, 100], [3, 4, 200], [5, 6, 300]],
    labels: ["kept", "ignoredButAssigned", "note"],
    units: ["", "", ""],
    metadata: {},
  };

  // RED-FIRST: fails before the fix (channel 1 was plotted verbatim,
  // ignoring `channelRoles` entirely).
  it("drops a channel explicitly assigned to Y that also carries a channelRoles entry", () => {
    const m: QuickFigureMapping = {
      xKey: null,
      yKeys: [0, 1], // channel 1 is explicitly Y despite its role below
      errorBindings: [],
      ignoredKeys: [],
    };
    const render = quickFigurePreview(roleData, m, "line", { 1: "ignore" });
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    expect(render.payload.series.map((s) => s.label)).toEqual(["kept"]);
    expect(render.payload.data).toHaveLength(2); // x + exactly one Y column
  });

  // Control: with NO channelRoles passed (every existing call site behaves
  // exactly as before), the explicitly-assigned channel still plots.
  it("control: without channelRoles, an explicitly-assigned channel still plots (unchanged)", () => {
    const m: QuickFigureMapping = {
      xKey: null,
      yKeys: [0, 1],
      errorBindings: [],
      ignoredKeys: [],
    };
    const render = quickFigurePreview(roleData, m, "line");
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    expect(render.payload.series.map((s) => s.label)).toEqual(["kept", "ignoredButAssigned"]);
  });

  // Control: a channel with a role that was NEVER assigned to Y stays absent
  // either way -- the fix only changes what happens to an EXPLICITLY-listed
  // role channel, not the ordinary "never assigned" case.
  it("control: an unassigned role-carrying channel is absent from the preview regardless", () => {
    const m: QuickFigureMapping = {
      xKey: null,
      yKeys: [0],
      errorBindings: [],
      ignoredKeys: [1],
    };
    const render = quickFigurePreview(roleData, m, "line", { 1: "ignore" });
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    expect(render.payload.series.map((s) => s.label)).toEqual(["kept"]);
  });
});
