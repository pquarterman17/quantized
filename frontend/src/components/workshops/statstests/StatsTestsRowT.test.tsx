// Statistical tests: row-wise t-tests in the panel. The variance model is an
// explicit, labelled choice (Welch by default, Student as Origin's row-wise
// test), the request carries one row per worksheet row, and "Add as worksheet"
// commits a linked output once.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));

const src: Dataset = {
  id: "s1", name: "plate",
  data: {
    time: [1, 2, 3],
    values: [[1, 2, 5, 6], [2, 3, 6, 8], [3, 3, 9, 9]],
    labels: ["a1", "a2", "b1", "b2"], units: ["", "", "", ""], metadata: { x_column_name: "well" },
  },
};

const row = (i: number, p: number) => ({ row: i, n1: 2, n2: 2, mean1: 1, mean2: 5, diff: -4, se: 1, t: -4, df: 2, p, ci_low: -8, ci_high: 0, status: "ok" });
const result = (variance: "pooled" | "welch") => ({
  id: "row-t-tests",
  data: {
    design: "two-sample", variance, mu: 0, alpha: 0.05, alternative: "two-sided", n_rows: 3, n_tested: 3,
    method: `Row-wise two-sample t-test (${variance})`, rows: [row(0, 0.05), row(1, 0.2), row(2, 0.5)],
  },
});

const state = () => useApp.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [src], activeId: "s1", status: "", analysisResults: [], staleDatasets: [], history: [], future: [], recalcMode: "manual" });
  useStatsTestsStore.setState({ open: true, request: null });
});

function pickRowT(): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: Array.from(select.options).find((o) => /Row-wise t-tests/.test(o.text))!.value } });
}

function pickGroups(): void {
  // the default picks put the first two numeric columns in group A already
  const a = within(screen.getByRole("group", { name: "Group A columns" }));
  const b = within(screen.getByRole("group", { name: "Group B columns" }));
  for (const name of ["a1", "a2"]) if (!(a.getByLabelText(name) as HTMLInputElement).checked) fireEvent.click(a.getByLabelText(name));
  fireEvent.click(b.getByLabelText("b1"));
  fireEvent.click(b.getByLabelText("b2"));
}

describe("Row-wise t-tests in the Statistical tests panel", () => {
  it("offers both variance models, labelled, with Welch the default", () => {
    render(<StatsTestsPanel />);
    pickRowT();
    const variance = screen.getByLabelText("Variance model") as HTMLSelectElement;
    expect(variance.value).toBe("welch");
    expect(Array.from(variance.options).map((o) => [o.value, o.text])).toEqual([
      ["pooled", "Student (pooled variance; Origin's row-wise default)"],
      ["welch", "Welch (unequal variances)"],
    ]);
    fireEvent.change(screen.getByLabelText("Design"), { target: { value: "one-sample" } });
    expect(screen.queryByLabelText("Variance model")).toBeNull();
    expect(screen.queryByRole("group", { name: "Group B columns" })).toBeNull();
  });

  it("sends one row per worksheet row with the chosen variance model", async () => {
    runMock.mockResolvedValue(result("pooled"));
    render(<StatsTestsPanel />);
    pickRowT();
    pickGroups();
    fireEvent.change(screen.getByLabelText("Variance model"), { target: { value: "pooled" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/pooled\): 3 of 3 rows tested/)).toBeInTheDocument();
    const body = (runMock.mock.calls[0][0] as { body: { a: number[][]; b: number[][]; variance: string } }).body;
    expect(body.variance).toBe("pooled");
    expect(body.a).toEqual([[1, 2], [2, 3], [3, 3]]);
    expect(body.b).toEqual([[5, 6], [6, 8], [9, 9]]);
  });

  it("writes nothing until clicked, then one linked worksheet; a repeat adds nothing", async () => {
    runMock.mockResolvedValue(result("welch"));
    render(<StatsTestsPanel />);
    pickRowT();
    pickGroups();
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    const add = await screen.findByRole("button", { name: "Add as worksheet" });
    expect(state().datasets).toHaveLength(1);
    fireEvent.click(add);
    expect(state().datasets).toHaveLength(2);
    const out = state().datasets[1]!;
    expect(out.data.time).toEqual([1, 2, 3]);
    expect(out.data.labels).toContain("p");
    expect(out.data.values.map((r) => r[out.data.labels.indexOf("p")])).toEqual([0.05, 0.2, 0.5]);
    const linked = state().analysisResults.find((r) => r.producer.id === "row-t-tests")!;
    expect(linked.sources[0]!.datasetId).toBe("s1");
    fireEvent.click(screen.getByRole("button", { name: "Add as worksheet" }));
    expect(state().datasets).toHaveLength(2);
  });

  it("names each result row by its true source row when rows are excluded", async () => {
    // rows 1 and 3 (1-based) are excluded: the analysis view keeps source rows 2 and 4
    const wide: Dataset = {
      ...src,
      data: { ...src.data, time: [1, 2, 3, 4], values: [[1, 2, 5, 6], [2, 3, 6, 8], [3, 3, 9, 9], [4, 5, 7, 7]] },
      excludedRows: [0, 2],
    };
    useApp.setState({ datasets: [wide] });
    runMock.mockImplementation(async (req: { body: { a: number[][] } }) => ({
      id: "row-t-tests",
      data: { ...result("welch").data, n_rows: req.body.a.length, n_tested: req.body.a.length, rows: req.body.a.map((_, i) => row(i, 0.1 * (i + 1))) },
    }));
    render(<StatsTestsPanel />);
    pickRowT();
    pickGroups();
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add as worksheet" }));
    const body = (runMock.mock.calls[0][0] as { body: { a: number[][] } }).body;
    expect(body.a).toEqual([[2, 3], [4, 5]]); // only the kept source rows were tested
    const saved = state().analysisResults.find((r) => r.producer.id === "statistical-test")!;
    expect(saved.tables[0]!.columns[0]).toBe("source row");
    expect(saved.tables[0]!.rows.map((r) => r[0])).toEqual([2, 4]);
    const out = state().datasets[1]!;
    expect(out.data.labels[0]).toBe("source row");
    expect(out.data.values.map((r) => r[0])).toEqual([2, 4]);
    expect(out.data.time).toEqual([2, 4]); // the X column of the same source rows
  });
});
