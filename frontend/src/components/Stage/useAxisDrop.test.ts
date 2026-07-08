// Drag-to-axis (#49) hook test: the callback applies resolveAxisDrop's
// action(s) through the REAL store actions (setXKey/setYKeys/setY2Keys — no
// new plot machinery) and surfaces the categorical-X note as a toast.
// Mirrors useQuickFitChip.test.ts's renderHook + useApp.setState pattern.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset, DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useToasts } from "../../store/toasts";
import { useAxisDrop } from "./useAxisDrop";

// A/B continuous, C nominal-looking (3 distinct values × 5 — clears
// modeling.ts's MIN_SAMPLES=12 / NOMINAL_MAX_LEVELS=8 thresholds).
const DATA: DataStruct = {
  time: Array.from({ length: 15 }, (_, i) => i),
  values: Array.from({ length: 15 }, (_, i) => [i * 2, 100 - i, (i % 3) + 1]),
  labels: ["A", "B", "C"],
  units: ["", "", ""],
  metadata: {},
};

const ds = (over: Partial<Dataset> = {}): Dataset => ({ id: "d1", name: "run", data: DATA, ...over });

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [ds()],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    macroRecording: false,
    macroSteps: [],
  });
});

describe("useAxisDrop", () => {
  it("applies a Y-band drop through setYKeys", () => {
    useApp.setState({ yKeys: [0] });
    const { result } = renderHook(() => useAxisDrop());
    result.current("y", "d1", 1);
    expect(useApp.getState().yKeys).toEqual([0, 1]);
  });

  it("applies an X-band drop through setXKey", () => {
    const { result } = renderHook(() => useAxisDrop());
    result.current("x", "d1", 1);
    expect(useApp.getState().xKey).toBe(1);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("applies a Y2-band drop and adds the channel to Y first when needed", () => {
    useApp.setState({ yKeys: [0] });
    const { result } = renderHook(() => useAxisDrop());
    result.current("y2", "d1", 1);
    expect(useApp.getState().yKeys).toEqual([0, 1]);
    expect(useApp.getState().y2Keys).toEqual([1]);
  });

  it("toasts the categorical-X note when a nominal channel lands on X", () => {
    const { result } = renderHook(() => useAxisDrop());
    result.current("x", "d1", 2); // channel C reads as nominal
    expect(useApp.getState().xKey).toBe(2);
    expect(useToasts.getState().toasts).toHaveLength(1);
    expect(useToasts.getState().toasts[0].msg).toMatch(/plot-types item 4/);
  });

  it("is a silent no-op for a foreign-dataset payload", () => {
    const { result } = renderHook(() => useAxisDrop());
    result.current("x", "some-other-dataset", 1);
    expect(useApp.getState().xKey).toBeNull();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("is a harmless no-op with no active dataset", () => {
    useApp.setState({ activeId: null });
    const { result } = renderHook(() => useAxisDrop());
    expect(() => result.current("x", "d1", 1)).not.toThrow();
    expect(useApp.getState().xKey).toBeNull();
  });

  it("records a macro step for free — the drop goes through the SAME setXKey the Channels card uses", () => {
    useApp.setState({ macroRecording: true });
    const { result } = renderHook(() => useAxisDrop());
    result.current("x", "d1", 1);
    const steps = useApp.getState().macroSteps;
    expect(steps).toHaveLength(1);
    expect(steps[0].code).toBe("qz.setXKey(1)");
  });
});
