import { beforeEach, describe, expect, it } from "vitest";

import { buildLibraryHierarchy, type LibraryNodeKey } from "./libraryHierarchy";
import { expandLibraryAncestors } from "./libraryReveal";
import type { OriginFigureEntry } from "./originFigures";
import { useApp } from "../store/useApp";

const figure = (id: string): OriginFigureEntry => ({
  id, stem: "Proj", datasetId: null, siblingIds: ["d1"],
  figure: { name: id, x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 0, annotations: [] },
});

describe("expandLibraryAncestors", () => {
  beforeEach(() => useApp.setState({ expandedFolders: [], expandedWorkbookIds: [], expandedOriginGroupIds: [] }));

  const hierarchy = buildLibraryHierarchy({
    folders: [{ id: "f", name: "F", parentId: null, order: 0 }],
    workbooks: [{ id: "w1", name: "W1", folderId: "f" }, { id: "w2", name: "W2", folderId: "f" }],
    datasets: [
      { id: "d1", name: "a", workbookId: "w1", data: { time: [0], values: [[1]], labels: ["s"], units: [""], metadata: {} } },
      { id: "d2", name: "b", workbookId: "w2", data: { time: [0], values: [[1]], labels: ["s"], units: [""], metadata: {} } },
    ],
    originFigures: [{ ...figure("u1"), siblingIds: ["d1", "d2"] }, { ...figure("u2"), siblingIds: ["d1", "d2"] }],
  });

  it("opens the folder and the derived group above a grouped figure, once", () => {
    expandLibraryAncestors(hierarchy, "origin-figure:u2" as LibraryNodeKey);
    expandLibraryAncestors(hierarchy, "origin-figure:u2" as LibraryNodeKey); // idempotent: never collapses
    const s = useApp.getState();
    expect(s.expandedFolders).toEqual(["f"]);
    expect(s.expandedOriginGroupIds).toEqual(["unresolved-d1"]);
    expect(s.expandedWorkbookIds).toEqual([]);
  });

  it("opens a workbook above a worksheet and ignores an unknown key", () => {
    expandLibraryAncestors(hierarchy, "worksheet:d1" as LibraryNodeKey);
    expandLibraryAncestors(hierarchy, "worksheet:nope" as LibraryNodeKey);
    expect(useApp.getState().expandedWorkbookIds).toEqual(["w1"]);
    expect(useApp.getState().expandedFolders).toEqual(["f"]);
  });
});
