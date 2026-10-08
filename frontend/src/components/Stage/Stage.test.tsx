// The Map tab is CONTEXTUAL (owner request 2026-07-25). A 1-D dataset can never
// produce a map, so a permanent Map tab was an invitation to a screen that only
// apologises.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import Stage from "./Stage";
import { useApp } from "../../store/useApp";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";

// The stage hosts heavy canvas children; this file is about the TAB STRIP.
vi.mock("../windows/WindowCanvas", () => ({ default: () => <div>plot-canvas</div> }));
vi.mock("./MapStage", () => ({ default: () => <div>map-canvas</div> }));
vi.mock("./Worksheet", () => ({ default: () => <div>worksheet</div> }));
vi.mock("../workshops/techniqueworkspace/TechniqueWorkspace", () => ({
  default: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>technique-workspace</button>,
}));
vi.mock("../windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("../history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));
// The empty-workspace view is a lazy chunk. Cold, under load, it resolved
// after findByRole's 1 s default (the "no workspace content" flake). Every
// run now takes longer than that, so the race is forced, not left to load;
// the preload below (the libraryFlatRowsSeam idiom) is the fix.
vi.mock("./EmptyProjectStage", async (importOriginal) => {
  await new Promise((r) => setTimeout(r, 1200));
  return importOriginal();
});

const ds = (nChannels: number): Dataset => ({
  id: "d1",
  name: "d.dat",
  data: {
    time: [0, 1],
    values: [Array(nChannels).fill(1), Array(nChannels).fill(2)],
    labels: Array.from({ length: nChannels }, (_, i) => `c${i}`),
    units: Array(nChannels).fill(""),
    metadata: {},
  },
});

beforeEach(() => {
  useApp.setState({
    datasets: [], activeId: null, stageTab: "plot", plotWindows: [], pages: [], reports: [],
    originFigures: [], editableFigures: [], figureDocs: [], analysisResults: [],
  });
});

describe("Map tab visibility", () => {
  beforeAll(async () => {
    await import("./EmptyProjectStage");
  });

  it("is hidden with no workspace content at all", async () => {
    render(<Stage />);
    expect(screen.queryByText("Map")).not.toBeInTheDocument();
    expect(screen.queryByText("Plot")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "No data loaded" })).toBeInTheDocument();
  });

  it("keeps the plot canvas mounted when a snapshot window clears activeId", () => {
    const snapshot = {
      id: "snapshot-1", kind: "snapshot", title: "Frozen", datasetId: null,
      geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 1, winState: "normal",
      view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
      snapshot: {},
    } as PlotWindow;
    useApp.setState({ datasets: [ds(2)], activeId: null, plotWindows: [snapshot] });
    render(<Stage />);
    expect(screen.getByText("plot-canvas")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No data loaded" })).not.toBeInTheDocument();
  });

  it("renders a snapshot-only workspace", () => {
    useApp.setState({
      plotWindows: [{
        id: "snapshot-1", kind: "snapshot", title: "Frozen", datasetId: null,
        geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 1, winState: "normal",
        view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
        snapshot: {},
      } as PlotWindow],
    });
    render(<Stage />);
    expect(screen.getByText("plot-canvas")).toBeInTheDocument();
  });

  it("treats a results-only project as content, not an empty project", () => {
    // PR #554 review: the Library lists the result, so the stage must not
    // claim "No data loaded" (reports already count the same way).
    useApp.setState({
      analysisResults: [{
        version: 1, id: "res", name: "Smooth", producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
        sources: [], outputs: [], warnings: [], createdAt: "2026-10-08T00:00:00Z",
      }],
    });
    render(<Stage />);
    expect(screen.queryByRole("heading", { name: "No data loaded" })).not.toBeInTheDocument();
    expect(screen.getByText("Plot")).toBeInTheDocument();
  });

  it("is hidden for an ordinary 1-D dataset (2 channels)", () => {
    useApp.setState({ datasets: [ds(2)], activeId: "d1" });
    render(<Stage />);
    expect(screen.queryByText("Map")).not.toBeInTheDocument();
  });

  it("APPEARS once the dataset has the three channels a map needs", () => {
    useApp.setState({ datasets: [ds(3)], activeId: "d1" });
    render(<Stage />);
    expect(screen.getByText("Map")).toBeInTheDocument();
  });

  it("Plot and Worksheet are always available", () => {
    useApp.setState({ datasets: [ds(2)], activeId: "d1" });
    render(<Stage />);
    expect(screen.getByText("Plot")).toBeInTheDocument();
    expect(screen.getByText("Worksheet")).toBeInTheDocument();
  });
});

describe("stranded-tab fallback", () => {
  // Map/Worksheet are dynamic imports (bundle-size headroom recovery) — even
  // with the module mocked, the first mount of either resolves through a
  // microtask, so these use findBy* (retries until resolved) rather than
  // getBy* for the panel content specifically.
  it("falls back to Plot when the Map tab is open and the data stops qualifying", async () => {
    // Without this, switching to a 1-D dataset strands the user on a tab that no
    // longer has a strip entry, with no visible way back.
    useApp.setState({ datasets: [ds(3)], activeId: "d1", stageTab: "map" });
    const { rerender } = render(<Stage />);
    expect(await screen.findByText("map-canvas")).toBeInTheDocument();
    useApp.setState({ datasets: [ds(2)], activeId: "d1" });
    rerender(<Stage />);
    expect(useApp.getState().stageTab).toBe("plot");
    expect(screen.getByText("plot-canvas")).toBeInTheDocument();
  });

  it("renders the map when the tab is open and the data does qualify", async () => {
    useApp.setState({ datasets: [ds(3)], activeId: "d1", stageTab: "map" });
    render(<Stage />);
    expect(await screen.findByText("map-canvas")).toBeInTheDocument();
  });
});

describe("Stage view tabs are a WAI-ARIA tablist (manual activation)", () => {
  // Manual: activating a view mounts a lazy chunk and tears down the plot
  // windows, so arrowing across the strip must not switch views on the way.
  it("is a named strip of tabs controlling a panel labelled by the selected one", () => {
    useApp.setState({ datasets: [ds(3)], activeId: "d1" });
    render(<Stage />);
    const tabs = within(screen.getByRole("tablist", { name: "Stage view" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Plot", "Map", "Worksheet", "Workflow"]);
    const panel = screen.getByRole("tabpanel", { name: "Plot" });
    expect(panel).toHaveTextContent("plot-canvas");
    for (const t of tabs) expect(t).toHaveAttribute("aria-controls", panel.id);
    expect(tabs.map((t) => [t.getAttribute("aria-selected"), t.tabIndex])).toEqual([
      ["true", 0], ["false", -1], ["false", -1], ["false", -1],
    ]);
  });

  it("arrows and Home/End move focus only; Enter or Space selects", async () => {
    const user = userEvent.setup();
    useApp.setState({ datasets: [ds(3)], activeId: "d1" });
    render(<Stage />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs[3]).toHaveFocus();
    fireEvent.keyDown(tabs[3], { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[3]).toHaveFocus();
    expect(useApp.getState().stageTab).toBe("plot");
    tabs[2].focus();
    await user.keyboard("{Enter}");
    expect(useApp.getState().stageTab).toBe("worksheet");
    expect(await screen.findByText("worksheet")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Worksheet" })).toHaveTextContent("worksheet");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Worksheet" }), { key: "Home" });
    await user.keyboard(" ");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("leaves Up/Down to the app's previous/next-dataset keys", () => {
    useApp.setState({ datasets: [ds(3)], activeId: "d1" });
    render(<Stage />);
    const plot = screen.getByRole("tab", { name: "Plot" });
    plot.focus();
    expect(fireEvent.keyDown(plot, { key: "ArrowDown" })).toBe(true); // not defaultPrevented
    expect(plot).toHaveFocus();
  });

  it("opens and closes the technique workflow as a real Stage view", async () => {
    useApp.setState({ datasets: [ds(3)], activeId: "d1", stageTab: "technique" });
    render(<Stage />);
    expect(await screen.findByRole("button", { name: "technique-workspace" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Workflow" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "technique-workspace" }));
    expect(useApp.getState().stageTab).toBe("plot");
  });
});
