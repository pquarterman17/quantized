import { describe, expect, it } from "vitest";

import {
  BATCH_ALL_WORKBOOKS,
  BATCH_LOOSE_WORKSHEETS,
  batchFolderLabels,
  filterBatchDatasets,
  setShownBatchSelection,
  validBatchWorkbookScope,
} from "./batchFigureSelection";
import type { Dataset, FolderNode } from "./types";
import type { WorkbookNode } from "./workbooks";

const dataset = (id: string, name: string, workbookId?: string, labels = ["Field", "Moment"]): Dataset => ({
  id,
  name,
  workbookId,
  data: { time: [0], values: labels.map(() => [1]), labels, units: labels.map(() => ""), metadata: {} },
});

const datasets = [
  { ...dataset("raw", "Raw loop", "w1"), tags: ["control"] },
  dataset("fit", "Processed", "w2", ["Temperature", "Intensity"]),
  dataset("loose", "Notes export"),
];
const workbooks: WorkbookNode[] = [
  { id: "w1", name: "MOKE scans", folderId: "f1" },
  { id: "w2", name: "XRD scans", folderId: "f2" },
];
const folders: FolderNode[] = [
  { id: "f1", name: "Magnetism", parentId: null, order: 0 },
  { id: "f2", name: "Diffraction", parentId: null, order: 1 },
];

describe("filterBatchDatasets", () => {
  it("scopes by workbook or to worksheets without a workbook", () => {
    expect(filterBatchDatasets({ datasets, workbooks, folders, workbookScope: "w1", query: "" }).map((item) => item.id)).toEqual(["raw"]);
    expect(filterBatchDatasets({ datasets, workbooks, folders, workbookScope: BATCH_LOOSE_WORKSHEETS, query: "" }).map((item) => item.id)).toEqual(["loose"]);
  });

  it("searches worksheet, workbook, folder, tag, and column names", () => {
    const ids = (query: string) => filterBatchDatasets({
      datasets, workbooks, folders, workbookScope: BATCH_ALL_WORKBOOKS, query,
    }).map((item) => item.id);
    expect(ids("raw")).toEqual(["raw"]);
    expect(ids("xrd")).toEqual(["fit"]);
    expect(ids("magnetism")).toEqual(["raw"]);
    expect(ids("control")).toEqual(["raw"]);
    expect(ids("temperature")).toEqual(["fit"]);
  });
});

describe("batch selection context", () => {
  it("builds cycle-safe folder captions once", () => {
    const nested: FolderNode[] = [
      { id: "a", name: "Root", parentId: null, order: 0 },
      { id: "b", name: "Child", parentId: "a", order: 0 },
      { id: "loop", name: "Loop", parentId: "loop", order: 1 },
    ];
    expect(batchFolderLabels(nested).get("b")).toBe("Root › Child");
    expect(batchFolderLabels(nested).get("loop")).toBe("Loop");
  });

  it("resets a deleted workbook scope but preserves built-in scopes", () => {
    expect(validBatchWorkbookScope("missing", workbooks)).toBe(BATCH_ALL_WORKBOOKS);
    expect(validBatchWorkbookScope("w1", workbooks)).toBe("w1");
    expect(validBatchWorkbookScope(BATCH_LOOSE_WORKSHEETS, workbooks)).toBe(BATCH_LOOSE_WORKSHEETS);
  });
});

describe("setShownBatchSelection", () => {
  it("changes only shown rows and preserves hidden selections", () => {
    expect(setShownBatchSelection(["loose"], datasets.slice(0, 2), true)).toEqual(["loose", "raw", "fit"]);
    expect(setShownBatchSelection(["loose", "raw", "fit"], [datasets[0]], false)).toEqual(["loose", "fit"]);
  });
});
