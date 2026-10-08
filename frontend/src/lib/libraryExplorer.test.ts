import { describe, expect, it } from "vitest";

import { filterLibraryHierarchy, libraryContainerIds, libraryNodeCount } from "./libraryExplorer";
import { createFigureDocument } from "./figureDocument";
import { buildLibraryHierarchy } from "./libraryHierarchy";
import { defaultPlotView } from "./plotview";

const hierarchy = buildLibraryHierarchy({
  folders: [
    { id: "a", name: "A", parentId: null, order: 0 },
    { id: "b", name: "B", parentId: null, order: 1 },
  ],
  workbooks: [
    { id: "wa", name: "Data book", folderId: "a" },
    { id: "wb", name: "Report book", folderId: "b" },
  ],
  datasets: [
    { id: "sheet", name: "Sheet", workbookId: "wa", data: { time: [], values: [], labels: [], units: [], metadata: {} } },
    { id: "source", name: "Source", workbookId: "wb", data: { time: [], values: [], labels: [], units: [], metadata: {} } },
  ],
  editableFigures: [createFigureDocument({
    id: "figure", name: "Figure", datasetId: "sheet", view: defaultPlotView(),
  })],
  reports: [{
    id: "report", name: "Report", datasetId: "source",
    report: { title: "Report", sections: [] },
  }],
});

describe("Library explorer hierarchy filters", () => {
  it("keeps matching content with its folder/workbook path and removes unrelated branches", () => {
    const figures = filterLibraryHierarchy(hierarchy, "figures");
    expect([...figures.byKey.keys()]).toEqual(expect.arrayContaining(["folder:a", "workbook:wa", "editable-figure:figure"]));
    expect(figures.byKey.has("worksheet:sheet")).toBe(false);
    expect(figures.byKey.has("folder:b")).toBe(false);
    expect(figures.byKey.get("editable-figure:figure")?.depth).toBe(2);
  });

  it("supports data and report projections without changing the source hierarchy", () => {
    const data = filterLibraryHierarchy(hierarchy, "data");
    const reports = filterLibraryHierarchy(hierarchy, "reports");
    expect(data.byKey.has("worksheet:sheet")).toBe(true);
    expect(data.byKey.has("worksheet:source")).toBe(true);
    expect(reports.roots.map((node) => node.key)).toEqual(["folder:b"]);
    expect(reports.byKey.has("report:report")).toBe(true);
    expect(hierarchy.byKey.has("editable-figure:figure")).toBe(true);
  });

  it("lists an analysis result under Data with its linked worksheets, not under Reports", () => {
    // PR #554 review: a result is a linked analysis of worksheet data, not a report.
    const withResult = buildLibraryHierarchy({
      folders: [], workbooks: [{ id: "wa", name: "Data book" }],
      datasets: [{ id: "sheet", name: "Sheet", workbookId: "wa", data: { time: [], values: [], labels: [], units: [], metadata: {} } }],
      analysisResults: [{
        version: 1, id: "res", name: "Smooth", producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
        sources: [{ datasetId: "sheet", role: "input" }], outputs: [], warnings: [], createdAt: "2026-10-08T00:00:00Z",
      }],
    });
    expect(filterLibraryHierarchy(withResult, "data").byKey.has("analysis-result:res")).toBe(true);
    expect(filterLibraryHierarchy(withResult, "reports").byKey.has("analysis-result:res")).toBe(false);
  });

  it("returns the original model for All and indexes visible containers", () => {
    expect(filterLibraryHierarchy(hierarchy, "all")).toBe(hierarchy);
    expect(libraryNodeCount(hierarchy)).toBe(hierarchy.byKey.size);
    const containers = libraryContainerIds(filterLibraryHierarchy(hierarchy, "reports"));
    expect([...containers.folders]).toEqual(["b"]);
    expect([...containers.workbooks]).toEqual(["wb"]);
  });
});
