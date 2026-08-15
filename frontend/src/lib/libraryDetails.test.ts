import { describe, expect, it } from "vitest";

import { libraryDetailsRows, sortLibraryDetailsRows } from "./libraryDetails";
import { buildLibraryHierarchy } from "./libraryHierarchy";
import type { Dataset } from "./types";

function dataset(id: string, name: string, workbookId: string, order: number): Dataset {
  return {
    id,
    name,
    workbookId,
    order,
    importedAt: "2026-08-01T00:00:00.000Z",
    source: { kind: "path", path: `C:/data/${name}` },
    tags: [id, "measurement"],
    data: {
      time: [0, 1, 2],
      values: [[1, 2], [3, 4], [5, 6]],
      labels: ["x", "signal"],
      units: ["s", "V"],
      metadata: { technique: "VSM" },
    },
  };
}

describe("Library Details projection", () => {
  it("uses every canonical hierarchy node and exposes comparison metadata", () => {
    const hierarchy = buildLibraryHierarchy({
      folders: [{ id: "f", name: "Measurements", parentId: null, order: 0 }],
      workbooks: [{ id: "w", name: "Run 1", folderId: "f", order: 0 }],
      datasets: [dataset("b", "beta.csv", "w", 0)],
    });

    const rows = libraryDetailsRows(hierarchy);
    expect(rows.map((row) => row.node.key)).toEqual(["folder:f", "workbook:w", "worksheet:b"]);
    expect(rows[2]).toMatchObject({
      type: "Worksheet",
      location: "Measurements / Run 1",
      dimensions: "3 × 2",
      dataType: "VSM",
      source: "Linked file",
      tags: "b, measurement",
    });
  });

  it("sorts a copy and restores the untouched canonical manual order", () => {
    const hierarchy = buildLibraryHierarchy({
      folders: [],
      workbooks: [{ id: "w", name: "Run", order: 0 }],
      datasets: [dataset("b", "beta.csv", "w", 0), dataset("a", "alpha.csv", "w", 1)],
    });
    const manual = libraryDetailsRows(hierarchy);
    const byName = sortLibraryDetailsRows(manual, "name", "asc");
    expect(byName.map((row) => row.node.name)).toEqual(["alpha.csv", "beta.csv", "Run"]);
    expect(manual.map((row) => row.node.key)).toEqual(["workbook:w", "worksheet:b", "worksheet:a"]);
    expect(sortLibraryDetailsRows(manual, "manual", "asc").map((row) => row.node.key)).toEqual([
      "workbook:w", "worksheet:b", "worksheet:a",
    ]);
  });
});
