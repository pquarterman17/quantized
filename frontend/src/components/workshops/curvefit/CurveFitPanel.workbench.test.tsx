// Curve Fit on the workbench shell (lane WB3): a fit whose data or settings
// changed since it ran is marked out of date AND can no longer be reported,
// bootstrapped or written to a worksheet as if it were current. Before this
// lane only the data/weighting change was noted; Report, Corner plot and the
// output sections stayed live on the old numbers. Errors and refusals render
// as the shared WorkbenchMessage.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { retainFitted } from "../../../store/curveFitSession";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4], values: [[1], [3], [5], [7], [9]], labels: ["y"], units: [""], metadata: {},
};
const NO_PAIRS: DataStruct = { ...DATA, values: [[NaN], [NaN], [NaN], [NaN], [NaN]] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  retainFitted(null, null);
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
  });
  vi.mocked(fitModel).mockResolvedValue({
    params: [2, 1], errors: [0.1, 0.2], R2: 0.98, RMSE: 0.5, chiSqRed: 0.3, nPoints: 5, nFree: 2,
    yFit: [1, 3, 5, 7, 9], residuals: [0, 0, 0, 0, 0],
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1",
    xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, fitOverlay: null, analysisResults: [],
    curveFitOpen: true, toolWindowLayout: {},
  });
});

async function fitOnce(): Promise<void> {
  render(<CurveFitPanel />);
  await screen.findByRole("option", { name: "Linear" });
  fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
  await screen.findByText("0.98000");
}
const report = () => screen.getByRole("button", { name: "→ Report" });

describe("CurveFitPanel — an out-of-date fit cannot be committed", () => {
  it("a current fit offers Report, Corner plot and the output section", async () => {
    await fitOnce();
    expect(report()).toBeEnabled();
    expect(screen.getByRole("button", { name: /Corner plot/ })).toBeEnabled();
    expect(await screen.findByText("Output to worksheet")).toBeInTheDocument();
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("an edited value (data) disables Report and Corner plot with the reason and withdraws the output section", async () => {
    await fitOnce();
    await screen.findByText("Output to worksheet");
    const before = useApp.getState().datasets[0]!;
    act(() => useApp.setState({ datasets: [{ ...before, data: { ...before.data, values: [[1], [3], [50], [7], [9]] } }] }));
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(report()).toBeDisabled();
    expect(report()).toHaveAttribute("title", expect.stringMatching(/Out of date/));
    expect(screen.getByRole("button", { name: /Corner plot/ })).toBeDisabled();
    expect(screen.queryByText("Output to worksheet")).toBeNull();
  });

  it("an edited start value (a setting) does the same, and undoing the edit brings it back", async () => {
    await fitOnce();
    fireEvent.click(screen.getByRole("tab", { name: /Setup/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start values & bounds/ }));
    const start = () => screen.getByLabelText("Start value of m") as HTMLInputElement;
    const original = start().value;
    fireEvent.change(start(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("tab", { name: /Results/ }));
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(report()).toBeDisabled();
    expect(screen.queryByText("Output to worksheet")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Setup/ }));
    fireEvent.change(start(), { target: { value: original } });
    fireEvent.click(screen.getByRole("tab", { name: /Results/ }));
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(report()).toBeEnabled();
  });
});

describe("CurveFitPanel — errors and refusals use WorkbenchMessage", () => {
  it("a backend failure is an error alert", async () => {
    vi.mocked(fitModel).mockRejectedValue(new Error("did not converge"));
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("did not converge");
    expect(alert).toHaveAttribute("data-kind", "error");
  });

  it("a refusal (nothing finite to fit) is a refusal alert", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: NO_PAIRS }] });
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no finite X\/Y pairs/);
    expect(alert).toHaveAttribute("data-kind", "refusal");
    expect(fitModel).not.toHaveBeenCalled();
  });
});
