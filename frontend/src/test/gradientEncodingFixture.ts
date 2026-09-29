// The shared inputs behind `tests/fixtures/wire/graph_encoding_gradient.json`
// (P1.4 residuals 4 and 5: a gradient Color-by and text-column factors). The
// fixture is WRITTEN by lib/plotEncodingGradient.test.ts and READ by the Stage
// (Stage/usePlotPayload.encoding.test.ts), Publication Preview
// (lib/plotSpecFigureEncoding.test.ts) and window-export
// (lib/plotEncodingBinding.test.ts) tests and by the backend half
// (tests/test_export_graph_encoding_gradient.py) — one table, one spec, one
// definition of "what the screen draws". Test-only.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FigureSpec } from "../lib/api/figures";
import { colorScatterFill } from "../lib/colorscatter";
import { gradientColumns, gradientStops, type EncodedSpec } from "../lib/plotEncoding";
import type { PlotSpec } from "../lib/plotspec";
import type { Dataset, DataStruct } from "../lib/types";

const here = dirname(fileURLToPath(import.meta.url));
export const GRADIENT_FIXTURE_PATH = join(here, "../../../tests/fixtures/wire/graph_encoding_gradient.json");

export interface GradientScreen {
  legend: string[];
  markers: string[];
  points: string[][];
  colorbar: { label: string; lo: number; hi: number };
  /** The colormap's stops — the backend's GRADIENT_STOPS copy is pinned to it. */
  stops: string[];
}

export function readGradientFixture(): { request: FigureSpec; screen: GradientScreen } {
  return JSON.parse(readFileSync(GRADIENT_FIXTURE_PATH, "utf-8")) as { request: FigureSpec; screen: GradientScreen };
}

// ch0 Rxy (Ohm); ch1 T (K), continuous — the gradient. Text columns (Origin
// short names, no channel index): C the sample (S1/S2; row 9 blank, so it joins
// no series), D the operator (the legend source). Row 7's NaN Rxy draws no
// point; row 8's NaN T draws no point either (no colour) — yet row 9's T = 300,
// in no series, still sets the scale's top (the range is over every row).
export const GRADIENT_DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  values: [
    [1.0, 10], [1.5, 35], [2.0, 60], [2.5, 85], [3.0, 110],
    [3.5, 135], [4.0, 160], [NaN, 185], [5.0, NaN], [5.5, 300],
  ],
  labels: ["Rxy", "T"],
  units: ["Ohm", "K"],
  metadata: {
    x_column_name: "t",
    x_column_unit: "s",
    origin_text_columns: {
      C: ["S1", "S2", "S1", "S2", "S1", "S2", "S1", "S2", "S1", ""],
      D: ["ann", "ann", "bob", "bob", "ann", "cy", "bob", "bob", "ann", "ann"],
    },
  },
};
export const GRADIENT_DS: Dataset = {
  id: "grad",
  name: "gradient.opj",
  data: GRADIENT_DATA,
  channelTypes: { 1: "continuous" },
};
export const gradRef = (channel: number) => ({ datasetId: "grad", channel });
export const gradText = (name: string) => ({ datasetId: "grad", channel: -1, text: name });
export const GRADIENT_SPEC: PlotSpec = {
  version: 1,
  zones: {
    x: null, y: [gradRef(0)], group: null, facet: null, yErr: [], xErr: null,
    color: gradRef(1), symbol: gradText("C"), label: gradText("D"),
  },
  mark: "scatter",
};

/** `rgb(r, g, b)` -> `#rrggbb`. */
export const rgbToHex = (rgb: string): string =>
  `#${(rgb.match(/\d+/g) ?? []).map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;

/** What the Graph Builder preview draws for `e`, per series. */
export function gradientScreenOf(e: EncodedSpec): GradientScreen {
  const cols = gradientColumns(e.gradient!, e.styles);
  const [x, ...ys] = e.payload.data as (number | null)[][];
  return {
    legend: e.legend.map((l) => l.label),
    markers: e.styles.map((st) => (st.marker ? (st.markerShape ?? "circle") : "circle")),
    points: ys.map((col, i) =>
      col.flatMap((y, r) => {
        const fill = x[r] != null && y != null ? colorScatterFill(cols.get(i + 1)!, r) : null;
        return fill === null ? [] : [rgbToHex(fill)];
      }),
    ),
    colorbar: { label: e.gradient!.label, lo: e.gradient!.lo, hi: e.gradient!.hi },
    stops: gradientStops(),
  };
}
