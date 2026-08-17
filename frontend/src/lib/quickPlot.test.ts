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
import type { TechniqueViewMemoryMap } from "./techniqueViewMemory";
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
    expect(quickPlotAvailability(ds)).toEqual({ available: true });
  });

  it("a generic technique is unavailable with the PR G reason", () => {
    const ds = dataset({
      id: "d1",
      data: { ...dataset({ id: "d1" }).data, metadata: { technique: "generic" } },
    });
    expect(quickPlotAvailability(ds)).toEqual({ available: false, reason: CONFIGURE_QUICK_PLOT_REASON });
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

  // Review fix #7 (red-first): the OLD gate only re-checked the candidate
  // channels' own VALUES for a finite entry, never pairing them against x
  // (`.time`, since Quick Plot always seeds xKey: null). A dataset with
  // perfectly finite y values but an entirely NaN `.time` has NOTHING
  // plottable (no x to place any point at) yet the old check called it
  // available. finitePairCount (lib/plotdata.ts) requires BOTH finite.
  it("recognized dataset with finite values but all-NaN time is unavailable — no plottable columns (fix #7)", () => {
    const base = dataset({ id: "d1" });
    const ds: Dataset = { ...base, data: { ...base.data, time: [NaN, NaN, NaN] } };
    expect(quickPlotAvailability(ds)).toEqual({ available: false, reason: NO_PLOTTABLE_COLUMNS_REASON });
  });

  // Review fix #1 (contract decision): DROP the labels.length<=1 gate -- a
  // single labels entry is a real channel, plottable against `.time`.
  it("a single real channel (one labels entry) plotted against time IS available (fix #1)", () => {
    const base = dataset({ id: "d1" });
    const ds: Dataset = { ...base, data: { ...base.data, values: [[1], [2], [3]], labels: ["A"], units: [""] } };
    expect(quickPlotAvailability(ds)).toEqual({ available: true });
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

  // Review fix #8: thread techniqueViewMemory through so a remembered view
  // applies, matching the "indistinguishable from a freshly-bound window"
  // doc claim (store/windowDefaults.ts's datasetViewDefaults already
  // prefers memory over the technique table for every OTHER fresh-view
  // path -- Quick Plot was the one path that dropped it on the floor).
  it("with a memory entry for the technique, the seeded view carries it (fix #8)", () => {
    const ds = dataset({ id: "d1", name: "run-1.dat" });
    const memory: TechniqueViewMemoryMap = {
      "magnetometry.mvsh": {
        xKey: null,
        yKeys: [1],
        yScale: "log", // distinguishable from the technique table's "linear"
        xScale: "linear",
        seriesStyles: {},
        seriesLabels: {},
        seriesOrder: null,
        errKeys: {},
        hiddenChannels: [],
        labels: {},
      },
    };
    const seed = quickPlotFigureSeed(ds, memory);
    expect(seed.view.yScale).toBe("log");
    expect(seed.view.yKeys).toEqual([1]);
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

  // Review fix #2 (CONTRACT DECISION, red-first): strict L0.11 -- a
  // remembered WORKSHEET that exists but fails quickPlotAvailability
  // resolves to null OUTRIGHT. The old code silently substituted the next
  // plottable sheet instead; this is now a REFUSAL, not a substitution.
  it("a remembered worksheet that fails availability resolves to null — NO silent substitution (fix #2)", () => {
    const generic = dataset({
      id: "d1", name: "d1.dat", workbookId: "w1",
      data: { ...dataset({ id: "d1" }).data, metadata: { technique: "generic" } },
    });
    const good = dataset({ id: "d2", name: "d2.dat", workbookId: "w1" });
    const children = childrenOf(wb, [generic, good]);
    const picked = pickQuickPlotWorksheet(children, { w1: "worksheet:d1" }, "w1");
    expect(picked).toBeNull();
  });

  it("with no remembered child, the first worksheet in source order wins", () => {
    const d1 = dataset({ id: "d1", name: "a.dat", workbookId: "w1" });
    const d2 = dataset({ id: "d2", name: "b.dat", workbookId: "w1" });
    const children = childrenOf(wb, [d1, d2]);
    expect(pickQuickPlotWorksheet(children, {}, "w1")?.id).toBe("d1");
  });

  it("an unplottable first worksheet is skipped for the second, plottable one WHEN NOT remembered", () => {
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
      data: { ...dataset({ id: "d2" }).data, time: [NaN, NaN, NaN] },
    });
    expect(quickPlotWorkbookGate(childrenOf(wb, [generic, barren]), {}, "w1")).toEqual({
      enabled: false,
      reason: "no plottable worksheet in this workbook",
    });
  });

  // Review fix #2 (CONTRACT DECISION, red-first probe): remembered=generic
  // sheet1 + recognized sheet2 -> DISABLED with sheet1's specific reason,
  // never "enabled, plots sheet2". The old code computed the gate purely
  // from pickQuickPlotWorksheet's (silently-substituting) result, so it
  // read enabled:true here.
  it("a remembered generic sheet1 + a recognized sheet2: DISABLED with sheet1's reason, not enabled+sheet2 (fix #2)", () => {
    const generic = dataset({
      id: "sheet1", name: "sheet1.dat", workbookId: "w1",
      data: { ...dataset({ id: "sheet1" }).data, metadata: { technique: "generic" } },
    });
    const good = dataset({ id: "sheet2", name: "sheet2.dat", workbookId: "w1" });
    const children = childrenOf(wb, [generic, good]);
    const gate = quickPlotWorkbookGate(children, { w1: "worksheet:sheet1" }, "w1");
    expect(gate).toEqual({ enabled: false, reason: CONFIGURE_QUICK_PLOT_REASON });
  });
});
