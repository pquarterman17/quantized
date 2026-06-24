import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertUnits, getConstants } from "../../../lib/api";
import { useCalculators } from "./useCalculators";

vi.mock("../../../lib/api", () => ({ convertUnits: vi.fn(), getConstants: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConstants).mockResolvedValue({ constants: { h: 6.626e-34, c: 2.998e8 } });
});

describe("useCalculators", () => {
  it("loads constants on mount", async () => {
    const { result } = renderHook(() => useCalculators());
    await waitFor(() => expect(result.current.constants).not.toBeNull());
    expect(result.current.constants?.h).toBeCloseTo(6.626e-34, 37);
  });

  it("converts a value and surfaces the result + description", async () => {
    vi.mocked(convertUnits).mockResolvedValue({
      result: 0.0001,
      info: { description: "1 Oe = 0.0001 T" },
    });
    const { result } = renderHook(() => useCalculators());

    await act(async () => {
      await result.current.convert();
    });

    expect(convertUnits).toHaveBeenCalledWith(1, "Oe", "T");
    expect(result.current.result).toBeCloseTo(0.0001, 8);
    expect(result.current.description).toBe("1 Oe = 0.0001 T");
    expect(result.current.error).toBeNull();
  });

  it("setPair swaps from/to and clears the stale result", async () => {
    vi.mocked(convertUnits).mockResolvedValue({ result: 0.0001, info: {} });
    const { result } = renderHook(() => useCalculators());
    await act(async () => {
      await result.current.convert();
    });
    expect(result.current.result).not.toBeNull();

    act(() => result.current.setPair("eV", "nm"));
    expect(result.current.from).toBe("eV");
    expect(result.current.to).toBe("nm");
    expect(result.current.result).toBeNull();
  });

  it("rejects a non-numeric value without calling the API", async () => {
    const { result } = renderHook(() => useCalculators());
    act(() => result.current.setValue("abc"));
    await act(async () => {
      await result.current.convert();
    });
    expect(convertUnits).not.toHaveBeenCalled();
    expect(result.current.error).toContain("numeric");
  });

  it("surfaces an incompatible-dimension error from the backend", async () => {
    vi.mocked(convertUnits).mockRejectedValue(new Error("incompatible dimensions"));
    const { result } = renderHook(() => useCalculators());
    act(() => result.current.setPair("Oe", "J"));
    await act(async () => {
      await result.current.convert();
    });
    expect(result.current.error).toContain("incompatible");
    expect(result.current.result).toBeNull();
  });
});
