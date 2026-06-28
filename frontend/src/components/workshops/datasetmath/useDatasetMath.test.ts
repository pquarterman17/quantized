import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { datasetAlgebra } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useDatasetMath } from "./useDatasetMath";

vi.mock("../../../lib/api", () => ({ datasetAlgebra: vi.fn() }));

const a: DataStruct = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["A"], units: ["x"], metadata: {} };
const b: DataStruct = { time: [1, 2, 3], values: [[1], [2], [3]], labels: ["B"], units: ["x"], metadata: {} };

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [
      { id: "d1", name: "scan1.dat", data: a },
      { id: "d2", name: "scan2.dat", data: b },
    ],
    activeId: "d1",
    status: "",
  });
});

describe("useDatasetMath", () => {
  it("defaults A to the active dataset and B to a different one", () => {
    const { result } = renderHook(() => useDatasetMath());
    expect(result.current.idA).toBe("d1");
    expect(result.current.idB).toBe("d2");
  });

  it("posts A∘B with the chosen op + interp and writes a new dataset", async () => {
    const out: DataStruct = { ...a, values: [[9], [18], [27]], labels: ["A - B"] };
    vi.mocked(datasetAlgebra).mockResolvedValue(out);
    const { result } = renderHook(() => useDatasetMath());

    await act(async () => {
      await result.current.compute();
    });

    expect(datasetAlgebra).toHaveBeenCalledWith({
      dataset_a: a, dataset_b: b, operation: "A-B", interp_method: "pchip",
    });
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(3);
    expect(ds[2].name).toBe("scan1 − scan2");
    expect(ds[2].data).toEqual(out);
  });

  it("passes a changed operation and interpolation through", async () => {
    vi.mocked(datasetAlgebra).mockResolvedValue(a);
    const { result } = renderHook(() => useDatasetMath());
    act(() => {
      result.current.setOperation("A/B");
      result.current.setInterp("linear");
    });
    await act(async () => {
      await result.current.compute();
    });
    expect(datasetAlgebra).toHaveBeenCalledWith({
      dataset_a: a, dataset_b: b, operation: "A/B", interp_method: "linear",
    });
  });

  it("refuses to compute when a picked dataset is missing", async () => {
    const { result } = renderHook(() => useDatasetMath());
    act(() => result.current.setIdB("ghost"));
    await act(async () => {
      await result.current.compute();
    });
    expect(datasetAlgebra).not.toHaveBeenCalled();
    expect(result.current.error).toContain("pick two");
  });

  it("surfaces a backend error", async () => {
    vi.mocked(datasetAlgebra).mockRejectedValue(new Error("operation must be one of"));
    const { result } = renderHook(() => useDatasetMath());
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toContain("operation");
    expect(useApp.getState().datasets).toHaveLength(2); // nothing added
  });
});
