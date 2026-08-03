// SLD tab's cross-workshop "→ Reflectivity" affordance: in the normal app it
// seeds the reflectivity workshop and opens it; in calc-only mode (?view=calc,
// MAIN_PLAN #22) that workshop isn't mounted, so the guard must no-op with a
// toast instead of silently flipping store state nothing renders.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getConstants, sldFromFormula } from "../../../lib/api";
import { useApp } from "../../../store/useApp";
import { useCalcHistory } from "../../../store/calcHistory";
import { useToasts } from "../../../store/toasts";
import CalculatorsContent from "./CalculatorsContent";

vi.mock("../../../lib/api", () => ({
  getConstants: vi.fn(),
  sldFromFormula: vi.fn(),
}));
// useCalculators also fetches the units-converter category table from a
// sibling module (kept out of the pinned lib/api.ts barrel — see
// lib/api/reference.ts); unmocked here, its real getJSON() call rejects in
// jsdom (no fetch) and the hook's .catch() swallows it, same as offline.

const SLD_RESULT = {
  formula: "Si",
  molar_mass: 28.09,
  number_density: 5e22,
  neutron: { wavelength: 1.798, sld_real: 2.07, sld_imag: 0, qc: 0.01, penetration: 100 },
  xray: { wavelength: 1.5406, sld_real: 20, sld_imag: 0.1, qc: 0.03, penetration: 1 },
};

async function computeSld(): Promise<void> {
  render(<CalculatorsContent />);
  fireEvent.change(screen.getByLabelText("calculator"), { target: { value: "sld" } });
  fireEvent.click(screen.getByText("="));
  await screen.findByText("→ Reflectivity (n)");
}

describe("SldTab → Reflectivity", () => {
  beforeEach(() => {
    vi.mocked(getConstants).mockResolvedValue({ constants: {}, systems: { SI: [], CGS: [], eV: [] } });
    vi.mocked(sldFromFormula).mockResolvedValue(SLD_RESULT);
    useApp.setState({ reflectivityOpen: false, reflectivitySeed: null });
    useToasts.setState({ toasts: [] });
    useCalcHistory.setState({ history: [], favorites: [], seq: 0 });
    window.history.pushState({}, "", "/");
  });
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("records a Sld entry to calc history (calculator audit #1)", async () => {
    await computeSld();
    const history = useCalcHistory.getState().history;
    expect(history).toHaveLength(1);
    expect(history[0].domain).toBe("Sld");
    expect(history[0].label).toBe("SLD from formula");
  });

  it("seeds the reflectivity workshop and opens it in the full app", async () => {
    await computeSld();
    fireEvent.click(screen.getByText("→ Reflectivity (n)"));
    expect(useApp.getState().reflectivityOpen).toBe(true);
    const seed = useApp.getState().reflectivitySeed;
    expect(seed?.label).toBe("Si neutron");
    expect(seed?.sld).toBeCloseTo(2.07e-6, 12);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("no-ops with a toast in calc-only mode instead of opening reflectivity", async () => {
    window.history.pushState({}, "", "/?view=calc");
    await computeSld();
    fireEvent.click(screen.getByText("→ Reflectivity (n)"));
    expect(useApp.getState().reflectivityOpen).toBe(false);
    expect(useApp.getState().reflectivitySeed).toBeNull();
    expect(useToasts.getState().toasts).toHaveLength(1);
    expect(useToasts.getState().toasts[0].msg).toBe("use ↗ in the title bar to open the full app");
  });
});
