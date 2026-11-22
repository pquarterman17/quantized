// MagTools Background fit readout, out of date (lane WB7). The background tab
// writes a NEW dataset (a committed output, no pending result); what it keeps
// in state is the fit readout (slope / intercept or susceptibility / offset).
// That readout is stamped with the source's rows, the plotted channels, the
// routine and its fraction: back on the source, a moved input withholds it
// behind "Out of date"; on the corrected dataset it describes itself. (The new
// dataset's activation resets the plot selection, so a source plotted with a
// non-default channel at the run reads as changed when it is selected again.)

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { subtractMagBackground } from "../../../lib/api/magnetometry";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useMagTools } from "./useMagTools";

vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(), subtractHysteresisBackground: vi.fn(), normalizeMagMoment: vi.fn(), demagCorrectField: vi.fn(),
}));

const MULTI: DataStruct = {
  time: [2, 100, 300, 310], values: [[5, 9], [2, 8], [1, 7], [1, 6]],
  labels: ["Moment", "Other"], units: ["emu", "emu"], metadata: { x_column_name: "Temperature", x_column_unit: "K" },
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [4, 1, 0, 0], slope: -0.01, intercept: 3 });
  useApp.setState({
    datasets: [{ id: "d1", name: "mt.dat", data: MULTI }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, status: "",
  });
});

async function ran() {
  const hook = renderHook(() => useMagTools());
  await act(async () => { await hook.result.current.subtractBackground(); });
  act(() => useApp.setState({ activeId: "d1" })); // back on the source
  return hook;
}

describe("MagTools background fit readout out of date", () => {
  it("characterization: the fit shows, unmarked, on the source and on the corrected dataset", async () => {
    const { result } = await ran();
    expect(result.current.fit).toEqual({ kind: "mt", slope: -0.01, intercept: 3 });
    expect(result.current.fitStale).toBe(false);
    act(() => useApp.setState({ activeId: useApp.getState().datasets[1].id }));
    expect(result.current.fit).not.toBeNull();
    expect(result.current.fitStale).toBe(false);
  });

  it("a changed fraction withholds the fit; restoring it brings it back", async () => {
    const { result } = await ran();
    act(() => result.current.setAutoFraction(0.3));
    expect(result.current.fitStale).toBe(true); // fail-before: the old slope stayed, unmarked
    expect(result.current.fit).toBeNull();
    act(() => result.current.setAutoFraction(0.1));
    expect(result.current.fitStale).toBe(false);
    expect(result.current.fit).not.toBeNull();
  });

  it("a different plotted moment channel withholds the fit", async () => {
    const { result } = await ran();
    act(() => useApp.setState({ yKeys: [1] }));
    expect(result.current.fitStale).toBe(true);
    expect(result.current.fit).toBeNull();
  });

  it("edited rows of the source withhold the fit, and its warning", async () => {
    const { result } = await ran();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, excludedRows: [0] } : d)) })));
    expect(result.current.fitStale).toBe(true);
    expect(result.current.warning).toBeNull();
  });

  it("an edit to the source does not mark the corrected dataset's own readout", async () => {
    const { result } = await ran();
    const outId = useApp.getState().datasets[1].id;
    act(() => useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, excludedRows: [0] } : d)), activeId: outId,
    })));
    expect(result.current.fitStale).toBe(false);
    expect(result.current.fit).not.toBeNull();
  });

  it("subtracting again with the new settings clears the mark", async () => {
    const { result } = await ran();
    act(() => result.current.setAutoFraction(0.3));
    await act(async () => { await result.current.subtractBackground(); });
    act(() => useApp.setState({ activeId: "d1" }));
    expect(result.current.fitStale).toBe(false);
    expect(result.current.fit).not.toBeNull();
  });

  it("a lazy source installed by the run does not read as changed", async () => {
    makePending({ id: "d1", name: "mt.dat", data: MULTI });
    const { result } = await ran();
    expect(result.current.fit).not.toBeNull();
    expect(result.current.fitStale).toBe(false);
  });
});
