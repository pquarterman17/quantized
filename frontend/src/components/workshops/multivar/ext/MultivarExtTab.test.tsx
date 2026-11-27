// The PLS / LDA tab inside the Multivariate workshop: lazy, Run is explicit, the result and its
// worksheets follow the result-lifecycle contract, and a backend refusal shows as an alert.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlsResult } from "../../../../lib/api/multivarExt";
import type { DataStruct } from "../../../../lib/types";
import { useMultivarStore } from "../../../../store/multivar";
import { useApp } from "../../../../store/useApp";
import MultivarPanel from "../MultivarPanel";

const ext = vi.hoisted(() => ({ statsPls: vi.fn(), statsLda: vi.fn(), statsPcaSpectra: vi.fn() }));
vi.mock("../../../../lib/api/multivarExt", () => ext);
vi.mock("../../../../lib/api", () => ({
  statsCorrelation: vi.fn().mockResolvedValue({ r: [[1, 0], [0, 1]], p: [[1, 1], [1, 1]], N: 8, method: "pearson" }),
  statsPCA: vi.fn().mockResolvedValue({ coeff: [[1, 0], [0, 1]], score: [[0, 0]], latent: [1, 1], explained: [50, 50], cumulative: [50, 100], mu: [0, 0], sigma: [1, 1], singular: [1, 1] }),
  exportCorrelationHeatmapFigure: vi.fn(), exportSplomFigure: vi.fn(), exportPcaFigure: vi.fn(), exportPcaScreeFigure: vi.fn(),
}));
vi.mock("../../SmallUPlot", () => ({ default: ({ label }: { label: string }) => <div data-testid="plot">{label}</div> }));

class MockResizeObserver { observe(): void {} disconnect(): void {} }

const x1 = [1, 2, 3, 4, 5, 6, 7, 8];
const DATA: DataStruct = {
  time: x1, values: x1.map((v) => [v, (v * 7) % 5, 2 * v + 1]), labels: ["a", "b", "conc"], units: ["", "", ""], metadata: { x_column_name: "T" },
};
const PLS: PlsResult = {
  n: 8, p: 2, m: 1, n_components: 1, auto_components: true, preprocess: "center", components_max: 2,
  cv: { folds: 7, seed: 0, max_components: 2, best: 1, press: [[1], [2]], rmsecv: [[0.5], [0.8]], q2: [[0.9], [0.7]], q2_mean: [0.9, 0.7] },
  scores: x1.map((v) => [v]), x_weights: [[1], [0]], x_loadings: [[1], [0]], y_loadings: [[1]], coef: [[2], [0]], intercept: [1], vip: [1.4, 0.1],
  r2y: [0.99], r2y_mean: 0.99, r2y_cumulative: [[0.99]], r2x: [0.8], q2: [0.91], q2_mean: 0.91, rmsec: [0.1], rmsecv: [0.5],
  measured: x1.map((v) => [2 * v + 1]), predicted: x1.map((v) => [2 * v + 1]), cv_predicted: x1.map((v) => [2 * v + 1]), residuals: x1.map(() => [0]),
};
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1");

async function openPls() {
  render(<MultivarPanel />);
  fireEvent.click(screen.getByRole("radio", { name: "PLS / LDA" }));
  expect(await screen.findByRole("radio", { name: "Spectra PCA" })).toBeInTheDocument();
}

beforeEach(() => {
  useMultivarStore.setState({ open: false, request: null, launch: null });
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  ext.statsPls.mockResolvedValue(PLS);
  useApp.setState({ datasets: [{ id: "d1", name: "cal.dat", data: DATA }], activeId: "d1", status: "", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual", selection: null });
});

describe("PLS / LDA tab", () => {
  it("Review inputs describes PLS / LDA here, not the Correlation / PCA settings of the other tabs", async () => {
    render(<MultivarPanel />);
    expect(within(screen.getByRole("region", { name: "Review analysis inputs" })).getByText("Correlation")).toBeInTheDocument(); // the correlation tab's own block
    fireEvent.click(screen.getByRole("radio", { name: "PLS / LDA" }));
    expect(await screen.findByRole("radio", { name: "Spectra PCA" })).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "Review analysis inputs" });
    expect(screen.getAllByRole("region", { name: "Review analysis inputs" })).toHaveLength(1);
    expect(within(review).queryByText("Correlation")).toBeNull();
    expect(within(review).queryByText("PCA standardize")).toBeNull();
    for (const label of ["Predictors (X)", "Response (Y)", "Preprocessing", "CV folds"]) expect(within(review).getByText(label)).toBeInTheDocument();
    expect(within(review).getByText("not picked")).toBeInTheDocument(); // no response yet
    fireEvent.click(screen.getByRole("checkbox", { name: "conc", checked: false }));
    expect(within(review).getByText("Response (Y)").nextElementSibling?.textContent).toBe("conc");
    fireEvent.click(screen.getByRole("radio", { name: "LDA" }));
    for (const label of ["Variables", "Class column", "Priors"]) expect(within(review).getByText(label)).toBeInTheDocument();
    expect(within(review).queryByText("Response (Y)")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Class column" }), { target: { value: "2" } });
    expect(within(review).getByText("Class column").nextElementSibling?.textContent).toBe("conc");
  });

  it("refuses to run without a response column, naming the reason", async () => {
    await openPls();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText(/at least one response/)).toBeInTheDocument();
    expect(ext.statsPls).not.toHaveBeenCalled();
  });

  it("runs PLS only on Run, shows the numbers, and adds each table once as a worksheet", async () => {
    await openPls();
    fireEvent.click(screen.getByRole("checkbox", { name: "conc", checked: false }));
    // the response is also ticked in the predictor list above; prepareExt removes it from X
    const run = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(run).toBeEnabled());
    expect(ext.statsPls).not.toHaveBeenCalled();
    fireEvent.click(run);
    expect(await screen.findByText(/chosen by smallest PRESS/)).toBeInTheDocument();
    const body = ext.statsPls.mock.calls[0][0] as { x: number[][]; y: number[][] };
    expect(body.x[0]).toHaveLength(2);
    expect(body.y[0]).toEqual([3]);
    expect(screen.getAllByTestId("plot")).toHaveLength(3);
    const add = screen.getByRole("button", { name: "Add coefficients and VIP" });
    fireEvent.click(add);
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0].name).toMatch(/PLS coefficients and VIP/);
    fireEvent.click(add);
    expect(outputs()).toHaveLength(1);
    expect(await screen.findByText(/already added/)).toBeInTheDocument();
  });

  it("shows the backend's refusal as an alert and no result", async () => {
    ext.statsPls.mockRejectedValue(new Error("n_components 3 exceeds the 2 that cross-validation could assess"));
    await openPls();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "conc" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("exceeds");
    expect(screen.queryByTestId("plot")).toBeNull();
  });
});

describe("typed launch (palette PLS / LDA)", () => {
  it.each([["pls", "PLS"], ["lda", "LDA"]] as const)("openTab(%s) opens the panel on that tool of the PLS / LDA tab", async (tool, name) => {
    useMultivarStore.getState().openTab({ tab: "ext", tool });
    render(<MultivarPanel />);
    expect(await screen.findByRole("radio", { name: "Spectra PCA" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name })).toBeChecked();
  });

  it("re-launching on the other tool while open switches the tool", async () => {
    useMultivarStore.getState().openTab({ tab: "ext", tool: "pls" });
    render(<MultivarPanel />);
    expect(await screen.findByRole("radio", { name: "LDA" })).not.toBeChecked();
    act(() => useMultivarStore.getState().openTab({ tab: "ext", tool: "lda" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "LDA" })).toBeChecked());
  });
});
