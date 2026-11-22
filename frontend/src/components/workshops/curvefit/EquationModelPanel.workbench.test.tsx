// EquationModelPanel on the workbench shell (lane WB4): the DOM half of
// useEquationFit.workbench.test.ts. An out-of-date fit says so and no longer
// offers Find X/Y (which would read its parameters as if current); a refit
// clears it; refusals and request failures are different alerts.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitEquation, validateEquation } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import EquationModelPanel from "./EquationModelPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ validateEquation: vi.fn(), fitEquation: vi.fn(), findXY: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[10], [20], [30], [40]], labels: ["y"], units: [""], metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, fitOverlay: null,
  });
  vi.mocked(validateEquation).mockResolvedValue({ ok: true, params: ["m", "b"] });
  vi.mocked(fitEquation).mockResolvedValue({ params: [10, 0], yFit: [10, 20, 30, 40], paramNames: ["m", "b"] });
});

async function fitted() {
  render(<EquationModelPanel initial={null} />);
  fireEvent.change(screen.getByPlaceholderText("y = a*exp(-x/t) + c"), { target: { value: "m*x + b" } });
  await screen.findByLabelText("guess m");
  fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
  await screen.findByLabelText("find Y at this X");
}

describe("EquationModelPanel fit freshness", () => {
  it("an edit after a fit marks it Out of date and withholds Find X/Y; Fit again restores both", async () => {
    await fitted();
    expect(screen.queryByText(/Out of date/)).toBeNull();
    fireEvent.change(screen.getByLabelText("guess m"), { target: { value: "5" } });
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument();
    expect(screen.queryByLabelText("find Y at this X")).toBeNull();
    expect(fitEquation).toHaveBeenCalledTimes(1); // an edit never refits
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await screen.findByLabelText("find Y at this X");
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(fitEquation).toHaveBeenCalledTimes(2);
  });

  it("no finite pairs is a refusal alert; a failed request is an error alert", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: { ...DATA, values: [[NaN], [NaN], [NaN], [NaN]] } }] });
    render(<EquationModelPanel initial={null} />);
    fireEvent.change(screen.getByPlaceholderText("y = a*exp(-x/t) + c"), { target: { value: "m*x + b" } });
    await screen.findByLabelText("guess m");
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "refusal"));
    expect(fitEquation).not.toHaveBeenCalled();
    act(() => useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }] }));
    vi.mocked(fitEquation).mockRejectedValueOnce(new Error("did not converge"));
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "error"));
    expect(screen.getByRole("alert")).toHaveTextContent("did not converge");
  });
});
