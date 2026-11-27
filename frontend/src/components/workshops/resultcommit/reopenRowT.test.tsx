// "Open in Statistical tests" for a committed row-wise t-test worksheet: the
// recorded design, variance model, null value, adjustment, alpha, alternative and
// both column groups come back EXACTLY through the real store and panel; Replace
// commits into the old output. An old record, a deleted source, a moved column and
// a partial record all fail closed (nothing seeded, Replace off, the reason shown).

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResultValue } from "../../../lib/analysisResult";
import { planReopen } from "../../../lib/committedOutputReopen";
import type { Dataset } from "../../../lib/types";
import { rowTSeed } from "../../../lib/rowTReopenSeed";
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

const src = (labels: string[]): Dataset => ({
  id: "s1", name: "plate",
  data: {
    time: [1, 2, 3],
    values: [[1, 2, 5, 6], [2, 3, 6, 8], [3, 3, 9, 9]],
    labels, units: ["", "", "", ""], metadata: { x_column_name: "well" },
  },
});
const LABELS = ["a1", "a2", "b1", "b2"];

const row = (i: number, p: number) => ({ row: i, n1: 2, n2: 2, mean1: 1, mean2: 5, diff: -4, se: 1, t: -4, df: 2, p, p_adjusted: p, ci_low: -8, ci_high: 0, status: "ok" });
const answer = (mu: number) => ({
  id: "row-t-tests",
  data: {
    design: "two-sample", variance: "pooled", mu, alpha: 0.01, alternative: "greater", n_rows: 3, n_tested: 3,
    method: "Row-wise two-sample t-test (pooled)", rows: [row(0, 0.05), row(1, 0.2), row(2, 0.5)],
  },
});

const state = () => useApp.getState();
const results = () => state().analysisResults;
const session = () => useToolReopen.getState().sessions["row-t-tests"]!;
const rowResult = () => results().find((r) => r.producer.id === "row-t-tests")!;
const field = (name: string) => screen.getByLabelText(name) as HTMLSelectElement | HTMLInputElement;
const group = (name: string) => within(screen.getByRole("group", { name }));
const ticked = (name: string) => Array.from(screen.getByRole("group", { name }).querySelectorAll("input")).filter((i) => i.checked)
  .map((i) => i.closest("label")?.textContent);

/** Everything the panel shows for a row-wise test. */
function shown(): Record<string, unknown> {
  return {
    test: (field("Test") as HTMLSelectElement).selectedOptions[0]!.text,
    design: field("Design").value,
    variance: screen.queryByLabelText("Variance model") ? field("Variance model").value : null,
    mu: field("Null value").value, adjust: field("P-value adjustment").value, alpha: field("alpha").value,
    alternative: field("Alternative").value, groupA: ticked("Group A columns"),
    groupB: screen.queryByRole("group", { name: "Group B columns" }) ? ticked("Group B columns") : [],
  };
}

/** Run on non-default settings and add the worksheet. */
async function commitOnce(): Promise<void> {
  runMock.mockResolvedValue(answer(0.5));
  render(<StatsTestsPanel />);
  const select = field("Test") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: Array.from(select.options).find((o) => /Row-wise t-tests/.test(o.text))!.value } });
  for (const name of ["a1", "a2"]) if (!(group("Group A columns").getByLabelText(name) as HTMLInputElement).checked) fireEvent.click(group("Group A columns").getByLabelText(name));
  fireEvent.click(group("Group B columns").getByLabelText("b1"));
  fireEvent.click(group("Group B columns").getByLabelText("b2"));
  fireEvent.change(field("Variance model"), { target: { value: "pooled" } });
  fireEvent.change(field("P-value adjustment"), { target: { value: "holm" } });
  fireEvent.change(field("Alternative"), { target: { value: "greater" } });
  fireEvent.change(field("alpha"), { target: { value: "0.01" } });
  fireEvent.blur(field("alpha"));
  fireEvent.change(field("Null value"), { target: { value: "0.5" } });
  fireEvent.blur(field("Null value"));
  fireEvent.click(screen.getByRole("button", { name: "Run test" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add as worksheet" }));
  expect(results().filter((r) => r.producer.id === "row-t-tests")).toHaveLength(1);
  cleanup();
  useStatsTestsStore.setState({ open: false, request: null });
}

const RECORDED = {
  test: "Row-wise t-tests", design: "two-sample", variance: "pooled", mu: "0.5", adjust: "holm", alpha: "0.01", alternative: "greater",
  groupA: ["a1", "a2"], groupB: ["b1", "b2"],
};

beforeEach(() => {
  vi.clearAllMocks();
  useToolReopen.setState({ sessions: {} });
  useStatsTestsStore.setState({ open: false, request: null });
  useApp.setState({
    datasets: [src(LABELS)], activeId: "s1", status: "", analysisResults: [], staleDatasets: [], history: [], future: [],
    recalcMode: "manual", macroRecording: false, macroSteps: [],
  });
});

describe("Open in Statistical tests (row-wise t-test worksheet)", () => {
  it("is offered for the committed worksheet and names the tool", async () => {
    await commitOnce();
    const plan = planReopen(rowResult(), state().datasets);
    expect(plan).toMatchObject({ ok: true, label: "Open in Statistical tests", tool: "row-t-tests", sourceId: "s1" });
  });

  it("restores the exact recorded settings and both groups, with Replace preselected", async () => {
    await commitOnce();
    act(() => { expect(openCommittedResultInTool(rowResult().id)).toBe(true); });
    expect(useStatsTestsStore.getState().open).toBe(true);
    render(<StatsTestsPanel />);
    expect(shown()).toEqual(RECORDED);
    expect(session().mode).toBe("replace");
    expect(screen.getByText(/Opened from the result/)).toBeInTheDocument();
  });

  it("round-trips the other designs and models (one-sample, paired, one-sided less)", async () => {
    await commitOnce();
    const old = rowResult();
    const rec = old.parameters!["settings"] as Record<string, AnalysisResultValue>;
    const variants: [Record<string, AnalysisResultValue>, Record<string, unknown>][] = [
      [{ design: "one-sample", groupB: [], variance: "welch", alternative: "less", adjust: "bh", mu: -2.25, alpha: 0.1 },
        { design: "one-sample", variance: null, mu: "-2.25", adjust: "bh", alpha: "0.1", alternative: "less", groupA: ["a1", "a2"], groupB: [] }],
      [{ design: "paired", groupA: [0, 1], groupB: [2, 3], variance: "welch", adjust: "bonferroni" },
        { design: "paired", variance: null, adjust: "bonferroni", groupA: ["a1", "a2"], groupB: ["b1", "b2"] }],
    ];
    for (const [patch, expected] of variants) {
      cleanup();
      useToolReopen.setState({ sessions: {} });
      useStatsTestsStore.setState({ open: false, request: null });
      const edited = { ...old, parameters: { ...old.parameters, settings: { ...rec, ...patch } } };
      useApp.setState({ analysisResults: [edited] });
      act(() => { expect(openCommittedResultInTool(old.id)).toBe(true); });
      render(<StatsTestsPanel />);
      expect(shown()).toMatchObject(expected);
    }
  });

  it("a record without the adjustment (saved before it existed) reads as None", async () => {
    await commitOnce();
    const old = rowResult();
    const { adjust: _a, ...rest } = old.parameters!["settings"] as Record<string, AnalysisResultValue>;
    expect(rowTSeed({ ...rest })?.rowt.adjust).toBe("none");
    expect(rowTSeed({ ...rest, adjust: "nope" })).toBeNull();
  });

  it("a partial or invalid record is not seeded", () => {
    const ok = { testId: "row-t-tests", design: "two-sample", variance: "welch", mu: 0, adjust: "none", alpha: 0.05, alternative: "two-sided", groupA: [0], groupB: [1] };
    expect(rowTSeed(ok)).not.toBeNull();
    for (const bad of [{ alpha: 0 }, { alpha: 1 }, { alternative: "both" }, { design: "x" }, { variance: "x" }, { mu: "0" }, { groupA: [-1] }, { groupB: [1.5] }, { groupA: undefined }, { testId: "t-test" }]) {
      expect(rowTSeed({ ...ok, ...bad } as never)).toBeNull();
    }
  });

  it("a result without recorded picks opens WITHOUT settings and cannot replace", async () => {
    await commitOnce();
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => {
        if (r.producer.id !== "row-t-tests") return r;
        const { extra: _gone, ...reopen } = r.parameters!["reopen"] as Record<string, unknown>;
        return { ...r, parameters: { ...r.parameters, reopen: reopen as AnalysisResultValue } };
      }),
    }));
    act(() => { expect(openCommittedResultInTool(rowResult().id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().mode).toBe("new");
    expect(useStatsTestsStore.getState().request).toBeNull();
  });

  it("a deleted source opens WITHOUT settings and cannot replace", async () => {
    await commitOnce();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "s1") })));
    act(() => { expect(openCommittedResultInTool(rowResult().id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().notice).toMatch(/no longer exists/);
    expect(useStatsTestsStore.getState().request).toBeNull();
  });

  it("a moved column is NOT guessed: no settings, the reason shown, Replace off", async () => {
    await commitOnce();
    act(() => useApp.setState((s) => ({
      datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data, labels: ["a1", "dose", "b1", "b2"] } })),
    })));
    act(() => { expect(openCommittedResultInTool(rowResult().id)).toBe(true); });
    expect(session().seed).toBeNull();
    expect(session().notice).toContain("“a2” is no longer at its place in “plate”");
    expect(session().mode).toBe("new");
    expect(useStatsTestsStore.getState().request).toBeNull();
  });
});

describe("Row-wise reopen then re-run", () => {
  it("Replace commits into the old worksheet (one result, same output)", async () => {
    await commitOnce();
    const old = rowResult();
    const sheets = state().datasets.length;
    act(() => { openCommittedResultInTool(old.id); });
    render(<StatsTestsPanel />);
    runMock.mockResolvedValue({ ...answer(0.5), data: { ...answer(0.5).data, rows: [row(0, 0.01), row(1, 0.02), row(2, 0.03)] } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add as worksheet" }));
    expect(state().datasets).toHaveLength(sheets);
    expect(results().filter((r) => r.producer.id === "row-t-tests").map((r) => r.id)).toEqual([old.id]);
    expect(rowResult().outputs[0]!.datasetId).toBe(old.outputs[0]!.datasetId);
    // The re-run used the restored settings (pooled, holm, greater, alpha 0.01, null value 0.5).
    const body = (runMock.mock.calls.at(-1)![0] as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({ design: "two-sample", variance: "pooled", adjust: "holm", alternative: "greater", alpha: 0.01, mu: 0.5 });
  });
});
