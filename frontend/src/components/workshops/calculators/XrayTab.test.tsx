// X-ray tab: Bragg/Q-space card (shared useCalculators state, so Crystal's
// "→ X-ray" hand-off keeps working) + the new self-contained neutron
// wavelength↔energy↔velocity↔temperature card.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getConstants, neutronCalc, xrayCalc } from "../../../lib/api";
import CalculatorsContent from "./CalculatorsContent";

vi.mock("../../../lib/api", () => ({
  getConstants: vi.fn(),
  xrayCalc: vi.fn(),
  neutronCalc: vi.fn(),
}));

function openXrayTab(): void {
  render(<CalculatorsContent />);
  fireEvent.change(screen.getByLabelText("calculator"), { target: { value: "xray" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConstants).mockResolvedValue({ constants: {}, systems: { SI: [], CGS: [], eV: [] } });
});

describe("XrayTab", () => {
  it("renders the Bragg/Q-space and Neutron converter cards", () => {
    openXrayTab();
    expect(screen.getByText("Bragg / Q-space")).toBeInTheDocument();
    expect(screen.getByText("Neutron: λ ↔ E ↔ v ↔ T")).toBeInTheDocument();
    expect(screen.getByLabelText("x-ray conversion")).toBeInTheDocument();
    expect(screen.getByLabelText("neutron input quantity")).toBeInTheDocument();
  });

  it("computes the default d → 2θ Bragg conversion and shows the unit", async () => {
    vi.mocked(xrayCalc).mockResolvedValue({
      result: 28.44,
      unit: "deg",
      description: "2θ from interplanar spacing d (Bragg)",
    });
    openXrayTab();

    fireEvent.click(screen.getByText("="));

    expect(await screen.findByText("28.44")).toBeInTheDocument();
    expect(screen.getByText("deg")).toBeInTheDocument();
    // defaults: mode "2theta_from_d", λ = Cu Kα, d = Si(111), n = 1.
    expect(xrayCalc).toHaveBeenCalledWith("2theta_from_d", 1.5406, 3.1356, 1);
  });

  it("passes the diffraction order through to the API", async () => {
    vi.mocked(xrayCalc).mockResolvedValue({ result: 58.7, unit: "deg", description: "2nd order" });
    openXrayTab();

    fireEvent.change(screen.getByLabelText("x-ray conversion"), {
      target: { value: "2theta_from_d" },
    });
    const nField = screen.getByDisplayValue("1"); // order field defaults to "1"
    fireEvent.change(nField, { target: { value: "2" } });
    fireEvent.click(screen.getByText("="));

    await screen.findByText("58.7");
    expect(xrayCalc).toHaveBeenCalledWith("2theta_from_d", 1.5406, 3.1356, 2);
  });

  it("hides the wavelength row for the standalone energy↔wavelength modes", async () => {
    vi.mocked(xrayCalc).mockResolvedValue({ result: 1.5406, unit: "Å", description: "wavelength" });
    openXrayTab();

    fireEvent.change(screen.getByLabelText("x-ray conversion"), {
      target: { value: "wavelength_from_energy" },
    });

    // The λ preset pill row (anode presets) should no longer be present.
    expect(screen.queryByText("Cu Kα1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("="));
    await screen.findByText("1.5406");
    // DIRACULATOR_AUDIT P2 (useCalculators.xrayCompute): hidden fields are
    // never validated or forwarded — a mode that doesn't need wavelength
    // sends the documented neutral values (w=0, n=1), not stale shared state.
    expect(xrayCalc).toHaveBeenCalledWith("wavelength_from_energy", 0, 3.1356, 1);
  });

  it("surfaces a Bragg conversion error inline", async () => {
    vi.mocked(xrayCalc).mockRejectedValue(new Error("reflection inaccessible"));
    openXrayTab();

    fireEvent.click(screen.getByText("="));
    expect(await screen.findByText("reflection inaccessible")).toBeInTheDocument();
  });

  it("computes a neutron conversion and shows all four quantities with units", async () => {
    vi.mocked(neutronCalc).mockResolvedValue({
      wavelength_a: 1.8,
      energy_mev: 25.25,
      velocity_m_s: 2197.8,
      temperature_k: 293.0,
    });
    openXrayTab();

    fireEvent.click(screen.getByText("Convert"));

    const line = await screen.findByText(/λ = .* Å · E = .* meV · v = .* m\/s · T = .* K/);
    expect(line).toBeInTheDocument();
    expect(neutronCalc).toHaveBeenCalledWith("wavelength", 1.8);
  });

  it("surfaces a neutron conversion error inline", async () => {
    vi.mocked(neutronCalc).mockRejectedValue(new Error("wavelength must be positive and finite"));
    openXrayTab();

    fireEvent.click(screen.getByText("Convert"));
    expect(await screen.findByText("wavelength must be positive and finite")).toBeInTheDocument();
  });

  it("uses the energy(keV) helper to set the Bragg card's wavelength", async () => {
    vi.mocked(xrayCalc).mockResolvedValue({ result: 1.540598, unit: "Å", description: "λ from E" });
    openXrayTab();

    fireEvent.click(screen.getByText("→ λ"));

    await vi.waitFor(() => {
      expect(xrayCalc).toHaveBeenCalledWith("wavelength_from_energy", 0, 8.0478);
    });
  });

  it("editing an input invalidates the displayed result (provenance contract)", async () => {
    vi.mocked(neutronCalc).mockResolvedValue({
      wavelength_a: 1.8,
      energy_mev: 25.25,
      velocity_m_s: 2197.8,
      temperature_k: 293.0,
    });
    openXrayTab();

    fireEvent.click(screen.getByText("Convert"));
    const line = await screen.findByText(/λ = .* Å · E = .* meV · v = .* m\/s · T = .* K/);
    expect(line).toBeInTheDocument();

    // Edit the neutron card's own value field (default "1.8") — the result
    // no longer matches the inputs.
    fireEvent.change(screen.getByDisplayValue("1.8"), { target: { value: "2.5" } });
    expect(
      screen.queryByText(/λ = .* Å · E = .* meV · v = .* m\/s · T = .* K/),
    ).not.toBeInTheDocument();
  });
});
