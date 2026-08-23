import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type CorrelationResponse, type PCAResponse, exportCorrelationHeatmapFigure, exportPcaFigure, exportPcaScreeFigure, exportSplomFigure, statsCorrelation, statsPCA } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import MultivarPanel from "./MultivarPanel";

vi.mock("../../../lib/api", () => ({
  statsCorrelation: vi.fn(),
  statsPCA: vi.fn(),
  exportCorrelationHeatmapFigure: vi.fn(),
  exportSplomFigure: vi.fn(),
  exportPcaFigure: vi.fn(),
  exportPcaScreeFigure: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [
    [1, 10],
    [2, 20],
    [3, 30],
    [4, 40],
    [5, 50],
    [6, 60],
  ],
  labels: ["a", "b"],
  units: ["", ""],
  metadata: { x_column_name: "T" },
};

const CORR: CorrelationResponse = {
  r: [
    [1, 0.87],
    [0.87, 1],
  ],
  p: [
    [1, 0.02],
    [0.02, 1],
  ],
  N: 6,
  method: "pearson",
};

const PCA: PCAResponse = {
  coeff: [
    [0.7, 0.7],
    [0.7, -0.7],
  ],
  score: [
    [1, 0.1],
    [2, -0.1],
    [3, 0.2],
    [4, -0.2],
    [5, 0.3],
    [6, -0.3],
  ],
  latent: [3, 0.2],
  explained: [94, 6],
  cumulative: [94, 100],
  mu: [3.5, 35],
  sigma: [1, 1],
  singular: [4, 1],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsCorrelation).mockResolvedValue(CORR);
  vi.mocked(statsPCA).mockResolvedValue(PCA);
  vi.mocked(exportCorrelationHeatmapFigure).mockResolvedValue(undefined);
  vi.mocked(exportSplomFigure).mockResolvedValue(undefined);
  vi.mocked(exportPcaFigure).mockResolvedValue(undefined);
  vi.mocked(exportPcaScreeFigure).mockResolvedValue(undefined);
  useApp.setState({ datasets: [], activeId: null, selection: null });
});

describe("MultivarPanel", () => {
  it("prompts to select a dataset when none is active", () => {
    render(<MultivarPanel />);
    expect(screen.getByText("Select a dataset to explore.")).toBeInTheDocument();
  });

  it("defaults to every continuous column selected and renders the correlation heatmap", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<MultivarPanel />);
    expect(screen.getByText("Columns (2 selected)")).toBeInTheDocument();
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalledWith([DATA.values.map((r) => r[0]), DATA.values.map((r) => r[1])], "pearson"));
    expect(await screen.findByTitle("a × b: r=0.87, p=0.02")).toBeInTheDocument();
    expect(screen.getByText(/N = 6 complete rows/)).toBeInTheDocument();
  });

  it("unchecking a column below 2 shows the picker's warning and clears the matrix", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<MultivarPanel />);
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("checkbox", { name: "a" }));
    expect(await screen.findByText("pick at least 2 columns")).toBeInTheDocument();
    expect(screen.getByText("select at least 2 columns")).toBeInTheDocument();
  });

  it("switching to the SPLOM tab renders the canvas host and an N readout", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    const { container } = render(<MultivarPanel />);
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "SPLOM" }));
    expect(await screen.findByText(/N = 6 complete rows/)).toBeInTheDocument();
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("switching to the PCA tab fetches PCA and renders the scree + canvas", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    const { container } = render(<MultivarPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "PCA" }));
    await waitFor(() => expect(statsPCA).toHaveBeenCalled());
    expect(await screen.findByText("PC1")).toBeInTheDocument();
    expect(screen.getByText("PC2")).toBeInTheDocument();
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("Pearson/Spearman toggle re-fetches the correlation matrix", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<MultivarPanel />);
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "Spearman" }));
    await waitFor(() => expect(statsCorrelation).toHaveBeenLastCalledWith(expect.anything(), "spearman"));
  });

  it("resets the column selection when the active dataset changes", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    const { rerender } = render(<MultivarPanel />);
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("checkbox", { name: "a" }));
    expect(await screen.findByText("Columns (1 selected)")).toBeInTheDocument();

    const OTHER: DataStruct = { ...DATA, labels: ["x", "y", "z"], values: DATA.values.map((r) => [r[0], r[1], r[0] + r[1]]) };
    useApp.setState({ datasets: [{ id: "d2", name: "other.dat", data: OTHER }], activeId: "d2" });
    rerender(<MultivarPanel />);
    expect(await screen.findByText("Columns (3 selected)")).toBeInTheDocument();
  });
});

// JMP_GAP_PLAN #10 residual — server-side (matplotlib) figure export parity.
describe("MultivarPanel — figure export (JMP_GAP #10 residual)", () => {
  it("correlation tab's Export figure button sends the SAME r matrix the heatmap colors", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<MultivarPanel />);
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Export figure" }));
    await waitFor(() =>
      expect(exportCorrelationHeatmapFigure).toHaveBeenCalledWith({
        labels: ["a", "b"],
        r: CORR.r,
        filename: "correlation",
      }),
    );
  });

  it("SPLOM tab's Export figure button sends the full listwise-complete column set", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<MultivarPanel />);
    await waitFor(() => expect(statsCorrelation).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "SPLOM" }));
    fireEvent.click(await screen.findByRole("button", { name: "Export figure" }));
    await waitFor(() =>
      expect(exportSplomFigure).toHaveBeenCalledWith({
        labels: ["a", "b"],
        columns: [DATA.values.map((r) => r[0]), DATA.values.map((r) => r[1])],
        filename: "splom",
      }),
    );
  });

  it("PCA tab's Export scree / Export figure buttons send the fetched PCA numbers", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<MultivarPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "PCA" }));
    await waitFor(() => expect(statsPCA).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Export scree" }));
    await waitFor(() =>
      expect(exportPcaScreeFigure).toHaveBeenCalledWith({ explained: PCA.explained, cumulative: PCA.cumulative }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Export figure" }));
    await waitFor(() =>
      expect(exportPcaFigure).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "scores", filename: "pca-scores" }),
      ),
    );
  });
});
