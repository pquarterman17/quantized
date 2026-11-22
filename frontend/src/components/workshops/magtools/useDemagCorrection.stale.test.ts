// Demag applied-N readout, out of date (lane WB7). Demag is commit-only: Apply
// writes a derived dataset through the shared commit contract (one undo step,
// no duplicate, stale when the source moves: pinned in useDemagCorrection.test).
// What it keeps in state is the "Applied N" readout. On the source that readout
// describes the RUN, so a changed geometry, plotted channel or row set
// withholds it behind "Out of date"; on the corrected dataset it describes itself.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { demagCorrectField } from "../../../lib/api/magnetometry";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useDemagCorrection } from "./useDemagCorrection";

vi.mock("../../../lib/api/magnetometry", () => ({
  demagCorrectField: vi.fn(), subtractMagBackground: vi.fn(), subtractHysteresisBackground: vi.fn(), normalizeMagMoment: vi.fn(),
}));

const loop = (): Dataset => ({
  id: "mh", name: "loop.dat",
  data: {
    time: [-1000, 0, 1000], values: [[-10], [0], [10]], labels: ["Magnetization"], units: ["emu/cm³"],
    metadata: { x_column_name: "Magnetic field", x_column_unit: "Oe" },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [loop()], activeId: "mh", xKey: null, yKeys: null, seriesOrder: null, status: "" });
  vi.mocked(demagCorrectField).mockResolvedValue({
    field: [-958, 0, 958], field_errors: [], field_unit: "Oe", magnetization_unit: "emu/cm³",
    shape: "Sphere", n_factor: 1 / 3, n_cgs: (4 * Math.PI) / 3,
  });
});

async function applied() {
  const hook = renderHook(() => useDemagCorrection());
  act(() => hook.result.current.setShape("Sphere"));
  await act(async () => { await hook.result.current.apply(); });
  act(() => useApp.setState({ activeId: "mh" })); // back on the source
  return hook;
}

describe("Demag applied-N readout out of date", () => {
  it("characterization: the readout shows, unmarked, on the source and on the output", async () => {
    const { result } = await applied();
    expect(result.current.nFactor).toBeCloseTo(1 / 3);
    expect(result.current.stale).toBe(false);
    act(() => useApp.setState({ activeId: useApp.getState().datasets[1].id }));
    expect(result.current.nFactor).toBeCloseTo(1 / 3);
    expect(result.current.stale).toBe(false);
  });

  it("a changed geometry withholds the readout; restoring it brings it back", async () => {
    const { result } = await applied();
    act(() => result.current.setShape("Thin film (in-plane)"));
    expect(result.current.stale).toBe(true); // fail-before: N of the sphere stayed beside another geometry
    expect(result.current.nFactor).toBeNull();
    act(() => result.current.setShape("Sphere"));
    expect(result.current.stale).toBe(false);
    expect(result.current.nFactor).toBeCloseTo(1 / 3);
  });

  it("edited rows of the source withhold the readout; the output's own readout stays", async () => {
    const { result } = await applied();
    const outId = useApp.getState().datasets[1].id;
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "mh" ? { ...d, excludedRows: [0] } : d)) })));
    expect(result.current.stale).toBe(true);
    expect(result.current.nFactor).toBeNull();
    act(() => useApp.setState({ activeId: outId }));
    expect(result.current.stale).toBe(false);
    expect(result.current.nFactor).toBeCloseTo(1 / 3);
  });
});
