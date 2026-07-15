import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset, OriginFigure } from "../lib/types";
import { useApp } from "./useApp";

const book: Dataset = {
  id: "d1",
  name: "Project:Book1",
  data: {
    time: [1, 2], values: [[10], [20]], labels: ["signal"], units: [""],
    metadata: { origin_book: "Book1", x_column_name: "A", origin_column_names: ["B"] },
  },
};
const figure: OriginFigure = {
  name: "Graph1", x_from: 0, x_to: 2, x_log: false,
  y_from: 0, y_to: 20, y_log: false, n_curves: 1, annotations: [],
  curves: [{ book: "Book1", x: "A", y: "B", style: "line" }],
};

beforeEach(() => {
  useApp.setState({
    datasets: [book], activeId: null, worksheetId: null,
    originFigures: [{ id: "f1", stem: "Project", figure, datasetId: "d1", siblingIds: ["d1"] }],
    originWorksheetSeed: null, graphBuilderSeed: null, graphBuilderOpen: false,
    stageTab: "plot",
  });
});

describe("Origin figure fallbacks", () => {
  it("opens the exact workbook and hands its bound columns to the worksheet", async () => {
    await useApp.getState().openOriginFigureSource("f1");
    expect(useApp.getState()).toMatchObject({
      worksheetId: "d1",
      stageTab: "worksheet",
      originWorksheetSeed: { datasetId: "d1", columns: [-1, 0] },
    });
  });

  it("uses raw letters against a workbook only when the manual picker authorizes it", async () => {
    useApp.setState({
      originFigures: [{
        id: "manual", stem: "Project", datasetId: null, siblingIds: ["d1"],
        figure: { ...figure, curves: [{ book: "MissingBook", x: "A", y: "B" }] },
      }],
    });
    await useApp.getState().openOriginFigureSource("manual", "d1", { manual: true });
    expect(useApp.getState().originWorksheetSeed).toEqual({ datasetId: "d1", columns: [-1, 0] });
  });

  it("seeds Graph Builder with the exact decoded X/Y binding", async () => {
    await useApp.getState().remakeOriginFigure("f1");
    expect(useApp.getState().graphBuilderOpen).toBe(true);
    expect(useApp.getState().graphBuilderSeed).toEqual({
      version: 1,
      zones: {
        x: null,
        y: [{ datasetId: "d1", channel: 0 }],
        group: null,
        facet: null,
      },
      mark: "line",
    });
  });

  it("materializes and seeds the existing provenance-stamped overlay for cross-book curves", async () => {
    const book2: Dataset = {
      ...book,
      id: "d2",
      name: "Project:Book2",
      data: { ...book.data, metadata: { ...book.data.metadata, origin_book: "Book2" } },
    };
    const cross: OriginFigure = {
      ...figure,
      n_curves: 2,
      curves: [
        { book: "Book1", x: "A", y: "B", style: "line" },
        { book: "Book2", x: "A", y: "B", style: "line" },
      ],
    };
    useApp.setState({
      datasets: [book, book2],
      originFigures: [{ id: "cross", stem: "Project", figure: cross, datasetId: "d1", siblingIds: ["d1", "d2"] }],
    });
    await useApp.getState().remakeOriginFigure("cross");
    const state = useApp.getState();
    const overlay = state.datasets.find((ds) => ds.data.metadata?.origin_overlay_source === "cross");
    expect(overlay).toBeDefined();
    expect(state.graphBuilderSeed?.zones.y).toEqual([
      { datasetId: overlay!.id, channel: 0 },
      { datasetId: overlay!.id, channel: 1 },
    ]);
    expect(state.datasets.filter((ds) => ds.data.metadata?.origin_overlay_source === "cross")).toHaveLength(1);
  });

  it("seeds a one-book multi-X remake from its segmented overlay", async () => {
    const multiX: Dataset = {
      id: "mx", name: "Moke:Book2",
      data: {
        time: [10, 20],
        values: [[1, 30, 3, 50, 5], [2, 40, 4, 60, 6]],
        labels: ["B", "E", "H", "I", "L"],
        units: ["", "Oe", "", "Oe", ""],
        metadata: {
          origin_book: "Book2", x_column_name: "A",
          origin_column_names: ["B", "E", "H", "I", "L"],
        },
      },
    };
    const multiFigure: OriginFigure = {
      ...figure, name: "Graph3", n_curves: 3,
      curves: [
        { book: "Book2", x: "A", y: "B", style: "line_symbol" },
        { book: "Book2", x: "E", y: "H", style: "line_symbol" },
        { book: "Book2", x: "I", y: "L", style: "line_symbol" },
      ],
    };
    useApp.setState({
      datasets: [multiX],
      originFigures: [{
        id: "multi-x", stem: "Moke", figure: multiFigure,
        datasetId: "mx", siblingIds: ["mx"],
      }],
    });

    await useApp.getState().remakeOriginFigure("multi-x");

    const state = useApp.getState();
    const overlay = state.datasets.find(
      (ds) => ds.data.metadata?.origin_overlay_source === "multi-x",
    );
    expect(overlay).toBeDefined();
    expect(overlay!.data.time).toEqual([10, 20, 30, 40, 50, 60]);
    expect(state.graphBuilderSeed).toEqual({
      version: 1,
      zones: {
        x: null,
        y: [0, 1, 2].map((channel) => ({ datasetId: overlay!.id, channel })),
        group: null,
        facet: null,
      },
      mark: "line",
    });
  });
});
