// Gap audit 2 #2, export leg: a PDF/SVG draws each Y against its OWN X exactly
// as the canvas does -- through the live dataset AND, without one (a frozen
// document), through the dataset's own "Set As" designations (review finding
// 12). Non-monotonic X: the wire keeps acquisition order, never a sorted union.

import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";

const sheet: Dataset = {
  id: "s",
  name: "T1R1T2R2",
  data: {
    time: [300, 100, 200],
    values: [[3, 30, 33], [1, 10, 11], [2, 20, 22]],
    labels: ["R1", "T2", "R2"],
    units: ["ohm", "K", "ohm"],
    metadata: { x_column_name: "T1", x_column_unit: "K" },
  },
  columnDesignations: { 1: "X" },
};
// T2 set as the plot X (the gap #2 gesture); the X column itself is hidden.
const view = { ...defaultPlotView(), xKey: 1, hiddenChannels: [1] };

/** The finite (x, y) pairs the wire dataset carries for channel `c`. */
function pairs(d: { time: number[]; values: number[][] }, c: number): [number, number][] {
  return d.values.flatMap((row, i) => (Number.isFinite(row[c]) ? [[d.time[i], row[c]] as [number, number]] : []));
}

describe("export draws each Y on its own X", () => {
  it("a live document: R1 on T1, R2 on T2", () => {
    const document = createFigureDocument({ id: "doc", name: "F", datasetId: "s", view });
    const spec = buildFigureSpecFromDocument(document, sheet, "f");
    expect(spec.x_key).toBeUndefined(); // the concatenated X blocks are the wire's own x
    expect(spec.y_keys).toEqual([0, 2]);
    expect(pairs(spec.dataset, 0)).toEqual([[300, 3], [100, 1], [200, 2]]);
    expect(pairs(spec.dataset, 2)).toEqual([[30, 33], [10, 11], [20, 22]]);
    expect(spec.dataset.metadata.x_column_long).toBe("T1 / T2");
  });

  it("a frozen document still honours the dataset's designations (export == screen)", () => {
    const document = createFigureDocument({
      id: "doc", name: "F", datasetId: "s", view, data: { mode: "frozen", snapshot: sheet.data },
    });
    const spec = buildFigureSpecFromDocument(document, sheet, "f");
    expect(pairs(spec.dataset, 0)).toEqual([[300, 3], [100, 1], [200, 2]]);
    expect(pairs(spec.dataset, 2)).toEqual([[30, 33], [10, 11], [20, 22]]);
  });

  it("a live graph's curve names are the export's legend", () => {
    const graph: Dataset = {
      id: "g", name: "Graph1",
      data: { time: [0, 1], values: [[1, NaN], [NaN, 2]], labels: ["M", "M"], units: ["emu", "emu"], metadata: { linked_curve_legends: ["A", "B"] } },
      linkedCurves: [{ datasetId: "a", xKey: null, yKey: 0 }, { datasetId: "b", xKey: null, yKey: 0 }],
    };
    const document = createFigureDocument({ id: "doc", name: "F", datasetId: "g", view: defaultPlotView() });
    const spec = buildFigureSpecFromDocument(document, graph, "f");
    expect(spec.series_styles?.map((s) => s?.legend)).toEqual(["A", "B"]);
  });
});
