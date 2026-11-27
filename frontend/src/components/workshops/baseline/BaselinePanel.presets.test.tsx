// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P3), through
// the real Baseline panel, hook, store and storage: save, change, Apply, the
// settings are restored and the next estimate carries them, Revert works, and
// last used is written by a successful Subtract only.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { baselineALS, baselineModPoly } from "../../../lib/api/baseline";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useApp } from "../../../store/useApp";
import BaselinePanel from "./BaselinePanel";

vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(), baselineAnchor: vi.fn(), baselineEstimate: vi.fn(), baselineModPoly: vi.fn(), baselineRegion: vi.fn(),
  baselineRollingBall: vi.fn(), baselineShirley: vi.fn(), baselineXrdLowAngle: vi.fn(),
}));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const raw: DataStruct = { time: [1, 2, 3, 4], values: [[10], [12], [11], [13]], labels: ["I"], units: ["cps"], metadata: {} };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.mocked(baselineALS).mockResolvedValue({ baseline: [1, 1, 1, 1] });
  vi.mocked(baselineModPoly).mockResolvedValue({ baseline: [1, 1, 1, 1], info: {} } as never);
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: raw }], activeId: "d1", selectedIds: ["d1"], baselineOpen: true, baselineOverlay: null,
    baselineAnchorEdit: null, plotTool: "zoom", regionPicked: null, xKey: null, yKeys: null, seriesOrder: null, history: [], future: [],
  });
});

const bar = () => screen.findByRole("region", { name: "Baseline presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const method = () => screen.getByRole("combobox", { name: "Baseline method" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Baseline presets" })).getByRole("status").textContent ?? "";
const field = (label: string) => screen.getByText(label).nextElementSibling as HTMLInputElement;
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

describe("Baseline preset bar", () => {
  it("saves, changes, Applies: the method and knobs return and the next estimate carries them", async () => {
    render(<BaselinePanel />);
    await bar();
    fireEvent.change(field("Smoothness λ"), { target: { value: "50000" } });
    savePreset("Soft ALS");
    expect(status()).toBe("Saved preset 'Soft ALS'");
    fireEvent.change(method(), { target: { value: "modpoly" } });
    fireEvent.change(field("Poly order"), { target: { value: "8" } });
    press("Apply");
    expect(status()).toContain("Applied preset 'Soft ALS' to Baseline: press Estimate to run it");
    expect(method().value).toBe("als");
    expect(field("Smoothness λ").value).toBe("50000");
    // Apply did not run the tool and wrote no last used.
    expect(vi.mocked(baselineALS)).not.toHaveBeenCalled();
    expect(readLastUsed("baseline")).toBeNull();
    press("Estimate");
    await waitFor(() => expect(useApp.getState().baselineOverlay).not.toBeNull());
    expect(vi.mocked(baselineALS).mock.calls.at(-1)![0]).toMatchObject({ lam: 50000 });
    // Remounted: still listed, panel starts from the defaults.
    cleanup();
    render(<BaselinePanel />);
    await bar();
    expect(method().value).toBe("als");
    expect(within(select()).getByRole("option", { name: "Soft ALS" })).toBeTruthy();
  });

  it("Revert restores the hand-set values after two Applies", async () => {
    render(<BaselinePanel />);
    await bar();
    fireEvent.change(field("Smoothness λ"), { target: { value: "111" } });
    savePreset("P-111");
    fireEvent.change(method(), { target: { value: "modpoly" } });
    fireEvent.change(field("Poly order"), { target: { value: "4" } });
    savePreset("P-poly4");
    fireEvent.change(method(), { target: { value: "als" } });
    fireEvent.change(field("Smoothness λ"), { target: { value: "999" } });
    pick("P-poly4");
    press("Apply");
    pick("P-111");
    press("Apply");
    expect(field("Smoothness λ").value).toBe("111");
    press("Revert");
    expect(method().value).toBe("als");
    expect(field("Smoothness λ").value).toBe("999");
  });

  it("a preset with a bad knob is listed rejected with the field named and cannot be applied", async () => {
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{
      id: "p1:x", workshop: "baseline", name: "Broken", schema: 1, createdAt: "t", updatedAt: "t",
      settings: { method: "als", lam: 1e6, p: 0.01, radius: 0, order: 5, maxWindowDeg: 2, regionXMin: null, regionXMax: null, regionYMin: null, regionYMax: null, maxIter: 50, anchorMethod: "pchip" },
    }] }));
    render(<BaselinePanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: /Broken — rejected: setting 'radius'/ })).toBeTruthy();
    pick("Broken");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by a successful Subtract, not by Estimate", async () => {
    render(<BaselinePanel />);
    await bar();
    fireEvent.change(field("Smoothness λ"), { target: { value: "777" } });
    press("Estimate");
    await waitFor(() => expect(useApp.getState().baselineOverlay).not.toBeNull());
    await waitFor(() => expect((screen.getByRole("button", { name: /Subtract/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(readLastUsed("baseline")).toBeNull();
    press(/Subtract/);
    await waitFor(() => expect(readLastUsed("baseline")).not.toBeNull());
    expect(readLastUsed("baseline")?.settings).toMatchObject({ method: "als", lam: 777 });
    expect(useApp.getState().datasets).toHaveLength(2);
  });
});
