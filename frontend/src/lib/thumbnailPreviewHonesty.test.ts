// PR #150 review probes: the preview must draw what the FIGURE actually
// plots, from the datasets the store actually holds.

import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { createPageDocument } from "./pageDocument";
import { buildLibraryHierarchy } from "./libraryHierarchy";
import { defaultPlotView } from "./plotview";
import { generateFigureThumbnail } from "./thumbnailArtifacts";
import { generatePageThumbnail } from "./thumbnailPage";
import { resolveThumbnailRequest } from "./thumbnailRequest";
import type { Dataset } from "./types";

const decode = (url: string): string => decodeURIComponent(url.replace("data:image/svg+xml,", ""));

// A NORMALLY-LOADED dataset: `pending` is an optional field a regular
// dataset simply does not carry — exactly like the store after any
// non-lazy import.
const dataset = {
  id: "d1", name: "Sweep", workbookId: null,
  data: {
    time: [0, 1, 2], values: [[0, 2, 7], [1, 5, 7], [2, 3, 7]],
    labels: ["x", "signal", "flat"], units: ["s", "V", "V"], metadata: {},
  },
} as unknown as Dataset;

describe("PR #150 review — preview honesty probes", () => {
  it("a page panel referencing a LIVE figure draws the figure's plot, not a gray box (regular dataset without `pending`)", async () => {
    const figure = createFigureDocument({
      id: "f1", name: "Sweep plot", datasetId: "d1",
      view: { ...defaultPlotView(), xKey: 0, yKeys: [1] },
    });
    const base = createPageDocument({ id: "p1", name: "Summary", rows: 1, cols: 1 });
    const page = { ...base, panels: base.panels.map((panel, i) => (i === 0 ? { ...panel, figureId: "f1" } : panel)) };
    const hierarchy = buildLibraryHierarchy({
      folders: [], workbooks: [], datasets: [dataset], editableFigures: [figure], pages: [page],
    });
    const node = hierarchy.byKey.get("page:p1")!;
    const request = resolveThumbnailRequest(node, { datasets: [dataset], editableFigures: [figure] });

    const svg = decode((await generatePageThumbnail(request, new AbortController().signal)).url);
    expect(svg).toContain("<polyline"); // the live figure's actual data
    expect(svg).not.toContain('fill-opacity="0.55"'); // NOT the referenced-but-dataless gray box
  });

  it("a multi-layer Origin figure's preview binds ITS OWN book's dataset, not the family's first", async () => {
    const book1 = {
      id: "ob1", name: "Book1", workbookId: null,
      data: {
        time: [0, 1, 2], values: [[0, 9, 4], [1, 8, 6], [2, 7, 5]], labels: ["A", "B", "C"], units: ["", "", ""],
        metadata: { origin_book: "Book1", origin_column_names: ["A", "B", "C"], x_column_name: "A" },
      },
    } as unknown as Dataset;
    const book2 = {
      id: "ob2", name: "Book2", workbookId: null,
      data: {
        time: [0, 1, 2], values: [[0, 1, 2], [1, 2, 1], [2, 1, 3]], labels: ["A", "B", "C"], units: ["", "", ""],
        metadata: { origin_book: "Book2", origin_column_names: ["A", "B", "C"], x_column_name: "A" },
      },
    } as unknown as Dataset;
    // The layer-2 node: its OWN book is Book2, but originSourceIds lists the
    // whole layer family's datasets layer-ascending — Book1 first.
    const entity = {
      id: "of2", datasetId: "ob2", stem: "proj",
      figure: { n_curves: 1, curves: [{ book: "Book2", x: "A", y: "B" }] },
    };
    const node = {
      key: "origin-figure:of2", entityId: "of2", kind: "origin-figure", name: "Graph4 · layer 2",
      parentKey: null, depth: 0, children: [], entity,
      source: { datasetIds: ["ob1", "ob2"], missingDatasetIds: [], usedPlacementFallback: false },
    } as never;
    const request = resolveThumbnailRequest(node, { datasets: [book1, book2], editableFigures: [] });

    const svg = decode((await generateFigureThumbnail(request, new AbortController().signal)).url);
    // Book2's single bound curve — the first-dep fallback would draw Book1's
    // three default columns instead.
    expect(svg.match(/<polyline/g)).toHaveLength(1);
  });

  it("an Origin figure's preview plots the figure's DECODED CURVES via figureChannelSelection, not the first columns", async () => {
    const originDataset = {
      id: "ob1", name: "Book1", workbookId: null,
      data: {
        time: [0, 1, 2],
        values: [[0, 9, 4], [1, 8, 6], [2, 7, 5]],
        labels: ["A", "B", "C"],
        units: ["", "", ""],
        metadata: { origin_book: "Book1", origin_column_names: ["A", "B", "C"], x_column_name: "A" },
      },
    } as unknown as Dataset;
    const entity = {
      id: "of1", datasetId: "ob1", stem: "proj",
      figure: { n_curves: 1, curves: [{ book: "Book1", x: "A", y: "C" }] },
    };
    const node = {
      key: "origin-figure:of1", entityId: "of1", kind: "origin-figure", name: "Graph1",
      parentKey: null, depth: 0, children: [], entity,
      source: { datasetIds: ["ob1"], missingDatasetIds: [], usedPlacementFallback: false },
    } as never;
    const request = resolveThumbnailRequest(node, { datasets: [originDataset], editableFigures: [] });

    const svg = decode((await generateFigureThumbnail(request, new AbortController().signal)).url);
    // The figure plots exactly ONE curve (column C against A). The
    // first-columns fallback would draw three series.
    expect(svg.match(/<polyline/g)).toHaveLength(1);
  });
});
