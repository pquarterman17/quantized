// usePerSeriesX: the view changes only when the SET OF SHOWN X BLOCKS changes,
// and the canvas and the figure export derive the same blocks for one state.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { perSeriesXSpec } from "../../lib/figureSpecPerSeriesX";
import { shownCurves } from "../../lib/shownCurves";
import { R1, R2, T1, T2, t1r1t2r2 } from "../../test/ownXFixture";
import type { Dataset } from "../../lib/types";
import { usePerSeriesX } from "./usePerSeriesX";

const NO_OV = { fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null };
const plot = (over: Partial<{ yKeys: number[] | null; seriesOrder: number[] | null; hiddenChannels: number[] }> = {}) => ({
  yKeys: null, seriesOrder: null, hiddenChannels: [1], ...NO_OV, ...over,
});

// T1,R1,R1b,T2,R2: hiding R1b leaves T1 in use (R1 still shown).
const threeCurves = (): Dataset => ({
  id: "three",
  name: "three",
  data: {
    time: T1,
    values: T1.map((_, i) => [R1[i], R1[i] + 1, T2[i], R2[i]]),
    labels: ["R1", "R1b", "T2", "R2"],
    units: ["", "", "", ""],
    metadata: {},
  },
  columnDesignations: { 2: "X" },
});

describe("usePerSeriesX identity", () => {
  it("hiding a curve whose X block stays in use keeps active identity; hiding the last of a block changes it", () => {
    const ds = threeCurves();
    const { result, rerender } = renderHook(({ h }: { h: number[] }) => usePerSeriesX(ds, null, null, plot({ hiddenChannels: h })), {
      initialProps: { h: [2] },
    });
    const first = result.current.active;
    expect(first).not.toBe(ds);
    rerender({ h: [1, 2] }); // R1b hidden, R1 still on T1
    expect(result.current.active).toBe(first);
    rerender({ h: [0, 1, 2] }); // T1 block now unused: view is T2 alone
    expect(result.current.active).not.toBe(first);
    expect(result.current.active!.data.time).toEqual(T2);
    expect(result.current.blockRows).toBe(4);
  });
});

describe("canvas and export agree on the blocks", () => {
  it("same state (seriesOrder, hidden) gives the same X blocks", () => {
    const ds = t1r1t2r2();
    const state = { yKeys: [0, 2], xKey: null, seriesOrder: [2, 0], hiddenChannels: [] as number[] };
    expect(shownCurves(ds.data, state)).toEqual([2, 0]);
    const canvas = renderHook(() => usePerSeriesX(ds, null, null, { ...state, ...NO_OV })).result.current.active!;
    const [st, data] = perSeriesXSpec(
      { ...state, hiddenChannels: [] } as never,
      ds.data,
      undefined,
      { liveDataset: ds },
    );
    expect(st.xKey).toBeNull();
    expect(data.time).toEqual(canvas.data.time);
    expect(data.time).toEqual([...T1, ...T2]);
  });

  it("hidden curve: both drop the same block", () => {
    const ds = t1r1t2r2();
    const state = { yKeys: [0, 2], xKey: null, seriesOrder: null, hiddenChannels: [0] };
    const canvas = renderHook(() => usePerSeriesX(ds, null, null, { ...state, ...NO_OV })).result.current.active!;
    const [, data] = perSeriesXSpec(state as never, ds.data, undefined, { liveDataset: ds });
    expect(canvas.data.time).toEqual(T2);
    expect(data.time).toEqual(T2);
  });
});

describe("overlay placement cost", () => {
  it("a rename or an exclusion toggle returns the SAME placed overlay (nothing recomposes)", async () => {
    const ds = t1r1t2r2();
    const fitOverlay = { datasetId: "own", binding: { yKey: 2, xKey: 1 }, y: [7, 8, 9, 10] };
    const { result, rerender } = renderHook(({ d }: { d: Dataset }) => usePerSeriesX(d, null, null, { ...plot(), fitOverlay }), {
      initialProps: { d: ds },
    });
    // lib/overlayPlacement loads lazily: a multi-X view draws nothing until it is in
    expect(result.current.overlays.fitOverlay).toBeNull();
    await waitFor(() => expect(result.current.overlays.fitOverlay).not.toBeNull());
    const placed = result.current.overlays.fitOverlay;
    expect(placed?.y).toEqual([null, null, null, null, 7, 8, 9, 10]);
    rerender({ d: { ...ds, name: "renamed.csv" } });
    expect(result.current.overlays.fitOverlay).toBe(placed);
    rerender({ d: { ...ds, excludedRows: [2] } });
    expect(result.current.overlays.fitOverlay).toBe(placed);
  });
});

describe("overlay placement on a one-X sheet", () => {
  it("passes the overlay through synchronously, untouched, without loading the placement", () => {
    const ds = threeCurves();
    const one: Dataset = { ...ds, columnDesignations: {} };
    const fitOverlay = { datasetId: "three", binding: { yKey: 0, xKey: null }, y: [1, 2, 3, 4] };
    const { result } = renderHook(() => usePerSeriesX(one, null, null, { ...plot(), fitOverlay }));
    expect(result.current.overlays.fitOverlay).toBe(fitOverlay);
  });
});
