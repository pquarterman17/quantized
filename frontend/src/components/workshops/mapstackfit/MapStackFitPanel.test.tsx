// Map stack fit, through the user's path: open the tool from the Analyze command
// and the map's context menu, pick the stack and model, run, and find the
// parameter maps committed, linked to every layer, in one undo step. A cancel
// writes nothing; a bad field is refused before anything is sent.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import type { StackFitResult } from "../../../lib/api/mapStackFit";
import type { DataStruct, FitModel } from "../../../lib/types";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useApp } from "../../../store/useApp";
import AnalysisExtrasHost from "../analysisextras/AnalysisExtrasHost";

const { submitMock, pollMock, cancelMock, modelsMock } = vi.hoisted(() => ({
  submitMock: vi.fn(), pollMock: vi.fn(), cancelMock: vi.fn(), modelsMock: vi.fn(),
}));
vi.mock("../../../lib/api/mapStackFit", () => ({ submitStackFit: submitMock }));
vi.mock("../../../lib/api/curvefit", () => ({ listFitModels: modelsMock }));
vi.mock("../../../lib/jobs", async (orig) => ({ ...(await orig<typeof import("../../../lib/jobs")>()), pollJob: pollMock, cancelJob: cancelMock }));

const grid = (z = 1): DataStruct => ({
  time: [0, 1, 0, 1], values: [[0, 0, z], [1, 0, 2], [0, 1, 3], [1, 1, 4]],
  labels: ["x", "y", "Intensity"], units: ["mm", "mm", "cts"],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native" },
});
const EXP: FitModel = { name: "Exponential Decay", category: "Decay", paramNames: ["A", "τ", "C"], nParams: 3, p0: [1, 1, 0], lb: [null, 0, null], ub: [null, null, null] };
const LIN: FitModel = { name: "Linear", category: "Polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [null, null], ub: [null, null] };

const NAMES = ["A", "A (std. error)", "τ", "τ (std. error)", "C", "C (std. error)", "reduced chi-sq", "converged"];
const RESULT: StackFitResult = {
  outputs: NAMES.map((name, i) => ({ name, kind: "parameter" as const, dataset: grid(10 + i) })),
  summary: { n_pixels: 4, n_layers: 3, n_fitted: 3, n_failed: 1, n_no_data: 0, n_unconverged_kept: 0, failures: [{ reason: "the fit did not converge", count: 1, first_pixel: { row: 1, col: 0 } }] },
};

const layers = ["map_300K.dat", "map_350K.dat", "map_400K.dat"];

beforeEach(() => {
  vi.clearAllMocks();
  modelsMock.mockResolvedValue({ models: [LIN, EXP] });
  submitMock.mockResolvedValue({ job_id: "j1" });
  pollMock.mockResolvedValue(RESULT);
  useAnalysisExtras.setState({ open: [] });
  useApp.setState({
    datasets: [
      ...layers.map((name, i) => ({ id: `m${i}`, name, data: grid() })),
      { id: "t", name: "curve.csv", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } },
    ],
    activeId: "m0", analysisResults: [], staleDatasets: [], staleFits: [], recalcMode: "manual", status: "",
  });
});

async function openFromCommand() {
  render(<AnalysisExtrasHost />);
  const cmd = buildAnalysisCommands(useApp.getState).find((c) => c.id === "map-stack-fit")!;
  act(() => cmd.run());
  await screen.findByLabelText("Maps of the stack");
  await screen.findByRole("option", { name: "Decay: Exponential Decay" });
}

describe("Map stack fit", () => {
  it("reads the temperatures from the names, runs the job and commits linked maps in one undo step", async () => {
    await openFromCommand();
    expect(screen.getByLabelText("Value for map_300K.dat")).toHaveValue("300");
    expect(screen.getByLabelText("Value for map_400K.dat")).toHaveValue("400");
    fireEvent.change(screen.getByLabelText("Variable name"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("τ lower"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("C start"), { target: { value: "0.1" } });
    fireEvent.click(screen.getByLabelText("Hold C"));
    fireEvent.click(screen.getByRole("button", { name: /Fit every pixel/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4 + 8));
    const req = submitMock.mock.calls[0]![0];
    expect(req).toMatchObject({
      model: "Exponential Decay", x_values: [300, 350, 400], x_label: "T", layer_names: layers,
      p0: [null, null, 0.1], lower: [null, 1, null], upper: [null, null, null], fixed: [false, false, true], keep_unconverged: false,
    });
    expect(req.datasets).toHaveLength(3);
    const results = useApp.getState().analysisResults.filter((r) => r.producer.id === "map-stack-fit");
    expect(results).toHaveLength(8);
    for (const r of results) expect(r.sources.map((s) => s.datasetId)).toEqual(["m0", "m1", "m2"]);
    expect(useApp.getState().datasets.map((d) => d.name)).toContain("map_300K.dat + 2 · Exponential Decay fit · τ (std. error)");
    expect(await screen.findByText(/3 of 4 pixels fitted; 1 failed/)).toBeInTheDocument();
    expect(screen.getByText(/1 × the fit did not converge \(first at row 2, column 1\)/)).toBeInTheDocument();
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets).toHaveLength(4);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("a change to any layer marks every output out of date", async () => {
    await openFromCommand();
    fireEvent.click(screen.getByRole("button", { name: /Fit every pixel/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(12));
    const outputs = useApp.getState().datasets.slice(4).map((d) => d.id);
    act(() => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "m1" ? { ...d, data: grid(9) } : d)) }));
      useApp.getState().touchDataset("m1");
    });
    expect([...useApp.getState().staleDatasets].sort()).toEqual([...outputs].sort());
  });

  it("refuses a missing value before anything is sent, and a held parameter without a start", async () => {
    await openFromCommand();
    fireEvent.change(screen.getByLabelText("Value for map_350K.dat"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Fit every pixel/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter a number for map_350K.dat/);
    fireEvent.change(screen.getByLabelText("Value for map_350K.dat"), { target: { value: "350" } });
    fireEvent.click(screen.getByLabelText("Hold A"));
    fireEvent.click(screen.getByRole("button", { name: /Fit every pixel/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/A is held, so it needs a start value/));
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("refuses a stack whose maps all have the same value", async () => {
    await openFromCommand();
    for (const n of layers) fireEvent.change(screen.getByLabelText(`Value for ${n}`), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Fit every pixel/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/all have the same value/);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("a cancel writes nothing and the Cancel button asks the job to stop", async () => {
    const { JobCancelledError } = await import("../../../lib/jobs");
    let release: (e: unknown) => void = () => undefined;
    pollMock.mockReturnValue(new Promise((_ok, no) => { release = no; }));
    await openFromCommand();
    fireEvent.click(screen.getByRole("button", { name: /Fit every pixel/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(cancelMock).toHaveBeenCalledWith("j1");
    await act(async () => release(new JobCancelledError("j1")));
    expect(await screen.findByText(/Cancelled: nothing was added/)).toBeInTheDocument();
    expect(useApp.getState().datasets).toHaveLength(4);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("shows the reason when the stack is refused", async () => {
    submitMock.mockRejectedValue(new Error("layer 2 is on a different grid"));
    await openFromCommand();
    fireEvent.click(screen.getByRole("button", { name: /Fit every pixel/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("different grid");
    expect(useApp.getState().datasets).toHaveLength(4);
  });

  it("opens from the map's context menu entry", async () => {
    const { default: MapContextMenu } = await import("../../Stage/MapContextMenu");
    render(<MapContextMenu x={0} y={0} datasetId="m0" canvas={null} cmap="viridis" logZ={false} contourOn={false} hasColorLimits={false} cutSpace={null} onExport={() => undefined} onClose={() => undefined} />);
    fireEvent.click(screen.getByText("Fit a map stack…"));
    expect(useAnalysisExtras.getState().open).toContain("map-stack-fit");
  });

  it("with fewer than three maps it says what a stack needs", async () => {
    useApp.setState({ datasets: [{ id: "a", name: "a", data: grid() }], activeId: "a" });
    render(<AnalysisExtrasHost />);
    act(() => useAnalysisExtras.getState().show("map-stack-fit"));
    expect(await screen.findByText(/at least 3 maps on the same grid/)).toBeInTheDocument();
  });
});
