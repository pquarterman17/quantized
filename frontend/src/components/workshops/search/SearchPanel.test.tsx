// Project-wide search UI (MAIN_PLAN #38). The behaviour that matters is REVEAL:
// a hit must take you to the surface that can actually show the thing.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import SearchPanel from "./SearchPanel";
import { useApp } from "../../../store/useApp";
import type { Dataset } from "../../../lib/types";

const ds = (id: string, name: string, labels: string[]): Dataset => ({
  id,
  name,
  data: {
    time: [0, 1],
    values: [labels.map(() => 1), labels.map(() => 2)],
    labels,
    units: labels.map(() => ""),
    metadata: {},
  },
});

const type = (v: string) =>
  fireEvent.change(screen.getByPlaceholderText(/dataset, column/), { target: { value: v } });

beforeEach(() => {
  useApp.setState({
    datasets: [ds("d1", "hall.dat", ["Field", "Rxy"]), ds("d2", "other.dat", ["Temp"])],
    folders: [],
    reports: [],
    analysisResults: [],
    openAnalysisResultId: null,
    originFigures: [],
    activeId: "d2",
    stageTab: "plot",
    searchOpen: true,
    status: "",
  });
});

describe("SearchPanel", () => {
  it("explains its scope before anything is typed", () => {
    render(<SearchPanel />);
    expect(screen.getByText(/datasets you do not have open/)).toBeInTheDocument();
  });

  it("says so plainly when nothing matches", () => {
    render(<SearchPanel />);
    type("zzzz");
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
  });

  it("finds a column inside a dataset that is not active", () => {
    render(<SearchPanel />);
    type("rxy");
    expect(screen.getByText("Rxy")).toBeInTheDocument();
  });

  it("REVEALS a column: activates its dataset and opens the worksheet", () => {
    // The Library could only show the dataset; the column lives in the sheet.
    render(<SearchPanel />);
    type("rxy");
    fireEvent.click(screen.getByText("Rxy"));
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().stageTab).toBe("worksheet");
  });

  it("closes after revealing, so the panel is not left over the result", () => {
    render(<SearchPanel />);
    type("rxy");
    fireEvent.click(screen.getByText("Rxy"));
    expect(useApp.getState().searchOpen).toBe(false);
  });

  it("reveals a dataset hit on the plot", () => {
    useApp.setState({ stageTab: "worksheet" });
    render(<SearchPanel />);
    type("hall");
    fireEvent.click(screen.getByText("hall.dat"));
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("reports what it revealed", () => {
    render(<SearchPanel />);
    type("rxy");
    fireEvent.click(screen.getByText("Rxy"));
    expect(useApp.getState().status).toContain("revealed Rxy");
  });

  it("finds an analysis result by name and opens its result workspace", () => {
    // PR #554 review: durable results were missing from project search.
    useApp.setState({
      analysisResults: [{
        version: 1, id: "res", name: "Smooth · hall.dat",
        producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
        sources: [{ datasetId: "d1", role: "input" }],
        outputs: [{ datasetId: "d2", role: "linked-worksheet" }],
        warnings: [], createdAt: "2026-10-08T00:00:00Z",
      }],
    });
    render(<SearchPanel />);
    type("smooth");
    fireEvent.click(screen.getByText("Smooth · hall.dat"));
    expect(useApp.getState().openAnalysisResultId).toBe("res");
    expect(useApp.getState().activeId).toBe("d2");
    expect(useApp.getState().searchOpen).toBe(false);
  });

  it("reveals the source worksheet for a source-only analysis result", () => {
    useApp.setState({
      analysisResults: [{
        version: 1, id: "peaks", name: "Peak analysis · hall.dat",
        producer: { id: "peak-analysis", label: "Peak Analysis", version: 1 },
        sources: [{ datasetId: "d1", role: "input" }], outputs: [],
        settingsRef: { datasetId: "d1", field: "peakTable" },
        warnings: [], createdAt: "2026-10-08T00:00:00Z",
      }],
    });
    render(<SearchPanel />);
    type("peak analysis");
    fireEvent.click(screen.getByText("Peak analysis · hall.dat"));
    expect(useApp.getState()).toMatchObject({ openAnalysisResultId: "peaks", activeId: "d1" });
  });
});
