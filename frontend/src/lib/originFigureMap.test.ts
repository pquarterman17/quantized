// Origin heatmap / contour / ternary figures -> Map tab / ternary workshop
// (lib/originFigureMap.ts; backend io/origin_project/opju_map_plots.py).
import { describe, expect, it } from "vitest";

import { resolveFigureDataset } from "./originFigureEntries";
import { figureMapState, queueFigureTernary } from "./originFigureMap";
import { takeTernaryPicks } from "./ternaryPending";
import type { Dataset, OriginFigure } from "./types";

const figure = (overrides: Partial<OriginFigure> = {}): OriginFigure => ({
  name: "Graph1",
  x_from: 0.5,
  x_to: 2.5,
  x_log: false,
  y_from: 0.5,
  y_to: 2.5,
  y_log: false,
  n_curves: 0,
  annotations: [],
  ...overrides,
});

// A 2x2 matrix book as the importer builds it: X, Y, Z per cell, is2D.
const matrix = (book: string): Dataset => ({
  id: `m-${book}`,
  name: book,
  data: {
    time: [1, 2, 1, 2],
    values: [[1, 1, 5], [2, 1, 6], [1, 2, 7], [2, 2, 8]],
    labels: ["X", "Y", "Z"],
    units: ["", "", ""],
    metadata: { origin_book: book, is2D: true, map_shape: [2, 2], origin_matrix: { rows: 2, cols: 2 } },
  },
});

// A long-form XYZ worksheet: X column A, channels B (grid Y) and C (Z).
const xyz = (letters: string[] = ["B", "C"]): Dataset => ({
  id: "w-XYZ",
  name: "XYZ",
  data: {
    time: [0, 1, 0, 1],
    values: [[0, 5], [0, 6], [1, 7], [1, 8]],
    labels: letters,
    units: ["", ""],
    metadata: { origin_book: "XYZ", x_column_name: "A", origin_column_names: letters },
  },
});

describe("figureMapState", () => {
  it("opens a matrix heatmap / contour in the Map tab", () => {
    const ds = matrix("MBook1");
    expect(figureMapState(figure({ map: { book: "MBook1", kind: "heatmap" } }), ds)).toEqual({
      stageTab: "map",
      contourOn: false,
    });
    expect(figureMapState(figure({ map: { book: "MBook1", kind: "contour" } }), ds)).toEqual({
      stageTab: "map",
      contourOn: true,
    });
  });

  it("leaves another book, a worksheet for a matrix map, or no map alone", () => {
    expect(figureMapState(figure({ map: { book: "MBook2", kind: "heatmap" } }), matrix("MBook1"))).toEqual({});
    expect(figureMapState(figure({ map: { book: "XYZ", kind: "heatmap" } }), xyz())).toEqual({});
    expect(figureMapState(figure(), matrix("MBook1"))).toEqual({});
    expect(figureMapState(figure({ map: { book: "MBook1", kind: "heatmap" } }), undefined)).toEqual({});
  });

  it("opens an XYZ contour only when the Map tab's default picks are Origin's columns", () => {
    const map = { book: "XYZ", kind: "contour" as const, x: "A", y: "B", z: "C" };
    expect(figureMapState(figure({ map }), xyz())).toEqual({ stageTab: "map", contourOn: true });
    // Origin plots Z = B against Y = C: the default picks (Y = B, Z = C) would map the wrong columns
    expect(figureMapState(figure({ map: { ...map, y: "C", z: "B" } }), xyz())).toEqual({});
  });
});

describe("queueFigureTernary", () => {
  it("queues Origin's A, B, C order (X column = -1), consumed once", () => {
    const ds = xyz();
    expect(queueFigureTernary(figure({ ternary: { book: "XYZ", a: "A", b: "B", c: "C" } }), ds)).toBe(true);
    expect(takeTernaryPicks("other")).toBeNull();
    expect(takeTernaryPicks(ds.id)).toEqual({ datasetId: ds.id, a: -1, b: 0, c: 1 });
    expect(takeTernaryPicks(ds.id)).toBeNull();
  });

  it("refuses a column the dataset does not hold", () => {
    expect(queueFigureTernary(figure({ ternary: { book: "XYZ", a: "A", b: "B", c: "D" } }), xyz())).toBe(false);
    expect(takeTernaryPicks("w-XYZ")).toBeNull();
  });
});

describe("resolveFigureDataset", () => {
  it("resolves a map figure to its matrix book by name", () => {
    const fig = figure({ map: { book: "MBook2", kind: "heatmap" } });
    expect(resolveFigureDataset(fig, [matrix("MBook1"), matrix("MBook2")])).toBe("m-MBook2");
  });
});
