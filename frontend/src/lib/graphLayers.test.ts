// Origin gap audit 3 #15: graph layers — an inset graph of OTHER data with
// its own axes, an image and a table, positioned over the plot.

import { describe, expect, it } from "vitest";

import {
  insetNotice,
  layerAxisRange,
  layerTickLabels,
  layerTicks,
  parseTableText,
  resolveInsetAxes,
  resolveInsetCurves,
  sanitizeLayers,
  tableFromRows,
  type InsetLayer,
} from "./graphLayers";
import { layersWire } from "./graphLayersWire";
import { viewOverrides } from "./figureViewOverrides";
import { templateStyleOverrides } from "./graphTemplateOverrides";
import { defaultPlotView } from "./plotview";
import { NO_CURVES_REASON } from "./linkedCurvesLite";
import type { Dataset } from "./types";

const loop: Dataset = {
  id: "loop",
  name: "M(H) 300K",
  data: {
    // A hysteresis branch: X runs down then up (non-monotonic), row order kept.
    time: [0, 1, 2, 3, 4],
    values: [[100, 1], [0, 0.2], [-100, -1], [0, -0.2], [100, 1]],
    labels: ["H", "M"],
    units: ["Oe", "emu"],
    metadata: {},
  },
  excludedRows: [3],
};
const other: Dataset = {
  id: "dmdh",
  name: "dM/dH",
  data: { time: [1, 2, 3], values: [[5], [NaN], [7]], labels: ["dM"], units: [""], metadata: {} },
};

function inset(over: Partial<InsetLayer> = {}): InsetLayer {
  return {
    id: "L1", kind: "inset", at: [0.5, 0.1, 0.3, 0.3], mark: "line",
    curves: [{ datasetId: "loop", xKey: 0, yKey: 1, label: "" }],
    x: { lim: null, scale: "linear", label: "H (Oe)", step: null },
    y: { lim: null, scale: "linear", label: "M", step: null },
    ...over,
  };
}

describe("sanitizeLayers", () => {
  it("keeps valid layers, clamps placement into the frame, drops junk and repeats", () => {
    const out = sanitizeLayers([
      inset({ at: [0.9, -1, 0.5, 2] as never }),
      { id: "L1", kind: "table", rows: [["a"]] }, // repeated id
      { id: "x", kind: "chart" },
      { id: "img", kind: "image", src: "javascript:alert(1)" },
      { id: "svg", kind: "image", src: "data:image/svg+xml;base64,PHN2Zz4=" }, // no PNG rendering: cannot export
      { id: "t", kind: "table", rows: [["a", 1], "bad"], header: false },
      null,
    ]);
    expect(out.map((l) => l.id)).toEqual(["L1", "t"]);
    expect(out[0].at).toEqual([0.5, 0, 0.5, 1]);
    expect(out[1]).toMatchObject({ rows: [["a", "1"], []], header: false });
  });
});

describe("resolveInsetCurves: live sources, fail closed", () => {
  it("reads the bound columns in row order without masked rows; gaps stay gaps", () => {
    const [c] = resolveInsetCurves(inset(), [loop, other]);
    expect(c.x).toEqual([100, 0, -100, 100]); // row 3 masked
    expect(c.y).toEqual([1, 0.2, -1, 1]);
    const [d] = resolveInsetCurves(inset({ curves: [{ datasetId: "dmdh", xKey: null, yKey: 0, label: "" }] }), [other]);
    expect(d.x).toEqual([1, 2, 3]);
    expect(d.y).toEqual([5, null, 7]);
  });

  it("never rebinds a curve whose dataset or column is gone", () => {
    const layer = inset({
      curves: [
        { datasetId: "deleted", xKey: null, yKey: 0, label: "" },
        { datasetId: "dmdh", xKey: null, yKey: 3, label: "" },
      ],
    });
    const resolved = resolveInsetCurves(layer, [loop, other]);
    expect(resolved).toEqual([]);
    expect(insetNotice(layer, resolved)).toBe(NO_CURVES_REASON);
  });
});

describe("inset axes", () => {
  it("auto range pads the data by 5%; typed limits win", () => {
    expect(layerAxisRange({ lim: null, scale: "linear", label: "", step: null }, [0, 10, null])).toEqual([-0.5, 10.5]);
    expect(layerAxisRange({ lim: [2, 4], scale: "linear", label: "", step: null }, [0, 10])).toEqual([2, 4]);
    // A log axis ignores a non-positive typed limit and non-positive data.
    expect(layerAxisRange({ lim: [-1, 4], scale: "log", label: "", step: null }, [-5, 1, 100])).toEqual([
      0.794328234724, 125.892541179,
    ]);
  });

  it("ticks are multiples of the step (or a nice one); log ticks are decades", () => {
    expect(layerTicks([-0.5, 10.5], "linear", null)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(layerTicks([0, 1], "linear", 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(layerTicks([0.5, 2000], "log", null)).toEqual([1, 10, 100, 1000]);
    expect(layerTickLabels([0, 0.25, 0.5])).toEqual(["0.00", "0.25", "0.50"]);
    expect(layerTickLabels([0, 2, 4])).toEqual(["0", "2", "4"]);
    expect(layerTickLabels([0.01, 0.1, 1], "log")).toEqual(["0.01", "0.1", "1"]);
    expect(layerTickLabels([1e-6, 1e-5])).toEqual(["1e-6", "1e-5"]);
  });

  it("resolves both axes over the curves' data", () => {
    const layer = inset();
    const axes = resolveInsetAxes(layer, resolveInsetCurves(layer, [loop]));
    expect(axes.x.range).toEqual([-110, 110]);
    expect(axes.x.label).toBe("H (Oe)");
    expect(axes.y.ticks.length).toBeGreaterThan(1);
  });
});

describe("tables", () => {
  it("parses typed cells (tab or comma) and snapshots worksheet rows", () => {
    expect(parseTableText("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseTableText("T, Hc\n10, 120")).toEqual([["T", "Hc"], ["10", "120"]]);
    expect(tableFromRows(loop, 1, 2, true)).toEqual([["X", "H", "M"], ["0", "100", "1"], ["1", "0", "0.2"]]);
  });
});

describe("layersWire: what the export draws is what the screen resolved", () => {
  it("carries resolved curves, ranges, ticks and tick text; images and tables as placed", () => {
    const wire = layersWire(
      [
        inset(),
        { id: "i", kind: "image", at: [0, 0, 0.2, 0.2], src: "data:image/png;base64,AAAA", name: "a" },
        { id: "t", kind: "table", at: [0, 0.7, 0.3, 0.2], rows: [["a"]], header: true },
      ],
      [loop],
      (slot) => `#00000${slot}`,
    )!;
    expect(wire[0]).toMatchObject({
      kind: "inset", at: [0.5, 0.1, 0.3, 0.3], mark: "line",
      x: { lim: [-110, 110], scale: "linear", label: "H (Oe)" },
      curves: [{ x: [100, 0, -100, 100], y: [1, 0.2, -1, 1], color: "#000000" }],
    });
    const x = wire[0].kind === "inset" ? wire[0].x : null;
    expect(x?.tick_labels).toEqual(layerTickLabels(x!.ticks, "linear"));
    expect(wire[1]).toEqual({ kind: "image", at: [0, 0, 0.2, 0.2], src: "data:image/png;base64,AAAA" });
    expect(wire[2]).toEqual({ kind: "table", at: [0, 0.7, 0.3, 0.2], rows: [["a"]], header: true });
  });

  it("an inset whose sources are missing exports the same notice the screen shows", () => {
    const wire = layersWire([inset()], [])!;
    expect(wire[0]).toMatchObject({ kind: "inset", curves: [], notice: NO_CURVES_REASON });
  });

  it("no layers: no wire field", () => {
    expect(layersWire([], [loop])).toBeUndefined();
    expect(layersWire(undefined, [loop])).toBeUndefined();
  });

  it("every export request built from a view carries its layers (viewOverrides)", () => {
    const ov = viewOverrides({ ...defaultPlotView(), layers: [inset()] }, [loop]);
    expect(ov?.layers?.[0]).toMatchObject({ kind: "inset", curves: [{ x: [100, 0, -100, 100] }] });
    expect(viewOverrides(defaultPlotView(), [loop])?.layers).toBeUndefined();
  });

  it("a graph template never carries another figure's layers", () => {
    expect(templateStyleOverrides({ layers: [], font_size: 9 })).toEqual({ font_size: 9 });
  });
});
