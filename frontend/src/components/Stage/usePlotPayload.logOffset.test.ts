// P2.3 review findings 3/4/8 — decade offsets reach every canvas consumer
// this hook builds:
//   * finding 3 — error bars/spans built from the raw dataset scale by the
//     SAME `10^k` as the series they bracket;
//   * finding 4 — a fit overlay (no channel of its own; every producer fits
//     the first VISIBLE plotted channel) scales by that channel's offset;
//   * finding 8 — `displayPayload` is keyed on the DERIVED offsets vector,
//     not the whole `seriesStyles` map, so a colour-only edit does not
//     recompose it.
//
// Findings 3/4 run through the REAL pipeline (`fetchPlot` mocked to delegate
// to the real `buildColumns`, the same offline-fallback path
// `usePlotPayload.errorRoles.test.ts` already uses). Finding 8 needs the
// fetched payload's OWN object identity to stay stable across a rerender
// that changes nothing but a colour, so it pins `fetchPlot` to resolve the
// exact same payload object every call instead (xKey is null and there is
// no group split, so `categoricalXPayload`/`applyGroupSplit` both pass it
// through unchanged — verified by their own doc comments — and the mocked
// object survives untouched into `payload`).

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

// A, B (plotted) + errA (A's ± magnitude, bound via errKeys).
const ds: Dataset = {
  id: "d1",
  name: "compare",
  data: {
    time: [0, 1, 2],
    values: [
      [1, 100, 0.5],
      [2, 200, 1],
      [3, 300, 1.5],
    ],
    labels: ["A", "B", "errA"],
    units: ["c/s", "c/s", "c/s"],
    metadata: {},
  },
};

// Stable default references — a fresh `{}`/`[]` per call would change these
// props' identity on every `rerender` and confound the finding-8 identity
// check below with an UNRELATED effect re-run (mirrors the header comment in
// `usePlotPayload.test.ts`).
const ERR_KEYS: PlotPayloadParams["errKeys"] = { 0: 2 };
const EMPTY_HIDDEN: PlotPayloadParams["hiddenChannels"] = [];
const Y_KEYS: number[] = [0, 1];
const EMPTY_LABELS: PlotPayloadParams["seriesLabels"] = {};
const DEFAULT_STYLES: PlotPayloadParams["seriesStyles"] = { 0: { logOffset: 1 } }; // A offset by one decade (×10)

function params(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: ds,
    yScale: "log",
    xScale: "linear",
    xKey: null,
    yKeys: Y_KEYS,
    groupKey: null,
    y2Keys: null,
    seriesOrder: null,
    seriesStyles: DEFAULT_STYLES,
    seriesLabels: EMPTY_LABELS,
    errKeys: ERR_KEYS,
    hiddenChannels: EMPTY_HIDDEN,
    waterfall: 0,
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
    xLim: null,
    ...overrides,
  };
}

beforeEach(() => {
  fetchPlotMock.mockReset();
});

describe("usePlotPayload — decade offsets reach error bars/spans and overlays (findings 3-4)", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../../lib/plotdata")>("../../lib/plotdata");
    fetchPlotMock.mockImplementation(
      async (
        data: Parameters<typeof actual.buildColumns>[0],
        _yLog: boolean,
        _xLog: boolean,
        yKeys: number[] | null,
        y2Keys: number[] | null,
        xKey: number | null,
      ) => actual.buildColumns(data, y2Keys, xKey, yKeys),
    );
  });

  it("scales the offset channel's own error-bar magnitudes by the same 10^k", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params(),
    });
    await waitFor(() => expect(result.current.payload).not.toBeNull());
    // A (channel 0, uPlot column 1) is offset ×10: its error 0.5/1/1.5 scales
    // to 5/10/15. B (channel 1, column 2) carries no errKey at all.
    expect(result.current.errorBars.get(1)).toEqual([5, 10, 15]);
    expect(result.current.errorBars.has(2)).toBe(false);
    // The base series themselves: A's true values [1,2,3] drawn at ×10.
    const cols = result.current.displayPayload!.data as unknown as (number | null)[][];
    expect(cols[1]).toEqual([10, 20, 30]);
    expect(cols[2]).toEqual([100, 200, 300]); // B: un-offset
  });

  it("is a no-op for error bars when no offset applies (waterfall on)", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ waterfall: 0.2 }),
    });
    await waitFor(() => expect(result.current.payload).not.toBeNull());
    expect(result.current.errorBars.get(1)).toEqual([0.5, 1, 1.5]); // true magnitude, un-offset
  });

  it("scales a fit overlay by its parent series' (first visible plotted channel's) offset", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ fitOverlay: { datasetId: "d1", y: [100, 200, 300] } }),
    });
    await waitFor(() => expect(result.current.payload).not.toBeNull());
    const cols = result.current.displayPayload!.data as unknown as (number | null)[][];
    // x, A, B, fit -- the fit column is the 4th (index 3), scaled ×10 like A
    // (channel 0 is the first VISIBLE plotted channel it was fit against).
    expect(result.current.displayPayload!.series.map((s) => s.label)).toEqual(["A ×10^1", "B", "fit"]);
    expect(cols[3]).toEqual([1000, 2000, 3000]);
  });

  it("appends the offset disclosure to a RENAMED legend too (finding 6, canvas half)", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ seriesLabels: { 0: "Renamed A" } }),
    });
    await waitFor(() => expect(result.current.payload).not.toBeNull());
    // A is offset ×10^1 -- the rename must carry the SAME " ×10^1" suffix
    // the auto-derived label already gets (see logOffset.test.ts), or the
    // canvas would hide the offset on exactly the series a user renamed.
    expect(result.current.labelList?.[0]).toBe("Renamed A ×10^1");
    expect(result.current.labelList?.[1]).toBeUndefined(); // B: no rename, untouched
  });

  it("does not suffix a renamed legend when no offset applies to it", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ seriesLabels: { 1: "Renamed B" } }), // B carries no offset
    });
    await waitFor(() => expect(result.current.payload).not.toBeNull());
    expect(result.current.labelList?.[1]).toBe("Renamed B");
  });

  it("leaves a fit overlay untouched when its parent channel carries no offset", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({
        seriesStyles: { 1: { logOffset: 1 } }, // B offset, not A
        hiddenChannels: [0], // A hidden -> first VISIBLE plotted channel is B
        fitOverlay: { datasetId: "d1", y: [100, 200, 300] },
      }),
    });
    await waitFor(() => expect(result.current.payload).not.toBeNull());
    const cols = result.current.displayPayload!.data as unknown as (number | null)[][];
    expect(cols[3]).toEqual([1000, 2000, 3000]); // fit follows B (offset ×10) instead
  });
});

describe("usePlotPayload — displayPayload keys on the offsets vector, not the whole styles map (finding 8)", () => {
  const STABLE_PAYLOAD: PlotPayload = {
    data: [
      [0, 1, 2],
      [1, 2, 3],
      [100, 200, 300],
    ] as unknown as PlotPayload["data"],
    series: [{ label: "A", unit: "" }, { label: "B", unit: "" }],
    xLabel: "x",
    xUnit: "",
    decimated: false,
    window: null,
  };

  beforeEach(() => {
    fetchPlotMock.mockResolvedValue(STABLE_PAYLOAD); // the SAME object every call
  });

  it("does not recompose when an edit changes a colour but not any offset", async () => {
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params(),
    });
    await waitFor(() => expect(result.current.payload).toBe(STABLE_PAYLOAD));
    const before = result.current.displayPayload;

    // A NEW seriesStyles object (as every store update hands out), same
    // decade offsets, plus an unrelated colour on channel 1.
    rerender(params({ seriesStyles: { 0: { logOffset: 1 }, 1: { color: "#ff0000" } } }));
    expect(result.current.displayPayload).toBe(before); // identity-stable: not recomposed

    // An actual offset change DOES recompose.
    rerender(params({ seriesStyles: { 0: { logOffset: 2 }, 1: { color: "#ff0000" } } }));
    expect(result.current.displayPayload).not.toBe(before);
    const cols = result.current.displayPayload!.data as unknown as (number | null)[][];
    expect(cols[1]).toEqual([100, 200, 300]); // now ×100
  });
});
