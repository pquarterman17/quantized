// UnitsTab (DiraCulator units-converter expansion): category -> from/to unit
// pickers, the swap button, conversion display, and the photon-energy
// category's 5-quantity panel. Renders through CalculatorsContent (the
// "units" tab is the default) so the category Select from useCalculators'
// fetch effect is exercised end to end, matching the SldTab.test.tsx pattern.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertUnits, getConstants } from "../../../lib/api";
import { getUnitCategories } from "../../../lib/api/reference";
import CalculatorsContent from "./CalculatorsContent";

vi.mock("../../../lib/api", () => ({
  convertUnits: vi.fn(),
  getConstants: vi.fn(),
  xrayCalc: vi.fn(),
  crystalDSpacing: vi.fn(),
  crystalCell: vi.fn(),
  sldFromFormula: vi.fn(),
}));

vi.mock("../../../lib/api/reference", () => ({
  getUnitCategories: vi.fn(),
}));

const CATEGORIES = [
  {
    id: "magnetic_field",
    label: "Magnetic Field (B / H)",
    hint: "1 T = 1e4 G; 1 Oe = 1000/(4*pi) A/m.",
    units: [
      { value: "T", label: "T" },
      { value: "mT", label: "mT" },
      { value: "G", label: "G" },
      { value: "Oe", label: "Oe" },
      { value: "A/m", label: "A/m" },
    ],
  },
  {
    id: "energy",
    label: "Energy",
    hint: null,
    units: [
      { value: "J", label: "J" },
      { value: "eV", label: "eV" },
    ],
  },
  {
    id: "photon_energy",
    label: "Photon / Thermal Energy",
    hint: "Reciprocal/derived equivalences -- value must be positive.",
    units: [
      { value: "eV", label: "eV" },
      { value: "nm", label: "nm (wavelength)" },
      { value: "cm^-1", label: "cm-1 (wavenumber)" },
      { value: "THz", label: "THz" },
      { value: "K", label: "K (E / kB)" },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConstants).mockResolvedValue({ constants: {} });
  vi.mocked(getUnitCategories).mockResolvedValue({ categories: CATEGORIES });
});

async function renderUnits(): Promise<void> {
  render(<CalculatorsContent />);
  await screen.findByLabelText("unit category");
}

describe("UnitsTab", () => {
  it("defaults to the Magnetic Field category with Oe/T selected", async () => {
    await renderUnits();
    expect(screen.getByLabelText("unit category")).toHaveValue("magnetic_field");
    expect(screen.getByLabelText("from unit")).toHaveValue("Oe");
    expect(screen.getByLabelText("to unit")).toHaveValue("T");
  });

  it("switching category resets from/to to that category's first two units", async () => {
    await renderUnits();
    fireEvent.change(screen.getByLabelText("unit category"), { target: { value: "energy" } });
    expect(screen.getByLabelText("from unit")).toHaveValue("J");
    expect(screen.getByLabelText("to unit")).toHaveValue("eV");
  });

  it("shows the category hint", async () => {
    await renderUnits();
    expect(screen.getByText(/1 T = 1e4 G/)).toBeInTheDocument();
  });

  it("swap button exchanges from and to", async () => {
    await renderUnits();
    fireEvent.click(screen.getByLabelText("swap units"));
    expect(screen.getByLabelText("from unit")).toHaveValue("T");
    expect(screen.getByLabelText("to unit")).toHaveValue("Oe");
  });

  it("converts and displays the result with the target unit", async () => {
    vi.mocked(convertUnits).mockResolvedValue({
      result: 0.0001,
      info: { description: "1 Oe = 0.0001 T" },
    });
    await renderUnits();
    fireEvent.click(screen.getByText("="));
    await screen.findByText("1 Oe = 0.0001 T");
    expect(convertUnits).toHaveBeenCalledWith(1, "Oe", "T");
  });

  it("a quick-pick pill sets both the category and the from/to pair", async () => {
    await renderUnits();
    fireEvent.click(screen.getByText("J → eV"));
    expect(screen.getByLabelText("unit category")).toHaveValue("energy");
    expect(screen.getByLabelText("from unit")).toHaveValue("J");
    expect(screen.getByLabelText("to unit")).toHaveValue("eV");
  });

  it("switching to Photon / Thermal Energy shows the 5-quantity panel instead of from/to", async () => {
    await renderUnits();
    fireEvent.change(screen.getByLabelText("unit category"), {
      target: { value: "photon_energy" },
    });
    expect(screen.queryByLabelText("from unit")).not.toBeInTheDocument();
    expect(screen.getByLabelText("photon-energy quantity")).toBeInTheDocument();
  });

  it("photon-energy panel computes all four other quantities at once", async () => {
    vi.mocked(convertUnits).mockImplementation((value, _from, to) => {
      const table: Record<string, number> = {
        nm: 1239.842, "cm^-1": 8065.54, THz: 241.799, K: 11604.5,
      };
      return Promise.resolve({ result: table[to] ?? Number(value), info: {} });
    });
    await renderUnits();
    fireEvent.change(screen.getByLabelText("unit category"), {
      target: { value: "photon_energy" },
    });
    fireEvent.click(screen.getByText("="));
    await waitFor(() => expect(convertUnits).toHaveBeenCalledTimes(4));
    expect(screen.getByText("1239.84")).toBeInTheDocument();
  });
});
