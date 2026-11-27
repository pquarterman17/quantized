// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P4), through
// the real Statistical tests panel, hook, store and storage: save, change,
// Apply restores the test and its options and the next run's request carries
// them, Revert restores the previous state, last used is written by a
// successful run only, and every option the panel offers is accepted.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetBookTransportForTests } from "../../../lib/bookData";
import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import { DEFAULT_PARAMS, STATS_TESTS } from "../../../lib/statsTests";
import type { Dataset } from "../../../lib/types";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";
import { createStatsTestsAdapter, defaultStatsTestsSettings, type StatsTestsSettings } from "./presetAdapter";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const ds: Dataset = {
  id: "d1",
  name: "films",
  data: {
    time: [1, 2, 3, 4, 5],
    values: [[10, 20, 5], [11, 21, 6], [12, 22, 4], [13, 23, 7], [14, 24, 5]],
    labels: ["Hc", "Ms", "Mr"],
    units: ["", "", ""],
    metadata: { x_column_name: "T" },
  },
};
const SIGN = { n: 5, n_pos: 5, n_neg: 0, n_ties: 0, p: 0.0625, alternative: "less", method: "Sign test" };
const KS2 = { D: 1, p: 0.008, n1: 5, n2: 5, alternative: "less", method: "Kolmogorov-Smirnov (two-sample)" };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  resetBookTransportForTests();
  vi.clearAllMocks();
  useApp.setState({ datasets: [ds], activeId: "d1", status: "", reports: [], openReportId: null, analysisResults: [], openAnalysisResultId: null, history: [], future: [] });
  useStatsTestsStore.setState({ open: true, request: null });
});

const bar = () => screen.findByRole("region", { name: "Statistical tests presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const testSelect = () => screen.getByLabelText("Test") as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Statistical tests presets" })).getByRole("status").textContent ?? "";
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
/** A buffered number field commits on blur. */
function typeNum(label: string, value: string) {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}
const setTest = (id: string) => fireEvent.change(testSelect(), { target: { value: id } });

describe("Statistical tests preset bar", () => {
  it("saves, changes, Applies: the test and options return and the next run carries them", async () => {
    runMock.mockResolvedValue({ id: "sign-test", data: SIGN });
    render(<StatsTestsPanel />);
    await bar();
    setTest("sign-test");
    fireEvent.change(screen.getByLabelText("Alternative"), { target: { value: "less" } });
    typeNum("alpha", "0.01");
    savePreset("KS less");
    expect(status()).toBe("Saved preset 'KS less'");
    setTest("anderson");
    pick("KS less");
    press("Apply");
    expect(status()).toContain("Applied preset 'KS less' to Statistical tests: press Run test to run it");
    expect(testSelect().value).toBe("sign-test");
    expect((screen.getByLabelText("Alternative") as HTMLSelectElement).value).toBe("less");
    expect((screen.getByLabelText("alpha") as HTMLInputElement).value).toBe("0.01");
    // Apply neither ran the test nor wrote last used.
    expect(runMock).not.toHaveBeenCalled();
    expect(readLastUsed("stats-tests")).toBeNull();
    fireEvent.change(screen.getByLabelText("Second column"), { target: { value: "1" } });
    press("Run test");
    await waitFor(() => expect(screen.queryByText("running…")).toBeNull());
    expect(runMock.mock.calls.at(-1)![0]).toMatchObject({ id: "sign-test", body: { alternative: "less" } });
    // Remounted: still listed.
    cleanup();
    render(<StatsTestsPanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: "KS less" })).toBeTruthy();
  });

  it("Revert restores the hand-set test and options after two Applies", async () => {
    render(<StatsTestsPanel />);
    await bar();
    setTest("sign-test");
    fireEvent.change(screen.getByLabelText("Alternative"), { target: { value: "less" } });
    savePreset("P-less");
    fireEvent.change(screen.getByLabelText("Alternative"), { target: { value: "greater" } });
    savePreset("P-greater");
    setTest("dunnett");
    typeNum("alpha", "0.2");
    pick("P-less");
    press("Apply");
    pick("P-greater");
    press("Apply");
    expect((screen.getByLabelText("Alternative") as HTMLSelectElement).value).toBe("greater");
    press("Revert");
    expect(testSelect().value).toBe("dunnett");
    expect((screen.getByLabelText("alpha") as HTMLInputElement).value).toBe("0.2");
  });

  it("a preset with a bad nested option is listed rejected with the field named and cannot be applied", async () => {
    const settings = { ...defaultStatsTestsSettings(), more: { ...defaultStatsTestsSettings().more, posthoc: "magic" } };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "stats-tests", name: "Broken", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    render(<StatsTestsPanel />);
    await bar();
    expect(within(select()).getByRole("option", { name: /Broken — rejected: setting 'more' is not valid: setting 'posthoc'/ })).toBeTruthy();
    pick("Broken");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by a successful run, not by a failed one", async () => {
    render(<StatsTestsPanel />);
    await bar();
    setTest("ks-two-sample");
    fireEvent.change(screen.getByLabelText("Second column"), { target: { value: "1" } });
    typeNum("alpha", "0.02");
    runMock.mockRejectedValueOnce(new Error("backend down"));
    press("Run test");
    await screen.findByText("backend down");
    expect(readLastUsed("stats-tests")).toBeNull();
    runMock.mockResolvedValue({ id: "ks-two-sample", data: KS2 });
    press("Run test");
    await waitFor(() => expect(readLastUsed("stats-tests")).not.toBeNull());
    expect(readLastUsed("stats-tests")?.settings).toMatchObject({ test: "ks-two-sample", alpha: 0.02 });
  });

  it("every option the panel offers, for every test, is accepted by the adapter", async () => {
    render(<StatsTestsPanel />);
    await bar();
    const adapter = createStatsTestsAdapter({ testId: "anderson", setTestId: () => undefined, params: { ...DEFAULT_PARAMS }, setParams: () => undefined });
    const base = defaultStatsTestsSettings();
    const setPath = (s: StatsTestsSettings, label: string, test: string, value: string): StatsTestsSettings | null => {
      const num = (v: string) => (/^-?\d+$/.test(v) ? Number(v) : v);
      switch (label) {
        case "Alternative": return { ...s, alternative: value as StatsTestsSettings["alternative"] };
        case "Sums of squares": return { ...s, ssType: num(value) as 2 | 3 };
        case "Method": return test === "adjust-p" ? { ...s, adjustMethod: value as StatsTestsSettings["adjustMethod"] } : { ...s, more: { ...s.more, propMethod: value as never } };
        case "Criterion": return { ...s, criterion: value as never };
        case "Direction": return { ...s, direction: value as never };
        case "Tails": return { ...s, tails: num(value) as 1 | 2 };
        case "Expected": return { ...s, gofExpected: value as never };
        case "Design": return test === "tost-two" ? { ...s, more: { ...s.more, tostDesign: value as never } } : test === "row-t-tests" ? { ...s, rowt: { ...s.rowt, design: value as never } } : { ...s, kind: value as never };
        case "Comparison method": return { ...s, more: { ...s.more, posthoc: value as never } };
        case "Variance test": return { ...s, more: { ...s.more, variance: value as never } };
        case "Samples": return { ...s, more: { ...s.more, poissonSamples: value as never } };
        case "Limits": return { ...s, more: { ...s.more, tiSides: value as never } };
        case "Chart": return { ...s, spc: { ...s.spc, chart: value as never } };
        case "Subgroups from": return { ...s, spc: { ...s.spc, subgroupMode: value as never } };
        case "Within sigma": return { ...s, spc: { ...s.spc, sigmaMethod: value as never } };
        case "Sample sizes": return { ...s, spc: { ...s.spc, sizeMode: value as never } };
        case "Distribution": return { ...s, life: { ...s.life, distribution: value as never } };
        case "Relationship": return { ...s, life: { ...s.life, transform: value as never } };
        case "Interval method": return { ...s, life: { ...s.life, ciMethod: value as never } };
        case "Plotting positions": return { ...s, life: { ...s.life, plotting: value as never } };
        case "Adjustment": return { ...s, screenMethod: value as never };
        case "Variance model": return { ...s, rowt: { ...s.rowt, variance: value as never } };
        case "P-value adjustment": return { ...s, rowt: { ...s.rowt, adjust: value as never } };
        case "Season from": return { ...s, rowt: { ...s.rowt, seasonFrom: value as never } };
        default: return null; // a column picker: not a stored setting
      }
    };
    let checked = 0;
    for (const def of STATS_TESTS) {
      setTest(def.id);
      for (const el of Array.from(document.querySelectorAll("select[aria-label]")) as HTMLSelectElement[]) {
        const label = el.getAttribute("aria-label")!;
        if (label === "Test" || label === "Preset") continue;
        for (const o of Array.from(el.options)) {
          const next = setPath(base, label, def.id, o.value);
          if (!next) break;
          expect(adapter.parse(next), `${def.id}: ${label}=${o.value}`).not.toHaveProperty("error");
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
  });
});
