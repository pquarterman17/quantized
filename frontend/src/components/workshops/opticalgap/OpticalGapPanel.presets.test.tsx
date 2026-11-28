// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9), through the real
// Optical gap panel, hook and storage: save, change, Apply restores the settings
// and the next fit request carries them; Revert; Apply fits nothing and writes no
// last used, a successful fit does; a column this sheet lacks is named and
// skipped; the unit and signal a preset carries survive the column guess; a
// refused value in a knob the signal hides never blocks Save.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaucResult } from "../../../lib/api/analysisExtras";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useApp } from "../../../store/useApp";
import OpticalGapPanel from "./OpticalGapPanel";

const { taucMock } = vi.hoisted(() => ({ taucMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ taucFit: taucMock }));
vi.mock("../SmallUPlot", () => ({ default: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const SPECTRUM: DataStruct = {
  time: [2, 2.5, 3, 3.5],
  values: [[1e3, 90], [1e4, 80], [5e4, 50], [9e4, 5]],
  labels: ["alpha", "T"],
  units: ["1/cm", "%"],
  metadata: { x_column_name: "Energy", x_column_unit: "eV" },
};
const OTHER: DataStruct = { ...SPECTRUM, labels: ["alpha", "B"], units: ["1/cm", ""] };
const RESULT: TaucResult = {
  kind: "indirect", label: "Indirect allowed", gamma: 0.5, eg: 2.35, eg_se: 0.01, eg_se_fit: 0.01, eg_window_sd: null, eg_lcl: 2.32, eg_ucl: 2.38, level: 0.95,
  slope: 100, intercept: -235, r2: 0.999, n_fit: 5, e_min: 2.6, e_max: 3.2, auto_window: false,
  energy: [2, 2.6, 3, 3.2], tauc: [0, 25, 65, 85], alpha: [0, 1, 2, 3], fit_energy: [2.35, 3.2], fit_tauc: [0, 85],
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  taucMock.mockResolvedValue(RESULT);
  useApp.setState({
    datasets: [{ id: "a", name: "spectrum", data: SPECTRUM }, { id: "b", name: "other", data: OTHER }],
    activeId: "a", status: "", analysisResults: [], history: [], future: [],
  });
});

const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Optical gap presets" })).getByRole("status").textContent ?? "";
const combo = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
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
  render(<OpticalGapPanel />);
  await screen.findByRole("region", { name: "Optical gap presets" });
  await waitFor(() => expect(combo("X quantity")).toHaveValue("eV"));
}

describe("Optical gap preset bar", () => {
  it("saves, changes, Applies: the settings return and the next fit carries them; Revert; last used is a fit's", async () => {
    await ready();
    fireEvent.change(combo("Transition type"), { target: { value: "indirect" } });
    fireEvent.change(field("Fit range minimum (eV)"), { target: { value: "2.6" } });
    fireEvent.change(field("Fit range maximum (eV)"), { target: { value: "3.2" } });
    savePreset("Indirect window");
    expect(status()).toBe("Saved preset 'Indirect window'");
    fireEvent.change(combo("Transition type"), { target: { value: "direct" } });
    fireEvent.change(field("Fit range minimum (eV)"), { target: { value: "" } });
    fireEvent.change(field("Fit range maximum (eV)"), { target: { value: "" } });
    pick("Indirect window");
    press("Apply");
    expect(status()).toContain("Applied preset 'Indirect window' to Optical gap: press Fit gap to run it");
    expect(combo("Transition type").value).toBe("indirect");
    expect(field("Fit range minimum (eV)").value).toBe("2.6");
    expect(field("Fit range maximum (eV)").value).toBe("3.2");
    expect(taucMock).not.toHaveBeenCalled();
    expect(readLastUsed("optical-gap")).toBeNull();
    press("Revert");
    expect(combo("Transition type").value).toBe("direct");
    expect(field("Fit range minimum (eV)").value).toBe("");
    pick("Indirect window");
    press("Apply");
    press("Fit gap");
    await waitFor(() => expect(readLastUsed("optical-gap")).not.toBeNull());
    expect(taucMock.mock.calls[0]?.[0]).toMatchObject({ kind: "indirect", e_min: 2.6, e_max: 3.2, x_unit: "eV", signal: "alpha" });
    expect(readLastUsed("optical-gap")?.settings).toMatchObject({ xColumn: "Energy", yColumn: "alpha", kind: "indirect", eMin: "2.6", eMax: "3.2" });
    cleanup();
    await ready();
    expect(within(select()).getByRole("option", { name: "Indirect window" })).toBeTruthy();
  });

  it("a failed fit writes no last used", async () => {
    taucMock.mockRejectedValueOnce(new Error("no straight section"));
    await ready();
    press("Fit gap");
    expect(await screen.findByText("no straight section")).toBeInTheDocument();
    expect(readLastUsed("optical-gap")).toBeNull();
  });

  it("the signal a preset carries survives the column guess that follows a changed pick", async () => {
    await ready();
    fireEvent.change(combo("Y column"), { target: { value: "1" } }); // "T" with % units: guessed as transmittance
    await waitFor(() => expect(combo("Y quantity")).toHaveValue("transmittance"));
    fireEvent.change(combo("Y quantity"), { target: { value: "absorbance" } });
    savePreset("T as absorbance");
    fireEvent.change(combo("Y column"), { target: { value: "0" } });
    await waitFor(() => expect(combo("Y quantity")).toHaveValue("alpha"));
    pick("T as absorbance");
    press("Apply");
    await settle();
    expect(combo("Y column").value).toBe("1");
    expect(combo("Y quantity").value).toBe("absorbance"); // not re-guessed as transmittance
  });

  it("a column this sheet lacks is named and skipped, and the current pick stays", async () => {
    await ready();
    fireEvent.change(combo("Y column"), { target: { value: "1" } });
    await waitFor(() => expect(combo("Y quantity")).toHaveValue("transmittance"));
    savePreset("Needs T");
    act(() => useApp.setState({ activeId: "b" }));
    await waitFor(() => expect(combo("Y column")).toHaveValue("0"));
    pick("Needs T");
    press("Apply");
    expect(status()).toContain("spectrum Y column skipped (column 'T' is not on this sheet)");
    expect(combo("Y column").value).toBe("0");
  });

  it("a refused value in a knob the signal hides does not block Save, and is not stored", async () => {
    await ready();
    fireEvent.change(combo("Y quantity"), { target: { value: "absorbance" } });
    fireEvent.change(field("Film thickness (nm)"), { target: { value: "-5" } }); // shown for absorbance: refused
    fireEvent.change(combo("Y quantity"), { target: { value: "alpha" } }); // now hidden
    savePreset("Alpha only");
    expect(status()).toBe("Saved preset 'Alpha only'");
    const stored = JSON.parse(localStorage.getItem("qz.presets") ?? "{}").presets[0].settings;
    expect(stored).toMatchObject({ signal: "alpha", thickness: "", percent: false });
  });
});
