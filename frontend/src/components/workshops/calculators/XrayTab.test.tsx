// X-ray tab: Bragg/Q-space card (shared useCalculators state, so Crystal's
// "→ X-ray" hand-off keeps working) + the new self-contained neutron
// wavelength↔energy↔velocity↔temperature card.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getConstants } from "../../../lib/api/reference";
import { neutronCalc, xrayCalc } from "../../../lib/api";
import { setFormatOpts } from "../../../lib/format";
import CalculatorsContent from "./CalculatorsContent";

vi.mock("../../../lib/api", () => ({
  xrayCalc: vi.fn(),
  neutronCalc: vi.fn(),
}));
vi.mock("../../../lib/api/reference", () => ({
  getConstants: vi.fn(),
  // Rendered through CalculatorsContent, so useUnitsCalc's effect also fires;
  // this sibling export now shares a file with getConstants (R8 merge) so a
  // partial mock must cover it too, or the call throws instead of the
  // original real-fetch-rejects-and-is-caught behavior.
  getUnitCategories: vi.fn().mockRejectedValue(new Error("offline")),
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

  it("invalid text left in the HIDDEN wavelength/order fields cannot block the energy-only modes (DIRACULATOR_AUDIT P2)", async () => {
    vi.mocked(xrayCalc).mockResolvedValue({ result: 8.048, unit: "keV", description: "E from λ" });
    openXrayTab();

    // Poison both fields while they are visible (Bragg mode)...
    fireEvent.change(screen.getByDisplayValue("1.5406"), { target: { value: "abc" } });
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "xyz" } });

    // ...then switch to each standalone energy mode: the calc must succeed,
    // sending the documented neutral values instead of the poisoned state.
    for (const mode of ["energy_from_wavelength", "wavelength_from_energy"]) {
      vi.mocked(xrayCalc).mockClear();
      fireEvent.change(screen.getByLabelText("x-ray conversion"), { target: { value: mode } });
      fireEvent.click(screen.getByText("="));
      expect(await screen.findByText("8.048")).toBeInTheDocument();
      expect(xrayCalc).toHaveBeenCalledWith(mode, 0, 3.1356, 1);
    }
  });

  it("a low sig-figs display preference cannot degrade the chained → λ wavelength (DIRACULATOR_AUDIT P2)", async () => {
    setFormatOpts(3, "auto"); // aggressive display rounding: 1.540598 would show as 1.54
    try {
      vi.mocked(xrayCalc).mockResolvedValue({ result: 1.540598, unit: "Å", description: "λ from E" });
      openXrayTab();

      fireEvent.click(screen.getByText("→ λ"));
      await vi.waitFor(() => {
        // The wavelength INPUT carries the full backend precision, not the
        // display text — display sig-figs never alter a chained calculation.
        expect(screen.getByDisplayValue("1.540598")).toBeInTheDocument();
      });

      // And the next Bragg calc consumes that full-precision value. (The
      // DISPLAY is rounded to 3 sig-figs — that's fine; the API call is not.)
      vi.mocked(xrayCalc).mockResolvedValue({ result: 28.44, unit: "deg", description: "2θ" });
      fireEvent.click(screen.getByText("="));
      await vi.waitFor(() => {
        expect(xrayCalc).toHaveBeenLastCalledWith("2theta_from_d", 1.540598, 3.1356, 1);
      });
    } finally {
      setFormatOpts(6, "auto"); // restore the default for the rest of the suite
    }
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

  it("→ λ helper: editing the energy while pending disowns the stale completion (review round 2)", async () => {
    let resolveCalc!: (v: { result: number; unit: string; description: string }) => void;
    vi.mocked(xrayCalc).mockImplementation(() => new Promise((res) => (resolveCalc = res)));
    openXrayTab();

    fireEvent.click(screen.getByText("→ λ")); // pending for energy 8.0478...
    fireEvent.change(screen.getByDisplayValue("8.0478"), { target: { value: "9.0" } }); // ...edited
    resolveCalc({ result: 1.540598, unit: "Å", description: "λ from E" });
    await act(() => Promise.resolve());

    // The stale completion belongs to the OLD energy: it must not write the
    // wavelength, surface an error, or leave the helper busy.
    expect(screen.queryByDisplayValue("1.540598")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("1.5406")).toBeInTheDocument(); // untouched default
    expect((screen.getByText("→ λ") as HTMLButtonElement).disabled).toBe(false);
  });

  it("→ λ helper: an older overlapping request never overwrites the newer result (review round 2)", async () => {
    const pending: Array<(v: { result: number; unit: string; description: string }) => void> = [];
    vi.mocked(xrayCalc).mockImplementation(() => new Promise((res) => pending.push(res)));
    openXrayTab();

    fireEvent.click(screen.getByText("→ λ")); // request A (energy 8.0478)
    // Editing re-arms the helper (invalidation drops busy), enabling a second
    // request while A is still in flight.
    fireEvent.change(screen.getByDisplayValue("8.0478"), { target: { value: "9.0" } });
    fireEvent.click(screen.getByText("→ λ")); // request B (energy 9.0)
    expect(pending).toHaveLength(2);

    pending[1]({ result: 1.377, unit: "Å", description: "λ from E" }); // B resolves first
    await act(() => Promise.resolve());
    expect(screen.getByDisplayValue("1.377")).toBeInTheDocument();

    pending[0]({ result: 1.540598, unit: "Å", description: "λ from E" }); // stale A resolves last
    await act(() => Promise.resolve());
    expect(screen.getByDisplayValue("1.377")).toBeInTheDocument(); // B's answer survives
    expect(screen.queryByDisplayValue("1.540598")).not.toBeInTheDocument();
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
