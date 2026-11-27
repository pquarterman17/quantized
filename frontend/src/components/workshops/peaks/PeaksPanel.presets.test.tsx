// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P3), through
// the real Peaks panel, hook, store and storage: save, change, Apply, the
// settings come back, Apply never runs a find, Revert works, last used is
// written by a successful fit only, and the saved preset is a peak recipe.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak, fitPeak } from "../../../lib/api/peaks";
import { loadRecipesChecked } from "../../../lib/peakwizard";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const DATA: DataStruct = { time: [0, 1, 2, 3, 4, 5], values: [[1], [5], [2], [6], [2], [1]], labels: ["I"], units: ["cps"], metadata: {} };
const found = { peaks: [
  { center: 1, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 },
  { center: 3, height: 6, fwhm: 0.9, prominence: 1, localSNR: 10, area: null, bg: 0 },
], background: [] };
const fitted = { peaks: [
  { center: 1.1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Gaussian" },
  { center: 3.1, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Gaussian" },
], bgCoeffs: [1, 0], R2: 0.99, rmse: 0.02, nPeaks: 2, model: "Gaussian" };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useApp.setState({ datasets: [{ id: "d1", name: "x.dat", data: DATA }], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, peakOverlay: null, peaksOpen: true, history: [], future: [] });
  vi.mocked(findPeaks).mockResolvedValue(found);
  vi.mocked(fitMultiPeak).mockResolvedValue(fitted);
  vi.mocked(fitPeak).mockResolvedValue({ success: false } as never);
});

const bar = () => screen.findByRole("region", { name: "Peaks presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Peaks presets" })).getByRole("status").textContent ?? "";
const finder = () => screen.getByLabelText("Finder") as HTMLSelectElement;
const maxPeaks = () => screen.getByLabelText("Max peaks") as HTMLInputElement;
const shape = () => screen.getByDisplayValue(/^(Lorentzian|Gaussian|Pseudo-Voigt)$/) as HTMLSelectElement;
const findCalls = () => vi.mocked(findPeaks).mock.calls.length;

async function ready() {
  render(<PeaksPanel />);
  await bar();
  await screen.findByLabelText("Finder"); // the Advanced chunk
}
function setForm(finderValue: string, max: string, model: string) {
  fireEvent.change(finder(), { target: { value: finderValue } });
  fireEvent.change(maxPeaks(), { target: { value: max } });
  fireEvent.blur(maxPeaks());
  fireEvent.change(shape(), { target: { value: model } });
}
function pick(label: string) {
  const opt = within(select()).getAllByRole("option").find((o) => o.textContent?.startsWith(label));
  if (!opt) throw new Error(`no option ${label}`);
  fireEvent.change(select(), { target: { value: (opt as HTMLOptionElement).value } });
}
function savePreset(name: string) {
  press("Save as…");
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: name } });
  press("Save");
}

describe("Peaks preset bar", () => {
  it("saves, changes, Applies: the settings come back and no find runs; the preset is a valid peak recipe", async () => {
    await ready();
    await waitFor(() => expect(findCalls()).toBe(1));
    setForm("derivative2", "7", "Gaussian");
    savePreset("Shoulders");
    expect(status()).toBe("Saved preset 'Shoulders'");
    expect(loadRecipesChecked()).toMatchObject({ warnings: [], recipes: [expect.objectContaining({ name: "Shoulders", find: expect.objectContaining({ finder: "derivative2", max_peaks: 7 }), model: expect.objectContaining({ shape: "Gaussian" }) })] });

    setForm("residual", "20", "Lorentzian");
    press("Apply");
    expect(finder().value).toBe("derivative2");
    expect(maxPeaks().value).toBe("7");
    expect(shape().value).toBe("Gaussian");
    expect(status()).toContain("Applied preset 'Shoulders' to Peaks: press Find again, then Fit to run it");
    // Apply loaded the draft: it did not run a find, and the committed request is unchanged.
    expect(findCalls()).toBe(1);
    expect(readLastUsed("peaks")).toBeNull();
    // "Find again" then runs the applied settings.
    press("Find again");
    await waitFor(() => expect(findCalls()).toBe(2));
    expect(vi.mocked(findPeaks).mock.calls.at(-1)![0]).toMatchObject({ finder: "derivative2", max_peaks: 7 });
  });

  it("Revert restores the hand-set values after two Applies", async () => {
    await ready();
    setForm("derivative1", "11", "Gaussian");
    savePreset("P-11");
    setForm("derivative2", "22", "Pseudo-Voigt");
    savePreset("P-22");
    setForm("residual", "33", "Lorentzian");
    pick("P-11");
    press("Apply");
    pick("P-22");
    press("Apply");
    expect(maxPeaks().value).toBe("22");
    press("Revert");
    expect([finder().value, maxPeaks().value, shape().value]).toEqual(["residual", "33", "Lorentzian"]);
    expect(status()).toContain("Reverted");
  });

  it("existing peak recipes show in the bar and apply; an unreadable one is listed but cannot be applied", async () => {
    const wizard = { version: 2, name: "Wizard", range: { lo: null, hi: null }, baseline: { method: "none", lam: 1e5, p: 0.01, radius: 50, order: 2 },
      find: { snr_threshold: 3, min_prominence: 0.03, max_peaks: 9, strict_prominence: true }, model: { shape: "Gaussian", bgDegree: 2, linkMode: "None", constrain: false },
      report: { mode: "fit", regionWidth: 3 }, fit: { engine: "model", shapes: [], background: null, params: {}, shareFwhm: null, shareVary: {} } };
    const newer = { ...wizard, name: "Future", version: 3 };
    localStorage.setItem("qz.peakRecipes", JSON.stringify([wizard, newer]));
    await ready();
    expect(within(select()).getByRole("option", { name: "Wizard" })).toBeTruthy();
    expect(within(select()).getByRole("option", { name: /Future — locked/ })).toBeTruthy();
    pick("Future");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    pick("Wizard");
    press("Apply");
    expect(maxPeaks().value).toBe("9");
    expect(shape().value).toBe("Gaussian");
    expect(findCalls()).toBe(1);
    expect(JSON.parse(localStorage.getItem("qz.peakRecipes")!)).toEqual([wizard, newer]);
  });

  it("last used is written after a successful fit, with the settings it ran on, and not by Apply", async () => {
    await ready();
    await waitFor(() => expect(findCalls()).toBe(1));
    await screen.findByRole("table", { name: "detected peaks" });
    fireEvent.change(shape(), { target: { value: "Gaussian" } });
    press("Fit all together");
    await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(readLastUsed("peaks")).not.toBeNull());
    expect(readLastUsed("peaks")?.settings).toMatchObject({ shape: "Gaussian", finder: "residual" });
    // Offered, not applied, on a remount.
    cleanup();
    render(<PeaksPanel />);
    await bar();
    expect(shape().value).toBe("Lorentzian");
    expect(within(select()).getByRole("option", { name: /^Last used/ })).toBeTruthy();
  });

  it("a failed fit does not write last used", async () => {
    vi.mocked(fitMultiPeak).mockRejectedValue(new Error("boom"));
    await ready();
    await screen.findByRole("table", { name: "detected peaks" });
    press("Fit all together");
    await screen.findByText(/boom/);
    expect(readLastUsed("peaks")).toBeNull();
  });
});
