// "Open in Statistical tests" for a Kaplan-Meier curve (OPEN_ITEMS row 12): the
// recorded test, time / event / group columns and grouping come back exactly; a
// result saved before they were recorded, a deleted source and a changed column
// set all fail closed (nothing seeded, Replace off, the reason shown).

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResultValue } from "../../../lib/analysisResult";
import { planReopen } from "../../../lib/committedOutputReopen";
import type { KaplanMeierCurve } from "../../../lib/api/statsTestsSurvival";
import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "../statstests/StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));

const CURVE: KaplanMeierCurve = {
  times: [0, 6, 7], survival: [1, 0.8, 0.5], ciLow: [1, 0.6, 0.2], ciHigh: [1, 0.9, 0.8],
  atRisk: [6, 6, 4], events: [0, 1, 2], medianSurvival: 7, medianCiLow: 6, medianCiHigh: null, N: 6,
};

const src = (labels: string[]): Dataset => ({
  id: "s1", name: "trial",
  data: {
    time: [1, 2, 3, 4, 5, 6],
    values: [[5, 1, 0], [6, 0, 0], [7, 1, 0], [8, 1, 1], [9, 0, 1], [10, 1, 1]],
    labels, units: ["wk", "", ""], metadata: {},
  },
});
const LABELS = ["weeks", "arm", "relapse"];

const state = () => useApp.getState();
const results = () => state().analysisResults;
const session = () => useToolReopen.getState().sessions["km-curve"]!;
const field = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

/** What the open panel shows for the Kaplan-Meier inputs. */
function shown(): Record<string, unknown> {
  return {
    test: field("Test").value, time: field("Time").value, event: field("Event (0/1)").value,
    grouped: (screen.getByLabelText("One curve per group") as HTMLInputElement).checked,
    ...((screen.getByLabelText("One curve per group") as HTMLInputElement).checked ? { groupBy: field("Group by").value } : {}),
  };
}

/** Run Kaplan-Meier on non-default columns (time 0, event 2, grouped by 1) and add the curve. */
async function commitOnce(): Promise<void> {
  runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve: CURVE }] } });
  render(<StatsTestsPanel />);
  const select = field("Test");
  fireEvent.change(select, { target: { value: Array.from(select.options).find((o) => /Kaplan-Meier/.test(o.text))!.value } });
  fireEvent.change(field("Time"), { target: { value: "0" } });
  fireEvent.change(field("Event (0/1)"), { target: { value: "2" } });
  fireEvent.click(screen.getByLabelText("One curve per group"));
  fireEvent.change(field("Group by"), { target: { value: "1" } });
  click("Run test");
  await screen.findByRole("button", { name: "Add curve as worksheet" });
  click("Add curve as worksheet");
  expect(results().filter((r) => r.producer.id === "km-curve")).toHaveLength(1);
  cleanup();
  useStatsTestsStore.setState({ open: false, request: null });
}

const RECORDED = { test: "kaplan-meier", time: "0", event: "2", grouped: true, groupBy: "1" };
const kmResult = () => results().find((r) => r.producer.id === "km-curve")!;

beforeEach(() => {
  vi.clearAllMocks();
  useToolReopen.setState({ sessions: {} });
  useStatsTestsStore.setState({ open: false, request: null });
  useApp.setState({
    datasets: [src(LABELS)], activeId: "s1", status: "", analysisResults: [], staleDatasets: [], history: [], future: [],
    recalcMode: "manual", macroRecording: false, macroSteps: [],
  });
});

describe("Open in Statistical tests (Kaplan-Meier curve)", () => {
  it("restores the exact recorded test, columns and grouping, with Replace preselected", async () => {
    await commitOnce();
    act(() => { expect(openCommittedResultInTool(kmResult().id)).toBe(true); });
    expect(useStatsTestsStore.getState().open).toBe(true);
    render(<StatsTestsPanel />);
    expect(shown()).toEqual(RECORDED);
    expect(session().mode).toBe("replace");
    expect(screen.getByText(/Opened from the result/)).toBeInTheDocument();
  });

  it("an old result without the recorded settings refuses with the existing reason", async () => {
    await commitOnce();
    const old = { ...kmResult(), producer: { ...kmResult().producer, version: 1 } };
    const plan = planReopen(old, state().datasets);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toMatch(/saved before its settings were recorded, so it cannot be reopened/);
    useApp.setState({ analysisResults: [old] });
    act(() => { expect(openCommittedResultInTool(old.id)).toBe(false); });
    expect(useStatsTestsStore.getState().open).toBe(false);
    expect(useToolReopen.getState().sessions["km-curve"]).toBeUndefined();
  });

  it("a v2 result whose column picks are missing opens WITHOUT settings and cannot replace", async () => {
    await commitOnce();
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => {
        if (r.producer.id !== "km-curve") return r;
        const { extra: _gone, ...reopen } = r.parameters!["reopen"] as Record<string, unknown>;
        return { ...r, parameters: { ...r.parameters, reopen: reopen as AnalysisResultValue } };
      }),
    }));
    act(() => { expect(openCommittedResultInTool(kmResult().id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().notice).toContain("were not recorded");
    expect(session().mode).toBe("new");
    expect(useStatsTestsStore.getState().request).toBeNull();
  });

  it("a deleted source opens WITHOUT settings and cannot replace", async () => {
    await commitOnce();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "s1") })));
    act(() => { expect(openCommittedResultInTool(kmResult().id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().sourceId).toBeNull();
    expect(session().notice).toMatch(/no longer exists/);
    expect(session().mode).toBe("new");
    expect(useStatsTestsStore.getState().request).toBeNull();
  });

  it("a changed column set is NOT guessed: no settings, the reason shown, Replace off", async () => {
    await commitOnce();
    // The recorded group column (index 1, "arm") is now another column.
    act(() => useApp.setState((s) => ({
      datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data, labels: ["weeks", "dose", "relapse"] } })),
    })));
    act(() => { expect(openCommittedResultInTool(kmResult().id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().notice).toContain("“arm” is no longer at its place in “trial”");
    expect(session().replaceBlocked).toContain("“arm”");
    expect(session().mode).toBe("new");
    expect(useStatsTestsStore.getState().request).toBeNull();
    render(<StatsTestsPanel />);
    expect(field("Test").value).not.toBe("kaplan-meier"); // a plain open, not the recorded test
  });
});

describe("Kaplan-Meier reopen then re-run", () => {
  it("Replace commits into the old output (one result, same worksheet)", async () => {
    await commitOnce();
    const old = kmResult();
    const sheets = state().datasets.length;
    act(() => { openCommittedResultInTool(old.id); });
    render(<StatsTestsPanel />);
    runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve: { ...CURVE, survival: [1, 0.7, 0.4] } }] } });
    click("Run test");
    await screen.findByRole("button", { name: "Add curve as worksheet" });
    click("Add curve as worksheet");
    expect(state().datasets).toHaveLength(sheets);
    expect(results().filter((r) => r.producer.id === "km-curve").map((r) => r.id)).toEqual([old.id]);
    expect(kmResult().outputs[0]!.datasetId).toBe(old.outputs[0]!.datasetId);
  });
});
