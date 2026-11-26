// Map gridding: the panel sends the right request for each job, the result
// lands as a NEW derived dataset with provenance, refusals show the reason.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setMapPick } from "../../../lib/mapPick";
import type { DataStruct } from "../../../lib/types";
import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useApp } from "../../../store/useApp";
import AnalysisExtrasHost from "../analysisextras/AnalysisExtrasHost";
import MapGridPanel from "./MapGridPanel";

const { gridMock, formulaMock, extractMock } = vi.hoisted(() => ({ gridMock: vi.fn(), formulaMock: vi.fn(), extractMock: vi.fn() }));
vi.mock("../../../lib/api/mapGrid", () => ({ gridXyz: gridMock, mapFormula: formulaMock, extractPixels: extractMock }));

const map = (): DataStruct => ({
  time: [0, 1, 0, 1],
  values: [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 4]],
  labels: ["Qx", "Qz", "Intensity"],
  units: ["1/A", "1/nm", "cts"],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native" },
});
const sheet: DataStruct = {
  time: [1, 2, 3, 4, 5],
  values: [[10, 0.1], [20, 0.4], [30, 0.2], [15, 0.9], [25, 0.5]],
  labels: ["T", "R"],
  units: ["K", "ohm"],
  metadata: { x_column_name: "H", x_column_unit: "T" },
};
const OUT: DataStruct = { ...map(), metadata: { is2D: true, map_op: { op: "grid_xyz" } } };

beforeEach(() => {
  vi.clearAllMocks();
  gridMock.mockResolvedValue(OUT);
  formulaMock.mockResolvedValue(OUT);
  extractMock.mockResolvedValue({ time: [1, 2], values: [[0, 1.5, 1, 0, 0], [1, 2.5, 2, 0, 0]], labels: ["Map", "Value", "Nearest value", "Cell Qx", "Cell Qz"], units: ["", "cts", "cts", "1/A", "1/nm"], metadata: {} });
  useApp.setState({
    datasets: [
      { id: "s", name: "sweep.dat", data: sheet },
      { id: "a", name: "m1", data: map() },
      { id: "b", name: "m2", data: map() },
    ],
    activeId: "s",
    status: "",
  });
});

describe("MapGridPanel", () => {
  it("grids the picked columns with kriging variance and adds a derived map", async () => {
    render(<MapGridPanel />);
    fireEvent.change(screen.getByLabelText("Gridding method"), { target: { value: "kriging" } });
    fireEvent.change(screen.getByLabelText("Kriging output"), { target: { value: "variance" } });
    fireEvent.change(screen.getByLabelText("Variogram model"), { target: { value: "gaussian" } });
    fireEvent.click(screen.getByLabelText(/Log10-spaced X/));
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    const body = gridMock.mock.calls[0][0];
    expect(body).toMatchObject({ method: "kriging", output: "variance", variogram: "gaussian", log_x: true, log_y: false, nx: 100, extrapolation: "none", x_col: -1, y_col: 0, z_col: 1 });
    expect(body.dataset).toMatchObject({ time: [1, 2, 3, 4, 5], labels: ["T", "R"], metadata: { x_column_name: "H", x_column_unit: "T" } });
    const made = useApp.getState().datasets[3];
    expect(made.name).toBe("sweep.dat · variance Kriging logX");
    expect(useApp.getState().datasets[0].data.values).toEqual(sheet.values);
    expect(useApp.getState().analysisResults.some((r) => r.producer.id === "map-grid")).toBe(true);
  });

  it("sends modified Shepard options and refuses bad numbers before calling the server", async () => {
    render(<MapGridPanel />);
    fireEvent.change(screen.getByLabelText("Gridding method"), { target: { value: "shepard" } });
    fireEvent.change(screen.getByLabelText("Shepard radius"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/fraction of the data extent/);
    expect(gridMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Shepard radius"), { target: { value: "0.3" } });
    fireEvent.click(screen.getByLabelText(/Quadratic nodal/));
    fireEvent.click(screen.getByLabelText(/Fill outside/));
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(gridMock.mock.calls[0][0]).toMatchObject({ method: "shepard", shepard_radius: 0.3, shepard_neighbors: 19, shepard_quadratic: false, extrapolation: "nearest" });
  });

  it("shows the server's refusal and adds nothing", async () => {
    gridMock.mockRejectedValueOnce(new Error("a log-spaced x axis needs every x above 0"));
    render(<MapGridPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("log-spaced");
    expect(useApp.getState().datasets).toHaveLength(3);
  });

  it("sets a map's values from a formula, only for a map", async () => {
    render(<MapGridPanel />);
    fireEvent.change(screen.getByLabelText("Gridding job"), { target: { value: "formula" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Select a 2-D map/);
    expect(formulaMock).not.toHaveBeenCalled();
    act(() => useApp.setState({ activeId: "a" }));
    fireEvent.change(screen.getByLabelText("Formula"), { target: { value: "z * 2 + x" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(formulaMock.mock.calls[0][0]).toMatchObject({ expr: "z * 2 + x", dataset: { labels: ["Qx", "Qz", "Intensity"] } });
    expect(useApp.getState().datasets[3].name).toBe("m1 · z * 2 + x");
  });

  it("extracts the pixel from every ticked map into one worksheet; the box centre fills the location", async () => {
    render(<MapGridPanel />);
    fireEvent.change(screen.getByLabelText("Gridding job"), { target: { value: "extract" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/location as numbers/);
    expect(extractMock).not.toHaveBeenCalled();
    const centre = screen.getByRole("button", { name: /centre of the box/ });
    expect(centre).toBeDisabled();
    act(() => useApp.getState().setMapRoi({ space: "angular", x0: 0.2, x1: 0.6, y0: 0, y1: 1 }));
    fireEvent.click(centre);
    expect(screen.getByLabelText("Location X")).toHaveValue("0.4");
    expect(screen.getByLabelText("Location Y")).toHaveValue("0.5");
    fireEvent.click(screen.getByLabelText("m2"));
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    const body = extractMock.mock.calls[0][0] as { x: number; y: number; maps: { name: string }[] };
    expect(body).toMatchObject({ x: 0.4, y: 0.5 });
    expect(body.maps.map((m) => m.name)).toEqual(["m1"]);
    expect(useApp.getState().datasets[3].name).toBe("m1 · pixel (0.4, 0.5)");
    act(() => useApp.getState().setMapRoi({ space: "q", x0: 0, x1: 1, y0: 0, y1: 1 }));
    fireEvent.click(centre);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Q space/);
  });

  it("a point picked on the map fills the location, now and when the workshop opens later", async () => {
    render(<MapGridPanel />);
    fireEvent.change(screen.getByLabelText("Gridding job"), { target: { value: "extract" } });
    expect(screen.getByText(/arm the Pick point tool/)).toBeInTheDocument();
    act(() => setMapPick({ x: 0.25, y: 0.75, axes: ["Qx", "Qz"] }));
    expect(screen.getByLabelText("Location X")).toHaveValue("0.25");
    expect(screen.getByLabelText("Location Y")).toHaveValue("0.75");
    expect(screen.getByText(/Picked on Qx \/ Qz/)).toBeInTheDocument();
    cleanup();
    // Opened after the pick: the last pick is already in the fields.
    render(<MapGridPanel />);
    fireEvent.change(screen.getByLabelText("Gridding job"), { target: { value: "extract" } });
    expect(screen.getByLabelText("Location X")).toHaveValue("0.25");
    act(() => setMapPick(null));
  });

  it("the box centre also works for a plain-map box drawn on the maps' own axes, and refuses other axes", () => {
    act(() => useApp.setState({ activeId: "a" }));
    render(<MapGridPanel />);
    fireEvent.change(screen.getByLabelText("Gridding job"), { target: { value: "extract" } });
    const centre = screen.getByRole("button", { name: /centre of the box/ });
    act(() => useApp.getState().setMapRoi({ space: "map", axes: ["Qx", "Qz"], x0: 0, x1: 1, y0: 0, y1: 0.5 }));
    fireEvent.click(centre);
    expect(screen.getByLabelText("Location X")).toHaveValue("0.5");
    act(() => useApp.getState().setMapRoi({ space: "map", axes: ["Qx", "Intensity"], x0: 0, x1: 1, y0: 0, y1: 1 }));
    fireEvent.click(centre);
    expect(screen.getByRole("alert")).toHaveTextContent(/other than the ones pixel extraction reads/);
  });

  it("opens from the Analyze command", async () => {
    useAnalysisExtras.setState({ open: [] });
    render(<AnalysisExtrasHost />);
    const cmd = buildAnalysisCommands(useApp.getState).find((c) => c.id === "map-grid")!;
    act(() => cmd.run());
    expect(await screen.findByText("Map gridding")).toBeInTheDocument();
  });
});
