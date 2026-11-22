// Optical gap batch: the panel's settings applied to every selected
// worksheet's reviewed X/Y; one summary table; refusals say why.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { taucFit } from "../../../lib/api/analysisExtras";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import OpticalGapBatchSection from "./OpticalGapBatchSection";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/analysisExtras", () => ({ taucFit: vi.fn() }));

const SETTINGS = { xUnit: "eV", signal: "alpha", percent: false, thickness: "", kind: "direct", eMin: "", eMax: "" } as const;
const sheet = (id: string, offset: number, unit = "eV"): Dataset => ({
  id, name: `${id}.csv`,
  data: {
    time: [1, 2, 3, 4], values: [[offset], [offset + 1], [offset + 2], [offset + 3]],
    labels: ["alpha"], units: [""], metadata: { x_column_unit: unit },
  },
});

function seed(datasets: Dataset[]) {
  useApp.setState({
    datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: [0], seriesOrder: null,
    analysisResults: [], history: [], future: [], resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "optical-gap",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  vi.mocked(taucFit).mockImplementation((async (req: { y: number[] }) => ({
    eg: req.y[0]! / 10, eg_se: 0.01, e_min: 1, e_max: 3, r2: 0.999, n_fit: 3,
  })) as never);
});

const run = () => {
  fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run Optical gap batch" }));
};

describe("OpticalGapBatchSection", () => {
  it("fits each worksheet with the panel's settings and records one summary table", async () => {
    seed([sheet("a", 10), sheet("b", 20)]);
    render(<OpticalGapBatchSection g={{ ...SETTINGS, eMin: "1.5" }} />);
    run();
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    expect(vi.mocked(taucFit).mock.calls[0]![0]).toMatchObject({ x: [1, 2, 3, 4], x_unit: "eV", kind: "direct", e_min: 1.5, signal: "alpha" });
    const result = register.mock.calls[0]![0];
    expect(result.tables[0].columns).toEqual(["Worksheet", "Status", "Rows", "Eg (eV)", "Eg SE (eV)", "Window min (eV)", "Window max (eV)", "R² of the line", "Points in fit", "Warnings"]);
    expect(result.tables[0].rows).toEqual([
      ["a.csv", "Completed", 4, 1, 0.01, 1, 3, 0.999, 3, null],
      ["b.csv", "Completed", 4, 2, 0.01, 1, 3, 0.999, 3, null],
    ]);
  });

  it("flags a worksheet whose X unit differs from the batch's", async () => {
    seed([sheet("a", 10), sheet("b", 20, "nm")]);
    render(<OpticalGapBatchSection g={SETTINGS} />);
    run();
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    expect(register.mock.calls[0]![0].tables[0].rows[1][9]).toMatch(/reads as nm, but the batch uses eV/);
  });

  it("refuses transmittance without a thickness and says why", () => {
    seed([sheet("a", 10)]);
    render(<OpticalGapBatchSection g={{ ...SETTINGS, signal: "transmittance" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    expect(screen.getByRole("button", { name: "Run Optical gap batch" })).toBeDisabled();
    expect(taucFit).not.toHaveBeenCalled();
  });
});

describe("OpticalGapBatchSection settings change", () => {
  it("drops the finished table when a setting changes", async () => {
    seed([sheet("a", 10), sheet("b", 20)]);
    const { rerender } = render(<OpticalGapBatchSection g={{ ...SETTINGS }} />);
    run();
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    rerender(<OpticalGapBatchSection g={{ ...SETTINGS }} />);
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    rerender(<OpticalGapBatchSection g={{ ...SETTINGS, eMin: "1.5" }} />);
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(register).toHaveBeenCalledOnce();
  });
});
