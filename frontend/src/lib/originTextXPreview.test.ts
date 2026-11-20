// A recorded text (category) X that is not the book's own X: the Library
// thumbnail draws the curves the apply draws (positions 1..N), not an empty
// box; and a cross-book layer only gets category positions when every curve
// sits on a text X with the same cells (otherwise the text curves are left
// out, as `textXLetter`'s one-book mixed control already does).

import { describe, expect, it } from "vitest";

import { buildOverlayDataset } from "./originOverlayFigure";
import { generateFigureThumbnail } from "./thumbnailArtifacts";
import { resolveThumbnailRequest } from "./thumbnailRequest";
import type { Dataset, OriginFigure } from "./types";

const decode = (url: string): string => decodeURIComponent(url.replace("data:image/svg+xml,", ""));

const book = (id: string, name: string, months: string[], numericX = false): Dataset => ({
  id, name, workbookId: null,
  data: {
    time: [1947, 1948, 1949, 1950],
    values: [[10, 1], [20, 2], [30, 3], [40, 4]],
    labels: ["Precip", "Flow"], units: ["mm", "mm"],
    metadata: {
      origin_book: name, x_column_name: "D", origin_column_names: ["B", "C"],
      column_designations: { A: "X", B: "Y", C: "Y", D: "X" },
      ...(numericX ? {} : { origin_text_columns: { A: months } }),
    },
  },
}) as unknown as Dataset;

const figure = (curves: { book: string; x: string; y: string }[]): OriginFigure => ({
  name: "Graph1", x_from: 0.5, x_to: 4.5, x_log: false, y_from: 0, y_to: 50, y_log: false,
  n_curves: curves.length, annotations: [], curves: curves.map((c) => ({ ...c, xRecorded: true })),
}) as unknown as OriginFigure;

const MONTHS = ["Jan", "Feb", "Mar", "Apr"];

describe("recorded text X: thumbnail and cross-book consistency", () => {
  it("the thumbnail draws the text-X curve instead of an empty preview", async () => {
    const ds = book("d1", "Book1", MONTHS);
    const entity = { id: "of1", datasetId: "d1", stem: "C", figure: figure([{ book: "Book1", x: "A", y: "B" }]) };
    const node = {
      key: "origin-figure:of1", entityId: "of1", kind: "origin-figure", name: "Graph1",
      parentKey: null, depth: 0, children: [], entity,
      source: { datasetIds: ["d1"], missingDatasetIds: [], usedPlacementFallback: false },
    } as never;
    const request = resolveThumbnailRequest(node, { datasets: [ds], editableFigures: [] });
    const svg = decode((await generateFigureThumbnail(request, new AbortController().signal)).url);
    expect(svg.match(/<polyline/g)).toHaveLength(1);
  });

  it("two books on text X columns with the same cells share the category axis", () => {
    const fig = figure([{ book: "Book1", x: "A", y: "B" }, { book: "Book2", x: "A", y: "B" }]);
    const out = buildOverlayDataset(fig, [book("d1", "Book1", MONTHS), book("d2", "Book2", MONTHS)], undefined, true);
    expect(out?.metadata?.x_category_labels).toEqual(MONTHS);
    expect(out?.labels).toHaveLength(2);
  });

  it("control: differing cells under one letter, or a numeric-X book beside a text-X one, leave the text curves out", () => {
    const differ = buildOverlayDataset(
      figure([{ book: "Book1", x: "A", y: "B" }, { book: "Book2", x: "A", y: "B" }]),
      [book("d1", "Book1", MONTHS), book("d2", "Book2", ["Q1", "Q2", "Q3", "Q4"])], undefined, true,
    );
    expect(differ?.metadata?.x_category_labels).toBeUndefined();
    expect(differ?.labels ?? []).toHaveLength(0);
    const mixed = buildOverlayDataset(
      figure([{ book: "Book1", x: "A", y: "B" }, { book: "Book2", x: "D", y: "C" }]),
      [book("d1", "Book1", MONTHS), book("d2", "Book2", MONTHS, true)], undefined, true,
    );
    expect(mixed?.metadata?.x_category_labels).toBeUndefined();
    expect(mixed?.labels).toEqual(["Book2: Flow"]);
  });
});
