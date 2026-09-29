// Perf audit 2026-09-29: the base fetch must be keyed on what the REQUEST
// actually contains (the dataset's `data`, its channel roles/types, the
// channels, the scales) plus ONE primitive decimation-eligibility boolean --
// never on display-only inputs. Before the fix, a series colour change, a
// selection change, a dataset rename, and an exclusion toggle each cost a
// full `/api/plot/series` round trip plus a new displayPayload. `fetchPlot`
// is mocked (network boundary only); every other plotdata export stays real.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const fetchPlotMock = vi.fn();
vi.mock("../../lib/plotdata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/plotdata")>()),
  fetchPlot: (...args: unknown[]) => fetchPlotMock(...args),
}));

function makeDataset(n: number): Dataset {
  return {
    id: "d1",
    name: "ds",
    data: {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [Math.sin(i), Math.cos(i)]),
      labels: ["A", "B"],
      units: ["", ""],
      metadata: {},
    },
  };
}

const SMALL = makeDataset(100);
const BIG = makeDataset(20_000); // above DECIMATE_MIN_POINTS
const STYLES: PlotPayloadParams["seriesStyles"] = {};
const LABELS: PlotPayloadParams["seriesLabels"] = {};
const ERR: PlotPayloadParams["errKeys"] = {};
const HIDDEN: PlotPayloadParams["hiddenChannels"] = [];

function params(o: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: SMALL, yScale: "linear", xScale: "linear", xKey: null, yKeys: null, groupKey: null,
    y2Keys: null, seriesOrder: null, seriesStyles: STYLES, seriesLabels: LABELS, errKeys: ERR,
    hiddenChannels: HIDDEN, waterfall: 0, excludedDisplay: "hide", fitOverlay: null,
    baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null, xLim: null, ...o,
  };
}

const PAYLOAD: PlotPayload = {
  data: [
    [0, 1, 2],
    [1, 2, 3],
    [3, 2, 1],
  ] as PlotPayload["data"],
  series: [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
  ],
  xLabel: "x",
  xUnit: "",
};

async function mount(initial: PlotPayloadParams) {
  const hook = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: initial });
  await waitFor(() => expect(hook.result.current.displayPayload).not.toBeNull());
  expect(fetchPlotMock).toHaveBeenCalledTimes(1);
  return hook;
}

/** The 7th positional arg of `fetchPlot` is `decimateWidth` (null = full-res). */
const decimateWidthOf = (call: number) => (fetchPlotMock.mock.calls[call] as unknown[])[6];

beforeEach(() => {
  fetchPlotMock.mockReset();
  fetchPlotMock.mockResolvedValue(PAYLOAD);
});

describe("usePlotPayload — display-only edits never refetch", () => {
  it("a series colour change neither refetches nor replaces displayPayload", async () => {
    const { result, rerender } = await mount(params());
    const before = result.current.displayPayload;
    rerender(params({ seriesStyles: { 0: { color: "#ff0000" } } }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);
    expect(result.current.displayPayload).toBe(before);
    expect(result.current.styleList?.[0]?.color).toBe("#ff0000");
  });

  it("renaming the dataset (new object, same data) neither refetches nor replaces displayPayload", async () => {
    const { result, rerender } = await mount(params());
    const before = result.current.displayPayload;
    rerender(params({ active: { ...SMALL, name: "renamed" } }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);
    expect(result.current.displayPayload).toBe(before);
  });

  it("a legend rename or colour change on a BIG (decimation-eligible) dataset does not refetch", async () => {
    const { rerender } = await mount(params({ active: BIG }));
    rerender(params({ active: BIG, seriesStyles: { 1: { color: "#00ff00" } } }));
    rerender(params({ active: BIG, seriesStyles: { 1: { color: "#00ff00" } }, seriesLabels: { 0: "renamed" } }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);
  });

  it("selection changes on a small dataset do not refetch (eligibility is already full-res)", async () => {
    const { rerender } = await mount(params());
    rerender(params({ selection: { datasetId: "d1", rows: [1, 2, 3] } }));
    rerender(params({ selection: { datasetId: "d1", rows: [1, 2, 3, 4] } }));
    rerender(params({ selection: null }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);
  });

  it("an exclusion toggle under 'hide' does not refetch (exclusion is client-side, not in the request)", async () => {
    const { rerender } = await mount(params({ active: BIG }));
    rerender(params({ active: { ...BIG, excludedRows: [5] } }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);
  });
});

describe("usePlotPayload — edits that DO change the request still refetch", () => {
  it("a data edit (new `data` object) refetches with the new data", async () => {
    const { rerender } = await mount(params());
    const edited: Dataset = { ...SMALL, data: { ...SMALL.data, time: SMALL.data.time.map((t) => t * 2) } };
    rerender(params({ active: edited }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2);
    expect((fetchPlotMock.mock.calls[1] as unknown[])[0]).toBe(edited.data);
  });

  it("a channel-role edit that changes the plotted channels refetches", async () => {
    const { rerender } = await mount(params());
    rerender(params({ active: { ...SMALL, channelRoles: { 1: "ignore" } } }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2);
  });

  it("a first selection on a BIG dataset flips eligibility and refetches at full resolution — once", async () => {
    const { rerender } = await mount(params({ active: BIG }));
    expect(decimateWidthOf(0)).not.toBeNull();
    rerender(params({ active: BIG, selection: { datasetId: "d1", rows: [1] } }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2);
    expect(decimateWidthOf(1)).toBeNull();
    // Growing the selection keeps eligibility false: no further round trip.
    rerender(params({ active: BIG, selection: { datasetId: "d1", rows: [1, 2] } }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2);
  });

  it("an exclusion toggle under 'grey' on a BIG dataset refetches at full resolution", async () => {
    const { rerender } = await mount(params({ active: BIG, excludedDisplay: "grey" }));
    expect(decimateWidthOf(0)).not.toBeNull();
    rerender(params({ active: { ...BIG, excludedRows: [5] }, excludedDisplay: "grey" }));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2);
    expect(decimateWidthOf(1)).toBeNull();
  });
});
