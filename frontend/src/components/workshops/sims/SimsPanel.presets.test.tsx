// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P5), through the
// real SIMS panel (Process tab), hook, store and storage: save, change, Apply
// restores the stages and the next preview request carries them, species are
// matched by label, Apply creates nothing and writes no last used, a
// successful Create does, and a refused value in a hidden knob does not block Save.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsProcessRequest, SimsProcessResult } from "../../../lib/api/sims";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import SimsPanel from "./SimsPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn() }));
const { processSims } = await import("../../../lib/api/sims");

const fakeBackend = (body: SimsProcessRequest): Promise<SimsProcessResult> =>
  Promise.resolve({ dataset: { ...body.dataset, metadata: { ...body.dataset.metadata, sims_processing: [{ stage: "smoothing" }] } }, warnings: [], stages: [{ stage: "smoothing" }] });

const raw: DataStruct = {
  time: [0, 10, 20, 30],
  values: [[1e3, 1e5], [1e4, 1e5], [1e2, 2e5], [50, 2e5]],
  labels: ["B", "Si"],
  units: ["c/s", "c/s"],
  metadata: { x_column_name: "Time", x_column_unit: "s" },
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.mocked(processSims).mockImplementation(fakeBackend);
  useApp.setState({
    datasets: [{ id: "s1", name: "barrier.csv", data: raw }], folders: [], activeId: "s1", selectedIds: ["s1"],
    history: [], future: [], macroRecording: true, macroSteps: [], status: "", analysisResults: [],
  });
  useSimsDialog.setState({ seed: "s1", requestedTab: "process" });
});

const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "SIMS depth profile presets" })).getByRole("status").textContent ?? "";
const smooth = () => screen.getByRole("checkbox", { name: "Smooth" });
const halfWidth = () => screen.getByRole("textbox", { name: "Half-width (points)" }) as HTMLInputElement;
const method = () => screen.getByRole("combobox", { name: "Smoothing method" }) as HTMLSelectElement;
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
  render(<SimsPanel />);
  await screen.findByRole("region", { name: "SIMS depth profile presets" });
}

describe("SIMS preset bar", () => {
  it("saves, changes, Applies: the stages return and the next preview carries them; Create writes last used", async () => {
    await ready();
    fireEvent.click(smooth());
    fireEvent.change(method(), { target: { value: "gaussian" } });
    fireEvent.change(halfWidth(), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Normalize to a reference species" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Reference species" }), { target: { value: "B" } });
    savePreset("Soft B");
    expect(status()).toBe("Saved preset 'Soft B'");
    fireEvent.click(smooth()); // off
    fireEvent.click(screen.getByRole("checkbox", { name: "Normalize to a reference species" })); // off
    expect(smooth()).not.toBeChecked();
    pick("Soft B");
    press("Apply");
    expect(status()).toContain("Applied preset 'Soft B' to SIMS depth profile: press Create processed dataset to run it");
    expect(smooth()).toBeChecked();
    expect(method().value).toBe("gaussian");
    expect(halfWidth().value).toBe("3");
    expect((screen.getByRole("combobox", { name: "Reference species" }) as HTMLSelectElement).value).toBe("B"); // by label
    await waitFor(() => expect(vi.mocked(processSims).mock.calls.at(-1)?.[0].smoothing).toMatchObject({ method: "gaussian", window: 3 }));
    // Apply created nothing and wrote no last used.
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(readLastUsed("sims")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Create/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^Create/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    await waitFor(() => expect(readLastUsed("sims")).not.toBeNull());
    expect(readLastUsed("sims")?.settings).toMatchObject({ smoothOn: true, smoothMethod: "gaussian", window: "3", normOn: true, reference: "B" });
  });

  it("a refused value in a knob its stage hides does not block Save", async () => {
    await ready();
    fireEvent.click(smooth());
    fireEvent.change(halfWidth(), { target: { value: "0" } }); // shown while Smooth is on: refused
    fireEvent.click(smooth()); // now hidden
    fireEvent.click(screen.getByRole("checkbox", { name: "Calibrate / rescale x to depth" })); // some stage on
    savePreset("Quiet");
    expect(status()).toBe("Saved preset 'Quiet'");
    const stored = JSON.parse(localStorage.getItem("qz.presets") ?? "{}").presets[0].settings;
    expect(stored).toMatchObject({ smoothOn: false, window: "2", calOn: true });
  });
});
