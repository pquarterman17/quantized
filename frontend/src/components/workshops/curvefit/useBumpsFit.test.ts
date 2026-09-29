import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBumps } from "../../../lib/fitbumps";
import * as jobs from "../../../lib/jobs";
import type { DataStruct } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useBumpsFit } from "./useBumpsFit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/fitbumps", () => ({ fitBumps: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/jobs")>();
  return { ...actual, pollJob: vi.fn(), cancelJob: vi.fn() };
});

const GAPPED: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [Number.NaN], [30], [40]],
  labels: ["signal"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
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

describe("useBumpsFit DREAM job in the shared StatusBar ops", () => {
  it("registers one op for the run, shows the polled percent, and cancels the job from it", async () => {
    vi.mocked(fitBumps).mockResolvedValue({ job_id: "dream-1" });
    let finish!: (v: unknown) => void;
    vi.mocked(jobs.pollJob).mockImplementation((_id, cb) => {
      cb?.(0.25, "sampling");
      return new Promise((r) => {
        finish = r;
      });
    });
    const { result } = renderHook(() => useBumpsFit());
    act(() => result.current.setEngine("dream"));
    let p!: Promise<void>;
    act(() => {
      p = result.current.run("Linear");
    });
    await waitFor(() => expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Bumps DREAM fit 25%"]));
    usePendingOps.getState().ops[0].cancel?.();
    expect(jobs.cancelJob).toHaveBeenCalledWith("dream-1");
    finish({ engine: "dream", popt: [1], uncertainties: [0.1], chisq: 1, uncertainty_kind: "posterior", paramNames: ["m"] });
    await act(async () => {
      await p;
    });
    expect(usePendingOps.getState().ops).toEqual([]);
  });

  it("a synchronous engine shows a busy op with no Cancel control", async () => {
    let done!: (v: Awaited<ReturnType<typeof fitBumps>>) => void;
    vi.mocked(fitBumps).mockReturnValue(new Promise((r) => {
      done = r;
    }));
    const { result } = renderHook(() => useBumpsFit());
    act(() => result.current.setEngine("lm"));
    let p!: Promise<void>;
    act(() => {
      p = result.current.run("Linear");
    });
    await waitFor(() => expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Bumps lm fit"]));
    expect(usePendingOps.getState().ops[0].cancel).toBeUndefined();
    done({ engine: "lm", popt: [1], uncertainties: [0.1], chisq: 1, uncertainty_kind: "hessian", paramNames: ["m"], yFit: [11, 31, 41] });
    await act(async () => {
      await p;
    });
    expect(usePendingOps.getState().ops).toEqual([]);
  });
});
