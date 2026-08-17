// PR F, plan L0.7-L0.11: the recognized+plottable gate and the Quick Plot
// worksheet resolver. No component/store wiring here -- see
// store/quickPlotAction.test.ts for the store action and
// workbookContextActions.test.ts / datasetRowMenu tests for the menu glue.

import { describe, expect, it } from "vitest";

import { buildLibraryHierarchy, type LibraryNode } from "./libraryHierarchy";
import {
  CONFIGURE_QUICK_PLOT_REASON,
  MAP_DATA_REASON,
  NO_PLOTTABLE_COLUMNS_REASON,
  UNSUPPORTED_TECHNIQUE_REASON,
  pickQuickPlotWorksheet,
  quickPlotAvailability,
  quickPlotFigureSeed,
  quickPlotProfile,
  quickPlotWorkbookGate,
} from "./quickPlot";
import type { DataStruct, Dataset } from "./types";
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

// Sol's PR #153 review, P1: a technique stamp alone ("not generic") was
// never a sufficient recognized-schema contract. Concrete failure: xrd.rsm
// (2D reciprocal-space map data) used to pass the gate and Quick Plot would
// build an ordinary LINE figure out of scattered map columns -- a
// scientifically unsupported rendering. quickPlotProfile is the bounded
// (Sol's OPTION 1, not a full schema-signature system) per-technique
// allowlist that closes this.
describe("quickPlotProfile (P1: bounded per-technique allowlist)", () => {
  const rsmDataset = (over: Partial<DataStruct> = {}): Dataset => ({
    id: "rsm1",
    name: "sample.xrdml",
    data: {
      time: [0, 1, 2],
      values: [
        [1, 2, 100],
        [1.1, 2.1, 110],
        [1.2, 2.2, 120],
      ],
      labels: ["Qx", "Qz", "Intensity"],
      units: ["", "", "cps"],
      metadata: { technique: "xrd.rsm", is2D: true },
      ...over,
    },
  });

  // Red-first: the OLD gate (`techniqueOf(dataset) !== "generic"`) treated
  // xrd.rsm as ordinary line-plottable data. Reverting lib/quickPlot.ts to
  // the pre-P1 commit and running this test confirmed it RED (available:
  // true) before this fix -- see the PR report for the exact command.
  it("xrd.rsm (2D map data) is unavailable with the map-specific reason, not a bare 'unrecognized' one", () => {
    const ds = rsmDataset();
    expect(quickPlotProfile(ds)).toEqual({ supported: false, reason: MAP_DATA_REASON });
    expect(quickPlotAvailability(ds)).toEqual({ available: false, reason: MAP_DATA_REASON });
  });

  it.each([
    "magnetometry.mvsh",
    "magnetometry.mvst",
    "xrd.powder",
    "reflectometry",
    "sims",
    "transport",
    "spectroscopy",
  ] as const)("%s is on the line allowlist: available", (technique) => {
    const base = dataset({ id: "d1" });
    const ds: Dataset = { ...base, data: { ...base.data, metadata: { technique } } };
    expect(quickPlotProfile(ds)).toEqual({ supported: true, mode: "line" });
    expect(quickPlotAvailability(ds)).toEqual({ available: true });
  });

  // quickPlotProfile is an ALLOWLIST, never a denylist -- so a technique
  // that IS a known tag (survives techniqueOf's closed-vocabulary
  // narrowing) but isn't on LINE_PLOT_TECHNIQUES fails closed by
  // construction. Exercised via an xrd.rsm dataset whose is2D metadata is
  // missing (a malformed/edge case): the map-specific signal itself is
  // absent, so it falls to the GENERIC fail-closed reason rather than the
  // map one -- still refused, never silently treated as plottable.
  it("a known-but-unlisted technique with no map signal still fails closed, with the generic unsupported reason", () => {
    const ds = rsmDataset({ metadata: { technique: "xrd.rsm" } }); // no is2D flag
    expect(quickPlotProfile(ds)).toEqual({ supported: false, reason: UNSUPPORTED_TECHNIQUE_REASON });
  });

  // techniqueOf's OWN closed-vocabulary narrowing already collapses any
  // truly-unrecognized wire value to "generic" (lib/techniqueDefaults.ts),
  // so a "future technique" string can only ever reach quickPlotProfile
  // already resolved to "generic" -- this locks in that the fail-closed
  // guarantee holds end-to-end (profile never trusts an unlisted string),
  // and that quickPlotProfile's ALLOWLIST shape means a hypothetical new
  // entry added to the Technique union itself would ALSO fail closed here
  // unless explicitly added to LINE_PLOT_TECHNIQUES too.
  it("an unknown/unlisted technique wire value fails closed", () => {
    const base = dataset({ id: "d1" });
    const ds: Dataset = {
      ...base,
      data: { ...base.data, metadata: { technique: "some-future-technique-not-yet-taught" } },
    };
    expect(quickPlotProfile(ds)).toEqual({ supported: false, reason: CONFIGURE_QUICK_PLOT_REASON });
  });
});

// Sol's review: "proving the canonical mapping handles [error channels /
// hidden channels], not new inference". datasetViewDefaults already seeds
// errKeys/hiddenChannels from the dataset's own metadata -- quickPlotFigureSeed
// just needs to carry that through untouched.
describe("quickPlotFigureSeed — canonical mapping permutations (not new inference)", () => {
  it("a dataset with paired error channels: the seed's errKeys carries them (error columns are error bars, never bare series)", () => {
    const ds: Dataset = {
      id: "d1",
      name: "err.dat",
      data: {
        time: [0, 1, 2],
        values: [
          [1, 0.1],
          [2, 0.2],
          [3, 0.3],
        ],
        labels: ["Signal", "SignalErr"],
        units: ["", ""],
        metadata: { technique: "magnetometry.mvsh", error_channels: { "0": 1 } },
      },
    };
    const seed = quickPlotFigureSeed(ds);
    expect(seed.view.errKeys).toEqual({ 0: 1 });
  });

  it("a dataset with Origin-hidden channels (error/X columns): the seed's hiddenChannels carries them", () => {
    const ds: Dataset = {
      id: "d1",
      name: "origin.dat",
      data: {
        time: [0, 1, 2],
        values: [
          [1, 0.1],
          [2, 0.2],
          [3, 0.3],
        ],
        labels: ["Signal", "SignalErr"],
        units: ["", ""],
        metadata: {
          technique: "magnetometry.mvsh",
          origin_column_names: ["A", "B"],
          column_designations: { B: "Y-error" },
        },
      },
    };
    const seed = quickPlotFigureSeed(ds);
    expect(seed.view.hiddenChannels).toEqual([1]);
  });
});

// Sol's PR #153 review, P2: availability used to allocate a fresh column
// array (`values.map(row => row[c])`) and scan every row via
// finitePairCount for EVERY candidate channel, on every menu build.
describe("quickPlotAvailability performance (P2: allocation-free early exit + cache)", () => {
  /** A dataset whose `values` rows are Proxies counting numeric-index
   *  reads, with exactly ONE finite value cell at `finiteAtRow`. Used to
   *  prove the scan stops at the first hit instead of touching all
   *  `nRows` rows, and that a repeat call is a pure cache hit. */
  function instrumentedDataset(nRows: number, finiteAtRow: number): { dataset: Dataset; reads: () => number } {
    let reads = 0;
    const time = new Array<number>(nRows).fill(0); // always finite -- only the VALUE read gates the pair
    const values: number[][] = [];
    for (let i = 0; i < nRows; i++) {
      const cell = i === finiteAtRow ? 1 : NaN;
      values.push(
        new Proxy([cell], {
          get(target, prop, receiver) {
            if (prop === "0") reads++;
            return Reflect.get(target, prop, receiver);
          },
        }) as unknown as number[],
      );
    }
    const data: DataStruct = {
      time,
      values,
      labels: ["A"],
      units: [""],
      metadata: { technique: "magnetometry.mvsh" },
    };
    return { dataset: { id: "big", name: "big.dat", data }, reads: () => reads };
  }

  // Red-first: reverting lib/quickPlot.ts to the pre-P2 commit (the
  // `values.map(row => row[c])` + finitePairCount composition, no cache)
  // and running this test confirmed it RED -- the full 100_000-row scan
  // drove the read count into the tens of thousands, and the second call
  // repeated the entire scan (no cache) -- before this fix. See the PR
  // report for the exact command and numbers.
  it("early-exits at the first finite pair, and a repeat call is a cache hit with ZERO further reads", () => {
    const { dataset, reads } = instrumentedDataset(100_000, 2);
    const first = quickPlotAvailability(dataset);
    expect(first).toEqual({ available: true });
    expect(reads()).toBeLessThan(10); // row 0, 1, 2 -- a handful of reads, not 100_000
    const readsAfterFirst = reads();
    const second = quickPlotAvailability(dataset);
    expect(second).toEqual({ available: true });
    expect(reads()).toBe(readsAfterFirst); // cache hit: no additional element reads at all
  });
});
