// P2.8 review round 7, finding 3 (coverage gap flagged by round 7's own
// review record, not a code defect): `useMapPaint.ts`'s render-time reset
// (~lines 103-107) sets THIS instance's own `painted` back to `undefined`
// the moment its `dsId` changes — synchronously, in the render phase, before
// the following paint effect can run — so a continuously-mounted `MapStage`
// never shows a hint left over from the PREVIOUS dataset under the NEW
// dataset's name.
//
// The review record explicitly warns off a naive DOM reproduction: a real,
// pre-existing, UNRELATED race in `MapStage.tsx`'s own async payload fetch
// (its `useEffect` does not clear `payload` on a dataset switch — the stale
// payload from the OLD dataset is what the reset is defending against in the
// first place) produces its own transient value at the same instant even
// with this fix present, so a synchronous DOM assertion is not a reliable
// test point. This file pins the hook directly instead, at the one
// deterministic layer: real (detached, reused-across-renders) host/canvas
// elements so the paint effect's `!host || !canvas` guard never confounds
// the result, a controlled `draw` mock (`./mapRender`, `MapSliceOverlay.
// test.tsx`'s `importOriginal` pattern) so the painted VALUE is exactly
// what the test says it is, and — the deterministic trick — a `payload`
// prop the test drives itself and deliberately leaves unresolved (`null`)
// across the switch, exactly mirroring the real stale-fetch window: the
// paint effect's own `if (payload) setPainted(...)` guard (mapRender.ts's
// caller, `useMapPaint.ts:129`) then never fires to mask the reset, so
// whatever `painted` reads back is attributable to the reset alone.

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import { useMapPaint, type MapPaintArgs } from "./useMapPaint";

let drawReturn: readonly [number, number] | null = null;

vi.mock("./mapRender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mapRender")>();
  return {
    ...actual,
    draw: vi.fn(() => drawReturn),
  };
});

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function payload(): MapPayload {
  return {
    xAxis: [0, 1],
    yAxis: [0, 1],
    zGrid: [
      [1, 2],
      [3, 4],
    ],
    xLabel: "X",
    xUnit: "",
    yLabel: "Y",
    yUnit: "",
    zLabel: "Z",
    zUnit: "",
    zMin: 1,
    zMax: 4,
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  drawReturn = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMapPaint — the render-time reset on a dataset switch (P2.8 round 7, finding 3)", () => {
  it("clears THIS instance's painted pair synchronously the moment dsId changes, before any new paint can land", () => {
    // The same host/canvas pair across both renders — a continuously-mounted
    // instance, exactly the scenario the header describes (never remounted
    // between the two dsId values).
    const hostRef = { current: document.createElement("div") };
    const canvasRef = { current: document.createElement("canvas") };
    const baseArgs: Omit<MapPaintArgs, "dsId" | "payload"> = {
      hostRef,
      canvasRef,
      cmap: "viridis",
      logZ: false,
      colorLimits: null,
      rsmPeaks: null,
      antialias: false,
      contour: { on: false, levelCount: 5, scale: "linear" },
      theme: "dark",
      accent: "#000",
      reportToStore: false,
    };

    drawReturn = [10, 20];
    const { result, rerender } = renderHook<
      ReturnType<typeof useMapPaint>,
      { dsId: string | null; payload: MapPayload | null }
    >((props) => useMapPaint({ ...baseArgs, ...props }), {
      initialProps: { dsId: "ds-a", payload: payload() },
    });

    // Establishes a real, non-undefined committed pair for ds-a first — the
    // reset would be untestable against an initial `undefined` alone.
    expect(result.current.painted).toEqual([10, 20]);

    // Switch datasets. `payload` is deliberately left `null` — mirroring the
    // real stale-fetch window `MapStage.tsx` leaves before the new dataset's
    // regrid resolves — so the paint effect's own `if (payload)` guard
    // cannot mask the reset by writing a fresh value over it.
    drawReturn = [99, 199]; // would be wrongly attributed to ds-a's old value if never called
    rerender({ dsId: "ds-b", payload: null });

    expect(result.current.painted).toBeUndefined();
  });

  it("does not reset when dsId is unchanged — only a genuine switch clears it", () => {
    const hostRef = { current: document.createElement("div") };
    const canvasRef = { current: document.createElement("canvas") };
    const baseArgs: Omit<MapPaintArgs, "dsId" | "payload"> = {
      hostRef,
      canvasRef,
      cmap: "viridis",
      logZ: false,
      colorLimits: null,
      rsmPeaks: null,
      antialias: false,
      contour: { on: false, levelCount: 5, scale: "linear" },
      theme: "dark",
      accent: "#000",
      reportToStore: false,
    };

    drawReturn = [10, 20];
    const { result, rerender } = renderHook<
      ReturnType<typeof useMapPaint>,
      { dsId: string | null; payload: MapPayload | null }
    >((props) => useMapPaint({ ...baseArgs, ...props }), {
      initialProps: { dsId: "ds-a", payload: payload() },
    });
    expect(result.current.painted).toEqual([10, 20]);

    // A re-render that changes something OTHER than dsId (a colormap swap,
    // say) must not clear the pair.
    rerender({ dsId: "ds-a", payload: null });
    expect(result.current.painted).toEqual([10, 20]);
  });
});
