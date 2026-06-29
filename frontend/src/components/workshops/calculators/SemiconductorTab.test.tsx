import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  semiconductorCarrierConc,
  semiconductorDiffusionCoeff,
  semiconductorDiffusionLength,
  semiconductorHallCoefficient,
  semiconductorIntrinsic,
  semiconductorThermalVelocity,
} from "../../../lib/api";
import SemiconductorTab from "./SemiconductorTab";

vi.mock("../../../lib/api", () => ({
  semiconductorIntrinsic: vi.fn(),
  semiconductorCarrierConc: vi.fn(),
  semiconductorDepletionWidth: vi.fn(),
  semiconductorDiffusionCoeff: vi.fn(),
  semiconductorDiffusionLength: vi.fn(),
  semiconductorFermiLevel: vi.fn(),
  semiconductorDebyeLength: vi.fn(),
  semiconductorBuiltInPotential: vi.fn(),
  semiconductorSheetCarrierDensity: vi.fn(),
  semiconductorThermalVelocity: vi.fn(),
  semiconductorHallCoefficient: vi.fn(),
  semiconductorMobilityModel: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// Buttons all read "=", ordered by card: 0 intrinsic, 1 carrier conc,
// 2 depletion, 3 transport, 4 fermi, 5 debye, 6 builtin, 7 sheet, 8 thermal,
// 9 hall, 10 mobility.
const button = (i: number) => screen.getAllByText("=")[i];

describe("SemiconductorTab", () => {
  it("computes intrinsic carrier concentration with defaults", async () => {
    vi.mocked(semiconductorIntrinsic).mockResolvedValue({
      ni: 8.88e9,
      Nc: 2.82e19,
      Nv: 1.83e19,
      Eg: 1.12,
      T: 300,
    });
    render(<SemiconductorTab />);

    fireEvent.click(button(0));
    expect(await screen.findByText(/nᵢ = .* cm⁻³/)).toBeInTheDocument();
    // Defaults: Eg 1.12, me 1.08, mh 0.81, T 300.
    expect(semiconductorIntrinsic).toHaveBeenCalledWith(1.12, 1.08, 0.81, 300);
  });

  it("shows the doping type from the carrier-concentration result", async () => {
    vi.mocked(semiconductorCarrierConc).mockResolvedValue({
      n: 1e16,
      p: 2.25e4,
      type: "n",
    });
    render(<SemiconductorTab />);

    fireEvent.click(button(1));
    expect(await screen.findByText(/n-type/)).toBeInTheDocument();
    expect(semiconductorCarrierConc).toHaveBeenCalledWith(1e16, 0, 1.5e10);
  });

  it("chains diffusion coefficient into diffusion length", async () => {
    vi.mocked(semiconductorDiffusionCoeff).mockResolvedValue({ D: 36.19, mu: 1400, T: 300 });
    vi.mocked(semiconductorDiffusionLength).mockResolvedValue({
      L: 0.005,
      Lum: 50,
      D: 36.19,
      tau: 1e-6,
    });
    render(<SemiconductorTab />);

    fireEvent.click(button(3));
    expect(await screen.findByText(/D = .* cm²\/s · L = .* µm/)).toBeInTheDocument();
    expect(semiconductorDiffusionLength).toHaveBeenCalledWith(36.19, 1e-6);
  });

  it("reports the apparent Hall carrier type", async () => {
    vi.mocked(semiconductorHallCoefficient).mockResolvedValue({
      RH: -624.15,
      apparent_type: "n",
    });
    render(<SemiconductorTab />);

    fireEvent.click(button(9));
    expect(await screen.findByText(/R_H = .* cm³\/C · n-type/)).toBeInTheDocument();
  });

  it("surfaces API errors", async () => {
    vi.mocked(semiconductorThermalVelocity).mockRejectedValue(new Error("m_star must be positive"));
    render(<SemiconductorTab />);

    fireEvent.click(button(8));
    expect(await screen.findByText("m_star must be positive")).toBeInTheDocument();
  });
});
