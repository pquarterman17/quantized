// Curve fit's single Fit on the shared workbench shell (lane WB3): the fit
// stays button-driven (nothing runs on an edit), keeps its defaults and its
// commit paths (FitSpec, macro step, overlay), and now says "out of date" for
// every setting a fit was run with, not only the data. Characterization cases
// first (they passed on the pre-shell hook), then the behaviour the shell adds.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({
  autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[10], [20], [30], [40]], labels: ["y"], units: [""], metadata: {},
};
const NO_PAIRS: DataStruct = { ...DATA, values: [[NaN], [NaN], [NaN], [NaN]] };
const LINEAR = {
  name: "Linear", category: "line", paramNames: ["slope", "intercept"], nParams: 2,
  p0: [1, 0], lb: [null, null], ub: [null, null],
};
const OK = { params: [10, 0], yFit: [10, 20, 30, 40] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [LINEAR, { ...LINEAR, name: "Quadratic" }] });
  vi.mocked(fitModel).mockResolvedValue(OK);
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, errKeys: {}, analysisResults: [], fitOverlay: null,
  });
});

/** Hold the next fit request open; `started` settles when it is made. */
function hold() {
  let land!: (v: typeof OK) => void;
  let mark!: () => void;
  const started = new Promise<void>((r) => { mark = r; });
  vi.mocked(fitModel).mockImplementationOnce(() => { mark(); return new Promise((r) => { land = r; }); });
  return { started, land: (v: typeof OK) => land(v) };
}

async function ready() {
  const hook = renderHook(() => useCurveFit());
  await waitFor(() => expect(hook.result.current.paramRows).toHaveLength(2));
  return hook;
}
type Hook = Awaited<ReturnType<typeof ready>>;
const fit = (h: Hook) => act(async () => { await h.result.current.run("fit"); });

describe("characterization: the button-driven fit", () => {
  it("never fits on an edit; only the Fit button runs", async () => {
    const h = await ready();
    act(() => h.result.current.setParamRow(0, { start: "3" }));
    act(() => h.result.current.setWeightMode("poisson"));
    act(() => h.result.current.setModelName("Quadratic"));
    await act(async () => {});
    expect(fitModel).not.toHaveBeenCalled();
    expect(h.result.current.result).toBeNull();
  });

  it("a run records the FitSpec and draws the overlay", async () => {
    const h = await ready();
    await fit(h);
    expect(fitModel).toHaveBeenCalledTimes(1);
    expect(h.result.current.result).toMatchObject({ params: [10, 0] });
    expect(h.result.current.resultStale).toBe(false);
    expect(h.result.current.busy).toBe(false);
    expect(useApp.getState().datasets[0].fitSpec?.model).toBe("Linear");
    expect(useApp.getState().fitOverlay?.datasetId).toBe("d1");
  });

  it("a backend failure is an error, leaves no result, and the next good run clears it", async () => {
    vi.mocked(fitModel).mockRejectedValueOnce(new Error("did not converge"));
    const h = await ready();
    await fit(h);
    expect(h.result.current.error).toBe("did not converge");
    expect(h.result.current.result).toBeNull();
    expect(useApp.getState().datasets[0].fitSpec).toBeUndefined();
    await fit(h);
    expect(h.result.current.error).toBeNull();
    expect(h.result.current.result).not.toBeNull();
  });

  it("data with no finite pairs is refused without calling the fitter", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: NO_PAIRS }] });
    const h = await ready();
    await fit(h);
    expect(fitModel).not.toHaveBeenCalled();
    expect(h.result.current.error).toMatch(/no finite X\/Y pairs/);
    expect(h.result.current.result).toBeNull();
  });

  it("busy covers the whole request, and a result of another model is not shown", async () => {
    const { land, started } = hold();
    const h = await ready();
    let p!: Promise<void>;
    act(() => { p = h.result.current.run("fit"); });
    await act(async () => { await started; });
    expect(h.result.current.busy).toBe(true);
    await act(async () => { land(OK); await p; });
    expect(h.result.current.busy).toBe(false);
    act(() => h.result.current.setModelName("Quadratic"));
    expect(h.result.current.result).toBeNull();
    act(() => h.result.current.setModelName("Linear"));
    expect(h.result.current.result).not.toBeNull();
    expect(h.result.current.resultStale).toBe(false);
  });
});

describe("shell: out of date, refusals, and races", () => {
  it("editing a start value or a held flag after a run marks it out of date; undoing the edit restores it", async () => {
    const h = await ready();
    const seeded = h.result.current.paramRows[0]!.start;
    await fit(h);
    expect(h.result.current.resultStale).toBe(false);
    act(() => h.result.current.setParamRow(0, { start: "3" }));
    expect(h.result.current.resultStale).toBe(true);
    act(() => h.result.current.setParamRow(0, { start: seeded }));
    expect(h.result.current.resultStale).toBe(false);
    act(() => h.result.current.setParamRow(1, { fixed: true }));
    expect(h.result.current.resultStale).toBe(true);
  });

  it("a fit that lands after a setting changed mid-flight is shown out of date, never current", async () => {
    const { land, started } = hold();
    const h = await ready();
    let p!: Promise<void>;
    act(() => { p = h.result.current.run("fit"); });
    await act(async () => { await started; });
    act(() => h.result.current.setWeightMode("poisson")); // an edit while the request is out
    await act(async () => { land(OK); await p; });
    expect(h.result.current.result).not.toBeNull();
    expect(h.result.current.resultStale).toBe(true);
  });

  it("flags a refusal (validation) apart from a backend failure", async () => {
    const h = await ready();
    vi.mocked(fitModel).mockRejectedValueOnce(new Error("did not converge"));
    await fit(h);
    expect(h.result.current.error).toBe("did not converge");
    expect(h.result.current.refusal).toBe(false);
    act(() => useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: NO_PAIRS }] }));
    await fit(h);
    expect(h.result.current.error).toMatch(/no finite X\/Y pairs/);
    expect(h.result.current.refusal).toBe(true);
  });

  it("an error belongs to the settings it ran with: editing one clears it", async () => {
    vi.mocked(fitModel).mockRejectedValueOnce(new Error("did not converge"));
    const h = await ready();
    await fit(h);
    expect(h.result.current.error).toBe("did not converge");
    act(() => h.result.current.setParamRow(0, { start: "3" }));
    expect(h.result.current.error).toBeNull();
  });

  it("a fit restored on reopen goes out of date when a setting changes after it is shown", async () => {
    const first = await ready();
    await fit(first);
    first.unmount();
    const h = await ready();
    expect(h.result.current.result).not.toBeNull(); // restored from the session
    expect(h.result.current.resultStale).toBe(false);
    act(() => h.result.current.setParamRow(0, { start: "3" }));
    expect(h.result.current.resultStale).toBe(true);
  });

  it("Guess on data with nothing finite is a refusal too", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: NO_PAIRS }] });
    const h = await ready();
    await act(async () => { await h.result.current.run("guess"); });
    expect(h.result.current.error).toMatch(/no finite X\/Y pairs/);
    expect(h.result.current.refusal).toBe(true);
  });

  it("Remove fit (clear) leaves nothing out of date and nothing shown", async () => {
    const h = await ready();
    await fit(h);
    act(() => h.result.current.clear());
    expect(h.result.current.result).toBeNull();
    expect(h.result.current.resultStale).toBe(false);
  });
});
