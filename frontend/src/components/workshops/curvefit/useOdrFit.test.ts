// Curve Fit ODR hook: posts the X errors (and Y errors when the channel has
// them) over the fitted rows, and draws the fitted line as the fit overlay.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { odrFit, type OdrResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useOdrFit } from "./useOdrFit";
import { xErrorChannel } from "./xErrorChannel";

vi.mock("../../../lib/api/fitStats", () => ({ odrFit: vi.fn() }));

// col0 x, col1 its (signed) error, col2 y with a gap row, col3 y error.
const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [
      [1, 0.1, 3, 0.2],
      [2, -0.1, Number.NaN, 0.2],
      [3, -0.2, 7, 0.3],
      [4, 0.1, 9, 0.2],
    ],
    labels: ["x", "ex", "y", "ey"],
    units: ["", "", "", ""],
    metadata: {},
  },
  errorRoles: [
    { channel: 1, target: -1, axis: "x", side: "both" },
    { channel: 3, target: 2, axis: "y", side: "both" },
  ],
};

const FIT: OdrResult = { slope: 2, intercept: 1, slopeErr: 0.1, interceptErr: 0.2, lambda: 2, rss: 0.1, rmse: 0.1, n: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(odrFit).mockResolvedValue(FIT);
  useApp.setState({
    datasets: [DS],
    activeId: "d1",
    xKey: 0,
    yKeys: [2],
    seriesOrder: null,
    errKeys: { 2: 3 },
    fitOverlay: null,
  });
});

describe("xErrorChannel", () => {
  it("finds the designated X-error column, or none", () => {
    expect(xErrorChannel(DS)).toBe(1);
    expect(xErrorChannel({ ...DS, errorRoles: [] })).toBeNull();
    expect(xErrorChannel(null)).toBeNull();
  });
});

describe("useOdrFit", () => {
  it("posts |x error| and y error over the kept rows and overlays the line", async () => {
    const { result } = renderHook(() => useOdrFit());
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.result).toEqual(FIT));
    expect(vi.mocked(odrFit).mock.calls[0]![0]).toEqual({
      x: [1, 3, 4],
      y: [3, 7, 9],
      x_error: [0.1, 0.2, 0.1],
      y_error: [0.2, 0.3, 0.2],
    });
    expect(result.current.usedYErr).toBe(true);
    const overlay = useApp.getState().fitOverlay;
    expect(overlay?.datasetId).toBe("d1");
    // The gap row stays a gap; the rest is slope*x + intercept.
    expect(overlay?.y[0]).toBe(3);
    expect(Number.isNaN(overlay?.y[1] as number)).toBe(true);
    expect(overlay?.y.slice(2)).toEqual([7, 9]);
  });

  it("falls back to equal errors when the channel has no Y-error column", async () => {
    useApp.setState({ errKeys: {} });
    const { result } = renderHook(() => useOdrFit());
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.result).toEqual(FIT));
    expect(vi.mocked(odrFit).mock.calls[0]![0]).not.toHaveProperty("y_error");
    expect(result.current.usedYErr).toBe(false);
  });

  it("refuses a zero X error without calling the route", async () => {
    const zero = structuredClone(DS);
    zero.data.values[0]![1] = 0;
    useApp.setState({ datasets: [zero] });
    const { result } = renderHook(() => useOdrFit());
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.error).toMatch(/non-positive/));
    expect(odrFit).not.toHaveBeenCalled();
  });
});
