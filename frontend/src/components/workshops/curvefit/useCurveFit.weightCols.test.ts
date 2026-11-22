// Weights by channel (plans/LARGE_PAYLOAD_PLAN.md): when a fit goes by dataset
// handle and its weights come straight from a column (an error column, a
// manual sigma column, a direct weight column), the request names the column
// (`dy_channel` = |column|, `weights_channel` = the column) instead of
// carrying the vector. The columns read at the rows sent are exactly the
// vector the array request carries, for every selection rule
// (tests/test_api_handle_inputs_more.py pins the server half).
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import { rememberHandle } from "../../../lib/api/datasetCache";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset, DataStruct, WeightMode } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn() }));

const N = 14;
// time, R1 (gaps), T2 ("Set As X"), R2 (a gap), E (sigma), En (negative sigma), W (weights).
function data(): DataStruct {
  const time = Array.from({ length: N }, (_, i) => i - 1);
  const values = time.map((_, i) => [
    i === 3 || i === 8 ? (null as unknown as number) : 10 * i + 1,
    (N - i) * 1.5,
    i === 6 ? Number.NaN : 100 - 3 * i,
    1 + (i % 4) * 0.5,
    -(1 + (i % 4) * 0.5),
    i % 5 === 0 ? 0 : 1 + (i % 3),
  ]);
  return { time, values, labels: ["R1", "T2", "R2", "E", "En", "W"], units: ["", "", "", "", "", ""], metadata: {} };
}

let fetchMock: ReturnType<typeof vi.fn>;
const fitBodies = (): Record<string, unknown>[] =>
  fetchMock.mock.calls.filter(([p]) => p === "/api/fitting/fit").map(([, init]) => JSON.parse(String(init.body)));

function setUp(ds: Dataset, yKeys: number[], errKeys: Record<number, number>, subset?: { rows: number[]; lo: number; hi: number }): void {
  useApp.setState({
    datasets: [ds], activeId: ds.id, xKey: null, yKeys, seriesOrder: null, errKeys,
    analysisResults: [], fitOverlay: null,
  });
  useAnalysisSelection.setState({
    toolId: subset ? "curvefit" : null,
    selection: subset
      ? captureAnalysisSelection({
          datasets: [ds], activeId: ds.id, selectedIds: [ds.id], xKey: null, yKeys, seriesOrder: null, errKeys,
          selection: { datasetId: ds.id, rows: subset.rows }, range: { lo: subset.lo, hi: subset.hi, source: "manual" },
        }, "analysis-center")
      : null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  vi.mocked(fitModel).mockImplementation(async (req) => ({ params: [1, 0], yFit: req.x.map(() => 0) }));
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ params: [1, 0], yFit: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const RULES: [string, Partial<Dataset>, number[], { rows: number[]; lo: number; hi: number } | undefined][] = [
  ["the analysis view and its gap drop", {}, [0], undefined],
  ["manual exclusions", { excludedRows: [1, 2, 10] }, [0], undefined],
  ["an analysis selection", { excludedRows: [5] }, [0], { rows: [0, 2, 3, 4, 6, 7, 9, 12], lo: -0.5, hi: 9 }],
  ["per-series X", { columnDesignations: { 1: "X" } }, [2], undefined],
];
// weight mode, the sigma / weight column it reads, the request fields it uses
const MODES: [WeightMode, number, "dy" | "weights"][] = [
  ["yerr", 3, "dy"],
  ["manual", 4, "dy"], // negative sigma: |column|
  ["direct", 5, "weights"],
];

describe("useCurveFit weights by channel", () => {
  it.each(RULES.flatMap((r) => MODES.map((m) => [...r, ...m] as const)))(
    "%s, %s: the column at the rows sent is the posted vector",
    async (_rule, extra, yKeys, subset, mode, column, field) => {
      const ds: Dataset = { id: "d1", name: "s.csv", data: data(), ...extra };
      setUp(ds, yKeys, { [yKeys[0]!]: column }, subset);
      const { result } = renderHook(() => useCurveFit());
      await act(async () => {
        result.current.setWeightMode(mode);
        if (mode !== "yerr") result.current.setManualKey(column);
      });
      await act(async () => result.current.run("fit"));
      expect(result.current.error).toBeNull();
      const posted = vi.mocked(fitModel).mock.calls[0]![0] as unknown as Record<string, number[]>;
      expect(posted[field]).toHaveLength(posted.x!.length);

      const held = useApp.getState().datasets[0]!.data;
      rememberHandle(held, "h-w");
      await act(async () => result.current.run("fit"));
      expect(vi.mocked(fitModel)).toHaveBeenCalledTimes(1); // the second fit went by handle
      const body = fitBodies()[0]!;
      expect(body).toMatchObject({ dataset_handle: "h-w", [`${field}_channel`]: column });
      expect(body).not.toHaveProperty("dy");
      expect(body).not.toHaveProperty("weights");
      const runs = body.rows as [number, number][];
      const gathered: number[] = [];
      for (const [start, count] of runs) {
        for (let r = start; r < start + count; r++) {
          const v = held.values[r]![column]!;
          gathered.push((field === "dy" ? Math.abs(v) : v) + 0);
        }
      }
      expect(JSON.stringify(gathered)).toBe(JSON.stringify(posted[field]));
    },
  );

  it("keeps a derived (poisson) vector as an array and scale_errors on the wire", async () => {
    const ds: Dataset = { id: "d1", name: "s.csv", data: data() };
    setUp(ds, [0], {});
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      result.current.setWeightMode("poisson");
      result.current.setScaleErrors(false);
    });
    rememberHandle(useApp.getState().datasets[0]!.data, "h-p");
    await act(async () => result.current.run("fit"));
    const body = fitBodies()[0]!;
    expect(body).toMatchObject({ dataset_handle: "h-p", scale_errors: false });
    expect(body.dy).toBeInstanceOf(Array);
    expect(body).not.toHaveProperty("dy_channel");
  });
});
