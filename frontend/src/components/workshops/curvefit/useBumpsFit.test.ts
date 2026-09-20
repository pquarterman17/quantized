import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBumps } from "../../../lib/fitbumps";
import type { DataStruct } from "../../../lib/types";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useBumpsFit } from "./useBumpsFit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/fitbumps", () => ({ fitBumps: vi.fn() }));

const GAPPED: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [Number.NaN], [30], [40]],
  labels: ["signal"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "gapped.dat", data: GAPPED }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    fitOverlay: null,
  });
});

describe("useBumpsFit gap rows", () => {
  it("sends only finite pairs and scatters the fitted curve back over the gap", async () => {
    vi.mocked(fitBumps).mockResolvedValue({
      engine: "lm",
      popt: [1],
      uncertainties: [0.1],
      chisq: 1,
      uncertainty_kind: "hessian",
      paramNames: ["m"],
      yFit: [11, 31, 41],
    });
    const { result } = renderHook(() => useBumpsFit());
    act(() => result.current.setEngine("lm"));
    await act(async () => result.current.run("Linear"));

    expect(fitBumps).toHaveBeenCalledWith({
      model: "Linear",
      x: [0, 2, 3],
      y: [10, 30, 40],
      engine: "lm",
    });
    expect(useApp.getState().fitOverlay?.y).toEqual([11, Number.NaN, 31, 41]);
    expect(useToasts.getState().toasts.at(-1)?.msg).toBe(
      "1 of 4 rows are gaps; they were excluded from the fit.",
    );
  });
});
