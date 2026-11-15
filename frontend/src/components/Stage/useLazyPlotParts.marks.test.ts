// The marks chunk's arrival re-renders the stage in the same commit that flips "pending" to false; the
// rebuild it asked for must still happen (live-check regression: the stack panels stayed blank).
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { marks, marksPending, useMarksVersion } from "../../lib/marksLoader";
import { plotDecorNeeds, useLazyPlotParts } from "./useLazyPlotParts";

describe("useLazyPlotParts + the marks chunk", () => {
  it("asks for the rebuild even though pending flips false in the arrival's own render", async () => {
    expect(marksPending()).toBe(true);
    let ready = 0;
    const onReady = () => { ready++; };
    const needs = plotDecorNeeds([], null, null, 0, [{ connect: "spline" }]);
    // The component also subscribes to the arrival (as usePlotPayload does), so it re-renders when the chunk lands.
    const { rerender } = renderHook(() => {
      useMarksVersion();
      useLazyPlotParts([], "zoom", onReady, needs);
    });
    await vi.waitFor(() => expect(marks()).not.toBeNull());
    rerender();
    await vi.waitFor(() => expect(ready).toBe(1));
  });
});
