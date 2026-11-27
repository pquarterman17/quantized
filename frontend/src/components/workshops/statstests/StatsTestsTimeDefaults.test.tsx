// Statistical tests: time-first tests default to the worksheet's X column, a
// refused run shows the backend's reason inline, and the row-wise t-tests never
// offer the X column as a group member (acceptance pass 4: W3, C10).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../../../lib/statsTests";
import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));

/** trend.csv shape: time in X (distinct), one Y channel with ties. */
const trend: Dataset = {
  id: "t1", name: "trend",
  data: {
    time: [1, 3, 5, 7, 9], values: [[1], [3], [2], [5], [5]],
    labels: ["y"], units: [""], metadata: { x_column_name: "t" },
  },
};
const plate: Dataset = {
  id: "p1", name: "plate",
  data: {
    time: [1, 2, 3], values: [[1, 2, 5, 6], [2, 3, 6, 8], [3, 3, 9, 9]],
    labels: ["a1", "a2", "b1", "b2"], units: ["", "", "", ""], metadata: { x_column_name: "run" },
  },
};

const mk = { n: 5, S: 7, var_S: 1, Z: 1, p: 0.3, tau: 0.7, sen_slope: 0.4, sen_ci_low: 0, sen_ci_high: 1, sen_intercept: 0,
  n_tie_groups: 1, alpha: 0.05, significant: false, trend: "no trend", method: "Mann-Kendall" };

function load(ds: Dataset): void {
  useApp.setState({ datasets: [ds], activeId: ds.id, status: "", analysisResults: [], history: [], future: [], recalcMode: "manual" });
  useStatsTestsStore.setState({ open: true, request: null });
}

function pickTest(label: RegExp): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: Array.from(select.options).find((o) => label.test(o.text))!.value } });
}

const shown = (label: string): string => {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return select.options[select.selectedIndex].text;
};

beforeEach(() => vi.clearAllMocks());

describe("Mann-Kendall defaults", () => {
  it("reads time from the X column and the values from the first Y, and a default Run sends them that way", async () => {
    load(trend);
    runMock.mockResolvedValue({ id: "mann-kendall", data: mk });
    render(<StatsTestsPanel />);
    pickTest(/Mann-Kendall/);
    expect(shown("Time or order (x)")).toBe("t");
    expect(shown("Values (y)")).toBe("y");
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(runMock.mock.calls.length).toBe(1));
    expect(runMock.mock.calls[0][0].body).toMatchObject({ x: [1, 3, 5, 7, 9], y: [1, 3, 2, 5, 5] });
  });

  it("with two Y channels the values default to the first Y, not the second", () => {
    load({ ...trend, data: { ...trend.data, values: trend.data.values.map((r) => [...r, 9]), labels: ["y", "z"], units: ["", ""] } });
    render(<StatsTestsPanel />);
    pickTest(/Mann-Kendall/);
    expect([shown("Time or order (x)"), shown("Values (y)")]).toEqual(["t", "y"]);
  });

  it("leaving Mann-Kendall restores the generic picks for the other paired tests", () => {
    load({ ...trend, data: { ...trend.data, values: trend.data.values.map((r) => [...r, 9]), labels: ["y", "z"], units: ["", ""] } });
    render(<StatsTestsPanel />);
    pickTest(/Mann-Kendall/);
    pickTest(/Sign test/);
    expect([shown("First column"), shown("Second column")]).toEqual(["y", "z"]);
  });

  it("shows the backend's reason inline when the run is refused", async () => {
    load(trend);
    runMock.mockRejectedValue(new Error("x values must be distinct; the series is ordered by x"));
    render(<StatsTestsPanel />);
    pickTest(/Mann-Kendall/);
    fireEvent.change(screen.getByLabelText("Time or order (x)"), { target: { value: "0" } }); // y as time: ties
    fireEvent.change(screen.getByLabelText("Values (y)"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText("x values must be distinct; the series is ordered by x")).toBeInTheDocument();
  });
});

describe("Kaplan-Meier defaults", () => {
  it("a file with time in X and one 0/1 Y takes time from X", () => {
    load({ ...trend, data: { ...trend.data, values: [[1], [0], [1], [1], [0]], labels: ["event"] } });
    render(<StatsTestsPanel />);
    pickTest(/Kaplan-Meier/);
    expect([shown("Time"), shown("Event (0/1)")]).toEqual(["t", "event"]);
  });
});

describe("Row-wise t-tests and the X column", () => {
  it("offers only Y columns as group A or B members", () => {
    load(plate);
    render(<StatsTestsPanel />);
    pickTest(/Row-wise t-tests/);
    for (const name of ["Group A columns", "Group B columns"]) {
      const group = within(screen.getByRole("group", { name }));
      expect(group.getAllByRole("checkbox").map((c) => c.parentElement?.textContent)).toEqual(["a1", "a2", "b1", "b2"]);
      expect(group.queryByLabelText("run")).toBeNull();
    }
    expect((within(screen.getByRole("group", { name: "Group A columns" })).getByLabelText("a1") as HTMLInputElement).checked).toBe(true);
  });

  it("refuses a stored selection that has the X column in a group, with the reason", async () => {
    load(plate);
    render(<StatsTestsPanel />);
    useStatsTestsStore.getState().openWith({
      testId: "row-t-tests",
      selection: { ...DEFAULT_SELECTION, cols: [-1, 0] },
      params: { ...DEFAULT_PARAMS, rowt: { ...DEFAULT_PARAMS.rowt, groupB: [2, 3] } },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/X column labels each row/)).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
  });
});
