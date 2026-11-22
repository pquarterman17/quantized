// Bumps / DREAM (Curve fit) on the workbench shell's out-of-date contract (lane
// WB5). Still a button on its own session store and job; the result is stamped
// with the model, plotted channels, dataset rows / data and (DREAM) sampling
// budget it was LAUNCHED with. When any of them moves it is out of date: marked,
// its fitted curve taken off the plot, its table withheld.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBumps, type BumpsFitResult } from "../../../lib/fitbumps";
import * as jobs from "../../../lib/jobs";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { resetBumpsFitSession, useBumpsFit } from "./useBumpsFit";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/fitbumps", () => ({ fitBumps: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/jobs")>();
  return { ...actual, pollJob: vi.fn(), cancelJob: vi.fn() };
});

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[1, 5], [2, 6], [3, 7], [4, 8]], labels: ["a", "b"], units: ["", ""], metadata: {},
};
const DS: Dataset = { id: "d1", name: "run.dat", data: DATA };
const FIT: BumpsFitResult = {
  engine: "lm", popt: [1], uncertainties: [0.1], chisq: 1, uncertainty_kind: "hessian", paramNames: ["m"], yFit: [1, 2, 3, 4],
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  resetBumpsFitSession();
  vi.mocked(fitBumps).mockResolvedValue(FIT);
  useApp.setState({ datasets: [DS], activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null, fitOverlay: null });
});

async function fitted(model = "Linear") {
  const hook = renderHook(({ m }) => useBumpsFit(m), { initialProps: { m: model } });
  act(() => hook.result.current.setEngine("lm"));
  await act(async () => hook.result.current.run(model));
  expect(hook.result.current.result).not.toBeNull();
  return hook;
}

describe("useBumpsFit out of date", () => {
  it("characterization: a fresh result is current, drawn, and unchanged by unrelated edits", async () => {
    const { result } = await fitted();
    expect(result.current.stale).toBe(false);
    expect(useApp.getState().fitOverlay?.y).toEqual([1, 2, 3, 4]);
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, name: "renamed.dat" })) })));
    expect(result.current.stale).toBe(false);
  });

  it("a model pick, plotted channel, row exclusion or data edit marks it and takes its curve off the plot", async () => {
    const { result, rerender } = await fitted();
    rerender({ m: "Quadratic" });
    expect(result.current.stale).toBe(true);
    await waitFor(() => expect(useApp.getState().fitOverlay).toBeNull());
    rerender({ m: "Linear" });
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState({ yKeys: [1] }));
    expect(result.current.stale).toBe(true);
    act(() => useApp.setState({ yKeys: [0] }));
    expect(result.current.stale).toBe(false);

    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.stale).toBe(true);
  });

  it("a DREAM sampling-budget change marks a DREAM result; the budget is not an input of the other engines", async () => {
    const { result } = await fitted();
    act(() => result.current.setDream({ samples: 5000 }));
    expect(result.current.stale).toBe(false); // lm: the budget is unused
    vi.mocked(fitBumps).mockResolvedValue({ job_id: "j1" });
    vi.mocked(jobs.pollJob).mockResolvedValue({ ...FIT, engine: "dream", uncertainty_kind: "posterior" });
    act(() => result.current.setEngine("dream"));
    await act(async () => result.current.run("Linear"));
    expect(result.current.stale).toBe(false);
    act(() => result.current.setDream({ burn: 7 }));
    expect(result.current.stale).toBe(true);
  });

  it("running again clears the mark and draws the new fit", async () => {
    const { result, rerender } = await fitted();
    rerender({ m: "Quadratic" });
    await act(async () => result.current.run("Quadratic"));
    expect(result.current.stale).toBe(false);
    expect(useApp.getState().fitOverlay?.y).toEqual([1, 2, 3, 4]);
  });

  it("forced race: a model picked while the fit runs leaves the landed fit out of date and undrawn", async () => {
    let land!: (r: BumpsFitResult) => void;
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    vi.mocked(fitBumps).mockImplementationOnce(() => { began(); return new Promise((r) => { land = r as never; }); });
    const { result, rerender } = renderHook(({ m }) => useBumpsFit(m), { initialProps: { m: "Linear" } });
    act(() => result.current.setEngine("lm"));
    let p!: Promise<void>;
    act(() => { p = result.current.run("Linear"); });
    await started;
    rerender({ m: "Quadratic" });
    await act(async () => { land(FIT); await p; });
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(true);
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("a lazy book is resolved before the run is stamped: the landed fit is current", async () => {
    makePending(DS);
    const { result } = await fitted();
    expect(result.current.stale).toBe(false);
  });
});
