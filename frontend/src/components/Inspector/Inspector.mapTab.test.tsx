// Figures audit #18: on the Map tab the Inspector still offered the XY
// series controls (Line / Scatter / Both, markers, line width) — a map draws
// no curves, so they edited nothing visible there.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { dock, emptyLayout } from "../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import Inspector from "./Inspector";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["A"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({ datasets: [{ id: "d1", name: "sample", data }], activeId: "d1", folders: [], layoutMode: "classic", windowLayout: null, plotWindows: [] });
});

describe("Inspector on the Map tab", () => {
  it("shows the series style card on the Plot tab", () => {
    useApp.setState({ stageTab: "plot" });
    render(<Inspector />);
    expect(screen.getByText(/series style/i)).toBeInTheDocument();
  });

  it("hides the XY series style card on the Map tab", () => {
    useApp.setState({ stageTab: "map" });
    render(<Inspector />);
    expect(screen.queryByText(/series style/i)).toBeNull();
  });
});

// WORKSPACE_LAYOUT_PLAN P5: windows mode has no Map tab, so the 2-D map card
// (gridding, contours) shows in the Style window while a map window is open.
describe("Inspector with a map window (windows mode)", () => {
  const mapWin: PlotWindow = {
    id: "m", kind: "map", title: "map", datasetId: "d1", geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 1, winState: "normal",
    view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
  };
  const withMap = (state: PlotWindow["winState"]) =>
    useApp.setState({ stageTab: "plot", plotWindows: [{ ...mapWin, winState: state }], windowLayout: dock(emptyLayout(), "plot:m", "centre") });

  it("shows the 2-D map card beside the plot cards while a map window is open", () => {
    withMap("normal");
    useApp.setState({ layoutMode: "windows" });
    render(<Inspector />);
    expect(screen.getByText("2-D map")).toBeInTheDocument();
    expect(screen.getByText(/series style/i)).toBeInTheDocument();
  });

  it("not for a map window of another dataset (the card's colour limits edit the active one)", () => {
    withMap("normal");
    useApp.setState({ layoutMode: "windows", plotWindows: [{ ...mapWin, datasetId: "other" }] });
    render(<Inspector />);
    expect(screen.queryByText("2-D map")).toBeNull();
  });

  it("not for a minimized map window", () => {
    withMap("minimized");
    useApp.setState({ layoutMode: "windows" });
    render(<Inspector />);
    expect(screen.queryByText("2-D map")).toBeNull();
  });

  it("classic is unchanged: the same map window does not add the card off the Map tab", () => {
    withMap("normal");
    render(<Inspector />);
    expect(screen.queryByText("2-D map")).toBeNull();
  });
});
