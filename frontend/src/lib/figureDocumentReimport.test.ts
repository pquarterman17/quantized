import { describe, expect, it } from "vitest";

import { createFigureDocument, type FigureDocument } from "./figureDocument";
import { resetFigureDocumentForReshape } from "./figureDocumentReimport";
import { defaultPlotView } from "./plotview";

function doc(overrides: Parameters<typeof createFigureDocument>[0]["view"] = defaultPlotView()): FigureDocument {
  return createFigureDocument({
    id: "fig-1",
    name: "Figure",
    datasetId: "d1",
    view: overrides,
    groupKey: 4,
    facetKey: 5,
  });
}

describe("resetFigureDocumentForReshape", () => {
  it("clears xKey/yKeys/y2Keys, errors, and every channel-indexed view field", () => {
    const source = doc({
      ...defaultPlotView(),
      xKey: 0,
      yKeys: [1, 5],
      y2Keys: [0],
      seriesOrder: [0, 1, 5],
      hiddenChannels: [5],
      seriesStyles: { 0: { color: "#ff0000" }, 5: { color: "#00ff00" } },
      seriesLabels: { 5: "stale" },
      xLim: [0, 1],
      yLim: [0, 1],
      xStep: 0.1,
      yStep: 0.1,
      y2Lim: [0, 1],
      y2Scale: "log",
      y2Step: 0.1,
      y2AxisLabel: "y2",
    });

    const reset = resetFigureDocumentForReshape(source);

    expect(reset.bindings.xKey).toBeNull();
    expect(reset.bindings.yKeys).toBeNull();
    expect(reset.bindings.y2Keys).toBeNull();
    expect(reset.bindings.errors).toEqual([]);
    expect(reset.plot.view.seriesOrder).toBeNull();
    expect(reset.plot.view.hiddenChannels).toEqual([]);
    expect(reset.plot.view.seriesStyles).toEqual({});
    expect(reset.plot.view.seriesLabels).toEqual({});
    expect(reset.plot.view.xLim).toBeNull();
    expect(reset.plot.view.yLim).toBeNull();
    expect(reset.plot.view.xStep).toBeNull();
    expect(reset.plot.view.yStep).toBeNull();
    expect(reset.plot.view.y2Lim).toBeNull();
    expect(reset.plot.view.y2Scale).toBeNull();
    expect(reset.plot.view.y2Step).toBeNull();
    expect(reset.plot.view.y2AxisLabel).toBe("");
  });

  // The gate lives at the CALL SITE (`reimportColumnsChanged`): an in-range
  // index is not proof its column still means the same thing after a
  // column-count change, so the helper never second-guesses the caller.
  it("resets even when every index is in range — in-range is not proof of freshness", () => {
    const source = doc({
      ...defaultPlotView(),
      xKey: 0,
      yKeys: [1],
      seriesStyles: { 0: { color: "#ff0000" } },
    });

    const reset = resetFigureDocumentForReshape(source);

    expect(reset).not.toBe(source);
    expect(reset.bindings.yKeys).toBeNull();
    expect(reset.plot.view.seriesStyles).toEqual({});
  });

  // PR M booked finding (G5 canonical-state review): groupKey/facetKey now
  // clear like every other channel-indexed binding — a stale groupKey used
  // to reach the backend as FigureSpec.group_col and raise a raw ValueError
  // instead of a clear message (lib/figureSpec.ts, calc/plotting.py).
  it("clears groupKey/facetKey on a column reshape (PR M booked finding)", () => {
    const source = doc({ ...defaultPlotView(), yKeys: [5] });

    const reset = resetFigureDocumentForReshape(source);

    expect(reset.bindings.groupKey).toBeNull();
    expect(reset.bindings.facetKey).toBeNull();
  });

  it("preserves non-channel-indexed state (name, output, publication, data mode)", () => {
    const source: FigureDocument = {
      ...doc({ ...defaultPlotView(), yKeys: [2], plotTitle: "Kept" }),
      publication: { overrides: { grid: true } },
    };

    const reset = resetFigureDocumentForReshape(source);

    expect(reset.name).toBe("Figure");
    expect(reset.plot.view.plotTitle).toBe("Kept");
    expect(reset.publication).toEqual({ overrides: { grid: true } });
    expect(reset.data).toEqual(source.data);
  });

  it("clones rather than mutates — the source document is unchanged after a reset", () => {
    const source = doc({ ...defaultPlotView(), yKeys: [5], hiddenChannels: [5] });
    const snapshot = structuredClone(source);

    resetFigureDocumentForReshape(source);

    expect(source).toEqual(snapshot);
  });
});
