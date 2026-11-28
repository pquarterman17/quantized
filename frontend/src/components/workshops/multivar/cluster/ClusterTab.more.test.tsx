// Clustering remainders (item 11), driven through the tab the user sees: starting centres for k-means
// (pick rows, enter a table), squared Euclidean and cosine distances, variable clustering, and the
// result book (Save result, the tables, reopening a saved result with its settings).

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HierarchicalResult, KmeansResult, VariablesResult } from "../../../../lib/api/cluster";
import { CLUSTER_RESULT, clusterRecipe } from "../../../../lib/toolResultKinds";
import type { DataStruct } from "../../../../lib/types";
import { useMultivarStore } from "../../../../store/multivar";
import { useToolResultRequest } from "../../../../store/toolResultRequest";
import { useApp } from "../../../../store/useApp";
import { snapshotReopener } from "../../analysisresults/useSnapshotReopen";
import MultivarPanel from "../MultivarPanel";

const api = vi.hoisted(() => ({
  statsKmeans: vi.fn(), statsHierarchical: vi.fn(), statsClusterVariables: vi.fn(), exportDendrogramFigure: vi.fn(),
}));
vi.mock("../../../../lib/api/cluster", () => api);
vi.mock("../../../../lib/api", () => ({
  statsCorrelation: vi.fn().mockResolvedValue({ r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], p: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], N: 8, method: "pearson" }),
  statsPCA: vi.fn().mockResolvedValue({ coeff: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], score: [[0, 0, 0]], latent: [1, 1, 1], explained: [34, 33, 33], cumulative: [34, 67, 100], mu: [0, 0, 0], sigma: [1, 1, 1], singular: [1, 1, 1] }),
  exportCorrelationHeatmapFigure: vi.fn(), exportSplomFigure: vi.fn(), exportPcaFigure: vi.fn(), exportPcaScreeFigure: vi.fn(),
}));

class MockResizeObserver { observe(): void {} disconnect(): void {} }

const x1 = [1, 2, 3, 4, 5, 6, 7, 8];
const DATA: DataStruct = {
  time: x1, values: x1.map((v) => [v, (v * 7) % 5, 2 * v + 1]), labels: ["a", "b", "c"], units: ["", "", ""], metadata: { x_column_name: "T" },
};
const KM: KmeansResult = {
  k: 3, n: 8, p: 3, standardize: "zscore", init: "kmeans++", seed: 0, max_iter: 300, n_init: 10, iterations: 3, converged: true, best_restart: 2,
  labels: [1, 1, 1, 2, 2, 2, 3, 3], centroids: [[2, 2, 5], [5, 2, 11], [7.5, 3, 16]], centroids_scaled: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], counts: [3, 3, 2],
  wcss_by_cluster: [1, 1, 0.5], total_wcss: 2.5, between_ss: 10, total_ss: 12.5, wcss_original: 2.5,
  silhouette: 0.61, silhouette_by_cluster: [0.6, 0.6, 0.7], silhouette_points: x1.map(() => 0.6), silhouette_note: null,
};
const GEOM = {
  n_leaves: 3, leaf_order: [0, 1, 2], leaf_cluster: [1, 1, 2], cut: 0.5, max_height: 1,
  segments: [{ x: [0, 0, 1, 1], y: [0, 0.1, 0.1, 0], cluster: 1 }, { x: [0.5, 0.5, 2, 2], y: [0.1, 1, 1, 0], cluster: 0 }],
};
const HC: HierarchicalResult = {
  n: 8, p: 3, method: "average", metric: "euclidean", standardize: "zscore", cut_by: "k", k: 2, cut_distance: 3,
  labels: [1, 1, 1, 1, 2, 2, 2, 2], counts: [4, 4], linkage: [[0, 1, 1, 2]], cophenetic_correlation: 0.88,
  centroids: [[2.5, 2, 6], [6.5, 3, 14]], wcss_by_cluster: [1.5, 2], total_wcss: 3.5, dendrogram: GEOM,
};
const VR: VariablesResult = {
  n: 8, p: 3, method: "average", distance: "abs", cut_by: "k", k: 2, cut_distance: 0.5, labels: [1, 2, 1], counts: [2, 1],
  linkage: [[0, 2, 0, 2], [1, 3, 0.9, 3]], cophenetic_correlation: 0.97, correlation: [[1, 0.1, 1], [0.1, 1, 0.1], [1, 0.1, 1]],
  dendrogram: { ...GEOM, leaf_order: [0, 2, 1], leaf_cluster: [1, 1, 2] },
};
const rowValues = (r: number): number[] => DATA.values[r - 1];

async function openCluster() {
  render(<MultivarPanel />);
  fireEvent.click(screen.getByRole("radio", { name: "Clustering" }));
  expect(await screen.findByRole("radio", { name: "Variables" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Run" })).toBeEnabled());
}

beforeEach(() => {
  useMultivarStore.setState({ open: false, request: null, launch: null });
  useToolResultRequest.setState({ cluster: null });
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  // As the backend answers: a run from given centres reports init "given", one restart.
  api.statsKmeans.mockImplementation(async (b: { initial_centers?: number[][] }) => (b.initial_centers ? { ...KM, init: "given", n_init: 1 } : KM));
  api.statsHierarchical.mockResolvedValue(HC);
  api.statsClusterVariables.mockResolvedValue(VR);
  useApp.setState({ datasets: [{ id: "d1", name: "c.dat", data: DATA }], activeId: "d1", status: "", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual", selection: null });
});

describe("k-means starting centres", () => {
  it("picks worksheet rows as the centres and sends their values", async () => {
    await openCluster();
    fireEvent.change(screen.getByRole("combobox", { name: "Starting centres" }), { target: { value: "rows" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Start rows" }), { target: { value: "1, 4, 7" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/started from your centres/)).toBeInTheDocument();
    expect(api.statsKmeans.mock.calls[0][0]).toMatchObject({ k: 3, initial_centers: [rowValues(1), rowValues(4), rowValues(7)] });
  });

  it("refuses a start row that is not a clustered row, and the wrong number of rows, before any request", async () => {
    await openCluster();
    fireEvent.change(screen.getByRole("combobox", { name: "Starting centres" }), { target: { value: "rows" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Start rows" }), { target: { value: "1, 4, 99" } });
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText(/Row 99 is not one of the clustered rows/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Start rows" }), { target: { value: "1, 4" } });
    expect(screen.getByText(/k = 3 needs exactly 3/)).toBeInTheDocument();
    expect(api.statsKmeans).not.toHaveBeenCalled();
  });

  it("takes a pasted centre table (tabs, commas or spaces) and refuses a wrong shape", async () => {
    await openCluster();
    fireEvent.change(screen.getByRole("combobox", { name: "Starting centres" }), { target: { value: "table" } });
    const box = screen.getByRole("textbox", { name: "Centre table" });
    fireEvent.change(box, { target: { value: "1\t2\t3\n5, 2, 11\n8 3 17\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/started from your centres/);
    expect(api.statsKmeans.mock.calls[0][0].initial_centers).toEqual([[1, 2, 3], [5, 2, 11], [8, 3, 17]]);
    fireEvent.change(box, { target: { value: "1 2\n3 4\n5 6" } });
    expect(screen.getByText(/Centre 1 has 2 values; one per picked column \(3\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("the automatic start sends no centres", async () => {
    await openCluster();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/best of 10 restarts/);
    expect(api.statsKmeans.mock.calls[0][0]).not.toHaveProperty("initial_centers");
  });
});

describe("hierarchical distances", () => {
  it.each(["sqeuclidean", "cosine"])("sends the %s distance", async (metric) => {
    await openCluster();
    fireEvent.click(screen.getByRole("radio", { name: "Hierarchical" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Distance" }), { target: { value: metric } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/Cophenetic correlation/);
    expect(api.statsHierarchical.mock.calls[0][0]).toMatchObject({ metric });
    // Centroids and within SS are listed per cluster.
    expect(screen.getByText("within SS")).toBeInTheDocument();
  });

  it("keeps Ward Euclidean-only with a reason, for the new distances too", async () => {
    await openCluster();
    fireEvent.click(screen.getByRole("radio", { name: "Hierarchical" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Linkage" }), { target: { value: "ward" } });
    for (const metric of ["sqeuclidean", "cosine"]) {
      fireEvent.change(screen.getByRole("combobox", { name: "Distance" }), { target: { value: metric } });
      expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
      expect(screen.getByText(/only for Euclidean/)).toBeInTheDocument();
    }
  });
});

describe("variable clustering", () => {
  it("clusters the picked columns, draws a dendrogram of variables labelled by column, and exports it", async () => {
    api.exportDendrogramFigure.mockResolvedValue(undefined);
    await openCluster();
    fireEvent.click(screen.getByRole("radio", { name: "Variables" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Distance" }), { target: { value: "signed" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Linkage" }), { target: { value: "complete" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/cophenetic correlation 0.97/i)).toBeInTheDocument();
    const body = api.statsClusterVariables.mock.calls[0][0] as { x: number[][] };
    expect(body).toMatchObject({ method: "complete", distance: "signed", k: 2 });
    expect(body.x).toHaveLength(8);
    expect(body.x[0]).toEqual(rowValues(1));
    const svg = screen.getByRole("img", { name: "Dendrogram" });
    expect(within(svg).getAllByTestId("dendrogram-leaf")).toHaveLength(3);
    // The leaves are the variables, in the dendrogram's order.
    expect(within(svg).getByText("c")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(api.exportDendrogramFigure.mock.calls.length).toBe(1));
    expect(api.exportDendrogramFigure.mock.calls[0][0]).toMatchObject({ leaf_names: ["a", "b", "c"], geometry: VR.dendrogram });
    expect(screen.queryByRole("option", { name: "Ward" })).toBeNull();
  });

  it("adds the variable clusters as a linked worksheet, once", async () => {
    await openCluster();
    fireEvent.click(screen.getByRole("radio", { name: "Variables" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/cophenetic correlation/i);
    fireEvent.click(screen.getByRole("button", { name: "Add variable clusters" }));
    const out = useApp.getState().datasets.filter((d) => d.id !== "d1");
    expect(out).toHaveLength(1);
    expect(out[0].data.time).toEqual([1, 2, 3]);
    expect(out[0].data.values.map((r) => r[0])).toEqual([1, 2, 1]);
  });

  it("needs at least three columns", async () => {
    await openCluster();
    fireEvent.click(screen.getByRole("radio", { name: "Variables" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^c/ }));
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByText(/at least 3 numeric columns/)).toBeInTheDocument();
  });
});

describe("clustering result book", () => {
  async function runAndSave() {
    await openCluster();
    fireEvent.change(screen.getByRole("combobox", { name: "Starting centres" }), { target: { value: "rows" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Start rows" }), { target: { value: "1, 4, 7" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/started from your centres/);
    expect(screen.getByRole("button", { name: "Send to report: Clusters" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    return useApp.getState().analysisResults[0]!;
  }

  it("saves what was run, the sizes, centroids, within SS and the starting centres, once", async () => {
    const saved = await runAndSave();
    expect(saved.producer.id).toBe(CLUSTER_RESULT);
    expect(saved.scalarValues).toMatchObject({ Method: "k-means", Clusters: 3, Scaling: "z-score", Restarts: 1, N: 8, "Total within SS": 2.5 });
    expect(String(saved.scalarValues?.["Start"])).toContain("rows 1, 4, 7");
    expect(saved.tables!.map((t) => t.title)).toEqual(["Clusters", "Starting centres", "Cluster labels"]);
    const clusters = saved.tables![0]!;
    expect(clusters.columns).toEqual(["cluster", "n", "within SS", "silhouette", "a", "b", "c"]);
    expect(clusters.rows[2]).toEqual([3, 2, 0.5, 0.7, 7.5, 3, 16]);
    expect(saved.tables![1]!.rows[1]).toEqual([2, ...rowValues(4)]);
    expect(saved.tables![2]!.rows[3]).toEqual([4, 2]);
    expect(screen.getByRole("button", { name: "Save result" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save result" })).toHaveAttribute("title", "This clustering result is already saved.");
    expect(screen.getByRole("button", { name: "Send to report: Clusters" })).toBeEnabled();
    expect(clusterRecipe(saved)).toMatchObject({ tool: "kmeans", columns: [0, 1, 2], options: { start: "rows", startRows: "1, 4, 7", k: 3 } });
  });

  it("a rerun after a data change can be saved again, a change of a setting is a new question", async () => {
    await runAndSave();
    fireEvent.change(screen.getByRole("textbox", { name: "Start rows" }), { target: { value: "1, 4, 8" } });
    expect(await screen.findByText(/settings changed since the last run/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/started from your centres/);
    expect(screen.getByRole("button", { name: "Save result" })).toBeEnabled();
  });

  it("reopening a saved result restores its tool, columns and options", async () => {
    const saved = await runAndSave();
    cleanup();
    // The Library's "Reopen in tool" for a variables result recorded with other settings.
    const recipe = { tool: "variables" as const, columns: [0, 1, 2], options: { method: "single", corr: "signed", cutBy: "distance", k: 2, distance: 0.7, bogus: 1 } };
    const result = { ...saved, id: "rv", producer: { id: CLUSTER_RESULT, label: "Clustering", version: 1 }, parameters: { recipe } };
    act(() => snapshotReopener(result, useApp.getState().datasets[0], () => undefined)!());
    render(<MultivarPanel />);
    await waitFor(() => expect(useToolResultRequest.getState().cluster).toBeNull());
    expect(await screen.findByRole("radio", { name: "Variables" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Linkage" })).toHaveValue("single");
    expect(screen.getByRole("combobox", { name: "Distance" })).toHaveValue("signed");
    expect(screen.getByRole("combobox", { name: "Cut by" })).toHaveValue("distance");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/cophenetic correlation/i);
    expect(api.statsClusterVariables.mock.calls[0][0]).toMatchObject({ method: "single", distance: "signed", cut_distance: 0.7 });
    expect(api.statsClusterVariables.mock.calls[0][0]).not.toHaveProperty("bogus");
  });

  it("reopening a k-means result restores the start rows it was run from", async () => {
    const saved = await runAndSave();
    cleanup();
    useMultivarStore.setState({ open: false, request: null, launch: null });
    act(() => snapshotReopener(saved, useApp.getState().datasets[0], () => undefined)!());
    render(<MultivarPanel />);
    expect(await screen.findByRole("textbox", { name: "Start rows" })).toHaveValue("1, 4, 7");
    expect(screen.getByRole("radio", { name: "k-means" })).toBeChecked();
  });
});
