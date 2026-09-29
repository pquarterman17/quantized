// P1.4 residuals 4 and 5 — interactive <-> export PARITY for a GRADIENT
// Color-by (a continuous column: each point coloured by its own value through
// the sequential colormap, one colour scale) and TEXT-COLUMN factors (a
// row-indexed Origin text column with no channel index, picked by name as a
// Symbol factor and as the legend-label source).
//
// The FRONTEND half, the sibling of plotEncodingExport.test.ts: from ONE
// `encodeSpec` derivation it builds what the Graph Builder SCREEN draws (each
// series' point colours through `colorScatterFill`, its glyph, its legend text,
// the colour scale) and the EXPORT request, and pins both byte for byte as
// `tests/fixtures/wire/graph_encoding_gradient.json` ({request, screen}). The
// BACKEND half (`tests/test_export_graph_encoding_gradient.py`) posts that
// request, reads every drawn point's fill, glyph, the legend and the colourbar
// back out of the SVG, and compares them with `screen`. The Stage
// (usePlotPayload.encoding.test.ts), Publication Preview
// (plotSpecFigureEncoding.test.ts) and the window export
// (plotEncodingBinding.test.ts) are pinned to this same fixture.
//
// To regenerate after a DELIBERATE rule change:
//   GRAPH_ENCODING_FIXTURE_WRITE=1 npx vitest run src/lib/plotEncodingGradient.test.ts

import { readFileSync, writeFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GRADIENT_DATA,
  GRADIENT_DS,
  GRADIENT_FIXTURE_PATH as FIXTURE,
  GRADIENT_SPEC,
  gradientScreenOf,
  gradRef as ref,
} from "../test/gradientEncodingFixture";
import { encodeSpec, encodingData, gradientStops } from "./plotEncoding";
import { resolveFigureEncoding } from "./plotEncodingBinding";
import { encodedFigureSpec } from "./plotEncodingExport";
import type { PlotSpec } from "./plotspec";
import { SERIES_VARS } from "./seriesStyleCycle";
import type { Dataset, DataStruct } from "./types";

const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "", greyscale: false };

const root = document.documentElement;
beforeEach(() => PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c)));
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

describe("gradient Color-by + text-column factors — screen parity (P1.4 residuals 4, 5)", () => {
  it("the preview: split by the text factor, each point coloured by its own T, one scale over every row", () => {
    const e = encodeSpec(GRADIENT_SPEC, [GRADIENT_DS])!;
    const screen = gradientScreenOf(e);
    expect(e.split).toBe(true); // the text Symbol factor splits; the gradient does not
    expect(screen.markers).toEqual(["circle", "square"]);
    // Label from text column D over each series' rows (S1: rows 0,2,4,6,8; S2: 1,3,5,7).
    expect(screen.legend).toEqual(["ann, bob", "ann, bob, cy"]);
    expect(screen.colorbar).toEqual({ label: "T (K)", lo: 10, hi: 300 });
    // S1 draws rows 0,2,4,6 (row 8 has no T); S2 draws rows 1,3,5 (row 7 has no Rxy).
    expect(screen.points.map((p) => p.length)).toEqual([4, 3]);
    // The ends of the scale are the colormap's own end stops.
    expect(screen.points[0][0]).toBe(gradientStops()[0]);
  });

  it("the request is the committed wire fixture byte for byte (the backend half renders it)", () => {
    const e = encodeSpec(GRADIENT_SPEC, [GRADIENT_DS])!;
    const req = encodedFigureSpec(e, GRADIENT_SPEC, "gradient", OPTS);
    const current = JSON.parse(JSON.stringify({ request: req, screen: gradientScreenOf(e) })) as unknown;
    if (process.env.GRAPH_ENCODING_FIXTURE_WRITE === "1") {
      writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    }
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8")));
  });

  it("the wire carries the gradient's column and the text columns by name, indexed past the channels", () => {
    const req = encodedFigureSpec(encodeSpec(GRADIENT_SPEC, [GRADIENT_DS])!, GRADIENT_SPEC, "g", OPTS);
    expect(req.encoding).toMatchObject({ gradient_col: 1, symbol_col: 2, label_col: 3, text_columns: ["C", "D"] });
    expect(req.encoding!.color_col).toBeUndefined();
    // The analysis rows themselves: the backend appends C and D as channels 2, 3.
    expect(req.dataset).toBe(GRADIENT_DS.data);
  });

  it("a gradient alone splits nothing and keeps the series' error well", () => {
    const withErr: DataStruct = {
      ...GRADIENT_DATA,
      labels: [...GRADIENT_DATA.labels, "dR"],
      units: [...GRADIENT_DATA.units, "Ohm"],
      values: GRADIENT_DATA.values.map((row) => [...row, 0.1]),
    };
    const ds: Dataset = { ...GRADIENT_DS, data: withErr };
    const alone: PlotSpec = { ...GRADIENT_SPEC, zones: { ...GRADIENT_SPEC.zones, symbol: null, label: null, yErr: [ref(2)] } };
    const e = encodeSpec(alone, [ds])!;
    expect(e.split).toBe(false);
    expect(e.payload.series).toHaveLength(1);
    expect(encodedFigureSpec(e, alone, "a", OPTS).error_spans).toHaveLength(1);
  });

  it("a column with no finite value colours nothing, on screen and on the wire", () => {
    const blank: DataStruct = { ...GRADIENT_DATA, values: GRADIENT_DATA.values.map(([y]) => [y, NaN]) };
    const alone: PlotSpec = { ...GRADIENT_SPEC, zones: { ...GRADIENT_SPEC.zones, symbol: null } };
    const e = encodeSpec(alone, [{ ...GRADIENT_DS, data: blank }])!;
    expect(e.gradient).toBeNull();
    // The column still rides the wire; the backend's port colours nothing either
    // (tests/test_export_graph_encoding_gradient.py).
    expect(encodedFigureSpec(e, alone, "b", OPTS).encoding!.gradient_col).toBe(1);
  });
});

describe("text-column factors (residual 5)", () => {
  it("appends each picked text column as a categorical channel: levels by first appearance, blank = missing", () => {
    const enc = resolveFigureEncoding({ text: { symbol: "D", label: "C" } }, GRADIENT_DS, null)!;
    expect(enc).toMatchObject({ symbol: 2, label: 3, text: ["D", "C"] });
    const data = encodingData(GRADIENT_DATA, enc);
    expect(data.cat_levels).toEqual({ 2: ["ann", "bob", "cy"], 3: ["S1", "S2"] });
    expect(data.values[9].slice(2)).toEqual([0, NaN]);
    expect(data.units).toEqual(["Ohm", "K", "", ""]);
    // No text pick: the data object itself, untouched.
    expect(encodingData(GRADIENT_DATA, resolveFigureEncoding({ label: 1 }, GRADIENT_DS, null)!)).toBe(GRADIENT_DATA);
  });

  it("keeps the order of first appearance, not an alphabetical one", () => {
    const data: DataStruct = { ...GRADIENT_DATA, metadata: { origin_text_columns: { E: ["zed", "amy", " zed ", "bo"] } } };
    const enc = resolveFigureEncoding({ text: { label: "E" } }, { data }, null)!;
    const out = encodingData(data, enc);
    expect(out.cat_levels).toEqual({ 2: ["zed", "amy", "bo"] });
    expect(out.values.map((row) => row[2])).toEqual([0, 1, 0, 2, NaN, NaN, NaN, NaN, NaN, NaN]); // short column: missing = NaN
  });

  it("the same column in two wells is appended once", () => {
    const enc = resolveFigureEncoding({ text: { symbol: "C", label: "C" } }, GRADIENT_DS, null)!;
    expect(enc).toMatchObject({ symbol: 2, label: 2, text: ["C"] });
  });

  it("a text pick wins over the slot's numeric one; a missing column or a sampled preview's is ignored", () => {
    expect(resolveFigureEncoding({ symbol: 1, text: { symbol: "C" } }, GRADIENT_DS, null)).toMatchObject({ symbol: 2 });
    expect(resolveFigureEncoding({ text: { symbol: "Z" } }, GRADIENT_DS, null)).toBeNull();
    const sampled: Dataset = { ...GRADIENT_DS, pending: { previewSampled: true } as Dataset["pending"] };
    expect(resolveFigureEncoding({ text: { symbol: "C" } }, sampled, null)).toBeNull();
  });

  it("a text colour pick is a factor, never a gradient", () => {
    const enc = resolveFigureEncoding({ color: 1, text: { color: "C" } }, GRADIENT_DS, null)!;
    expect(enc).toMatchObject({ color: 2 });
    expect(enc.gradient).toBeUndefined();
  });
});
