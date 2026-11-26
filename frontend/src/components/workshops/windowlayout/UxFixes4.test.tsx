// UX pass 4 fixes for the window layout: M1 an Analysis "ROI cuts" launch opens the map; M3 the
// Window menu's "Open map in window" goes through the same adapter (dedupes, refuses a non-map); M5 a
// floating plot window that opens under a floating tool window is moved beside it; m-2 a closed window is
// named by its title and focus moves on; m-5 Ctrl+Shift+W closes a map window; m-6 a refusal is a toast;
// m-4 the docked map chip; m-9 a restore does not announce; m-10 the run's status line goes; m-11 24 px floating targets.
// Every assertion reads the store or the DOM.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { analysisTools } from "../../../lib/analysisCenter";
import { EMPTY_MAP_VIEWS } from "../../../lib/mapView";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { analysisCenterActions } from "../../../store/analysisCenterRun";
import { launchFromAnalysis } from "../../../store/analysisWindowActions";
import { useCommands } from "../../../store/commands";
import { layoutTool, registerLayoutTool, resetLayoutToolsForTests } from "../../../store/layoutTools";
import { toolBusyChanged } from "../../../store/layoutToolActions";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { mapCheckFailed, notAMap } from "../../../store/windowLayoutMap";
import LayoutHost from "./LayoutHost";
import { openMapWindow } from "./openMapWindow";
import { useClearOfTools } from "./useClearOfTools";

vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../windows/BackgroundPlotWindow", () => ({ default: ({ windowId }: { windowId: string }) => <div data-testid={`bg-${windowId}`} /> }));
vi.mock("../../Inspector/Inspector", () => ({ default: () => <aside className="qzk-inspector" data-testid="inspector" /> }));
vi.mock("../../windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("../../history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));
vi.mock("../../../commands/recentProjectsCommands", () => ({ useRecentProjectsCommands: () => {} }));
vi.mock("../../../commands/relinkCommands", () => ({ useRelinkCommands: () => {} }));
vi.mock("../../../commands/workbookTransferCommands", () => ({ useWorkbookTransferCommands: () => {} }));
vi.mock("../../../commands/projectLockCommands", () => ({ useProjectLockCommands: () => {} }));

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "windowlayout.css"), "utf8");

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
});
afterAll(() => vi.unstubAllGlobals());

function rsm(id = "m1", name = "rsm.xrdml"): Dataset {
  const values: number[][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) values.push([30 + i, 15 + j, 100 * (i + 1) + j]);
  return { id, name, data: { time: values.map((_, k) => k), values, labels: ["2Theta", "Omega", "Intensity"], units: ["deg", "deg", "counts"], metadata: { is2D: true, map_shape: [4, 4] } } };
}
const LINE: Dataset = { id: "d1", name: "line.csv", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["a"], units: [""], metadata: {} } };
const win = (over: Partial<PlotWindow>): PlotWindow => ({
  id: "w1", kind: "plot", title: "Graph A", datasetId: "d1", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;
const live = () => screen.getByTestId("wl-live").textContent;
const mapWindows = () => s().plotWindows.filter((w) => w.kind === "map");
const width = (px: number) => void ((window as { innerWidth: number }).innerWidth = px);
const toasts = () => useToasts.getState().toasts.map((t) => t.msg);

beforeEach(() => {
  localStorage.clear();
  width(1440);
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [rsm(), LINE], activeId: "m1", plotWindows: [win({})], focusedWindowId: "w1", layoutMode: "windows",
    windowLayout: dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"), leftCollapsed: false,
    stageTab: "plot", mapViews: EMPTY_MAP_VIEWS, status: "", layoutTileBelow: 0,
  });
});
afterEach(() => {
  width(1024);
  resetLayoutToolsForTests();
});

describe("M1 an Analysis tool that reads the map opens the map window", () => {
  beforeEach(() => useApp.setState({ windowLayout: dock(L(), "analysis", "right") })); // the launch is from the Analysis window
  const roiCuts = () => analysisTools(analysisCenterActions(), s().datasets.find((d) => d.id === s().activeId)!, s().datasets).find((t) => t.action.id === "roi-cuts")!;

  it("ROI cuts launched from the Analysis window on a 2-D map dataset opens its map window, before the tool", async () => {
    render(<LayoutHost />);
    expect(roiCuts().available).toBe(true);
    expect(mapWindows()).toHaveLength(0);
    await act(async () => void (await launchFromAnalysis(roiCuts(), "m1", () => null, () => openMapWindow({ focus: false }))));
    expect(mapWindows().map((w) => w.datasetId)).toEqual(["m1"]);
    expect(L().placements[`plot:${mapWindows()[0].id}`]).toMatchObject({ open: true });
    expect(live()).toBe("Map of rsm.xrdml opened in a window.");
  });

  it("a tool for 1-D data opens no map window", async () => {
    useApp.setState({ activeId: "d1" });
    render(<LayoutHost />);
    const fit = analysisTools(analysisCenterActions(), LINE, s().datasets).find((t) => t.action.id === "curvefit")!;
    await act(async () => void (await launchFromAnalysis(fit, "d1", () => null, () => openMapWindow({ focus: false }))));
    expect(mapWindows()).toHaveLength(0);
  });
});

describe("M3 Window > Open map in window", () => {
  async function runCommand() {
    const actual = await vi.importActual<typeof import("../../windows/useWindowCommands")>("../../windows/useWindowCommands");
    function Commands() {
      actual.useWindowCommands();
      return null;
    }
    render(
      <>
        <Commands />
        <LayoutHost />
      </>,
    );
    return () => void act(() => useCommands.getState().menuCommands.find((a) => a.id === "window-map")!.run());
  }

  it("a second request brings the one map window forward (no third copy)", async () => {
    const run = await runCommand();
    run();
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
    run();
    run();
    await waitFor(() => expect(live()).toBe("Map of rsm.xrdml brought forward."));
    expect(mapWindows()).toHaveLength(1);
    expect(s().stageTab).toBe("plot");
  });

  it("a dataset that is not a map is refused: nothing opens, the live region and a toast say why", async () => {
    useApp.setState({ activeId: "d1" });
    const run = await runCommand();
    run();
    await waitFor(() => expect(live()).toBe(notAMap("line.csv")));
    expect(mapWindows()).toHaveLength(0);
    expect(toasts()).toContain(notAMap("line.csv"));
  });

  it("with the layout host off screen (Library tiles, Quick Figure Builder) the window opens directly: no stage tab nobody hears", async () => {
    const actual = await vi.importActual<typeof import("../../windows/useWindowCommands")>("../../windows/useWindowCommands");
    function Commands() {
      actual.useWindowCommands();
      return null;
    }
    render(<Commands />);
    act(() => useCommands.getState().menuCommands.find((a) => a.id === "window-map")!.run());
    expect(mapWindows()).toHaveLength(1);
    expect(s().stageTab).toBe("plot");
  });

  it("classic still opens a document window directly (unchanged)", async () => {
    useApp.setState({ layoutMode: "classic", windowLayout: null });
    const actual = await vi.importActual<typeof import("../../windows/useWindowCommands")>("../../windows/useWindowCommands");
    function Commands() {
      actual.useWindowCommands();
      return null;
    }
    render(<Commands />);
    act(() => useCommands.getState().menuCommands.find((a) => a.id === "window-map")!.run());
    expect(mapWindows()).toHaveLength(1);
  });
});

describe("m-6 a refusal is said three ways, with the dataset named and the reasons apart", () => {
  it("names the dataset and splits 'no grid' from 'the check did not load'", () => {
    expect(notAMap("a.csv")).toContain('"a.csv"');
    expect(mapCheckFailed("a.csv")).toContain('"a.csv"');
    expect(notAMap("a.csv")).not.toBe(mapCheckFailed("a.csv"));
    expect(notAMap("a.csv")).not.toMatch(/did not load/);
    expect(mapCheckFailed("a.csv")).not.toMatch(/no X\/Y grid, so/);
  });

  it("a map request with no active dataset toasts too", async () => {
    useApp.setState({ activeId: null });
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(toasts().length).toBe(1));
    expect(live()).toMatch(/no dataset is active/);
  });
});

describe("m-9 a restore does not announce", () => {
  it("the Map tab in force when the host mounts opens the window silently; the next request is announced", async () => {
    // a saved project: its map window is already in the layout, and the Map tab was up when it was saved
    const id = s().createDocumentWindow("map", "m1");
    useApp.setState({ stageTab: "map", windowLayout: dock(L(), `plot:${id}`, "centre") });
    render(<LayoutHost />);
    await waitFor(() => expect(s().stageTab).toBe("plot"));
    expect(mapWindows()).toHaveLength(1);
    expect(live()).toBe("");
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(live()).toBe("Map of rsm.xrdml brought forward."));
  });
});

describe("m-2 closing a window", () => {
  it("names the closed window by its title, not its id, and moves focus to the window in front", async () => {
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
    const id = mapWindows()[0].id;
    await screen.findByRole("region", { name: "rsm.xrdml" });
    const title = s().plotWindows.find((w) => w.id === id)!.title || "rsm.xrdml";
    fireEvent.click(screen.getByRole("button", { name: `Close ${title}` }));
    await waitFor(() => expect(mapWindows()).toHaveLength(0));
    await waitFor(() => expect(live()).toBe(`${title} closed`));
    expect(live()).not.toMatch(/plot:|win-/);
    await waitFor(() => expect(document.activeElement?.closest("[data-wl-window]")?.getAttribute("data-wl-window")).toBe("plot:w1"));
  });
});

describe("m-4 a docked map window's title bar carries the map chip", () => {
  it("shows '▩ map' on the map window and not on a plot window", async () => {
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
    const map = await screen.findByRole("region", { name: "rsm.xrdml" });
    expect(within(map).getByText("▩ map")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Graph A" })).queryByText("▩ map")).toBeNull();
  });
});

describe("m-5 Ctrl+Shift+W on a map window", () => {
  it("closes the map window the keyboard is in, and not the plot that is focused behind it", async () => {
    render(<LayoutHost />);
    act(() => s().setStageTab("map"));
    await waitFor(() => expect(mapWindows()).toHaveLength(1));
    const toolbar = await screen.findByRole("toolbar", { name: "Map tools" });
    const button = within(toolbar).getByRole("button", { name: "Contours" });
    button.focus();
    fireEvent.keyDown(button, { key: "W", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(mapWindows()).toHaveLength(0));
    expect(s().plotWindows.map((w) => w.id)).toEqual(["w1"]);
  });

  it("from a plot window it leaves the key to the Window menu's handler", async () => {
    render(<LayoutHost />);
    const frame = await screen.findByRole("region", { name: "Graph A" });
    const bar = frame.querySelector<HTMLElement>("[data-wl-focus]")!;
    bar.focus();
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    fireEvent.keyDown(bar, { key: "W", ctrlKey: true, shiftKey: true });
    window.removeEventListener("keydown", seen);
    expect(seen).toHaveBeenCalledTimes(1); // not swallowed in the capture phase
  });
});

describe("m-10 the run's status line goes when the run ends", () => {
  const register = (): void => {
    registerLayoutTool({ id: "peaks", title: "Peaks", width: 300, head: null, body: document.createElement("div"), busy: false, pinRestored: true, autoPin: null });
  };

  it("clears '... is pinned ... while it runs.' at the end of the run, but not a later message", () => {
    useApp.setState({ activeId: "d1" });
    register();
    expect(toolBusyChanged("peaks", true)).toBe("Peaks is pinned to line.csv while it runs.");
    expect(s().status).toBe("Peaks is pinned to line.csv while it runs.");
    expect(toolBusyChanged("peaks", false)).toBe("Peaks finished and follows the focused plot again");
    expect(s().status).toBe("");
    expect(layoutTool("peaks")?.autoPin).toBeNull();

    toolBusyChanged("peaks", true);
    s().setStatus("saved 12:46");
    toolBusyChanged("peaks", false);
    expect(s().status).toBe("saved 12:46");
  });
});

describe("m-11 floating chrome targets", () => {
  it("a floated plot window's title-bar buttons are 24 px (classic's frame is untouched: the rules are scoped to the float layer)", () => {
    const rule = (sel: string) => css.split("\n").find((l) => l.includes(`${sel},`) || l.includes(`${sel} {`)) ?? "";
    for (const part of ["close", "maximize", "bg", "pin", "rebind", "save"]) expect(rule(`.qzk-wl-float .qzk-plotwin-${part}`), part).toMatch(/width: 24px; height: 24px/);
    expect(rule(".qzk-wl-float .qzk-plotwin-link")).toMatch(/height: 24px; min-width: 24px/);
    expect(css).not.toMatch(/^\.qzk-plotwin-close/m);
  });
});

describe("M5 a window that opens floating clears the floating tool windows", () => {
  function Harness({ ids, tiled = false }: { ids: string[]; tiled?: boolean }) {
    const ref = useRef<HTMLDivElement | null>(null);
    return (
      <div ref={ref} data-testid="layer">
        <Probe layer={ref} ids={ids} tiled={tiled} />
      </div>
    );
  }
  function Probe({ layer, ids, tiled }: { layer: { current: HTMLDivElement | null }; ids: string[]; tiled: boolean }) {
    useClearOfTools(layer, ids, tiled);
    return null;
  }
  const box = (el: Element, r: { left: number; top: number; width: number; height: number }) =>
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) });

  it("moves a window that opens under Style beside it; leaves the ones that were there; and a window dropped by hand", () => {
    const tool = document.createElement("div");
    tool.setAttribute("data-tool-window", "style");
    document.body.appendChild(tool);
    box(tool, { left: 474, top: 36, width: 332, height: 500 });
    useApp.setState({ plotWindows: [win({ id: "w1", geometry: { x: 410, y: 40, w: 300, h: 300 } }), win({ id: "w2", geometry: { x: 410, y: 40, w: 300, h: 300 } })] });
    const { rerender, getByTestId } = render(<Harness ids={["w1"]} />);
    box(getByTestId("layer"), { left: 0, top: 0, width: 814, height: 642 });
    // the window there at mount (a restore) keeps the user's placement
    expect(s().plotWindows.find((w) => w.id === "w1")!.geometry.x).toBe(410);
    // a new one opens under Style: moved beside it, size kept, still on top of nothing it hides
    rerender(<Harness ids={["w1", "w2"]} />);
    const moved = s().plotWindows.find((w) => w.id === "w2")!.geometry;
    expect(moved.w).toBe(300);
    expect(moved.x + moved.w).toBeLessThanOrEqual(474 - 8);
    document.body.removeChild(tool);
  });
  it("windows that come back floating when a narrow-screen tile ends keep the user's placements", () => {
    const tool = document.createElement("div");
    tool.setAttribute("data-tool-window", "style");
    document.body.appendChild(tool);
    box(tool, { left: 474, top: 36, width: 332, height: 500 });
    useApp.setState({ plotWindows: [win({ id: "w1", geometry: { x: 410, y: 40, w: 300, h: 300 } })] });
    const { rerender, getByTestId } = render(<Harness ids={[]} />);
    box(getByTestId("layer"), { left: 0, top: 0, width: 814, height: 642 });
    rerender(<Harness ids={[]} tiled />); // narrow: everything is docked in the grid
    rerender(<Harness ids={["w1"]} />); // widened: the saved float is back, under Style as the user left it
    expect(s().plotWindows.find((w) => w.id === "w1")!.geometry).toEqual({ x: 410, y: 40, w: 300, h: 300 });
    document.body.removeChild(tool);
  });
});
