// P1.4 residual 3, the xy FACET half — Color-by / Symbol-by / legend-label
// source on a facet grid, screen <-> export PARITY. This is the FRONTEND half:
// from one dataset and one set of picks it builds
//   * the Graph Builder preview's panels (`encodeSpec`, a faceted spec),
//   * the Stage's facet grid (`Stage/useFacetEncoding`, the window document's
//     picks, focused and background windows alike),
//   * the plot window's own export request (`buildFigureSpecFromDocument`),
// and asserts the preview and the Stage draw the same series with the same
// colour, glyph and legend text in every panel, and that the request names
// each panel's dataset rows (an excluded row is in none). Request + screen are
// the committed wire fixture `tests/fixtures/wire/graph_encoding_facets.json`,
// which the BACKEND half (`tests/test_export_graph_encoding_facets.py`) posts
// to the real route and reads back, line by line.
//
// To regenerate after a DELIBERATE rule change:
//   GRAPH_ENCODING_FIXTURE_WRITE=1 npx vitest run src/lib/plotEncodingFacets.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { useFacetEncoding } from "../components/Stage/useFacetEncoding";
import { encodingNotes } from "../components/workshops/graphbuilder/encodingWellModel";
import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { withFacetRows } from "./figureSpecFacets";
import { encodedFacetPanels, encodeSpec } from "./plotEncoding";
import { facetEncoding, type FigureEncoding } from "./plotEncodingBinding";
import type { PlotSpec } from "./plotspec";
import { defaultPlotView } from "./plotview";
import { SERIES_VARS } from "./seriesStyleCycle";
import type { Dataset, DataStruct, SeriesStyle } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../../tests/fixtures/wire/graph_encoding_facets.json");
const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];

// ch0 B (x), ch1 Rxy (y, Ohm), ch2 sample S1/S2/S3 shown S3, S1, S2 (a level
// order), ch3 phase A/B, ch4 T (K), ch5 fac F1/F2. S2 has no F2 row and phase B
// no S3 row, so the panels keep different series; S1's T differs by panel, so
// its legend text does too. Row 3 (S1, B, F2) is EXCLUDED: in no panel, and
// every later row's analysis-view index is one less than its dataset row.
const ROWS = [
  [0, 1.0, 0, 0, 10, 0], [1, 1.2, 0, 1, 10, 0], [2, 2.0, 1, 0, 10, 0], [12, 9.9, 0, 1, 77, 1],
  [3, 2.2, 1, 1, 10, 0], [4, 3.0, 2, 0, 10, 0], [5, 1.1, 0, 0, 300, 1], [6, 1.3, 0, 1, 300, 1],
  [7, 3.1, 2, 0, 300, 1], [8, 3.3, 2, 0, 300, 1], [9, 2.4, 1, 0, 10, 0], [10, 1.5, 0, 0, 10, 0],
  [11, 3.4, 2, 0, 10, 0],
];
const DATA: DataStruct = {
  time: ROWS.map((_, i) => i),
  values: ROWS,
  labels: ["B", "Rxy", "sample", "phase", "T", "fac"],
  units: ["T", "Ohm", "", "", "K", ""],
  metadata: {},
  cat_levels: { 2: ["S1", "S2", "S3"], 3: ["A", "B"], 5: ["F1", "F2"] },
  level_order: { 2: [2, 0, 1] },
};
const DS: Dataset = { id: "fe", name: "facets.csv", data: DATA, excludedRows: [3] };
const PICKS: FigureEncoding = { color: 2, symbol: 3, label: 4 };
const Y = [1];
const ref = (channel: number) => ({ datasetId: "fe", channel });
const SPEC: PlotSpec = {
  version: 1,
  zones: {
    x: ref(0), y: [ref(1)], group: null, facet: ref(5), yErr: [], xErr: null, color: ref(2), symbol: ref(3), label: ref(4),
  },
  mark: "scatter",
};
const OPTS = { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" };

const root = document.documentElement;
beforeEach(() => PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c)));
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

interface ScreenSeries {
  label: string;
  color: string;
  marker: string | null;
  /** The (x, y) points the series draws, in row order. */
  points: [number, number][];
}
/** A panel series as the canvas paints it: its style's colour token as hex,
 *  its glyph, and its finite points (column `j + 1` of the panel's payload). */
function drawn(label: string, st: SeriesStyle, data: readonly (readonly (number | null)[])[], j: number): ScreenSeries {
  const k = SERIES_VARS.indexOf(st.color as (typeof SERIES_VARS)[number]);
  const points = data[0].flatMap((x, r): [number, number][] => {
    const y = data[j + 1][r];
    return x === null || y === null || !Number.isFinite(y) ? [] : [[x, y]];
  });
  return { label, color: k >= 0 ? PALETTE[k] : String(st.color), marker: st.marker ? (st.markerShape ?? "circle") : null, points };
}
type Cols = readonly (readonly (number | null)[])[];

function windowDoc(encoding: FigureEncoding | undefined, yKeys: number[] | null = Y) {
  const view = { ...defaultPlotView(), xKey: 0, yKeys, facetKey: 5 };
  return createFigureDocument({ id: "w", name: "w", datasetId: "fe", view, facetKey: 5, mark: "scatter", encoding });
}

const written: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.GRAPH_ENCODING_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, `${JSON.stringify(written, null, 2)}\n`);
});

describe("Color / Symbol / Label on an xy facet grid — preview, Stage and export agree", () => {
  it("each panel keeps the series with rows in it, in one style across panels, with its own legend text", async () => {
    const { result } = renderHook(() => useFacetEncoding(DS, PICKS, null, null, 5, 0, Y));
    await waitFor(() => expect(result.current).not.toBeNull());
    const stage = result.current!;
    const screen = stage.panels.map((p, i) => ({
      label: p.label,
      series: stage.labels[i].map((label, j) => drawn(label, stage.styles[i][j], p.payload.data as Cols, j)),
    }));
    const [P0, P1, P2] = PALETTE;
    // Colour by sample LEVEL in the user's order (S3 = 0, S1 = 1, S2 = 2);
    // glyph by phase (A circle, B square); text = T over the PANEL's rows.
    const shape = screen.map((p) => ({ label: p.label, series: p.series.map(({ points: _, ...rest }) => rest) }));
    expect(screen[1].series[2].points).toEqual([[6, 1.3]]); // S1 / B in F2: row 7 only
    expect(shape).toEqual([
      {
        label: "F1",
        series: [
          { label: "10 K", color: P0, marker: "circle" }, // S3, A
          { label: "10 K", color: P1, marker: "circle" }, // S1, A
          { label: "10 K", color: P1, marker: "square" }, // S1, B
          { label: "10 K", color: P2, marker: "circle" }, // S2, A
          { label: "10 K", color: P2, marker: "square" }, // S2, B
        ],
      },
      {
        label: "F2",
        series: [
          { label: "300 K", color: P0, marker: "circle" },
          { label: "300 K", color: P1, marker: "circle" },
          { label: "300 K", color: P1, marker: "square" }, // the excluded row 3 (77 K) is in no panel
        ],
      },
    ]);
    // The Graph Builder preview: the same panels, colours, glyphs and text.
    const preview = encodeSpec(SPEC, [DS])!;
    const previewScreen = preview.facets?.map((p) => ({
      label: p.label,
      series: p.labels.map((l, j) => drawn(l, p.styles[j], p.payload.data as Cols, j)),
    }));
    expect(previewScreen).toEqual(screen);

    // The window's own export: the panels name their dataset rows and channels.
    const request = buildFigureSpecFromDocument(windowDoc(PICKS), DS, "fe", OPTS);
    expect(request.encoding).toMatchObject({ color_col: 2, symbol_col: 3, label_col: 4, palette: PALETTE });
    expect(request.excluded_rows).toBeUndefined(); // the panels already leave row 3 out
    expect(request.facets?.map((f) => f.rows)).toEqual([[0, 1, 2, 4, 5, 10, 11, 12], [6, 7, 8, 9]]);
    expect(request.facets?.every((f) => JSON.stringify(f.channels) === "[1]")).toBe(true);
    expect(request.dataset.time).toHaveLength(13); // rows index the FULL dataset

    const current = JSON.parse(JSON.stringify({ request, screen })) as unknown;
    written.facets = current;
    expect(current).toEqual(JSON.parse(readFileSync(FIXTURE, "utf-8")).facets);
  });

  it("the export carries a channel's rename for the route to build names on", () => {
    const facets = [{ label: "F1", x: [0], series: [{ label: "Rxy (Ohm)", y: [1] }] }];
    expect(withFacetRows(facets, DATA, 5, Y, null, { 1: "R" })[0]).toEqual({
      label: "F1", x: [0], rows: [0, 1, 2, 4, 5, 10, 11, 12], channels: [1], series: [{ label: "Rxy (Ohm)", y: [1], legend: "R" }],
    });
  });

  it("with no colour factor a series keeps its WHOLE-grid position colour in every panel", () => {
    // Symbol by sample only: S3 / S1 / S2 are split positions 0 / 1 / 2. Panel
    // F2 has no S2 and panel "S1 only" has neither S3 nor S2 — S1 stays colour 1.
    const enc = { group: null, color: null, symbol: 2, label: null };
    const only = (rows: number[]) => ({ label: "S1 only", data: DATA, rows });
    const panels = encodedFacetPanels(DATA, [only([0, 1]), only([6, 7])], 0, Y, enc);
    expect(panels.map((p) => p.styles.map((st) => st.color))).toEqual([[SERIES_VARS[1]], [SERIES_VARS[1]]]);
    expect(panels[0].styles[0].markerShape).toBe("square");
  });

  it("no encoding without explicit Y channels, with only a gradient, or with none: the grid is unchanged", async () => {
    // Default Y channels can differ panel to panel (FEATURE-001), so the grid stays unencoded.
    expect(buildFigureSpecFromDocument(windowDoc(PICKS, null), DS, "fe", OPTS).encoding).toBeUndefined();
    // A gradient is not drawn per panel.
    expect(facetEncoding({ group: null, color: null, symbol: null, label: null, gradient: 1 })).toBeNull();
    expect(facetEncoding({ group: null, color: null, symbol: null, label: 4, gradient: 1 })).toEqual({
      group: null, color: null, symbol: null, label: 4,
    });
    const gradient = buildFigureSpecFromDocument(windowDoc({ color: 1 }), DS, "fe", OPTS);
    expect(gradient.encoding).toBeUndefined();
    expect(gradient.facets?.[0]).not.toHaveProperty("rows");
    expect(buildFigureSpecFromDocument(windowDoc(undefined), DS, "fe", OPTS).facets?.[0]).not.toHaveProperty("rows");
    const { result } = renderHook(() => useFacetEncoding(DS, { color: 1 }, null, null, 5, 0, Y));
    expect(result.current).toBeNull();
    // The Graph Builder says why, in one sentence.
    expect(encodingNotes(DS, { ...SPEC, zones: { ...SPEC.zones, color: ref(1), symbol: null, label: null } })).toEqual([
      "A gradient colours single points, so it does not apply while faceted.",
    ]);
    expect(encodingNotes(DS, SPEC)).toEqual([]);
  });
});
