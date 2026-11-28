// Rise / fall time plateau method across save and reopen: a NEW measurement records "state" (IEEE 181 state
// levels); a step saved before that (no recorded method) reopens as "band", with the numbers it was saved with;
// "Re-measure with state levels" is the user's upgrade and replaces the saved output in one undo step.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepTimeBody, StepTimeResult } from "../../../lib/api/curveMeasure";
import type { DataStruct } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import CurveMeasurePanel from "./CurveMeasurePanel";

const { step } = vi.hoisted(() => ({ step: vi.fn() }));
vi.mock("../../../lib/api/curveMeasure", () => ({ measureIntersect: vi.fn(), measureLevelCrossings: vi.fn(), measureStepTime: step }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5], values: [[0], [0], [0.5], [1], [1], [1]], labels: ["signal"], units: ["V"],
  metadata: { x_column_name: "Time", x_column_unit: "ms" },
};
const STATE: StepTimeResult = {
  edge: "rise", time: 1.6, x_low: 1.2, x_high: 2.8, low_fraction: 0.1, high_fraction: 0.9, low_plateau: 0, high_plateau: 1,
  low_level: 0.1, high_level: 0.9, plateaus_estimated: [true, true], plateau_method: "state", n_points: 6, dropped: 0, merged_duplicates: 0,
};
const BAND: StepTimeResult = {
  ...STATE, time: 1.2, x_low: 1.3, x_high: 2.5, low_plateau: 0.05, high_plateau: 0.95, low_level: 0.14, high_level: 0.86, plateau_method: "band",
};

const st = () => useApp.getState();
const output = () => st().datasets.find((d) => d.name === "scope (rise time)");

beforeEach(() => {
  vi.clearAllMocks();
  step.mockImplementation(async (b: StepTimeBody) => (b.plateau_method === "band" ? BAND : STATE));
  useToolReopen.setState({ sessions: {} });
  useApp.setState({ datasets: [{ id: "a", name: "scope", data: DATA }], activeId: "a", status: "", analysisResults: [], history: [], future: [], staleDatasets: [] });
});

/** `asBand`: the saved numbers are the band estimate's (what a step measured before state levels holds). */
async function commitNew(asBand = false): Promise<void> {
  if (asBand) step.mockResolvedValueOnce(BAND);
  render(<CurveMeasurePanel />);
  fireEvent.change(screen.getByLabelText("Measurement"), { target: { value: "step" } });
  fireEvent.click(screen.getByRole("button", { name: "Measure" }));
  await screen.findByText(/Rise time/);
  fireEvent.click(screen.getByRole("button", { name: "Add measurements as dataset" }));
  cleanup();
}

/** What a step saved before state levels looks like: the same record without a method. */
function saveBeforeStateLevels(): void {
  const strip = (v: unknown): unknown =>
    typeof v === "string" ? v.replace('"plateauMethod":"state",', "") : Array.isArray(v) ? v.map(strip) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "plateauMethod").map(([k, x]) => [k, strip(x)])) : v;
  useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => strip(r) as typeof r) }));
}

describe("rise time plateau method, saved and reopened", () => {
  it("a new measurement sends and records state levels", async () => {
    await commitNew();
    expect(step).toHaveBeenCalledWith(expect.objectContaining({ plateau_method: "state" }));
    expect(JSON.stringify(st().analysisResults[0])).toContain('"plateauMethod":"state"');
  });

  it("a step saved before state levels reopens with the band estimate and its saved numbers", async () => {
    await commitNew(true);
    saveBeforeStateLevels();
    expect(JSON.stringify(st().analysisResults[0])).not.toContain("plateauMethod");
    act(() => { expect(openCommittedResultInTool(st().analysisResults[0]!.id)).toBe(true); });
    render(<CurveMeasurePanel />);
    expect(screen.getByText(/band estimate, saved before state levels/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    await screen.findByText(/Rise time/);
    expect(step).toHaveBeenLastCalledWith(expect.objectContaining({ plateau_method: "band" }));
    expect(screen.getByText("low plateau (band estimate, saved before state levels)")).toBeInTheDocument();
    expect(screen.getByText(/Rise time \(10 to 90 %\) = 1\.2/)).toBeInTheDocument(); // the band number, not 1.6
    expect(output()!.data.time).toEqual([BAND.x_low, BAND.x_high]); // the saved output is untouched by reopening
  });

  it("Re-measure with state levels switches the saved step in one undo step", async () => {
    await commitNew(true);
    saveBeforeStateLevels();
    const before = output()!.data.time;
    act(() => { expect(openCommittedResultInTool(st().analysisResults[0]!.id)).toBe(true); });
    render(<CurveMeasurePanel />);
    const history = st().history.length;
    fireEvent.click(screen.getByRole("button", { name: "Re-measure with state levels" }));
    await waitFor(() => expect(st().history.length).toBe(history + 1));
    expect(step).toHaveBeenLastCalledWith(expect.objectContaining({ plateau_method: "state" }));
    expect(output()!.data.time).toEqual([STATE.x_low, STATE.x_high]);
    expect(output()!.data.time).not.toEqual(before);
    expect(st().analysisResults).toHaveLength(1);
    expect(JSON.stringify(st().analysisResults[0])).toContain('"plateauMethod":"state"');
    expect(screen.queryByRole("button", { name: "Re-measure with state levels" })).toBeNull();
    act(() => st().undo());
    expect(output()!.data.time).toEqual(before);
  });
});
