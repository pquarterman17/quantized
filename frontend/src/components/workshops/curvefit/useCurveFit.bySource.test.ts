// P4 phase 3: when the server holds the worksheet's dataset, Curve Fit sends
// its handle, the X/Y channel and the fitted rows instead of x/y. One case per
// selection rule (the analysis view with its gap drop, manual exclusions, an
// analysis selection, per-series X, -0): the rows it sends gather to exactly
// the x/y the array request posts (routes/_datasetrows.py does that gather;
// tests/test_api_fit_by_handle.py pins it against the array fit).
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import { rememberHandle } from "../../../lib/api/datasetCache";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset, DataStruct } from "../../../lib/types";
import { gatherRows } from "../../../test/gatherRows";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn() }));

const N = 14;
const NaN_ = Number.NaN;
// time = T1 (with a -0), R1 (gaps), T2 ("Set As X"), R2 (a gap).
function data(): DataStruct {
  const time = Array.from({ length: N }, (_, i) => (i === 4 ? -0 : i - 1));
  const values = time.map((_, i) => [
    i === 3 || i === 8 ? (null as unknown as number) : 10 * i + 1,
    (N - i) * 1.5,
    i === 6 ? NaN_ : 100 - 3 * i,
  ]);
  return { time, values, labels: ["R1", "T2", "R2"], units: ["", "", ""], metadata: {} };
}

let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200, handle?: string): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(handle ? { "X-Dataset-Handle": handle } : {}) },
  });
const fitBodies = (): Record<string, unknown>[] =>
  fetchMock.mock.calls.filter(([p]) => p === "/api/fitting/fit").map(([, init]) => JSON.parse(String(init.body)));

function setUp(ds: Dataset, yKeys: number[], subset?: { rows: number[]; lo: number; hi: number }): void {
  useApp.setState({
    datasets: [ds], activeId: ds.id, xKey: null, yKeys, seriesOrder: null, errKeys: {},
    analysisResults: [], fitOverlay: null,
  });
  useAnalysisSelection.setState({
    toolId: subset ? "curvefit" : null,
    selection: subset
      ? captureAnalysisSelection({
          datasets: [ds], activeId: ds.id, selectedIds: [ds.id], xKey: null, yKeys, seriesOrder: null, errKeys: {},
          selection: { datasetId: ds.id, rows: subset.rows }, range: { lo: subset.lo, hi: subset.hi, source: "manual" },
        }, "analysis-center")
      : null,
  });
}

/** The array request, then the by-handle request, for the same fit. */
async function bothRequests(): Promise<{ arrays: { x: number[]; y: number[] }; byRows: Record<string, unknown>; held: DataStruct }> {
  const { result } = renderHook(() => useCurveFit());
  await act(async () => result.current.run("fit"));
  expect(result.current.error).toBeNull();
  const arrays = vi.mocked(fitModel).mock.calls[0]![0] as unknown as { x: number[]; y: number[] };
  // The worksheet as it is now (a subset fit records row ids in its metadata).
  const held = useApp.getState().datasets[0]!.data;
  rememberHandle(held, "h-held");
  fetchMock.mockResolvedValueOnce(json({ params: [1, 0], yFit: arrays.x.map(() => 0) }));
  await act(async () => result.current.run("fit"));
  expect(result.current.error).toBeNull();
  expect(vi.mocked(fitModel)).toHaveBeenCalledTimes(1); // the second fit went by handle
  return { arrays, byRows: fitBodies()[0]!, held };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  vi.mocked(fitModel).mockImplementation(async (req) => ({ params: [1, 0], yFit: req.x.map(() => 0) }));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CASES: [string, Partial<Dataset>, number[], { rows: number[]; lo: number; hi: number } | undefined][] = [
  ["the analysis view and its gap drop (and -0 in X)", {}, [0], undefined],
  ["manual exclusions", { excludedRows: [1, 2, 10] }, [0], undefined],
  ["an analysis selection (rows + X range)", { excludedRows: [5] }, [0], { rows: [0, 2, 3, 4, 6, 7, 9, 12], lo: -0.5, hi: 9 }],
  ["per-series X (R2 against T2)", { columnDesignations: { 1: "X" } }, [2], undefined],
];

describe("useCurveFit by dataset handle", () => {
  it.each(CASES)("%s: the rows sent gather to the posted x/y", async (_name, extra, yKeys, subset) => {
    const ds: Dataset = { id: "d1", name: "s.csv", data: data(), ...extra };
    setUp(ds, yKeys, subset);
    const { arrays, byRows, held } = await bothRequests();
    expect(byRows).toMatchObject({ dataset_handle: "h-held", model: "Linear", return_residuals: false });
    expect(byRows).not.toHaveProperty("x");
    expect(byRows).not.toHaveProperty("dataset");
    const got = gatherRows(held, byRows as Parameters<typeof gatherRows>[1]);
    expect(JSON.stringify(got.x)).toBe(JSON.stringify(arrays.x));
    expect(JSON.stringify(got.y)).toBe(JSON.stringify(arrays.y));
  });

  it("sends T2 as the X channel of R2 and -1 (time) otherwise", async () => {
    const own: Dataset = { id: "d1", name: "s.csv", data: data(), columnDesignations: { 1: "X" } };
    setUp(own, [2]);
    expect((await bothRequests()).byRows).toMatchObject({ x_channel: 1, y_channel: 2 });
  });

  it("posts x/y when no handle is known, and resends the dataset once on a 409", async () => {
    const ds: Dataset = { id: "d1", name: "s.csv", data: data() };
    setUp(ds, [0]);
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("fit"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(fitModel)).toHaveBeenCalledTimes(1);

    rememberHandle(ds.data, "h-gone");
    fetchMock.mockResolvedValueOnce(json({ detail: "unknown_dataset_handle" }, 409));
    fetchMock.mockResolvedValueOnce(json({ params: [2, 0], yFit: Array(12).fill(0) }, 200, "h-new"));
    await act(async () => result.current.run("fit"));
    expect(result.current.error).toBeNull();
    expect(result.current.result).toMatchObject({ params: [2, 0] });
    const [miss, retry] = fitBodies();
    expect(miss).toMatchObject({ dataset_handle: "h-gone" });
    expect(retry).not.toHaveProperty("dataset_handle");
    expect(retry!.dataset).toMatchObject({ labels: ["R1", "T2", "R2"] });
    expect(retry!.rows).toEqual(miss!.rows);

    fetchMock.mockResolvedValueOnce(json({ params: [3, 0], yFit: Array(12).fill(0) }));
    await act(async () => result.current.run("fit"));
    expect(fitBodies()[2]).toMatchObject({ dataset_handle: "h-new" }); // the handle it earned
  });

  it("posts x/y when the dataset resend is refused too (413), so the worst case is the old request", async () => {
    const ds: Dataset = { id: "d1", name: "s.csv", data: data() };
    setUp(ds, [0]);
    rememberHandle(ds.data, "h-gone");
    fetchMock.mockResolvedValueOnce(json({ detail: "unknown_dataset_handle" }, 409));
    fetchMock.mockResolvedValueOnce(json({ detail: "request body too large" }, 413));
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("fit"));
    expect(result.current.error).toBeNull();
    expect(fitBodies()).toHaveLength(2);
    expect(vi.mocked(fitModel)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fitModel).mock.calls[0]![0]).toHaveProperty("x");
  });
});
