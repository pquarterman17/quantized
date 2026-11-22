// Ellipse fit (lane WB6 audit). The result is keyed by every input (rows, picks,
// method) and withheld when any moves (already correct, pinned). Fixed: a lazy
// book installed by Fit moved the fingerprint the result was stored under, so a
// successful fit on a lazy book was silently discarded.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EllipseResult } from "../../../lib/api/analysisExtras";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useEllipseFit } from "./useEllipseFit";

const { ellipseMock } = vi.hoisted(() => ({ ellipseMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ ellipseFit: ellipseMock }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4], values: [[1], [2], [3], [4], [5]], labels: ["y"], units: ["um"],
  metadata: { x_column_name: "x", x_column_unit: "um" },
};
const RES: EllipseResult = {
  n_points: 5, geometric: true, converged: true, center_x: 3, center_y: -2, semi_major: 5, semi_minor: 2, angle_deg: 30,
  center_x_se: 0.01, center_y_se: 0.02, semi_major_se: 0.03, semi_minor_se: 0.04, angle_deg_se: 0.5, rms: 0.05, arc_coverage_deg: 350,
  algebraic: { center_x: 3, center_y: -2, semi_major: 5, semi_minor: 2, angle_deg: 30 }, residuals: [0, 0, 0, 0, 0],
  curve_x: [1, 2, 3, 1], curve_y: [1, 2, 0, 1],
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  ellipseMock.mockResolvedValue(RES);
  useApp.setState({ datasets: [{ id: "d", name: "loop", data: DATA }], activeId: "d", status: "", analysisResults: [], history: [], future: [] });
});

async function fitted() {
  const hook = renderHook(() => useEllipseFit());
  await act(async () => { await hook.result.current.fit(); });
  return hook;
}

describe("Ellipse fit result freshness", () => {
  it("characterization: method, picks or row changes withhold the result and Add; setting back restores it", async () => {
    const { result } = await fitted();
    expect(result.current.result?.semi_major).toBe(5);
    act(() => result.current.setGeometric(false));
    expect(result.current.result).toBeNull();
    expect(result.current.addDisabledReason).toMatch(/run the analysis first/i);
    act(() => result.current.setGeometric(true));
    expect(result.current.result?.semi_major).toBe(5);
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) })));
    expect(result.current.result).toBeNull();
  });

  it("characterization: an answer for a method changed in flight is never current", async () => {
    let land!: (r: EllipseResult) => void;
    ellipseMock.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useEllipseFit());
    let pending!: Promise<void>;
    act(() => { pending = result.current.fit(); });
    await act(async () => {});
    act(() => result.current.setGeometric(false));
    await act(async () => { land(RES); await pending; });
    expect(result.current.result).toBeNull();
  });

  it("a lazy book installed by Fit does not discard the fit (fail-before: result stayed null)", async () => {
    makePending({ id: "d", name: "loop", data: DATA });
    const { result } = await fitted();
    expect(result.current.result?.semi_major).toBe(5);
  });
});
