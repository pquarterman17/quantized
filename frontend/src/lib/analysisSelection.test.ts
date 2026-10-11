import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import {
  analysisSelectionData, analysisSelectionSnapshot, captureAnalysisSelection,
  resolveAnalysisSelection, updateAnalysisSelectionItem,
} from "./analysisSelection";

const first: Dataset = {
  id: "a", name: "first.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [[10, 100, 1, 0], [20, 200, 2, 1], [30, 300, 3, 0], [40, 400, 4, 1]],
    labels: ["X", "Y", "sigma", "group"], units: ["s", "V", "V", ""], metadata: {},
    cat_levels: { 3: ["A", "B"] },
  },
  excludedRows: [1],
  errorRoles: [
    { channel: 2, target: 1, axis: "y", side: "both" },
    { channel: 2, target: 0, axis: "x", side: "+" },
  ],
};
const second: Dataset = { ...first, id: "b", name: "second.csv", excludedRows: undefined };

const capture = () => captureAnalysisSelection({
  datasets: [first, second], activeId: "a", selectedIds: ["b", "a"],
  xKey: 0, yKeys: [1], seriesOrder: null, errKeys: { 1: 2 },
  selection: { datasetId: "a", rows: [0, 1, 2] },
  range: { lo: 15, hi: 35, source: "manual" },
  mapRoi: { space: "q", x0: 1, x1: 2, y0: 3, y1: 4 },
}, "library", "2026-01-01T00:00:00.000Z");

describe("AnalysisSelection", () => {
  it("captures Library worksheets with the active input first and exact roles", () => {
    const selection = capture();
    expect(selection).toMatchObject({ version: 1, source: "library", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(selection.items.map((item) => item.datasetId)).toEqual(["a", "b"]);
    expect(selection.items[0]).toMatchObject({
      xKey: 0, yKeys: [1], errorKeys: { 1: 2 }, factorKeys: [], rowIds: [0, 2],
      range: { lo: 15, hi: 35 }, roi: { kind: "rect" },
    });
    expect(selection.items[0].errorBindings).toEqual(first.errorRoles);
    expect(selection.items[1]).toMatchObject({ rowIds: null, range: null, roi: null });
  });

  it("treats a single Library selection as authoritative even when it is not active", () => {
    const selection = captureAnalysisSelection({
      datasets: [first, second], activeId: "a", selectedIds: ["b"], xKey: 0, yKeys: [1],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library");
    expect(selection.items.map((item) => item.datasetId)).toEqual(["b"]);
  });

  it("promotes a live symmetric error choice into the full binding contract", () => {
    const plain = { ...first, errorRoles: undefined };
    const selection = captureAnalysisSelection({
      datasets: [plain], activeId: "a", selectedIds: ["a"], xKey: 0, yKeys: [1],
      seriesOrder: null, errKeys: { 1: 2 }, selection: null, range: null,
    }, "plot");
    expect(selection.items[0].errorBindings).toContainEqual({
      channel: 2, target: 1, axis: "y", side: "both",
    });
  });

  it("resolves against live row state and reports stale datasets/columns", () => {
    const selection = capture();
    const changed: Dataset = { ...first, excludedRows: [0, 1, 2] };
    const result = resolveAnalysisSelection(selection, [changed]);
    expect(result.items).toHaveLength(0);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ datasetId: "a", severity: "error", message: expect.stringMatching(/No selected rows/) }),
      expect.objectContaining({ datasetId: "b", severity: "error", message: expect.stringMatching(/no longer available/) }),
    ]));
    const badColumn = updateAnalysisSelectionItem(selection, "a", { yKeys: [99] });
    expect(resolveAnalysisSelection(badColumn, [first, second]).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ datasetId: "a", severity: "error", message: expect.stringMatching(/response column/) }),
    ]));
  });

  it("blocks an explicit row selection whose rows are already excluded instead of widening to all rows", () => {
    const selection = captureAnalysisSelection({
      datasets: [first], activeId: "a", selectedIds: ["a"], xKey: 0, yKeys: [1],
      seriesOrder: null, errKeys: {}, selection: { datasetId: "a", rows: [1] }, range: null,
    }, "worksheet");
    expect(selection.items[0].rowIds).toEqual([]);
    expect(resolveAnalysisSelection(selection, [first]).issues).toContainEqual(expect.objectContaining({
      severity: "error", message: expect.stringMatching(/No selected rows/),
    }));
  });

  it("materializes the exact row/range subset while keeping categorical metadata", () => {
    const item = { ...capture().items[0], factorKeys: [3] };
    const subset = analysisSelectionData(first, item);
    expect(subset.time).toEqual([2]);
    expect(subset.values).toEqual([[30, 300, 3, 0]]);
    expect(subset.cat_levels).toEqual(first.data.cat_levels);
  });

  it("blocks a Run by column that no longer has categorical semantics", () => {
    const selection = updateAnalysisSelectionItem(capture(), "a", { factorKeys: [3] });
    const changed = { ...first, data: { ...first.data, cat_levels: undefined }, channelTypes: { 3: "continuous" as const } };
    expect(resolveAnalysisSelection(selection, [changed, second]).issues).toContainEqual(expect.objectContaining({
      datasetId: "a", severity: "error", message: expect.stringMatching(/no longer categorical/),
    }));
  });

  it("uses a lazy Origin book's declared full row count and flags the preview", () => {
    const pending: Dataset = {
      ...first,
      pending: { kind: "path", path: "C:/project.opju", bookId: "b1", rows: 3000, cols: 4 },
    };
    const selection = captureAnalysisSelection({
      datasets: [pending], activeId: "a", selectedIds: ["a"], xKey: 0, yKeys: [1],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library");
    const resolved = resolveAnalysisSelection(selection, [pending]);
    expect(resolved.items[0].rowCount).toBe(3000);
    expect(resolved.issues).toContainEqual(expect.objectContaining({
      severity: "warning", message: expect.stringMatching(/full Origin worksheet/),
    }));
  });

  it("stores exact result provenance as compact row runs instead of a large array", () => {
    const selection = capture();
    selection.items[0] = { ...selection.items[0], rowIds: [0, 1, 2, 5, 8, 9] };
    const snapshot = analysisSelectionSnapshot(selection);
    expect(snapshot.rowEncoding).toBe("ranges-v1");
    expect(snapshot.items[0].rowRuns).toBe("0-2,5,8-9");
    expect(snapshot.items[1].rowRuns).toBeNull();
    expect(snapshot.items[0]).not.toHaveProperty("rowIds");
  });
});
