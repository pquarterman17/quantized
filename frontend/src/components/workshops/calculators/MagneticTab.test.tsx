import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  magneticCurieWeiss,
  magneticDemag,
  magneticDomainWall,
  magneticMomentConvert,
} from "../../../lib/api";
import MagneticTab from "./MagneticTab";

vi.mock("../../../lib/api", () => ({
  magneticMomentConvert: vi.fn(),
  magneticDemag: vi.fn(),
  magneticCurieWeiss: vi.fn(),
  magneticLangevin: vi.fn(),
  magneticDomainWall: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MagneticTab", () => {
  it("converts a moment to emu / SI / Bohr magnetons", async () => {
    vi.mocked(magneticMomentConvert).mockResolvedValue({
      emu: 1e-3,
      am2: 1e-6,
      mu_b: 1.078e17,
      m_cgs: null,
      m_si: null,
      mu_b_per_atom: null,
    });
    render(<MagneticTab />);

    fireEvent.click(screen.getByText("Convert"));
    expect(await screen.findByText(/emu = .* A·m² = .* µ_B/)).toBeInTheDocument();
    // m default 1e-3 emu, V=0 and atoms=0 -> optional args omitted (undefined).
    expect(magneticMomentConvert).toHaveBeenCalledWith(1e-3, "emu", undefined, undefined);
  });

  it("computes demagnetizing factors for the default sphere", async () => {
    vi.mocked(magneticDemag).mockResolvedValue({
      Nz: 0.3333,
      Nxy: 0.3333,
      shape: "Sphere",
      n_cgs: 4.18879,
    });
    render(<MagneticTab />);

    fireEvent.click(screen.getAllByText("Calculate")[0]);
    expect(await screen.findByText(/Nz = .* · Nxy = .* · 4πNz = .*/)).toBeInTheDocument();
    expect(magneticDemag).toHaveBeenCalledWith("Sphere");
  });

  it("shows the magnetic-order type from Curie-Weiss", async () => {
    vi.mocked(magneticCurieWeiss).mockResolvedValue({
      mu_eff: 5.91,
      C: 4.375,
      theta: -50,
      mag_type: "antiferromagnetic",
    });
    render(<MagneticTab />);

    const calcs = screen.getAllByText("Calculate");
    fireEvent.click(calcs[1]);
    expect(await screen.findByText(/antiferromagnetic/)).toBeInTheDocument();
  });

  it("reports domain-wall width and energy", async () => {
    vi.mocked(magneticDomainWall).mockResolvedValue({
      delta_cm: 2.028e-6,
      delta_nm: 20.28,
      e_wall_erg_cm2: 12.39,
      e_wall_mj_m2: 12.39,
    });
    render(<MagneticTab />);

    const calcs = screen.getAllByText("Calculate");
    fireEvent.click(calcs[calcs.length - 1]);
    expect(await screen.findByText(/δ = .* nm · E_wall = .* mJ\/m²/)).toBeInTheDocument();
  });

  it("surfaces API errors", async () => {
    vi.mocked(magneticCurieWeiss).mockRejectedValue(new Error("C must be non-negative"));
    render(<MagneticTab />);

    fireEvent.click(screen.getAllByText("Calculate")[1]);
    expect(await screen.findByText("C must be non-negative")).toBeInTheDocument();
  });
});
