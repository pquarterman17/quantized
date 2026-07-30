import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type CorrelationResponse, type PCAResponse, statsCorrelation, statsPCA } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useMultivar } from "./useMultivar";

vi.mock("../../../lib/api", () => ({
  statsCorrelation: vi.fn(),
  statsPCA: vi.fn(),
}));

// 3 continuous channels, 6 rows. Row 4 (0-based) has a NaN in "c" so the
// listwise-complete set is 5 rows for any selection that includes "c".
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [
    [1, 10, 100],
    [2, 20, 200],
    [3, 30, 300],
    [4, 40, 400],
    [5, 50, NaN],
    [6, 60, 600],
  ],
  labels: ["a", "b", "c"],
  units: ["", "", ""],
  metadata: { x_column_name: "T" },
};

const CORR: CorrelationResponse = {
  r: [
    [1, 0.9, 0.8],
    [0.9, 1, 0.7],
    [0.8, 0.7, 1],
  ],
  p: [
    [1, 0.01, 0.02],
    [0.01, 1, 0.03],
    [0.02, 0.03, 1],
  ],
  N: 5,
  method: "pearson",
};

const PCA: PCAResponse = {
  coeff: [
    [0.6, 0.1],
    [0.6, -0.1],
    [0.5, 0.99],
  ],
  score: [
    [1, 0.1],
    [2, -0.1],
    [3, 0.2],
    [4, -0.2],
    [5, 0.3],
  ],
  latent: [3, 1],
  explained: [75, 25],
  cumulative: [75, 100],
  mu: [3, 30, 300],
  sigma: [1, 1, 1],
  singular: [2, 1],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsCorrelation).mockResolvedValue(CORR);
  vi.mocked(statsPCA).mockResolvedValue(PCA);
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", selection: null });
});

describe("useMultivar — column selection", () => {
  it("defaults to every continuous channel (a, b, c all read continuous — too few samples for nominal)", async () => {
    const { result } = renderHook(() => useMultivar());
    expect(result.current.selected).toEqual([0, 1, 2]);
    expect(result.current.tooFewColumns).toBe(false);
  });

  it("toggleColumn adds/removes and keeps the selection sorted", () => {
    const { result } = renderHook(() => useMultivar());
    act(() => result.current.toggleColumn(1)); // remove b -> [0,2]
    expect(result.current.selected).toEqual([0, 2]);
    act(() => result.current.toggleColumn(1)); // add back -> sorted [0,1,2]
    expect(result.current.selected).toEqual([0, 1, 2]);
  });

  it("selectAll includes the x column; selectDefault reverts to continuous-only", () => {
    const { result } = renderHook(() => useMultivar());
    act(() => result.current.selectAll());
    expect(result.current.selected).toEqual([-1, 0, 1, 2]);
    act(() => result.current.selectDefault());
    expect(result.current.selected).toEqual([0, 1, 2]);
  });

  it("fewer than 2 selected columns reports tooFewColumns and skips both fetches", async () => {
    const { result } = renderHook(() => useMultivar());
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalled()); // the initial 3-column fetch
    vi.mocked(statsCorrelation).mockClear();
    vi.mocked(statsPCA).mockClear();
    act(() => {
      result.current.toggleColumn(1);
      result.current.toggleColumn(2);
    });
    await waitFor(() => expect(result.current.tooFewColumns).toBe(true));
    expect(result.current.corrError).toContain("at least 2");
    expect(result.current.pcaError).toContain("at least 2");
    expect(statsCorrelation).not.toHaveBeenCalled();
    expect(statsPCA).not.toHaveBeenCalled();
  });
});

describe("useMultivar — listwise-complete rows shared by correlation/PCA/SPLOM", () => {
  it("drops the row with a NaN, and both requests see that same N", async () => {
    const { result } = renderHook(() => useMultivar());
    await waitFor(() => expect(result.current.corr).not.toBeNull());
    expect(result.current.rows.length).toBe(5); // row index 4 dropped (NaN in "c")
    expect(statsCorrelation).toHaveBeenCalledWith(
      [
        [1, 2, 3, 4, 6],
        [10, 20, 30, 40, 60],
        [100, 200, 300, 400, 600],
      ],
      "pearson",
    );
    await waitFor(() => expect(result.current.pca).not.toBeNull());
    expect(statsPCA).toHaveBeenCalledWith({
      data: [
        [1, 10, 100],
        [2, 20, 200],
        [3, 30, 300],
        [4, 40, 400],
        [6, 60, 600],
      ],
      center: true,
      scale: false,
    });
  });

  it("labels follow the selected columns in order", async () => {
    const { result } = renderHook(() => useMultivar());
    act(() => result.current.toggleColumn(1)); // drop b -> [a, c]
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalled());
    expect(result.current.labels).toEqual(["a", "c"]);
  });
});

describe("useMultivar — correlation", () => {
  it("re-fetches when method toggles", async () => {
    const { result } = renderHook(() => useMultivar());
    await waitFor(() => expect(result.current.corr).not.toBeNull());
    act(() => result.current.setMethod("spearman"));
    await waitFor(() => expect(statsCorrelation).toHaveBeenLastCalledWith(expect.anything(), "spearman"));
  });

  it("surfaces a fetch error without leaving stale state", async () => {
    vi.mocked(statsCorrelation).mockRejectedValue(new Error("correlation needs at least 3 complete rows"));
    const { result } = renderHook(() => useMultivar());
    await waitFor(() => expect(result.current.corrError).not.toBeNull());
    expect(result.current.corrError).toContain("at least 3");
    expect(result.current.corr).toBeNull();
  });

  it("toTSV renders the fetched matrix", async () => {
    const { result } = renderHook(() => useMultivar());
    await waitFor(() => expect(result.current.corr).not.toBeNull());
    const tsv = result.current.toTSV();
    expect(tsv.split("\n")[0]).toBe("\ta\tb\tc");
  });

  it("toTSV is empty before a result lands", () => {
    const { result } = renderHook(() => useMultivar());
    expect(result.current.toTSV()).toBe("");
  });
});

describe("useMultivar — PCA", () => {
  it("re-fetches when standardize toggles", async () => {
    const { result } = renderHook(() => useMultivar());
    await waitFor(() => expect(result.current.pca).not.toBeNull());
    act(() => result.current.setStandardize(true));
    await waitFor(() =>
      expect(statsPCA).toHaveBeenLastCalledWith(expect.objectContaining({ scale: true })),
    );
  });

  it("defaults PC picks to 0/1 and clamps when the component count shrinks", async () => {
    const { result } = renderHook(() => useMultivar());
    await waitFor(() => expect(result.current.pca).not.toBeNull());
    expect(result.current.pcX).toBe(0);
    expect(result.current.pcY).toBe(1);
    act(() => result.current.setPcY(1));
    expect(result.current.pcY).toBe(1);
  });

  it("surfaces a PCA fetch error (e.g. non-finite input) without stale state", async () => {
    vi.mocked(statsPCA).mockRejectedValue(new Error("X must contain only finite values"));
    const { result } = renderHook(() => useMultivar());
    await waitFor(() => expect(result.current.pcaError).not.toBeNull());
    expect(result.current.pca).toBeNull();
  });
});

describe("useMultivar — dataset switch", () => {
  it("resets the column selection when the active dataset changes", async () => {
    const { result, rerender } = renderHook(() => useMultivar());
    act(() => result.current.toggleColumn(1));
    expect(result.current.selected).toEqual([0, 2]);

    const OTHER: DataStruct = { ...DATA, labels: ["x", "y"], values: DATA.values.map((r) => [r[0], r[1]]) };
    useApp.setState({ datasets: [{ id: "d2", name: "other.dat", data: OTHER }], activeId: "d2" });
    rerender();
    expect(result.current.selected).toEqual([0, 1]);
  });
});
