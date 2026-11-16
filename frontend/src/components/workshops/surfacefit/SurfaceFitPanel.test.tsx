// SurfaceFitPanel — column picks, auto guess, the fit request, the results
// table (SE and confidence limits), the stale-result rule and "Add fitted
// surface as dataset". The backend wrappers are mocked.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SurfaceFitResult } from "../../../lib/api/analysisExtras";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SurfaceFitPanel from "./SurfaceFitPanel";
import { cellSize, residualScale } from "./SurfaceResidualMap";

const { modelsMock, guessMock, fitMock } = vi.hoisted(() => ({ modelsMock: vi.fn(), guessMock: vi.fn(), fitMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ surfaceModels: modelsMock, surfaceGuess: guessMock, surfaceFit: fitMock }));

const DATA: DataStruct = {
  time: [0, 1, 0, 1],
  values: [[0, 1], [0, 2], [1, 3], [1, 5]],
  labels: ["Y", "Z"],
  units: ["mm", "V"],
  metadata: { x_column_name: "X", x_column_unit: "mm" },
};

const RESULT: SurfaceFitResult = {
  model_name: "Plane", param_names: ["a", "b", "c"], params: [2, 1, 1], errors: [0.1, 0.2, 0.3],
  inference: [
    { value: 2, error: 0.1, t: 20, prob: 0.001, lcl: 1.7, ucl: 2.3 },
    { value: 1, error: 0.2, t: 5, prob: 0.01, lcl: 0.4, ucl: 1.6 },
    { value: 1, error: 0.3, t: 3, prob: 0.05, lcl: 0.1, ucl: 1.9 },
  ],
  level: 0.95, x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [1, 2, 3, 5], z_fit: [1, 3, 2, 4], residuals: [0, -1, 1, 1],
  r2: 0.9, rmse: 0.5, chi_sq_red: 0.25, n_points: 4, n_free: 3, dof: 1, exit_flag: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  modelsMock.mockResolvedValue([
    { name: "Plane", param_names: ["a", "b", "c"], description: "z = a·x + b·y + c" },
    { name: "Paraboloid", param_names: ["a", "b", "c", "d", "e", "f"], description: "z = quadratic" },
  ]);
  guessMock.mockResolvedValue({ param_names: ["a", "b", "c"], p0: [1.5, 0.5, 0.25] });
  fitMock.mockResolvedValue(RESULT);
  useApp.setState({ datasets: [{ id: "d1", name: "map.csv", data: DATA }], activeId: "d1", status: "" });
});

describe("SurfaceFitPanel", () => {
  it("defaults to X, first channel, second channel and fills auto-guess start values", async () => {
    render(<SurfaceFitPanel />);
    expect(screen.getByLabelText("X column")).toHaveValue("-1");
    expect(screen.getByLabelText("Y column")).toHaveValue("0");
    expect(screen.getByLabelText("Z column")).toHaveValue("1");
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("1.5"));
    expect(guessMock).toHaveBeenCalledWith({ x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [1, 2, 3, 5], model: "Plane" });
  });

  it("fits with the edited start values and bounds, then shows value, SE and limits", async () => {
    render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("1.5"));
    fireEvent.change(screen.getByLabelText("Start a"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Upper bound b"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await screen.findByText("± SE");
    expect(fitMock).toHaveBeenCalledWith({
      x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [1, 2, 3, 5], model: "Plane",
      p0: [2, 0.5, 0.25], lower: [null, null, null], upper: [null, 9, null],
    });
    const results = within(screen.getByText("± SE").closest("table")!);
    const row = results.getByRole("cell", { name: "a" }).closest("tr")!;
    expect(within(row).getByText("0.1")).toBeInTheDocument(); // SE
    expect(within(row).getByText("1.7")).toBeInTheDocument(); // 95% low
    expect(screen.getByText("95% low")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Residual map/ })).toBeInTheDocument();
  });

  it("rejects a blank start value without calling the backend", async () => {
    render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("1.5"));
    fireEvent.change(screen.getByLabelText("Start b"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Start value for b is not a number");
    expect(fitMock).not.toHaveBeenCalled();
  });

  it("retires the result when a pick changes", async () => {
    render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("1.5"));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await screen.findByText("± SE");
    fireEvent.change(screen.getByLabelText("Z column"), { target: { value: "0" } });
    expect(screen.queryByText("± SE")).not.toBeInTheDocument();
  });

  it("sends only complete rows (a missing cell would be a 422) and keeps typed starts when a row is excluded", async () => {
    const holes: DataStruct = { ...DATA, values: [[0, 1], [0, Number.NaN], [1, 3], [1, 5]] };
    useApp.setState({ datasets: [{ id: "h", name: "holes", data: holes }], activeId: "h" });
    render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("1.5"));
    expect(guessMock).toHaveBeenLastCalledWith({ x: [0, 0, 1], y: [0, 1, 1], z: [1, 3, 5], model: "Plane" });
    fireEvent.change(screen.getByLabelText("Start a"), { target: { value: "7" } });
    guessMock.mockClear();
    // Excluding a row changes the analysis data, not the model or the columns.
    act(() => useApp.setState({ datasets: [{ id: "h", name: "holes", data: holes, excludedRows: [0] }] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText("Start a")).toHaveValue("7");
    expect(guessMock).not.toHaveBeenCalled();
  });

  it("adds the fitted surface as a map-able dataset", async () => {
    render(<SurfaceFitPanel />);
    await waitFor(() => expect(screen.getByLabelText("Start a")).toHaveValue("1.5"));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add fitted surface as dataset" }));
    const added = useApp.getState().datasets.find((d) => d.name === "map.csv (Plane fit)")!;
    expect(added.data.time).toEqual([0, 1, 0, 1]);
    expect(added.data.labels).toEqual(["Y", "Z (fit)", "Z", "Z residual"]);
    expect(added.data.values[1]).toEqual([0, 3, 2, -1]);
    expect(added.data.metadata["x_column_name"]).toBe("X");
  });

  it("asks for a dataset with three columns", () => {
    useApp.setState({ datasets: [{ id: "d2", name: "two", data: { ...DATA, values: [[0], [1], [2], [3]], labels: ["Y"], units: [""] } }], activeId: "d2" });
    render(<SurfaceFitPanel />);
    expect(screen.getByText(/at least three columns/)).toBeInTheDocument();
  });
});

describe("cellSize", () => {
  it("tiles a grid by its step and uses a spacing-based square for scattered points", () => {
    const gx = [0, 1, 2, 0, 1, 2, 0, 1, 2];
    const gy = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    expect(cellSize(gx, gy, 10, 5, 100, 100)).toEqual({ cw: 10, ch: 5 });
    const rx = Array.from({ length: 40 }, (_, i) => i * 0.37 + Math.sin(i));
    const ry = Array.from({ length: 40 }, (_, i) => Math.cos(i * 1.7) * 3);
    const c = cellSize(rx, ry, 10, 5, 100, 100);
    expect(c.cw).toBe(c.ch);
    expect(c.cw).toBeGreaterThanOrEqual(3);
  });
});

describe("residualScale", () => {
  it("is the largest finite magnitude, 1 when all zero", () => {
    expect(residualScale([0.5, -2, Number.NaN])).toBe(2);
    expect(residualScale([0, 0])).toBe(1);
  });
});
