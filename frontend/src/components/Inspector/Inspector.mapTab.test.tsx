// Figures audit #18: on the Map tab the Inspector still offered the XY
// series controls (Line / Scatter / Both, markers, line width) — a map draws
// no curves, so they edited nothing visible there.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { dock, emptyLayout } from "../../lib/windowLayout/ops";
import { mapViewFor } from "../../lib/mapView";
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
// (gridding, contours) shows in the Style window while a map window is open. UX pass 4 M2: it follows the
// map window in use (not the Library-active dataset) and names its dataset in the title. The card is the
// layout's lazy MapStyleCard, so it arrives a frame after the Inspector.
describe("Inspector with a map window (windows mode)", () => {
  const mapWin = (id: string, datasetId: string, z: number, winState: PlotWindow["winState"] = "normal"): PlotWindow => ({
    id, kind: "map", title: "map", datasetId, geometry: { x: 0, y: 0, w: 400, h: 300 }, z, winState,
    view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
  });
  const sheet = (id: string, name: string) => ({ id, name, data });
  const setUp = (wins: PlotWindow[], activeId = "d1") =>
    useApp.setState({
      layoutMode: "windows", stageTab: "plot", activeId, plotWindows: wins,
      datasets: [sheet("d1", "sample"), sheet("d2", "second"), sheet("cut", "H-cut")],
      windowLayout: wins.reduce((l, w) => dock(l, `plot:${w.id}`, "centre"), emptyLayout()),
    });

  it("shows the 2-D map card, titled with its dataset, beside the plot cards while a map window is open", async () => {
    setUp([mapWin("m", "d1", 1)]);
    render(<Inspector />);
    expect(await screen.findByText("2-D map: sample")).toBeInTheDocument();
    expect(screen.getByText(/series style/i)).toBeInTheDocument();
  });

  it("follows the map window in front: two maps, and a cut dataset active (an H-cut), keep the card on the map in use", async () => {
    setUp([mapWin("m1", "d1", 1), mapWin("m2", "d2", 2)], "d1");
    render(<Inspector />);
    expect(await screen.findByText("2-D map: second")).toBeInTheDocument();
    act(() => useApp.setState((st) => ({ plotWindows: st.plotWindows.map((w) => (w.id === "m1" ? { ...w, z: 9 } : w)) })));
    expect(await screen.findByText("2-D map: sample")).toBeInTheDocument();
    act(() => useApp.setState({ activeId: "cut" }));
    expect(screen.getByText("2-D map: sample")).toBeInTheDocument();
  });

  it("its colour limits edit the map window's dataset, not the active one", async () => {
    setUp([mapWin("m1", "d1", 1), mapWin("m2", "d2", 2)], "d1");
    render(<Inspector />);
    await screen.findByText("2-D map: second");
    const lo = screen.getByLabelText("Map colour minimum");
    fireEvent.change(lo, { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Map colour maximum"), { target: { value: "50" } });
    fireEvent.blur(screen.getByLabelText("Map colour maximum"));
    expect(mapViewFor(useApp.getState().mapViews, "d2").colorLimits).toEqual([5, 50]);
    expect(mapViewFor(useApp.getState().mapViews, "d1").colorLimits).toBeFalsy();
  });

  it("names its selects", async () => {
    setUp([mapWin("m", "d1", 1)]);
    render(<Inspector />);
    await screen.findByText("2-D map: sample");
    expect(screen.getByRole("combobox", { name: "Grid method" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Grid resolution" })).toBeInTheDocument();
  });

  it("not for a minimized map window", async () => {
    setUp([mapWin("m", "d1", 1, "minimized")]);
    render(<Inspector />);
    await screen.findByText(/series style/i);
    expect(screen.queryByText(/2-D map/)).toBeNull();
  });

  it("classic is unchanged: the same map window does not add the card off the Map tab", () => {
    setUp([mapWin("m", "d1", 1)]);
    useApp.setState({ layoutMode: "classic" });
    render(<Inspector />);
    expect(screen.queryByText(/2-D map/)).toBeNull();
  });

  it("classic's Map tab still shows the plain 2-D map card on the active dataset", () => {
    useApp.setState({ layoutMode: "classic", stageTab: "map" });
    render(<Inspector />);
    expect(screen.getByText("2-D map")).toBeInTheDocument();
  });
});
