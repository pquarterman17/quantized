// PR F, plan L0.7-L0.11: the recognized+plottable gate and the Quick Plot
// worksheet resolver. No component/store wiring here -- see
// store/quickPlotAction.test.ts for the store action and
// workbookContextActions.test.ts / datasetRowMenu tests for the menu glue.

import { describe, expect, it } from "vitest";

import { buildLibraryHierarchy, type LibraryNode } from "./libraryHierarchy";
import {
  CONFIGURE_QUICK_PLOT_REASON,
  NO_PLOTTABLE_COLUMNS_REASON,
  pickQuickPlotWorksheet,
  quickPlotAvailability,
  quickPlotFigureSeed,
  quickPlotWorkbookGate,
} from "./quickPlot";
import type { Dataset } from "./types";
import type { WorkbookNode } from "./workbooks";

function dataset(over: Partial<Dataset> & { id: string }): Dataset {
  return {
    name: over.name ?? over.id,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { technique: "magnetometry.mvsh" },
    },
    ...over,
  };
}

describe("quickPlotAvailability", () => {
  it("a recognized, dense dataset is available", () => {
    const ds = dataset({ id: "d1" });
    const result = quickPlotAvailability(ds);
    expect(result).toEqual({ available: true, dataset: ds });
  });

  it("a generic technique is unavailable with the PR G reason", () => {
    const ds = dataset({
      id: "d1",
      data: { ...dataset({ id: "d1" }).data, metadata: { technique: "generic" } },
    });
    const result = quickPlotAvailability(ds);
    expect(result).toEqual({ available: false, reason: CONFIGURE_QUICK_PLOT_REASON });
  });

  it("a missing/unrecognized technique tag defaults to generic and is unavailable", () => {
    const ds = dataset({ id: "d1", data: { ...dataset({ id: "d1" }).data, metadata: {} } });
    expect(quickPlotAvailability(ds)).toEqual({ available: false, reason: CONFIGURE_QUICK_PLOT_REASON });
  });

  it("a recognized technique with all-NaN values is unavailable — no plottable columns", () => {
    const base = dataset({ id: "d1" });
    const ds: Dataset = {
      ...base,
      data: { ...base.data, values: [[NaN, NaN], [NaN, NaN], [NaN, NaN]] },
    };
    expect(quickPlotAvailability(ds)).toEqual({ available: false, reason: NO_PLOTTABLE_COLUMNS_REASON });
  });

  it("a single bare column is unavailable — no plottable columns", () => {
    const base = dataset({ id: "d1" });
    const ds: Dataset = {
      ...base,
      data: { ...base.data, values: [[1], [2], [3]], labels: ["A"], units: [""] },
    };
    expect(quickPlotAvailability(ds)).toEqual({ available: false, reason: NO_PLOTTABLE_COLUMNS_REASON });
  });
});

describe("quickPlotFigureSeed", () => {
  it("names the figure 'Quick Plot — <dataset name>' and seeds a fresh, technique-aware view", () => {
    const ds = dataset({ id: "d1", name: "run-1.dat" });
    const seed = quickPlotFigureSeed(ds);
    expect(seed.name).toBe("Quick Plot — run-1.dat");
    // magnetometry.mvsh is explicitly linear in techniqueDefaults.ts's table.
    expect(seed.view.yScale).toBe("linear");
    expect(seed.view.xKey).toBeNull();
  });
});

function hierarchy(workbook: WorkbookNode, datasets: Dataset[]) {
  return buildLibraryHierarchy({ folders: [], workbooks: [workbook], datasets });
}

function childrenOf(workbook: WorkbookNode, datasets: Dataset[]): readonly LibraryNode[] {
  const h = hierarchy(workbook, datasets);
  const node = h.byKey.get(`workbook:${workbook.id}`) as Extract<LibraryNode, { kind: "workbook" }>;
  return node.children;
}

describe("pickQuickPlotWorksheet", () => {
  const wb: WorkbookNode = { id: "w1", name: "W" };

  it("the remembered worksheet wins when it is plottable", () => {
    const d1 = dataset({ id: "d1", name: "d1.dat", workbookId: "w1" });
    const d2 = dataset({ id: "d2", name: "d2.dat", workbookId: "w1" });
    const children = childrenOf(wb, [d1, d2]);
    const picked = pickQuickPlotWorksheet(children, { w1: "worksheet:d2" }, "w1");
    expect(picked?.id).toBe("d2");
  });

  it("a remembered child that is NOT a worksheet (an editable-figure key) is ignored — first plottable worksheet wins", () => {
    const d1 = dataset({ id: "d1", name: "d1.dat", workbookId: "w1" });
    const children = childrenOf(wb, [d1]);
    const picked = pickQuickPlotWorksheet(children, { w1: "editable-figure:fig1" }, "w1");
    expect(picked?.id).toBe("d1");
  });

  it("a remembered worksheet that is unrecognized/unplottable is ignored — the second, plottable worksheet wins", () => {
    const generic = dataset({
      id: "d1", name: "d1.dat", workbookId: "w1",
      data: { ...dataset({ id: "d1" }).data, metadata: { technique: "generic" } },
    });
    const good = dataset({ id: "d2", name: "d2.dat", workbookId: "w1" });
    const children = childrenOf(wb, [generic, good]);
    const picked = pickQuickPlotWorksheet(children, { w1: "worksheet:d1" }, "w1");
    expect(picked?.id).toBe("d2");
  });

  it("with no remembered child, the first worksheet in source order wins", () => {
    const d1 = dataset({ id: "d1", name: "a.dat", workbookId: "w1" });
    const d2 = dataset({ id: "d2", name: "b.dat", workbookId: "w1" });
    const children = childrenOf(wb, [d1, d2]);
    expect(pickQuickPlotWorksheet(children, {}, "w1")?.id).toBe("d1");
  });

  it("an unplottable first worksheet is skipped for the second, plottable one", () => {
    const generic = dataset({
      id: "d1", name: "a.dat", workbookId: "w1",
      data: { ...dataset({ id: "d1" }).data, metadata: { technique: "generic" } },
    });
    const good = dataset({ id: "d2", name: "b.dat", workbookId: "w1" });
    const children = childrenOf(wb, [generic, good]);
    expect(pickQuickPlotWorksheet(children, {}, "w1")?.id).toBe("d2");
  });

  it("no worksheets at all resolves to null", () => {
    const children = childrenOf(wb, []);
    expect(pickQuickPlotWorksheet(children, {}, "w1")).toBeNull();
  });
});

describe("quickPlotWorkbookGate", () => {
  const wb: WorkbookNode = { id: "w1", name: "W" };

  it("enabled when a plottable worksheet resolves", () => {
    const d1 = dataset({ id: "d1", workbookId: "w1" });
    expect(quickPlotWorkbookGate(childrenOf(wb, [d1]), {}, "w1")).toEqual({ enabled: true, reason: "" });
  });

  it("empty workbook: 'this workbook has no worksheets'", () => {
    expect(quickPlotWorkbookGate(childrenOf(wb, []), {}, "w1")).toEqual({
      enabled: false,
      reason: "this workbook has no worksheets",
    });
  });

  it("generic-only workbook: the specific unrecognized-data reason", () => {
    const generic = dataset({
      id: "d1", workbookId: "w1",
      data: { ...dataset({ id: "d1" }).data, metadata: { technique: "generic" } },
    });
    expect(quickPlotWorkbookGate(childrenOf(wb, [generic]), {}, "w1")).toEqual({
      enabled: false,
      reason: CONFIGURE_QUICK_PLOT_REASON,
    });
  });

  it("a mix of unrecognized and unplottable-but-recognized worksheets: the generic fallback reason", () => {
    const generic = dataset({
      id: "d1", workbookId: "w1",
      data: { ...dataset({ id: "d1" }).data, metadata: { technique: "generic" } },
    });
    const barren = dataset({
      id: "d2", workbookId: "w1",
      data: { ...dataset({ id: "d2" }).data, values: [[1], [2], [3]], labels: ["A"], units: [""] },
    });
    expect(quickPlotWorkbookGate(childrenOf(wb, [generic, barren]), {}, "w1")).toEqual({
      enabled: false,
      reason: "no plottable worksheet in this workbook",
    });
  });
});
