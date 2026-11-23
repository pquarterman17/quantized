// The Data window (WORKSPACE_LAYOUT_PLAN P3), mounted in the real layout host
// with the real worksheet grid (WorksheetPane): it follows the focused plot,
// the pin freezes it, the Library-follow setting, the switcher of a
// multi-dataset graph (D14), selection linked both ways with the plot, Plot |
// Data side by side, and a pin to a removed dataset failing closed. Every
// assertion reads the store or the DOM, never a mock call count.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PINNED_GONE } from "../../../lib/windowLayout/dataSource";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import type { WindowLayoutV1 } from "../../../lib/windowLayout/types";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { useCommands } from "../../../store/commands";
import { useApp } from "../../../store/useApp";
import { WindowLayoutPref } from "../../overlays/WindowLayoutPref";
import { setDataChoice } from "./dataWindowChoice";
import LayoutHost from "./LayoutHost";

vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../windows/BackgroundPlotWindow", () => ({ default: ({ windowId }: { windowId: string }) => <div data-testid={`bg-${windowId}`} /> }));
vi.mock("../../Inspector/Inspector", () => ({ default: () => <aside className="qzk-inspector" data-testid="inspector" /> }));
vi.mock("../../windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("../../history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));
vi.mock("../../../commands/recentProjectsCommands", () => ({ useRecentProjectsCommands: () => {} }));
vi.mock("../../../commands/relinkCommands", () => ({ useRelinkCommands: () => {} }));
vi.mock("../../../commands/workbookTransferCommands", () => ({ useWorkbookTransferCommands: () => {} }));
vi.mock("../../../commands/projectLockCommands", () => ({ useProjectLockCommands: () => {} }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

const sheet = (id: string, name: string, label: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: [label], units: [""], metadata: {} },
  ...over,
});
const D1 = sheet("d1", "Sample one", "FieldOne");
const D2 = sheet("d2", "Sample two", "MomentTwo");
const G = sheet("g", "Overlay graph", "GraphCol", {
  linkedCurves: [
    { datasetId: "d1", xKey: null, yKey: 0, label: "one" },
    { datasetId: "d2", xKey: null, yKey: 0, label: "two" },
  ],
});

const win = (id: string, datasetId: string, z: number): PlotWindow => ({
  id,
  kind: "plot",
  title: `Graph ${id}`,
  datasetId,
  geometry: { x: 40, y: 40, w: 480, h: 360 },
  z,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
});

const s = () => useApp.getState();
const L = () => s().windowLayout!;

/** w1 (d1, focused) docked centre, w2 (d2) and w3 (the graph) docked left;
 *  Data docked right and open unless `dataOpen` is false. */
function seed(dataOpen = true, data: WindowLayoutV1["data"] = { pinned: null, follow: "plot" }) {
  localStorage.clear();
  setDataChoice(null);
  let l = dock(emptyLayout(), "plot:w1", "centre");
  l = dock(dock(l, "plot:w2", "left"), "plot:w3", "left");
  l = dock(l, "data", "right");
  if (!dataOpen) l = { ...l, placements: { ...l.placements, data: { ...l.placements.data!, open: false } } };
  useApp.setState({
    datasets: [D1, D2, G],
    activeId: "d1",
    worksheetId: null,
    selectedIds: ["d1"],
    selection: null,
    worksheetSelections: {},
    plotWindows: [win("w1", "d1", 3), win("w2", "d2", 2), win("w3", "g", 1)],
    focusedWindowId: "w1",
    layoutMode: "windows",
    windowLayout: { ...l, data },
    leftCollapsed: false,
  });
}

const dataFrame = () => screen.getByRole("region", { name: "Data" });
const sourceText = () => within(dataFrame()).getByTestId("data-source").textContent;
/** How many times the column label appears in `scope` (the header cell, the filter's column list, ...). */
const labelCount = (label: string, scope: () => HTMLElement = dataFrame) => within(scope()).queryAllByText(label).length;
/** Wait for the grid to show `label`'s column (the lazy grid chunk resolves first). */
const showsColumn = (label: string, scope: () => HTMLElement = dataFrame) => expect.poll(() => labelCount(label, scope)).toBeGreaterThan(0);
const pinBtn = () => within(dataFrame()).getByRole("button", { name: "Pin the Data window" });

beforeEach(() => seed());

describe("the Data window follows the focused plot", () => {
  it("shows the focused plot's dataset in the worksheet grid, and says it is following", async () => {
    render(<LayoutHost />);
    await showsColumn("FieldOne");
    expect(sourceText()).toBe("Sample one · following the plot");
    expect(pinBtn().getAttribute("aria-pressed")).toBe("false");
  });

  it("follows a focus change to another plot window", async () => {
    render(<LayoutHost />);
    await showsColumn("FieldOne");
    act(() => s().focusWindow("w2"));
    expect(s().activeId).toBe("d2");
    await showsColumn("MomentTwo");
    expect(labelCount("FieldOne")).toBe(0);
    expect(sourceText()).toBe("Sample two · following the plot");
  });

  it("the pin freezes it on the current dataset until it is unpinned", async () => {
    render(<LayoutHost />);
    await showsColumn("FieldOne");
    fireEvent.click(pinBtn());
    expect(L().data.pinned).toBe("d1");
    expect(pinBtn().getAttribute("aria-pressed")).toBe("true");
    act(() => s().focusWindow("w2"));
    expect(sourceText()).toBe("Sample one · pinned");
    expect(labelCount("FieldOne")).toBeGreaterThan(0);
    fireEvent.click(pinBtn());
    expect(L().data.pinned).toBeNull();
    await showsColumn("MomentTwo");
  });

  it("an unbound focused plot shows a reason, and there is nothing to pin", () => {
    useApp.setState({ activeId: null, plotWindows: [{ ...win("w1", "d1", 3), datasetId: null }, win("w2", "d2", 2), win("w3", "g", 1)] });
    render(<LayoutHost />);
    expect(within(dataFrame()).getByRole("status").textContent).toMatch(/shows no dataset/);
    expect(pinBtn()).toHaveProperty("disabled", true);
  });
});

describe("following the Library selection (Preferences)", () => {
  it("the setting is offered only in windows mode and is saved in the layout", () => {
    useApp.setState({ layoutMode: "classic" });
    const { unmount } = render(<WindowLayoutPref />);
    expect(screen.queryByRole("radiogroup", { name: "Data window follows" })).toBeNull();
    unmount();
    useApp.setState({ layoutMode: "windows" });
    render(<WindowLayoutPref />);
    const group = screen.getByRole("radiogroup", { name: "Data window follows" });
    expect(within(group).getByRole("radio", { name: "Focused plot" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "Library selection" }));
    expect(L().data.follow).toBe("library");
  });

  it("shows the Library's dataset, not the focused plot's", async () => {
    seed(true, { pinned: null, follow: "library" });
    useApp.setState({ worksheetId: "d2", selectedIds: ["d2"] }); // an Origin-book-style worksheet click; the plot keeps d1
    render(<LayoutHost />);
    await showsColumn("MomentTwo");
    expect(sourceText()).toBe("Sample two · following the Library");
    act(() => useApp.setState({ worksheetId: null, selectedIds: ["d2", "g"] }));
    await showsColumn("GraphCol");
  });
});

describe("a multi-dataset plot (D14)", () => {
  it("shows the graph with a switcher between its inputs", async () => {
    render(<LayoutHost />);
    act(() => s().focusWindow("w3"));
    const pick = within(dataFrame()).getByRole("combobox", { name: "Plot input" }) as HTMLSelectElement;
    expect([...pick.options].map((o) => o.value)).toEqual(["g", "d1", "d2"]);
    await showsColumn("GraphCol");
    fireEvent.change(pick, { target: { value: "d2" } });
    await showsColumn("MomentTwo");
    expect(sourceText()).toBe("Sample two · following the plot");
    // A one-dataset plot has no switcher.
    act(() => s().focusWindow("w1"));
    expect(within(dataFrame()).queryByRole("combobox", { name: "Plot input" })).toBeNull();
    // The pick belongs to the graph it was made on: another graph with the
    // same source starts from its own sheet.
    const g2 = { ...G, id: "g2", name: "Second graph" };
    act(() => useApp.setState((st) => ({ datasets: [...st.datasets, g2], plotWindows: [...st.plotWindows, win("w4", "g2", 0)] })));
    act(() => s().focusWindow("w4"));
    expect(sourceText()).toBe("Second graph · following the plot");
  });
});

describe("selection is linked both ways with the plot", () => {
  it("a row picked in the Data window is the plot's selection, and a plot selection shows on the rows", async () => {
    render(<LayoutHost />);
    const frame = dataFrame();
    await showsColumn("FieldOne");
    expect(within(frame).getByText(/Linked to plot/)).toBeTruthy();
    fireEvent.click(within(frame).getByText("2"));
    expect(s().selection).toEqual({ datasetId: "d1", rows: [1] });
    // The plot's brush writes the same store selection (PlotSelectionLayer).
    act(() => s().setRowSelection([0, 2]));
    expect(within(frame).getByText("2 selected")).toBeTruthy();
  });

  it("a window pinned to the plot's own dataset is not linked either (only following the plot links)", async () => {
    seed(true, { pinned: "d1", follow: "plot" });
    render(<LayoutHost />);
    const frame = dataFrame();
    await showsColumn("FieldOne");
    expect(within(frame).queryByText(/Linked to plot/)).toBeNull();
    fireEvent.click(within(frame).getByText("2"));
    expect(within(frame).getByText("1 selected")).toBeTruthy();
    expect(s().selection).toBeNull();
    expect(s().worksheetSelections["layout-data"]).toBeTruthy();
  });

  it("a pinned dataset the plot does not show keeps its own selection", async () => {
    seed(true, { pinned: "d2", follow: "plot" });
    render(<LayoutHost />);
    const frame = dataFrame();
    await showsColumn("MomentTwo");
    expect(within(frame).queryByText(/Linked to plot/)).toBeNull();
    fireEvent.click(within(frame).getByText("2"));
    expect(within(frame).getByText("1 selected")).toBeTruthy();
    expect(s().selection).toBeNull();
  });
});

describe("Plot | Data side by side", () => {
  it("opens Data and tiles it beside the focused plot in the centre, leaving the rest", () => {
    seed(false);
    render(<LayoutHost />);
    expect(screen.queryByRole("region", { name: "Data" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "▥ Plot | Data side by side" }));
    const centre = document.querySelector('[data-slot="centre"]') as HTMLElement;
    expect(within(centre).getAllByRole("region").map((r) => r.getAttribute("data-wl-window"))).toEqual(["plot:w1", "data"]);
    expect(L().centre).toBe("row");
    expect(L().placements["plot:w2"]!.slot).toBe("left");
    checkInvariants(L());
  });

  it("the palette command runs the same op, and is disabled with a reason when no plot is focused", () => {
    seed(false);
    render(<LayoutHost />);
    const cmd = useCommands.getState().menuCommands.find((a) => a.id === "layout-plot-data")!;
    expect(cmd.disabledReason).toMatch(/No plot window is focused/);
    act(() => cmd.run());
    expect(L().placements.data).toMatchObject({ open: true, slot: "centre" });
    act(() => useApp.setState({ focusedWindowId: null }));
    expect((cmd.disabled as () => boolean)()).toBe(true);
  });

  it("the Data toolbar toggle closes and reopens the window where it was", () => {
    render(<LayoutHost />);
    const toggle = screen.getByRole("button", { name: "Data" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(L().placements.data).toMatchObject({ open: false, slot: "right" });
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    expect(L().placements.data).toMatchObject({ open: true, slot: "right" });
  });
});

describe("a pinned Data window whose dataset is removed fails closed", () => {
  it("shows the reason and Unpin, never a stale grid; Unpin follows the plot again", async () => {
    seed(true, { pinned: "d2", follow: "plot" });
    render(<LayoutHost />);
    await showsColumn("MomentTwo");
    act(() => useApp.setState({ datasets: [D1, G] }));
    expect(within(dataFrame()).getByRole("status").textContent).toContain(PINNED_GONE);
    expect(labelCount("MomentTwo")).toBe(0);
    expect(sourceText()).toBe("removed dataset · pinned");
    fireEvent.click(within(dataFrame()).getByRole("button", { name: "Unpin" }));
    expect(L().data.pinned).toBeNull();
    await showsColumn("FieldOne");
  });
});

describe("a floating Data window", () => {
  it("floats as a tool window with the same title-bar source and pin", async () => {
    render(<LayoutHost />);
    fireEvent.click(within(dataFrame()).getByRole("button", { name: "Dock right" }));
    expect(L().placements.data!.slot).toBeNull();
    const floating = await screen.findByRole("dialog", { name: "Data" });
    expect(floating.getAttribute("data-tool-window")).toBe("data");
    expect(within(floating).getByTestId("data-source").textContent).toBe("Sample one · following the plot");
    expect(within(floating).getByRole("button", { name: "Pin the Data window" })).toBeTruthy();
    await showsColumn("FieldOne", () => floating);
    // Floated together, Data does not land on top of Style.
    fireEvent.click(screen.getByRole("button", { name: "Style" })); // opens Style (docked right)
    fireEvent.click(screen.getByRole("button", { name: "⧉ Float all" }));
    const style = await screen.findByRole("dialog", { name: "Style" });
    expect(floating.style.left).not.toBe(style.style.left);
  });
});
