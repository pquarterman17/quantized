// Find X from Y / Y from X (MAIN #15): posts the right request shape for a
// registry-model target vs an equation target, surfaces the y / x[] result,
// validates the numeric inputs client-side, and reports backend errors.

import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findXY } from "../../../lib/api";
import { useFindXY, type FindXYTarget } from "./useFindXY";

vi.mock("../../../lib/api", () => ({
  findXY: vi.fn(),
}));

const REGISTRY_TARGET: FindXYTarget = {
  model: "Gaussian",
  params: [1, 0, 1],
  xMin: -5,
  xMax: 5,
};

const EQUATION_TARGET: FindXYTarget = {
  equation: "y = a*exp(-x/t)",
  params: [1, 1],
  xMin: 0,
  xMax: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFindXY", () => {
  it("findY posts the registry model + params + x and stores the result", async () => {
    vi.mocked(findXY).mockResolvedValue({ y: 0.6065 });
    const { result } = renderHook(() => useFindXY(REGISTRY_TARGET));
    act(() => result.current.setXInput("1"));
    await act(async () => {
      await result.current.findY();
    });
    expect(findXY).toHaveBeenCalledWith({
      model: "Gaussian",
      equation: undefined,
      params: [1, 0, 1],
      x_min: -5,
      x_max: 5,
      x: 1,
    });
    expect(result.current.yResult).toBe(0.6065);
    expect(result.current.xResults).toBeNull();
  });

  it("findX posts the equation + params + y and stores all crossings", async () => {
    vi.mocked(findXY).mockResolvedValue({ x: [0.693] });
    const { result } = renderHook(() => useFindXY(EQUATION_TARGET));
    act(() => result.current.setYInput("0.5"));
    await act(async () => {
      await result.current.findX();
    });
    expect(findXY).toHaveBeenCalledWith({
      model: undefined,
      equation: "y = a*exp(-x/t)",
      params: [1, 1],
      x_min: 0,
      x_max: 10,
      y: 0.5,
    });
    expect(result.current.xResults).toEqual([0.693]);
    expect(result.current.yResult).toBeNull();
  });

  it("an empty crossing list is a valid result, not an error", async () => {
    vi.mocked(findXY).mockResolvedValue({ x: [] });
    const { result } = renderHook(() => useFindXY(REGISTRY_TARGET));
    act(() => result.current.setYInput("100"));
    await act(async () => {
      await result.current.findX();
    });
    expect(result.current.xResults).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("rejects a non-numeric X without calling the backend", async () => {
    const { result } = renderHook(() => useFindXY(REGISTRY_TARGET));
    act(() => result.current.setXInput("abc"));
    await act(async () => {
      await result.current.findY();
    });
    expect(findXY).not.toHaveBeenCalled();
    expect(result.current.error).toContain("numeric");
  });

  it("surfaces a backend 422 as an error", async () => {
    vi.mocked(findXY).mockRejectedValue(new Error("x_max must be greater than x_min"));
    const { result } = renderHook(() => useFindXY(REGISTRY_TARGET));
    act(() => result.current.setXInput("0"));
    await act(async () => {
      await result.current.findY();
    });
    expect(result.current.error).toContain("x_max");
    expect(result.current.busy).toBe(false);
  });

  it("does nothing when there is no target", async () => {
    const { result } = renderHook(() => useFindXY(null));
    act(() => result.current.setXInput("1"));
    await act(async () => {
      await result.current.findY();
    });
    expect(findXY).not.toHaveBeenCalled();
  });
});
