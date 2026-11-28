// Curve measurements — state hook: the result is keyed by every input and
// withheld (never shown stale) when one moves; an answer for settings changed
// in flight never lands; a lazy book still shows its result; the output
// worksheet builders order rows by X.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LevelCrossingResult, StepTimeResult } from "../../../lib/api/curveMeasure";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { measureOutput, measureRows } from "./curveMeasureOutput";
import { useCurveMeasure } from "./useCurveMeasure";

const { inter, level, step } = vi.hoisted(() => ({ inter: vi.fn(), level: vi.fn(), step: vi.fn() }));
vi.mock("../../../lib/api/curveMeasure", () => ({ measureIntersect: inter, measureLevelCrossings: level, measureStepTime: step }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[0], [1], [0], [1]], labels: ["y"], units: ["V"],
  metadata: { x_column_name: "t", x_column_unit: "s" },
};
const LEVEL: LevelCrossingResult = {
  level: 0.5, hysteresis: 0, crossings: [{ x: 0.5, direction: "rising" }], n_points: 4, dropped: 0, merged_duplicates: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  level.mockResolvedValue(LEVEL);
  useApp.setState({ datasets: [{ id: "a", name: "sig", data: DATA }], activeId: "a", status: "", analysisResults: [], history: [], future: [] });
});

async function measured() {
  const hook = renderHook(() => useCurveMeasure());
  act(() => { hook.result.current.set("mode", "level"); hook.result.current.set("level", "0.5"); });
  await act(async () => { await hook.result.current.run(); });
  return hook;
}

describe("useCurveMeasure freshness", () => {
  it("withholds the result when a setting, a pick or a row moves; setting it back restores it", async () => {
    const { result } = await measured();
    expect(result.current.result?.mode).toBe("level");
    act(() => result.current.set("hysteresis", "0.1"));
    expect(result.current.result).toBeNull();
    act(() => result.current.set("hysteresis", ""));
    expect(result.current.result?.mode).toBe("level");
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) })));
    expect(result.current.result).toBeNull();
    expect(result.current.addDisabledReason).toMatch(/run the analysis first/i);
  });

  it("an answer for settings changed in flight is never current", async () => {
    let land!: (r: LevelCrossingResult) => void;
    level.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useCurveMeasure());
    act(() => { result.current.set("mode", "level"); result.current.set("level", "0.5"); });
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(); });
    await act(async () => {});
    act(() => result.current.set("level", "0.6"));
    await act(async () => { land(LEVEL); await pending; });
    expect(result.current.result).toBeNull();
  });

  it("a lazy book (resolved on first run) still shows its result", async () => {
    makePending({ id: "a", name: "sig", data: DATA });
    const { result } = await measured();
    await waitFor(() => expect(result.current.result?.mode).toBe("level"));
  });

  it("an intersection whose second worksheet disappears falls back to the active one", async () => {
    useApp.setState((s) => ({ datasets: [...s.datasets, { id: "b", name: "other", data: DATA }] }));
    const { result } = renderHook(() => useCurveMeasure());
    act(() => result.current.setBId("b"));
    expect(result.current.bId).toBe("b");
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "b") })));
    await waitFor(() => expect(result.current.bId).toBe(""));
  });
});

describe("measureOutput", () => {
  const LB = { xLabel: "t", xUnit: "s", yLabel: "y", yUnit: "V" };
  it("lists a fall's two reference crossings in ascending X and counts rows", () => {
    const fall: StepTimeResult = {
      edge: "fall", time: 0.4, x_low: 2.2, x_high: 1.8, low_fraction: 0.1, high_fraction: 0.9,
      low_plateau: 0, high_plateau: 1, low_level: 0.1, high_level: 0.9, plateaus_estimated: [true, true], plateau_method: "state",
      n_points: 9, dropped: 0, merged_duplicates: 0,
    };
    const out = measureOutput({ mode: "step", r: fall }, LB);
    expect(out.data.time).toEqual([1.8, 2.2]);
    expect(out.data.values).toEqual([[0.9], [0.1]]);
    expect(out.data.metadata?.["curve_measure"]).toMatchObject({ edge: "fall", time: 0.4 });
    expect(measureRows({ mode: "step", r: fall })).toBe(2);
    expect(measureRows({ mode: "level", r: { ...LEVEL, crossings: [] } })).toBe(0);
  });
});
