import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertMagUnits, subtractMagBackground } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useMagTools } from "./useMagTools";

vi.mock("../../../lib/api", () => ({
  subtractMagBackground: vi.fn(),
  convertMagUnits: vi.fn(),
}));

const mvt: DataStruct = {
  time: [2, 100, 300], // temperature
  values: [[5], [2], [1]], // moment (emu)
  labels: ["Moment"],
  units: ["emu"],
  metadata: { x_column_name: "Temperature", x_column_unit: "K" },
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "mt.dat", data: mvt }],
    activeId: "d1",
    status: "",
  });
});

describe("useMagTools background", () => {
  it("subtracts the high-T background into a new dataset", async () => {
    vi.mocked(subtractMagBackground).mockResolvedValue({
      corrected: [4, 1, 0],
      slope: -0.01,
      intercept: 3,
    });
    const { result } = renderHook(() => useMagTools());

    await act(async () => {
      await result.current.subtractBackground();
    });

    expect(subtractMagBackground).toHaveBeenCalledWith({
      temperature: [2, 100, 300],
      moment: [5, 2, 1],
      auto_fraction: 0.1,
    });
    expect(result.current.fit).toEqual({ slope: -0.01, intercept: 3 });
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    expect(ds[1].name).toBe("mt (bg-sub)");
    expect(ds[1].data.values).toEqual([[4], [1], [0]]);
  });

  it("surfaces an error and adds no dataset", async () => {
    vi.mocked(subtractMagBackground).mockRejectedValue(new Error("need more high-T points"));
    const { result } = renderHook(() => useMagTools());
    await act(async () => {
      await result.current.subtractBackground();
    });
    expect(result.current.error).toContain("high-T");
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});

describe("useMagTools units", () => {
  it("converts field/moment and writes a dataset with the new units", async () => {
    vi.mocked(convertMagUnits).mockResolvedValue({
      x: [2e-4, 0.01, 0.03],
      y: [5, 2, 1],
      x_unit: "T",
      y_unit: "emu",
      warning: "",
    });
    const { result } = renderHook(() => useMagTools());

    act(() => result.current.setTab("units"));
    act(() => result.current.setUnits({ toField: "T" }));
    await act(async () => {
      await result.current.convert();
    });

    const body = vi.mocked(convertMagUnits).mock.calls[0][0];
    expect(body).toMatchObject({ from_field: "Oe", to_field: "T", from_moment: "emu" });
    const ds = useApp.getState().datasets;
    expect(ds[1].data.units).toEqual(["emu"]);
    expect(ds[1].data.metadata.x_column_unit).toBe("T");
    expect(ds[1].data.time).toEqual([2e-4, 0.01, 0.03]);
  });

  it("surfaces the backend warning (e.g. emu/g needs mass)", async () => {
    vi.mocked(convertMagUnits).mockResolvedValue({
      x: [2, 100, 300],
      y: [5, 2, 1],
      x_unit: "Oe",
      y_unit: "emu",
      warning: "Cannot convert moment to emu/g: sample mass is 0.",
    });
    const { result } = renderHook(() => useMagTools());
    act(() => result.current.setTab("units"));
    act(() => result.current.setUnits({ toMoment: "emu/g" }));
    await act(async () => {
      await result.current.convert();
    });
    expect(result.current.warning).toContain("sample mass is 0");
  });
});
