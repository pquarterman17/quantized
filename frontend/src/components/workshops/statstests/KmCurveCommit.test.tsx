// Statistical tests: Kaplan-Meier "Add curve as worksheet / Add as plot" on the
// shared result-commit contract. The curve is the Freireich 6-MP arm (Kleinbaum
// & Klein; tests/test_calc_stats_survival_textbook.py): S(6)=0.857, S(7)=0.807,
// S(10)=0.753, S(13)=0.690, S(16)=0.627, S(22)=0.538, S(23)=0.448.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KaplanMeierCurve } from "../../../lib/api/statsTestsSurvival";
import { describeResult } from "../../../lib/statsTestsResults";
import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));

const MP6: KaplanMeierCurve = {
  times: [0, 6, 7, 10, 13, 16, 22, 23],
  survival: [1, 0.857, 0.807, 0.753, 0.69, 0.627, 0.538, 0.448],
  ciLow: [1, 0.620, 0.563, 0.509, 0.432, 0.368, 0.268, 0.188],
  ciHigh: [1, 0.952, 0.923, 0.889, 0.833, 0.785, 0.713, 0.633],
  atRisk: [21, 21, 17, 15, 12, 11, 7, 6],
  events: [0, 3, 1, 1, 1, 1, 1, 1],
  medianSurvival: 23, medianCiLow: 13, medianCiHigh: null, N: 21,
};
const PLACEBO: KaplanMeierCurve = {
  times: [0, 1, 2], survival: [1, 0.9, 0.8], ciLow: [1, 0.7, null], ciHigh: [1, 0.98, 0.95],
  atRisk: [21, 21, 19], events: [0, 2, 2], medianSurvival: 8, medianCiLow: 4, medianCiHigh: 12, N: 21,
};

const src: Dataset = {
  id: "s1", name: "trial",
  data: {
    time: [1, 2, 3, 4, 5, 6],
    values: [[5, 1, 0], [6, 0, 0], [7, 1, 0], [8, 1, 1], [9, 0, 1], [10, 1, 1]],
    labels: ["weeks", "relapse", "arm"], units: ["wk", "", ""], metadata: {},
    cat_levels: { 2: ["6-MP", "placebo"] },
  },
};

const state = () => useApp.getState();
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

async function runKm(grouped: boolean): Promise<void> {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => /Kaplan-Meier/.test(o.text))!;
  fireEvent.change(select, { target: { value: option.value } });
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Event (0/1)"), { target: { value: "1" } });
  if (grouped) {
    fireEvent.click(screen.getByLabelText("One curve per group"));
    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "2" } });
  }
  click("Run test");
  await screen.findByText(/Kaplan-Meier/, { selector: "div" });
  await screen.findByRole("button", { name: "Add curve as worksheet" });
}

function changeSource(): void {
  act(() => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "s1" ? { ...d, data: { ...d.data, values: d.data.values.map((r, i) => i === 0 ? [50, 1, 0] : r) } } : d) }));
    useApp.getState().touchDataset("s1");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [src], activeId: "s1", status: "", analysisResults: [], staleDatasets: [], history: [], future: [],
    macroRecording: true, macroSteps: [], recalcMode: "manual",
  });
  useStatsTestsStore.setState({ open: true, request: null });
});

describe("Kaplan-Meier curve as a worksheet", () => {
  it("writes nothing until clicked, then the worksheet equals the KM table (Freireich 6-MP)", async () => {
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve: MP6 }] } });
    render(<StatsTestsPanel />);
    await runKm(false);
    expect(state().datasets).toHaveLength(1); // off by default
    click("Add curve as worksheet");
    expect(state().datasets).toHaveLength(2);
    const out = state().datasets[1]!;
    const table = describeResult({ id: "kaplan-meier", data: { groups: [{ label: "", curve: MP6 }] } }, ["weeks", "relapse"], 0.05).tables[1]!;
    expect(out.data.labels).toEqual(["S(t)", "95% CI low", "95% CI high", "at risk", "events"]);
    expect(out.data.metadata).toMatchObject({ x_column_name: "weeks", x_unit: "wk" });
    table.rows.forEach((row, i) => {
      // table columns: time, at risk, events, S(t), CI low, CI high
      expect(out.data.time[i]).toBe(row[0]);
      expect(out.data.values[i]).toEqual([row[3], row[4], row[5], row[1], row[2]]);
    });
    expect(out.data.values[7]![0]).toBe(0.448);
    // The source plot was not touched (the worksheet landed quietly).
    expect(state().activeId).toBe("s1");
  });

  it("is one undo step with its Library result, linked to the source", async () => {
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve: MP6 }] } });
    render(<StatsTestsPanel />);
    await runKm(false);
    const before = state().history.length;
    click("Add curve as worksheet");
    expect(state().history).toHaveLength(before + 1);
    const result = state().analysisResults.find((r) => r.producer.id === "km-curve")!;
    expect(result.sources[0]!.datasetId).toBe("s1");
    expect(result.outputs[0]!.datasetId).toBe(state().datasets[1]!.id);
    act(() => state().undo());
    expect(state().datasets).toHaveLength(1);
    expect(state().analysisResults.some((r) => r.producer.id === "km-curve")).toBe(false);
  });

  it("a repeat adds nothing and says so", async () => {
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve: MP6 }] } });
    render(<StatsTestsPanel />);
    await runKm(false);
    click("Add curve as worksheet");
    const sheets = state().datasets.length, results = state().analysisResults.length;
    const btn = screen.getByRole("button", { name: "Add curve as worksheet" });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/Already added as “Kaplan-Meier curve — trial”/);
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("button", { name: "Add as plot" }));
    expect(state().datasets).toHaveLength(sheets);
    expect(state().analysisResults).toHaveLength(results);
  });

  it("goes out of date when the source changes, and a stale result refuses with the reason", async () => {
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve: MP6 }] } });
    render(<StatsTestsPanel />);
    await runKm(false);
    click("Add curve as worksheet");
    const outputId = state().datasets[1]!.id;
    changeSource();
    expect(state().staleDatasets).toContain(outputId);
    const btn = screen.getByRole("button", { name: "Add curve as worksheet" });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/Out of date/);
    expect(screen.getByRole("button", { name: "Add as plot" })).toBeDisabled();
    fireEvent.click(btn);
    expect(state().datasets).toHaveLength(2);
  });

  it("offers nothing without a current Kaplan-Meier result", async () => {
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve: MP6 }] } });
    render(<StatsTestsPanel />);
    expect(screen.queryByRole("button", { name: "Add curve as worksheet" })).toBeNull();
    await runKm(false);
    fireEvent.change(screen.getByLabelText("Event (0/1)"), { target: { value: "2" } }); // a setting change drops the result
    expect(screen.queryByRole("button", { name: "Add curve as worksheet" })).toBeNull();
    expect(state().datasets).toHaveLength(1);
  });

  it("one curve per group stacks the groups with a group column", async () => {
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "6-MP", curve: MP6 }, { label: "placebo", curve: PLACEBO }] } });
    render(<StatsTestsPanel />);
    await runKm(true);
    click("Add curve as worksheet");
    const out = state().datasets[1]!;
    expect(out.data.labels).toEqual(["group", "S(t)", "95% CI low", "95% CI high", "at risk", "events"]);
    expect(out.data.cat_levels).toEqual({ 0: ["6-MP", "placebo"] });
    expect(out.data.time).toEqual([...MP6.times, ...PLACEBO.times]);
    expect(out.data.values.map((r) => r[0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
    expect(out.data.values[10]![2]).toBeNaN(); // a CI bound the backend left out stays missing
    expect(out.data.values[8]).toEqual([1, 1, 1, 1, 21, 0]);
  });

  it("Add as plot writes the same worksheet and draws S(t) as a step in its own window", async () => {
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve: MP6 }] } });
    render(<StatsTestsPanel />);
    await runKm(false);
    click("Add as plot");
    expect(state().datasets).toHaveLength(2);
    expect(state().activeId).toBe(state().datasets[1]!.id);
    expect(state().yKeys).toEqual([0, 1, 2]);
    expect(state().seriesStyles[0]).toMatchObject({ step: "post" });
    expect(state().seriesStyles[1]).toMatchObject({ step: "post", line: "dashed" });
  });

  it("grouped Add as plot splits S(t) by the group column", async () => {
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "6-MP", curve: MP6 }, { label: "placebo", curve: PLACEBO }] } });
    render(<StatsTestsPanel />);
    await runKm(true);
    click("Add as plot");
    expect(state().yKeys).toEqual([1]);
    expect(state().groupKey).toBe(0);
    expect(state().seriesStyles[1]).toMatchObject({ step: "post" });
  });
});
