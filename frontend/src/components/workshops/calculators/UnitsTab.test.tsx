// UnitsTab (DiraCulator units-converter expansion): category -> from/to unit
// pickers, the swap button, conversion display, and the photon-energy
// category's 5-quantity panel. Renders through CalculatorsContent (the
// "units" tab is the default) so the category Select from useCalculators'
// fetch effect is exercised end to end, matching the SldTab.test.tsx pattern.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyText } from "../../../lib/clipboard";
import { convertUnits, getConstants, getUnitCategories } from "../../../lib/api/reference";
import CalculatorsContent from "./CalculatorsContent";

vi.mock("../../../lib/clipboard", () => ({ copyText: vi.fn() }));

vi.mock("../../../lib/api", () => ({
  xrayCalc: vi.fn(),
  crystalDSpacing: vi.fn(),
  crystalCell: vi.fn(),
}));
vi.mock("../../../lib/api/sld", () => ({
  sldFromFormula: vi.fn(),
}));

vi.mock("../../../lib/api/reference", () => ({
  getUnitCategories: vi.fn(),
  convertUnits: vi.fn(),
  getConstants: vi.fn(),
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
    id: "length",
    label: "Length",
    hint: null,
    units: [
      { value: "m", label: "m" },
      { value: "Ang", label: "Ang" },
      { value: "nm", label: "nm" },
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
  vi.mocked(copyText).mockResolvedValue(true);
  vi.mocked(convertUnits).mockResolvedValue({ result: 1, info: {} });
  vi.mocked(getConstants).mockResolvedValue({ constants: {}, systems: { SI: [], CGS: [], eV: [] } });
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

  it("swap button exchanges from and to and immediately converts", async () => {
    vi.mocked(convertUnits).mockResolvedValue({ result: 10_000, info: {} });
    await renderUnits();
    fireEvent.click(screen.getByLabelText("swap units"));
    expect(screen.getByLabelText("from unit")).toHaveValue("T");
    expect(screen.getByLabelText("to unit")).toHaveValue("Oe");
    await screen.findByRole("button", { name: "copy converted value" });
    expect(convertUnits).toHaveBeenCalledWith(1, "T", "Oe");
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

  it("a quick-pick pill sets the pair and immediately converts", async () => {
    vi.mocked(convertUnits).mockResolvedValue({ result: 0.1, info: {} });
    await renderUnits();
    fireEvent.click(screen.getByText("Ang → nm"));
    expect(screen.getByLabelText("unit category")).toHaveValue("length");
    expect(screen.getByLabelText("from unit")).toHaveValue("Ang");
    expect(screen.getByLabelText("to unit")).toHaveValue("nm");
    await screen.findByRole("button", { name: "copy converted value" });
    expect(convertUnits).toHaveBeenCalledWith(1, "Ang", "nm");
  });

  it("custom mode accepts arbitrary unit expressions", async () => {
    vi.mocked(convertUnits).mockResolvedValue({ result: 10, info: {} });
    await renderUnits();
    fireEvent.change(screen.getByLabelText("unit category"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("from unit"), { target: { value: "mA/cm^2" } });
    fireEvent.change(screen.getByLabelText("to unit"), { target: { value: "A/m^2" } });
    fireEvent.click(screen.getByText("="));

    await screen.findByRole("button", { name: "copy converted value" });
    expect(convertUnits).toHaveBeenCalledWith(1, "mA/cm^2", "A/m^2");
  });

  it("copies the backend's LaTeX form", async () => {
    vi.mocked(convertUnits).mockResolvedValue({
      result: 0.0001,
      info: { latex: "$1\\,\\text{Oe} = 0.0001\\,\\text{T}$" },
    });
    await renderUnits();
    fireEvent.click(screen.getByText("="));
    fireEvent.click(await screen.findByRole("button", { name: "copy LaTeX" }));

    expect(copyText).toHaveBeenCalledWith("$1\\,\\text{Oe} = 0.0001\\,\\text{T}$");
  });

  it("a photon quick-pick updates the visible source quantity and pressed state", async () => {
    await renderUnits();
    fireEvent.change(screen.getByLabelText("unit category"), {
      target: { value: "photon_energy" },
    });
    fireEvent.change(screen.getByLabelText("photon-energy quantity"), {
      target: { value: "K" },
    });

    expect(screen.getByRole("button", { name: "eV → nm" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "eV → nm" }));

    expect(screen.getByLabelText("photon-energy quantity")).toHaveValue("eV");
    expect(screen.getByRole("button", { name: "eV → nm" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Oe → T" })).toHaveAttribute("aria-pressed", "false");
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
