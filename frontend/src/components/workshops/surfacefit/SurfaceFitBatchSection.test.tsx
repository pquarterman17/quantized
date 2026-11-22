// Surface fit batch: the chosen model/bounds fitted to every selected
// worksheet's reviewed X/Y/Z; one summary table; refusals say why.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { surfaceFit, surfaceGuess } from "../../../lib/api/analysisExtras";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import SurfaceFitBatchSection from "./SurfaceFitBatchSection";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/analysisExtras", () => ({ surfaceFit: vi.fn(), surfaceGuess: vi.fn(), surfaceModels: vi.fn() }));

const MODEL = { name: "Plane", description: "", param_names: ["a", "b"] } as never;
const sheet = (id: string, labels: string[]): Dataset => ({
  id, name: `${id}.csv`,
  data: {
    time: [0, 1, 2, 3], values: [0, 1, 2, 3].map((i) => labels.map((_, c) => i * (c + 1))),
    labels, units: labels.map(() => ""), metadata: {},
  },
});

function seed(datasets: Dataset[], yKeys: number[]) {
  useApp.setState({
    datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys, seriesOrder: null,
    analysisResults: [], history: [], future: [], resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "surface-fit",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys,
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  vi.mocked(surfaceGuess).mockResolvedValue({ param_names: ["a", "b"], p0: [1, 2] });
  vi.mocked(surfaceFit).mockImplementation((async (req: { x: number[] }) => ({
    params: [req.x[1], 2], r2: 0.99, rmse: 0.1, n_points: req.x.length, exit_flag: 1, dof: 2,
  })) as never);
});

const run = () => {
  fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run Surface fit batch" }));
};

describe("SurfaceFitBatchSection", () => {
  it("fits each worksheet with per-worksheet start values and records one table", async () => {
    seed([sheet("a", ["Y", "Z"]), sheet("b", ["Y", "Z"])], [0, 1]);
    render(<SurfaceFitBatchSection f={{ model: MODEL, lower: ["", ""], upper: ["", "5"] }} />);
    run();
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    expect(surfaceGuess).toHaveBeenCalledTimes(2);
    const req = vi.mocked(surfaceFit).mock.calls[0]![0];
    expect(req).toMatchObject({ model: "Plane", p0: [1, 2], lower: [null, null], upper: [null, 5], y: [0, 1, 2, 3], z: [0, 2, 4, 6] });
    const result = register.mock.calls[0]![0];
    expect(result.tables[0].columns).toEqual(["Worksheet", "Status", "Rows", "a", "b", "R²", "RMSE", "N points", "Warnings"]);
    expect(result.tables[0].rows[0]).toEqual(["a.csv", "Completed", 4, 1, 2, 0.99, 0.1, 4, null]);
  });

  it("marks a worksheet without exactly two selected channels failed, with the reason", async () => {
    seed([sheet("a", ["Y", "Z"]), sheet("b", ["Y", "Z", "W"])], [0, 1]);
    useAnalysisSelection.getState().updateItem("b", { yKeys: [0, 1, 2] });
    render(<SurfaceFitBatchSection f={{ model: MODEL, lower: ["", ""], upper: ["", ""] }} />);
    run();
    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/exactly two selected columns/).length).toBeGreaterThan(0);
    expect(surfaceFit).toHaveBeenCalledOnce();
  });

  it("refuses to run with an unusable bound", () => {
    seed([sheet("a", ["Y", "Z"])], [0, 1]);
    render(<SurfaceFitBatchSection f={{ model: MODEL, lower: ["x", ""], upper: ["", ""] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    expect(screen.getByRole("button", { name: "Run Surface fit batch" })).toBeDisabled();
  });
});

describe("SurfaceFitBatchSection settings change", () => {
  it("drops the finished table when the model bounds change", async () => {
    seed([sheet("a", ["Y", "Z"]), sheet("b", ["Y", "Z"])], [0, 1]);
    const { rerender } = render(<SurfaceFitBatchSection f={{ model: MODEL, lower: ["", ""], upper: ["", ""] }} />);
    run();
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    rerender(<SurfaceFitBatchSection f={{ model: MODEL, lower: ["", ""], upper: ["", ""] }} />);
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    rerender(<SurfaceFitBatchSection f={{ model: MODEL, lower: ["", ""], upper: ["", "5"] }} />);
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(register).toHaveBeenCalledOnce();
  });
});
