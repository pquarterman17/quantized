import { describe, expect, it } from "vitest";

import { buildLibraryHierarchy } from "./libraryHierarchy";
import type { LibraryNode } from "./libraryHierarchy";
import { workbookProperties } from "./workbookProperties";

describe("workbookProperties", () => {
  it("uses the canonical workbook children and recorded fields without inventing provenance", () => {
    const folders = [
      { id: "parent", name: "Measurements", parentId: null, order: 0 },
      { id: "child", name: "September", parentId: "parent", order: 0 },
    ];
    const hierarchy = buildLibraryHierarchy({
      folders,
      workbooks: [{
        id: "wb", name: "Book 1", folderId: "child", originBook: "Book1",
        importedAt: "2026-09-20T12:00:00.000Z", source: { kind: "path", path: "C:/source.opju" },
      }],
      datasets: [
        { id: "loaded", name: "Sheet 1", workbookId: "wb", tags: ["sample", "urgent"], data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } },
        { id: "lazy", name: "Sheet 2", workbookId: "wb", tags: ["urgent", "review"], pending: { kind: "path", path: "C:/source.opju", bookId: "Book1@2", rows: 4, cols: 2 }, data: { time: [], values: [], labels: ["A", "B"], units: ["", ""], metadata: {} } },
      ],
      editableFigures: [{ id: "figure", name: "Fit", bindings: { datasetId: "loaded" }, plot: { mark: "line" }, data: { mode: "live" } } as never],
    });
    const node = hierarchy.byKey.get("workbook:wb")! as Extract<LibraryNode, { kind: "workbook" }>;

    expect(workbookProperties(node, folders)).toMatchObject({
      name: "Book 1",
      location: "Project / Measurements / September",
      source: "Linked source",
      sourcePath: "C:/source.opju",
      originBook: "Book1",
      availability: "1 loaded; 1 available on demand",
      worksheetCount: 2,
      artifactCount: 1,
      tags: ["sample", "urgent", "review"],
      importedAt: "2026-09-20T12:00:00.000Z",
    });
  });

  it("states missing workbook provenance honestly instead of filling it from a guess", () => {
    const hierarchy = buildLibraryHierarchy({ folders: [], workbooks: [{ id: "wb", name: "Empty" }], datasets: [] });
    const node = hierarchy.byKey.get("workbook:wb")! as Extract<LibraryNode, { kind: "workbook" }>;
    expect(workbookProperties(node, [])).toMatchObject({
      location: "Project", source: "No workbook source path recorded", sourcePath: null,
      originBook: null, availability: "No member worksheets", tags: [], importedAt: null,
    });
  });
});
