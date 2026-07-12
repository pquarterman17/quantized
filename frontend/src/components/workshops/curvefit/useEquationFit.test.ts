// Custom equation model hook (GOTO #1): debounced validation populates the
// parameter table, fits post the analysis view (#50/#53) through
// /api/fitting/equation/fit and expand the overlay, and save/load round-trips
// named models through lib/fitmodels (localStorage).

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitEquation, validateEquation } from "../../../lib/api";
import { loadCustomModels, saveCustomModel, type CustomFitModel } from "../../../lib/fitmodels";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useEquationFit } from "./useEquationFit";

vi.mock("../../../lib/api", () => ({
  validateEquation: vi.fn(),
  fitEquation: vi.fn(),
  fetchBookData: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

const NO_DEBOUNCE = { debounceMs: 0 };

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

describe("useEquationFit validation", () => {
  it("debounced validate populates the parameter table with neutral guesses", async () => {
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["a", "t", "c"] });
    const { result } = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    act(() => {
      result.current.setEquation("a*exp(-x/t)+c");
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(validateEquation).toHaveBeenCalledWith("a*exp(-x/t)+c");
    expect(result.current.rows).toEqual([
      { name: "a", guess: "1", min: "", max: "" },
      { name: "t", guess: "1", min: "", max: "" },
      { name: "c", guess: "1", min: "", max: "" },
    ]);
  });

  it("surfaces a validation error (unknown symbol) without rows", async () => {
    vi.mocked(validateEquation).mockResolvedValue({
      ok: false,
      params: [],
      error: 'Unknown function "foo". Known functions: exp, log',
    });
    const { result } = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    act(() => {
      result.current.setEquation("a*foo(x)");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.validationError).toContain('Unknown function "foo"');
    expect(result.current.rows).toEqual([]);
  });

  it("keeps edited guesses for parameters that survive a re-validate", async () => {
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["a", "b"] });
    const { result } = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    act(() => {
      result.current.setEquation("a + b*x");
    });
    await waitFor(() => expect(result.current.rows.length).toBe(2));
    act(() => {
      result.current.setRow(0, "guess", "5");
    });
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["a", "c"] });
    act(() => {
      result.current.setEquation("a + c*x^2");
    });
    await waitFor(() =>
      expect(result.current.rows).toEqual([
        { name: "a", guess: "5", min: "", max: "" }, // survived, edit kept
        { name: "c", guess: "1", min: "", max: "" }, // new, neutral guess
      ]),
    );
  });

  it("an empty equation resets to idle", async () => {
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["a"] });
    const { result } = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    act(() => {
      result.current.setEquation("a*x");
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    act(() => {
      result.current.setEquation("");
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.rows).toEqual([]);
    expect(validateEquation).toHaveBeenCalledTimes(1);
  });
});

describe("useEquationFit fitting", () => {
  async function validated(equation = "m*x + b", params = ["m", "b"]) {
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params });
    const hook = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    act(() => {
      hook.result.current.setEquation(equation);
    });
    await waitFor(() => expect(hook.result.current.status).toBe("ok"));
    return hook;
  }

  it("fits the analysis rows and expands the overlay back to full length (#50/#53)", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [1] }],
      activeId: "d1",
      fitOverlay: null,
    });
    vi.mocked(fitEquation).mockResolvedValue({
      params: [10, 1],
      yFit: [11, 31, 41],
      paramNames: ["m", "b"],
    });
    const { result } = await validated();
    await act(async () => {
      await result.current.fit();
    });
    expect(fitEquation).toHaveBeenCalledWith({
      equation: "m*x + b",
      x: [0, 2, 3],
      y: [10, 30, 40],
      guesses: [1, 1],
    });
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [11, null, 31, 41] });
    expect(result.current.result?.params).toEqual([10, 1]);
  });

  it("fits the primary plotted X/Y channels instead of time/values[0]", async () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 3],
      values: [[100, 10, 5], [200, 20, 6], [300, 30, 7], [400, 40, 8]],
      labels: ["field", "moment", "aux"],
      units: ["Oe", "emu", ""],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "loop.dat", data: multi }],
      activeId: "d1",
      xKey: 0,
      yKeys: [2, 1],
      seriesOrder: [1, 2],
      fitOverlay: null,
    });
    vi.mocked(fitEquation).mockResolvedValue({ params: [1, 0], yFit: [11, 21, 31, 41] });
    const { result } = await validated();
    await act(async () => {
      await result.current.fit();
    });
    // plot X = field (channel 0); primary Y after ordering = moment (channel 1).
    expect(fitEquation).toHaveBeenCalledWith({
      equation: "m*x + b",
      x: [100, 200, 300, 400],
      y: [10, 20, 30, 40],
      guesses: [1, 1],
    });
  });

  it("posts edited guesses and bounds (empty side = null; all-empty omitted)", async () => {
    vi.mocked(fitEquation).mockResolvedValue({ params: [2, 1], yFit: [10, 20, 30, 40] });
    const { result } = await validated();
    act(() => {
      result.current.setRow(0, "guess", "2");
      result.current.setRow(1, "guess", "3");
      result.current.setRow(0, "min", "0");
      result.current.setRow(1, "max", "10");
    });
    await act(async () => {
      await result.current.fit();
    });
    expect(fitEquation).toHaveBeenCalledWith({
      equation: "m*x + b",
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      guesses: [2, 3],
      lower: [0, null],
      upper: [null, 10],
    });
  });

  it("a non-numeric guess blocks the fit with a clear error", async () => {
    const { result } = await validated();
    act(() => {
      result.current.setRow(0, "guess", "abc");
    });
    await act(async () => {
      await result.current.fit();
    });
    expect(fitEquation).not.toHaveBeenCalled();
    expect(result.current.error).toContain('guess for "m"');
  });

  it("surfaces a backend fit failure (e.g. 422) as an error", async () => {
    vi.mocked(fitEquation).mockRejectedValue(new Error("equation has no free parameters to fit"));
    const { result } = await validated();
    await act(async () => {
      await result.current.fit();
    });
    expect(result.current.error).toContain("no free parameters");
    expect(result.current.busy).toBe(false);
  });

  it("clear drops the result and the overlay", async () => {
    vi.mocked(fitEquation).mockResolvedValue({ params: [2, 1], yFit: [10, 20, 30, 40] });
    const { result } = await validated();
    await act(async () => {
      await result.current.fit();
    });
    expect(useApp.getState().fitOverlay).not.toBeNull();
    act(() => {
      result.current.clear();
    });
    expect(result.current.result).toBeNull();
    expect(useApp.getState().fitOverlay).toBeNull();
  });
});

describe("useEquationFit saved models", () => {
  it("save persists a named model with the table's guesses/bounds", async () => {
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["a", "t"] });
    const { result } = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    act(() => {
      result.current.setEquation("a*exp(-x/t)");
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    act(() => {
      result.current.setRow(0, "guess", "2.5");
      result.current.setRow(1, "min", "0");
      result.current.setModelName("MyDecay");
    });
    let list: CustomFitModel[] | null = null;
    act(() => {
      list = result.current.save();
    });
    expect(list).toHaveLength(1);
    expect(loadCustomModels()).toEqual([
      {
        version: 1,
        name: "MyDecay",
        equation: "a*exp(-x/t)",
        params: ["a", "t"],
        guesses: [2.5, 1],
        lower: [null, 0],
        upper: [null, null],
      },
    ]);
  });

  it("save is a no-op without a name or a valid equation", () => {
    const { result } = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    expect(result.current.save()).toBeNull();
    expect(loadCustomModels()).toEqual([]);
  });

  it("an initial saved model prefills equation, name, and table", async () => {
    const saved: CustomFitModel = {
      version: 1,
      name: "MyDecay",
      equation: "a*exp(-x/t)",
      params: ["a", "t"],
      guesses: [2.5, 1.7],
      lower: [0, null],
      upper: [null, 100],
    };
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["a", "t"] });
    const { result } = renderHook(() => useEquationFit(saved, NO_DEBOUNCE));
    expect(result.current.equation).toBe("a*exp(-x/t)");
    expect(result.current.modelName).toBe("MyDecay");
    // The mount re-validate must keep the saved guesses/bounds (matched by name).
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.rows).toEqual([
      { name: "a", guess: "2.5", min: "0", max: "" },
      { name: "t", guess: "1.7", min: "", max: "100" },
    ]);
  });

  it("remove deletes the model from storage", () => {
    saveCustomModel({
      version: 1,
      name: "Gone",
      equation: "a*x",
      params: ["a"],
      guesses: [1],
      lower: [null],
      upper: [null],
    });
    const { result } = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    let list: CustomFitModel[] = [];
    act(() => {
      list = result.current.remove("Gone");
    });
    expect(list).toEqual([]);
    expect(loadCustomModels()).toEqual([]);
  });
});
