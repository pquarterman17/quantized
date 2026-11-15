// A baseline of R2 on a T1,R1,T2,R2 sheet is estimated against T2, not the
// plot's T1 (per-series X).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { baselineEstimate } from "../../../lib/api/baseline";
import { R2, T2, t1r1t2r2 } from "../../../test/ownXFixture";
import { useApp } from "../../../store/useApp";
import { useBaseline } from "./useBaseline";

vi.mock("../../../lib/api", () => ({ applyCorrections: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(), baselineAnchor: vi.fn(), baselineEstimate: vi.fn(), baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(), baselineRollingBall: vi.fn(), baselineShirley: vi.fn(), baselineXrdLowAngle: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [t1r1t2r2()], activeId: "own", status: "", baselineOverlay: null, baselineAnchorEdit: null,
    plotTool: "zoom", regionPicked: null, xKey: null, yKeys: [2], seriesOrder: null,
  });
});

describe("useBaseline on a secondary-X Y", () => {
  it("sends R2 with T2's values (acquisition order) and binds T2", async () => {
    vi.mocked(baselineEstimate).mockResolvedValue({ baseline: [0, 0, 0, 0] });
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("snip"));
    await act(async () => {
      await result.current.compute();
    });
    expect(baselineEstimate).toHaveBeenCalledWith({ x: T2, y: R2, method: "snip" });
    expect(result.current.binding).toMatchObject({ xKey: 1, xLabel: "T2", yKey: 2 });
  });
});
