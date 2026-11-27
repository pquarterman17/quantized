// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P4), through
// the real Tabulate panel, hook, store and storage: save, change, Apply restores
// the layout (columns by label), Revert works, an unknown field is rejected, a
// missing column is skipped and named, and last used is written by a successful
// export only (never by Apply).

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useApp } from "../../../store/useApp";
import TabulatePanel from "./TabulatePanel";

vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [[0, 10], [0, 12], [0, 14], [0, 16], [0, 18], [0, 20], [1, 30], [1, 32], [1, 34], [1, 36], [1, 38], [1, 40]],
  labels: ["grp", "val"],
  units: ["", ""],
  metadata: { x_column_name: "T" },
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", tabulateOpen: true, reports: [], status: "",
    analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

const bar = () => screen.findByRole("region", { name: "Tabulate presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Tabulate presets" })).getByRole("status").textContent ?? "";
const stat = (k: string) => screen.getByLabelText(k) as HTMLInputElement;
const total = () => screen.getByRole("switch", { name: "Grand total row" });
const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent);
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

describe("Tabulate preset bar", () => {
  it("saves, changes, Applies: statistics, grand total and the table return; nothing is exported or remembered", async () => {
    render(<TabulatePanel />);
    await bar();
    fireEvent.click(stat("sem"));
    fireEvent.click(total());
    const saved = headers();
    expect(saved).toContain("sem");
    savePreset("with sem");
    expect(status()).toBe("Saved preset 'with sem'");
    fireEvent.click(stat("sem"));
    fireEvent.click(stat("min"));
    fireEvent.click(total());
    expect(headers()).not.toEqual(saved);
    press("Apply");
    expect(status()).toContain("Applied preset 'with sem' to Tabulate: the result updates on its own; press Export to keep it");
    expect(headers()).toEqual(saved);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(readLastUsed("tabulate")).toBeNull();
    cleanup();
    render(<TabulatePanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: "with sem" })).toBeTruthy();
  });

  it("restores the value layout by label, and Revert puts the hand-set layout back", async () => {
    render(<TabulatePanel />);
    await bar();
    savePreset("defaults");
    fireEvent.change(screen.getByLabelText("Assign a channel to Value"), { target: { value: "0" } }); // grp joins val
    const hand = headers();
    expect(hand.join(" ")).toContain("grp");
    pick("defaults");
    press("Apply");
    expect(headers()).not.toEqual(hand);
    press("Revert");
    expect(headers()).toEqual(hand);
  });

  it("a column the sheet lacks is skipped and named by its label", async () => {
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{
      id: "p1:x", workshop: "tabulate", name: "Elsewhere", schema: 1, createdAt: "t", updatedAt: "t",
      settings: { groupCols: ["grp"], valueCols: ["val", "ghost"], statKeys: ["count", "mean"], grandTotal: false },
    }] }));
    render(<TabulatePanel />);
    await bar();
    pick("Elsewhere");
    press("Apply");
    expect(status()).toContain("value columns skipped (column 'ghost' is not on this sheet)");
    expect(headers()).toContain("mean");
    expect(headers()).not.toContain("sd");
  });

  it("a preset with an unknown field or statistic is listed rejected and cannot be applied", async () => {
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [
      { id: "p1:x", workshop: "tabulate", name: "Odd", schema: 1, createdAt: "t", updatedAt: "t",
        settings: { groupCols: ["grp"], valueCols: ["val"], statKeys: ["mean"], grandTotal: false, rows: [0, 5] } },
      { id: "p1:y", workshop: "tabulate", name: "Bad stat", schema: 1, createdAt: "t", updatedAt: "t",
        settings: { groupCols: ["grp"], valueCols: ["val"], statKeys: ["kurtosis"], grandTotal: false } },
    ] }));
    render(<TabulatePanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: /Odd — rejected: setting 'rows' is not known/ })).toBeTruthy();
    expect(within(select()).getByRole("option", { name: /Bad stat — rejected: setting 'statKeys'/ })).toBeTruthy();
    pick("Odd");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by a successful export, with the labels", async () => {
    render(<TabulatePanel />);
    await bar();
    expect(readLastUsed("tabulate")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Export → dataset/ }));
    await vi.waitFor(() => expect(readLastUsed("tabulate")).not.toBeNull());
    expect(readLastUsed("tabulate")?.settings).toEqual({
      groupCols: ["grp"], valueCols: ["val"], statKeys: ["count", "mean", "sd", "min", "max", "median"], grandTotal: false,
    });
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("every statistic the picker offers is accepted by the adapter", async () => {
    const { container } = render(<TabulatePanel />);
    await bar();
    const { createTabulateAdapter } = await import("./presetAdapter");
    const adapter = createTabulateAdapter({ columns: () => [], getLayout: () => ({ groupCols: [], valueCols: [], statKeys: [], grandTotal: false }), setLayout: () => undefined });
    const offered = Array.from(container.querySelectorAll(".qzk-tabulate-stats label")).map((l) => l.textContent ?? "");
    expect(offered.length).toBeGreaterThan(6);
    for (const k of offered) expect(adapter.parse({ groupCols: ["grp"], valueCols: ["val"], statKeys: [k], grandTotal: false }), k).not.toHaveProperty("error");
  });
});
