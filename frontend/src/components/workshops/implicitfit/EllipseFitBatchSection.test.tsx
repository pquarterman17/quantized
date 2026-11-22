// Ellipse fit batch: the fit kind applied to every selected worksheet's
// reviewed X/Y; one summary table; thin sheets fail with a reason.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ellipseFit } from "../../../lib/api/analysisExtras";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import EllipseFitBatchSection from "./EllipseFitBatchSection";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/analysisExtras", () => ({ ellipseFit: vi.fn() }));

const sheet = (id: string, n: number): Dataset => ({
  id, name: `${id}.csv`,
  data: {
    time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [i * 2]),
    labels: ["Y"], units: [""], metadata: {},
  },
});

function seed(datasets: Dataset[]) {
  useApp.setState({
    datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: [0], seriesOrder: null,
    analysisResults: [], history: [], future: [], resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "ellipse-fit",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  vi.mocked(ellipseFit).mockImplementation((async (req: { x: number[] }) => ({
    center_x: req.x.length, center_y: 1, semi_major: 3, semi_minor: 2, angle_deg: 10, rms: 0.01,
    arc_coverage_deg: 360, converged: true,
  })) as never);
});

const run = () => {
  fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run Ellipse fit batch" }));
};

describe("EllipseFitBatchSection", () => {
  it("fits each selected worksheet and records one summary table", async () => {
    seed([sheet("a", 8), sheet("b", 9)]);
    render(<EllipseFitBatchSection geometric={false} />);
    run();
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    expect(vi.mocked(ellipseFit).mock.calls[0]![0]).toMatchObject({ geometric: false });
    const result = register.mock.calls[0]![0];
    expect(result.parameters).toMatchObject({ toolId: "ellipse-fit", geometric: false });
    expect(result.tables[0].rows).toEqual([
      ["a.csv", "Completed", 8, 8, 1, 3, 2, 10, 0.01, 360, null],
      ["b.csv", "Completed", 9, 9, 1, 3, 2, 10, 0.01, 360, null],
    ]);
  });

  it("fails a worksheet with too few points and does not call the API for it", async () => {
    seed([sheet("a", 8), sheet("b", 3)]);
    render(<EllipseFitBatchSection geometric />);
    run();
    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/an ellipse needs 5/).length).toBeGreaterThan(0);
    expect(ellipseFit).toHaveBeenCalledOnce();
  });
});
