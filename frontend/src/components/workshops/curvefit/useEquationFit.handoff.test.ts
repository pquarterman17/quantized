// Custom-equation mode reads the Curve fit input contract like the registry
// modes: the handoff selection item (worksheet, roles, selected rows, X range)
// wins over the active worksheet and the live plot channels, and a handoff to
// a deleted worksheet refuses instead of fitting whatever is active.

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitEquation, validateEquation } from "../../../lib/api/curvefit";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useEquationFit } from "./useEquationFit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ validateEquation: vi.fn(), fitEquation: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};
const OTHER: DataStruct = { ...DATA, values: [[100], [200], [300], [400]], labels: ["z"] };
const ACTIVE: Dataset = { id: "d1", name: "run.dat", data: DATA };
const HANDOFF: Dataset = { id: "d2", name: "other.dat", data: OTHER };

function handoff(datasetId: string, extra: Partial<Parameters<typeof captureAnalysisSelection>[0]> = {}) {
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({
      datasets: [ACTIVE, HANDOFF], activeId: datasetId, selectedIds: [datasetId], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, ...extra,
    }, "analysis-center"),
  });
}

async function validated() {
  vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["m", "b"] });
  const hook = renderHook(() => useEquationFit(null, { debounceMs: 0 }));
  act(() => hook.result.current.setEquation("m*x + b"));
  await waitFor(() => expect(hook.result.current.status).toBe("ok"));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [ACTIVE, HANDOFF], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, fitOverlay: null,
  });
  vi.mocked(fitEquation).mockResolvedValue({ params: [1, 0], yFit: [1, 2], paramNames: ["m", "b"] });
});

describe("useEquationFit reads the handoff like the other modes", () => {
  it("fits the handoff's selected rows and X range, and lays the overlay back onto those rows", async () => {
    handoff("d1", { selection: { datasetId: "d1", rows: [1, 3] }, range: { lo: 1, hi: 3, source: "manual" } });
    const { result } = await validated();
    await act(async () => { await result.current.fit(); });
    expect(fitEquation).toHaveBeenCalledWith(expect.objectContaining({ x: [1, 3], y: [20, 40] }));
    expect(useApp.getState().fitOverlay?.y).toEqual([null, 1, null, 2]);
  });

  it("fits the handoff worksheet and its roles, not the active worksheet", async () => {
    handoff("d2");
    const { result } = await validated();
    expect(result.current.active?.id).toBe("d2");
    vi.mocked(fitEquation).mockResolvedValue({ params: [1, 0], yFit: [1, 2, 3, 4], paramNames: ["m", "b"] });
    await act(async () => { await result.current.fit(); });
    expect(fitEquation).toHaveBeenCalledWith(expect.objectContaining({ x: [0, 1, 2, 3], y: [100, 200, 300, 400] }));
    expect(useApp.getState().fitOverlay?.y).toHaveLength(4);
    expect(result.current.xRange).toEqual({ min: 0, max: 3 });
  });

  it("refuses when the handoff worksheet was deleted: it does not fit the active one", async () => {
    handoff("d2");
    const { result } = await validated();
    act(() => useApp.setState({ datasets: [ACTIVE] }));
    expect(result.current.active).toBeNull();
    await act(async () => { await result.current.fit(); });
    expect(fitEquation).not.toHaveBeenCalled();
  });

  it("without a Curve fit selection the active worksheet and plotted channels still apply", async () => {
    const { result } = await validated();
    await act(async () => { await result.current.fit(); });
    expect(fitEquation).toHaveBeenCalledWith(expect.objectContaining({ x: [0, 1, 2, 3], y: [10, 20, 30, 40] }));
  });
});
