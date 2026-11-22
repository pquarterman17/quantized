// Global fit on the workbench shell's out-of-date pattern (lane WB4). The fit
// stays a button on the poll-model job (so no useWorkbenchPreview); its result
// is stamped with the picks, ticks, start / bound table, model and member data
// it was launched with. Once any of them changes it is out of date: not drawn
// on the plot, not reported, and its Show is off. A change made while the job
// runs leaves the landed result out of date (forced with a held poll).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { globalFitJob, type GlobalFitResult } from "../../../lib/api/globalFit";
import { reportEmit } from "../../../lib/api/report";
import { pollJob } from "../../../lib/jobs";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useGlobalFit, type GlobalModel } from "./useGlobalFit";

vi.mock("../../../lib/api/globalFit", () => ({ globalFitJob: vi.fn(), compareDatasetsJob: vi.fn() }));
vi.mock("../../../lib/api/report", () => ({ reportEmit: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/jobs")>();
  return { ...actual, pollJob: vi.fn(), cancelJob: vi.fn() };
});

const D1: Dataset = {
  id: "d1",
  name: "run1.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [[0, 1, 2], [1, 3, 4], [2, 5, 8], [3, 7, 11]],
    labels: ["x", "A", "B"], units: ["", "", ""], metadata: {},
  },
};
const MODEL: GlobalModel = { name: "Linear", paramNames: ["m", "b"], p0: [1, 0], lb: [null, null], ub: [null, null] };
const FIT: GlobalFitResult = {
  paramNames: ["m", "b"], params: [[2, 1], [3, 1]], errors: [[0.1, 0.05], [0.2, 0.05]],
  shared: [{ name: "b", paramIdx: 1, datasets: [0, 1], value: 1, error: 0.05 }],
  yFit: [[1, 3, 5, 7], [2, 4, 7, 10]], R2: [0.99, 0.98], RMSE: [0.1, 0.2],
  chiSqRed: 1.5, nTotal: 8, nFree: 3, exitFlag: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(globalFitJob).mockResolvedValue({ job_id: "j1" });
  vi.mocked(pollJob).mockResolvedValue(FIT);
  vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t" } as never });
  useApp.setState({
    datasets: [D1], activeId: "d1", selectedIds: ["d1"], xKey: 0, yKeys: [1, 2], seriesOrder: null, fitOverlay: null, reports: [],
  });
});

async function fitted() {
  const hook = renderHook(() => useGlobalFit(MODEL));
  await act(() => hook.result.current.run());
  await waitFor(() => expect(hook.result.current.result).not.toBeNull());
  return hook;
}

describe("useGlobalFit freshness", () => {
  it("a fresh result is not stale, and Show / the plot overlay are unchanged", async () => {
    const { result } = await fitted();
    expect(result.current.stale).toBe(false);
    expect(useApp.getState().fitOverlay?.datasetId).toBe("d1");
  });

  it("an edit to the table, ticks, picks or member data marks it out of date; undoing it restores it", async () => {
    const { result } = await fitted();
    act(() => result.current.setRow(0, { min: "0" }));
    expect(result.current.stale).toBe(true);
    act(() => result.current.setRow(0, { min: "" }));
    expect(result.current.stale).toBe(false);

    act(() => result.current.setShared(1, true));
    expect(result.current.stale).toBe(true);
    act(() => result.current.setShared(1, false));
    expect(result.current.stale).toBe(false);

    act(() => result.current.togglePick("d1:2"));
    expect(result.current.stale).toBe(true);
    act(() => result.current.togglePick("d1:2"));
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.stale).toBe(true);
  });

  it("an out-of-date result is taken off the plot, cannot be reported and cannot be shown", async () => {
    const { result } = await fitted();
    act(() => result.current.setShared(1, true));
    await waitFor(() => expect(useApp.getState().fitOverlay).toBeNull());
    await act(() => result.current.toReport());
    expect(reportEmit).not.toHaveBeenCalled();
    act(() => result.current.show(1));
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(result.current.result).not.toBeNull(); // still shown, marked
  });

  it("running again clears the mark and draws the new fit", async () => {
    const { result } = await fitted();
    act(() => result.current.setShared(1, true));
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(useApp.getState().fitOverlay?.datasetId).toBe("d1");
    await act(() => result.current.toReport());
    expect(reportEmit).toHaveBeenCalledTimes(1);
  });

  it("forced race: a table edited while the job runs leaves the landed fit out of date and undrawn", async () => {
    let land!: (r: GlobalFitResult) => void;
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    vi.mocked(pollJob).mockImplementationOnce(() => { began(); return new Promise((r) => { land = r as never; }); });
    const { result } = renderHook(() => useGlobalFit(MODEL));
    let p!: Promise<void>;
    act(() => { p = result.current.run(); });
    await started;
    act(() => result.current.setRow(0, { min: "0" }));
    land(FIT);
    await act(async () => { await p; });
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(true);
    expect(useApp.getState().fitOverlay).toBeNull();
    await act(() => result.current.toReport());
    expect(reportEmit).not.toHaveBeenCalled();
  });
});
