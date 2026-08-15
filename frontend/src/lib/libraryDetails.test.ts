import { describe, expect, it } from "vitest";

import { detailsNavIndex, libraryDetailsRows, sortLibraryDetailsRows } from "./libraryDetails";
import { buildLibraryHierarchy } from "./libraryHierarchy";
import type { OriginFigureEntry } from "./originFigures";
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

  it("labels an Origin figure with no resolved dataset instead of implying it can open", () => {
    const unresolved: OriginFigureEntry = {
      id: "g",
      stem: "project",
      datasetId: null,
      siblingIds: ["b"],
      figure: {
        name: "Graph",
        x_from: 0,
        x_to: 1,
        x_log: false,
        y_from: 0,
        y_to: 1,
        y_log: false,
        n_curves: 1,
        annotations: [],
        source_hint: "MissingBook",
      },
    };
    const hierarchy = buildLibraryHierarchy({
      folders: [],
      workbooks: [{ id: "w", name: "Run" }],
      datasets: [dataset("b", "beta.csv", "w", 0)],
      originFigures: [unresolved],
    });
    const row = libraryDetailsRows(hierarchy).find((item) => item.node.kind === "origin-figure");
    expect(row?.source).toBe("Unresolved");
  });
});

describe("detailsNavIndex — flat roving arithmetic (follow-up 4a)", () => {
  it("steps, clamps at both boundaries, and jumps Home/End", () => {
    expect(detailsNavIndex(3, 0, "ArrowDown")).toBe(1);
    expect(detailsNavIndex(3, 2, "ArrowDown")).toBe(2); // clamp, no wrap
    expect(detailsNavIndex(3, 1, "ArrowUp")).toBe(0);
    expect(detailsNavIndex(3, 0, "ArrowUp")).toBe(0); // clamp, no wrap
    expect(detailsNavIndex(3, 2, "Home")).toBe(0);
    expect(detailsNavIndex(3, 0, "End")).toBe(2);
  });

  it("an unknown starting index lands on the first row going down", () => {
    expect(detailsNavIndex(3, -1, "ArrowDown")).toBe(0);
  });

  it("returns null for non-navigation keys and an empty table — including Left/Right (no disclosure semantics in a flat sort)", () => {
    expect(detailsNavIndex(3, 1, "ArrowLeft")).toBeNull();
    expect(detailsNavIndex(3, 1, "ArrowRight")).toBeNull();
    expect(detailsNavIndex(3, 1, "a")).toBeNull();
    expect(detailsNavIndex(0, 0, "ArrowDown")).toBeNull();
  });
});
