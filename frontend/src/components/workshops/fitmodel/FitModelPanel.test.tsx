import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsFitModel, type FitModelResponse } from "../../../lib/api/statsModel";
import type { Dataset } from "../../../lib/types";
import { useFitModelStore } from "../../../store/fitModel";
import { useApp } from "../../../store/useApp";
import FitModelPanel from "./FitModelPanel";

vi.mock("../../../lib/api/statsModel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsModel")>()),
  statsFitModel: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

// sub (categorical Si/MgO), T (continuous), a (response). Row 1 is excluded.
const DS: Dataset = {
  id: "d1", name: "growth.csv",
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [[0, 500, 3.90], [1, 600, 9.99], [0, 700, 3.95], [1, 550, 3.92], [0, 650, 3.94], [1, 620, 3.93]],
    labels: ["sub", "T", "a"], units: ["", "C", "Å"], metadata: { x_column_name: "run" },
    cat_levels: { 0: ["Si", "MgO"] },
  },
  excludedRows: [1],
};

function fitFor(n: number): FitModelResponse {
  return {
    response: "a", n, n_dropped_missing: 0,
    summary: { r2: 0.875, adj_r2: 0.75, rmse: 0.01, mean_response: 3.93, n },
    anova: [
      { source: "Model", df: 2, ss: 0.001, ms: 0.0005, f: 7, p: 0.125 },
      { source: "Error", df: n - 3, ss: 0.0002, ms: 0.0001, f: null, p: null },
      { source: "C. Total", df: n - 1, ss: 0.0012, ms: null, f: null, p: null },
    ],
    parameter_estimates: [
      { term: "Intercept", estimate: 3.8, se: 0.05, t: 76, p: 0.0002, lower: 3.6, upper: 4 },
      { term: "sub[Si]", estimate: 0.004, se: 0.005, t: 0.8, p: 0.5, lower: -0.02, upper: 0.03 },
      { term: "T", estimate: 0.0002, se: 0.0001, t: 2, p: 0.18, lower: -0.0002, upper: 0.0006 },
    ],
    effect_tests: [
      { effect: "sub", nparm: 1, df: 1, ss: 0.00006, f: 0.6, p: 0.5 },
      { effect: "T", nparm: 1, df: 1, ss: 0.0004, f: 4, p: 0.18 },
    ],
    ls_means: [{ effect: "sub", factors: ["sub"], rows: [
      { levels: ["Si"], ls_mean: 3.931, se: 0.006, mean: 3.93, n: 3 },
      { levels: ["MgO"], ls_mean: 3.923, se: 0.007, mean: 3.925, n: 2 }] }],
    predicted: Array.from({ length: n }, () => 3.93), residual: Array.from({ length: n }, () => 0.001),
    alpha: 0.05, center_polynomials: true,
    model: { response: "a", factors: [], terms: [["sub"], ["T"]], center_polynomials: true, parameters: [],
      coefficients: [], covariance: [], df_error: n - 3, rmse: 0.01 },
  };
}

function check(name: string) {
  fireEvent.click(within(screen.getByRole("group", { name: "Model columns" })).getByLabelText(name));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsFitModel).mockImplementation(async (body) => fitFor(body.response.length));
  useApp.setState({ datasets: [], activeId: null, selection: null, analysisResults: [], history: [], future: [] });
  useFitModelStore.setState({ open: true, request: null });
});

describe("FitModelPanel", () => {
  it("prompts for a dataset", () => {
    render(<FitModelPanel />);
    expect(screen.getByText("Select a dataset to analyze.")).toBeInTheDocument();
  });

  it("builds a model from columns, fits the analysis view (excluded rows dropped) and shows the report", async () => {
    useApp.setState({ datasets: [DS], activeId: "d1" });
    render(<FitModelPanel />);
    fireEvent.change(screen.getByLabelText("Response (Y)"), { target: { value: "2" } });
    expect(screen.getByText("Add at least one effect to the model.")).toBeInTheDocument();
    expect(statsFitModel).not.toHaveBeenCalled();
    check("sub");
    check("T");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Fit Model: standard least squares")).toBeInTheDocument();
    const body = vi.mocked(statsFitModel).mock.calls.at(-1)![0];
    expect(body.response).toEqual([3.90, 3.95, 3.92, 3.94, 3.93]); // row 1 excluded
    expect(body.factors[0]).toEqual({ name: "sub", kind: "nominal", values: ["Si", "Si", "MgO", "Si", "MgO"], levels: ["Si", "MgO"] });
    expect(body.terms).toEqual([["sub"], ["T"]]);
    const titles = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent?.replace(/^[▾▸]\s*/, ""));
    expect(titles).toEqual(["Summary", "Summary of fit", "Analysis of variance", "Effect tests", "Parameter estimates",
      "Least squares means: sub", "Predicted and residuals", "Actual by predicted", "Residual by predicted"]);
    expect(screen.getByRole("img", { name: "a residual by predicted" })).toBeInTheDocument();
  });

  it("says why Add and Remove are disabled (UX menus follow-up)", () => {
    useApp.setState({ datasets: [DS], activeId: "d1" });
    render(<FitModelPanel />);
    fireEvent.change(screen.getByLabelText("Response (Y)"), { target: { value: "2" } });
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("title", expect.stringContaining("Select one or more columns"));
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).toHaveAttribute("title", "No effects to remove yet");
    check("T");
    fireEvent.click(add);
    expect(screen.getByRole("button", { name: "Remove" })).toHaveAttribute("title", expect.stringContaining("Check one or more effects"));
  });

  it("crosses selected columns and refits; a server refusal is shown instead of stale numbers", async () => {
    useApp.setState({ datasets: [DS], activeId: "d1" });
    render(<FitModelPanel />);
    fireEvent.change(screen.getByLabelText("Response (Y)"), { target: { value: "2" } });
    check("sub");
    check("T");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("Fit Model: standard least squares");
    vi.mocked(statsFitModel).mockRejectedValueOnce(new Error("the model is rank deficient: term 'sub*T' is not estimable"));
    check("sub");
    check("T");
    fireEvent.click(screen.getByRole("button", { name: "Cross" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("rank deficient: term 'sub*T'");
    expect(screen.queryByText("Fit Model: standard least squares")).not.toBeInTheDocument();
    expect(vi.mocked(statsFitModel).mock.calls.at(-1)![0].terms).toEqual([["sub"], ["T"], ["sub", "T"]]);
  });

  it("saves one result, refuses a duplicate, and reopens a saved recipe", async () => {
    useApp.setState({ datasets: [DS], activeId: "d1" });
    const { unmount } = render(<FitModelPanel />);
    fireEvent.change(screen.getByLabelText("Response (Y)"), { target: { value: "2" } });
    check("T");
    fireEvent.click(screen.getByRole("button", { name: "Poly²" }));
    await screen.findByText("Fit Model: standard least squares");
    expect(vi.mocked(statsFitModel).mock.calls.at(-1)![0].terms).toEqual([["T"], ["T", "T"]]);
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));
    const [saved] = useApp.getState().analysisResults;
    expect(saved!.producer.id).toBe("fit-model");
    expect(screen.getByRole("button", { name: "Save result" })).toBeDisabled();
    unmount();
    useFitModelStore.getState().openWith({ responseCol: 2, terms: [[1], [1, 1]], kinds: { 1: "continuous" }, center: true });
    render(<FitModelPanel />);
    await screen.findByText("Fit Model: standard least squares");
    expect(screen.getByText("Saved", { selector: ".qz-analysis-status" })).toBeInTheDocument();
  });
});
