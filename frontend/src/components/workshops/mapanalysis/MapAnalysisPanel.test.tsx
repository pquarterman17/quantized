// Map analysis: the panel gates on a map, sends the right request, and the
// result lands as a NEW derived table with provenance; refusals show the reason.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useApp } from "../../../store/useApp";
import AnalysisExtrasHost from "../analysisextras/AnalysisExtrasHost";
import MapAnalysisPanel from "./MapAnalysisPanel";

const { peaksMock, volumeMock } = vi.hoisted(() => ({ peaksMock: vi.fn(), volumeMock: vi.fn() }));
vi.mock("../../../lib/api/mapAnalysis", () => ({ mapPeaks: peaksMock, mapVolume: volumeMock }));

const grid = (): DataStruct => ({
  time: [0, 1, 0, 1],
  values: [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 4]],
  labels: ["Qx", "Qz", "Intensity"],
  units: ["1/A", "1/nm", "cts"],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native" },
});
const PEAK_TABLE: DataStruct = {
  time: [1], values: [[1.5, 0.01]], labels: ["Qx centre", "Qx centre err"], units: ["", ""],
  metadata: { map_peaks: { n_found: 1, peaks: [{ rank: 1, ok: true, x0: 1.5, x0_err: 0.01, y0: 2, y0_err: 0.02, volume: 9, volume_err: 0.5 }] } },
};
const VOL_TABLE: DataStruct = {
  time: [1], values: [[12.5, 4]], labels: ["Volume", "Area"], units: ["", ""],
  metadata: { map_volume: { volume: 12.5, area: 4, n_cells: 16, n_nan: 0, mean: 3.125 } },
};

beforeEach(() => {
  vi.clearAllMocks();
  peaksMock.mockResolvedValue(PEAK_TABLE);
  volumeMock.mockResolvedValue(VOL_TABLE);
  useApp.setState({ datasets: [{ id: "a", name: "rsm.xrdml", data: grid() }], activeId: "a", status: "", mapRoi: null });
});

describe("MapAnalysisPanel", () => {
  it("asks for a map when the active dataset is not one", () => {
    useApp.setState({ datasets: [{ id: "t", name: "t.csv", data: { ...grid(), metadata: {} } }], activeId: "t" });
    render(<MapAnalysisPanel />);
    expect(screen.getByText(/Select a 2-D map/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
  });

  it("finds peaks: request sent, a new table committed with provenance, source untouched, one undo step", async () => {
    render(<MapAnalysisPanel />);
    fireEvent.change(screen.getByLabelText("Peak model"), { target: { value: "lorentzian" } });
    fireEvent.click(screen.getByLabelText(/Allow the peak to rotate/));
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(peaksMock.mock.calls[0][0]).toMatchObject({ model: "lorentzian", rotate: true, threshold: 0.05, dataset: { labels: ["Qx", "Qz", "Intensity"] } });
    expect(useApp.getState().datasets[1].name).toBe("rsm.xrdml · map peaks");
    expect(useApp.getState().datasets[0].data.values).toEqual(grid().values);
    expect(useApp.getState().analysisResults.some((r) => r.producer.id === "map-analysis")).toBe(true);
    expect(await screen.findByText(/1 peak fitted/)).toBeInTheDocument();
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().analysisResults.some((r) => r.producer.id === "map-analysis")).toBe(false);
  });

  it("a repeat of the same run adds nothing", async () => {
    render(<MapAnalysisPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Apply/ })); });
    expect(peaksMock).toHaveBeenCalledTimes(2);
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("volume: bounds from the drawn box, refusals and server errors are shown", async () => {
    render(<MapAnalysisPanel />);
    fireEvent.change(screen.getByLabelText("Analysis kind"), { target: { value: "volume" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/four rectangle bounds/);
    expect(volumeMock).not.toHaveBeenCalled();
    const use = screen.getByRole("button", { name: /box drawn on the map/ });
    expect(use).toBeDisabled();
    act(() => useApp.getState().setMapRoi({ space: "q", x0: 1, x1: 0, y0: 0, y1: 1 }));
    fireEvent.click(use);
    expect(screen.getByLabelText("X min")).toHaveValue("0");
    expect(screen.getByLabelText("X max")).toHaveValue("1");
    fireEvent.change(screen.getByLabelText("Background"), { target: { value: "plane" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(volumeMock.mock.calls[0][0]).toMatchObject({ region: { kind: "rect", x0: 0, x1: 1, y0: 0, y1: 1 }, background: { kind: "plane" }, rule: "pixel", x_col: 0, y_col: 1, z_col: 2 });
    fireEvent.change(screen.getByLabelText("Integration rule"), { target: { value: "trapezoid" } });
    fireEvent.change(screen.getByLabelText("X max"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(volumeMock.mock.calls[1][0]).toMatchObject({ rule: "trapezoid" });
    fireEvent.change(screen.getByLabelText("X max"), { target: { value: "1" } });
    expect(await screen.findByText(/Volume 12.5/)).toBeInTheDocument();
    volumeMock.mockRejectedValueOnce(new Error("the region contains no cells of the map"));
    fireEvent.change(screen.getByLabelText("X max"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no cells");
    expect(useApp.getState().datasets).toHaveLength(3);
  });

  it("opens from the Analyze command", async () => {
    useAnalysisExtras.setState({ open: [] });
    render(<AnalysisExtrasHost />);
    const cmd = buildAnalysisCommands(useApp.getState).find((c) => c.id === "map-analysis")!;
    act(() => cmd.run());
    expect(await screen.findByText("Map analysis")).toBeInTheDocument();
  });
});
