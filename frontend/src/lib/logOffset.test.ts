// P2.3 box 3 — per-series decade offsets: the canvas half, the export-wire
// half, their agreement, and persistence through a `.dwk` save/open.

import { describe, expect, it } from "vitest";

import type { ErrorSpan } from "./errorbars";
import { buildFigureSpec } from "./figureSpec";
import {
  applyLogOffsets,
  logOffsetDecades,
  logOffsetSuffix,
  logOffsetsApply,
  scaleErrorColumns,
  scaleErrorSpans,
} from "./logOffset";
import { logOffsetWire } from "./logOffsetWire";
import { buildColumns, type PlotPayload } from "./plotdata";
import { defaultPlotView, type PlotView, type PlotWindow } from "./plotview";
import type { Dataset, DataStruct, SeriesStyle } from "./types";
import { parseWorkspace } from "./workspace";
import { serializeWorkspace } from "./workspaceSerialize";

const data: DataStruct = {
  time: [0, 10, 20],
  values: [
    [1e18, 5e22, 2e17],
    [3e18, 5e22, 4e17],
    [5e18, 5e22, null as unknown as number],
  ],
  labels: ["B", "Si", "P"],
  units: ["atoms/cm3", "atoms/cm3", "atoms/cm3"],
  metadata: { x_column_name: "Depth", x_column_unit: "nm" },
};
const dataset: Dataset = { id: "d1", name: "implant.csv", data };
const opts = { fmt: "pdf", style: "default", dpi: 300, title: "" };
const STYLES: Record<number, SeriesStyle> = { 0: { logOffset: 2 }, 2: { logOffset: -1, color: "#123456" } };
/** `buildFigureSpec` reads its view through a store-shaped getter. */
const g = (v: PlotView) => (() => v) as never;
const view = (patch: Partial<PlotView> = {}): PlotView => ({
  ...defaultPlotView(), xKey: null, yKeys: [0, 1, 2], yScale: "log", seriesStyles: STYLES, ...patch,
});

describe("logOffsetDecades / logOffsetSuffix", () => {
  it("honours whole decades only, degrading anything else to no offset", () => {
    expect([2, -3, 30, 31, 1.5, Number.NaN, "2", true, undefined, -0].map(logOffsetDecades)).toEqual([
      2, -3, 30, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect([0, 2, -1].map(logOffsetSuffix)).toEqual(["", " ×10^2", " ×10^-1"]);
  });
});

describe("applyLogOffsets (the canvas half)", () => {
  const payload = (): PlotPayload => buildColumns(data, null, null, [0, 1, 2]);

  it("scales each plotted series by 10^k and states it in the label, before the unit", () => {
    const out = applyLogOffsets(payload(), [0, 1, 2], STYLES, true);
    expect(out.data[1]).toEqual([1e20, 3e20, 5e20]);
    expect(out.data[2]).toEqual(payload().data[2]); // un-offset: the same values
    expect(out.data[3]).toEqual([2e16, 4e16, null]); // a blank stays blank
    expect(out.series.map((s) => s.label)).toEqual(["B ×10^2", "Si", "P ×10^-1"]);
    expect(out.series[0].unit).toBe("atoms/cm3");
    expect(out.data[0]).toEqual([0, 10, 20]); // x is never touched
  });

  it("is the SAME object when nothing is offset or the view refuses offsets", () => {
    const p = payload();
    expect(applyLogOffsets(p, [0, 1, 2], {}, true)).toBe(p);
    expect(applyLogOffsets(p, [0, 1, 2], STYLES, false)).toBe(p);
  });

  it("never offsets an overlay column appended after the plotted series", () => {
    const p = payload();
    const withOverlay: PlotPayload = {
      ...p,
      data: [...p.data, [7, 8, 9]] as unknown as PlotPayload["data"],
      series: [...p.series, { label: "fit", unit: "" }],
    };
    const out = applyLogOffsets(withOverlay, [0, 1, 2], STYLES, true);
    expect(out.data[4]).toEqual([7, 8, 9]);
    expect(out.series[3].label).toBe("fit");
  });

  it("is refused with an additive waterfall or a group split", () => {
    expect(logOffsetsApply(0, null)).toBe(true);
    expect(logOffsetsApply(0.2, null)).toBe(false);
    expect(logOffsetsApply(0, 1)).toBe(false);
  });
});

describe("scaleErrorColumns / scaleErrorSpans (finding 3: bars scale with the offset)", () => {
  // channels = [0, 1, 2]; STYLES offsets channel 0 by 2 decades, channel 1
  // not at all, channel 2 by -1. `cols`' keys are uPlot data columns
  // (p + 1), so column 1 is channel 0's own error, column 2 is channel 1's.
  const cols = new Map<number, (number | null)[]>([
    [1, [0.1, 0.2, null]], // channel 0: logOffset 2 -> ×100
    [2, [1, 2, 3]], // channel 1: no offset -> unchanged
  ]);

  it("scales each column's magnitudes by its OWN channel's offset, leaving an un-offset column alone", () => {
    const out = scaleErrorColumns(cols, [0, 1, 2], STYLES, true);
    expect(out.get(1)).toEqual([10, 20, null]);
    expect(out.get(2)).toEqual([1, 2, 3]);
  });

  it("is the SAME map when nothing is offset or the view refuses offsets", () => {
    expect(scaleErrorColumns(cols, [0, 1, 2], {}, true)).toBe(cols);
    expect(scaleErrorColumns(cols, [0, 1, 2], STYLES, false)).toBe(cols);
    expect(scaleErrorColumns(new Map(), [0, 1, 2], STYLES, true)).toEqual(new Map());
  });

  it("scales only the Y half of an error span, leaving X spans untouched", () => {
    const spans = new Map<number, ErrorSpan[]>([
      [1, [{ axis: "y", plus: [1, 2], minus: [1, 2] }]], // channel 0
      [3, [{ axis: "x", plus: [5], minus: [5] }, { axis: "y", plus: [null, 4], minus: [null, 4] }]], // channel 2
    ]);
    const out = scaleErrorSpans(spans, [0, 1, 2], STYLES, true);
    expect(out.get(1)).toEqual([{ axis: "y", plus: [1e2, 2e2], minus: [1e2, 2e2] }]); // channel 0: logOffset 2
    const ch2 = out.get(3)!;
    expect(ch2[0]).toEqual({ axis: "x", plus: [5], minus: [5] }); // X untouched
    expect(ch2[1]).toEqual({ axis: "y", plus: [null, 0.4], minus: [null, 0.4] }); // channel 2: logOffset -1
  });

  it("is the SAME map when nothing is offset or the view refuses offsets", () => {
    const spans = new Map<number, ErrorSpan[]>([[1, [{ axis: "y", plus: [1], minus: [1] }]]]);
    expect(scaleErrorSpans(spans, [0, 1, 2], {}, true)).toBe(spans);
    expect(scaleErrorSpans(spans, [0, 1, 2], STYLES, false)).toBe(spans);
  });
});

describe("log_offsets on the export wire", () => {
  it("carries each plotted channel's offset, aligned to y_keys", () => {
    const spec = buildFigureSpec(g(view()), dataset, "implant", opts);
    expect(spec.y_keys).toEqual([0, 1, 2]);
    expect(spec.log_offsets).toEqual([2, 0, -1]);
    // The data on the wire are the TRUE values: the offset is render metadata.
    expect(spec.dataset.values).toEqual(data.values);
  });

  it("follows the display order and hidden series drop out with their offset", () => {
    const spec = buildFigureSpec(g(view({ seriesOrder: [2, 1, 0], hiddenChannels: [1] })), dataset, "implant", opts);
    expect(spec.y_keys).toEqual([2, 0]);
    expect(spec.log_offsets).toEqual([-1, 2]);
  });

  it("agrees with the canvas value for value", () => {
    const spec = buildFigureSpec(g(view()), dataset, "implant", opts);
    const canvas = applyLogOffsets(buildColumns(data, null, null, [0, 1, 2]), [0, 1, 2], STYLES, true);
    spec.y_keys!.forEach((ch, i) => {
      const k = spec.log_offsets![i];
      const want = data.values.map((r) => (r[ch as number] == null ? null : (r[ch as number] as number) * 10 ** k));
      expect(canvas.data[i + 1]).toEqual(want);
    });
  });

  it("is ABSENT when nothing is offset, with a waterfall, and for the group/stack/facet shapes", () => {
    const absent = (v: PlotView) => !("log_offsets" in buildFigureSpec(g(v), dataset, "implant", opts));
    expect(absent(view({ seriesStyles: {} }))).toBe(true);
    expect(absent(view({ waterfall: 0.25 }))).toBe(true);
    expect(absent(view({ stackMode: true }))).toBe(true);
    const base = { plotted: [0, 1], seriesStyles: STYLES, waterfall: 0 };
    const cv = { groupKey: null, facetKey: null, stackMode: false, polarMode: false, statMode: false, xKey: null, yKeys: [0, 1] };
    expect(logOffsetWire({ ...base, view: cv, groupCol: 1 })).toEqual({});
    expect(logOffsetWire({ ...base, view: { ...cv, facetKey: 1 }, groupCol: null })).toEqual({});
    expect(logOffsetWire({ ...base, view: cv, groupCol: null })).toEqual({ log_offsets: [2, 0] });
  });
});

describe("persistence", () => {
  it("survives a .dwk save -> open with the window's view, and still exports the offsets", () => {
    const win: PlotWindow = {
      id: "w1",
      kind: "plot",
      title: "compare",
      datasetId: "d1",
      geometry: { x: 0, y: 0, w: 480, h: 360 },
      z: 0,
      winState: "maximized",
      view: view(),
      bg: "theme",
      linkGroup: null,
      pinned: false,
    };
    // (The workspace validator wants finite numbers; this dataset has no blank.)
    const saved: Dataset = { ...dataset, data: { ...data, values: data.values.map((r) => r.map((v) => v ?? 0)) } };
    const reopened = parseWorkspace(serializeWorkspace({ datasets: [saved], plotWindows: [win], focusedWindowId: "w1" }));
    const v = (reopened.plotWindows ?? [])[0].view as PlotView;
    expect(v.seriesStyles[0]).toEqual({ logOffset: 2 });
    expect(v.seriesStyles[2]).toEqual({ logOffset: -1, color: "#123456" });
    expect(buildFigureSpec(g(v), reopened.datasets[0], "implant", opts).log_offsets).toEqual([2, 0, -1]);
  });
});
