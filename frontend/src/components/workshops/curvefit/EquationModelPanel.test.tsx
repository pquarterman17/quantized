// EquationModelPanel — the DOM half of audit P2.7: the before-run summary,
// the hold column, and the Fit button refusing a table that cannot run. The
// request/refusal logic itself is pinned in useEquationFit.hold.test.ts and
// lib/equationRows.test.ts; this proves the panel actually shows it.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitEquation, validateEquation } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import EquationModelPanel from "./EquationModelPanel";

vi.mock("../../../lib/api", () => ({
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", () => ({
  validateEquation: vi.fn(),
  fitEquation: vi.fn(),
  findXY: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    fitOverlay: null,
  });
  vi.mocked(validateEquation).mockResolvedValue({
    ok: true,
    params: ["A", "t"],
    variable: "x",
    usesX: true,
    functions: ["exp"],
    constants: ["pi"],
  });
});

function typeEquation(text: string) {
  render(<EquationModelPanel initial={null} onSavedChange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("y = a*exp(-x/t) + c"), { target: { value: text } });
}

describe("EquationModelPanel — before-run summary + hold (P2.7)", () => {
  it("summarises x, free/held parameters, constants and functions", async () => {
    typeEquation("A*exp(-x/t) + pi");
    const summary = await screen.findByLabelText("equation summary");
    expect(summary).toHaveTextContent("x (independent)");
    expect(summary).toHaveTextContent("freeA, t");
    expect(summary).toHaveTextContent("constantspi");
    expect(summary).toHaveTextContent("functionsexp");

    fireEvent.click(screen.getByLabelText("Hold t fixed"));
    expect(summary).toHaveTextContent("freeA");
    expect(summary).toHaveTextContent("heldt");
  });

  it("warns when the equation never uses x", async () => {
    vi.mocked(validateEquation).mockResolvedValue({
      ok: true,
      params: ["a"],
      variable: "x",
      usesX: false,
      functions: [],
      constants: [],
    });
    typeEquation("a");
    expect(await screen.findByText(/x is not used/)).toBeInTheDocument();
  });

  it("disables Fit and says why when every parameter is held", async () => {
    typeEquation("A*exp(-x/t)");
    fireEvent.click(await screen.findByLabelText("Hold A fixed"));
    fireEvent.click(screen.getByLabelText("Hold t fixed"));
    expect(screen.getByRole("alert")).toHaveTextContent("every parameter is held");
    const fit = screen.getByRole("button", { name: "Fit" });
    expect(fit).toBeDisabled();
    fireEvent.click(fit);
    expect(fitEquation).not.toHaveBeenCalled();
  });

  it("disables Fit when a min is above its max", async () => {
    typeEquation("A*exp(-x/t)");
    fireEvent.change(await screen.findByLabelText("min A"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("max A"), { target: { value: "1" } });
    expect(screen.getByRole("alert")).toHaveTextContent('"A": min is above max');
    expect(screen.getByRole("button", { name: "Fit" })).toBeDisabled();
  });
});
