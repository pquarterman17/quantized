// The Clustering tab inside the Multivariate workshop: lazy, Run is explicit, the label column and the
// other tables follow the result-lifecycle contract, the dendrogram shows its cut and coloured leaves,
// and a backend refusal shows as an alert.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HierarchicalResult, KmeansResult } from "../../../../lib/api/cluster";
import type { DataStruct } from "../../../../lib/types";
import { useMultivarStore } from "../../../../store/multivar";
import { useApp } from "../../../../store/useApp";
import MultivarPanel from "../MultivarPanel";

const api = vi.hoisted(() => ({ statsKmeans: vi.fn(), statsHierarchical: vi.fn(), exportDendrogramFigure: vi.fn() }));
vi.mock("../../../../lib/api/cluster", () => api);
vi.mock("../../../../lib/api", () => ({
  statsCorrelation: vi.fn().mockResolvedValue({ r: [[1, 0], [0, 1]], p: [[1, 1], [1, 1]], N: 8, method: "pearson" }),
  statsPCA: vi.fn().mockResolvedValue({ coeff: [[1, 0], [0, 1]], score: [[0, 0]], latent: [1, 1], explained: [50, 50], cumulative: [50, 100], mu: [0, 0], sigma: [1, 1], singular: [1, 1] }),
  exportCorrelationHeatmapFigure: vi.fn(), exportSplomFigure: vi.fn(), exportPcaFigure: vi.fn(), exportPcaScreeFigure: vi.fn(),
}));

class MockResizeObserver { observe(): void {} disconnect(): void {} }

const x1 = [1, 2, 3, 4, 5, 6, 7, 8];
const DATA: DataStruct = {
  time: x1, values: x1.map((v) => [v, (v * 7) % 5]), labels: ["a", "b"], units: ["", ""], metadata: { x_column_name: "T" },
};
const KM: KmeansResult = {
  k: 3, n: 8, p: 2, standardize: "zscore", init: "kmeans++", seed: 0, max_iter: 300, n_init: 10, iterations: 3, converged: true, best_restart: 2,
  labels: [1, 1, 1, 2, 2, 2, 3, 3], centroids: [[2, 2], [5, 2], [7.5, 3]], centroids_scaled: [[0, 0], [0, 0], [0, 0]], counts: [3, 3, 2],
  wcss_by_cluster: [1, 1, 0.5], total_wcss: 2.5, between_ss: 10, total_ss: 12.5, wcss_original: 2.5,
  silhouette: 0.61, silhouette_by_cluster: [0.6, 0.6, 0.7], silhouette_points: x1.map(() => 0.6), silhouette_note: null,
};
const HC: HierarchicalResult = {
  n: 8, p: 2, method: "average", metric: "euclidean", standardize: "zscore", cut_by: "k", k: 2, cut_distance: 3,
  labels: [1, 1, 1, 1, 2, 2, 2, 2], counts: [4, 4], linkage: [[0, 1, 1, 2]], cophenetic_correlation: 0.88,
  centroids: [[2.5, 2], [6.5, 3]], wcss_by_cluster: [1.5, 2], total_wcss: 3.5,
  dendrogram: {
    n_leaves: 3, leaf_order: [0, 1, 2], leaf_cluster: [1, 1, 2], cut: 3, max_height: 6,
    segments: [
      { x: [0, 0, 1, 1], y: [0, 1, 1, 0], cluster: 1 },
      { x: [0.5, 0.5, 2, 2], y: [1, 6, 6, 0], cluster: 0 },
    ],
  },
};
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1");

async function openCluster() {
  render(<MultivarPanel />);
  fireEvent.click(screen.getByRole("radio", { name: "Clustering" }));
  expect(await screen.findByRole("radio", { name: "Hierarchical" })).toBeInTheDocument();
}

beforeEach(() => {
  useMultivarStore.setState({ open: false, request: null, launch: null });
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  api.statsKmeans.mockResolvedValue(KM);
  api.statsHierarchical.mockResolvedValue(HC);
  useApp.setState({ datasets: [{ id: "d1", name: "c.dat", data: DATA }], activeId: "d1", status: "", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual", selection: null });
});

describe("Clustering tab", () => {
  it("runs k-means only on Run, with the shown seed, and adds the label column once", async () => {
    await openCluster();
    const run = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(run).toBeEnabled());
    expect(api.statsKmeans).not.toHaveBeenCalled();
    fireEvent.click(run);
    expect(await screen.findByText(/best of 10 restarts/)).toBeInTheDocument();
    const body = api.statsKmeans.mock.calls[0][0] as { x: number[][]; k: number; seed: number };
    expect(body).toMatchObject({ k: 3, seed: 0 });
    expect(body.x).toHaveLength(8);
    expect(screen.getByText(/mean silhouette/)).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add cluster labels" });
    fireEvent.click(add);
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0].name).toMatch(/k-means cluster labels/);
    expect(outputs()[0].data.time).toEqual(x1);
    fireEvent.click(add);
    expect(outputs()).toHaveLength(1);
    expect(await screen.findByText(/already added/)).toBeInTheDocument();
  });

  it("hierarchical: draws the dendrogram with the cut and coloured leaves, and reports the cophenetic correlation", async () => {
    await openCluster();
    fireEvent.click(screen.getByRole("radio", { name: "Hierarchical" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/Cophenetic correlation 0.88/)).toBeInTheDocument();
    const svg = screen.getByRole("img", { name: "Dendrogram" });
    expect(within(svg).getAllByTestId("dendrogram-link")).toHaveLength(2);
    expect(within(svg).getAllByTestId("dendrogram-leaf")).toHaveLength(3);
    expect(within(svg).getByTestId("dendrogram-cut")).toBeInTheDocument();
    const fills = within(svg).getAllByTestId("dendrogram-leaf").map((c) => c.getAttribute("fill"));
    expect(new Set(fills).size).toBe(2);
    expect(screen.getByRole("button", { name: "Add linkage table" })).toBeEnabled();
  });

  it("exports the dendrogram through the backend with the geometry the screen draws", async () => {
    api.exportDendrogramFigure.mockResolvedValue(undefined);
    await openCluster();
    fireEvent.click(screen.getByRole("radio", { name: "Hierarchical" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Export SVG" }));
    await waitFor(() => expect(api.exportDendrogramFigure).toHaveBeenCalled());
    expect(api.exportDendrogramFigure.mock.calls[0][0]).toMatchObject({ geometry: HC.dendrogram, fmt: "svg" });
  });

  it("refuses Ward with a non-Euclidean distance before any request", async () => {
    await openCluster();
    fireEvent.click(screen.getByRole("radio", { name: "Hierarchical" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Linkage" }), { target: { value: "ward" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Distance" }), { target: { value: "cityblock" } });
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText(/only for Euclidean/)).toBeInTheDocument();
    expect(api.statsHierarchical).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal as an alert and no result", async () => {
    api.statsKmeans.mockRejectedValue(new Error("fewer than 3 distinct rows"));
    await openCluster();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("distinct rows");
    expect(screen.queryByText(/best of/)).toBeNull();
  });
});

describe("typed launch (palette Clustering)", () => {
  it("openTab(cluster) opens the panel on the Clustering tab", async () => {
    useMultivarStore.getState().openTab({ tab: "cluster" });
    render(<MultivarPanel />);
    expect(await screen.findByRole("radio", { name: "k-means" })).toBeChecked();
  });

  it("launching the hierarchical method while open switches the method", async () => {
    useMultivarStore.getState().openTab({ tab: "cluster" });
    render(<MultivarPanel />);
    expect(await screen.findByRole("radio", { name: "Hierarchical" })).not.toBeChecked();
    act(() => useMultivarStore.getState().openTab({ tab: "cluster", cluster: "hierarchical" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Hierarchical" })).toBeChecked());
  });
});
