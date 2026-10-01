// Waterfall X offset — the CANVAS half (lib/waterfallX.ts) and the wire's
// resolved offsets (lib/waterfallOffset.ts's `waterfallWire`). Origin's
// waterfall has an X as well as a Y offset: series i slides right by
// i·dx·(x-span), the same "fraction of the span" units `view.waterfall` uses
// for y. uPlot draws every series against ONE x column, so the shift is a
// segment-concatenated layout: one x block per display slot, each series'
// values (and its companions) inside its own block, null elsewhere.
import { describe, expect, it } from "vitest";

import { buildColumns, composeDisplayPayload, type DisplayCompose, type PlotPayload } from "./plotdata";
import { defaultPlotView } from "./plotview";
import type { DataStruct } from "./types";
import { expandWaterfallX } from "./waterfallX";
import { waterfallSourceRows, waterfallXApplies } from "./waterfallOffset";
import { waterfallWire } from "./waterfallWire";

type Col = (number | null)[];

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 10], [2, 20], [3, 30]],
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};

const base = (): PlotPayload => buildColumns(DATA, null, null, [0, 1]);
const cols = (p: PlotPayload): Col[] => p.data as unknown as Col[];
const NONE = new Map();
const companions = { errorBars: NONE, errorSpans: NONE, colorByColumns: NONE };

function compose(o: Partial<DisplayCompose> = {}): PlotPayload {
  return composeDisplayPayload(base(), {
    id: "d1", waterfall: 0, dropped: new Set(), excludedDisplay: "hide", fitOverlay: null,
    baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null, ...o,
  });
}

describe("expandWaterfallX — the canvas layout", () => {
  it("is off for a zero or non-finite step, and for a single series", () => {
    expect(waterfallXApplies(0)).toBe(false);
    expect(waterfallXApplies(Number.NaN)).toBe(false);
    expect(waterfallXApplies(-0.1)).toBe(true);
    const p = compose();
    expect(expandWaterfallX(p, 2, 0, companions).displayPayload).toBe(p);
    const one = buildColumns(DATA, null, null, [0]);
    expect(expandWaterfallX(one, 1, 0.5, companions).displayPayload).toBe(one);
  });

  it("slides series s right by s·fraction·(x-span), one x block per series", () => {
    // x-span 2, fraction 0.5 -> step 1.
    const out = expandWaterfallX(compose(), 2, 0.5, companions).displayPayload;
    const [x, a, b] = cols(out);
    expect(x).toEqual([0, 1, 2, 1, 2, 3]);
    expect(a).toEqual([1, 2, 3, null, null, null]);
    expect(b).toEqual([null, null, null, 10, 20, 30]);
    expect(out.blockRows).toBe(3);
    expect(out.series).toHaveLength(2);
  });

  it("composes with the Y offset (both halves of Origin's waterfall)", () => {
    // y-span 29, fraction 0.1 -> the second series is also lifted by 2.9.
    const [x, , b] = cols(expandWaterfallX(compose({ waterfall: 0.1 }), 2, -0.5, companions).displayPayload);
    expect(x).toEqual([0, 1, 2, -1, 0, 1]);
    b.slice(3).forEach((v, i) => expect(v).toBeCloseTo([12.9, 22.9, 32.9][i], 12));
  });

  it("puts each companion in its source series' block: ghosts, overlays (block 0), selection marks", () => {
    const p = compose({
      dropped: new Set([1]), excludedDisplay: "grey",
      fitOverlay: { datasetId: "d1", y: [5, 6, 7] },
      selection: { datasetId: "d1", rows: [2] },
    });
    // [x, A, B, A-ghost, B-ghost, fit, then one selection mark per column]
    expect(p.series.map((s) => s.label)).toEqual([
      "A", "B", "A (excluded)", "B (excluded)", "fit",
      "A (selected)", "B (selected)", "A (excluded) (selected)", "B (excluded) (selected)", "fit (selected)",
    ]);
    const c = cols(expandWaterfallX(p, 2, 0.5, companions).displayPayload);
    const block = (col: Col): number[] => [...new Set(col.flatMap((v, r) => (v == null ? [] : [Math.floor(r / 3)])))];
    expect(c.slice(1).map(block)).toEqual([[0], [1], [0], [1], [0], [0], [1], [], [], [0]]);
    expect(c[4]).toEqual([null, null, null, null, 20, null]); // B's greyed row 1, in B's block
  });

  it("places error bars, error spans and colour-by values in their series' block", () => {
    const errorBars = new Map([[2, [0.5, 0.6, 0.7, 0.8]]]); // longer than the payload: tail ignored
    const errorSpans = new Map([[1, [{ axis: "x" as const, plus: [1, 1, 1], minus: [2, 2, 2] }]]]);
    const colorByColumns = new Map([[2, { channel: 0, z: [7, 8, 9], colormap: "viridis" as const, lo: 7, hi: 9 }]]);
    const out = expandWaterfallX(compose(), 2, 0.5, { errorBars, errorSpans, colorByColumns });
    expect(out.errorBars.get(2)).toEqual([null, null, null, 0.5, 0.6, 0.7]);
    expect(out.errorSpans.get(1)?.[0]).toEqual({ axis: "x", plus: [1, 1, 1, null, null, null], minus: [2, 2, 2, null, null, null] });
    expect(out.colorByColumns.get(2)?.z).toEqual([null, null, null, 7, 8, 9]);
    expect(out.colorByColumns.get(2)?.lo).toBe(7);
  });

  it("maps a brushed block row back to its dataset row", () => {
    const out = expandWaterfallX(compose(), 2, 0.5, companions).displayPayload;
    expect(waterfallSourceRows(out, [0, 4, 5, 2])).toEqual([0, 1, 2]);
    const plain = compose();
    expect(waterfallSourceRows(plain, [2, 0])).toEqual([2, 0]);
  });
});

describe("waterfallWire — the export's resolved X offsets", () => {
  const view = { ...defaultPlotView(), xKey: null };
  const wire = (o: { fraction?: number; xFraction?: number; xSpan?: number | null; groupCol?: number | null; positions?: number[] }) =>
    waterfallWire({
      data: DATA, canvasChannels: [0, 1], positions: o.positions ?? [0, 1], fraction: o.fraction ?? 0,
      xFraction: o.xFraction, xSpan: o.xSpan, view, groupCol: o.groupCol ?? null,
    });

  it("emits per-slot X offsets in x data units (fraction × the canvas x-span)", () => {
    expect(wire({ xFraction: 0.5 })).toEqual({ waterfall_x_offsets: [0, 1] });
    expect(wire({ xFraction: -0.25, positions: [1, 2] })).toEqual({ waterfall_x_offsets: [-0.5, -1] });
  });

  it("uses the live canvas' published x-span when there is one", () => {
    expect(wire({ xFraction: 0.5, xSpan: 10 })).toEqual({ waterfall_x_offsets: [0, 5] });
  });

  it("carries both halves together, and neither for an off view (byte-identical wire)", () => {
    const both = wire({ fraction: 0.1, xFraction: 0.5 });
    expect(both.waterfall_x_offsets).toEqual([0, 1]);
    expect(both.waterfall_offsets?.[1]).toBeCloseTo(2.9, 12);
    expect(Object.keys(wire({ fraction: 0.1 }))).toEqual(["waterfall_offsets"]);
    expect(wire({})).toEqual({});
  });

  it("is refused for a grouped request, exactly as the Y half is", () => {
    expect(wire({ fraction: 0.1, xFraction: 0.5, groupCol: 1 })).toEqual({});
  });
});
