// Math extras: each job sends the right request, a worksheet result lands as a
// NEW derived dataset with provenance, cards show the numbers, refusals show
// the reason, and the panel is reachable lazily from its command.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useApp } from "../../../store/useApp";
import AnalysisExtrasHost from "../analysisextras/AnalysisExtrasHost";
import MathExtrasPanel from "./MathExtrasPanel";

const api = vi.hoisted(() => ({
  polygonArea: vi.fn(), surfaceArea: vi.fn(), traceInterp: vi.fn(), bsplineResample: vi.fn(),
  scatterInterp: vi.fn(), correlateMaps: vi.fn(), solveRoot: vi.fn(), optimizeBox: vi.fn(),
}));
vi.mock("../../../lib/api/mathExtras", () => api);

const sheet: DataStruct = {
  time: [0, 1, 1, 0],
  values: [[0, 5], [0, 6], [1, 7], [1, 8]],
  labels: ["Y", "W"],
  units: ["mm", "V"],
  metadata: { x_column_name: "X", x_column_unit: "mm" },
};
const map = (): DataStruct => ({
  time: [0, 1, 0, 1],
  values: [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 4]],
  labels: ["Qx", "Qz", "Intensity"],
  units: ["", "", ""],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native" },
});
const OUT: DataStruct = { time: [0, 1], values: [[0], [1]], labels: ["Y"], units: ["mm"], metadata: { math_extras: { total_length: 3, outside: 1, n_points: 4 } } };

const pickMode = (value: string) => fireEvent.change(screen.getByLabelText("Math job"), { target: { value } });
const click = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
  api.polygonArea.mockResolvedValue({ area: 1, signed_area: -1, perimeter: 4, n_points: 4, dropped: 0, self_intersecting: false });
  api.surfaceArea.mockResolvedValue({ surface_area: 1.5, projected_area: 1, n_cells: 1, skipped_cells: 0 });
  api.traceInterp.mockResolvedValue(OUT);
  api.bsplineResample.mockResolvedValue({ ...OUT, metadata: { math_extras: { n_knots: 8, residual: 0 } } });
  api.scatterInterp.mockResolvedValue(OUT);
  api.correlateMaps.mockResolvedValue({ ...map(), metadata: { is2D: true, math_extras: { peak: { value: 0.9, offset_x: 2, offset_y: -1, lag_x: 2, lag_y: -1 } } } });
  api.solveRoot.mockResolvedValue({ roots: [3], residuals: [0], scanned: 512, poles_discarded: 1 });
  api.optimizeBox.mockResolvedValue({ variables: ["x"], point: [2], value: 1, sense: "min", converged: true, starts: 8, starts_agreeing: 8, at_bound: ["x"] });
  useApp.setState({
    datasets: [{ id: "s", name: "loop.dat", data: sheet }, { id: "a", name: "m1", data: map() }, { id: "b", name: "m2", data: map() }],
    activeId: "s",
    analysisResults: [],
    status: "",
  });
});

describe("MathExtrasPanel", () => {
  it("keeps the run button in a footer pinned to the foot of the scroll area, for every job", () => {
    render(<MathExtrasPanel />);
    for (const job of ["polygon-area", "trace", "root", "optimize", "system"]) {
      pickMode(job);
      const footer = screen.getByTestId("math-extras-actions");
      expect(footer.style.position).toBe("sticky");
      expect(footer.style.bottom).toBe("0px");
      expect(footer).toContainElement(screen.getByRole("button", { name: /Calculate|Apply/ }));
    }
  });

  it("shows the enclosed area on a card and adds no dataset", async () => {
    render(<MathExtrasPanel />);
    click(/Calculate/);
    expect(await screen.findByRole("status", { name: "Result" })).toHaveTextContent("Enclosed area");
    expect(api.polygonArea.mock.calls[0]![0]).toEqual([0, 1, 1, 0]);
    expect(api.polygonArea.mock.calls[0]![1]).toEqual([0, 0, 1, 1]);
    expect(screen.getByRole("status")).toHaveTextContent("Signed area-1");
    expect(useApp.getState().datasets).toHaveLength(3);
  });

  it("resamples a trace by spacing and commits a derived dataset with provenance", async () => {
    render(<MathExtrasPanel />);
    pickMode("trace");
    fireEvent.change(screen.getByLabelText("Output sizing"), { target: { value: "spacing" } });
    fireEvent.change(screen.getByLabelText("Spacing"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Interpolation"), { target: { value: "pchip" } });
    click(/Apply/);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(api.traceInterp.mock.calls[0]![0]).toMatchObject({ spacing: 0.5, kind: "pchip", periodic: false, x_label: "X", y_label: "Y", x_unit: "mm" });
    expect(api.traceInterp.mock.calls[0]![0].n).toBeUndefined();
    expect(useApp.getState().datasets[3]!.name).toBe("loop.dat · trace");
    expect(useApp.getState().datasets[0]!.data.values).toEqual(sheet.values);
    expect(useApp.getState().analysisResults.some((r) => r.producer.id === "math-extras")).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Path length3");
  });

  it("refuses a bad point count before calling the server", async () => {
    render(<MathExtrasPanel />);
    pickMode("bspline");
    fireEvent.change(screen.getByLabelText("Number of points"), { target: { value: "1" } });
    click(/Apply/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 2/);
    expect(api.bsplineResample).not.toHaveBeenCalled();
  });

  it("interpolates scattered 2-D data onto typed points and reports points outside", async () => {
    render(<MathExtrasPanel />);
    pickMode("scatter");
    click(/Apply/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least one point/);
    fireEvent.change(screen.getByLabelText("Query points"), { target: { value: "0.5 0.5\n2 2" } });
    click(/Apply/);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    const body = api.scatterInterp.mock.calls[0]![0];
    expect(body.queries).toEqual([[0.5, 0.5], [2, 2]]);
    expect(body.points).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(body.values).toEqual([5, 6, 7, 8]);
    expect(body).toMatchObject({ method: "linear", extrapolation: "none", value_label: "W" });
    expect(screen.getByRole("status")).toHaveTextContent("Outside the data1");
  });

  it("correlates two maps and shows the peak offset; refuses a non-map active dataset", async () => {
    render(<MathExtrasPanel />);
    pickMode("correlate");
    expect(screen.getByText(/Select a 2-D map as the first map/)).toBeInTheDocument();
    click(/Apply/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Select a 2-D map/);
    expect(api.correlateMaps).not.toHaveBeenCalled();
    await act(async () => useApp.setState({ activeId: "a" }));
    click(/Apply/);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(api.correlateMaps.mock.calls[0]![2]).toBe("error");
    expect(screen.getByRole("status")).toHaveTextContent("Offset X2");
    expect(useApp.getState().datasets[3]!.name).toBe("m1 ⋆ m2");
  });

  it("sends the surface-area map and the blank-cell choice", async () => {
    useApp.setState({ activeId: "a" });
    render(<MathExtrasPanel />);
    pickMode("surface-area");
    fireEvent.click(screen.getByLabelText(/Skip cells/));
    click(/Calculate/);
    expect(await screen.findByRole("status")).toHaveTextContent("Surface area1.5");
    expect(api.surfaceArea.mock.calls[0]![1]).toBe("skip");
  });

  it("solves a root with named constants and minimises with parsed bounds, needing no dataset", async () => {
    useApp.setState({ datasets: [], activeId: null });
    render(<MathExtrasPanel />);
    pickMode("root");
    fireEvent.change(screen.getByLabelText("Expression"), { target: { value: "x^2 - a" } });
    fireEvent.change(screen.getByLabelText("Bracket low"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Bracket high"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Constants"), { target: { value: "a = 9" } });
    click(/Calculate/);
    expect(await screen.findByRole("status")).toHaveTextContent("Root");
    expect(api.solveRoot.mock.calls[0]![0]).toEqual({ expr: "x^2 - a", lo: 0, hi: 5, target: 0, constants: { a: 9 } });
    expect(screen.getByRole("status")).toHaveTextContent(/1 jump across a pole was ignored/);
    pickMode("optimize");
    fireEvent.change(screen.getByLabelText("Expression"), { target: { value: "(x-2)^2+1" } });
    fireEvent.change(screen.getByLabelText("Bounds"), { target: { value: "x = 0 .. 5" } });
    click(/Calculate/);
    expect(await screen.findByRole("status")).toHaveTextContent("Minimum");
    expect(api.optimizeBox.mock.calls[0]![0]).toEqual({ expr: "(x-2)^2+1", bounds: { x: [0, 5] }, sense: "min" });
    expect(screen.getByRole("status")).toHaveTextContent(/edge of the box: x/);
  });

  it("shows a server refusal and clears the card", async () => {
    api.polygonArea.mockRejectedValue(new Error("a polygon needs at least 3 distinct points"));
    render(<MathExtrasPanel />);
    click(/Calculate/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 3 distinct/);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens lazily from its Analyze command", async () => {
    const cmd = buildAnalysisCommands(() => useApp.getState()).find((a) => a.id === "math-extras");
    expect(cmd).toBeDefined();
    useAnalysisExtras.setState({ open: [] });
    render(<AnalysisExtrasHost />);
    expect(screen.queryByLabelText("Math job")).toBeNull();
    cmd!.run();
    expect(await screen.findByLabelText("Math job")).toBeInTheDocument();
    useAnalysisExtras.setState({ open: [] });
  });
});
