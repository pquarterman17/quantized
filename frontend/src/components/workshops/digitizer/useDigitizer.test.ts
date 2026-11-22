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
});
