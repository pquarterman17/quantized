// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P4), through
// the real Multivariate panel, hook, store and storage: save, change, Apply
// restores (columns by label, method, standardize), Apply runs nothing and writes
// no last used, Revert works, and Save result writes last used.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type CorrelationResponse, type PCAResponse, statsCorrelation, statsPCA } from "../../../lib/api";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useMultivarStore } from "../../../store/multivar";
import { useApp } from "../../../store/useApp";
import MultivarPanel from "./MultivarPanel";

vi.mock("../../../lib/api", () => ({
  statsCorrelation: vi.fn(), statsPCA: vi.fn(),
  exportCorrelationHeatmapFigure: vi.fn(), exportSplomFigure: vi.fn(), exportPcaFigure: vi.fn(), exportPcaScreeFigure: vi.fn(),
}));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1, 10, 5], [2, 20, 3], [3, 30, 8], [4, 40, 1], [5, 50, 9], [6, 60, 2]],
  labels: ["a", "b", "c"],
  units: ["", "", ""],
  metadata: { x_column_name: "T" },
};
const CORR: CorrelationResponse = { r: [[1, 0.9, 0.1], [0.9, 1, 0.2], [0.1, 0.2, 1]], p: [[1, 0.01, 0.8], [0.01, 1, 0.7], [0.8, 0.7, 1]], N: 6, method: "pearson" };
const PCA: PCAResponse = {
  coeff: [[0.7, 0.7, 0], [0.7, -0.7, 0], [0, 0, 1]], score: DATA.values.map(() => [1, 0.1, 0]), latent: [3, 0.2, 0.1],
  explained: [90, 6, 4], cumulative: [90, 96, 100], mu: [3.5, 35, 4.7], sigma: [1, 1, 1], singular: [4, 1, 1],
};

// The same fixtures cut to the first two columns (a saved result must match its column count).
const CORR2: CorrelationResponse = { r: [[1, 0.9], [0.9, 1]], p: [[1, 0.01], [0.01, 1]], N: 6, method: "pearson" };
const PCA2: PCAResponse = {
  coeff: [[0.7, 0.7], [0.7, -0.7]], score: DATA.values.map(() => [1, 0.1]), latent: [3, 0.2],
  explained: [94, 6], cumulative: [94, 100], mu: [3.5, 35], sigma: [1, 1], singular: [4, 1],
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsCorrelation).mockResolvedValue(CORR);
  vi.mocked(statsPCA).mockResolvedValue(PCA);
  useMultivarStore.setState({ open: true, request: null, launch: null });
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", analysisResults: [], history: [], future: [] });
});

const bar = () => screen.findByRole("region", { name: "Multivariate presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Multivariate presets" })).getByRole("status").textContent ?? "";
const box = (label: string) => screen.getByRole("checkbox", { name: label }) as HTMLInputElement;
const radio = (label: string) => screen.getByRole("radio", { name: label }) as HTMLInputElement;
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

describe("Multivariate preset bar", () => {
  it("saves, changes, Applies: columns, method and nothing else run; remount still lists it", async () => {
    render(<MultivarPanel />);
    await bar();
    fireEvent.click(box("c")); // a, b
    fireEvent.click(radio("Spearman"));
    savePreset("a-b spearman");
    expect(status()).toBe("Saved preset 'a-b spearman'");
    fireEvent.click(box("c")); // a, b, c
    fireEvent.click(box("T"));
    fireEvent.click(radio("Pearson"));
    await waitFor(() => expect(statsCorrelation).toHaveBeenLastCalledWith(expect.anything(), "pearson"));
    const calls = vi.mocked(statsCorrelation).mock.calls.length;
    press("Apply");
    expect(status()).toContain("Applied preset 'a-b spearman' to Multivariate");
    expect(box("a").checked && box("b").checked).toBe(true);
    expect(box("c").checked || box("T").checked).toBe(false);
    expect(radio("Spearman").getAttribute("aria-checked")).toBe("true");
    // Apply loaded the draft; the analyses follow the draft as they always do, and no result was saved or remembered.
    await waitFor(() => expect(statsCorrelation).toHaveBeenLastCalledWith([DATA.values.map((r) => r[0]), DATA.values.map((r) => r[1])], "spearman"));
    expect(vi.mocked(statsCorrelation).mock.calls.length).toBeGreaterThan(calls);
    expect(useApp.getState().analysisResults).toHaveLength(0);
    expect(readLastUsed("multivar")).toBeNull();
    cleanup();
    render(<MultivarPanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: "a-b spearman" })).toBeTruthy();
  });

  it("Revert restores the hand-set columns after two Applies", async () => {
    render(<MultivarPanel />);
    await bar();
    fireEvent.click(box("c"));
    savePreset("ab");
    fireEvent.click(box("c"));
    fireEvent.click(box("a"));
    savePreset("bc");
    fireEvent.click(box("a")); // hand-set: a, b, c
    pick("ab");
    press("Apply");
    pick("bc");
    press("Apply");
    expect(box("a").checked).toBe(false);
    press("Revert");
    expect(box("a").checked && box("b").checked && box("c").checked).toBe(true);
  });

  it("a column the sheet lacks is skipped and named by its label", async () => {
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{
      id: "p1:x", workshop: "multivar", name: "Other sheet", schema: 1, createdAt: "t", updatedAt: "t",
      settings: { columns: ["a", "ghost", "b"], method: "spearman", standardize: true, pcX: 0, pcY: 1 },
    }] }));
    render(<MultivarPanel />);
    await bar();
    pick("Other sheet");
    press("Apply");
    expect(status()).toContain("columns skipped (column 'ghost' is not on this sheet)");
    expect(box("a").checked && box("b").checked).toBe(true);
    expect(box("c").checked).toBe(false);
  });

  it("a preset with an unknown field is listed rejected and cannot be applied", async () => {
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{
      id: "p1:x", workshop: "multivar", name: "Odd", schema: 1, createdAt: "t", updatedAt: "t",
      settings: { columns: ["a", "b"], method: "pearson", standardize: false, pcX: 0, pcY: 1, datasetId: "d1" },
    }] }));
    render(<MultivarPanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: /Odd — rejected: setting 'datasetId' is not known/ })).toBeTruthy();
    pick("Odd");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by Save result, with the labels, and not before", async () => {
    vi.mocked(statsCorrelation).mockResolvedValue(CORR2);
    vi.mocked(statsPCA).mockResolvedValue(PCA2);
    render(<MultivarPanel />);
    await bar();
    fireEvent.click(box("c"));
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    expect(readLastUsed("multivar")).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(readLastUsed("multivar")).not.toBeNull());
    expect(readLastUsed("multivar")?.settings).toEqual({ columns: ["a", "b"], method: "pearson", standardize: false, pcX: 0, pcY: 1 });
  });

  it("every correlation method the panel offers is accepted by the adapter", async () => {
    render(<MultivarPanel />);
    await bar();
    const { createMultivarAdapter } = await import("./presetAdapter");
    const adapter = createMultivarAdapter({
      columns: () => [], getSelected: () => [], setSelected: () => undefined, getMethod: () => "pearson", setMethod: () => undefined,
      getStandardize: () => false, setStandardize: () => undefined, getPc: () => ({ pcX: 0, pcY: 1 }), setPc: () => undefined,
    });
    const base = { columns: ["a", "b"], method: "pearson", standardize: false, pcX: 0, pcY: 1 };
    // The toggle's own options, by their visible names (the values are those names, lower case).
    for (const name of ["Pearson", "Spearman"]) {
      expect(radio(name)).toBeTruthy();
      expect(adapter.parse({ ...base, method: name.toLowerCase() }), name).not.toHaveProperty("error");
    }
  });
});
