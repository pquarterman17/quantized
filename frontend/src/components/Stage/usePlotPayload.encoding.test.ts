// P1.4 (PRIMARY_SOFTWARE_AUDIT_PLAN): the editable Stage draws a window's
// Color-by / Symbol-by / legend-label source — end to end through the REAL
// usePlotPayload pipeline (fetchPlot's offline fallback, no mocks; the lazy
// lib/plotEncoding import resolves for real), against the SAME committed wire
// fixture the Graph Builder preview and the backend SVG are pinned to
// (tests/fixtures/wire/graph_encoding_export.json's `screen`). So: Stage ==
// preview == export, series for series — colour, glyph and legend text.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveToHex } from "../../lib/color";
import { encodeSpec, specFigureEncoding } from "../../lib/plotEncoding";
import { markSeriesStyle, type PlotSpec } from "../../lib/plotspec";
import { SERIES_VARS, seriesColor } from "../../lib/seriesStyleCycle";
import type { Dataset, DataStruct, SeriesStyle } from "../../lib/types";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(here, "../../../../tests/fixtures/wire/graph_encoding_export.json"), "utf-8"),
) as { screen: { legend: string[]; colors: string[]; markers: (string | null)[] } };

const PALETTE = ["#0b6e4f", "#c3423f", "#2d3047", "#f2a541", "#5e548e", "#1b998b", "#e84855", "#3e2f5b"];

// The fixture's dataset (lib/plotEncodingExport.test.ts builds the fixture from
// this exact table; the wire copy cannot be reused — JSON turns NaN into null).
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
  zones: { x: null, y: [ref(0)], group: null, facet: null, yErr: [], xErr: null, color: ref(1), symbol: ref(2), label: ref(3) },
  mark: "scatter",
};
// What the Graph Builder's apply leaves on the Stage: the mark's style on the
// Y channel (useGraphBuilder.commitToPlot) and the picks on the document.
const MARK_STYLES: Record<number, SeriesStyle> = { 0: markSeriesStyle(SPEC) };
const ENCODING = specFigureEncoding(SPEC)!;
const NO_LABELS: Record<number, string> = {};

const root = document.documentElement;
beforeEach(() => PALETTE.forEach((c, i) => root.style.setProperty(SERIES_VARS[i], c)));
afterEach(() => SERIES_VARS.forEach((v) => root.style.removeProperty(v)));

function params(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: DS,
    yScale: "linear",
    xScale: "linear",
    xKey: null,
    yKeys: [0],
    groupKey: null,
    y2Keys: null,
    seriesOrder: null,
    seriesStyles: MARK_STYLES,
    seriesLabels: NO_LABELS,
    errKeys: {},
    hiddenChannels: [],
    waterfall: 0,
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
    xLim: null,
    encoding: ENCODING,
    ...overrides,
  };
}

async function renderEncoded(p: PlotPayloadParams, series: number) {
  const hook = renderHook((q: PlotPayloadParams) => usePlotPayload(q), { initialProps: p });
  // Wait on STATE: the lazy derivation has loaded AND the re-fetch has split.
  await waitFor(() => expect(hook.result.current.displayPayload?.series).toHaveLength(series));
  return hook;
}

describe("usePlotPayload — P1.4 encodings on the editable Stage", () => {
  it("draws the fixture's screen series for series: colour by level, glyph by level, legend text", async () => {
    const { result } = await renderEncoded(params(), 6);
    const r = result.current;
    expect(r.labelList).toEqual(FIXTURE.screen.legend);
    expect(r.legendLabels).toEqual(FIXTURE.screen.legend); // the DOM legend lists the same text
    expect(r.styleList!.map((st, i) => resolveToHex(seriesColor(i, st)))).toEqual(FIXTURE.screen.colors);
    expect(r.styleList!.map((st) => (st?.marker ? (st.markerShape ?? "circle") : null))).toEqual(
      FIXTURE.screen.markers,
    );
    // Edit-all identity: every split series maps back to its Y channel.
    expect(r.plotted).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("draws the preview's own columns — one derivation, not a second", async () => {
    const { result } = await renderEncoded(params(), 6);
    const preview = encodeSpec(SPEC, [DS])!;
    expect(result.current.displayPayload!.data).toEqual(preview.payload.data);
    expect(result.current.displayPayload!.series).toEqual(preview.payload.series);
  });

  it("a channel rename replaces the Y name inside every split name (BUG-014's y_legends, as exported)", async () => {
    const colourOnly = { color: 1 };
    const { result } = await renderEncoded(params({ encoding: colourOnly, seriesLabels: { 0: "R" } }), 3);
    expect(result.current.labelList).toEqual([
      "R (sample=S3) (Ohm)",
      "R (sample=S1) (Ohm)",
      "R (sample=S2) (Ohm)",
    ]);
  });

  it("a colour factor overrides the channel's own colour; without one the channel colour holds", async () => {
    const red = { 0: { ...MARK_STYLES[0], color: "#ff0000" } };
    const byColour = await renderEncoded(params({ encoding: { color: 1 }, seriesStyles: red }), 3);
    expect(byColour.result.current.styleList!.map((s) => s?.color)).toEqual(["--series-1", "--series-2", "--series-3"]);
    const bySymbol = await renderEncoded(params({ encoding: { symbol: 2 }, seriesStyles: red }), 2);
    expect(bySymbol.result.current.styleList!.map((s) => s?.color)).toEqual(["#ff0000", "#ff0000"]);
  });

  it("a bound secondary axis turns the encoding off, exactly like the group split", async () => {
    const { result } = renderHook((q: PlotPayloadParams) => usePlotPayload(q), {
      initialProps: params({ yKeys: [0, 3], y2Keys: [3] }),
    });
    await waitFor(() => expect(result.current.displayPayload?.series).toHaveLength(2));
    expect(result.current.plotted).toEqual([0, 3]);
    expect(result.current.legendLabels).toBeUndefined();
  });

  it("never staggers or offsets an encoded render (the export sends neither)", async () => {
    const flat = await renderEncoded(params(), 6);
    const staggered = await renderEncoded(params({ waterfall: 0.5 }), 6);
    expect(staggered.result.current.displayPayload!.data).toEqual(flat.result.current.displayPayload!.data);
    const offset = { 0: { ...MARK_STYLES[0], logOffset: 2 } };
    const logged = await renderEncoded(params({ seriesStyles: offset }), 6);
    expect(logged.result.current.displayPayload!.data).toEqual(flat.result.current.displayPayload!.data);
  });

  it("keeps the error bars for a legend-source-only encoding and drops them once a factor splits", async () => {
    const withErr: Dataset = {
      ...DS,
      data: { ...DATA, labels: [...DATA.labels, "dR"], units: [...DATA.units, "Ohm"], values: DATA.values.map((row) => [...row, 0.1]) },
    };
    const errKeys = { 0: 4 };
    const labelOnly = await renderEncoded(params({ active: withErr, encoding: { label: 3 }, errKeys }), 1);
    expect(labelOnly.result.current.errorBars.size).toBe(1);
    expect(labelOnly.result.current.labelList).toEqual(["10 K … 300 K (4 values)"]);
    const split = await renderEncoded(params({ active: withErr, encoding: { color: 1 }, errKeys }), 3);
    expect(split.result.current.errorBars.size).toBe(0);
  });

  it("a continuous Color pick is ignored at render time (the gate), not re-interpreted", async () => {
    const { result } = renderHook((q: PlotPayloadParams) => usePlotPayload(q), {
      initialProps: params({ encoding: { color: 0 } }),
    });
    await waitFor(() => expect(result.current.displayPayload?.series).toHaveLength(1));
    expect(result.current.legendLabels).toBeUndefined();
    expect(result.current.displayPayload!.series[0].label).toBe("Rxy");
  });
});
