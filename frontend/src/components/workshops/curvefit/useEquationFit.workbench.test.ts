// Custom equation fit on the workbench shell's manual mode (lane WB4): still
// the Fit button only (no run on an edit), same request / macro / overlay; the
// result is out of date once the equation, the start / bound / hold table or
// the data it ran with change; an answer for inputs that changed in flight is
// dropped (forced with a held request); validation failures are refusals.

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitEquation, validateEquation } from "../../../lib/api/curvefit";
import type { CalcResult, DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useEquationFit } from "./useEquationFit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ validateEquation: vi.fn(), fitEquation: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[10, 1], [20, 2], [30, 3], [40, 4]], labels: ["y", "y2"], units: ["", ""], metadata: {},
};
const FIT: CalcResult = { params: [10, 0], yFit: [10, 20, 30, 40], paramNames: ["m", "b"] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(fitEquation).mockResolvedValue(FIT);
  vi.mocked(validateEquation).mockImplementation(async (eq: string) => ({ ok: true, params: eq.includes("c") ? ["m", "b", "c"] : ["m", "b"] }));
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null, fitOverlay: null, macroRecording: true, macroSteps: [], pipelineRunning: false,
  });
});

async function ready() {
  const hook = renderHook(() => useEquationFit(null, { debounceMs: 0 }));
  act(() => hook.result.current.setEquation("m*x + b"));
  await waitFor(() => expect(hook.result.current.status).toBe("ok"));
  return hook;
}
type Hook = Awaited<ReturnType<typeof ready>>;
const fit = (h: Hook) => act(async () => { await h.result.current.fit(); });

describe("useEquationFit on the workbench shell", () => {
  it("characterization: an edit never fits; only fit() does, and Clear drops result and overlay", async () => {
    const h = await ready();
    act(() => h.result.current.setRow(0, "guess", "5"));
    await act(async () => {});
    expect(fitEquation).not.toHaveBeenCalled();
    await fit(h);
    expect(fitEquation).toHaveBeenCalledTimes(1);
    expect(h.result.current.result?.params).toEqual([10, 0]);
    expect(h.result.current.stale).toBe(false);
    expect(useApp.getState().fitOverlay?.datasetId).toBe("d1");
    act(() => h.result.current.clear());
    expect(h.result.current.result).toBeNull();
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("a failed fit keeps the earlier result visible beside its error (as before)", async () => {
    const h = await ready();
    await fit(h);
    vi.mocked(fitEquation).mockRejectedValueOnce(new Error("did not converge"));
    await fit(h);
    expect(h.result.current.error).toBe("did not converge");
    expect(h.result.current.refusal).toBe(false);
    expect(h.result.current.result?.params).toEqual([10, 0]);
  });

  it("a table that cannot be parsed is a refusal", async () => {
    const h = await ready();
    act(() => h.result.current.setRow(0, "guess", "abc"));
    await fit(h);
    expect(h.result.current.error).toBeTruthy();
    expect(h.result.current.refusal).toBe(true);
    expect(fitEquation).not.toHaveBeenCalled();
  });

  it("the result is out of date after a guess, bound, hold, equation or channel change, not a unit label", async () => {
    const h = await ready();
    await fit(h);
    expect(h.result.current.stale).toBe(false);

    act(() => h.result.current.setRow(0, "unit", "eV"));
    expect(h.result.current.stale).toBe(false);

    act(() => h.result.current.setRow(0, "guess", "5"));
    expect(h.result.current.stale).toBe(true);
    act(() => h.result.current.setRow(0, "guess", ""));
    expect(h.result.current.stale).toBe(false);

    act(() => h.result.current.setRow(1, "max", "9"));
    expect(h.result.current.stale).toBe(true);
    act(() => h.result.current.setRow(1, "max", ""));
    act(() => h.result.current.setHeld(0, true));
    expect(h.result.current.stale).toBe(true);
    act(() => h.result.current.setHeld(0, false));
    expect(h.result.current.stale).toBe(false);

    act(() => useApp.setState({ yKeys: [1] }));
    expect(h.result.current.stale).toBe(true);
    act(() => useApp.setState({ yKeys: [0] }));
    expect(h.result.current.stale).toBe(false);

    act(() => h.result.current.setEquation("m*x + b + c"));
    await waitFor(() => expect(h.result.current.rows).toHaveLength(3));
    expect(h.result.current.stale).toBe(true);
    expect(h.result.current.result).not.toBeNull(); // still shown, marked
    await fit(h);
    expect(h.result.current.stale).toBe(false);
  });

  it("forced race: a fit whose inputs changed in flight is dropped (no result, overlay or macro step)", async () => {
    const h = await ready();
    let land!: (r: CalcResult) => void;
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    vi.mocked(fitEquation).mockImplementationOnce(() => { began(); return new Promise((r) => { land = r; }); });
    let p!: Promise<void>;
    act(() => { p = h.result.current.fit(); });
    await started;
    expect(h.result.current.busy).toBe(true);
    act(() => h.result.current.setRow(0, "guess", "5"));
    land(FIT);
    await act(async () => { await p; });
    expect(h.result.current.busy).toBe(false);
    expect(h.result.current.result).toBeNull();
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().macroSteps).toHaveLength(0);
  });
});
