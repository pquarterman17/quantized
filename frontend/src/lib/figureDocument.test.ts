import { describe, expect, it } from "vitest";

import {
  createFigureDocument,
  FIGURE_DOCUMENT_SCHEMA,
  FIGURE_DOCUMENT_VERSION,
  figureDocumentVersion,
} from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { DataStruct } from "./types";

const snapshot: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["signal"],
  units: ["V"],
  metadata: {},
};

describe("FigureDocument v1", () => {
  it("separates data bindings from visual state and preserves rich error roles", () => {
    const document = createFigureDocument({
      id: "figure-1",
      name: "Transfer curve",
      datasetId: "dataset-1",
      view: {
        ...defaultPlotView(),
        xKey: 0,
        yKeys: [1],
        y2Keys: [2],
        errKeys: { 1: 3 },
        plotTitle: "Device A",
      },
      mark: "scatter",
      groupKey: 4,
      facetKey: 5,
      axisBreaks: { x: [[2, 3]] },
      errors: [
        { channel: 3, target: 1, axis: "y", side: "+" },
        { channel: 4, target: 1, axis: "y", side: "-" },
      ],
    });

    expect(document).toMatchObject({
      schema: FIGURE_DOCUMENT_SCHEMA,
      version: FIGURE_DOCUMENT_VERSION,
      id: "figure-1",
      bindings: {
        datasetId: "dataset-1",
        xKey: 0,
        yKeys: [1],
        y2Keys: [2],
        groupKey: 4,
        facetKey: 5,
      },
      plot: {
        mark: "scatter",
        view: { plotTitle: "Device A" },
        axisBreaks: { x: [[2, 3]], y: [], y2: [] },
      },
    });
    expect(document.bindings.errors.map(({ side }) => side)).toEqual(["+", "-"]);
    expect(document.plot.view).not.toHaveProperty("xKey");
    expect(document.plot.view).not.toHaveProperty("errKeys");
  });

  it("projects legacy symmetric Y errors without losing them", () => {
    const document = createFigureDocument({
      id: "figure-2",
      name: "Legacy",
      datasetId: "dataset-1",
      view: { ...defaultPlotView(), errKeys: { 2: 7 } },
    });

    expect(document.bindings.errors).toEqual([
      { target: 2, channel: 7, axis: "y", side: "both" },
    ]);
  });

  it("round-trips as plain versioned JSON", () => {
    const document = createFigureDocument({
      id: "figure-3",
      name: "Frozen",
      datasetId: null,
      view: defaultPlotView(),
      data: { mode: "frozen", snapshot },
      output: { format: "png", dpi: 600 },
    });

    const restored: unknown = JSON.parse(JSON.stringify(document));
    expect(restored).toEqual(document);
    expect(figureDocumentVersion(restored)).toBe(1);
    expect(figureDocumentVersion({ ...document, version: 2 })).toBe(2);
    expect(figureDocumentVersion({ version: 1 })).toBeNull();
  });

  it("rejects contradictory live/frozen data ownership", () => {
    expect(() => createFigureDocument({
      id: "bad-frozen",
      name: "Bad",
      datasetId: null,
      view: defaultPlotView(),
      data: { mode: "frozen" },
    })).toThrow("requires a data snapshot");

    expect(() => createFigureDocument({
      id: "bad-live",
      name: "Bad",
      datasetId: "dataset-1",
      view: defaultPlotView(),
      data: { mode: "live", snapshot },
    })).toThrow("cannot own a frozen data snapshot");
  });
});
