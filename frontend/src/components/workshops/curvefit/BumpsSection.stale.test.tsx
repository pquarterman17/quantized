// Bumps section display, lane WB5: a result for a model that is no longer the
// panel's is marked "Out of date" and its parameter table is withheld.

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBumps } from "../../../lib/fitbumps";
import { useApp } from "../../../store/useApp";
import BumpsSection from "./BumpsSection";
import { resetBumpsFitSession } from "./useBumpsFit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/fitbumps", () => ({ fitBumps: vi.fn() }));

beforeEach(() => {
  resetBumpsFitSession();
  vi.mocked(fitBumps).mockResolvedValue({ engine: "lm", popt: [1], uncertainties: [0.1], chisq: 1, uncertainty_kind: "hessian", paramNames: ["m"], yFit: [1, 2, 3] });
  useApp.setState({
    datasets: [{ id: "d1", name: "a", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: [""], metadata: {} } }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, fitOverlay: null,
  });
});

describe("BumpsSection out of date", () => {
  it("shows the table for the current model and the marker (no table) after the model changes", async () => {
    const { rerender } = render(<BumpsSection modelName="Linear" />);
    const engine = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    act(() => {
      engine.value = "lm";
      engine.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => screen.getByRole("button", { name: /fit/i }).click());
    expect(await screen.findByText(/Hessian estimate/)).toBeInTheDocument();
    expect(screen.queryByText(/Out of date/)).toBeNull();
    rerender(<BumpsSection modelName="Quadratic" />);
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.queryByText(/Hessian estimate/)).toBeNull();
  });
});
