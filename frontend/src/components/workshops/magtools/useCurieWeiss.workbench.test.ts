// Curie-Weiss single fit on the workbench shell's out-of-date contract (lane
// WB5). The fit stays a button; its readout (theta, C, mu_eff, R2) is stamped with
// the source's rows / data, plotted channels and fit settings it was LAUNCHED
// with. Back on the source worksheet, a changed setting or edited data marks it
// out of date. On the output worksheet the commit activates, the readout
// describes that worksheet and is not marked. The in-flight guard that already
// refuses a result for inputs changed mid-run is characterized, not changed.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { magneticCurieWeissDataFit } from "../../../lib/api/magnetic";
import type { CurieWeissDataFitResult } from "../../../lib/api/magnetic";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useCurieWeiss } from "./useCurieWeiss";

vi.mock("../../../lib/api/magnetic", () => ({ magneticCurieWeissDataFit: vi.fn() }));

const SRC: Dataset = {
  id: "mt", name: "sample.dat",
  data: {
    time: [100, 200, 300, 400],
    values: [[0.04, 1000], [0.02, 1000], [0.013333, 1000], [0.01, 1000]],
    labels: ["DC Moment", "Magnetic Field"], units: ["emu", "Oe"],
    metadata: { x_column_name: "Temperature", x_column_unit: "K", technique: "magnetometry.mvst" },
  },
};
const FIT: CurieWeissDataFitResult = {
  theta_cw: 50, C: 4, mu_eff: 5.6568, fit_line: [0.25, -12.5], r2: 0.999,
  inv_chi: [25, 50, 75, 100], susceptibility_molar: [0.04, 0.02, 0.013, 0.01], susceptibility_errors_molar: [],
  inverse_errors: [], fit_inv_chi: [12.5, 37.5, 62.5, 87.5], fit_mask: [true, true, true, true], n_fit: 4,
  fit_range_used: [200, 400], excluded_nonpositive: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  useApp.setState({ datasets: [SRC], activeId: "mt", xKey: null, yKeys: null, seriesOrder: null, status: "" });
  vi.mocked(magneticCurieWeissDataFit).mockResolvedValue(FIT);
});

async function fitted() {
  const hook = renderHook(() => useCurieWeiss());
  act(() => { hook.result.current.setSampleMass(100); hook.result.current.setMolarMass(200); });
  await act(async () => { await hook.result.current.fit(); });
  expect(hook.result.current.theta).toBe(50);
  return hook;
}
const backOnSource = () => act(() => useApp.setState({ activeId: "mt" }));

describe("useCurieWeiss out of date", () => {
  it("characterization: the commit activates the output and its readout is not marked; back on the source with the same form it is current", async () => {
    const { result } = await fitted();
    expect(useApp.getState().activeId).not.toBe("mt");
    expect(result.current.stale).toBe(false);
    backOnSource();
    expect(result.current.theta).toBe(50);
    expect(result.current.stale).toBe(false);
  });

  it("a changed fit setting on the source marks the readout out of date; restoring it clears the mark", async () => {
    const { result } = await fitted();
    backOnSource();
    const was = result.current.fitMin;
    act(() => result.current.setFitMin(was + 10));
    expect(result.current.stale).toBe(true);
    act(() => result.current.setFitMin(was));
    expect(result.current.stale).toBe(false);
    act(() => result.current.setMolarMass(300));
    expect(result.current.stale).toBe(true);
  });

  it("an edit to the source rows marks it", async () => {
    const { result } = await fitted();
    backOnSource();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "mt" ? { ...d, excludedRows: [0] } : d)) })));
    expect(result.current.stale).toBe(true);
  });

  it("an unrelated edit (a rename) is not an input", async () => {
    const { result } = await fitted();
    backOnSource();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "mt" ? { ...d, name: "renamed.dat" } : d)) })));
    expect(result.current.stale).toBe(false);
  });

  it("fitting again clears the mark", async () => {
    const { result } = await fitted();
    backOnSource();
    act(() => result.current.setMolarMass(300));
    expect(result.current.stale).toBe(true);
    await act(async () => { await result.current.fit(); });
    backOnSource();
    expect(result.current.stale).toBe(false);
  });

  it("characterization: an input changed while the fit runs is refused, not shown", async () => {
    let land!: (r: CurieWeissDataFitResult) => void;
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    vi.mocked(magneticCurieWeissDataFit).mockImplementationOnce(() => { began(); return new Promise((r) => { land = r as never; }); });
    const { result } = renderHook(() => useCurieWeiss());
    act(() => { result.current.setSampleMass(100); result.current.setMolarMass(200); });
    let p!: Promise<void>;
    act(() => { p = result.current.fit(); });
    await started;
    act(() => result.current.setMolarMass(300));
    await act(async () => { land(FIT); await p; });
    expect(result.current.theta).toBeNull();
    expect(result.current.error).toMatch(/changed while the calculation was running/);
  });

  it("a lazy book is resolved before the run is stamped: the landed readout is current", async () => {
    makePending(SRC);
    const { result } = await fitted();
    backOnSource();
    expect(result.current.stale).toBe(false);
  });
});
