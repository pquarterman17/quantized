import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  vacuumKnudsen,
  vacuumMeanFreePath,
  vacuumSputterYield,
} from "../../../lib/api";
import VacuumTab from "./VacuumTab";

vi.mock("../../../lib/api", () => ({
  vacuumMeanFreePath: vi.fn(),
  vacuumMonolayerTime: vi.fn(),
  vacuumSputterYield: vi.fn(),
  vacuumPumpDownTime: vi.fn(),
  vacuumKnudsen: vi.fn(),
  vacuumGasFlow: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VacuumTab", () => {
  it("computes mean free path with the default N2 diameter", async () => {
    vi.mocked(vacuumMeanFreePath).mockResolvedValue({
      mfp: 70.36,
      mfpMm: 70360,
      mfpUm: 7.036e7,
      P: 1e-4,
      T: 300,
      d: 3.64e-10,
    });
    render(<VacuumTab />);

    fireEvent.click(screen.getAllByText("Calculate")[0]);
    expect(await screen.findByText(/λ = .* m/)).toBeInTheDocument();
    // Defaults: P=1e-4, T=300, gas N2 d=3.64e-10.
    expect(vacuumMeanFreePath).toHaveBeenCalledWith(1e-4, 300, 3.64e-10);
  });

  it("shows the flow regime from the Knudsen result", async () => {
    vi.mocked(vacuumKnudsen).mockResolvedValue({
      Kn: 0.5,
      regime: "transition",
      mfp: 1e-4,
      L: 0.025,
    });
    render(<VacuumTab />);

    const buttons = screen.getAllByText("Calculate");
    fireEvent.click(buttons[4]); // Knudsen card is the 5th.
    expect(await screen.findByText(/transition flow/)).toBeInTheDocument();
  });

  it("reports N/A when the sputter yield is NaN (out of table)", async () => {
    vi.mocked(vacuumSputterYield).mockResolvedValue({
      Y: NaN,
      material: "Si",
      ion: "Ar",
      energy: 50,
    });
    render(<VacuumTab />);

    fireEvent.click(screen.getAllByText("Calculate")[2]); // Sputter card is the 3rd.
    expect(await screen.findByText(/N\/A/)).toBeInTheDocument();
  });

  it("surfaces API errors", async () => {
    vi.mocked(vacuumMeanFreePath).mockRejectedValue(new Error("P, T and d must be positive"));
    render(<VacuumTab />);

    fireEvent.click(screen.getAllByText("Calculate")[0]);
    expect(await screen.findByText("P, T and d must be positive")).toBeInTheDocument();
  });
});
