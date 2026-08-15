import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import {
  buildLibraryHierarchy,
  flattenLibraryHierarchy,
  type LibraryNode,
  type LibraryNodeKey,
} from "./libraryHierarchy";
import type { OriginFigureEntry } from "./originFigures";
import { createPageDocument } from "./pageDocument";
import { defaultPlotView } from "./plotview";
import type { Dataset, FolderNode, OriginFigure } from "./types";
import type { WorkbookNode } from "./workbooks";

function dataset(id: string, workbookId?: string, order?: number, originBook?: string): Dataset {
  return {
    id,
    name: `sheet ${id}`,
    data: {
      time: [0], values: [[1]], labels: ["signal"], units: ["V"],
      metadata: originBook ? { origin_book: originBook } : {},
    },
    workbookId,
    order,
  };
}

function folder(id: string, parentId: string | null, order = 0): FolderNode {
  return { id, name: `folder ${id}`, parentId, order };
}

function workbook(id: string, folderId?: string, order?: number): WorkbookNode {
  return { id, name: `workbook ${id}`, folderId, order };
}

function originFigure(
  id: string,
  datasetId: string | null,
  siblingIds: string[],
  books: string[] = [],
): OriginFigureEntry {
  const figure: OriginFigure = {
    name: id, x_from: 0, x_to: 1, x_log: false,
    y_from: 0, y_to: 1, y_log: false, n_curves: books.length,
    annotations: [],
    curves: books.map((book) => ({ book, x: "A", y: "B" })),
  };
  return { id, stem: "one-import", figure, datasetId, siblingIds };
}

function child(parent: LibraryNode, key: LibraryNodeKey): LibraryNode {
  const found = parent.children.find((node) => node.key === key);
  if (!found) throw new Error(`missing child ${key}`);
  return found;
}

describe("buildLibraryHierarchy", () => {
  it("builds folder > workbook > worksheet with canonical keys and depths", () => {
    const result = buildLibraryHierarchy({
      folders: [folder("f", null)],
      workbooks: [workbook("w", "f")],
      datasets: [dataset("d", "w")],
    });

    expect(result.roots.map((node) => node.key)).toEqual(["folder:f"]);
    const folderNode = result.roots[0];
    const workbookNode = child(folderNode, "workbook:w");
    const worksheetNode = child(workbookNode, "worksheet:d");
    expect([folderNode.depth, workbookNode.depth, worksheetNode.depth]).toEqual([0, 1, 2]);
    expect(worksheetNode.source.datasetIds).toEqual(["d"]);
    expect(result.byKey.get("worksheet:d")).toBe(worksheetNode);
  });

  it("uses stable section/order rules without mutating the input arrays", () => {
    const folders = [folder("late", null, 20), folder("early", null, 10)];
    const workbooks = [workbook("late", undefined, 20), workbook("early", undefined, 10)];
    const datasets = [dataset("late", "early", 20), dataset("early", "early", 10)];
    const originalFolders = [...folders];
    const originalWorkbooks = [...workbooks];
    const originalDatasets = [...datasets];
    const editable = createFigureDocument({
      id: "fig", name: "figure", datasetId: "early", view: defaultPlotView(),
    });

    const result = buildLibraryHierarchy({ folders, workbooks, datasets, editableFigures: [editable] });
    expect(result.roots.map((node) => node.key)).toEqual([
      "folder:early", "folder:late", "workbook:early", "workbook:late",
    ]);
    expect(result.byKey.get("workbook:early")?.children.map((node) => node.key)).toEqual([
      "worksheet:early", "worksheet:late", "editable-figure:fig",
    ]);
    expect(folders).toEqual(originalFolders);
    expect(workbooks).toEqual(originalWorkbooks);
    expect(datasets).toEqual(originalDatasets);
  });

  it("places a cross-workbook page at the nearest shared folder", () => {
    const folders = [folder("shared", null), folder("left", "shared"), folder("right", "shared")];
    const workbooks = [workbook("a", "left"), workbook("b", "right")];
    const datasets = [dataset("a", "a"), dataset("b", "b")];
    const figures = [
      createFigureDocument({ id: "fa", name: "A", datasetId: "a", view: defaultPlotView() }),
      createFigureDocument({ id: "fb", name: "B", datasetId: "b", view: defaultPlotView() }),
    ];
    const page = createPageDocument({
      id: "page", name: "comparison", rows: 1, cols: 2,
      panels: [
        { figureId: "fa", label: null, title: null },
        { figureId: "fb", label: null, title: null },
      ],
    });

    const result = buildLibraryHierarchy({ folders, workbooks, datasets, editableFigures: figures, pages: [page] });
    expect(result.byKey.get("page:page")?.parentKey).toBe("folder:shared");
    expect(result.byKey.get("page:page")?.source.datasetIds).toEqual(["a", "b"]);
  });

  it("places a cross-root-workbook artifact at root", () => {
    const workbooks = [workbook("a", "left"), workbook("b", "right")];
    const datasets = [dataset("a", "a"), dataset("b", "b")];
    const figures = [
      createFigureDocument({ id: "fa", name: "A", datasetId: "a", view: defaultPlotView() }),
      createFigureDocument({ id: "fb", name: "B", datasetId: "b", view: defaultPlotView() }),
    ];
    const page = createPageDocument({
      id: "page", name: "comparison", rows: 1, cols: 2,
      panels: [
        { figureId: "fa", label: null, title: null },
        { figureId: "fb", label: null, title: null },
      ],
    });
    const result = buildLibraryHierarchy({ folders: [], workbooks, datasets, editableFigures: figures, pages: [page] });
    expect(result.byKey.get("page:page")?.parentKey).toBeNull();
  });

  it("resolves only the Origin books actually used by a graph", () => {
    const workbooks = [workbook("wa"), workbook("wb"), workbook("unused")];
    const datasets = [
      dataset("a", "wa", undefined, "Book1"),
      dataset("b", "wb", undefined, "Book2"),
      dataset("c", "unused", undefined, "Book3"),
    ];
    const figure = originFigure("graph", "a", ["a", "b", "c"], ["Book1", "Book2"]);
    const result = buildLibraryHierarchy({ folders: [], workbooks, datasets, originFigures: [figure] });
    const node = result.byKey.get("origin-figure:graph")!;
    expect(node.source.datasetIds).toEqual(["a", "b"]);
    expect(node.source.datasetIds).not.toContain("c");
    expect(node.parentKey).toBeNull();
  });

  it("uses an import sibling for unresolved Origin placement without claiming it as a source", () => {
    const figure = originFigure("unresolved", null, ["d"]);
    const result = buildLibraryHierarchy({
      folders: [], workbooks: [workbook("w")], datasets: [dataset("d", "w")], originFigures: [figure],
    });
    const node = result.byKey.get("origin-figure:unresolved")!;
    expect(node.parentKey).toBe("workbook:w");
    expect(node.source).toEqual({
      datasetIds: [], missingDatasetIds: [], usedPlacementFallback: true,
    });
  });

  it("degrades dangling references to root and reports them", () => {
    const editable = createFigureDocument({
      id: "fig", name: "missing source", datasetId: "gone", view: defaultPlotView(),
    });
    const result = buildLibraryHierarchy({
      folders: [], workbooks: [], datasets: [dataset("d", "missing-workbook")], editableFigures: [editable],
    });
    expect(result.byKey.get("worksheet:d")?.parentKey).toBeNull();
    expect(result.byKey.get("editable-figure:fig")?.source.missingDatasetIds).toEqual(["gone"]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("missing-workbook"),
    ]));
  });

  it("breaks corrupt folder cycles instead of losing the cyclic subtree", () => {
    const result = buildLibraryHierarchy({
      folders: [folder("a", "b"), folder("b", "a")], workbooks: [], datasets: [],
    });
    expect(result.roots.map((node) => node.key)).toEqual(["folder:a", "folder:b"]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("cyclic parent chain"),
    ]));
  });

  it("keeps identical ids in different entity kinds distinct", () => {
    const editable = createFigureDocument({
      id: "same", name: "same", datasetId: "same", view: defaultPlotView(),
    });
    const result = buildLibraryHierarchy({
      folders: [], workbooks: [workbook("same")], datasets: [dataset("same", "same")], editableFigures: [editable],
    });
    expect([...result.byKey.keys()]).toEqual(expect.arrayContaining([
      "workbook:same", "worksheet:same", "editable-figure:same",
    ]));
    expect(result.byKey.size).toBe(3);
  });
});

describe("flattenLibraryHierarchy", () => {
  it("emits only expanded subtrees in deterministic display order", () => {
    const hierarchy = buildLibraryHierarchy({
      folders: [folder("f", null)], workbooks: [workbook("w", "f")], datasets: [dataset("d", "w")],
    });
    expect(flattenLibraryHierarchy(hierarchy, new Set()).map((row) => row.node.key)).toEqual(["folder:f"]);
    expect(flattenLibraryHierarchy(hierarchy, new Set<LibraryNodeKey>(["folder:f"]))
      .map((row) => row.node.key)).toEqual(["folder:f", "workbook:w"]);
    expect(flattenLibraryHierarchy(hierarchy, new Set<LibraryNodeKey>(["folder:f", "workbook:w"]))
      .map((row) => row.node.key)).toEqual(["folder:f", "workbook:w", "worksheet:d"]);
  });
});
