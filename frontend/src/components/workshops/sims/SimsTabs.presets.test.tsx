// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9) for the SIMS
// workshop's Compare, Align and Region tabs, through the real panel, hooks and
// storage: save, change, Apply restores the settings and the next request
// carries them; Revert; Apply creates nothing and writes no last used, a real
// run does; a species the profiles lack is named and skipped; a refused value in
// a knob the tab hides does not block Save; the picked profiles and the depth
// region are data and are never stored.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsCompareRequest, SimsCompareResult, SimsRegionRequest, SimsRegionResult } from "../../../lib/api/sims";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import SimsPanel from "./SimsPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));
vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn(), compareSims: vi.fn(), measureSimsRegion: vi.fn() }));
vi.mock("../../../lib/api/report", () => ({ reportEmit: vi.fn() }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));
const { compareSims, measureSimsRegion } = await import("../../../lib/api/sims");
const { saveBlob } = await import("../../../lib/download");

function fakeCompare(body: SimsCompareRequest): Promise<SimsCompareResult> {
  const time = body.profiles.flatMap((p) => p.dataset.time);
  return Promise.resolve({
    dataset: { time, values: time.map(() => body.species.map(() => 1)), labels: body.species, units: body.species.map(() => "c/s"), metadata: { technique: "sims", x_column_unit: "nm" } },
    warnings: [], traces: body.species.map((label) => ({ label })),
  });
}
function fakeRegion(body: SimsRegionRequest): Promise<SimsRegionResult> {
  const species = (body.columns ?? []).map((c) => ({
    name: body.dataset.labels[c], unit: "c/s", points: 3, blank: 0, integral: 1, integral_unit: "c/s", integral_kind: "raw" as const,
    integrated_from: 0, integrated_to: 20, peak: 9, peak_depth: 0, mean: 3, threshold: 1, crossings: [], junction_depth: 10 + (body.dataset.time[0] ?? 0), junction_direction: "falling" as const,
  }));
  return Promise.resolve({ region: [body.lo, body.hi], x_name: "Depth", x_unit: "nm", rows_in_region: 3, method: { threshold_mode: body.threshold_mode, threshold: body.threshold }, species, warnings: [], csv: "# csv\n" } as unknown as SimsRegionResult);
}

const prof = (labels: string[], peak = 0): DataStruct => ({
  time: [0, 10, 20], values: [0, 1, 2].map((i) => labels.map((_, c) => (i === peak && c === 0 ? 9 : 1))), labels, units: labels.map(() => "c/s"),
  metadata: { x_column_name: "Depth", x_column_unit: "nm", technique: "sims" },
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.mocked(compareSims).mockImplementation(fakeCompare);
  vi.mocked(measureSimsRegion).mockImplementation(fakeRegion);
  useApp.setState({
    datasets: [{ id: "s1", name: "a.csv", data: prof(["B", "Si"]) }, { id: "s2", name: "b.csv", data: prof(["B", "Si"], 2) }, { id: "s3", name: "c.csv", data: prof(["Ge", "Si"]) }],
    folders: [], activeId: "s1", selectedIds: ["s1", "s2"], macroRecording: true, macroSteps: [], history: [], future: [], analysisResults: [], staleDatasets: [],
    seriesStyles: {}, yKeys: null, xKey: null, seriesOrder: null, waterfall: 0, groupKey: null, reports: [],
  });
  useSimsDialog.setState({ seed: "s1", opened: 1 });
});

const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const combo = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
const box = (name: string) => screen.getByRole("checkbox", { name });
const num = (label: string, v: string) => { const f = screen.getByLabelText(label); fireEvent.change(f, { target: { value: v } }); fireEvent.blur(f); };
const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const statusOf = (tool: string) => within(screen.getByRole("region", { name: `${tool} presets` })).getByRole("status").textContent ?? "";
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
async function openTab(tab: string, tool: string) {
  render(<SimsPanel />);
  fireEvent.click(screen.getByRole("radio", { name: tab }));
  await screen.findAllByRole("region", { name: `${tool} presets` });
}

describe("SIMS Compare tab preset bar", () => {
  const TOOL = "SIMS compare";

  it("saves, changes, Applies: species and stagger return and the next Create carries them; a real Create writes last used", async () => {
    await openTab("Compare", TOOL);
    fireEvent.click(box("Si")); // off: only B is compared
    num("Stagger (decades per trace)", "2");
    savePreset("B staggered");
    expect(statusOf(TOOL)).toBe("Saved preset 'B staggered'");
    fireEvent.click(box("Si")); // back on
    num("Stagger (decades per trace)", "0");
    pick("B staggered");
    press("Apply");
    expect(statusOf(TOOL)).toContain("Applied preset 'B staggered' to SIMS compare: press Create comparison to run it");
    expect(statusOf(TOOL)).toContain("pick the profiles to compare: a preset does not store them");
    expect(box("Si")).not.toBeChecked();
    expect(box("B")).toBeChecked();
    expect(val("Stagger (decades per trace)")).toBe("2");
    expect(readLastUsed("sims-compare")).toBeNull();
    expect(useApp.getState().datasets).toHaveLength(3); // Apply created nothing
    press("Revert");
    expect(box("Si")).toBeChecked();
    expect(val("Stagger (decades per trace)")).toBe("0");
    pick("B staggered");
    press("Apply");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create comparison" })).not.toBeDisabled());
    expect(vi.mocked(compareSims).mock.calls.at(-1)?.[0].species).toEqual(["B"]);
    press("Create comparison");
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    await waitFor(() => expect(readLastUsed("sims-compare")).not.toBeNull());
    expect(readLastUsed("sims-compare")?.settings).toEqual({ species: ["B"], stagger: "2" });
  });

  it("a species none of the picked profiles has is named and skipped; the picked profiles are not stored", async () => {
    await openTab("Compare", TOOL);
    fireEvent.click(box("Si")); // keeps B; Si off
    fireEvent.click(box("Si"));
    savePreset("Both");
    fireEvent.click(screen.getByRole("checkbox", { name: "a.csv" })); // pick only c.csv (Ge, Si)
    fireEvent.click(screen.getByRole("checkbox", { name: "b.csv" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "c.csv" }));
    await waitFor(() => expect(box("Ge")).toBeChecked());
    pick("Both");
    press("Apply");
    expect(statusOf(TOOL)).toContain("species skipped (species 'B' is in none of the picked profiles)");
    expect(box("Si")).toBeChecked();
    const stored = JSON.parse(localStorage.getItem("qz.presets") ?? "{}").presets[0].settings;
    expect(Object.keys(stored).sort()).toEqual(["species", "stagger"]);
  });
});

describe("SIMS Align tab preset bar", () => {
  const TOOL = "SIMS align";

  it("saves, changes, Applies: the alignment settings return; a real Create writes last used", async () => {
    await openTab("Align", TOOL);
    fireEvent.change(combo("Align on"), { target: { value: "junction" } });
    fireEvent.change(combo("Reference species"), { target: { value: "Si" } });
    num("Junction threshold (percent of peak)", "30");
    fireEvent.click(box("B")); // also include B
    savePreset("Si junction");
    fireEvent.change(combo("Align on"), { target: { value: "peak" } });
    fireEvent.change(combo("Reference species"), { target: { value: "B" } });
    pick("Si junction");
    press("Apply");
    expect(statusOf(TOOL)).toContain("Applied preset 'Si junction' to SIMS align: press Create aligned worksheet to run it");
    expect(combo("Align on").value).toBe("junction");
    expect(combo("Reference species").value).toBe("Si");
    expect(val("Junction threshold (percent of peak)")).toBe("30");
    expect(box("B")).toBeChecked();
    expect(readLastUsed("sims-align")).toBeNull();
    press("Revert");
    expect(combo("Align on").value).toBe("peak");
    pick("Si junction");
    press("Apply");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create aligned worksheet" })).not.toBeDisabled());
    expect(useApp.getState().datasets).toHaveLength(3);
    press("Create aligned worksheet");
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    await waitFor(() => expect(readLastUsed("sims-align")).not.toBeNull());
    expect(readLastUsed("sims-align")?.settings).toEqual({ by: "junction", reference: "Si", thresholdPct: "30", extra: ["B"] });
  });

  it("a refused junction threshold the tab hides (aligning on the peak) does not block Save", async () => {
    await openTab("Align", TOOL);
    fireEvent.change(combo("Align on"), { target: { value: "junction" } });
    num("Junction threshold (percent of peak)", "150"); // shown for junction: refused
    fireEvent.change(combo("Align on"), { target: { value: "peak" } }); // now hidden
    savePreset("Peak");
    expect(statusOf(TOOL)).toBe("Saved preset 'Peak'");
    const stored = JSON.parse(localStorage.getItem("qz.presets") ?? "{}").presets[0].settings;
    expect(stored).toMatchObject({ by: "peak", thresholdPct: "50" });
  });

  it("a reference species the picked profiles do not share is named and skipped, and the current reference stays", async () => {
    await openTab("Align", TOOL);
    fireEvent.change(combo("Reference species"), { target: { value: "B" } });
    savePreset("B ref");
    fireEvent.click(screen.getByRole("checkbox", { name: "b.csv" })); // off
    fireEvent.click(screen.getByRole("checkbox", { name: "c.csv" })); // a.csv (B, Si) with c.csv (Ge, Si): only Si is shared
    await waitFor(() => expect(combo("Reference species").value).toBe("Si"));
    pick("B ref");
    press("Apply");
    expect(statusOf(TOOL)).toContain("reference species skipped (column 'B' is not on this sheet)");
    expect(combo("Reference species").value).toBe("Si");
  });
});

describe("SIMS Region tab preset bar", () => {
  const TOOL = "SIMS region";

  it("saves, changes, Applies: species and threshold return, the region is NOT stored; an export writes last used", async () => {
    await openTab("Region", TOOL);
    fireEvent.click(box("Si")); // measure B only
    fireEvent.change(combo("Threshold mode"), { target: { value: "absolute" } });
    num("Threshold", "4");
    savePreset("B absolute");
    fireEvent.click(box("Si"));
    fireEvent.change(combo("Threshold mode"), { target: { value: "fraction" } });
    num("Region from", "5"); // the region is the user's, set by hand
    pick("B absolute");
    press("Apply");
    expect(statusOf(TOOL)).toContain("Applied preset 'B absolute' to SIMS region: the result updates on its own; press Add to Reports to keep it");
    expect(statusOf(TOOL)).toContain("enter the depth region: a preset does not store it");
    expect(box("Si")).not.toBeChecked();
    expect(combo("Threshold mode").value).toBe("absolute");
    expect(val("Threshold")).toBe("4");
    expect(val("Region from")).toBe("5"); // untouched
    expect(readLastUsed("sims-region")).toBeNull();
    press("Revert");
    expect(box("Si")).toBeChecked();
    expect(combo("Threshold mode").value).toBe("fraction");
    pick("B absolute");
    press("Apply");
    await waitFor(() => expect(vi.mocked(measureSimsRegion).mock.calls.at(-1)?.[0]).toMatchObject({ threshold_mode: "absolute", threshold: 4, columns: [0] }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Export CSV" })); });
    expect(saveBlob).toHaveBeenCalled();
    await waitFor(() => expect(readLastUsed("sims-region")).not.toBeNull());
    expect(readLastUsed("sims-region")?.settings).toEqual({ species: ["B"], mode: "absolute", threshold: "4" });
    const stored = JSON.parse(localStorage.getItem("qz.presets") ?? "{}").presets[0].settings;
    expect(Object.keys(stored).sort()).toEqual(["mode", "species", "threshold"]);
  });

  it("a species this profile lacks is named and skipped", async () => {
    await openTab("Region", TOOL);
    savePreset("B and Si");
    fireEvent.change(combo("Region profile"), { target: { value: "s3" } }); // Ge, Si
    await waitFor(() => expect(box("Ge")).toBeChecked());
    pick("B and Si");
    press("Apply");
    expect(statusOf(TOOL)).toContain("species skipped (species 'B' is not in this profile)");
    expect(box("Ge")).not.toBeChecked(); // the preset chose B and Si: Si is applied, B is named as missing
    expect(box("Si")).toBeChecked();
  });
});
