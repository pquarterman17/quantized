// P1.4 Graph Builder encodings — interactive <-> export PARITY, the A8 pattern
// (`statLevelsParity.test.ts` + `tests/test_statplot_levels_parity.py`)
// applied to Color-by / Symbol-by / legend-label source.
//
// This is the FRONTEND half. From ONE `encodeSpec` derivation it builds both
// what the Graph Builder SCREEN draws (each series' resolved colour, glyph and
// legend text — the preview canvas' `seriesColor(i, style)` and the legend
// entries) and the EXPORT request, and asserts:
//   1. the request's encoding reproduces the screen series for series — the
//      palette slot the backend will pick for each series (by colour LEVEL) is
//      the colour the canvas drew, the glyph cycle likewise;
//   2. both are byte-for-byte the committed wire fixture
//      `tests/fixtures/wire/graph_encoding_export.json` ({request, screen}).
// The BACKEND half (`tests/test_export_graph_encoding.py`) posts that request
// to the real route, reads the SVG back and compares every series' colour,
// glyph and legend text against `screen`. A drift on either side breaks one
// of the two.
//
// To regenerate after a DELIBERATE change to the encoding rules:
//   GRAPH_ENCODING_FIXTURE_WRITE=1 npx vitest run src/lib/plotEncodingExport.test.ts
// then re-run without the variable, and re-run the backend half — never
// regenerate to paper over a backend regression.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveToHex } from "./color";
import { encodeSpec } from "./plotEncoding";
import { buildEncodedFigureSpec, encodedFigureSpec, resolvedPalette, withStagePresentation } from "./plotEncodingExport";
import type { PlotSpec } from "./plotspec";
import { AUTO_MARKER_CYCLE, SERIES_VARS, seriesColor } from "./seriesStyleCycle";
import type { Dataset, DataStruct } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../../tests/fixtures/wire/graph_encoding_export.json");

// A theme's palette, installed as the live CSS tokens the canvas reads —
// deliberately NOT matplotlib's default cycle, so an export that fell back to
// matplotlib's own colours could not pass for one that honoured the palette.
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];

// ch0 Rxy (Ohm); ch1 sample, categorical S1/S2/S3 displayed S3, S1, S2 (a
// level_order, so the colour order is the USER's); ch2 field, 2 levels,
// inferred nominal (13 finite rows) — a NUMERIC factor on the wire; ch3 T (K),
// the legend source: one value per series except S3/field 1 (77 and 80 K).
// Row 9's NaN value keeps its row in the combination (legend) but draws no
// point; row 10's NaN sample joins no series at all.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  values: [
    [1.0, 0, 0, 10],
    [1.5, 0, 1, 10],
    [2.0, 1, 0, 300],
    [2.5, 1, 1, 300],
    [3.0, 2, 0, 77],
    [3.5, 2, 1, 77],
    [4.0, 2, 1, 80],
    [4.5, 0, 0, 10],
    [5.0, 1, 1, 300],
    [NaN, 0, 1, 10],
    [6.0, NaN, 0, 10],
    [6.5, 1, 0, 300],
    [7.0, 2, 0, 77],
  ],
  labels: ["Rxy", "sample", "field", "T"],
  units: ["Ohm", "", "", "K"],
  metadata: { x_column_name: "t", x_column_unit: "s" },
  cat_levels: { 1: ["S1", "S2", "S3"] },
  level_order: { 1: [2, 0, 1] },
};
const DS: Dataset = { id: "enc", name: "encoding.csv", data: DATA };
const ref = (channel: number) => ({ datasetId: "enc", channel });
const SPEC: PlotSpec = {
  version: 1,
  zones: {
    x: null,
    y: [ref(0)],
    group: null,
    facet: null,
    yErr: [],
    xErr: null,
    color: ref(1),
    symbol: ref(2),
    label: ref(3),
  },
  mark: "scatter",
};
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "", greyscale: false };

const root = document.documentElement;
beforeEach(() => PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c)));
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

/** What the Graph Builder preview draws, per series. */
function screenOf(spec: PlotSpec) {
  const e = encodeSpec(spec, [DS])!;
  return {
    legend: e.legend.map((l) => l.label),
    colors: e.styles.map((st, i) => resolveToHex(seriesColor(i, st))),
    markers: e.styles.map((st) => (st.marker ? (st.markerShape ?? "circle") : null)),
  };
}

describe("Graph Builder encoded export — screen parity", () => {
  it("the request reproduces the preview series for series: colour by level, glyph by level", () => {
    const e = encodeSpec(SPEC, [DS])!;
    const req = encodedFigureSpec(e, SPEC, "encoding", OPTS);
    const screen = screenOf(SPEC);
    const { palette, markers } = req.encoding!;
    expect(palette).toEqual(PALETTE);
    e.series.forEach((s, i) => {
      expect(palette![(s.colorLevel ?? i) % palette!.length]).toBe(screen.colors[i]);
      expect(markers![s.symbolLevel! % markers!.length]).toBe(screen.markers[i]);
    });
    // The user's level order drives the colours: S3 first, so S3 is palette slot 1.
    expect(screen.legend).toEqual(["77 K", "77 K, 80 K", "10 K", "10 K", "300 K", "300 K"]);
    expect(screen.colors).toEqual([PALETTE[0], PALETTE[0], PALETTE[1], PALETTE[1], PALETTE[2], PALETTE[2]]);
    expect(screen.markers).toEqual(["circle", "square", "circle", "square", "circle", "square"]);
  });

  it("the request is the committed wire fixture byte for byte (the backend half renders it)", () => {
    const req = encodedFigureSpec(encodeSpec(SPEC, [DS])!, SPEC, "encoding", OPTS);
    const current = JSON.parse(JSON.stringify({ request: req, screen: screenOf(SPEC) })) as unknown;
    if (process.env.GRAPH_ENCODING_FIXTURE_WRITE === "1") {
      writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    }
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8")));
  });

  it("the wire carries the factors, the mark and only what the preview draws", () => {
    const req = encodedFigureSpec(encodeSpec(SPEC, [DS])!, SPEC, "encoding", OPTS);
    expect(req.encoding).toMatchObject({ color_col: 1, symbol_col: 2, label_col: 3, markers: [...AUTO_MARKER_CYCLE] });
    expect(req.group_col).toBeUndefined();
    expect(req.series_styles).toEqual([{ line: "none", marker: true }]);
    expect(req.y_keys).toEqual([0]);
    expect(req.x_key).toBeUndefined();
  });

  it("Group joins the split on the wire as group_col; a label-only spec sends no palette index rule change", () => {
    const grouped: PlotSpec = { ...SPEC, zones: { ...SPEC.zones, group: ref(2), color: null, symbol: null } };
    const req = encodedFigureSpec(encodeSpec(grouped, [DS])!, grouped, "g", OPTS);
    expect(req.group_col).toBe(2);
    expect(req.encoding).toEqual({ label_col: 3, palette: PALETTE });
  });

  it("forces the legend on — the preview always lists its entries, even for one series", () => {
    const lone: PlotSpec = { ...SPEC, zones: { ...SPEC.zones, color: null, symbol: null } };
    const req = encodedFigureSpec(encodeSpec(lone, [DS])!, lone, "lone", OPTS);
    expect(req.overrides).toEqual({ legend: { show: true } });
    // Label-only over every row: T takes 10, 77, 80 and 300 K — past three, summarized.
    expect(encodeSpec(lone, [DS])!.legend.map((l) => l.label)).toEqual(["10 K … 300 K (4 values)"]);
  });

  it("a legend-source-only spec keeps the Y-error well on the wire, as the preview keeps its whiskers", () => {
    const withErr: DataStruct = { ...DATA, labels: [...DATA.labels, "dR"], units: [...DATA.units, "Ohm"], values: DATA.values.map((row) => [...row, 0.1]) };
    const ds: Dataset = { ...DS, data: withErr };
    const lone: PlotSpec = { ...SPEC, zones: { ...SPEC.zones, color: null, symbol: null, yErr: [ref(4)] } };
    const req = encodedFigureSpec(encodeSpec(lone, [ds])!, lone, "lone", OPTS);
    expect(req.error_spans).toHaveLength(1);
    expect(req.error_spans![0]).toMatchObject({ y: { plus: expect.any(Array), minus: expect.any(Array) } });
    // …and a splitting spec drops it, like a grouped render.
    const split: PlotSpec = { ...SPEC, zones: { ...SPEC.zones, yErr: [ref(4)] } };
    expect(encodedFigureSpec(encodeSpec(split, [ds])!, split, "s", OPTS).error_spans).toBeUndefined();
  });

  it("takes the applied plot's presentation, never its series or its secondary axis", () => {
    const encoded = encodedFigureSpec(encodeSpec(SPEC, [DS])!, SPEC, "encoding", OPTS);
    const stage = {
      ...encoded,
      y_keys: [0, 3],
      series_styles: [{ color: "#000000" }],
      y2_keys: [3],
      x_scale: "linear" as const,
      y_scale: "log" as const,
      y_step: 2,
      width_in: 5,
      overrides: { y_lim: [1, 10] as [number, number], y2_lim: [0, 1] as [number, number], legend: { loc: "upper left" } },
    };
    const out = withStagePresentation(encoded, stage);
    expect(out).toMatchObject({ y_scale: "log", x_scale: "linear", y_step: 2, width_in: 5 });
    expect(out.overrides).toEqual({ y_lim: [1, 10], legend: { loc: "upper left", show: true } });
    expect(out.y_keys).toEqual(encoded.y_keys);
    expect(out.series_styles).toEqual(encoded.series_styles);
    expect(out.y2_keys).toBeUndefined();
    // A legend the plot hid on purpose stays hidden.
    expect(withStagePresentation(encoded, { ...stage, overrides: { legend: { show: false } } }).overrides).toEqual({
      legend: { show: false },
    });
  });

  it("an unresolvable palette is omitted whole, never sent partial", () => {
    SERIES_VARS.forEach((v) => root.style.removeProperty(v));
    root.style.setProperty(SERIES_VARS[0], "#123456");
    expect(resolvedPalette()).toBeNull();
    const req = encodedFigureSpec(encodeSpec(SPEC, [DS])!, SPEC, "encoding", OPTS);
    expect(req.encoding?.palette).toBeUndefined();
  });

  it("buildEncodedFigureSpec refuses a spec that no longer encodes anything (an ordinary export failure)", () => {
    const plain: PlotSpec = { ...SPEC, zones: { ...SPEC.zones, color: null, symbol: null, label: null } };
    expect(() => buildEncodedFigureSpec(plain, DS, "x", OPTS)).toThrow(/no longer has/);
  });
});
