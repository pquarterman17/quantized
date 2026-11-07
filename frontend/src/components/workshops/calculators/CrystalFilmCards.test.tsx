// Crystal tab additions from the THIN_FILM_STACK_PLANNING_PLAN G3 ports:
// the Plane Spacing Table (reads the tab's shared lattice, so it must follow
// the tab's single touch path) and the self-contained film cards
// (tetragonal distortion, Poisson strain, atomic density).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getConstants, getPhases } from "../../../lib/api/reference";
import { resetPhaseCacheForTests } from "../structures/PhasePresetPicker";
import {
  crystalAtomicDensity,
  crystalPlaneSpacings,
  crystalPoissonStrain,
  crystalTetragonalDistortion,
} from "../../../lib/api/crystallography";
import CalculatorsContent from "./CalculatorsContent";
import { AtomicDensityCard, PoissonStrainCard, TetragonalDistortionCard } from "./FilmStrainCards";

vi.mock("../../../lib/api", () => ({
  crystalDSpacing: vi.fn(),
  crystalCell: vi.fn(),
}));
vi.mock("../../../lib/api/reference", () => ({
  getConstants: vi.fn(),
  getUnitCategories: vi.fn().mockRejectedValue(new Error("offline")),
  getPhases: vi.fn().mockRejectedValue(new Error("offline")),
}));
vi.mock("../../../lib/api/crystallography", () => ({
  crystalBondAngle: vi.fn(),
  crystalInterplanarAngle: vi.fn(),
  crystalPlaneSpacings: vi.fn(),
  crystalAtomicDensity: vi.fn(),
  crystalTetragonalDistortion: vi.fn(),
  crystalPoissonStrain: vi.fn(),
}));

type PlaneSpacingsResult = Awaited<ReturnType<typeof crystalPlaneSpacings>>;

const SI_TABLE: PlaneSpacingsResult = {
  hkl: [
    [1, 1, 1],
    [2, 0, 0],
  ],
  d: [3.13553, 2.71545],
  two_theta: [28.443, null],
  multiplicity: [8, 6],
  centering: "F",
  system: "cubic",
  n_reflections: 2,
};

function openCrystalTab(): void {
  render(<CalculatorsContent />);
  fireEvent.change(screen.getByLabelText("calculator"), { target: { value: "crystal" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConstants).mockResolvedValue({ constants: {}, systems: { SI: [], CGS: [], eV: [] } });
  resetPhaseCacheForTests();
});

describe("Plane spacing table", () => {
  it("generates the table from the shared lattice and marks an unreachable 2θ", async () => {
    vi.mocked(crystalPlaneSpacings).mockResolvedValue(SI_TABLE);
    openCrystalTab();
    fireEvent.change(screen.getByLabelText("Bravais centering"), { target: { value: "F" } });
    fireEvent.click(screen.getByText("Generate"));

    expect(await screen.findByText("2 reflections [cubic, F centering]")).toBeInTheDocument();
    expect(crystalPlaneSpacings).toHaveBeenCalledWith({
      a: 5.4309,
      b: 5.4309,
      c: 5.4309,
      alpha: 90,
      beta: 90,
      gamma: 90,
      centering: "F",
      max_hkl: 5,
      wavelength: 1.5406,
    });
    const table = screen.getByRole("table", { name: "plane spacing table" });
    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain("–"); // null 2θ
  });

  it("clears the table when the shared lattice changes", async () => {
    vi.mocked(crystalPlaneSpacings).mockResolvedValue(SI_TABLE);
    openCrystalTab();
    fireEvent.click(screen.getByText("Generate"));
    expect(await screen.findByRole("table", { name: "plane spacing table" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("crystal system"), { target: { value: "tetragonal" } });
    expect(screen.queryByRole("table", { name: "plane spacing table" })).not.toBeInTheDocument();
    expect(screen.queryByText(/reflections \[/)).not.toBeInTheDocument();
  });

  it("drops a table that completes after the lattice changed", async () => {
    let resolve!: (value: PlaneSpacingsResult) => void;
    const pending = new Promise<PlaneSpacingsResult>((res) => {
      resolve = res;
    });
    vi.mocked(crystalPlaneSpacings).mockReturnValue(pending);
    openCrystalTab();
    fireEvent.click(screen.getByText("Generate"));
    fireEvent.change(screen.getByLabelText("crystal system"), { target: { value: "tetragonal" } });
    await act(async () => {
      resolve(SI_TABLE);
      await pending;
    });

    expect(screen.queryByRole("table", { name: "plane spacing table" })).not.toBeInTheDocument();
    expect(screen.queryByText(/reflections \[/)).not.toBeInTheDocument();
  });
});

describe("Reference-phase preset on the Crystal tab", () => {
  const SILICON = {
    name: "Silicon", formula: "Si", a: 5.4309, b: 5.4309, c: 5.4309, alpha: 90, beta: 90, gamma: 90,
    centering: "F" as const, system: "cubic", category: "substrate", icsd: 51688, basis: [],
  };

  it("sets the plane table's centering with the cell, and a hand edit clears the shown phase", async () => {
    vi.mocked(getPhases).mockResolvedValue({ phases: [SILICON] });
    vi.mocked(crystalPlaneSpacings).mockResolvedValue(SI_TABLE);
    openCrystalTab();
    await screen.findByRole("option", { name: /Silicon/ });
    const picker = screen.getByLabelText("reference phase");
    fireEvent.change(picker, { target: { value: "Silicon" } });
    expect(picker).toHaveValue("Silicon");
    expect(screen.getByLabelText("Bravais centering")).toHaveValue("F");

    fireEvent.click(screen.getByText("Generate"));
    await screen.findByText(/reflections \[/);
    expect(crystalPlaneSpacings).toHaveBeenCalledWith(expect.objectContaining({ a: 5.4309, centering: "F" }));

    // The cubic cell shows only "a"; typing over it is a hand edit.
    fireEvent.change(screen.getByDisplayValue("5.4309"), { target: { value: "5.5" } });
    expect(picker).toHaveValue("");
  });
});

describe("Film strain cards", () => {
  it("tetragonal distortion sends the MATLAB defaults and omits a blank c relaxed", async () => {
    vi.mocked(crystalTetragonalDistortion).mockResolvedValue({
      c_over_a: 1.00384,
      distortion_pct: 0.384123,
      a_relaxed: 3.905,
      c_measured: 3.92,
      c_relaxed: 3.905,
    });
    render(<TetragonalDistortionCard />);
    fireEvent.click(screen.getByText("Calculate"));
    expect(await screen.findByText(/c\/a = 1\.00384 · distortion = 0\.384123 %/)).toBeInTheDocument();
    expect(crystalTetragonalDistortion).toHaveBeenLastCalledWith({
      a_relaxed: 3.905,
      c_measured: 3.92,
      c_relaxed: 3.905,
    });

    fireEvent.change(screen.getByLabelText("c relaxed"), { target: { value: "" } });
    expect(screen.queryByText(/c\/a =/)).not.toBeInTheDocument(); // edit invalidates
    fireEvent.click(screen.getByText("Calculate"));
    expect(await screen.findByText(/c\/a =/)).toBeInTheDocument();
    expect(crystalTetragonalDistortion).toHaveBeenLastCalledWith({ a_relaxed: 3.905, c_measured: 3.92 });
  });

  it("Poisson strain reports ε⊥ for the default 1 % / ν = 0.3", async () => {
    vi.mocked(crystalPoissonStrain).mockResolvedValue({ eps_perp: -0.00857143, eps_parallel: 0.01, nu: 0.3 });
    render(<PoissonStrainCard />);
    fireEvent.click(screen.getByText("Calculate"));
    expect(await screen.findByText(/ε⊥ = -0\.00857143/)).toBeInTheDocument();
    expect(crystalPoissonStrain).toHaveBeenCalledWith({ eps_parallel: 0.01, nu: 0.3 });
  });

  it("surfaces the singular-ν error inline", async () => {
    vi.mocked(crystalPoissonStrain).mockRejectedValue(
      new Error("Poisson ratio nu = 1 makes the biaxial coupling singular"),
    );
    render(<PoissonStrainCard />);
    fireEvent.change(screen.getByLabelText("Poisson ratio"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Calculate"));
    expect(await screen.findByText(/biaxial coupling singular/)).toBeInTheDocument();
  });

  it("atomic density sends its own a, b, c and Z", async () => {
    vi.mocked(crystalAtomicDensity).mockResolvedValue({ density: 1.67923e22, z: 1, volume: 59.5501 });
    render(<AtomicDensityCard />);
    fireEvent.change(screen.getByLabelText("atoms per cell"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("Calculate"));
    expect(await screen.findByText(/n = .* atoms\/cm³ · V = .* Å³/)).toBeInTheDocument();
    expect(crystalAtomicDensity).toHaveBeenCalledWith({ a: 3.905, b: 3.905, c: 3.905, z: 5 });
  });
});
