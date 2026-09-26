// Custom equation model hook (GOTO #1): debounced validation populates the
// parameter table, fits post the analysis view (#50/#53) through
// /api/fitting/equation/fit and expand the overlay, and save/load round-trips
// named models through lib/fitmodels (localStorage).

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitEquation, validateEquation } from "../../../lib/api/curvefit";
import { loadCustomModels, saveCustomModel, type CustomFitModel } from "../../../lib/fitmodels";
import type { DataStruct } from "../../../lib/types";
import { useToasts } from "../../../store/toasts";
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

const NO_DEBOUNCE = { debounceMs: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useToasts.setState({ toasts: [] });
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
      { name: "a", guess: "1", min: "", max: "", fixed: false, unit: "" },
      { name: "t", guess: "1", min: "", max: "", fixed: false, unit: "" },
      { name: "c", guess: "1", min: "", max: "", fixed: false, unit: "" },
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
        { name: "a", guess: "5", min: "", max: "", fixed: false, unit: "" }, // survived, edit kept
        { name: "c", guess: "1", min: "", max: "", fixed: false, unit: "" }, // new, neutral guess
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

  it("drops non-finite pairs before fitting and restores the gap in the overlay", async () => {
    const gapped = { ...DATA, time: [0, Number.NaN, 2, 3] };
    useApp.setState({ datasets: [{ id: "d1", name: "gapped.dat", data: gapped }], activeId: "d1" });
    vi.mocked(fitEquation).mockResolvedValue({ params: [1, 0], yFit: [11, 31, 41] });
    const { result } = await validated();
    await act(async () => result.current.fit());

    expect(fitEquation).toHaveBeenCalledWith({
      equation: "m*x + b",
      x: [0, 2, 3],
      y: [10, 30, 40],
      guesses: [1, 1],
    });
    expect(useApp.getState().fitOverlay?.y).toEqual([11, Number.NaN, 31, 41]);
    expect(useToasts.getState().toasts.at(-1)?.msg).toContain("1 of 4 rows are gaps");
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
    expect(result.current.error).toBe("m: guess is not a number");
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

  async function decayWithRows(rows: [number, "guess" | "min" | "max", string][]) {
    vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["a", "t"] });
    const hook = renderHook(() => useEquationFit(null, NO_DEBOUNCE));
    act(() => {
      hook.result.current.setEquation("a*exp(-x/t)");
    });
    await waitFor(() => expect(hook.result.current.status).toBe("ok"));
    act(() => {
      for (const [i, field, value] of rows) hook.result.current.setRow(i, field, value);
      hook.result.current.setModelName("Decay");
    });
    let saved: CustomFitModel[] | null = [];
    act(() => {
      saved = hook.result.current.save();
    });
    return { saved: saved as CustomFitModel[] | null, error: hook.result.current.error };
  }

  it("a BLANK start is saved as 1 clamped into its bounds — never refused for a guess the user did not type (PR #432 review)", async () => {
    // Was: blank -> 1, then refused as "guess[t]: outside its bounds". (A new
    // row SHOWS "1"; blank means the user cleared the field.)
    const above = await decayWithRows([[1, "guess", ""], [1, "min", "5"]]);
    expect(above.error).toBeNull();
    expect(above.saved?.[0]).toMatchObject({ name: "Decay", guesses: [1, 5], lower: [null, 5], upper: [null, null] });
    const below = await decayWithRows([[0, "guess", "2"], [1, "guess", " "], [1, "max", "0.5"]]);
    expect(below.saved?.[0]).toMatchObject({ guesses: [2, 0.5], upper: [null, 0.5] });
    const inside = await decayWithRows([[1, "guess", ""], [1, "min", "-3"], [1, "max", "3"]]);
    expect(inside.saved?.[0]).toMatchObject({ guesses: [1, 1] });
  });

  it("save refuses what a project/import would refuse — min > max, or a TYPED start outside its bounds", async () => {
    // PR #432 review: the workshop used to save these, and the model then came
    // back from its own project as "could not be read".
    const typed = await decayWithRows([[1, "guess", "2"], [1, "min", "5"]]);
    expect(typed.saved).toBeNull();
    expect(typed.error).toContain("guess[t]: outside its bounds");
    const inverted = await decayWithRows([[1, "min", "5"], [1, "max", "1"]]);
    expect(inverted.saved).toBeNull();
    expect(inverted.error).toContain("bounds[t]: lower > upper");
    expect(loadCustomModels()).toEqual([]);
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
      { name: "a", guess: "2.5", min: "0", max: "", fixed: false, unit: "" },
      { name: "t", guess: "1.7", min: "", max: "100", fixed: false, unit: "" },
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
