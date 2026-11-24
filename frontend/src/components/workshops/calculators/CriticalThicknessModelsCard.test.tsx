import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { criticalThicknessModel } from "../../../lib/api/growth";
import CriticalThicknessModelsCard from "./CriticalThicknessModelsCard";

vi.mock("../../../lib/api/growth", () => ({ criticalThicknessModel: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(criticalThicknessModel).mockResolvedValue({
    model: "people_bean",
    label: "People-Bean (Appl. Phys. Lett. 47, 322 (1985))",
    h_c: 500,
    h_c_nm: 50,
    mismatch: 0.01,
    b: 2.7,
    nu: 0.3,
    matched: false,
  });
});

describe("CriticalThicknessModelsCard", () => {
  it("sends People-Bean inputs, blank b as null, and labels the result", async () => {
    render(<CriticalThicknessModelsCard aFilm="3.9" aSub={3.86} />);
    expect(screen.getByText(/People & Bean, Appl\. Phys\. Lett\. 47, 322 \(1985\)/)).toBeInTheDocument();
    expect(screen.queryByLabelText("alpha")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Calculate h_c"));
    await screen.findByText(/h_c = .* Å = .* nm/);
    expect(criticalThicknessModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "people_bean", a_film: 3.9, a_sub: 3.86, nu: 0.3, b: null }),
    );
  });

  it("shows slip-system fields for Matthews-Blakeslee and passes them", async () => {
    render(<CriticalThicknessModelsCard aFilm="3.9" aSub={3.86} />);
    fireEvent.change(screen.getByLabelText("critical thickness model"), {
      target: { value: "matthews_blakeslee" },
    });
    expect(screen.getByText(/J\. Cryst\. Growth 27, 118 \(1974\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Burgers vector"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("alpha"), { target: { value: "90" } });
    fireEvent.click(screen.getByText("Calculate h_c"));
    await screen.findByText(/h_c = /);
    expect(criticalThicknessModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "matthews_blakeslee", b: 2.5, alpha_deg: 90, lambda_deg: 60 }),
    );
  });

  it("surfaces a no-root error inline and clears a result when a_film changes", async () => {
    const { rerender } = render(<CriticalThicknessModelsCard aFilm="3.9" aSub={3.86} />);
    fireEvent.click(screen.getByText("Calculate h_c"));
    await screen.findByText(/h_c = /);
    rerender(<CriticalThicknessModelsCard aFilm="4.0" aSub={3.86} />);
    expect(screen.queryByText(/h_c = /)).not.toBeInTheDocument();
    vi.mocked(criticalThicknessModel).mockRejectedValueOnce(new Error("no critical thickness exists"));
    fireEvent.click(screen.getByText("Calculate h_c"));
    expect(await screen.findByText(/no critical thickness exists/)).toBeInTheDocument();
  });
});
