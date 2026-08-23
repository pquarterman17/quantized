// PLOT_WORKFLOW_PLAN item 2: datasetViewDefaults' technique-defaults wiring.
// Other windows.ts behavior (focus/close/minimize/tile/…) is exercised via
// useApp.test.ts / exportParity2.test.ts; this file is scoped to the new
// technique-driven axis-scale reset added on top of the existing (unchanged)
// channel-keyed reset.

import { describe, expect, it } from "vitest";

import { captureTechniqueView, type TechniqueViewMemoryMap } from "../lib/techniqueViewMemory";
import type { Dataset } from "../lib/types";
import { datasetViewDefaults } from "./windows";

function ds(technique: string, metadataExtra: Record<string, unknown> = {}, labels: string[] = ["Y"]): Dataset {
  return {
    id: "d1",
    name: "test",
    data: {
      time: [0, 1, 2],
      values: labels.map(() => [1, 2, 3]),
      labels,
      units: labels.map(() => ""),
      metadata: { technique, ...metadataExtra },
    },
  };
}

describe("datasetViewDefaults — technique defaults apply with no prevDs (import/split/reimport)", () => {
  it("XRD gets log-y", () => {
    expect(datasetViewDefaults(ds("xrd.powder")).yScale).toBe("log");
  });

  it("SIMS and RSM also get log-y", () => {
    expect(datasetViewDefaults(ds("sims")).yScale).toBe("log");
    expect(datasetViewDefaults(ds("xrd.rsm")).yScale).toBe("log");
  });

  it("magnetometry/transport are explicitly linear", () => {
    expect(datasetViewDefaults(ds("magnetometry.mvsh")).yScale).toBe("linear");
    expect(datasetViewDefaults(ds("magnetometry.mvst")).yScale).toBe("linear");
    expect(datasetViewDefaults(ds("transport")).yScale).toBe("linear");
  });

  it("generic keeps the density heuristic -- no axis-scale opinion, yKeys still delegates downstream", () => {
    const patch = datasetViewDefaults(ds("generic"));
    expect(patch.yScale).toBeUndefined();
    expect(patch.xScale).toBeUndefined();
    expect(patch.yKeys).toBeNull(); // lib/plotdata.ts's defaultDenseChannels resolves this
  });

  it("an unrecognized technique tag also falls back to generic (never guesses)", () => {
    expect(datasetViewDefaults(ds("some.future.tag")).yScale).toBeUndefined();
  });

  it("ncnr reflectometry keeps its default_value_channels channel hint AND gets log R", () => {
    const reflDs = ds("reflectometry", { default_value_channels: [0, 2] });
    const patch = datasetViewDefaults(reflDs);
    expect(patch.yScale).toBe("log"); // the new axis-scale default
    expect(patch.yKeys).toBeNull(); // untouched -- the hint still resolves through plotdata.ts
    expect(reflDs.data.metadata.default_value_channels).toEqual([0, 2]); // hint itself is untouched
  });
});

describe("datasetViewDefaults — technique-change gating (log axes survive a same-technique switch)", () => {
  it("does not reapply the technique default on a same-technique switch", () => {
    const prev = ds("xrd.powder");
    const next = ds("xrd.powder");
    // A manual override (or the technique default itself) on the current view
    // is left alone -- datasetViewDefaults contributes no yScale key at all.
    expect(datasetViewDefaults(next, prev).yScale).toBeUndefined();
  });

  it("reapplies the technique default on a genuine technique change", () => {
    const prev = ds("magnetometry.mvsh"); // linear
    const next = ds("xrd.powder"); // log
    expect(datasetViewDefaults(next, prev).yScale).toBe("log");
  });

  it("an omitted prevDs (fresh import/split/reimport) always counts as a change", () => {
    expect(datasetViewDefaults(ds("xrd.powder"), undefined).yScale).toBe("log");
  });
});

// PLOT_WORKFLOW_PLAN item 5: memory > technique defaults > density heuristic.
// datasetViewDefaults's 3rd `memory` param is the store-facing precedence
// point; lib/techniqueViewMemory.test.ts covers the capture/apply/re-key
// logic itself in isolation.
describe("datasetViewDefaults — per-technique view memory (item 5)", () => {
  it("a resolved memory entry wins over the blank reset AND item 2's technique defaults", () => {
    const first = ds("xrd.powder", {}, ["2theta", "Intensity"]);
    const memory = captureTechniqueView(
      first,
      { xKey: 0, yKeys: [1], yScale: "log", xScale: "linear", seriesStyles: { 1: { color: "red" } }, seriesLabels: {}, seriesOrder: null, errKeys: {}, hiddenChannels: [] },
      {},
    );
    const second = ds("xrd.powder", {}, ["2theta", "Intensity"]);
    const patch = datasetViewDefaults(second, first, memory);
    expect(patch.xKey).toBe(0);
    expect(patch.yKeys).toEqual([1]);
    expect(patch.seriesStyles).toEqual({ 1: { color: "red" } });
  });

  it("no memory yet for the technique falls through to today's blank reset + technique defaults", () => {
    const patch = datasetViewDefaults(ds("xrd.powder"), undefined, {});
    expect(patch.yKeys).toBeNull();
    expect(patch.yScale).toBe("log"); // item 2's table, unaffected by an empty memory map
  });

  it("a shape-mismatched memory entry (yKeys resolve to nothing) resets exactly like no memory at all", () => {
    const first = ds("xrd.powder", {}, ["2theta", "Intensity"]);
    const memory: TechniqueViewMemoryMap = captureTechniqueView(
      first,
      { xKey: 0, yKeys: [1], yScale: "log", xScale: "linear", seriesStyles: {}, seriesLabels: {}, seriesOrder: null, errKeys: {}, hiddenChannels: [] },
      {},
    );
    // A same-technique dataset with completely different columns: the shape
    // mismatch falls through to item 2's isTechniqueChange gate — SAME
    // technique means yScale is left alone (undefined), exactly like the
    // pre-item-5 "log axes survive a same-technique switch" contract.
    const mismatched = ds("xrd.powder", {}, ["Time", "Counts"]);
    const patch = datasetViewDefaults(mismatched, first, memory);
    expect(patch.yKeys).toBeNull(); // the blank reset, not a bogus empty-array yKeys
    expect(patch.yScale).toBeUndefined();

    // A shape mismatch INTO a genuinely different technique still reapplies
    // that technique's own defaults (isTechniqueChange is true either way).
    const vsm = ds("magnetometry.mvsh", {}, ["Field", "Moment"]);
    const vsmPatch = datasetViewDefaults(vsm, first, memory);
    expect(vsmPatch.yKeys).toBeNull();
    expect(vsmPatch.yScale).toBe("linear");
  });

  it("generic never consults memory even if a caller hand-crafts a 'generic' entry", () => {
    const memory = { generic: { xKey: 0, yKeys: [0], yScale: "log" as const, xScale: "linear" as const, seriesStyles: {}, seriesLabels: {}, seriesOrder: null, errKeys: {}, hiddenChannels: [], labels: { 0: "Y" } } };
    const patch = datasetViewDefaults(ds("generic"), undefined, memory);
    expect(patch.yKeys).toBeNull(); // untouched by the hand-crafted entry
    expect(patch.yScale).toBeUndefined();
  });
});

// P1.5 review round P1: datasetViewDefaults is the SHARED choke point
// setActive/addDataset/reimport's shape-changed path all rely on to reset
// every CHANNEL-INDEXED PlotView field (one whose value IS a channel index,
// a list of them, or a Record keyed by one) when the active dataset's
// column layout changes -- an omitted field keeps indexing the OLD
// dataset's columns and silently misrenders (or misgroups) against the new
// one. P1.5's own groupKey slipped through exactly this gap (caught by
// review, not by a test -- this pins the full field list so the NEXT such
// field can't slip the same way). Cross-check this list by hand whenever
// PlotView gains a field shaped like a channel index/list/map; a plain
// style/label/scale/geometry field does NOT belong here (see the
// technique-defaults tests above for why yScale/xScale are deliberately
// NOT in this set -- those come from the technique table, not a blank reset).
const CHANNEL_INDEXED_PLOTVIEW_FIELDS = [
  "xKey",
  "yKeys",
  "groupKey",
  // F4.4: facetKey is the same class of field as groupKey (a channel index
  // into the active dataset's columns) -- reset it here too, same reasoning.
  "facetKey",
  "y2Keys",
  "y2Lim",
  "y2Scale",
  "y2Step",
  "y2AxisLabel",
  "seriesStyles",
  "seriesLabels",
  "errKeys",
  "seriesOrder",
  "hiddenChannels",
  "xLim",
  "yLim",
  "xStep",
  "yStep",
] as const;

describe("datasetViewDefaults — channel-indexed field coverage (P1.5 review P1)", () => {
  it("resets every known channel-indexed PlotView field, no more and no fewer", () => {
    const patch = datasetViewDefaults(ds("generic"));
    // "generic" contributes no technique-defaults spread, so the returned
    // keys are EXACTLY the unconditional reset object's own keys -- a
    // precise set match, not just "contains".
    expect(Object.keys(patch).sort()).toEqual([...CHANNEL_INDEXED_PLOTVIEW_FIELDS].sort());
  });

  it("every listed field actually resets to its blank value (not just present)", () => {
    const patch = datasetViewDefaults(ds("generic"));
    expect(patch.xKey).toBeNull();
    expect(patch.yKeys).toBeNull();
    expect(patch.groupKey).toBeNull();
    expect(patch.y2Keys).toBeNull();
    expect(patch.seriesStyles).toEqual({});
    expect(patch.seriesLabels).toEqual({});
    expect(patch.seriesOrder).toBeNull();
    expect(patch.hiddenChannels).toEqual([]);
    expect(patch.xLim).toBeNull();
    expect(patch.yLim).toBeNull();
  });
});
