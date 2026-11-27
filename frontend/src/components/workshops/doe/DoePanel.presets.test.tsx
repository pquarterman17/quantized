// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P5), through the
// real DOE panel, hook, store and storage: save, change, Apply restores the
// setup and the next Generate request carries it, Apply generates nothing and
// writes no last used, a successful Generate does, and a refused value in a
// knob the design hides does not block Save.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { doeFractions, doeGenerate } from "../../../lib/api/doe";
import { designData } from "../../../lib/doeTestData";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useDoeStore } from "../../../store/doe";
import { useApp } from "../../../store/useApp";
import DoePanel from "./DoePanel";

vi.mock("../../../lib/api/doe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/doe")>()),
  doeGenerate: vi.fn(),
  doeFractions: vi.fn(),
  doeEffects: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(doeFractions).mockImplementation(async (k) => ({ k, fractions: [], center_points: { ccd: 6, ccd_fractional: 7, box_behnken: 3 } }));
  vi.mocked(doeGenerate).mockResolvedValue({ dataset: designData() });
  useApp.setState({ datasets: [], activeId: null, selection: null, analysisResults: [], history: [], future: [], status: "" });
  useDoeStore.setState({ open: true });
});

const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const design = () => screen.getByLabelText("Design") as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Design of experiments presets" })).getByRole("status").textContent ?? "";
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
  render(<DoePanel />);
  await screen.findByRole("region", { name: "Design of experiments presets" });
}

describe("DOE preset bar", () => {
  it("saves, changes, Applies: the setup returns and the next Generate carries it", async () => {
    await ready();
    fireEvent.change(design(), { target: { value: "ccd" } });
    fireEvent.change(screen.getByLabelText("Number of factors"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Factor 1 name"), { target: { value: "Temp" } });
    fireEvent.change(screen.getByLabelText("Factor 1 low"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Factor 1 high"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Response name"), { target: { value: "Yield" } });
    savePreset("CCD Temp");
    expect(status()).toBe("Saved preset 'CCD Temp'");
    fireEvent.change(design(), { target: { value: "full_factorial" } });
    fireEvent.change(screen.getByLabelText("Factor 1 name"), { target: { value: "Zed" } });
    pick("CCD Temp");
    press("Apply");
    expect(status()).toContain("Applied preset 'CCD Temp' to Design of experiments: press Generate worksheet to run it");
    expect(design().value).toBe("ccd");
    expect((screen.getByLabelText("Factor 1 name") as HTMLInputElement).value).toBe("Temp");
    expect((screen.getByLabelText("Factor 1 high") as HTMLInputElement).value).toBe("200");
    expect((screen.getByLabelText("Response name") as HTMLInputElement).value).toBe("Yield");
    // Apply generated nothing and wrote no last used.
    expect(doeGenerate).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(0);
    expect(readLastUsed("doe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    expect(vi.mocked(doeGenerate).mock.calls[0]![0]).toMatchObject({ design: "ccd", response_name: "Yield", factors: [{ name: "Temp", low: 100, high: 200 }, { name: "B" }] });
    await waitFor(() => expect(readLastUsed("doe")).not.toBeNull());
    expect(readLastUsed("doe")?.settings).toMatchObject({ design: "ccd", responseName: "Yield", k: 2 });
    cleanup();
    await ready();
    expect(within(select()).getByRole("option", { name: "CCD Temp" })).toBeTruthy();
  });

  it("a refused value in a knob the design hides does not block Save", async () => {
    await ready();
    fireEvent.change(design(), { target: { value: "d_optimal" } });
    fireEvent.change(screen.getByLabelText("Number of runs"), { target: { value: "0" } }); // D-optimal shows it: refused
    fireEvent.change(design(), { target: { value: "full_factorial" } }); // now hidden
    savePreset("Screen");
    expect(status()).toBe("Saved preset 'Screen'");
    const stored = JSON.parse(localStorage.getItem("qz.presets") ?? "{}").presets[0].settings;
    expect(stored).toMatchObject({ design: "full_factorial", nRuns: "12" });
  });
});
