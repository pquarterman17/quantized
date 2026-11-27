// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P4), through
// the real Distribution panel, hook, store and storage: save, change, Apply
// restores the settings and the interval request carries them, Revert works,
// last used is written by Save result only, a missing column is skipped and
// named, and every fit choice the panel offers is accepted.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsConfidenceIntervals } from "../../../lib/api/statsCi";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import { reportEmit, statsFitDistributions, statsHistogram, statsShapiro } from "../../../lib/api";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useApp } from "../../../store/useApp";
import DistributionPanel from "./DistributionPanel";
import { createDistributionAdapter } from "./presetAdapter";

vi.mock("../../../lib/api", () => ({ statsHistogram: vi.fn(), statsShapiro: vi.fn(), statsFitDistributions: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/statsCi", () => ({ statsConfidenceIntervals: vi.fn(() => new Promise(() => undefined)) }));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[10], [20], [30], [40], [50], [60]],
  labels: ["v"],
  units: [""],
  metadata: { x_column_name: "T" },
};
const HIST = { counts: [2, 2, 2], centers: [15, 35, 55], edges: [10, 30, 50, 70], n_bins: 3, n: 6 };
const DESC = { N: 6, mean: 35, median: 35, std: 18.7, min: 10, max: 60, q1: 20, q3: 50 };
const FITS = {
  fits: [{ dist: "normal", params: { mu: 35, sigma: 18.7 }, loglike: -10, aic: 24, n_params: 2, ks_d: 0.1, ks_p: 0.9, ks_p_approximate: true, N: 6 }],
  best: "normal",
  skipped: [],
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue(HIST);
  vi.mocked(statsDescriptive).mockResolvedValue(DESC);
  vi.mocked(statsShapiro).mockResolvedValue({ W: 0.95, p: 0.7, N: 6 });
  vi.mocked(statsFitDistributions).mockResolvedValue(FITS);
  vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", selection: null, distributionOpen: true,
    reports: [], status: "", analysisResults: [], history: [], future: [],
  });
});

const bar = () => screen.findByRole("region", { name: "Distribution presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const fit = () => screen.getByText("Distribution fit").nextElementSibling as HTMLSelectElement;
// The input review table also says "Column": the picker is the label that sits right before a select.
const column = () => screen.getAllByText("Column").map((e) => e.nextElementSibling).find((e) => e instanceof HTMLSelectElement) as HTMLSelectElement;
const compare = () => screen.getByLabelText("Compare distributions");
const bootstrap = () => screen.getByLabelText("Bootstrap intervals");
const level = () => screen.getByLabelText("Confidence level") as HTMLInputElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Distribution presets" })).getByRole("status").textContent ?? "";
function setLevel(v: string) {
  fireEvent.change(level(), { target: { value: v } });
  fireEvent.blur(level());
}
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
  render(<DistributionPanel />);
  await bar();
  await screen.findByLabelText("histogram");
  await screen.findByLabelText("Confidence level");
}

describe("Distribution preset bar", () => {
  it("saves, changes, Applies: the settings return and the interval request carries them", async () => {
    await ready();
    fireEvent.change(fit(), { target: { value: "weibull" } });
    fireEvent.click(compare());
    setLevel("99");
    fireEvent.click(bootstrap());
    savePreset("Weibull 99");
    expect(status()).toBe("Saved preset 'Weibull 99'");
    fireEvent.click(compare());
    fireEvent.change(fit(), { target: { value: "none" } });
    setLevel("80");
    fireEvent.click(bootstrap());
    fireEvent.change(column(), { target: { value: "-1" } });
    pick("Weibull 99");
    press("Apply");
    expect(status()).toContain("Applied preset 'Weibull 99' to Distribution: the result updates on its own; press Save result to keep it");
    expect(fit().value).toBe("weibull");
    expect(compare()).toHaveAttribute("aria-checked", "true");
    await screen.findByLabelText("Bootstrap intervals");
    expect(bootstrap()).toHaveAttribute("aria-checked", "true");
    expect(level().value).toBe("99");
    expect(column().value).toBe("0"); // the saved column, by label
    await waitFor(() => expect(vi.mocked(statsConfidenceIntervals).mock.calls.at(-1)?.slice(1, 3)).toEqual([0.99, true]));
    // Apply wrote no last used.
    expect(readLastUsed("distribution")).toBeNull();
    // Remounted: still listed.
    cleanup();
    await ready();
    expect(within(select()).getByRole("option", { name: "Weibull 99" })).toBeTruthy();
  });

  it("Revert restores the hand-set values after two Applies", async () => {
    await ready();
    fireEvent.change(fit(), { target: { value: "lognormal" } });
    setLevel("90");
    savePreset("P-logn");
    fireEvent.change(fit(), { target: { value: "weibull" } });
    setLevel("97");
    savePreset("P-weib");
    fireEvent.change(fit(), { target: { value: "gamma" } });
    setLevel("60");
    pick("P-logn");
    press("Apply");
    pick("P-weib");
    press("Apply");
    expect(fit().value).toBe("weibull");
    press("Revert");
    expect(fit().value).toBe("gamma");
    expect(level().value).toBe("60");
  });

  it("a column the sheet lacks is skipped and named by its label, and the rest applies", async () => {
    const settings = { column: "Pressure", fitDist: "gamma", compareOpen: false, percentile: 75, ciPercent: 90, ciBootstrap: false };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "distribution", name: "Other sheet", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    await ready();
    pick("Other sheet");
    press("Apply");
    expect(status()).toContain("column skipped (column 'Pressure' is not on this sheet)");
    expect(status()).not.toContain("setting 'column'");
    expect(fit().value).toBe("gamma");
    expect(level().value).toBe("90");
    expect(column().value).toBe("0");
  });

  it("a preset with a bad value is listed rejected with the field named and cannot be applied", async () => {
    const settings = { column: "v", fitDist: "none", compareOpen: false, percentile: 150, ciPercent: 95, ciBootstrap: false };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "distribution", name: "Broken", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    await ready();
    expect(within(select()).getByRole("option", { name: /Broken — rejected: setting 'percentile'/ })).toBeTruthy();
    pick("Broken");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by Save result, not by Apply or by edits", async () => {
    await ready();
    setLevel("92");
    expect(readLastUsed("distribution")).toBeNull();
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(readLastUsed("distribution")).not.toBeNull());
    expect(readLastUsed("distribution")?.settings).toEqual({ column: "v", fitDist: "none", compareOpen: false, percentile: 90, ciPercent: 92, ciBootstrap: false });
  });

  it("every fit choice the panel offers is accepted by the adapter", async () => {
    await ready();
    const adapter = createDistributionAdapter({
      columns: [{ index: 0, label: "v" }], col: 0, setCol: () => undefined, byCol: null, fitDist: "none", setFitDist: () => undefined,
      compareOpen: false, setCompareOpen: () => undefined, percentileInput: 90, setPercentileInput: () => undefined,
      ci: { percent: 95, setPercent: () => undefined, bootstrap: false, setBootstrap: () => undefined },
    });
    const offered = within(fit()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(offered.length).toBeGreaterThan(5);
    for (const f of offered) expect(adapter.parse({ ...adapter.defaults(), fitDist: f }), f).not.toHaveProperty("error");
  });
});
