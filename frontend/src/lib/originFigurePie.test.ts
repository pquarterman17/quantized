// Origin pie / doughnut figures -> the pie workshop (lib/originFigureMap.ts
// queueFigurePie, lib/piePending; backend io/origin_project/opju_pie.py), and
// the workshop's request builder (components/workshops/pie/pieRequest.ts).
import { describe, expect, it } from "vitest";

import { buildPieRequest, droppedPieRows } from "../components/workshops/pie/pieRequest";
import { queueFigurePie } from "./originFigureMap";
import { takePie } from "./piePending";
import type { Dataset, DataStruct, OriginFigure } from "./types";

const figure = (pie: OriginFigure["pie"]): OriginFigure => ({
  name: "Graph3",
  x_from: 0,
  x_to: 1,
  x_log: false,
  y_from: 0,
  y_to: 1,
  y_log: false,
  n_curves: 1,
  annotations: [],
  pie,
});

// A text-X book as the importer builds it: X = A (categories), channels B, C.
const book: DataStruct = {
  time: [1, 2, 3],
  values: [[69, 1], [45, 2], [18, 3]],
  labels: ["B", "C"],
  units: ["", ""],
  metadata: {
    origin_book: "soildeep",
    origin_column_names: ["B", "C"],
    x_column_name: "",
    x_category_labels: ["0-10 cm", "10-30 cm", ">30 cm"],
  },
};
const ds: Dataset = { id: "w-soil", name: "soildeep", data: book };

describe("queueFigurePie", () => {
  it("queues labels from the X column and one ring per Y, consumed once", () => {
    expect(queueFigurePie(figure({ book: "soildeep", x: "A", y: ["B", "C"], hole: 0.4 }), ds)).toBe(true);
    expect(takePie("other")).toBeNull();
    expect(takePie(ds.id)).toEqual({ datasetId: ds.id, labels: -1, values: [0, 1], hole: 0.4 });
    expect(takePie(ds.id)).toBeNull();
  });

  it("refuses another book, a missing column, or a Y on the X column (fails closed)", () => {
    expect(queueFigurePie(figure({ book: "Book9", x: "A", y: ["B"], hole: 0 }), ds)).toBe(false);
    expect(queueFigurePie(figure({ book: "soildeep", x: "A", y: ["D"], hole: 0 }), ds)).toBe(false);
    expect(queueFigurePie(figure({ book: "soildeep", x: "A", y: ["A"], hole: 0 }), ds)).toBe(false);
    expect(queueFigurePie(figure(undefined), ds)).toBe(false);
    expect(takePie(ds.id)).toBeNull();
  });
});

describe("buildPieRequest", () => {
  const opts = { title: "t", filename: "f", colors: ["#111111"] };

  it("takes the X categories as labels and one ring per value column", () => {
    const b = buildPieRequest(book, { labels: -1, values: [0], hole: 0 }, opts);
    expect(b.spec).toEqual({
      rings: [[69, 45, 18]],
      labels: ["0-10 cm", "10-30 cm", ">30 cm"],
      hole: 0,
      colors: ["#111111"],
      title: "t",
      filename: "f",
    });
    expect(b.dropped).toBe(0);
  });

  it("drops a category any ring cannot draw from every ring, and says so", () => {
    const bad: DataStruct = { ...book, values: [[69, 1], [-1, 2], [18, NaN]] };
    const b = buildPieRequest(bad, { labels: -1, values: [0, 1], hole: 0.4 }, opts);
    expect(b.spec?.rings).toEqual([[69], [1]]);
    expect(b.spec?.labels).toEqual(["0-10 cm"]);
    expect(droppedPieRows(b.dropped, b.total)).toBe(
      "2 of 3 rows have a non-finite or negative value and were left out.",
    );
  });

  it("gives several rings a hole (a multi-ring chart is a doughnut) and refuses an all-zero ring", () => {
    expect(buildPieRequest(book, { labels: -1, values: [0, 1], hole: 0 }, opts).spec?.hole).toBe(0.2);
    const zero: DataStruct = { ...book, values: [[0, 1], [0, 2], [0, 3]] };
    expect(buildPieRequest(zero, { labels: -1, values: [0], hole: 0 }, opts).spec).toBeNull();
  });
});
