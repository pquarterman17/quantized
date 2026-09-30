// useCurveFit `fitData`: the (x, y) pairs a completed fit ran on (the rows
// its residuals align to), which the lazy Bands / Diagnostics sections read.
// Null after an auto-guess or a clear, so they never pair a stale fit.

import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { autoGuess, listFitModels } from "../../../lib/api/curvefit";
import { fitModel } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn() }));
vi.mock("../../../lib/api/figures", () => ({ exportCornerFigure: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[100, 10], [200, Number.NaN], [300, 30], [400, 40]],
  labels: ["field", "moment"],
  units: ["Oe", "emu"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  vi.mocked(fitModel).mockResolvedValue({ params: [1, 0], yFit: [11, 31, 41], residuals: [1, 1, 1] });
  vi.mocked(autoGuess).mockResolvedValue({ p0: [1, 0] } as Awaited<ReturnType<typeof autoGuess>>);
  useApp.setState({
    datasets: [{ id: "d1", name: "loop.dat", data: DATA }],
    activeId: "d1",
    xKey: 0,
    yKeys: [1],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
  });
});

describe("useCurveFit fitData", () => {
  it("holds the fitted pairs (gap rows dropped) and their channels after a fit", async () => {
    const { result } = renderHook(() => useCurveFit());
    expect(result.current.fitData).toBeNull();
    await act(async () => result.current.run("fit"));
    expect(result.current.fitData).toEqual({ x: [100, 300, 400], y: [10, 30, 40], xKey: 0, yKey: 1 });
  });

  it("drops back to null after an auto-guess", async () => {
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("fit"));
    await act(async () => result.current.run("guess"));
    expect(result.current.fitData).toBeNull();
  });

  it("drops back to null on clear", async () => {
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("fit"));
    act(() => result.current.clear());
    expect(result.current.fitData).toBeNull();
  });
});
