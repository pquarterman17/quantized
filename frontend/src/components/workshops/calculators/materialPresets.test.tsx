// The Semiconductor and Superconductor tabs take their material presets from
// the backend tables (/api/semiconductor/materials,
// /api/superconductor/material-presets) — no frontend copy. The mocked tables
// hold entries the old hand-mirrored lists never had, so a hard-coded list
// cannot pass.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/materialPresets", () => ({
  semiconductorMaterials: vi.fn(() =>
    Promise.resolve({
      materials: {
        Si: { name: "Silicon", Eg: 1.12, eps_r: 11.7, me: 1.08, mh: 0.81 },
        AlN: { name: "Aluminium Nitride", Eg: 6.2, eps_r: 8.5, me: 0.4, mh: 3.5 },
        SiO2: { name: "Silicon Dioxide", Eg: 9, eps_r: 3.9, me: 0.5, mh: null },
      },
    }),
  ),
  superconductorMaterials: vi.fn(() =>
    Promise.resolve({
      materials: {
        Nb: { Tc: 9.25, lambda0: 39, xi0: 38, Hc0: 1980, Delta0: 1.55, type: "II" },
        Ta: { Tc: 4.48, lambda0: 35, xi0: 93, Hc0: 830, Delta0: 0.7, type: "I" },
      },
    }),
  ),
}));

import SemiconductorTab from "./SemiconductorTab";
import SuperconductorTab from "./SuperconductorTab";

const optionNames = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

describe("calculator material presets come from the backend", () => {
  it("Semiconductor: lists the backend table, skipping materials missing a field the card fills", async () => {
    render(<SemiconductorTab />);
    const intrinsic = screen.getByLabelText("Intrinsic carrier concentration material preset");
    await waitFor(() => expect(optionNames(intrinsic)).toEqual(["(manual)", "Si", "AlN"]));
    // SiO2 has no hole mass, but the depletion card only fills eps_r.
    const depletion = screen.getByLabelText(/Depletion width.* material preset/);
    expect(optionNames(depletion)).toContain("SiO2");

    fireEvent.change(intrinsic, { target: { value: "AlN" } });
    expect(screen.getAllByLabelText("Eg")[0]).toHaveValue("6.2");
  });

  it("Superconductor: lists the backend table and fills from it", async () => {
    render(<SuperconductorTab />);
    // Re-queried each time: the tab's inline MatSelect remounts on every render.
    const first = () => screen.getAllByLabelText("material")[0]!;
    await waitFor(() => expect(optionNames(first())).toEqual(["Nb", "Ta"]));
    fireEvent.change(first(), { target: { value: "Ta" } });
    expect(screen.getAllByLabelText("λ₀")[0]).toHaveValue("35");
  });
});
