import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import WindowWorkspaceControls from "./WindowWorkspaceControls";

const mainWindow = (): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "Signal",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 1,
  winState: "maximized",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
});

beforeEach(() => {
  useApp.setState({
    datasets: [
      {
        id: "d1",
        name: "Signal",
        data: { time: [0, 1], values: [[1, 2]], labels: ["Y"], units: ["V"], metadata: {} },
      },
    ],
    activeId: "d1",
    stageTab: "plot",
    plotCanvasBounds: { width: 900, height: 600 },
    plotWindows: [mainWindow()],
    focusedWindowId: "w1",
    history: [],
    future: [],
  });
});

describe("WindowWorkspaceControls", () => {
  it("opens the active worksheet beside the starter plot in one click", () => {
    render(<WindowWorkspaceControls />);
    fireEvent.click(screen.getByRole("button", { name: "Sheet" }));

    const windows = useApp.getState().plotWindows;
    expect(windows).toHaveLength(2);
    expect(windows.map((win) => win.kind)).toEqual(["plot", "worksheet"]);
    expect(windows.every((win) => win.winState === "normal")).toBe(true);
    expect(windows[0].geometry.x).not.toBe(windows[1].geometry.x);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("opens another focused plot and exposes layout controls", () => {
    render(<WindowWorkspaceControls />);
    expect(screen.getByRole("button", { name: "Tile visible windows" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Plot" }));

    const state = useApp.getState();
    expect(state.plotWindows).toHaveLength(2);
    expect(state.focusedWindowId).toBe(state.plotWindows[1].id);
    expect(screen.getByRole("button", { name: "Tile visible windows" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cascade visible windows" })).toBeEnabled();
  });

  it("restores the full-bleed starter plot without requiring a hidden title bar", () => {
    render(<WindowWorkspaceControls />);
    const restore = screen.getByRole("button", { name: "Restore active window" });
    fireEvent.click(restore);
    expect(useApp.getState().plotWindows[0].winState).toBe("normal");
    expect(screen.getByRole("button", { name: "Maximize active window" })).toBeEnabled();
  });

  it("disables the worksheet shortcut when no dataset is active", () => {
    useApp.setState({ activeId: null });
    render(<WindowWorkspaceControls />);
    expect(screen.getByRole("button", { name: "Sheet" })).toBeDisabled();
  });

  it("does not rearrange an existing manual workspace when another plot is opened", () => {
    const first = { ...mainWindow(), winState: "normal" as const, geometry: { x: 73, y: 41, w: 520, h: 390 } };
    useApp.setState({ plotWindows: [first], focusedWindowId: first.id });
    render(<WindowWorkspaceControls />);
    fireEvent.click(screen.getByRole("button", { name: "Plot" }));
    expect(useApp.getState().plotWindows[0].geometry).toEqual(first.geometry);
  });
});
