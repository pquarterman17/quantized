// P8: Guess (and the equation fit) send the dataset handle + channels + rows
// instead of x/y when the server holds the dataset, like Curve Fit's fit
// (useCurveFit.bySource.test.ts). Per selection rule, the rows sent gather to
// exactly the x/y the array request posts (routes/_datasetrows.py gathers;
// tests/test_api_handle_inputs.py pins the response against the array path).
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { autoGuess, fitEquation, listFitModels, validateEquation } from "../../../lib/api/curvefit";
import { rememberHandle } from "../../../lib/api/datasetCache";
import type { Dataset, DataStruct } from "../../../lib/types";
import { gatherRows } from "../../../test/gatherRows";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";
import { useEquationFit } from "./useEquationFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({
  autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn(), fitEquation: vi.fn(), validateEquation: vi.fn(),
}));

const N = 14;
function data(): DataStruct {
  const time = Array.from({ length: N }, (_, i) => (i === 4 ? -0 : i - 1));
  const values = time.map((_, i) => [i === 3 || i === 8 ? (null as unknown as number) : 10 * i + 1, (N - i) * 1.5, 100 - 3 * i]);
  return { time, values, labels: ["R1", "T2", "R2"], units: ["", "", ""], metadata: {} };
}

let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const bodiesTo = (path: string): Record<string, unknown>[] =>
  fetchMock.mock.calls.filter(([p]) => p === path).map(([, init]) => JSON.parse(String(init.body)));

function setUp(ds: Dataset, yKeys: number[]): void {
  useApp.setState({
    datasets: [ds], activeId: ds.id, xKey: null, yKeys, seriesOrder: null, errKeys: {},
    analysisResults: [], fitOverlay: null,
  });
  useAnalysisSelection.setState({ toolId: null, selection: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  vi.mocked(autoGuess).mockResolvedValue({ p0: [1, 0] });
  vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["m", "b"] });
  vi.mocked(fitModel).mockImplementation(async (req) => ({ params: [1, 0], yFit: req.x.map(() => 0) }));
  vi.mocked(fitEquation).mockImplementation(async (req) => ({ params: [1, 0], yFit: req.x.map(() => 0) }));
  fetchMock = vi.fn(async (_path: string, init: { body: string }) => {
    const rows = (JSON.parse(init.body) as { rows?: [number, number][] }).rows ?? [];
    return json({ p0: [1, 0], params: [1, 0], yFit: Array(rows.reduce((n, [, c]) => n + c, 0)).fill(0) });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CASES: [string, Partial<Dataset>, number[]][] = [
  ["the analysis view and its gap drop (and -0 in X)", {}, [0]],
  ["manual exclusions", { excludedRows: [1, 2, 10] }, [0]],
  ["per-series X (R2 against T2)", { columnDesignations: { 1: "X" } }, [2]],
];

describe("Guess by dataset handle", () => {
  it.each(CASES)("%s: the rows sent gather to the posted x/y", async (_name, extra, yKeys) => {
    const ds: Dataset = { id: "d1", name: "s.csv", data: data(), ...extra };
    setUp(ds, yKeys);
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("guess"));
    expect(fetchMock).not.toHaveBeenCalled(); // no handle yet: the arrays, as before
    const [, ax, ay] = vi.mocked(autoGuess).mock.calls[0]!;

    rememberHandle(ds.data, "h-guess");
    await act(async () => result.current.run("guess"));
    expect(vi.mocked(autoGuess)).toHaveBeenCalledTimes(1);
    const body = bodiesTo("/api/fitting/autoguess")[0]!;
    expect(body).toMatchObject({ dataset_handle: "h-guess" });
    expect(body).not.toHaveProperty("x");
    const got = gatherRows(ds.data, body as Parameters<typeof gatherRows>[1]);
    expect(JSON.stringify(got.x)).toBe(JSON.stringify(ax));
    expect(JSON.stringify(got.y)).toBe(JSON.stringify(ay));
  });

  it("falls back to the arrays when the server keeps refusing the dataset", async () => {
    const ds: Dataset = { id: "d1", name: "s.csv", data: data() };
    setUp(ds, [0]);
    rememberHandle(ds.data, "h-gone");
    fetchMock.mockResolvedValueOnce(json({ detail: "unknown_dataset_handle" }, 409));
    fetchMock.mockResolvedValueOnce(json({ detail: "unknown_dataset_handle" }, 409));
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("guess"));
    expect(result.current.error).toBeNull();
    expect(vi.mocked(autoGuess)).toHaveBeenCalledTimes(1);
  });
});

describe("Equation fit by dataset handle", () => {
  it.each(CASES)("%s: the rows sent gather to the posted x/y", async (_name, extra, yKeys) => {
    const ds: Dataset = { id: "d1", name: "s.csv", data: data(), ...extra };
    setUp(ds, yKeys);
    const hook = renderHook(() => useEquationFit(null, { debounceMs: 0 }));
    act(() => {
      hook.result.current.setEquation("m*x + b");
    });
    await waitFor(() => expect(hook.result.current.status).toBe("ok"));
    await act(async () => hook.result.current.fit());
    expect(fetchMock).not.toHaveBeenCalled();
    const arrays = vi.mocked(fitEquation).mock.calls[0]![0];

    const held = useApp.getState().datasets[0]!.data;
    rememberHandle(held, "h-eq");
    await act(async () => hook.result.current.fit());
    expect(hook.result.current.error).toBeNull();
    expect(vi.mocked(fitEquation)).toHaveBeenCalledTimes(1);
    const body = bodiesTo("/api/fitting/equation/fit")[0]!;
    expect(body).toMatchObject({ dataset_handle: "h-eq", equation: "m*x + b", return_residuals: false });
    expect(body).not.toHaveProperty("x");
    expect(body).not.toHaveProperty("display_points"); // the display curve stays off for equations
    const got = gatherRows(held, body as Parameters<typeof gatherRows>[1]);
    expect(JSON.stringify(got.x)).toBe(JSON.stringify(arrays.x));
    expect(JSON.stringify(got.y)).toBe(JSON.stringify(arrays.y));
    expect(hook.result.current.result?.residuals).toHaveLength(arrays.y.length); // restored from y - yFit
  });
});
