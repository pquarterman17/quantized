// Built-in reference-phase presets (calc.phase_database): the picker turns a
// phase into a LatticePreset, and stays usable (disabled, no throw) offline.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPhases, type PhaseInfo } from "../../../lib/api/reference";
import PhasePresetPicker, { phasePreset } from "./PhasePresetPicker";

vi.mock("../../../lib/api/reference", () => ({ getPhases: vi.fn() }));

const GAN: PhaseInfo = {
  name: "GaN (wurtzite)", formula: "GaN", a: 3.189, b: 3.189, c: 5.1864,
  alpha: 90, beta: 90, gamma: 120, centering: "P", system: "hexagonal",
  category: "substrate", icsd: 67782, basis: [],
};
const SI: PhaseInfo = {
  ...GAN, name: "Silicon", formula: "Si", a: 5.4309, b: 5.4309, c: 5.4309,
  gamma: 90, centering: "F", system: "cubic",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("phasePreset", () => {
  it("keeps the phase's centering and derives the system from the cell", () => {
    const p = phasePreset(GAN);
    expect(p.cell).toEqual({ a: 3.189, b: 3.189, c: 5.1864, alpha: 90, beta: 90, gamma: 120 });
    expect(p.system).toBe("hexagonal");
    expect(p.centering).toBe("P");
    expect(phasePreset(SI)).toMatchObject({ system: "cubic", centering: "F", tie: "abc" });
  });
});

describe("PhasePresetPicker", () => {
  it("applies the picked phase", async () => {
    vi.mocked(getPhases).mockResolvedValue({ phases: [SI, GAN] });
    const onApply = vi.fn();
    render(<PhasePresetPicker onApply={onApply} />);
    const select = await screen.findByRole("combobox", { name: "reference phase" });
    await screen.findByRole("option", { name: /GaN \(wurtzite\)/ });
    fireEvent.change(select, { target: { value: "GaN (wurtzite)" } });
    expect(onApply).toHaveBeenCalledWith(phasePreset(GAN), GAN);
  });

  it("is disabled when the table cannot be loaded", async () => {
    vi.mocked(getPhases).mockRejectedValue(new Error("offline"));
    render(<PhasePresetPicker onApply={vi.fn()} />);
    expect(await screen.findByText("Reference phases unavailable")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "reference phase" })).toBeDisabled();
  });
});
