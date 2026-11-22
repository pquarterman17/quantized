// ODR on the workbench shell (lane WB4): still a button (nothing runs on an
// edit), same request and overlay; the result is out of date when the plotted
// channels, error columns or rows it ran with change; a late answer for inputs
// that have since changed is dropped (forced with a held request).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { odrFit, type OdrResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useOdrFit } from "./useOdrFit";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";

vi.mock("../../../lib/api/fitStats", () => ({ odrFit: vi.fn() }));

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [[1, 0.1, 3, 0.2, 5], [2, -0.1, 4, 0.2, 6], [3, -0.2, 7, 0.3, 7], [4, 0.1, 9, 0.2, 8]],
    labels: ["x", "ex", "y", "ey", "y2"],
    units: ["", "", "", "", ""],
    metadata: {},
  },
  errorRoles: [
    { channel: 1, target: -1, axis: "x", side: "both" },
    { channel: 3, target: 2, axis: "y", side: "both" },
  ],
};
const FIT: OdrResult = { slope: 2, intercept: 1, slopeErr: 0.1, interceptErr: 0.2, lambda: 2, rss: 0.1, rmse: 0.1, n: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  vi.mocked(odrFit).mockResolvedValue(FIT);
  useApp.setState({
    datasets: [DS], activeId: "d1", xKey: 0, yKeys: [2], seriesOrder: null, errKeys: { 2: 3 }, fitOverlay: null,
  });
});

describe("useOdrFit on the workbench shell", () => {
  it("characterization: nothing runs on an edit; only run() fits, and a failure clears the result", async () => {
    const { result } = renderHook(() => useOdrFit());
    act(() => useApp.setState({ yKeys: [4] }));
    await act(async () => {});
    expect(odrFit).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
    await act(() => result.current.run());
    expect(result.current.result).toEqual(FIT);
    vi.mocked(odrFit).mockRejectedValueOnce(new Error("server down"));
    await act(() => result.current.run());
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBe("server down");
    expect(result.current.refusal).toBe(false);
  });

  it("a validation failure is a refusal, a backend failure is not", async () => {
    const zero = structuredClone(DS);
    zero.data.values[0]![1] = 0;
    useApp.setState({ datasets: [zero] });
    const { result } = renderHook(() => useOdrFit());
    await act(() => result.current.run());
    expect(result.current.error).toMatch(/non-positive/);
    expect(result.current.refusal).toBe(true);
  });

  it("a result is out of date once the plotted channel, error column or rows change", async () => {
    const { result } = renderHook(() => useOdrFit());
    await act(() => result.current.run());
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState({ yKeys: [4] }));
    expect(result.current.stale).toBe(true);
    expect(result.current.result).toEqual(FIT); // still shown, marked
    act(() => useApp.setState({ yKeys: [2] }));
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState({ errKeys: {} }));
    expect(result.current.stale).toBe(true);
    act(() => useApp.setState({ errKeys: { 2: 3 } }));
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.stale).toBe(true);
    await act(() => result.current.run());
    expect(result.current.stale).toBe(false);
  });

  it("a rename is not an input change", async () => {
    const { result } = renderHook(() => useOdrFit());
    await act(() => result.current.run());
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, name: "renamed.dat" })) })));
    expect(result.current.stale).toBe(false);
  });

  it("forced race: an answer for inputs changed while it was in flight is dropped (no overlay, no result)", async () => {
    let land!: (r: OdrResult) => void;
    let started!: () => void;
    const began = new Promise<void>((r) => { started = r; });
    vi.mocked(odrFit).mockImplementationOnce(() => { started(); return new Promise((r) => { land = r; }); });
    const { result } = renderHook(() => useOdrFit());
    let p!: Promise<void>;
    act(() => { p = result.current.run(); });
    await began;
    expect(result.current.busy).toBe(true);
    act(() => useApp.setState({ yKeys: [4] }));
    land(FIT);
    await act(async () => { await p; });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.result).toBeNull();
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("a lazy book that arrives during Fit does not abort or stale its own run", async () => {
    makePending(DS);
    const { result } = renderHook(() => useOdrFit());
    act(() => { void result.current.run(); }); // not awaited inside act: commits must land between steps
    await waitFor(() => expect(result.current.result).toEqual(FIT));
    expect(odrFit).toHaveBeenCalledTimes(1);
    expect(result.current.stale).toBe(false);
  });
});
