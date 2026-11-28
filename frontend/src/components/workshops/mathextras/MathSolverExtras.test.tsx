// Math extras, wave 16: the map-correlation options (subtract means, local
// normalisation), the system-of-equations and the constrained-minimisation jobs.
// Every test drives the real panel: change a field, press the button, assert the
// request and the card, then "Open in Math extras" and check the options survive.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import MathExtrasPanel from "./MathExtrasPanel";
import { emptyForm } from "./mathExtrasForm";
import { formSettings, mathSeed } from "./mathExtrasSeed";

const api = vi.hoisted(() => ({
  polygonArea: vi.fn(), surfaceArea: vi.fn(), traceInterp: vi.fn(), bsplineResample: vi.fn(),
  scatterInterp: vi.fn(), correlateMaps: vi.fn(), solveRoot: vi.fn(), optimizeBox: vi.fn(),
  solveSystem: vi.fn(), optimizeConstrained: vi.fn(),
}));
vi.mock("../../../lib/api/mathExtras", () => api);

const map = (): DataStruct => ({
  time: [0, 1, 0, 1],
  values: [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 4]],
  labels: ["Qx", "Qz", "Intensity"],
  units: ["", "", ""],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native" },
});
const corrOut = (): DataStruct => ({
  ...map(), metadata: { is2D: true, math_extras: { peak: { value: 0.9, offset_x: 2, offset_y: -1, lag_x: 2, lag_y: -1 } } },
});

const pickMode = (value: string) => fireEvent.change(screen.getByLabelText("Math job"), { target: { value } });
const click = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const results = () => useApp.getState().analysisResults;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.correlateMaps.mockImplementation(async () => corrOut());
  useToolReopen.setState({ sessions: {} });
  useAnalysisExtras.setState({ open: [] });
  useApp.setState({
    datasets: [{ id: "a", name: "m1", data: map() }, { id: "b", name: "m2", data: map() }],
    activeId: "a", analysisResults: [], history: [], future: [], staleDatasets: [], status: "",
  });
});

describe("map correlation options", () => {
  it("sends nothing extra by default (the original behaviour)", async () => {
    render(<MathExtrasPanel />);
    pickMode("correlate");
    expect(screen.getByLabelText(/Subtract each map's mean/)).toBeChecked();
    expect(screen.getByLabelText("Normalise over")).toHaveValue("global");
    click(/Apply/);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(api.correlateMaps.mock.calls[0]![2]).toBe("error");
    expect(api.correlateMaps.mock.calls[0]![3]).toEqual({});
  });

  it("subtract-means off matches Origin: sent as subtract_means false, noted on the card", async () => {
    render(<MathExtrasPanel />);
    pickMode("correlate");
    fireEvent.click(screen.getByLabelText(/Subtract each map's mean/));
    click(/Apply/);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(api.correlateMaps.mock.calls[0]![3]).toEqual({ subtract_means: false });
    expect(screen.getByRole("status")).toHaveTextContent(/Means were not removed/);
  });

  it("local normalisation sends the overlap fraction, drops the blank-cell choice and refuses a bad fraction", async () => {
    render(<MathExtrasPanel />);
    pickMode("correlate");
    expect(screen.getByLabelText(/Let blank cells contribute nothing/)).toBeInTheDocument();
    type("Normalise over", "local");
    expect(screen.queryByLabelText(/Let blank cells contribute nothing/)).toBeNull();
    type("Smallest overlap", "1.5");
    click(/Apply/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/above 0 and at most 1/);
    expect(api.correlateMaps).not.toHaveBeenCalled();
    type("Smallest overlap", "0.4");
    click(/Apply/);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(api.correlateMaps.mock.calls[0]![3]).toEqual({ normalize: "local", min_overlap: 0.4 });
    expect(screen.getByRole("status")).toHaveTextContent(/normalised over the cells valid in both maps/);
  });

  it("Open in Math extras restores both options, and an older record keeps the defaults", async () => {
    const view = render(<MathExtrasPanel />);
    pickMode("correlate");
    fireEvent.click(screen.getByLabelText(/Subtract each map's mean/));
    type("Normalise over", "local");
    type("Smallest overlap", "0.4");
    click(/Apply/);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    view.unmount();
    const settings = (results()[0]!.parameters as { settings: Record<string, unknown> }).settings;
    expect(settings["form"]).toMatchObject({ subtractMeans: false, normalize: "local", minOverlap: "0.4" });
    expect(settings).toMatchObject({ subtract_means: false, normalize: "local", min_overlap: 0.4 });
    let opened = false;
    act(() => { opened = openCommittedResultInTool(results()[0]!.id); });
    expect(opened).toBe(true);
    render(<MathExtrasPanel />);
    expect(screen.getByLabelText("Math job")).toHaveValue("correlate");
    expect(screen.getByLabelText(/Subtract each map's mean/)).not.toBeChecked();
    expect(screen.getByLabelText("Normalise over")).toHaveValue("local");
    expect(screen.getByLabelText("Smallest overlap")).toHaveValue("0.4");

    // A result recorded before these options existed lists only blanksOk: still readable, defaults kept.
    const old = mathSeed({ mode: "correlate", form: { blanksOk: true }, picks: [-1, 0, 1, 2], pickLabels: ["a", "b", "c", "d"] });
    expect(old?.form).toMatchObject({ blanksOk: true, subtractMeans: true, normalize: "global", minOverlap: "0.25" });
    expect(mathSeed({ mode: "correlate", form: { blanksOk: true, normalize: 3 }, picks: [], pickLabels: [] })).toBeNull();
    expect(formSettings("correlate", emptyForm())).toEqual({ blanksOk: false, subtractMeans: true, normalize: "global", minOverlap: "0.25" });
  });
});

describe("system of equations", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], activeId: null });
    api.solveSystem.mockResolvedValue({
      variables: ["x", "y"], point: [1.4142135624, 1.4142135624], residuals: [1e-13, 0], residual_norm: 1e-13, converged: true,
      message: "The solution converged.", evaluations: 14, method: "hybr",
    });
  });

  it("sends equations, starting values and constants, and shows the solution with its residual norm", async () => {
    render(<MathExtrasPanel />);
    pickMode("system");
    type("Equations", "x^2 + y^2 = 4\ny = k*x");
    type("Starting values", "x = 1\ny = 0.5");
    type("Constants", "k = 1");
    type("System method", "lm");
    click(/Calculate/);
    const card = await screen.findByRole("status");
    expect(api.solveSystem.mock.calls[0]![0]).toEqual({
      equations: ["x^2 + y^2 = 4", "y = k*x"], guess: { x: 1, y: 0.5 }, constants: { k: 1 }, method: "lm",
    });
    expect(card).toHaveTextContent("Solution");
    expect(card).toHaveTextContent("x1.414213562");
    expect(card).toHaveTextContent("Residual norm1e-13");
  });

  it("says so when it did not converge, and refuses an empty system", async () => {
    api.solveSystem.mockResolvedValue({
      variables: ["x"], point: [0], residuals: [1], residual_norm: 1, converged: false,
      message: "not making good progress", evaluations: 16, method: "hybr",
    });
    render(<MathExtrasPanel />);
    pickMode("system");
    click(/Calculate/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least one equation/);
    type("Equations", "x^2 + 1 = 0");
    type("Starting values", "x = 1");
    click(/Calculate/);
    const card = await screen.findByRole("status");
    expect(card).toHaveTextContent("No solution found");
    expect(card).toHaveTextContent(/did not converge.*not making good progress.*not a solution/);
  });

  it("shows the server's non-uniqueness warning on the card, beside the point it found", async () => {
    api.solveSystem.mockResolvedValue({
      variables: ["x", "y"], point: [2, 1], residuals: [0, 0], residual_norm: 0, converged: true, message: "ok", evaluations: 9, method: "hybr",
      warnings: ["the equations are dependent at this point (Jacobian rank 1 of 2): the solution is not unique; other points satisfy them too"],
    });
    render(<MathExtrasPanel />);
    pickMode("system");
    type("Equations", "x + y = 3\n2*x + 2*y = 6");
    type("Starting values", "x = 1\ny = 1");
    click(/Calculate/);
    const card = await screen.findByRole("status");
    expect(card).toHaveTextContent("Solution");
    expect(card).toHaveTextContent("x2");
    expect(card).toHaveTextContent(/Warning: the equations are dependent.*not unique/);
  });

  it("shows the server's refusal when equations and unknowns differ", async () => {
    api.solveSystem.mockRejectedValue(new Error("1 equation(s) but 2 unknown(s) (x, y)"));
    render(<MathExtrasPanel />);
    pickMode("system");
    type("Equations", "x + y = 1");
    type("Starting values", "x = 1\ny = 1");
    click(/Calculate/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/1 equation\(s\) but 2 unknown/);
  });
});

describe("constrained minimisation", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], activeId: null });
    api.optimizeConstrained.mockResolvedValue({
      variables: ["x", "y"], point: [1, 1], value: 2, sense: "min", method: "SLSQP", converged: true, feasible: true,
      max_violation: 0, message: "ok", at_bound: [], starts: 1, starts_agreeing: 1,
      constraints: [
        { text: "x + y <= 2", kind: "le", value: 0, slack: 0, satisfied: true, active: true },
        { text: "x >= 0.5", kind: "ge", value: 0.5, slack: 0.5, satisfied: true, active: false },
      ],
    });
  });

  it("sends the constraints, optional bounds and starting values and names the active constraint", async () => {
    render(<MathExtrasPanel />);
    pickMode("constrained");
    type("Expression", "(x-2)^2 + (y-2)^2");
    type("Constraints", "x + y <= 2\nx >= 0.5");
    type("Starting values", "x = 0\ny = 0");
    type("Solver", "trust-constr");
    click(/Calculate/);
    const card = await screen.findByRole("status");
    expect(api.optimizeConstrained.mock.calls[0]![0]).toEqual({
      expr: "(x-2)^2 + (y-2)^2", constraints: ["x + y <= 2", "x >= 0.5"], bounds: {}, guess: { x: 0, y: 0 },
      constants: {}, sense: "min", method: "trust-constr",
    });
    expect(card).toHaveTextContent("Minimum");
    expect(card).toHaveTextContent("1. x + y <= 2ACTIVE");
    expect(card).toHaveTextContent("2. x >= 0.5slack 0.5");
    expect(card).toHaveTextContent("Active constraints≤ x + y <= 2");
  });

  it("reports an infeasible result as not a solution, and passes bounds through", async () => {
    api.optimizeConstrained.mockResolvedValue({
      variables: ["x"], point: [2], value: 2, sense: "min", method: "SLSQP", converged: false, feasible: false,
      max_violation: 3, message: "Inequality constraints incompatible", at_bound: [], starts: 1, starts_agreeing: 1,
      constraints: [{ text: "x >= 5", kind: "ge", value: -3, slack: -3, satisfied: false, active: true }],
    });
    render(<MathExtrasPanel />);
    pickMode("constrained");
    type("Expression", "x");
    type("Constraints", "x >= 5\nx <= 1");
    type("Bounds (optional)", "x = 0 .. 10");
    type("Starting values", "x = 2");
    click(/Calculate/);
    const card = await screen.findByRole("status");
    expect(api.optimizeConstrained.mock.calls[0]![0].bounds).toEqual({ x: [0, 10] });
    expect(card).toHaveTextContent("No feasible point found");
    expect(card).toHaveTextContent(/violated by 3.*not a solution/);
  });

  it("needs an expression", async () => {
    render(<MathExtrasPanel />);
    pickMode("constrained");
    click(/Calculate/);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter an expression/);
    expect(api.optimizeConstrained).not.toHaveBeenCalled();
  });
});
