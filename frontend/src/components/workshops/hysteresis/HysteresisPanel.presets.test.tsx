// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P5), through
// the real Hysteresis panel, its comparison batch and storage: save the trend
// axis, change it, Apply restores it and the batch result carries it, Revert
// works after two Applies, a missing source is skipped and named, a rejected
// record cannot be applied, last used is written by a worksheet that ran only,
// and every source the select offers is accepted by the adapter.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { CalcResult, Dataset } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import HysteresisPanel from "./HysteresisPanel";
import { createHysteresisAdapter } from "./presetAdapter";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/magnetometry", () => ({ hysteresisAnalysis: vi.fn(), subtractHysteresisBackground: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

function loop(id: string, temperature: number): Dataset {
  const field = Array.from({ length: 24 }, (_value, index) => index - 12);
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: field,
      values: field.map((h) => [Math.tanh(h / 3)]),
      labels: ["Moment"],
      units: ["emu"],
      metadata: { technique: "magnetometry.mvsh", x_column_name: "Magnetic Field", x_column_unit: "Oe", default_value_channels: [0], temperature, temperature_unit: "K" },
    },
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  register.mockReset();
  const datasets = [loop("a", 100), loop("b", 200)];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null,
    analysisResults: [], openAnalysisResultId: null, status: "", history: [], future: [],
    resolveDataset: async (id: string) => datasets.find((dataset) => dataset.id === id),
  });
  useAnalysisSelection.getState().setSelection("hysteresis", captureAnalysisSelection({
    datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null,
  }, "library"));
  usePendingOps.setState({ ops: [] });
  vi.mocked(hysteresisAnalysis).mockResolvedValue({ HcMean: 2, MrMean: 0.4, MsMean: 1.1, squareness: 0.36, loopArea: 5, SFD: { peakH: 1.5 }, warnings: [] } as CalcResult);
});

const source = () => screen.getByRole("combobox", { name: "Trend axis source" }) as HTMLSelectElement;
const label = () => screen.getByRole("textbox", { name: "Trend axis label" }) as HTMLInputElement;
const unit = () => screen.getByRole("textbox", { name: "Trend axis unit" }) as HTMLInputElement;
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Hysteresis presets" })).getByRole("status").textContent ?? "";
const setSource = (v: string) => fireEvent.change(source(), { target: { value: v } });
function savePreset(name: string) {
  press("Save as…");
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: name } });
  press("Save");
}
function pick(text: string) {
  const opt = within(select()).getAllByRole("option").find((o) => o.textContent?.startsWith(text));
  if (!opt) throw new Error(`no option ${text}`);
  fireEvent.change(select(), { target: { value: (opt as HTMLOptionElement).value } });
}
async function ready() {
  render(<HysteresisPanel />);
  await screen.findByRole("region", { name: "Hysteresis presets" });
}
async function runBatch() {
  fireEvent.click(screen.getByRole("button", { name: /^Batch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run Hysteresis comparison batch" }));
  await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  expect(register).toHaveBeenCalledOnce();
}

describe("Hysteresis preset bar", () => {
  it("saves the trend axis, changes it, Applies: it returns and the batch result carries it", async () => {
    await ready();
    setSource("metadata:temperature");
    fireEvent.change(label(), { target: { value: "T sweep" } });
    savePreset("Temperature sweep");
    expect(status()).toBe("Saved preset 'Temperature sweep'");
    setSource("");
    pick("Temperature sweep");
    press("Apply");
    expect(status()).toContain("Applied preset 'Temperature sweep' to Hysteresis: press Run Hysteresis comparison batch to run it");
    expect(source().value).toBe("metadata:temperature");
    expect(label().value).toBe("T sweep");
    expect(unit().value).toBe("K");
    expect(register).not.toHaveBeenCalled(); // Apply runs no batch
    expect(readLastUsed("hysteresis")).toBeNull();
    await runBatch();
    expect(register.mock.calls[0][0].parameters.hysteresisTrend).toMatchObject({ label: "T sweep", unit: "K", source: "metadata:temperature" });
    cleanup();
    await ready();
    expect(within(select()).getByRole("option", { name: "Temperature sweep" })).toBeTruthy();
  });

  it("Revert restores the hand-set axis after two Applies", async () => {
    await ready();
    setSource("__manual__");
    fireEvent.change(label(), { target: { value: "Field angle" } });
    savePreset("Manual");
    setSource("metadata:temperature");
    savePreset("Temp");
    setSource("");
    pick("Manual");
    press("Apply");
    pick("Temp");
    press("Apply");
    expect(source().value).toBe("metadata:temperature");
    press("Revert");
    expect(source().value).toBe("");
    expect(screen.queryByRole("textbox", { name: "Trend axis label" })).toBeNull();
  });

  it("a source this selection lacks is skipped and named by its label; nothing changes", async () => {
    const settings = { axisSource: "metadata:ghost_field", axisLabel: "G", axisUnit: "T" };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "hysteresis", name: "Elsewhere", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    await ready();
    pick("Elsewhere");
    press("Apply");
    expect(status()).toContain("Series source skipped (series source 'Ghost Field' is not on the selected worksheets");
    expect(source().value).toBe("");
  });

  it("a preset with a bad value is listed rejected with the field named and cannot be applied", async () => {
    const settings = { axisSource: "temperature", axisLabel: "", axisUnit: "" };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "hysteresis", name: "Broken", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    await ready();
    expect(within(select()).getByRole("option", { name: /Broken — rejected: setting 'axisSource'/ })).toBeTruthy();
    pick("Broken");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by a worksheet that ran, not by Apply or an edit", async () => {
    await ready();
    setSource("metadata:temperature");
    expect(readLastUsed("hysteresis")).toBeNull();
    await runBatch();
    await waitFor(() => expect(readLastUsed("hysteresis")).not.toBeNull());
    expect(readLastUsed("hysteresis")?.settings).toEqual({ axisSource: "metadata:temperature", axisLabel: "Temperature", axisUnit: "K" });
  });

  it("every source the select offers is accepted by the adapter", async () => {
    await ready();
    const adapter = createHysteresisAdapter({ axisSource: "", axisLabel: "", axisUnit: "", candidateKeys: [], applyAxis: () => undefined });
    const offered = within(source()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(offered).toEqual(expect.arrayContaining(["", "__manual__", "metadata:temperature"]));
    for (const v of offered) {
      expect(adapter.parse({ axisSource: v, axisLabel: v === "" ? "" : "x", axisUnit: "" }), v).not.toHaveProperty("error");
    }
  });
});
