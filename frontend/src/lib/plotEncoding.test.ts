// P1.4 Graph Builder encodings (lib/plotEncoding.ts): Color-by, Symbol-by and
// the legend-label source — gating, the split, the per-series styles and the
// legend entries. The cross-language half (the backend port and the exported
// SVG) is pinned through tests/fixtures/wire/graph_encoding_export.json by
// plotEncodingExport.test.ts + tests/test_export_graph_encoding.py.

import { describe, expect, it } from "vitest";

import {
  buildEncodedXY,
  encodeSpec,
  encodedSpecRender,
  isEncodingFactor,
  legendSourceText,
  resolveEncoding,
  type Encoding,
} from "./plotEncoding";
import { buildXY, specToRender, type ChannelRef, type PlotSpec } from "./plotspec";
import { AUTO_MARKER_CYCLE, SERIES_VARS } from "./seriesStyleCycle";
import type { DataStruct, Dataset } from "./types";

// ch0 y (V), ch1 sample (categorical S1/S2), ch2 field (2-level, inferred
// nominal: 12 finite rows), ch3 T (K, continuous-looking), ch4 a second y.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [1, 0, 0, 10, 5],
    [2, 0, 1, 10, 6],
    [3, 1, 0, 300, 7],
    [4, 1, 1, 300, 8],
    [5, 0, 0, 10, 9],
    [6, 0, 1, 10, 10],
    [7, 1, 0, 300, 11],
    [8, 1, 1, 300, 12],
    [9, 0, 0, 10, 13],
    [10, 0, 1, 10, 14],
    [11, 1, 0, 300, 15],
    [12, NaN, 1, 300, 16],
  ],
  labels: ["y", "sample", "field", "T", "y2"],
  units: ["V", "", "", "K", "A"],
  metadata: {},
  cat_levels: { 1: ["S1", "S2"] },
};
const DS: Dataset = { id: "e1", name: "enc.csv", data: DATA };
const r = (channel: number, datasetId = "e1"): ChannelRef => ({ datasetId, channel });

function spec(zones: Partial<PlotSpec["zones"]>, mark: PlotSpec["mark"] = "scatter"): PlotSpec {
  return { version: 1, zones: { x: null, y: [r(0)], group: null, facet: null, yErr: [], xErr: null, ...zones }, mark };
}
const enc = (e: Partial<Encoding>): Encoding => ({ group: null, color: null, symbol: null, label: null, ...e });

describe("gating through the modeling chokepoint", () => {
  it("a P1.4 categorical channel and an inferred-nominal one are factors; a continuous one is not", () => {
    expect(isEncodingFactor(DS, 1)).toBe(true); // cat_levels
    expect(isEncodingFactor(DS, 2)).toBe(true); // inferred nominal
    expect(isEncodingFactor(DS, 0)).toBe(false); // continuous
    expect(isEncodingFactor(DS, -1)).toBe(false); // x/time is never a factor
    expect(isEncodingFactor(DS, 99)).toBe(false);
  });

  it("a channelTypes override wins: a categorical column forced continuous stops being a factor", () => {
    const overridden: Dataset = { ...DS, channelTypes: { 1: "continuous" } };
    expect(isEncodingFactor(overridden, 1)).toBe(false);
    expect(resolveEncoding(spec({ color: r(1) }), overridden)).toBeNull();
  });

  it("resolveEncoding keeps a categorical colour/symbol pick, masks a continuous one, and takes ANY label column", () => {
    expect(resolveEncoding(spec({ color: r(1), symbol: r(0), label: r(3) }), DS)).toEqual(
      enc({ color: 1, label: 3 }),
    );
    expect(resolveEncoding(spec({ group: r(2) }), DS)).toBeNull(); // group alone: the ordinary path
    expect(resolveEncoding(spec({ color: r(1, "other") }), DS)).toBeNull(); // foreign dataset
  });
});

describe("buildEncodedXY — the split", () => {
  it("colour and symbol on DIFFERENT factors split by every present combination, nested outer-first", () => {
    const { payload, series } = buildEncodedXY(DATA, null, [0], enc({ color: 1, symbol: 2 }));
    expect(payload.series.map((s) => s.label)).toEqual([
      "y (sample=S1, field=0)",
      "y (sample=S1, field=1)",
      "y (sample=S2, field=0)",
      "y (sample=S2, field=1)",
    ]);
    expect(series.map((s) => [s.colorLevel, s.symbolLevel])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    // Row 11's NaN sample joins no series; every other row lands exactly once.
    expect(payload.data[1]).toEqual([1, null, null, null, 5, null, null, null, 9, null, null, null]);
    expect(payload.data[4]).toEqual([null, null, null, 4, null, null, null, 8, null, null, null, null]);
  });

  it("the same column as colour AND symbol is ONE factor: one series per level, both encodings by that level", () => {
    const { series } = buildEncodedXY(DATA, null, [0], enc({ color: 1, symbol: 1 }));
    expect(series.map((s) => [s.colorLevel, s.symbolLevel])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("honours the colour factor's level_order (display order, and so colour order)", () => {
    const ordered: DataStruct = { ...DATA, level_order: { 1: [1, 0] } };
    const { payload, series } = buildEncodedXY(ordered, null, [0], enc({ color: 1 }));
    expect(payload.series.map((s) => s.label)).toEqual(["y (sample=S2)", "y (sample=S1)"]);
    expect(series.map((s) => s.colorLevel)).toEqual([0, 1]);
  });

  // buildXY (the Group split) is the single-factor case of this split. The two
  // are separate implementations — buildXY sits in the EAGER plotspec.ts, and
  // delegating to this lazy module would pull it into the eager bundle — so,
  // as plotGroupSplit.test.ts does for applyGroupSplit, their agreement is a
  // runtime assertion rather than a claim.
  it("with a group factor alone it builds exactly buildXY's payload (the Group split)", () => {
    const ordered: DataStruct = { ...DATA, level_order: { 1: [1, 0] } };
    for (const data of [DATA, ordered]) {
      expect(buildEncodedXY(data, 0, [3, 4], enc({ group: 1 })).payload).toEqual(buildXY(data, 0, [3, 4], 1));
      expect(buildEncodedXY(data, null, [0], enc({ group: 2 })).payload).toEqual(buildXY(data, null, [0], 2));
    }
  });

  it("with only a legend source there is no split: one series per Y channel over every row", () => {
    const { payload, series } = buildEncodedXY(DATA, null, [0, 4], enc({ label: 3 }));
    expect(payload.series.map((s) => s.label)).toEqual(["y", "y2"]);
    expect(series.map((s) => s.legend)).toEqual(["y (10 K, 300 K)", "y2 (10 K, 300 K)"]);
  });
});

describe("legend-label source", () => {
  it("one value per series becomes the whole legend text, verbatim with the column's unit", () => {
    const { series } = buildEncodedXY(DATA, null, [0], enc({ color: 1, label: 3 }));
    expect(series.map((s) => s.legend)).toEqual(["10 K", "300 K"]);
  });

  it("a categorical label column reads its level strings; several values join, past three it summarizes", () => {
    expect(legendSourceText(DATA, 1, [0, 2])).toBe("S1, S2");
    const ramp: DataStruct = { ...DATA, values: DATA.values.map((row, i) => [...row.slice(0, 3), i * 10, row[4]]) };
    expect(legendSourceText(ramp, 3, [0, 1, 2])).toBe("0 K, 10 K, 20 K");
    expect(legendSourceText(ramp, 3, [0, 1, 2, 3, 4])).toBe("0 K … 40 K (5 values)");
  });

  it("rows with no finite label value keep the default name", () => {
    const blank: DataStruct = { ...DATA, values: DATA.values.map((row) => [row[0], row[1], row[2], NaN, row[4]]) };
    const { series } = buildEncodedXY(blank, null, [0], enc({ color: 1, label: 3 }));
    expect(series.map((s) => s.legend)).toEqual([undefined, undefined]);
  });
});

describe("encodeSpec — styles and legend entries from one derivation", () => {
  it("colour follows the colour LEVEL (the same hue on every Y channel), glyph the symbol level", () => {
    const e = encodeSpec(spec({ y: [r(0), r(4)], color: r(1), symbol: r(2) }), [DS]);
    expect(e).not.toBeNull();
    const colors = e!.styles.map((s) => s.color);
    // y: S1/f0, S1/f1, S2/f0, S2/f1, then y2 in the same order.
    expect(colors).toEqual([SERIES_VARS[0], SERIES_VARS[0], SERIES_VARS[1], SERIES_VARS[1], SERIES_VARS[0], SERIES_VARS[0], SERIES_VARS[1], SERIES_VARS[1]]);
    expect(e!.styles.map((s) => s.markerShape)).toEqual([
      AUTO_MARKER_CYCLE[0], AUTO_MARKER_CYCLE[1], AUTO_MARKER_CYCLE[0], AUTO_MARKER_CYCLE[1],
      AUTO_MARKER_CYCLE[0], AUTO_MARKER_CYCLE[1], AUTO_MARKER_CYCLE[0], AUTO_MARKER_CYCLE[1],
    ]);
    // The mark's own translation rides along: scatter = markers, no line.
    expect(e!.styles.every((s) => s.width === 0 && s.marker === true)).toBe(true);
  });

  it("with no colour factor the colour is the display position — Group's own rule", () => {
    const e = encodeSpec(spec({ group: r(1), symbol: r(2) }, "line"), [DS]);
    expect(e!.styles.map((s) => s.color)).toEqual(SERIES_VARS.slice(0, 4));
    // A line keeps its line; Symbol-by turns markers on.
    expect(e!.styles.every((s) => s.width === undefined && s.marker === true)).toBe(true);
  });

  it("legend entries come through the existing builder: one per series, its effective style and display index", () => {
    const e = encodeSpec(spec({ color: r(1), symbol: r(1), label: r(3) }), [DS])!;
    expect(e.legend).toEqual([
      { label: "10 K", style: e.styles[0], displayIndex: 0 },
      { label: "300 K", style: e.styles[1], displayIndex: 1 },
    ]);
    // Without a label source the entry is the default name + unit, as the Stage legend composes it.
    const plain = encodeSpec(spec({ color: r(1) }), [DS])!;
    expect(plain.legend.map((l) => l.label)).toEqual(["y (sample=S1) (V)", "y (sample=S2) (V)"]);
  });
});

describe("encodedSpecRender — scope", () => {
  it("a Group-only spec renders exactly as before (the encoding path never engages)", () => {
    const s = spec({ group: r(1) });
    const { render, encoded } = encodedSpecRender(s, [DS]);
    expect(encoded).toBeNull();
    expect(render).toEqual(specToRender(s, [DS]));
  });

  it("an encoded xy spec swaps in the encoded payload and drops error whiskers", () => {
    const s = spec({ color: r(1), yErr: [r(4)] });
    const { render, encoded } = encodedSpecRender(s, [DS]);
    expect(encoded).not.toBeNull();
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    expect(render.payload).toBe(encoded!.payload);
    expect(render.grouped).toBe(true);
    expect(render.errorSpans).toBeUndefined();
  });

  it("a legend-source-only encoding splits nothing, so it KEEPS the error whiskers", () => {
    const { render, encoded } = encodedSpecRender(spec({ label: r(3), yErr: [r(4)] }), [DS]);
    expect(encoded!.split).toBe(false);
    expect(encoded!.errors).toEqual([{ channel: 4, target: 0, axis: "y", side: "both" }]);
    if (render.kind !== "xy") throw new Error(render.kind);
    expect(render.grouped).toBe(false);
    expect(render.errorSpans?.get(1)?.[0].axis).toBe("y");
  });

  it("the render carries the mark's own fields, as specToRender's xy branch does", () => {
    const { render } = encodedSpecRender({ ...spec({ color: r(1) }, "step"), showMarkers: true }, [DS]);
    expect(render).toMatchObject({ kind: "xy", mark: "step", stepMode: "post", showMarkers: true });
  });

  it("box/violin/bar and faceted specs ignore the encodings", () => {
    expect(encodedSpecRender(spec({ x: r(1), color: r(1) }, "box"), [DS]).encoded).toBeNull();
    expect(encodedSpecRender(spec({ facet: r(2), color: r(1) }), [DS]).encoded).toBeNull();
  });
});
