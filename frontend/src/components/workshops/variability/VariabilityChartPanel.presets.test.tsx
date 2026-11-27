// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P4), through
// the real Variability panel, hook, store and storage: save, change, Apply
// restores the three picks by label, Revert works, a missing column is skipped
// and named, and Save result writes last used.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsNestedAnova, statsVarianceComponents, statsVariabilitySummary, type NestedAnovaResponse, type VarianceComponentsResponse, type VariabilitySummaryResponse } from "../../../lib/api";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useApp } from "../../../store/useApp";
import { useVariabilityStore } from "../../../store/variability";
import VariabilityChartPanel from "./VariabilityChartPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsNestedAnova: vi.fn(), statsVarianceComponents: vi.fn(), statsVariabilitySummary: vi.fn(), reportEmit: vi.fn(),
}));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: Array.from({ length: 18 }, (_, i) => i),
  values: [
    [0, 0, 2], [0, 0, 4], [0, 0, 6], [0, 1, 4], [0, 1, 6], [0, 1, 8],
    [1, 0, 6], [1, 0, 8], [1, 0, 10], [1, 1, 8], [1, 1, 10], [1, 1, 12],
    [2, 0, 10], [2, 0, 12], [2, 0, 14], [2, 1, 12], [2, 1, 14], [2, 1, 16],
  ],
  labels: ["lot", "wafer", "measurement"],
  units: ["", "", ""],
  metadata: { x_column_name: "T" },
};
const ANOVA: NestedAnovaResponse = {
  table: [
    { source: "A", SS: 192, df: 2, MS: 96, F: 32, p: 0.0005 }, { source: "B(A)", SS: 18, df: 3, MS: 6, F: 0.75, p: 0.55 },
    { source: "Error", SS: 48, df: 12, MS: 4, F: null, p: null }, { source: "Total", SS: 258, df: 17, MS: null, F: null, p: null },
  ],
  a_levels: 3, b_per_a: [2, 2, 2], n_per_cell: [[3, 3], [3, 3], [3, 3]], n_total: 18, grand_mean: 9, alpha: 0.05,
  a_tested_against: "B(A)", b_within_a_estimable: true, error_estimable: true, balanced: true,
};
const VARCOMP: VarianceComponentsResponse = {
  sigma2_A: 15, sigma2_B_within_A: 2 / 3, sigma2_error: 4, sigma2_A_raw: 15, sigma2_B_within_A_raw: 2 / 3, sigma2_error_raw: 4,
  pct_A: 76.3, pct_B_within_A: 3.4, pct_error: 20.3, clamped: { A: false, B_within_A: false, error: false },
  n1_coefficient: 3, n2_coefficient: 6, ms_a: 96, ms_b: 6, ms_e: 4, balanced: true, method: "ANOVA/EMS method (exact closed form, balanced design)",
};
const SUMMARY: VariabilitySummaryResponse = {
  cells: [
    { a_index: 0, b_index: 0, n: 3, mean: 4, sd: 2 }, { a_index: 0, b_index: 1, n: 3, mean: 6, sd: 2 },
    { a_index: 1, b_index: 0, n: 3, mean: 8, sd: 2 }, { a_index: 1, b_index: 1, n: 3, mean: 10, sd: 2 },
    { a_index: 2, b_index: 0, n: 3, mean: 12, sd: 2 }, { a_index: 2, b_index: 1, n: 3, mean: 14, sd: 2 },
  ],
  a_groups: [{ a_index: 0, n: 6, mean: 5 }, { a_index: 1, n: 6, mean: 9 }, { a_index: 2, n: 6, mean: 13 }],
  grand_mean: 9, grand_n: 18, a_levels: 3, balanced: true,
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsNestedAnova).mockResolvedValue(ANOVA);
  vi.mocked(statsVarianceComponents).mockResolvedValue(VARCOMP);
  vi.mocked(statsVariabilitySummary).mockResolvedValue(SUMMARY);
  useVariabilityStore.setState({ open: true, request: null });
  useApp.setState({ datasets: [{ id: "d1", name: "wafers.dat", data: DATA }], activeId: "d1", analysisResults: [], history: [], future: [] });
});

const bar = () => screen.findByRole("region", { name: "Variability chart presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Variability chart presets" })).getByRole("status").textContent ?? "";
const pickCol = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const picks = () => [pickCol("Response (Y)").value, pickCol("Factor A (outer)").value, pickCol("Factor B (nested in A)").value];
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

describe("Variability preset bar", () => {
  it("saves, changes, Applies: the three picks return by label and nothing is saved or remembered", async () => {
    render(<VariabilityChartPanel />);
    await bar();
    expect(picks()).toEqual(["2", "0", "1"]);
    savePreset("lot/wafer");
    fireEvent.change(pickCol("Factor A (outer)"), { target: { value: "1" } });
    fireEvent.change(pickCol("Factor B (nested in A)"), { target: { value: "0" } });
    expect(picks()).toEqual(["2", "1", "0"]);
    press("Apply");
    expect(status()).toContain("Applied preset 'lot/wafer' to Variability chart: the result updates on its own; press Save result to keep it");
    expect(picks()).toEqual(["2", "0", "1"]);
    expect(useApp.getState().analysisResults).toHaveLength(0);
    expect(readLastUsed("variability")).toBeNull();
    cleanup();
    render(<VariabilityChartPanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: "lot/wafer" })).toBeTruthy();
  });

  it("Revert restores the hand-set picks after two Applies", async () => {
    render(<VariabilityChartPanel />);
    await bar();
    savePreset("one");
    fireEvent.change(pickCol("Factor A (outer)"), { target: { value: "1" } });
    fireEvent.change(pickCol("Factor B (nested in A)"), { target: { value: "0" } });
    savePreset("two");
    fireEvent.change(pickCol("Response (Y)"), { target: { value: "0" } }); // hand-set
    const hand = picks();
    pick("one");
    press("Apply");
    pick("two");
    press("Apply");
    expect(picks()).not.toEqual(hand);
    press("Revert");
    expect(picks()).toEqual(hand);
  });

  it("a column the sheet lacks is skipped, named by its label, and that pick is kept", async () => {
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{
      id: "p1:x", workshop: "variability", name: "Elsewhere", schema: 1, createdAt: "t", updatedAt: "t",
      settings: { response: "measurement", factorA: "wafer", factorB: "ghost" },
    }] }));
    render(<VariabilityChartPanel />);
    await bar();
    pick("Elsewhere");
    press("Apply");
    expect(status()).toContain("Factor B (nested in A) skipped (column 'ghost' is not on this sheet)");
    expect(picks()).toEqual(["2", "1", "1"]);
  });

  it("last used is written by Save result, with the labels, and not before", async () => {
    render(<VariabilityChartPanel />);
    await bar();
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    expect(readLastUsed("variability")).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(readLastUsed("variability")).not.toBeNull());
    expect(readLastUsed("variability")?.settings).toEqual({ response: "measurement", factorA: "lot", factorB: "wafer" });
  });
});
