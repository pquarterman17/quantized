// P4 phase 3: "Fit each" sends the dataset handle, the X/Y channel and the
// rows instead of x/y for every peak when the server holds the dataset
// (lib/fitSource; the rows are pinned against x/y in peakInputs.rows.test.ts).
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak, fitPeak } from "../../../lib/api/peaks";
import { rememberHandle } from "../../../lib/api/datasetCache";
import type { DataStruct, Peak } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { usePeaks } from "./usePeaks";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};
const pk = (center: number): Peak => ({ center, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 });
const FIT = { success: true, reason: "", center: 1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, params: [], model: "Lorentzian", window: [0, 2] };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA, excludedRows: [4] }], activeId: "d1",
    xKey: null, yKeys: null, seriesOrder: null, peakOverlay: null, annotations: [],
  });
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [pk(1), pk(3)], background: [] });
  // The find now goes by handle as well (P8), so the fetch answers both routes.
  fetchMock = vi.fn(async (path: string) => new Response(
    JSON.stringify(path === "/api/peaks/find" ? { peaks: [pk(1), pk(3)], background: [0, 0, 0, 0, 0] }
      : path === "/api/peaks/fit-multi" ? { peaks: [], bgCoeffs: [0, 0], R2: 1, rmse: 0 } : FIT),
    { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePeaks fitEach by dataset handle", () => {
  it("names the dataset instead of posting x/y, once per peak", async () => {
    rememberHandle(DATA, "h-peaks");
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => result.current.fitEach({ model: "Lorentzian", bgDegree: 1, linkMode: "None", constrain: false }));
    expect(fitPeak).not.toHaveBeenCalled();
    const bodies = fetchMock.mock.calls.filter(([path]) => path === "/api/peaks/fit").map(([path, init]) => [path, JSON.parse(String(init.body))]);
    expect(bodies).toHaveLength(2);
    for (const [path, body] of bodies) {
      expect(path).toBe("/api/peaks/fit");
      expect(body).toMatchObject({ dataset_handle: "h-peaks", x_channel: -1, y_channel: 0, rows: [[0, 4], [5, 1]] });
      expect(body).not.toHaveProperty("x");
    }
    expect(result.current.fitResult?.peaks).toHaveLength(2);
  });

  it("finds peaks by handle too, with the lean background left off", async () => {
    rememberHandle(DATA, "h-find");
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    expect(findPeaks).not.toHaveBeenCalled();
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/peaks/find");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ dataset_handle: "h-find", x_channel: -1, y_channel: 0, rows: [[0, 4], [5, 1]] });
    expect(body).not.toHaveProperty("x");
    expect(body).not.toHaveProperty("return_background"); // curation reads the background synchronously
  });

  it("fits simultaneously by handle too, and by arrays without one", async () => {
    rememberHandle(DATA, "h-multi");
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => result.current.fitTogether({ model: "Lorentzian", bgDegree: 1, linkMode: "None", constrain: false }));
    expect(fitMultiPeak).not.toHaveBeenCalled();
    const call = fetchMock.mock.calls.find(([path]) => path === "/api/peaks/fit-multi");
    const body = JSON.parse(String(call![1].body));
    expect(body).toMatchObject({ dataset_handle: "h-multi", x_channel: -1, y_channel: 0, rows: [[0, 4], [5, 1]], model: "Lorentzian" });
    expect(body).not.toHaveProperty("x");
    expect(body).not.toHaveProperty("y");
  });
});
