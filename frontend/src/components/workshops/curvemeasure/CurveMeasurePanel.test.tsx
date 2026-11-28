// Curve measurements: the panel's three modes, units in the readout, refusals
// shown plainly, and the commit (a linked worksheet, one undo step, no
// duplicate). The backend is mocked; the calc has its own analytic tests.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntersectResult, LevelCrossingResult, StepTimeResult } from "../../../lib/api/curveMeasure";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveMeasurePanel from "./CurveMeasurePanel";

const { inter, level, step } = vi.hoisted(() => ({ inter: vi.fn(), level: vi.fn(), step: vi.fn() }));
vi.mock("../../../lib/api/curveMeasure", () => ({ measureIntersect: inter, measureLevelCrossings: level, measureStepTime: step }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[0, 1], [1, 0.5], [2, 0], [3, -1]],
  labels: ["signal", "ref"],
  units: ["V", "V"],
  metadata: { x_column_name: "Time", x_column_unit: "ms" },
};
const OTHER: DataStruct = { ...DATA, time: [10, 11, 12], values: [[1], [2], [3]], labels: ["late"], units: ["V"] };

const INTERSECT: IntersectResult = {
  intersections: [{ x: 0.5, y: 0.75, kind: "cross", direction: "falling", x_end: 0.5 }],
  x_min: 0, x_max: 3, n_grid: 4, dropped_a: 0, dropped_b: 0, merged_a: 0, merged_b: 0,
};
const LEVEL: LevelCrossingResult = {
  level: 0.5, hysteresis: 0.1, crossings: [{ x: 0.25, direction: "rising" }, { x: 2.5, direction: "falling" }],
  n_points: 4, dropped: 0, merged_duplicates: 0,
};
const STEP: StepTimeResult = {
  edge: "fall", time: 0.4, x_low: 2.2, x_high: 1.8, low_fraction: 0.1, high_fraction: 0.9,
  low_plateau: 0, high_plateau: 1, low_level: 0.1, high_level: 0.9, plateaus_estimated: [true, false], plateau_method: "state",
  n_points: 4, dropped: 0, merged_duplicates: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  inter.mockResolvedValue(INTERSECT);
  level.mockResolvedValue(LEVEL);
  step.mockResolvedValue(STEP);
  useApp.setState({
    datasets: [{ id: "a", name: "scope", data: DATA }, { id: "o", name: "other", data: OTHER }],
    activeId: "a", status: "", analysisResults: [], history: [], future: [],
  });
});

const measure = () => fireEvent.click(screen.getByRole("button", { name: "Measure" }));

describe("CurveMeasurePanel", () => {
  it("intersects curve A with a second column of the same worksheet and shows units", async () => {
    render(<CurveMeasurePanel />);
    measure();
    expect(await screen.findByText(/^1 intersection/)).toBeInTheDocument();
    expect(inter).toHaveBeenCalledWith({ x1: DATA.time, y1: [0, 1, 2, 3], x2: DATA.time, y2: [1, 0.5, 0, -1] });
    expect(screen.getByText("A crosses B, falling")).toBeInTheDocument();
    expect(screen.getByText("X (ms)")).toBeInTheDocument();
    expect(screen.getByText("Y (V)")).toBeInTheDocument();
  });

  it("takes curve B from another worksheet", async () => {
    render(<CurveMeasurePanel />);
    fireEvent.change(screen.getByLabelText("Curve B worksheet"), { target: { value: "o" } });
    measure();
    await screen.findByText(/^1 intersection/);
    expect(inter).toHaveBeenCalledWith(expect.objectContaining({ x2: OTHER.time, y2: [1, 2, 3] }));
  });

  it("level crossings send the level, dead band and direction; empty level is refused before any request", async () => {
    render(<CurveMeasurePanel />);
    fireEvent.change(screen.getByLabelText("Measurement"), { target: { value: "level" } });
    measure();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the Y level");
    expect(level).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Y level"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Dead band"), { target: { value: "0.1" } });
    fireEvent.change(screen.getByLabelText("Crossing direction"), { target: { value: "rising" } });
    measure();
    expect(await screen.findByText("2 crossings of 0.5 V")).toBeInTheDocument();
    expect(level).toHaveBeenCalledWith(expect.objectContaining({ level: 0.5, hysteresis: 0.1, direction: "rising" }));
  });

  it("rise / fall time sends fractions and optional levels and shows the two crossings", async () => {
    render(<CurveMeasurePanel />);
    fireEvent.change(screen.getByLabelText("Measurement"), { target: { value: "step" } });
    fireEvent.change(screen.getByLabelText("High level"), { target: { value: "1" } });
    measure();
    expect(await screen.findByText(/Fall time \(10 to 90 %\) = 0\.4 ms/)).toBeInTheDocument();
    expect(step).toHaveBeenCalledWith(expect.objectContaining({
      low_fraction: 0.1, high_fraction: 0.9, edge: "auto", low_level: undefined, high_level: 1,
    }));
    expect(screen.getByText("low plateau (state level)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Low percentage"), { target: { value: "95" } });
    measure();
    expect(await screen.findByRole("alert")).toHaveTextContent("0 < low < high < 100");
  });

  it("shows a backend refusal and withholds a result when a setting moves", async () => {
    inter.mockRejectedValueOnce(new Error("the curves do not overlap in X"));
    render(<CurveMeasurePanel />);
    measure();
    expect(await screen.findByRole("alert")).toHaveTextContent("do not overlap");
    measure();
    await screen.findByText(/^1 intersection/);
    fireEvent.change(screen.getByLabelText("Y column"), { target: { value: "1" } });
    expect(screen.queryByText(/^1 intersection/)).toBeNull();
  });

  it("adds the measurements as a linked worksheet once, in one undo step", async () => {
    render(<CurveMeasurePanel />);
    fireEvent.change(screen.getByLabelText("Measurement"), { target: { value: "level" } });
    fireEvent.change(screen.getByLabelText("Y level"), { target: { value: "0.5" } });
    measure();
    await screen.findByText("2 crossings of 0.5 V");
    fireEvent.click(screen.getByRole("button", { name: "Add measurements as dataset" }));
    const added = useApp.getState().datasets.find((d) => d.name === "scope (level crossings)")!;
    expect(added.data.time).toEqual([0.25, 2.5]);
    expect(added.data.values).toEqual([[0.5, 1], [0.5, -1]]);
    expect(added.data.metadata?.["x_column_unit"]).toBe("ms");
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0]!.producer.id).toBe("curve-measure");
    // The new output became the active worksheet; back on the source, the same computation is already added.
    act(() => useApp.getState().setActive("a"));
    measure();
    await screen.findByText("2 crossings of 0.5 V");
    expect(screen.getByRole("button", { name: "Add measurements as dataset" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add measurements as dataset" })).toHaveAttribute("title", expect.stringMatching(/already added/i));
    expect(useApp.getState().analysisResults).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.some((d) => d.name === "scope (level crossings)")).toBe(false);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("records a second source for an intersection with another worksheet", async () => {
    render(<CurveMeasurePanel />);
    fireEvent.change(screen.getByLabelText("Curve B worksheet"), { target: { value: "o" } });
    measure();
    await screen.findByText(/^1 intersection/);
    fireEvent.click(screen.getByRole("button", { name: "Add measurements as dataset" }));
    const r = useApp.getState().analysisResults[0]!;
    expect(r.sources.map((s) => s.datasetId)).toEqual(["a", "o"]);
  });

  it("will not add an empty measurement", async () => {
    level.mockResolvedValue({ ...LEVEL, level: 9, crossings: [] });
    render(<CurveMeasurePanel />);
    fireEvent.change(screen.getByLabelText("Measurement"), { target: { value: "level" } });
    fireEvent.change(screen.getByLabelText("Y level"), { target: { value: "9" } });
    measure();
    await screen.findByText("The curve never crosses 9 V");
    expect(screen.getByRole("button", { name: "Add measurements as dataset" })).toBeDisabled();
  });
});
