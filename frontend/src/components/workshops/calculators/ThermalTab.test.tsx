import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { thermalDebye, thermalDiffusivity, thermalWiedemannFranz } from "../../../lib/api";
import ThermalTab from "./ThermalTab";

vi.mock("../../../lib/api", () => ({
  thermalWiedemannFranz: vi.fn(),
  thermalDebye: vi.fn(),
  thermalDiffusivity: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ThermalTab", () => {
  it("computes Wiedemann-Franz thermal conductivity", async () => {
    vi.mocked(thermalWiedemannFranz).mockResolvedValue({
      kappa: 439.2,
      sigma: 6e5,
      temperature: 300,
      lorenz: 2.44e-8,
    });
    render(<ThermalTab />);

    fireEvent.click(screen.getAllByText("=")[0]);
    expect(await screen.findByText(/κ = .* W\/\(m·K\)/)).toBeInTheDocument();
    // defaults: sigma 6e5 S/cm, T 300 K.
    expect(thermalWiedemannFranz).toHaveBeenCalledWith(6e5, 300);
  });

  it("computes Debye temperature", async () => {
    vi.mocked(thermalDebye).mockResolvedValue({ theta_D: 548, v_s: 5000, n: 5e28 });
    render(<ThermalTab />);

    fireEvent.click(screen.getAllByText("=")[1]);
    expect(await screen.findByText(/Θ_D = .* K/)).toBeInTheDocument();
    expect(thermalDebye).toHaveBeenCalledWith(5000, 5e28);
  });

  it("computes thermal diffusivity in both units", async () => {
    vi.mocked(thermalDiffusivity).mockResolvedValue({
      alpha: 9.2e-5,
      alpha_mm2: 92,
      kappa: 150,
      rho: 2329,
      cp: 700,
    });
    render(<ThermalTab />);

    fireEvent.click(screen.getAllByText("=")[2]);
    expect(await screen.findByText(/α = .* m²\/s = .* mm²\/s/)).toBeInTheDocument();
    expect(thermalDiffusivity).toHaveBeenCalledWith(150, 2329, 700);
  });

  it("surfaces API errors", async () => {
    vi.mocked(thermalWiedemannFranz).mockRejectedValue(new Error("temperature must be positive"));
    render(<ThermalTab />);

    fireEvent.click(screen.getAllByText("=")[0]);
    expect(await screen.findByText("temperature must be positive")).toBeInTheDocument();
  });
});
