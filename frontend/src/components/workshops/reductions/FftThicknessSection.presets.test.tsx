// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P5), through the
// real Film thickness (FFT) section inside the Reductions window: save, change,
// Apply restores the settings and the next Compute carries them, Apply
// computes nothing and writes no last used, a successful Compute does.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fftThickness } from "../../../lib/api/reductions";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useApp } from "../../../store/useApp";
import ReductionsPanel from "./ReductionsPanel";

vi.mock("../../../lib/api/reductions", () => ({ fftThickness: vi.fn() }));

const scan: DataStruct = {
  time: [10, 20, 30, 40],
  values: [[1, 5], [2, 6], [3, 7], [4, 8]],
  labels: ["Intensity", "Counts"],
  units: ["cps", "cps"],
  metadata: {},
};
const RESULT = { thickness_nm: 55.5, uncertainty_nm: 1.2, wavelength_a: 1.5406, two_theta_range: [10, 40] as [number, number], fft_magnitude: [0, 1, 2], thickness_axis: [0, 10, 20], n_points: 4 };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.mocked(fftThickness).mockResolvedValue(RESULT);
  useApp.setState({
    datasets: [{ id: "d1", name: "xrd.dat", data: scan }], activeId: "d1", status: "", analysisResults: [], history: [], future: [],
    reductionsOpen: true, reductionsMethod: "fft-thickness",
  });
});

const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Film thickness (FFT) presets" })).getByRole("status").textContent ?? "";
const channel = () => screen.getByText("Intensity channel").nextElementSibling as HTMLSelectElement;
const windowSelect = () => screen.getByText("Window").nextElementSibling as HTMLSelectElement;
const wavelength = () => screen.getByText("Wavelength (Å)").nextElementSibling as HTMLInputElement;
function savePreset(name: string) {
  press("Save as…");
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: name } });
  press("Save");
}
function pick(label: string) {
  const opt = within(select()).getAllByRole("option").find((o) => o.textContent?.startsWith(label));
  if (!opt) throw new Error(`no option ${label}`);
  fireEvent.change(select(), { target: { value: (opt as HTMLOptionElement).value } });
}
async function ready() {
  render(<ReductionsPanel />);
  await screen.findByRole("region", { name: "Film thickness (FFT) presets" });
}

describe("Film thickness (FFT) preset bar", () => {
  it("saves, changes, Applies: the settings return and the next Compute carries them", async () => {
    await ready();
    fireEvent.change(channel(), { target: { value: "1" } });
    fireEvent.change(windowSelect(), { target: { value: "blackman" } });
    fireEvent.change(wavelength(), { target: { value: "1.7889" } });
    savePreset("Co Kα Counts");
    expect(status()).toBe("Saved preset 'Co Kα Counts'");
    fireEvent.change(channel(), { target: { value: "0" } });
    fireEvent.change(windowSelect(), { target: { value: "none" } });
    fireEvent.change(wavelength(), { target: { value: "1.5406" } });
    pick("Co Kα Counts");
    press("Apply");
    expect(status()).toContain("Applied preset 'Co Kα Counts' to Film thickness (FFT): press Compute to run it");
    expect(channel().value).toBe("1"); // by label
    expect(windowSelect().value).toBe("blackman");
    expect(wavelength().value).toBe("1.7889");
    // Apply computed nothing and wrote no last used.
    expect(fftThickness).not.toHaveBeenCalled();
    expect(readLastUsed("fft-thickness")).toBeNull();
    press("Compute");
    await waitFor(() => expect(readLastUsed("fft-thickness")).not.toBeNull());
    expect(vi.mocked(fftThickness).mock.calls[0]?.[0]).toMatchObject({ intensity: [5, 6, 7, 8], wavelength_a: 1.7889, window: "blackman" });
    expect(readLastUsed("fft-thickness")?.settings).toMatchObject({ column: "Counts", windowFn: "blackman", wavelength: 1.7889 });
    cleanup();
    await ready();
    expect(within(select()).getByRole("option", { name: "Co Kα Counts" })).toBeTruthy();
  });

  it("a failed Compute writes no last used", async () => {
    vi.mocked(fftThickness).mockRejectedValueOnce(new Error("too few points"));
    await ready();
    press("Compute");
    expect(await screen.findByText("too few points")).toBeInTheDocument();
    expect(readLastUsed("fft-thickness")).toBeNull();
  });
});
