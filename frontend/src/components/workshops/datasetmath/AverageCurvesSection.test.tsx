// Gap audit 2 #9: Dataset Math's "Average N" tab averages N datasets into ONE
// linked dataset (mean, SD, SEM, N) with SEM bound as the mean's error, as one
// recorded, replayable `average` transform.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { averageParamsOf } from "../../../lib/transformAverage";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import DatasetMathPanel from "./DatasetMathPanel";

vi.mock("../../../lib/api/curveAverage", () => ({ averageCurves: vi.fn() }));
const { averageCurves } = await import("../../../lib/api/curveAverage");

const scan = (k: number): DataStruct => ({
  time: [0, 1, 2],
  values: [[k], [k + 1], [k + 2]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
});
const out: DataStruct = {
  time: [0, 1, 2],
  values: [[2, 1, 0.5, 2], [3, 1, 0.5, 2], [4, null as unknown as number, null as unknown as number, 1]],
  labels: ["I mean", "I SD", "I SEM", "N"],
  units: ["cps", "cps", "cps", ""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [
      { id: "d1", name: "scan1.xy", data: scan(1) },
      { id: "d2", name: "scan2.xy", data: scan(3) },
      { id: "d3", name: "other.xy", data: scan(9) },
    ],
    activeId: "d1",
    selectedIds: ["d1", "d2"],
    datasetMathOpen: true,
    datasetMathMode: "average",
    macroRecording: true,
    macroSteps: [],
  });
});

describe("Dataset Math — Average N", () => {
  it("averages the picked datasets into a linked dataset with SEM bound as the mean's error", async () => {
    vi.mocked(averageCurves).mockResolvedValue({ dataset: out, warnings: [], overlap: [0, 2], channels: ["I", "I"] });
    render(<DatasetMathPanel />);
    expect(screen.getByRole("radio", { name: "Average N" })).toBeChecked();
    // Library selection seeds the pick.
    expect(screen.getByRole("checkbox", { name: "scan1.xy" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "other.xy" })).not.toBeChecked();
    fireEvent.change(screen.getByRole("combobox", { name: "Y column to average" }), { target: { value: "I" } });
    fireEvent.click(screen.getByRole("button", { name: /Average → new dataset/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));

    const body = vi.mocked(averageCurves).mock.calls[0][0];
    expect(body.curves.map((c) => c.name)).toEqual(["scan1.xy", "scan2.xy"]);
    expect(body).toMatchObject({ channel: "I", grid: "union", unsorted: "refuse", allow_unit_mismatch: false });

    const made = useApp.getState().datasets[3];
    expect(made.errorRoles).toEqual([{ channel: 2, target: 0, axis: "y", side: "both" }]);
    expect(made.columnDesignations).toMatchObject({ 1: "disregard", 2: "Y-error", 3: "disregard" });
    // A JSON-null SD/SEM is stored as NaN (the .dwk reopens).
    expect(Number.isNaN(made.data.values[2][1])).toBe(true);

    const step = useApp.getState().macroSteps.at(-1)!;
    expect(step.kind).toBe("transform");
    const replay = averageParamsOf(step.params);
    expect(replay).toMatchObject({ op: "average", channel: "I", grid: "union", with: [{ id: "d2", name: "scan2.xy" }] });
  });

  it("needs two datasets and a positive step before Average runs", () => {
    useApp.setState({ selectedIds: [] });
    render(<DatasetMathPanel />);
    const go = screen.getByRole("button", { name: /Average → new dataset/ });
    expect(go).toBeDisabled();
    expect(screen.getByText("Pick at least two datasets.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "scan2.xy" }));
    expect(go).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: "Step over overlap" }));
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Grid step" }), { target: { value: "0.5" } });
    expect(go).toBeEnabled();
  });

  it("shows a unit refusal and offers the explicit acknowledgment", async () => {
    vi.mocked(averageCurves).mockRejectedValue(new Error("The curves' y units differ (\"a\" cps, \"b\" counts)"));
    render(<DatasetMathPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Average → new dataset/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("y units differ");
    fireEvent.click(screen.getByRole("checkbox", { name: "Average despite the unit mismatch" }));
    vi.mocked(averageCurves).mockResolvedValue({ dataset: out, warnings: [], overlap: [0, 2], channels: ["I", "I"] });
    fireEvent.click(screen.getByRole("button", { name: /Average → new dataset/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(vi.mocked(averageCurves).mock.calls[1][0].allow_unit_mismatch).toBe(true);
  });

  it("validates a recorded step", () => {
    expect(() => averageParamsOf({ op: "average", grid: "step", with: [{ id: "x" }] })).toThrow(/positive "step"/);
    expect(() => averageParamsOf({ op: "average", with: [] })).toThrow(/other datasets/);
  });
});
