// P3.3: the CANVAS half of the parity gate. `exportStyles.test.ts` /
// `figureSpec.test.ts` pin that the export cycles for exactly one family of
// views; this pins that the Stage canvas refuses the SAME ones, which is the
// half that actually matters — a screen-only dash is what got FEATURE-001
// reverted (plans/BUGS_AND_ISSUES.md).

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useStageSeriesCycle } from "./useStageSeriesCycle";
import { useApp } from "../../store/useApp";

const reset = () =>
  useApp.setState({ autoSeriesStyles: false, facetKey: null, stackMode: false });

afterEach(reset);

describe("useStageSeriesCycle", () => {
  it("is null with the preference off — no cycle, and no array to churn deps", () => {
    reset();
    expect(renderHook(() => useStageSeriesCycle(null, 3)).result.current).toBeNull();
  });

  it("is plain display order for the single-panel overlay with the preference on", () => {
    useApp.setState({ autoSeriesStyles: true, facetKey: null, stackMode: false });
    expect(renderHook(() => useStageSeriesCycle(null, 3)).result.current).toEqual([0, 1, 2]);
  });

  it.each([
    ["grouped", { groupKey: 4 as number | null }, {}],
    ["faceted", { groupKey: null }, { facetKey: 0 }],
    ["stacked", { groupKey: null }, { stackMode: true }],
  ])("refuses to cycle a %s view — its export cannot reproduce one", (_n, arg, state) => {
    useApp.setState({ autoSeriesStyles: true, facetKey: null, stackMode: false, ...state });
    expect(renderHook(() => useStageSeriesCycle(arg.groupKey, 3)).result.current).toBeNull();
  });

  it("stops at the plotted count, so appended overlays are not cycled", () => {
    // `payload.series` also carries the fit / baseline / peak / derivative
    // overlays; no export draws them, so their positions must not exist.
    useApp.setState({ autoSeriesStyles: true });
    expect(renderHook(() => useStageSeriesCycle(null, 2)).result.current).toEqual([0, 1]);
  });

  it("keeps a STABLE reference across re-renders (PlotViewport rebuilds on it)", () => {
    useApp.setState({ autoSeriesStyles: true });
    const { result, rerender } = renderHook(() => useStageSeriesCycle(null, 3));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
