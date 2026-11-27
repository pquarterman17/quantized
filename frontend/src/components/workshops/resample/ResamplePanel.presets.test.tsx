// P1 acceptance for the preset bar (plans/PRESET_BAR_CONTRACT.md section 9),
// through the real panel, hook, store and storage: save, apply, revert, last
// used, locked records, reopened results and delete.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResampleRequest, ResampleResult } from "../../../lib/api/resample";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import { PRESETS_KEY } from "../../../lib/presets";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useConfirm } from "../../../store/confirmDialog";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useToolReopen } from "../../../store/toolReopen";
import { useApp } from "../../../store/useApp";
import ResamplePanel from "./ResamplePanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn() }));
const { resampleDataset } = await import("../../../lib/api/resample");

function fakeBackend(body: ResampleRequest): Promise<ResampleResult> {
  const { time } = body.dataset;
  const n = body.n_points ?? 2;
  const lo = Math.min(...time);
  const hi = Math.max(...time);
  const grid = Array.from({ length: n }, (_, k) => lo + ((hi - lo) * k) / (n - 1));
  return Promise.resolve({
    dataset: { time: grid, values: grid.map((x) => [x]), labels: body.dataset.labels, units: body.dataset.units, metadata: { ...body.dataset.metadata } },
    warnings: [], source_range: [lo, hi], rows_in: time.length, rows_out: n,
  });
}

const a: DataStruct = { time: [0, 1, 2, 3], values: [[0], [10], [20], [30]], labels: ["M"], units: ["emu"], metadata: { x_column_unit: "K" } };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  useToolReopen.setState({ sessions: {} });
  vi.clearAllMocks();
  vi.mocked(resampleDataset).mockImplementation(fakeBackend);
  useApp.setState({ datasets: [{ id: "d1", name: "a.dat", data: a }], folders: [], activeId: "d1", selectedIds: ["d1"], macroRecording: true, macroSteps: [], history: [], future: [] });
  useResampleDialog.setState({ seed: ["d1"] });
});

const bar = () => screen.findByRole("region", { name: "Resample presets" });
const points = () => screen.getByRole("textbox", { name: "Number of points" }) as HTMLInputElement;
const method = () => screen.getByRole("combobox", { name: "Interpolation" }) as HTMLSelectElement;
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => screen.getByRole("status").textContent ?? "";

function setForm(n: string, m: string) {
  fireEvent.change(points(), { target: { value: n } });
  fireEvent.change(method(), { target: { value: m } });
}
function pick(label: RegExp | string) {
  const opt = within(select()).getAllByRole("option").find((o) => (typeof label === "string" ? o.textContent?.startsWith(label) : label.test(o.textContent ?? "")));
  if (!opt) throw new Error(`no option ${String(label)}`);
  fireEvent.change(select(), { target: { value: (opt as HTMLOptionElement).value } });
}
function savePreset(name: string) {
  press("Save as…");
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: name } });
  press("Save");
}
const lastBody = () => vi.mocked(resampleDataset).mock.calls.at(-1)?.[0] as ResampleRequest;
const lastPreview = () => waitFor(() => expect(vi.mocked(resampleDataset).mock.calls.length).toBeGreaterThan(0));

describe("Resample preset bar", () => {
  it("saves a preset, applies it after changing the form, and the next preview carries the saved settings", async () => {
    render(<ResamplePanel />);
    await bar();
    setForm("77", "pchip");
    savePreset("Dense PCHIP");
    expect(status()).toBe("Saved preset 'Dense PCHIP'");
    setForm("20", "linear");
    await waitFor(() => expect(lastBody()).toMatchObject({ n_points: 20, method: "linear" }));
    press("Apply");
    expect(points().value).toBe("77");
    expect(method().value).toBe("pchip");
    expect(status()).toContain("Applied preset 'Dense PCHIP' to Resample: press Create to run it");
    await waitFor(() => expect(lastBody()).toMatchObject({ n_points: 77, method: "pchip" }));
    // Apply loaded the draft and nothing else: no dataset, no recorded step, no last used.
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().macroSteps).toEqual([]);
    expect(readLastUsed("resample")).toBeNull();
    // Remounted (reload): the preset is still listed, and the form starts from defaults.
    cleanup();
    render(<ResamplePanel />);
    await bar();
    expect(points().value).toBe("500");
    expect(within(select()).getByRole("option", { name: "Dense PCHIP" })).toBeTruthy();
  });

  it("Revert restores the hand-set values after two Applies", async () => {
    render(<ResamplePanel />);
    await bar();
    setForm("11", "linear");
    savePreset("P-11");
    setForm("22", "pchip");
    savePreset("P-22");
    setForm("33", "makima");
    pick("P-11");
    press("Apply");
    pick("P-22");
    press("Apply");
    expect(points().value).toBe("22");
    press("Revert");
    expect(points().value).toBe("33");
    expect(method().value).toBe("makima");
    expect(screen.getByRole("button", { name: "Revert" })).toBeDisabled();
  });

  it("a record from a newer schema is listed locked with its reason, cannot be applied, and survives saving another preset", async () => {
    const future = { id: "p1:future", workshop: "resample", name: "Future", schema: 2, settings: { nPoints: "5", wibble: true }, createdAt: "t", updatedAt: "t" };
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [future] }));
    render(<ResamplePanel />);
    await bar();
    const opt = within(select()).getByRole("option", { name: /Future — locked: needs a newer version of Quantized/ });
    fireEvent.change(select(), { target: { value: (opt as HTMLOptionElement).value } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Rename/ })).toBeDisabled();
    savePreset("Other");
    expect(JSON.stringify(JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}").presets[0])).toBe(JSON.stringify(future));
  });

  it("rejects a hand-edited record with an unknown field, naming it, and never applies it", async () => {
    const bad = { id: "p1:bad", workshop: "resample", name: "Bad", schema: 1, settings: { ...JSON.parse('{"mode":"n_points","nPoints":"5","step":"","start":"","stop":"","rangeStep":"","method":"linear","outOfRange":"nan","sortUnsorted":false}'), colour: "red" }, createdAt: "t", updatedAt: "t" };
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: [bad] }));
    render(<ResamplePanel />);
    await bar();
    pick(/^Bad — rejected: setting 'colour' is not known to this version/);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(points().value).toBe("500");
  });

  it("writes last used after a successful Create only, offers it without applying it, and applies it on open only when opted in", async () => {
    render(<ResamplePanel />);
    await bar();
    setForm("9", "pchip");
    // A failed run writes nothing.
    await lastPreview();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Create/ })).not.toBeDisabled());
    vi.mocked(resampleDataset).mockRejectedValue(new Error("boom"));
    await act(async () => press(/^Create/));
    expect(readLastUsed("resample")).toBeNull();
    vi.mocked(resampleDataset).mockImplementation(fakeBackend);
    setForm("9", "pchip");
    await waitFor(() => expect(screen.getByRole("button", { name: /^Create/ })).not.toBeDisabled());
    await act(async () => press(/^Create/));
    await waitFor(() => expect(readLastUsed("resample")).not.toBeNull());
    expect(readLastUsed("resample")?.settings).toMatchObject({ nPoints: "9", method: "pchip" });

    // Reopened: offered as an entry, but the form is on its defaults.
    useResampleDialog.setState({ seed: ["d1"], opened: Date.now() });
    cleanup();
    render(<ResamplePanel />);
    await bar();
    expect(points().value).toBe("500");
    expect(within(select()).getByRole("option", { name: /^Last used \(/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    pick(/^Last used/);
    press("Apply");
    expect(points().value).toBe("9");

    // Opted in: the tool starts from it, and says so.
    setWorkflowPrefs({ startFromLastUsed: true });
    cleanup();
    render(<ResamplePanel />);
    await bar();
    await waitFor(() => expect(points().value).toBe("9"));
    expect(status()).toContain("Applied last-used settings");
    expect(screen.getByText("Settings: Last used")).toBeTruthy();
  });

  it("a panel opened from a result starts from the result, not last used, and says so", async () => {
    lastUsedSlot.save({ resample: { schema: 1, settings: { mode: "n_points", nPoints: "9", step: "", start: "", stop: "", rangeStep: "", method: "pchip", outOfRange: "nan", sortUnsorted: false }, at: "2026-11-26T14:03:00.000Z" } });
    setWorkflowPrefs({ startFromLastUsed: true });
    useToolReopen.getState().start("resample", {
      resultId: "r1", resultName: "Resample 1", sourceId: "d1", sourceIds: ["d1"], outputId: null, outputName: null,
      seed: { params: { op: "resample", mode: "n_points", nPoints: 77, method: "linear", outOfRange: "nan", sortUnsorted: false } }, extra: null, notice: null, replaceBlocked: null,
    });
    render(<ResamplePanel />);
    await bar();
    expect(points().value).toBe("77");
    expect(screen.getByText("Settings: the reopened result")).toBeTruthy();
  });

  it("rename keeps the id; delete asks first and removes only that preset", async () => {
    render(<ResamplePanel />);
    await bar();
    setForm("11", "linear");
    savePreset("One");
    setForm("22", "linear");
    savePreset("Two");
    const ids = () => (JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}").presets as { id: string; name: string }[]).map((p) => [p.id, p.name]);
    const before = ids();
    pick("One");
    press("Rename…");
    fireEvent.change(screen.getByRole("textbox", { name: "New preset name" }), { target: { value: "Uno" } });
    press("Save");
    expect(ids().map((p) => p[0])).toEqual(before.map((p) => p[0]));
    expect(ids().map((p) => p[1])).toEqual(["Uno", "Two"]);
    press("Delete…");
    expect(useConfirm.getState().title).toContain("Uno");
    expect(ids()).toHaveLength(2); // nothing is removed until confirmed
    await act(async () => useConfirm.getState().resolve?.(false));
    expect(ids()).toHaveLength(2);
    press("Delete…");
    await act(async () => useConfirm.getState().resolve?.(true));
    expect(ids().map((p) => p[1])).toEqual(["Two"]);
  });

  it("reports a refused storage write and does not list the preset as saved", async () => {
    render(<ResamplePanel />);
    await bar();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    savePreset("Nope");
    spy.mockRestore();
    expect(status()).toContain("refused the write");
    expect(within(select()).queryByRole("option", { name: "Nope" })).toBeNull();
  });
});
