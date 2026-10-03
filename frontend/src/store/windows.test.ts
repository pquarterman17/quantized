// PLOT_WORKFLOW_PLAN item 2: datasetViewDefaults' technique-defaults wiring.
// Other windows.ts behavior (focus/close/minimize/tile/…) is exercised via
// useApp.test.ts / exportParity2.test.ts; this file is scoped to the new
// technique-driven axis-scale reset added on top of the existing (unchanged)
// channel-keyed reset.

import { describe, expect, it } from "vitest";

import { defaultDenseChannels } from "../lib/plotdata";
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

  it("generic gets linear axes; yKeys still delegates to the density heuristic", () => {
    const patch = datasetViewDefaults(ds("generic"));
    expect(patch.yScale).toBe("linear");
    expect(patch.xScale).toBe("linear");
    expect(patch.yKeys).toBeNull(); // lib/plotdata.ts's defaultDenseChannels resolves this
  });

  it("an unrecognized technique tag also falls back to generic (never guesses)", () => {
    expect(datasetViewDefaults(ds("some.future.tag")).xScale).toBe("linear");
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

  it("a spectrum after a SIMS profile gets a linear y back (IR transmittance was drawn on log)", () => {
    expect(datasetViewDefaults(ds("spectroscopy"), ds("sims")).yScale).toBe("linear");
    expect(datasetViewDefaults(ds("spectroscopy")).yScale).toBe("linear");
  });

  it("a generic dataset after a log technique resets to linear; generic -> generic keeps the scale", () => {
    expect(datasetViewDefaults(ds("generic"), ds("reflectometry")).yScale).toBe("linear");
    expect(datasetViewDefaults(ds("generic"), ds("generic")).yScale).toBeUndefined();
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
    expect(patch.yScale).toBe("linear"); // the generic row, not the entry's "log"
  });
});

// P1.5 review round P1: datasetViewDefaults is the SHARED choke point used by
// setActive/addDataset/reimport's shape-changed path. It resets every
// CHANNEL-INDEXED field when the active dataset's columns change, plus the
// axis-title overrides that semantically belong to the outgoing dataset.
// Other display configuration (plot title, grid, legend, template, geometry)
// deliberately survives; scale comes from the technique-default table. Keep
// this exact list in sync whenever PlotView gains another dataset-bound field.
const DATASET_REBIND_RESET_FIELDS = [
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
  "xAxisLabel",
  "yAxisLabel",
  "seriesStyles",
  "seriesLabels",
  "errKeys",
  "seriesOrder",
  "hiddenChannels",
  "xLim",
  "yLim",
  "xStep",
  "yStep",
  // The reversed-x convention belongs to the dataset's x quantity (IR
  // wavenumber, metadata.x_reversed) -- an IR spectrum's reversal must not
  // ride into the next XRD scan.
  "xReversed",
] as const;

describe("datasetViewDefaults — dataset-bound field coverage (P1.5 review P1)", () => {
  it("resets every known dataset-bound PlotView field, no more and no fewer", () => {
    const patch = datasetViewDefaults(ds("generic"), ds("generic"));
    // A same-technique switch contributes no technique-defaults spread, so
    // the returned keys are EXACTLY the unconditional reset object's own
    // keys -- a precise set match, not just "contains".
    expect(Object.keys(patch).sort()).toEqual([...DATASET_REBIND_RESET_FIELDS].sort());
  });

  it("every listed field actually resets to its blank value (not just present)", () => {
    const patch = datasetViewDefaults(ds("generic"), ds("generic"));
    expect(patch.xKey).toBeNull();
    expect(patch.yKeys).toBeNull();
    expect(patch.groupKey).toBeNull();
    expect(patch.y2Keys).toBeNull();
    expect(patch.xAxisLabel).toBe("");
    expect(patch.yAxisLabel).toBe("");
    expect(patch.seriesStyles).toEqual({});
    expect(patch.seriesLabels).toEqual({});
    expect(patch.seriesOrder).toBeNull();
    expect(patch.hiddenChannels).toEqual([]);
    expect(patch.xLim).toBeNull();
    expect(patch.yLim).toBeNull();
  });
});

// Plot audit round 2: a GENUINE switch (the caller passes the outgoing view)
// also drops the outgoing dataset's coordinate-tied decorations and tick
// formats; split/reimport pass none and keep them.
describe("datasetViewDefaults — outgoing decorations (genuine switch only)", () => {
  const outgoing = {
    refLines: [{ id: "r", axis: "x" as const, value: 1 }],
    regionShades: [],
    annotations: [{ id: "a", x: 0.5, y: 0.5, text: "page", anchor: "page" as const }],
    shapes: [],
    xFmt: { mode: "sci" as const, digits: 2 },
    yFmt: { mode: "auto" as const, digits: 2 },
    y2Fmt: null,
  };

  it("adds only the fields that change", () => {
    const patch = datasetViewDefaults(ds("generic"), ds("generic"), {}, { outgoing });
    const extra = Object.keys(patch).filter((k) => !(DATASET_REBIND_RESET_FIELDS as readonly string[]).includes(k));
    expect(extra.sort()).toEqual(["refLines", "xFmt"]);
    expect(patch.refLines).toEqual([]);
    expect(patch.xFmt).toEqual({ mode: "auto", digits: 2 });
  });

  it("no outgoing view (split/reimport) leaves decorations alone", () => {
    const patch = datasetViewDefaults(ds("generic"), ds("generic"));
    expect(patch.refLines).toBeUndefined();
    expect(patch.annotations).toBeUndefined();
    expect(patch.xFmt).toBeUndefined();
  });
});

describe("datasetViewDefaults — a parser's peak-list trace hint", () => {
  const DOT = { marker: true, width: 0 };

  it("draws every channel of a peak list as markers, not joined lines", () => {
    const peaks = ds("spectroscopy", { default_trace: "Scatter" }, ["Abundance", "Subfile"]);
    expect(datasetViewDefaults(peaks).seriesStyles).toEqual({ 0: DOT, 1: DOT });
    expect(datasetViewDefaults(ds("spectroscopy")).seriesStyles).toEqual({});
  });

  it("opens a 2-D map's Plot tab on Intensity as markers (io/_map_schema.py's hints)", () => {
    const hints = { is2D: true, default_trace: "Scatter", default_value_channels: [2] };
    const map = ds("xrd.rsm", hints, ["2Theta", "Omega", "Intensity", "Qx", "Qz"]);
    expect(datasetViewDefaults(map).seriesStyles).toEqual({ 0: DOT, 1: DOT, 2: DOT, 3: DOT, 4: DOT });
    expect(defaultDenseChannels(map.data)).toEqual([2]);
  });

  it("survives a same-technique memory that carries no style, and yields to one that does", () => {
    const ir = ds("spectroscopy", {}, ["Absorbance"]);
    const view = { xKey: null, yKeys: null, yScale: "linear" as const, xScale: "linear" as const, seriesLabels: {}, seriesOrder: null, errKeys: {}, hiddenChannels: [] };
    const bare = captureTechniqueView(ir, { ...view, seriesStyles: {} }, {});
    const peaks = ds("spectroscopy", { default_trace: "Scatter" }, ["Abundance"]);
    expect(datasetViewDefaults(peaks, ir, bare).seriesStyles).toEqual({ 0: DOT });
    const styled = captureTechniqueView(peaks, { ...view, seriesStyles: { 0: { color: "red" } } }, {});
    expect(datasetViewDefaults(peaks, peaks, styled).seriesStyles).toEqual({ 0: { color: "red" } });
  });
});
