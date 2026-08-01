// P3.4 zoom-refetch residual: a committed zoom/pan on a server-decimated
// payload should re-fetch just the visible window at full local detail (see
// usePlotPayload.ts's own header comment for the mechanism). `fetchPlot` is
// mocked (via the `importOriginal` partial-mock pattern already used
// elsewhere in this codebase) so every OTHER export of lib/plotdata.ts —
// composeDisplayPayload, categoricalXPayload, effectiveChannels, … — stays
// real; only the network boundary is faked.

import { act, renderHook, waitFor } from "@testing-library/react";
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
    name: "big",
    data: {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [Math.sin(i)]),
      labels: ["A"],
      units: [""],
      metadata: {},
    },
  };
}

// STABLE default references, built ONCE. `active`, `errKeys`, and
// `seriesStyles` all feed dependencies of the BASE fetch effect (`active`
// directly; `errKeys`/`seriesStyles` via the `errorBars`/`colorByColumns`
// `useMemo`s, which the effect depends on) — a helper minting a fresh `{}`
// per call would change those references on every `rerender` and trigger a
// spurious base re-fetch alongside whatever the test actually meant to
// exercise (xLim alone). In the real app these come from Zustand selectors,
// which are already reference-stable across renders; this mirrors that.
const DATASET = makeDataset(20_000);
const EMPTY_STYLES: PlotPayloadParams["seriesStyles"] = {};
const EMPTY_LABELS: PlotPayloadParams["seriesLabels"] = {};
const EMPTY_ERR_KEYS: PlotPayloadParams["errKeys"] = {};
const EMPTY_HIDDEN: PlotPayloadParams["hiddenChannels"] = [];

function baseParams(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: DATASET,
    yScale: "linear",
    xScale: "linear",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    seriesOrder: null,
    seriesStyles: EMPTY_STYLES,
    seriesLabels: EMPTY_LABELS,
    errKeys: EMPTY_ERR_KEYS,
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

function payloadFor(label: string, decimated: boolean, window: [number, number] | null = null): PlotPayload {
  return {
    data: [
      [0, 1, 2],
      [1, 2, 3],
    ] as PlotPayload["data"],
    series: [{ label, unit: "" }],
    xLabel: "x",
    xUnit: "",
    decimated,
    window,
  };
}

beforeEach(() => {
  fetchPlotMock.mockReset();
});

describe("usePlotPayload — P3.4 zoom-refetch residual", () => {
  it("fires a windowed re-fetch when a committed zoom lands on a server-decimated base", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);

    fetchPlotMock.mockResolvedValueOnce(payloadFor("windowed", true, [1, 2]));
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("windowed"));

    expect(fetchPlotMock).toHaveBeenCalledTimes(2);
    const [, , , , , , , xMin, xMax] = fetchPlotMock.mock.calls[1] as unknown[];
    expect(xMin).toBe(1);
    expect(xMax).toBe(2);
  });

  it("does NOT re-fetch on a committed zoom when the base was not server-decimated", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("small", false));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("small"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(1);

    rerender(baseParams({ xLim: [1, 2] }));
    await act(async () => {}); // give any errant effect a tick to fire
    expect(fetchPlotMock).toHaveBeenCalledTimes(1); // still just the one base fetch
    expect(result.current.payload?.series[0].label).toBe("small"); // untouched
  });

  it("pan (a second, different committed window) re-fetches through the SAME path as zoom", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    fetchPlotMock.mockResolvedValueOnce(payloadFor("zoomed", true, [1, 2]));
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("zoomed"));

    // A pan commits a DIFFERENT window through the identical `xLim` prop —
    // no special-casing needed for it to trigger the same re-fetch.
    fetchPlotMock.mockResolvedValueOnce(payloadFor("panned", true, [2, 3]));
    rerender(baseParams({ xLim: [2, 3] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("panned"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(3);
  });

  it("reset to full view (xLim -> null) restores the cached base payload with NO extra fetch", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    fetchPlotMock.mockResolvedValueOnce(payloadFor("windowed", true, [1, 2]));
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("windowed"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2);

    rerender(baseParams({ xLim: null }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));
    expect(fetchPlotMock).toHaveBeenCalledTimes(2); // restored from the cached ref, no new call
  });

  it("a stale windowed response arriving after a reset never clobbers the restored full-range payload", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    // A windowed fetch that stays pending until resolved explicitly below —
    // simulates a slow response racing a subsequent reset.
    let resolveWindowed: ((v: PlotPayload) => void) | undefined;
    fetchPlotMock.mockImplementationOnce(
      () =>
        new Promise<PlotPayload>((resolve) => {
          resolveWindowed = resolve;
        }),
    );
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(fetchPlotMock).toHaveBeenCalledTimes(2));

    // The user resets to full view BEFORE the slow windowed response arrives.
    rerender(baseParams({ xLim: null }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    // The stale response finally resolves — it must be a no-op.
    await act(async () => {
      resolveWindowed?.(payloadFor("stale-windowed", true, [1, 2]));
    });
    expect(result.current.payload?.series[0].label).toBe("base"); // NOT clobbered
  });

  it("a stale windowed response superseded by a NEWER window commit never clobbers it either", async () => {
    fetchPlotMock.mockResolvedValueOnce(payloadFor("base", true));
    const { result, rerender } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("base"));

    let resolveFirstWindow: ((v: PlotPayload) => void) | undefined;
    fetchPlotMock.mockImplementationOnce(
      () =>
        new Promise<PlotPayload>((resolve) => {
          resolveFirstWindow = resolve;
        }),
    );
    rerender(baseParams({ xLim: [1, 2] }));
    await waitFor(() => expect(fetchPlotMock).toHaveBeenCalledTimes(2));

    // The user zooms again before the first windowed response lands.
    fetchPlotMock.mockResolvedValueOnce(payloadFor("second-window", true, [3, 4]));
    rerender(baseParams({ xLim: [3, 4] }));
    await waitFor(() => expect(result.current.payload?.series[0].label).toBe("second-window"));

    // The stale FIRST window's response finally resolves — must not undo it.
    await act(async () => {
      resolveFirstWindow?.(payloadFor("stale-first-window", true, [1, 2]));
    });
    expect(result.current.payload?.series[0].label).toBe("second-window");
  });
});
