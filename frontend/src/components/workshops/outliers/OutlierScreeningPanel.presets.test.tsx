// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P4), through
// the real Outlier screening panel, hook, store and storage: save, change,
// Apply restores the rule and the next screen carries it, Revert works, last
// used is written by Save result only, and every method the panel offers is
// accepted by the adapter.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { useApp } from "../../../store/useApp";
import OutlierScreeningPanel from "./OutlierScreeningPanel";
import { createOutlierAdapter } from "./presetAdapter";

const { grubbsMock, rosnerMock, dixonMock, madMock } = vi.hoisted(() => ({
  grubbsMock: vi.fn(), rosnerMock: vi.fn(), dixonMock: vi.fn(), madMock: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsGrubbs: grubbsMock, statsRosner: rosnerMock, statsDixonQ: dixonMock, statsMadOutliers: madMock,
}));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6],
  values: [[10], [11], [12], [13], [999], [14], [15]],
  labels: ["y"],
  units: [""],
  metadata: { x_column_name: "T" },
};
const GRUBBS = {
  G: 3.5, G_critical: 2.1, flagged: true, flagged_indices: [4], index: 4, value: 999,
  tail: "two-sided", alpha: 0.05, N: 7, excluded_indices: [], method: "Grubbs test (single outlier)",
};
const ROSNER = {
  num_outliers: 1, flagged_indices: [4], flagged_values: [999], table: [], k: 4, alpha: 0.01,
  N: 7, excluded_indices: [], method: "generalized ESD (Rosner)",
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  grubbsMock.mockResolvedValue(GRUBBS);
  rosnerMock.mockResolvedValue(ROSNER);
  madMock.mockResolvedValue({ threshold: 3.5, median: 12.5, mad: 1, modified_z_scores: [0, 0, 0, 0, 600, 0, 0], flagged_indices: [4], flagged_values: [999], N: 7, excluded_indices: [], method: "MAD" });
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", status: "", selection: null, analysisResults: [], history: [], future: [] });
  useOutlierScreeningStore.setState({ open: true, request: null });
  useAnalysisSelection.setState({ toolId: null, selection: null, offeredRanges: {} });
});

const bar = () => screen.findByRole("region", { name: "Outlier screening presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const method = () => screen.getByLabelText("Method") as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Outlier screening presets" })).getByRole("status").textContent ?? "";
const num = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
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
  render(<OutlierScreeningPanel />);
  await bar();
  await screen.findByText(/G = 3\.5/);
}

describe("Outlier screening preset bar", () => {
  it("saves, changes, Applies: the rule returns and the next screen carries it", async () => {
    await ready();
    fireEvent.change(method(), { target: { value: "rosner" } });
    num("alpha", "0.01");
    num("k (max outliers)", "4");
    await waitFor(() => expect(rosnerMock).toHaveBeenLastCalledWith(expect.anything(), 4, 0.01));
    savePreset("Rosner 4");
    expect(status()).toBe("Saved preset 'Rosner 4'");
    fireEvent.change(method(), { target: { value: "grubbs" } });
    await screen.findByText(/G = 3\.5/);
    rosnerMock.mockClear();
    pick("Rosner 4");
    press("Apply");
    expect(status()).toContain("Applied preset 'Rosner 4' to Outlier screening: the result updates on its own; press Save result to keep it");
    expect(status()).not.toContain("to run it"); // this tool recomputes by itself: nothing is waiting to be run
    expect(method().value).toBe("rosner");
    expect(val("alpha")).toBe("0.01");
    expect(val("k (max outliers)")).toBe("4");
    await waitFor(() => expect(rosnerMock).toHaveBeenLastCalledWith(expect.anything(), 4, 0.01));
    expect(readLastUsed("outlier-screening")).toBeNull();
    cleanup();
    render(<OutlierScreeningPanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: "Rosner 4" })).toBeTruthy();
  });

  it("Revert restores the hand-set rule after two Applies", async () => {
    await ready();
    num("alpha", "0.1");
    savePreset("Loose");
    num("alpha", "0.001");
    savePreset("Strict");
    fireEvent.change(method(), { target: { value: "mad" } });
    num("threshold", "5");
    pick("Loose");
    press("Apply");
    pick("Strict");
    press("Apply");
    expect(method().value).toBe("grubbs");
    expect(val("alpha")).toBe("0.001");
    press("Revert");
    expect(method().value).toBe("mad");
    expect(val("threshold")).toBe("5");
  });

  it("a preset with a bad value is listed rejected with the field named and cannot be applied", async () => {
    const settings = { method: "grubbs", threshold: 3.5, alpha: 2, k: 2 };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "outlier-screening", name: "Broken", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    await ready();
    expect(within(select()).getByRole("option", { name: /Broken — rejected: setting 'alpha'/ })).toBeTruthy();
    pick("Broken");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by Save result, not by Apply or by edits", async () => {
    await ready();
    num("alpha", "0.02");
    await waitFor(() => expect(grubbsMock).toHaveBeenLastCalledWith(expect.anything(), 0.02));
    expect(readLastUsed("outlier-screening")).toBeNull();
    const save = screen.getByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(readLastUsed("outlier-screening")).not.toBeNull());
    expect(readLastUsed("outlier-screening")?.settings).toEqual({ method: "grubbs", threshold: 3.5, alpha: 0.02, k: 2 });
  });

  it("every method the panel offers is accepted by the adapter", async () => {
    await ready();
    const adapter = createOutlierAdapter({
      method: "grubbs", setMethod: () => undefined, threshold: 3.5, setThreshold: () => undefined, alpha: 0.05, setAlpha: () => undefined, k: 2, setK: () => undefined,
    });
    const offered = within(method()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(offered).toHaveLength(4);
    for (const m of offered) expect(adapter.parse({ ...adapter.defaults(), method: m }), m).not.toHaveProperty("error");
  });

  it("a panel opened from a result applies the result, not last used, even with the opt-in on", async () => {
    setWorkflowPrefs({ startFromLastUsed: true });
    lastUsedSlot.save({ "outlier-screening": { schema: 1, settings: { method: "dixon-q", threshold: 3.5, alpha: 0.2, k: 2 }, at: "2026-11-27T10:00:00.000Z" } });
    useOutlierScreeningStore.getState().openWith({ col: 0, method: "mad", alpha: 0.05, k: 2, threshold: 6 });
    render(<OutlierScreeningPanel />);
    await bar();
    await waitFor(() => expect(method().value).toBe("mad"));
    expect(val("threshold")).toBe("6");
    expect(screen.getByText(/Settings: the reopened result/)).toBeInTheDocument();
  });
});
