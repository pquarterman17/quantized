// Pawley "Out of date" (lane WB6). Refine stays a button. The result is stamped
// with the settings (cell, tie, centering, wavelength, FWHM, refine flag, channel)
// and source rows its run launched with; a change marks it and withholds
// → Library and the reflection lines; a late answer for changed inputs lands
// marked; a lazy book resolves before the run.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pawleyRefine } from "../../../lib/api/reductions";
import type { PawleyResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { usePawley } from "./usePawley";

vi.mock("../../../lib/api/reductions", () => ({ pawleyRefine: vi.fn() }));

const scan: DataStruct = {
  time: [20, 30, 40, 50], values: [[100, 9], [200, 8], [300, 7], [400, 6]], labels: ["Intensity", "Other"],
  units: ["cps", "cps"], metadata: { x_column_name: "2-Theta", x_column_unit: "deg" },
};
const RES: PawleyResult = {
  cell: [5.42, 5.42, 5.42, 90, 90, 90], cell_initial: [5.43, 5.43, 5.43, 90, 90, 90], scale: null,
  peaks: [{ hkl: [1, 1, 1], two_theta: 28.4, d: 3.13, multiplicity: 8, intensity: 12 }],
  background: [10, 11, 12, 13], model: [90, 190, 290, 390], residual: [10, 10, 10, 10],
  rwp: 0.05, rwp_initial: 0.2, rwp_background: 0.5, converged: true, tie: "abc", hkl_max: 8, n_peaks: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  vi.mocked(pawleyRefine).mockResolvedValue(RES);
  useApp.setState({
    status: "", xKey: null, refLines: [], history: [], future: [],
    datasets: [{ id: "d1", name: "powder.xrdml", data: scan }], activeId: "d1",
  });
});

async function refined() {
  const hook = renderHook(() => usePawley());
  await act(async () => { await hook.result.current.compute(); });
  return hook;
}

describe("Pawley out-of-date state", () => {
  it("characterization: a fresh refinement is current; → Library and reference lines work", async () => {
    const { result } = await refined();
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(false);
    expect(result.current.referenceLinesBlockedReason).toBeNull();
    act(() => result.current.toLibrary());
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("a changed setting marks it and withholds → Library and the reference lines; changing it back restores it", async () => {
    const { result } = await refined();
    const a0 = result.current.fields.a;
    act(() => result.current.setField("a", "5.5"));
    expect(result.current.result).not.toBeNull(); // shown, marked
    expect(result.current.stale).toBe(true);
    expect(result.current.referenceLinesBlockedReason).toMatch(/out of date/i);
    act(() => result.current.toLibrary());
    act(() => result.current.addReferenceLines());
    expect(useApp.getState().datasets).toHaveLength(1); // fail-before: it was added
    expect(useApp.getState().refLines).toHaveLength(0);
    act(() => result.current.setField("a", a0));
    expect(result.current.stale).toBe(false);
  });

  it("each setting marks it: tie, centering, refine flag, channel, wavelength", async () => {
    for (const change of [
      (h: ReturnType<typeof usePawley>) => h.setTie("ab"),
      (h: ReturnType<typeof usePawley>) => h.setSymmetry("F"),
      (h: ReturnType<typeof usePawley>) => h.setRefineCell(false),
      (h: ReturnType<typeof usePawley>) => h.setCol(1),
      (h: ReturnType<typeof usePawley>) => h.setField("wavelength", "1.79"),
    ]) {
      const { result } = await refined();
      act(() => change(result.current));
      expect(result.current.stale).toBe(true);
    }
  });

  it("edited source rows mark it (and keep the existing source-changed reason)", async () => {
    const { result } = await refined();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.stale).toBe(true);
    expect(result.current.referenceLinesBlockedReason).toMatch(/source data or included rows changed/i);
  });

  it("forced race: a setting changed in flight lands out of date", async () => {
    let land!: (r: PawleyResult) => void;
    vi.mocked(pawleyRefine).mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => usePawley());
    let pending!: Promise<void>;
    act(() => { pending = result.current.compute(); });
    await act(async () => {});
    act(() => result.current.setField("fwhm", "0.3"));
    await act(async () => { land(RES); await pending; });
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(true); // fail-before: current
    act(() => result.current.toLibrary());
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("a lazy book is resolved before the run, so the fresh result is current", async () => {
    makePending({ id: "d1", name: "powder.xrdml", data: scan });
    const { result } = await refined();
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(false);
  });
});
