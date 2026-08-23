import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { magneticCurieWeiss, magneticDemag, magneticDomainWall, magneticMomentConvert, magneticCurieWeissFit } from "../../../lib/api/magnetic";
import MagneticTab from "./MagneticTab";


vi.mock("../../../lib/api/magnetic", () => ({
  magneticCurieWeissFit: vi.fn(),
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

  it("fits Curie-Weiss parameters from pasted T, chi data", async () => {
    vi.mocked(magneticCurieWeissFit).mockResolvedValue({
      theta_cw: 50,
      C: 4.0,
      mu_eff: 5.657,
      fit_line: [0.25, -12.5],
      r2: 1.0,
      inv_chi: [3, 4, 5],
    });
    render(<MagneticTab />);

    fireEvent.change(screen.getByLabelText("Curie-Weiss T, chi data"), {
      target: { value: "100, 0.02\n200, 0.0133\n300, 0.01" },
    });
    fireEvent.click(screen.getByText("Fit"));

    expect(await screen.findByText(/θ_CW = .* K/)).toBeInTheDocument();
    expect(magneticCurieWeissFit).toHaveBeenCalledWith({
      temperature: [100, 200, 300],
      susceptibility: [0.02, 0.0133, 0.01],
    });
  });

  it("rejects a Curie-Weiss fit with fewer than 3 pasted rows", async () => {
    render(<MagneticTab />);
    fireEvent.change(screen.getByLabelText("Curie-Weiss T, chi data"), {
      target: { value: "100, 0.02\n200, 0.0133" },
    });
    fireEvent.click(screen.getByText("Fit"));
    expect(await screen.findByText(/at least 3/)).toBeInTheDocument();
    expect(magneticCurieWeissFit).not.toHaveBeenCalled();
  });

  it("editing an input invalidates the displayed result (provenance contract)", async () => {
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
    const line = await screen.findByText(/emu = .* A·m² = .* µ_B/);
    expect(line).toBeInTheDocument();

    // Edit the card's own "m" field — the result no longer matches the inputs.
    fireEvent.change(screen.getAllByLabelText("m")[0], { target: { value: "5e-3" } });
    expect(screen.queryByText(/emu = .* A·m² = .* µ_B/)).not.toBeInTheDocument();
  });
});
