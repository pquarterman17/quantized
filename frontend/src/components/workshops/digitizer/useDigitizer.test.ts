// Digitizer "Create" (lane RL2). Fail-before: clicking Create twice on the same
// trace added two identical worksheets. There is no source worksheet (the image
// is the only input), so only the duplicate guard applies, not stale marking.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../../store/useApp";
import { useDigitizer } from "./useDigitizer";

function calibrated() {
  const hook = renderHook(() => useDigitizer());
  const pick = (px: number, py: number, value: number) => {
    act(() => hook.result.current.click(px, py));
    act(() => hook.result.current.commit(value));
  };
  pick(0, 100, 0); pick(100, 100, 10); pick(0, 100, 0); pick(0, 0, 5);
  act(() => hook.result.current.click(10, 90));
  act(() => hook.result.current.click(50, 50));
  return hook;
}

beforeEach(() => useApp.setState({ datasets: [], activeId: null, history: [], future: [], status: "" }));

describe("useDigitizer create", () => {
  it("a repeat Create on the same trace adds no duplicate; Undo re-enables it; a changed trace adds a new one", () => {
    const { result } = calibrated();
    act(() => result.current.create("curve"));
    expect(useApp.getState().datasets).toHaveLength(1);
    act(() => result.current.create("curve"));
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().status).toContain("already added");
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets).toHaveLength(0);
    act(() => result.current.create("curve"));
    expect(useApp.getState().datasets).toHaveLength(1);
    act(() => result.current.click(80, 20));
    act(() => result.current.create("curve"));
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("records the calibration (reference points, axis model, point count) with the output", () => {
    const { result } = calibrated();
    act(() => result.current.create("curve"));
    const meta = useApp.getState().datasets[0]!.data.metadata as { digitizer: Record<string, unknown> };
    expect(meta.digitizer).toEqual({
      version: 1, axes: "linear", tracedPoints: 2,
      references: {
        x1: { px: 0, py: 100, value: 0 }, x2: { px: 100, py: 100, value: 10 },
        y1: { px: 0, py: 100, value: 0 }, y2: { px: 0, py: 0, value: 5 },
      },
    });
  });
});
