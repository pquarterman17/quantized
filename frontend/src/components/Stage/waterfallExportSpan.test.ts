// BUG-013 review round, finding 2: the export's waterfall stagger must be
// resolved from what the user SAW, and what the user saw is the FETCHED payload
// — not the DataStruct. A committed zoom on a server-decimated dataset makes
// `usePlotPayload` re-fetch just the visible x-window (`routes/plot.py` windows
// before it decimates), so a large excursion outside that window is in the
// DataStruct and NOT in the payload the canvas measured its span from.
//
// This drives the REAL hook with `fetchPlot` mocked at the network boundary
// (the pattern `usePlotPayload.test.ts` already uses), composes the publish
// effect exactly as `PlotStage` does, then asks BOTH export entry points for
// their offsets — the live-view fallback (`buildFigureSpec` via
// `buildStageFigureSpec` with no focused document) and the canonical-document
// path (`buildFigureSpecFromDocument`, likewise through
// `buildStageFigureSpec`). The screen's shift and the wire's offset must be the
// same number on both.

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildStageFigureSpec } from "../../lib/figureSpec";
import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView } from "../../lib/plotview";
import { buildColumns, type PlotPayload } from "../../lib/plotdata";
import { publishLiveWaterfallSpan } from "../../lib/waterfallOffset";
import type { Dataset, DataStruct } from "../../lib/types";
import { useLiveSnapshotPublish } from "./useLiveSnapshotPublish";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const fetchPlotMock = vi.fn();
vi.mock("../../lib/plotdata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/plotdata")>()),
  fetchPlot: (...args: unknown[]) => fetchPlotMock(...args),
}));

const N = 20_000;
const WINDOW: [number, number] = [5000, 6000];
const FRACTION = 0.25;

/** Two channels over 20 000 rows. Rows [0,100) carry a large excursion (up to
 *  1981) and everything from row 100 on sits in a narrow band (range 1), so the
 *  FULL y-range and the range inside `WINDOW` differ by three orders of
 *  magnitude — exactly the shape that made the screen and the wire disagree. */
const DATA: DataStruct = {
  time: Array.from({ length: N }, (_, i) => i),
  values: Array.from({ length: N }, (_, i) => (i < 100 ? [i * 20, i * 20 + 1] : [0, 1])),
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};
const DATASET: Dataset = { id: "d1", name: "big.csv", data: DATA };

/** The payload a fetch returns: every row, or only the rows inside `window`. */
function payload(window: [number, number] | null): PlotPayload {
  const rows = window
    ? DATA.values.filter((_r, i) => DATA.time[i] >= window[0] && DATA.time[i] <= window[1])
    : DATA.values;
  const time = DATA.time.filter((t) => !window || (t >= window[0] && t <= window[1]));
  const cols = buildColumns({ ...DATA, time, values: rows }, null, null, [0, 1]);
  return { ...cols, decimated: true, window };
}

const EMPTY_STYLES: PlotPayloadParams["seriesStyles"] = {};
const EMPTY_LABELS: PlotPayloadParams["seriesLabels"] = {};
const EMPTY_ERR_KEYS: PlotPayloadParams["errKeys"] = {};
const EMPTY_HIDDEN: PlotPayloadParams["hiddenChannels"] = [];

function params(xLim: [number, number] | null): PlotPayloadParams {
  return {
    active: DATASET,
    yScale: "linear",
    xScale: "linear",
    xKey: null,
    yKeys: null,
    groupKey: null,
    y2Keys: null,
    seriesOrder: null,
    seriesStyles: EMPTY_STYLES,
    seriesLabels: EMPTY_LABELS,
    errKeys: EMPTY_ERR_KEYS,
    hiddenChannels: EMPTY_HIDDEN,
    waterfall: FRACTION,
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
    xLim,
  };
}

/** `PlotStage`'s own composition: the payload hook, then the publish effect
 *  fed from its result — including the RAW payload the span is measured from. */
function useStageLike(p: PlotPayloadParams) {
  const r = usePlotPayload(p);
  useLiveSnapshotPublish({
    active: DATASET,
    polarMode: false,
    statMode: false,
    stackMode: false,
    plottedCount: r.plotted.length,
    composition: null,
    payload: r.payload,
    displayPayload: r.displayPayload,
    styleList: r.styleList,
    labelList: r.labelList,
    errorBars: r.errorBars,
    plotted: r.plotted,
    colorByColumns: r.colorByColumns,
    hidden: r.hidden,
    seriesCycle: null,
  });
  return r;
}

const VIEW = { ...defaultPlotView(), xKey: null, yKeys: [0, 1], waterfall: FRACTION, xLim: WINDOW };
const OPTS = { fmt: "pdf", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };

/** A `StoreGet` carrying the same view. `focused` routes `buildStageFigureSpec`
 *  through the canonical-document adapter; without it, through the live-view
 *  fallback. */
function stage(withDocument: boolean) {
  const document = createFigureDocument({
    id: "w1",
    name: "Waterfall",
    datasetId: DATASET.id,
    view: VIEW,
  });
  const state = {
    ...VIEW,
    autoSeriesStyles: false,
    focusedWindowId: withDocument ? "w1" : null,
    windowsForSave: () => (withDocument ? [{ id: "w1", kind: "plot", document }] : []),
  };
  return (() => state) as never;
}

/** The stagger the SCREEN applied to display series 1: the difference between
 *  the composed payload's second value column and the raw one. */
function screenShift(display: PlotPayload | null, raw: PlotPayload | null): number {
  const a = (display?.data as unknown as (number | null)[][])[2];
  const b = (raw?.data as unknown as (number | null)[][])[2];
  return (a[0] as number) - (b[0] as number);
}

beforeEach(() => fetchPlotMock.mockReset());
afterEach(() => publishLiveWaterfallSpan(null));

describe("waterfall export parity across a windowed re-fetch (BUG-013 finding 2)", () => {
  it.each([
    ["the live-view fallback", false],
    ["the canonical-document path", true],
  ])("screen shift === export offset through %s", async (_name, withDocument) => {
    fetchPlotMock.mockResolvedValueOnce(payload(null));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => useStageLike(p), {
      initialProps: params(null),
    });
    await waitFor(() => expect(result.current.payload?.data[0].length).toBe(N));

    // Commit the zoom: the hook re-fetches just [5000, 6000].
    fetchPlotMock.mockResolvedValueOnce(payload(WINDOW));
    rerender(params(WINDOW));
    await waitFor(() => expect(result.current.payload?.window).toEqual(WINDOW));

    const shift = screenShift(result.current.displayPayload, payload(WINDOW));
    // Non-vacuous on both counts: the windowed stagger is real, and it is
    // nothing like the full-dataset one (0.25 vs 495.25, a factor of 1981 —
    // the divergence the review measured).
    expect(shift).toBeCloseTo(0.25, 12);

    const spec = buildStageFigureSpec(stage(withDocument), DATASET, "big", OPTS);
    expect(spec.waterfall_offsets?.[1]).toBeCloseTo(shift, 12);
  });

  it("with no canvas on screen the wire falls back to the full dataset", () => {
    // Nothing published (no Plot tab mounted): the export still carries a
    // stagger, resolved the only way it can be — over every row: the full
    // y-range is 1981 - 0, and 0.25 of it is 495.25.
    const spec = buildStageFigureSpec(stage(false), DATASET, "big", OPTS);
    expect(spec.waterfall_offsets?.[1]).toBeCloseTo(495.25, 12);
  });
});
