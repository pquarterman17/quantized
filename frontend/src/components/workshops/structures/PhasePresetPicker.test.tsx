// Built-in reference-phase presets (calc.phase_database): the picker turns a
// phase into a LatticePreset, and stays usable (disabled, no throw) offline.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPhases, type PhaseInfo } from "../../../lib/api/reference";
import PhasePresetPicker, { phasePreset, resetPhaseCacheForTests } from "./PhasePresetPicker";

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
  resetPhaseCacheForTests();
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
    render(<PhasePresetPicker selected="" onApply={onApply} />);
    const select = await screen.findByRole("combobox", { name: "reference phase" });
    await screen.findByRole("option", { name: /GaN \(wurtzite\)/ });
    fireEvent.change(select, { target: { value: "GaN (wurtzite)" } });
    expect(onApply).toHaveBeenCalledWith(phasePreset(GAN), GAN);
  });

  it("is disabled when the table cannot be loaded", async () => {
    vi.mocked(getPhases).mockRejectedValue(new Error("offline"));
    render(<PhasePresetPicker selected="" onApply={vi.fn()} />);
    expect(await screen.findByText("Reference phases unavailable")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "reference phase" })).toBeDisabled();
  });

  it("shows the caller's selection and the placeholder once it is cleared", async () => {
    vi.mocked(getPhases).mockResolvedValue({ phases: [SI, GAN] });
    const { rerender } = render(<PhasePresetPicker selected="Silicon" onApply={vi.fn()} />);
    const select = await screen.findByRole("combobox", { name: "reference phase" });
    await screen.findByRole("option", { name: /Silicon/ });
    expect(select).toHaveValue("Silicon");
    rerender(<PhasePresetPicker selected="" onApply={vi.fn()} />);
    expect(select).toHaveValue("");
  });

  it("fetches the table once per session, but retries after a failure", async () => {
    vi.mocked(getPhases).mockRejectedValueOnce(new Error("offline"));
    const first = render(<PhasePresetPicker selected="" onApply={vi.fn()} />);
    await screen.findByText("Reference phases unavailable");
    first.unmount();
    vi.mocked(getPhases).mockResolvedValue({ phases: [SI] });
    const second = render(<PhasePresetPicker selected="" onApply={vi.fn()} />);
    await screen.findByRole("option", { name: /Silicon/ });
    second.unmount();
    render(<PhasePresetPicker selected="" onApply={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Silicon/ })).toBeInTheDocument(); // from cache, no wait
    expect(getPhases).toHaveBeenCalledTimes(2);
  });
});
