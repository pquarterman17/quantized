// Custom equation fit, audit P2.7 slice 1: the hold column reaches the
// request as `fixed`, the before-run summary comes from the validate
// response, and a table that cannot run never reaches the backend.

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitEquation, validateEquation } from "../../../lib/api/curvefit";
import type { TextSpan } from "../../../lib/equationSpan";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useEquationFit } from "./useEquationFit";

vi.mock("../../../lib/api", () => ({
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", () => ({
  validateEquation: vi.fn(),
  fitEquation: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    fitOverlay: null,
  });
});

async function validated() {
  vi.mocked(validateEquation).mockResolvedValue({
    ok: true,
    params: ["m", "b"],
    variable: "x",
    usesX: true,
    functions: ["exp"],
    constants: ["pi"],
  });
  const hook = renderHook(() => useEquationFit(null, { debounceMs: 0 }));
  act(() => {
    hook.result.current.setEquation("m*x + b");
  });
  await waitFor(() => expect(hook.result.current.status).toBe("ok"));
  return hook;
}

describe("useEquationFit hold column + summary (P2.7)", () => {
  it("carries the validate response's summary", async () => {
    const { result } = await validated();
    expect(result.current.summary).toEqual({
      variable: "x",
      usesX: true,
      functions: ["exp"],
      constants: ["pi"],
    });
  });

  it("sends `fixed` when a parameter is held and labels the result", async () => {
    vi.mocked(fitEquation).mockResolvedValue({ params: [10, 1], errors: [0.1, null], yFit: [1, 2, 3, 4] });
    const { result } = await validated();
    act(() => {
      result.current.setRow(1, "guess", "1");
      result.current.setHeld(1, true);
    });
    await act(async () => {
      await result.current.fit();
    });
    expect(fitEquation).toHaveBeenCalledWith({
      equation: "m*x + b",
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      guesses: [1, 1],
      fixed: [false, true],
    });
    expect(result.current.fitHeld).toEqual([false, true]);
    // Editing the table after the fit does not relabel the shown result.
    act(() => {
      result.current.setHeld(1, false);
    });
    expect(result.current.fitHeld).toEqual([false, true]);
  });

  it("refuses to run with every parameter held — no request is sent", async () => {
    const { result } = await validated();
    act(() => {
      result.current.setHeld(0, true);
      result.current.setHeld(1, true);
    });
    expect(result.current.runProblem).toContain("every parameter is held");
    await act(async () => {
      await result.current.fit();
    });
    expect(fitEquation).not.toHaveBeenCalled();
    expect(result.current.error).toContain("every parameter is held");
  });

  it("refuses to run with min above max — no request is sent", async () => {
    const { result } = await validated();
    act(() => {
      result.current.setRow(0, "min", "5");
      result.current.setRow(0, "max", "1");
    });
    expect(result.current.runProblem).toBe("m: min is above max");
    await act(async () => {
      await result.current.fit();
    });
    expect(fitEquation).not.toHaveBeenCalled();
  });

  it("clears the summary when the equation stops validating", async () => {
    const { result } = await validated();
    vi.mocked(validateEquation).mockResolvedValue({ ok: false, params: [], error: "bad" });
    act(() => {
      result.current.setEquation("m*x +");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.summary).toBeNull();
  });

  it("never pairs an error span with text it was not reported for, even for one render", async () => {
    // The render right after a keystroke still has status "error" (the
    // re-validate effect has not run yet); the span must already be gone.
    const seen: { eq: string; span: TextSpan | null; status: string }[] = [];
    vi.mocked(validateEquation).mockResolvedValue({ ok: false, params: [], error: "bad", errorStart: 2, errorEnd: 3 });
    const { result } = renderHook(() => {
      const s = useEquationFit(null, { debounceMs: 0 });
      seen.push({ eq: s.equation, span: s.errorSpan, status: s.status });
      return s;
    });
    act(() => {
      result.current.setEquation("a+;");
    });
    await waitFor(() => expect(result.current.errorSpan).toEqual({ start: 2, end: 3 }));
    vi.mocked(validateEquation).mockReturnValue(new Promise(() => {}));
    act(() => {
      result.current.setEquation("a+;b");
    });
    // The intermediate render this guards really happens ...
    expect(seen.some((r) => r.eq === "a+;b" && r.status === "error")).toBe(true);
    // ... and never carries the old span.
    expect(seen.filter((r) => r.span !== null && r.eq !== "a+;")).toEqual([]);
  });

  it("records a macro step that carries the whole fit setup (P2.7 review)", async () => {
    vi.mocked(fitEquation).mockResolvedValue({ params: [10, 1], errors: [0.1, null], yFit: [1, 2, 3, 4] });
    useApp.setState({ macroRecording: true, macroSteps: [], pipelineRunning: false });
    const { result } = await validated();
    act(() => {
      result.current.setRow(0, "guess", "2");
      result.current.setRow(0, "min", "0");
      result.current.setHeld(1, true);
    });
    await act(async () => {
      await result.current.fit();
    });
    const step = useApp.getState().macroSteps.at(-1);
    expect(step?.kind).toBe("ui");
    expect(step?.code).toBe(
      'qz.fitEquation("m*x + b", { guesses: [2, 1], lower: [0, null], upper: [null, null], fixed: [false, true] })',
    );
    expect(step?.params).toEqual({
      equation: "m*x + b",
      guesses: [2, 1],
      lower: [0, null],
      upper: [null, null],
      fixed: [false, true],
    });
    useApp.setState({ macroRecording: false, macroSteps: [] });
  });

  it("snapshots units at fit time (P2.7 review)", async () => {
    vi.mocked(fitEquation).mockResolvedValue({ params: [10, 1], errors: [0.1, 0.2], yFit: [1, 2, 3, 4] });
    const { result } = await validated();
    act(() => {
      result.current.setRow(0, "unit", " V/s ");
    });
    await act(async () => {
      await result.current.fit();
    });
    expect(result.current.fitUnits).toEqual(["V/s", ""]);
    act(() => {
      result.current.setRow(0, "unit", "mV/s");
    });
    expect(result.current.fitUnits).toEqual(["V/s", ""]);
  });

  it("surfaces a refused save instead of throwing (P2.7 review)", async () => {
    localStorage.setItem("qz.customFitModels", JSON.stringify([{ version: 9, name: "Future" }]));
    const { result } = await validated();
    act(() => {
      result.current.setModelName("Future");
    });
    let out: unknown = "unset";
    act(() => {
      out = result.current.save();
    });
    expect(out).toBeNull();
    expect(result.current.error).toContain('a saved fit model named "Future" could not be read');
  });
});
