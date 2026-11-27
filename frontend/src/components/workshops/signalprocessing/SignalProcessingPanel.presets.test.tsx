// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P5), through
// the real Signal Processing panel and storage: save, change, Apply restores
// the settings and the next preview request carries them, Revert works after
// two Applies, a rejected record cannot be applied, last used is written by a
// successful Create only, and a deep-link operation outranks last used.

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { Dataset } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useSignalOperationSeed } from "../../../store/signalOperationSeed";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "./SignalProcessingPanel";

const { correctionMock, createSignalMock } = vi.hoisted(() => ({ correctionMock: vi.fn(), createSignalMock: vi.fn() }));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  applyCorrections: correctionMock,
}));
vi.mock("../../../lib/api/spectralWorkbench", () => ({ runSpectralWorkbench: vi.fn() }));
vi.mock("../../../store/signalWorksheetCommand", () => ({ createSignalWorksheetFromApp: createSignalMock }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));

const dataset: Dataset = {
  id: "signal-source",
  name: "scan",
  data: {
    time: [1, 2, 3, 4, 5, 6],
    values: [[10], [20], [30], [25], [15], [5]],
    labels: ["primary"],
    units: ["V"],
    metadata: { xUnit: "s" },
  },
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  useSignalOperationSeed.setState({ op: null, nonce: 0 });
  correctionMock.mockImplementation(async ({ dataset: data }: { dataset: Dataset["data"] }) => structuredClone(data));
  createSignalMock.mockResolvedValue("new-sheet");
  useApp.setState({ datasets: [dataset], activeId: dataset.id, yKeys: [0], signalProcessingOpen: true, status: "", history: [], future: [] });
});

const operation = () => screen.getByRole("combobox", { name: "Operation" }) as HTMLSelectElement;
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Signal processing presets" })).getByRole("status").textContent ?? "";
const setOp = (v: string) => fireEvent.change(operation(), { target: { value: v } });
const order = () => screen.getByLabelText(/Polynomial order \(0 = mean/) as HTMLInputElement;
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
  render(<SignalProcessingPanel />);
  await screen.findByRole("region", { name: "Signal processing presets" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Create new worksheet" })).toBeEnabled());
}

describe("Signal Processing preset bar", () => {
  it("saves, changes, Applies: the settings return and the next preview request carries them", async () => {
    await ready();
    setOp("detrend");
    fireEvent.change(order(), { target: { value: "3" } });
    savePreset("Cubic detrend");
    expect(status()).toBe("Saved preset 'Cubic detrend'");
    setOp("smooth");
    await waitFor(() => expect(correctionMock).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ smoothEnabled: true }) }), expect.anything()));
    pick("Cubic detrend");
    press("Apply");
    expect(status()).toContain("Applied preset 'Cubic detrend' to Signal processing: press Create new worksheet to run it");
    expect(status()).toContain("check the signal columns");
    expect(operation().value).toBe("detrend");
    expect(order().value).toBe("3");
    await waitFor(() => expect(correctionMock).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ detrendOrder: 3 }) }), expect.anything()));
    expect(createSignalMock).not.toHaveBeenCalled();
    expect(readLastUsed("signal-processing")).toBeNull();
    cleanup();
    render(<SignalProcessingPanel />);
    await screen.findByRole("region", { name: "Signal processing presets" });
    expect(within(select()).getByRole("option", { name: "Cubic detrend" })).toBeTruthy();
  });

  it("Revert restores the hand-set settings after two Applies", async () => {
    await ready();
    setOp("detrend");
    fireEvent.change(order(), { target: { value: "2" } });
    savePreset("Quadratic");
    fireEvent.change(order(), { target: { value: "4" } });
    savePreset("Quartic");
    setOp("integral");
    pick("Quadratic");
    press("Apply");
    pick("Quartic");
    press("Apply");
    expect(operation().value).toBe("detrend");
    expect(order().value).toBe("4");
    press("Revert");
    expect(operation().value).toBe("integral");
  });

  it("a preset with a bad value is listed rejected with the field named and cannot be applied", async () => {
    const good = (await import("./presetAdapter")).createSignalAdapter({
      settings: { ...(await import("./signalProcessingModel")).DEFAULT_SIGNAL_SETTINGS }, setSettings: () => undefined,
      spectral: { ...(await import("./spectralSettings")).DEFAULT_SPECTRAL_SETTINGS }, setSpectral: () => undefined,
    }).defaults();
    const settings = { ...good, signal: { ...good.signal, detrendOrder: 9 } };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "signal-processing", name: "Broken", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    await ready();
    expect(within(select()).getByRole("option", { name: /Broken — rejected: setting 'signal' is not valid: setting 'detrendOrder'/ })).toBeTruthy();
    pick("Broken");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by a successful Create, not by Apply, edits or a refused Create", async () => {
    await ready();
    setOp("detrend");
    fireEvent.change(order(), { target: { value: "2" } });
    expect(readLastUsed("signal-processing")).toBeNull();
    createSignalMock.mockResolvedValueOnce(null);
    await waitFor(() => expect(correctionMock).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ detrendOrder: 2 }) }), expect.anything()));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create new worksheet" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create new worksheet" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create new worksheet" })).toBeEnabled());
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    expect(readLastUsed("signal-processing")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create new worksheet" }));
    await waitFor(() => expect(readLastUsed("signal-processing")).not.toBeNull());
    expect(readLastUsed("signal-processing")?.settings).toMatchObject({ signal: { operation: "detrend", detrendOrder: 2, useRange: false, xMin: "" } });
  });

  it("a deep-link operation outranks last used even with the opt-in on", async () => {
    setWorkflowPrefs({ startFromLastUsed: true });
    lastUsedSlot.save({ "signal-processing": { schema: 1, at: "2026-11-27T10:00:00.000Z", settings: { signal: { operation: "detrend", smoothMethod: "moving", smoothWindow: 5, smoothPolyOrder: 2, referenceMode: "value", referenceValue: "1", referenceMin: "", referenceMax: "", detrendOrder: 3, useRange: false, xMin: "", xMax: "", useAllRows: true }, spectral: {} } } });
    useSignalOperationSeed.getState().request("integral");
    render(<SignalProcessingPanel />);
    await screen.findByRole("region", { name: "Signal processing presets" });
    await waitFor(() => expect(operation().value).toBe("integral"));
    expect(screen.getByText(/Settings: the reopened result/)).toBeInTheDocument();
  });

  it("every operation the picker offers for the main workbench is accepted by the adapter", async () => {
    await ready();
    const { SETTINGS_OPERATIONS } = await import("./signalOptions");
    const offered = within(operation()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    for (const v of SETTINGS_OPERATIONS) expect(offered).toContain(v);
  });
});
