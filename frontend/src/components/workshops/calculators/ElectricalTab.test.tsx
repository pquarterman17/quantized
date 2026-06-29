import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  electricalConductivity,
  electricalHall,
  electricalResistivity,
} from "../../../lib/api";
import ElectricalTab from "./ElectricalTab";

vi.mock("../../../lib/api", () => ({
  electricalResistivity: vi.fn(),
  electricalSheetResistance: vi.fn(),
  electricalConductivity: vi.fn(),
  electricalMobility: vi.fn(),
  electricalCurrentDensity: vi.fn(),
  electricalHall: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ElectricalTab", () => {
  it("computes resistivity from sheet resistance and thickness", async () => {
    vi.mocked(electricalResistivity).mockResolvedValue({ rho: 0.01 });
    render(<ElectricalTab />);

    fireEvent.click(screen.getByText("Rs → ρ"));
    expect(await screen.findByText(/ρ = .* Ω·cm/)).toBeInTheDocument();
    // t default 10 nm -> 1e-6 cm; Rs default 100.
    expect(electricalResistivity).toHaveBeenCalledWith(100, 10 * 1e-7);
  });

  it("computes conductivity", async () => {
    vi.mocked(electricalConductivity).mockResolvedValue({ sigma: 1000 });
    render(<ElectricalTab />);

    fireEvent.click(screen.getAllByText("=")[0]);
    expect(await screen.findByText(/σ = .* S\/cm/)).toBeInTheDocument();
  });

  it("shows carrier type from the Hall result", async () => {
    vi.mocked(electricalHall).mockResolvedValue({
      r_h: -1e-5,
      carrier_density: 6.24e23,
      carrier_type: "electron",
    });
    render(<ElectricalTab />);

    const buttons = screen.getAllByText("=");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(/electron-type/)).toBeInTheDocument();
  });

  it("surfaces API errors", async () => {
    vi.mocked(electricalConductivity).mockRejectedValue(new Error("rho must be positive"));
    render(<ElectricalTab />);

    fireEvent.click(screen.getAllByText("=")[0]);
    expect(await screen.findByText("rho must be positive")).toBeInTheDocument();
  });
});
