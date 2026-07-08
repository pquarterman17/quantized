import { fireEvent, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit } from "../../lib/api";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useQuickFitChip } from "./useQuickFitChip";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  reportEmit: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    qfitRoi: [1, 2],
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: { params: [1, 0], errors: [0.1, 0.1], R2: 0.9 },
    qfitError: null,
    reports: [],
  });
});

describe("useQuickFitChip", () => {
  it("exposes the store's roi/model/result and the curated model list", () => {
    const { result } = renderHook(() => useQuickFitChip());
    expect(result.current.roi).toEqual([1, 2]);
    expect(result.current.model).toBe("Linear");
    expect(result.current.models).toContain("Gaussian");
    expect(result.current.result).toEqual(expect.objectContaining({ R2: 0.9 }));
  });

  it("Escape dismisses the gadget while a roi is armed", () => {
    renderHook(() => useQuickFitChip());
    expect(useApp.getState().qfitRoi).toEqual([1, 2]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().qfitRoi).toBeNull();
  });

  it("a non-Escape key while armed does not clear the gadget", () => {
    renderHook(() => useQuickFitChip());
    fireEvent.keyDown(window, { key: "Enter" });
    expect(useApp.getState().qfitRoi).toEqual([1, 2]);
  });

  it("is a harmless no-op with no roi armed", () => {
    useApp.setState({ qfitRoi: null });
    renderHook(() => useQuickFitChip());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().qfitRoi).toBeNull();
  });

  it("report() emits a #36 curve_fit report and adds it to the library", async () => {
    vi.mocked(reportEmit).mockResolvedValue({
      report: { title: "t", sections: [] },
    });
    const { result } = renderHook(() => useQuickFitChip());
    await act(async () => {
      await result.current.report();
    });
    expect(reportEmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "curve_fit", model_name: "Linear" }),
    );
    expect(useApp.getState().reports).toHaveLength(1);
  });

  it("report() surfaces a failure instead of throwing", async () => {
    vi.mocked(reportEmit).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useQuickFitChip());
    await act(async () => {
      await result.current.report();
    });
    expect(useApp.getState().reports).toHaveLength(0);
  });

  it("commit() delegates to the store's commitQfit", async () => {
    const { result } = renderHook(() => useQuickFitChip());
    result.current.commit();
    await waitFor(() => expect(useApp.getState().datasets[0].fitSpec).toEqual({ model: "Linear" }));
  });
});
