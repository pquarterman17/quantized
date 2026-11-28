// Map operations: the panel gates on a map, sends the right request, and the
// result lands as a NEW derived dataset with provenance; refusals show the reason.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useApp } from "../../../store/useApp";
import AnalysisExtrasHost from "../analysisextras/AnalysisExtrasHost";
import MapOpsPanel from "./MapOpsPanel";

const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock("../../../lib/api/mapOps", () => ({ mapOpApply: applyMock }));

const grid = (name: string): DataStruct => ({
  time: [0, 1, 0, 1],
  values: [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 4]],
  labels: ["Qx", "Qz", "Intensity"],
  units: ["1/A", "1/nm", "cts"],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native", x_column_name: name },
});
const OUT: DataStruct = { ...grid("out"), metadata: { is2D: true, map_op: { op: "rotate", degrees: 90 } } };

beforeEach(() => {
  vi.clearAllMocks();
  applyMock.mockResolvedValue(OUT);
  useApp.setState({
    datasets: [
      { id: "a", name: "rsm.xrdml", data: grid("Qx") },
      { id: "b", name: "dark.xrdml", data: grid("Qx") },
    ],
    activeId: "a",
    status: "",
  });
});

describe("MapOpsPanel", () => {
  it("asks for a map when the active dataset is not one", () => {
    useApp.setState({ datasets: [{ id: "t", name: "t.csv", data: { ...grid("x"), metadata: {} } }], activeId: "t" });
    render(<MapOpsPanel />);
    expect(screen.getByText(/Select a 2-D map/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply → new dataset/ })).not.toBeInTheDocument();
  });

  it("rotates and adds a derived dataset with the operation in its name", async () => {
    render(<MapOpsPanel />);
    fireEvent.change(screen.getByLabelText("Map operation"), { target: { value: "rotate" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(applyMock.mock.calls[0][0]).toMatchObject({ op: "rotate", degrees: 90, dataset: { labels: ["Qx", "Qz", "Intensity"] } });
    const made = useApp.getState().datasets[2];
    expect(made.name).toBe("rsm.xrdml · rotate 90°");
    expect(made.data.metadata["map_op"]).toEqual({ op: "rotate", degrees: 90 });
    // Source untouched; the result is recorded as derived from it.
    expect(useApp.getState().datasets[0].data.values).toEqual(grid("Qx").values);
    expect(useApp.getState().analysisResults.some((r) => r.producer.id === "map-ops")).toBe(true);
  });

  it("sends map B for arithmetic, and shows the server's refusal", async () => {
    applyMock.mockRejectedValueOnce(new Error("the two maps are on different grids and were not combined."));
    render(<MapOpsPanel />);
    fireEvent.change(screen.getByLabelText("Map operation"), { target: { value: "arith" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    expect(await screen.findByText(/second map/)).toBeInTheDocument();
    expect(applyMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Map B"), { target: { value: "b" } });
    fireEvent.click(screen.getByLabelText(/Interpolate B/));
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("different grids");
    expect(applyMock.mock.calls[0][0]).toMatchObject({ op: "arith", arith: "sub", interpolate: true, other: { labels: ["Qx", "Qz", "Intensity"] } });
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("runs a 2-D FFT filter and an image filter, committing derived maps with the settings", async () => {
    render(<MapOpsPanel />);
    fireEvent.change(screen.getByLabelText("Map operation"), { target: { value: "fftfilter" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/cutoff/);
    expect(applyMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("High cutoff"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(applyMock.mock.calls[0][0]).toMatchObject({ op: "fft_filter", filter_mode: "lowpass", cutoff_high: 0.5 });
    expect(useApp.getState().datasets[2].name).toBe("rsm.xrdml · FFT lowpass");
    fireEvent.change(screen.getByLabelText("Map operation"), { target: { value: "imgfilter" } });
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "median" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(applyMock.mock.calls[1][0]).toMatchObject({ op: "image_filter", filter_kind: "median", size: 3, edge_mode: "reflect" });
    expect(useApp.getState().analysisResults.filter((r) => r.producer.id === "map-ops").length).toBeGreaterThanOrEqual(2);
  });

  it("crops with the box drawn on the map: same request as typing the snapped bounds, refusals shown", async () => {
    render(<MapOpsPanel />);
    const use = screen.getByRole("button", { name: /box drawn on the map/ });
    expect(use).toBeDisabled();
    act(() => useApp.getState().setMapRoi({ space: "q", x0: 1.2, x1: -0.1, y0: -0.2, y1: 0.9 }));
    fireEvent.click(use);
    expect(screen.getByLabelText("X min")).toHaveValue("0");
    expect(screen.getByLabelText("X max")).toHaveValue("1");
    expect(screen.getByLabelText("Y max")).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    const { dataset: _d1, ...drawn } = applyMock.mock.calls[0][0];
    expect(drawn).toMatchObject({ op: "crop", xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
    for (const [label, v] of [["X min", "0"], ["X max", "1"], ["Y min", "0"], ["Y max", "1"]]) {
      fireEvent.change(screen.getByLabelText(label!), { target: { value: v } });
    }
    fireEvent.click(screen.getByRole("button", { name: /Apply → new dataset/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    const { dataset: _d2, ...typed } = applyMock.mock.calls[1][0];
    expect(typed).toEqual(drawn);
    act(() => useApp.getState().setMapRoi({ space: "q", x0: 0.1, x1: 0.4, y0: 0, y1: 1 }));
    fireEvent.click(use);
    expect(await screen.findByRole("alert")).toHaveTextContent(/single cell/);
  });

  it("opens from the Analyze command", async () => {
    useAnalysisExtras.setState({ open: [] });
    render(<AnalysisExtrasHost />);
    const cmd = buildAnalysisCommands(useApp.getState).find((c) => c.id === "map-ops")!;
    act(() => cmd.run());
    expect(await screen.findByText("Map operations")).toBeInTheDocument();
  });
});
