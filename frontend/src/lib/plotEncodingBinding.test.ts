// P1.4: the PERSISTED half of the Color-by / Symbol-by / legend-label source
// (lib/plotEncodingBinding.ts) — the gate, the document field's lifecycle
// (serialize, facade commits, rebinds, reshapes, column removal), the cycle
// refusal, and the plot window's OWN export carrying it (figureSpec.ts). The
// Stage half is usePlotPayload.encoding.test.ts; both are pinned to the same
// committed wire fixture the Graph Builder preview and the backend SVG are.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { remapFigureBindings } from "./channelRemap";
import {
  createFigureDocument,
  deserializeFigureDocument,
  serializeFigureDocument,
  updateFigureDocumentFromPlotView,
  type FigureDocument,
} from "./figureDocument";
import { resetFigureDocumentForReshape } from "./figureDocumentReimport";
import { buildFigureSpecFromDocument } from "./figureSpec";
import {
  figureEncodingWire,
  resolveFigureEncoding,
  sanitizeFigureEncoding,
  windowEncoding,
  type FigureEncoding,
} from "./plotEncodingBinding";
import { markSeriesStyle } from "./plotspec";
import { defaultPlotView, type PlotView, type PlotWindow } from "./plotview";
import { AUTO_MARKER_CYCLE, SERIES_VARS, windowCyclesSeriesStyles } from "./seriesStyleCycle";
import type { Dataset, DataStruct } from "./types";
import { createPlotWindowDocument, syncPlotWindow, withFocusedEncoding } from "../store/windowDocuments";
import { GRADIENT_DS, readGradientFixture } from "../test/gradientEncodingFixture";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, "../../../tests/fixtures/wire/graph_encoding_export.json"), "utf-8")) as {
  request: { y_keys: number[]; encoding: Record<string, unknown> };
};
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];

// The fixture's table (see lib/plotEncodingExport.test.ts), plus a dR column.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  values: [
    [1.0, 0, 0, 10], [1.5, 0, 1, 10], [2.0, 1, 0, 300], [2.5, 1, 1, 300], [3.0, 2, 0, 77], [3.5, 2, 1, 77],
    [4.0, 2, 1, 80], [4.5, 0, 0, 10], [5.0, 1, 1, 300], [NaN, 0, 1, 10], [6.0, NaN, 0, 10], [6.5, 1, 0, 300],
    [7.0, 2, 0, 77],
  ].map((row) => [...row, 0.1]),
  labels: ["Rxy", "sample", "field", "T", "dR"],
  units: ["Ohm", "", "", "K", "Ohm"],
  metadata: {},
  cat_levels: { 1: ["S1", "S2", "S3"] },
  level_order: { 1: [2, 0, 1] },
};
const DS: Dataset = { id: "enc", name: "encoding.csv", data: DATA };
const PICKS: FigureEncoding = { color: 1, symbol: 2, label: 3 };

function view(patch: Partial<PlotView> = {}): PlotView {
  return { ...defaultPlotView(), xKey: null, yKeys: [0], seriesStyles: { 0: markSeriesStyle({ version: 1, mark: "scatter", zones: { x: null, y: [], group: null, facet: null, yErr: [], xErr: null } }) }, ...patch };
}
function doc(encoding?: FigureEncoding, patch: Partial<PlotView> = {}, groupKey: number | null = null): FigureDocument {
  return createFigureDocument({ id: "figure-w1", name: "w", datasetId: "enc", view: view(patch), mark: "scatter", groupKey, encoding });
}
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" };

const root = document.documentElement;
beforeEach(() => PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c)));
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

describe("the gate", () => {
  it("keeps categorical colour/symbol picks, reads a continuous colour as a gradient, takes any label column", () => {
    expect(resolveFigureEncoding(PICKS, DS, null)).toEqual({ group: null, color: 1, symbol: 2, label: 3 });
    expect(resolveFigureEncoding({ color: 0, label: 3 }, DS, null)).toEqual({ group: null, color: null, symbol: null, label: 3, gradient: 0 });
    expect(resolveFigureEncoding({ color: 0 }, DS, null)).toEqual({ group: null, color: null, symbol: null, label: null, gradient: 0 });
    expect(resolveFigureEncoding({ symbol: 0 }, DS, null)).toBeNull(); // a continuous symbol is still ignored
    expect(resolveFigureEncoding({ color: 99 }, DS, null)).toBeNull();
    expect(resolveFigureEncoding(undefined, DS, 1)).toBeNull();
  });

  it("a bound secondary axis turns a window's encoding off (the group split's degrade)", () => {
    expect(windowEncoding(PICKS, DS, null, [3])).toBeNull();
    expect(windowEncoding(PICKS, DS, null, [])).not.toBeNull();
  });

  it("sanitize keeps non-negative integers only and omits an empty result", () => {
    expect(sanitizeFigureEncoding({ color: 1, symbol: -1, label: 2.5, extra: 4 })).toEqual({ color: 1 });
    expect(sanitizeFigureEncoding({ symbol: "2" })).toBeUndefined();
    expect(sanitizeFigureEncoding(null)).toBeUndefined();
  });

  it("the wire field is the Graph Builder export's own (the committed fixture's request)", () => {
    expect(figureEncodingWire(resolveFigureEncoding({ color: 1, symbol: 2, label: 3 }, DS, null)!)).toEqual({
      color_col: 1, symbol_col: 2, label_col: 3, palette: PALETTE, markers: [...AUTO_MARKER_CYCLE],
    });
    expect(FIXTURE.request.encoding).toEqual({
      color_col: 1, symbol_col: 2, label_col: 3, palette: PALETTE, markers: [...AUTO_MARKER_CYCLE],
    });
  });
});

describe("FigureBindings.encoding lifecycle", () => {
  it("is OMITTED when unset, so a document without one serializes exactly as before the field", () => {
    const keys = ["datasetId", "xKey", "yKeys", "y2Keys", "groupKey", "facetKey", "errors"];
    expect(Object.keys(doc().bindings)).toEqual(keys);
    expect(serializeFigureDocument(doc())).not.toContain("encoding");
    const reopened = deserializeFigureDocument(serializeFigureDocument(doc()))!;
    expect(Object.keys(reopened.bindings)).toEqual(keys);
    expect(Object.keys(updateFigureDocumentFromPlotView(doc(), { view: view() }).bindings)).toEqual(keys);
  });

  it("round-trips through save/reopen when set", () => {
    const reopened = deserializeFigureDocument(serializeFigureDocument(doc(PICKS)))!;
    expect(reopened.bindings.encoding).toEqual(PICKS);
  });

  it("survives every facade commit on the same dataset, and drops on a rebind to another", () => {
    const d = doc(PICKS);
    expect(updateFigureDocumentFromPlotView(d, { view: view({ yKeys: [0, 3] }) }).bindings.encoding).toEqual(PICKS);
    expect(updateFigureDocumentFromPlotView(d, { view: view(), datasetId: "enc" }).bindings.encoding).toEqual(PICKS);
    expect(updateFigureDocumentFromPlotView(d, { view: view(), datasetId: "other" }).bindings).not.toHaveProperty("encoding");
  });

  it("a window document carries it from `previous`, except on a dataset switch or a reshape", () => {
    const previous = doc(PICKS);
    const carry = (o: Parameters<typeof createPlotWindowDocument>[4], datasetId = "enc") =>
      createPlotWindowDocument("w1", "w", datasetId, view(), { previous, ...o }).bindings.encoding;
    expect(carry({})).toEqual(PICKS);
    expect(carry({ freshIdentity: true })).toEqual(PICKS); // Duplicate window
    expect(carry({ errors: null })).toEqual(PICKS); // an error-roles resync is not a reshape
    expect(carry({ resetAxisBreaks: true })).toBeUndefined();
    expect(carry({ resetEncoding: true })).toBeUndefined();
    expect(carry({}, "other")).toBeUndefined();
  });

  it("the reimport reshape reset and a removed column treat it like every other channel binding", () => {
    expect(resetFigureDocumentForReshape(doc(PICKS)).bindings).not.toHaveProperty("encoding");
    const b = doc(PICKS).bindings;
    expect(remapFigureBindings(b, 2).encoding).toEqual({ color: 1, label: 2 }); // symbol WAS col 2
    expect(remapFigureBindings(b, 0).encoding).toEqual({ color: 0, symbol: 1, label: 2 });
    expect(remapFigureBindings({ ...b, encoding: { label: 3 } }, 3)).not.toHaveProperty("encoding");
    expect(remapFigureBindings(doc().bindings, 0)).not.toHaveProperty("encoding");
  });

  it("withFocusedEncoding writes only the focused plot window, clears with undefined, and is a no-op when equal", () => {
    const win = (id: string): PlotWindow => ({
      id, kind: "plot", title: id, datasetId: "enc", geometry: { x: 0, y: 0, w: 1, h: 1 }, z: 0, winState: "normal",
      view: view(), document: doc(), bg: "theme", linkGroup: null, pinned: false,
    });
    const windows = [win("a"), win("b")];
    const set = withFocusedEncoding(windows, "b", PICKS);
    expect(set[0]).toBe(windows[0]);
    expect(set[1].kind === "plot" && set[1].document?.bindings.encoding).toEqual(PICKS);
    expect(withFocusedEncoding(set, "b", { ...PICKS })).toBe(set);
    const cleared = withFocusedEncoding(set, "b", undefined);
    expect(cleared[1].kind === "plot" && cleared[1].document?.bindings).not.toHaveProperty("encoding");
    // …and a later facade sync keeps what was written.
    const synced = syncPlotWindow(set[1], view({ yKeys: [0] }));
    expect(synced.kind === "plot" && synced.document?.bindings.encoding).toEqual(PICKS);
  });

  it("an encoded window refuses the P3.3 auto cycle, on canvas and export alike", () => {
    const cycleView = { groupKey: null, facetKey: null, stackMode: false, polarMode: false, statMode: false, xKey: null, yKeys: [0] };
    expect(windowCyclesSeriesStyles(true, cycleView, doc())).toBe(true);
    expect(windowCyclesSeriesStyles(true, cycleView, doc(PICKS))).toBe(false);
  });
});

describe("residuals 4 and 5 on the document: a gradient and text-column picks", () => {
  const G = readGradientFixture();
  const gradDoc = (encoding?: FigureEncoding) =>
    createFigureDocument({ id: "g", name: "g", datasetId: "grad", view: view(), mark: "scatter", encoding });
  const PICKS_G: FigureEncoding = { color: 1, text: { symbol: "C", label: "D" } };

  it("the window's own export sends the gradient fixture's encoding and text-factor dataset", () => {
    const spec = buildFigureSpecFromDocument(gradDoc(PICKS_G), GRADIENT_DS, "g", OPTS);
    expect(spec.encoding).toEqual(G.request.encoding);
    expect(JSON.parse(JSON.stringify(spec.dataset))).toEqual(G.request.dataset);
  });

  it("text picks persist by name, survive save/reopen and a column removal, and sanitize like the rest", () => {
    const reopened = deserializeFigureDocument(serializeFigureDocument(gradDoc(PICKS_G)))!;
    expect(reopened.bindings.encoding).toEqual(PICKS_G);
    expect(remapFigureBindings(reopened.bindings, 1).encoding).toEqual({ text: { symbol: "C", label: "D" } });
    expect(sanitizeFigureEncoding({ text: { symbol: "C", label: "", color: 3 }, extra: 1 })).toEqual({ text: { symbol: "C" } });
    expect(sanitizeFigureEncoding({ text: ["C"] })).toBeUndefined();
  });

  it("an excluded row leaves the wire dataset — the rows the Stage's colour scale is taken over", () => {
    // Row 9 (T = 300) excluded: pruned from the wire, so the backend's scale
    // tops out at 185, as the Stage's (Stage/usePlotEncoding, analysis rows).
    const excluded: Dataset = { ...GRADIENT_DS, excludedRows: [9] };
    const spec = buildFigureSpecFromDocument(gradDoc({ color: 1 }), excluded, "g", OPTS);
    expect(spec.dataset.time).toHaveLength(9);
    expect(spec.encoding).toMatchObject({ gradient_col: 1 });
  });
});

describe("the plot window's own export carries the encoding (screen == export)", () => {
  it("sends the Graph Builder fixture's encoding and series, over the window's styles", () => {
    const spec = buildFigureSpecFromDocument(doc(PICKS), DS, "enc", OPTS);
    expect(spec.encoding).toEqual(FIXTURE.request.encoding);
    expect(spec.y_keys).toEqual(FIXTURE.request.y_keys);
    expect(spec.group_col).toBeUndefined();
    // A factor splits: position-derived colours are stripped (the backend picks
    // each series' colour by level), the mark rides the channel style.
    expect(spec.series_styles?.[0]).not.toHaveProperty("color");
    expect(spec.series_styles?.[0]).toMatchObject({ marker: true });
  });

  it("sends Group as group_col beside the encoding, and nothing for an unencoded document", () => {
    expect(buildFigureSpecFromDocument(doc({ label: 3 }, {}, 2), DS, "g", OPTS)).toMatchObject({
      group_col: 2,
      encoding: { label_col: 3, palette: PALETTE },
    });
    expect(buildFigureSpecFromDocument(doc(), DS, "p", OPTS).encoding).toBeUndefined();
  });

  it("the SAME gate as the Stage: a continuous symbol pick, a bound y2 axis and a facet grid all send none", () => {
    expect(buildFigureSpecFromDocument(doc({ symbol: 0 }), DS, "c", OPTS).encoding).toBeUndefined();
    const y2 = buildFigureSpecFromDocument(doc(PICKS, { yKeys: [0, 3], y2Keys: [3] }), DS, "y2", OPTS);
    expect(y2.encoding).toBeUndefined();
    const faceted = createFigureDocument({ id: "f", name: "f", datasetId: "enc", view: { ...view(), facetKey: 2 }, facetKey: 2, encoding: PICKS });
    expect(buildFigureSpecFromDocument(faceted, DS, "f", OPTS).encoding).toBeUndefined();
  });

  it("never sends the waterfall stagger or decade offsets for an encoded figure", () => {
    const staggered = { yKeys: [0, 3], waterfall: 0.5 };
    expect(buildFigureSpecFromDocument(doc(PICKS, staggered), DS, "w", OPTS).waterfall_offsets).toBeUndefined();
    // The control: the same view unencoded does stagger.
    expect(buildFigureSpecFromDocument(doc(undefined, staggered), DS, "w", OPTS).waterfall_offsets).toBeDefined();
    const offset: Partial<PlotView> = { yScale: "log", yKeys: [0, 3], seriesStyles: { 0: { logOffset: 2 } } };
    expect(buildFigureSpecFromDocument(doc(PICKS, offset), DS, "o", OPTS).log_offsets).toBeUndefined();
    expect(buildFigureSpecFromDocument(doc(undefined, offset), DS, "o", OPTS).log_offsets).toBeDefined();
  });

  it("a legend-source-only encoding keeps the channel's canvas colour and its error spans", () => {
    const labelOnly = createFigureDocument({
      id: "l", name: "l", datasetId: "enc", view: view(), encoding: { label: 3 },
      errors: [{ channel: 4, target: 0, axis: "y", side: "both" }],
    });
    const spec = buildFigureSpecFromDocument(labelOnly, DS, "l", OPTS);
    expect(spec.encoding).toEqual({ label_col: 3, palette: PALETTE });
    expect(spec.series_styles?.[0]).toMatchObject({ color: PALETTE[0] });
    expect(spec.error_spans).toHaveLength(1);
  });
});
