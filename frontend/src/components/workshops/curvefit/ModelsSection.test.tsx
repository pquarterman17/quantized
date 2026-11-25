// Piecewise / convolution / ODE section (GAP_AUDIT_9 G11): request shape per
// mode, refusals before any request, stale marking.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { convolutionFit, odeFit, piecewiseFit } from "../../../lib/api/fitModels";
import type { Dataset, FitModel } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import ModelsSection from "./ModelsSection";

vi.mock("../../../lib/api/fitModels", () => ({ piecewiseFit: vi.fn(), convolutionFit: vi.fn(), odeFit: vi.fn() }));

const DS: Dataset = {
  id: "d1", name: "run.dat",
  data: {
    time: [0, 1, 2, 3], values: [[0, 1, 0.5], [1, 3, 1], [2, 5, 0.5], [3, 4, 0.1]],
    labels: ["x", "y", "res"], units: ["", "", ""], metadata: {},
  },
};
const MODEL: FitModel = { name: "Linear", category: "poly", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [null, null], ub: [null, null] };
const BITS = { yFit: [1, 3, 5, 4], residuals: [0, 0, 0, 0], rss: 0.1, rSquared: 0.99, nPoints: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(piecewiseFit).mockResolvedValue({
    ...BITS, breakpoints: [{ value: 2, se: 0.1, fixed: false, slopeChange: -3 }],
    slopes: [{ slope: 2, se: 0.1, xStart: 0, xEnd: 2 }, { slope: -1, se: 0.2, xStart: 2, xEnd: 3 }],
    intercept: 1, interceptSe: 0.1, sigma: 0.2, dof: 0,
  });
  vi.mocked(convolutionFit).mockResolvedValue({
    ...BITS, params: [2, 1], errors: [0.1, 0.2], paramNames: ["m", "b"], fitSigma: false, instrumentSigma: 0.5,
    success: true, message: "ok",
  });
  vi.mocked(odeFit).mockResolvedValue({
    ...BITS, model: "first_order", observe: null, paramNames: ["k", "y0"], params: [0.5, 2], errors: [0.01, 0.02],
    held: [], success: true, message: "ok",
  });
  useApp.setState({ datasets: [DS], activeId: "d1", xKey: 0, yKeys: [1], seriesOrder: null, errKeys: {}, fitOverlay: null });
});

const fit = () => fireEvent.click(screen.getByRole("button", { name: "Run model fit" }));
const mode = (v: string) => fireEvent.change(screen.getByLabelText("Model family"), { target: { value: v } });

describe("ModelsSection", () => {
  it("piecewise posts the count and fixed breakpoints, shows slopes and breakpoints, refuses a bad count", async () => {
    render(<ModelsSection modelName="Linear" model={MODEL} />);
    fireEvent.change(screen.getByLabelText("Breakpoint count"), { target: { value: "4" } });
    fit();
    expect(await screen.findByText(/from 1 to 3/)).toHaveAttribute("data-kind", "refusal");
    expect(piecewiseFit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Breakpoint count"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Fixed breakpoints"), { target: { value: "1.5" } });
    fit();
    await screen.findByText("breakpoint 1");
    expect(vi.mocked(piecewiseFit).mock.calls[0]![0]).toMatchObject({ n_breakpoints: 2, fixed_breakpoints: [1.5] });
    expect(screen.getByText(/slope 2/)).toBeInTheDocument();
    expect(useApp.getState().fitOverlay).not.toBeNull();
  });

  it("convolution needs a sigma, posts a Gaussian sigma or a resolution column, never both", async () => {
    render(<ModelsSection modelName="Linear" model={MODEL} />);
    mode("convolution");
    fit();
    expect(await screen.findByText(/enter the instrument width/)).toBeInTheDocument();
    expect(convolutionFit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Instrument sigma"), { target: { value: "0.5" } });
    fit();
    await screen.findByText(/instrument sigma 0.5/);
    const g = vi.mocked(convolutionFit).mock.calls[0]![0];
    expect(g).toMatchObject({ model: "Linear", sigma: 0.5, fit_sigma: false });
    expect(g).not.toHaveProperty("resolution");
    fireEvent.change(screen.getByLabelText("Instrument function"), { target: { value: "2" } });
    fit();
    await screen.findByText(/instrument sigma/);
    await act(async () => {});
    const m = vi.mocked(convolutionFit).mock.calls[1]![0];
    expect(m).toMatchObject({ resolution: [0.5, 1, 0.5, 0.1] });
    expect(m).not.toHaveProperty("sigma");
  });

  it("ode posts the built-in model (and observed species), and marks stale on a channel change", async () => {
    render(<ModelsSection modelName="Linear" model={MODEL} />);
    mode("ode");
    fireEvent.change(screen.getByLabelText("ODE model"), { target: { value: "sequential" } });
    fireEvent.change(screen.getByLabelText("Observed species"), { target: { value: "B" } });
    fit();
    await screen.findByText(/R2/);
    expect(vi.mocked(odeFit).mock.calls[0]![0]).toMatchObject({ model: "sequential", observe: "B" });
    act(() => useApp.setState({ xKey: 1 }));
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument();
  });
});
