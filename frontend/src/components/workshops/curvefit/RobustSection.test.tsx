// Robust / quantile section (GAP_AUDIT_9 G11): request shape per mode,
// stale marking, refusals before any request.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { quantileFit, robustFit } from "../../../lib/api/fitRobust";
import type { Dataset, FitModel } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import RobustSection from "./RobustSection";

vi.mock("../../../lib/api/fitRobust", () => ({ robustFit: vi.fn(), quantileFit: vi.fn() }));

const DS: Dataset = {
  id: "d1", name: "run.dat",
  data: {
    time: [0, 1, 2, 3], values: [[0, 1], [1, 3], [2, 5], [3, 40]],
    labels: ["x", "y"], units: ["", ""], metadata: {},
  },
};
const MODEL: FitModel = { name: "Linear", category: "poly", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [null, null], ub: [null, null] };
const ROBUST = {
  params: [2, 1], errors: [0.1, 0.2], paramNames: ["m", "b"], yFit: [1, 3, 5, 7], residuals: [0, 0, 0, 33],
  robustWeights: [1, 1, 1, 0.01], outliers: [3], lsParams: [12, -5], fScale: 0.3, fScaleAuto: true, nPoints: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(robustFit).mockResolvedValue(ROBUST);
  vi.mocked(quantileFit).mockResolvedValue({
    coefficients: [1, 2], errors: [0.1, 0.1], yFit: [1, 3, 5, 7], residuals: [0, 0, 0, 33],
    tau: 0.9, degree: 1, checkLoss: 1, pseudoR2: 0.5, nPoints: 4,
  });
  useApp.setState({ datasets: [DS], activeId: "d1", xKey: 0, yKeys: [1], seriesOrder: null, errKeys: {}, fitOverlay: null });
});

const fit = () => fireEvent.click(screen.getByRole("button", { name: "Run robust fit" }));

describe("RobustSection", () => {
  it("posts the loss and a blank scale as automatic, shows robust beside least squares", async () => {
    render(<RobustSection modelName="Linear" model={MODEL} />);
    fit();
    await screen.findByText("downweighted", { exact: false });
    const req = vi.mocked(robustFit).mock.calls[0]![0];
    expect(req).toMatchObject({ method: "nonlinear", model: "Linear", loss: "soft_l1" });
    expect(req).not.toHaveProperty("f_scale");
    expect(screen.getByText("12")).toBeInTheDocument(); // the least-squares column
  });

  it("posts an explicit scale; a bad scale is refused without a request", async () => {
    render(<RobustSection modelName="Linear" model={MODEL} />);
    const scale = screen.getByLabelText("Robust scale");
    fireEvent.change(scale, { target: { value: "-1" } });
    fit();
    expect(await screen.findByText(/positive number/)).toHaveAttribute("data-kind", "refusal");
    expect(robustFit).not.toHaveBeenCalled();
    fireEvent.change(scale, { target: { value: "0.5" } });
    fit();
    await screen.findByText("downweighted", { exact: false });
    expect(vi.mocked(robustFit).mock.calls[0]![0]).toMatchObject({ f_scale: 0.5 });
  });

  it("quantile mode posts tau and degree, refuses tau outside (0, 1), marks stale on a channel change", async () => {
    render(<RobustSection modelName="Linear" model={MODEL} />);
    fireEvent.change(screen.getByRole("combobox", { name: "" }), { target: { value: "quantile" } });
    fireEvent.change(screen.getByLabelText("Quantile tau"), { target: { value: "1.2" } });
    fit();
    expect(await screen.findByText(/strictly between 0 and 1/)).toBeInTheDocument();
    expect(quantileFit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Quantile tau"), { target: { value: "0.9" } });
    fit();
    await screen.findByText(/pseudo-R2/);
    expect(vi.mocked(quantileFit).mock.calls[0]![0]).toMatchObject({ tau: 0.9, degree: 1 });
    act(() => useApp.setState({ xKey: 1 }));
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument();
  });
});
