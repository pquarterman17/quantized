import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  thinFilmDepositionRate,
  thinFilmKiessig,
  thinFilmProjectedRange,
  thinFilmStoneyStress,
  thinFilmThermalMismatch,
} from "../../../lib/api";
import ThinFilmTab from "./ThinFilmTab";

vi.mock("../../../lib/api", () => ({
  thinFilmDepositionRate: vi.fn(),
  thinFilmSputterRate: vi.fn(),
  thinFilmDiffusionLength: vi.fn(),
  thinFilmDoseFromCurrent: vi.fn(),
  thinFilmDoseToConcentration: vi.fn(),
  thinFilmKiessig: vi.fn(),
  thinFilmMultilayerThermal: vi.fn(),
  thinFilmProjectedRange: vi.fn(),
  thinFilmStoneyStress: vi.fn(),
  thinFilmThermalMismatch: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ThinFilmTab", () => {
  it("computes the deposition rate from the default 1000 Å / 60 s inputs", async () => {
    vi.mocked(thinFilmDepositionRate).mockResolvedValue({ rate: 16.6667, rate_nm_per_min: 100 });
    render(<ThinFilmTab />);

    fireEvent.click(screen.getAllByText("Calculate")[0]);
    expect(await screen.findByText(/rate = .* Å\/s · .* nm\/min/)).toBeInTheDocument();
    expect(thinFilmDepositionRate).toHaveBeenCalledWith(1000, 60);
  });

  it("reports the Stoney stress in MPa and GPa", async () => {
    vi.mocked(thinFilmStoneyStress).mockResolvedValue({
      stress: 7.5231e9,
      stress_MPa: 7523.15,
      stress_GPa: 7.5231,
    });
    render(<ThinFilmTab />);

    fireEvent.click(screen.getAllByText("Calculate")[8]);
    expect(await screen.findByText(/σ = .* MPa · .* GPa/)).toBeInTheDocument();
    expect(thinFilmStoneyStress).toHaveBeenCalledWith(130e9, 0.28, 500e-6, 100e-9, 10);
  });

  it("shows the Kiessig thickness without a refraction correction (Qc NaN)", async () => {
    vi.mocked(thinFilmKiessig).mockResolvedValue({
      thickness: 100.05,
      thickness_nm: 10.005,
      Qc: NaN,
      thickness_raw: 100.05,
    });
    render(<ThinFilmTab />);

    fireEvent.click(screen.getAllByText("Calculate")[5]);
    const out = await screen.findByText(/t = .* Å · .* nm/);
    expect(out).toBeInTheDocument();
    expect(out.textContent).not.toMatch(/Qc/);
    // SLD field is blank by default -> undefined passed through.
    expect(thinFilmKiessig).toHaveBeenCalledWith(0.0628, undefined);
  });

  it("passes ion / target symbols to the projected-range call", async () => {
    vi.mocked(thinFilmProjectedRange).mockResolvedValue({
      Rp: 120.5,
      deltaRp: 35.2,
      warning: "Approximate (±20-30%). Use SRIM for precise work.",
    });
    render(<ThinFilmTab />);

    fireEvent.click(screen.getAllByText("Calculate")[7]);
    expect(await screen.findByText(/Rp = .* nm · ΔRp = .* nm/)).toBeInTheDocument();
    expect(thinFilmProjectedRange).toHaveBeenCalledWith("Ar", "Si", 100);
  });

  it("omits the stress term when no film modulus is supplied", async () => {
    vi.mocked(thinFilmThermalMismatch).mockResolvedValue({
      strain: -0.007,
      stress_MPa: NaN,
      description: "compressive",
    });
    render(<ThinFilmTab />);

    fireEvent.click(screen.getAllByText("Calculate")[9]);
    const out = await screen.findByText(/ε = .* \(compressive\)/);
    expect(out).toBeInTheDocument();
    expect(out.textContent).not.toMatch(/σ/);
    // E field blank by default -> undefined; nu defaults to 0.3.
    expect(thinFilmThermalMismatch).toHaveBeenCalledWith(17e-6, 3e-6, -500, undefined, 0.3);
  });

  it("surfaces API errors", async () => {
    vi.mocked(thinFilmDepositionRate).mockRejectedValue(new Error("thickness and time must be positive"));
    render(<ThinFilmTab />);

    fireEvent.click(screen.getAllByText("Calculate")[0]);
    expect(await screen.findByText("thickness and time must be positive")).toBeInTheDocument();
  });
});
