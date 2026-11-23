// UX pass 3 fixes for the window layout (preview). B2: below 1280 px a tool opens floating (D6) and a
// window never opens out of sight (the union of the floating windows, a maximized plot from the desk's
// corner). M2: the mode gives way before the dataset name in a title bar. M3: back from the figure
// setup, focus returns to the Analysis window. M4: Analysis takes most of a shared slot. M5: tool
// announcements use the display name. m-1..m-3: focus after "Looks like", the technique sentence, and
// after a dock button. m-5/m-6: "suggested" only for a known technique, a result count. m-7: a removed
// pin names its dataset. m-9: caption colours. Assertions read the store or the DOM.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { dock, emptyLayout, float } from "../../../lib/windowLayout/ops";
import { ANALYSIS_MIN_SHARE, ANALYSIS_SHARE, giveShare } from "../../../lib/windowLayout/shares";
import { slotBox, slotHidden } from "../../../lib/windowLayout/visibility";
import { resetInspectedForTests } from "./inspectedDatasets";
import { seedAnalysisSelection, useAnalysisSelection } from "../../../store/analysisSelection";
import { markLayoutReturn } from "../../../store/layoutReturn";
import { openToolPlacement } from "../../../store/layoutToolActions";
import { setTechniqueOverride } from "../../../store/analysisWindowActions";
import { useApp } from "../../../store/useApp";
import { reopenRef } from "../../../store/windowLayoutActions";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import LayoutHost from "./LayoutHost";

vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../Stage/worksheet/WorksheetPane", () => ({ default: () => <div data-testid="grid" /> }));
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
beforeAll(() => vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} }));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  (window as { innerWidth: number }).innerWidth = 1024;
});

const mk = (id: string, name: string, metadata: Record<string, unknown> = {}): Dataset => ({
  id, name, data: { time: [0, 1, 2, 3], values: [[1, 2], [2, 3], [3, 4], [4, 5]], labels: ["a", "b"], units: ["", ""], metadata },
});
const win = (id: string, datasetId: string, over: Partial<PlotWindow> = {}): PlotWindow => ({
  id, kind: "plot", title: `Graph ${id}`, datasetId, geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
});
const s = () => useApp.getState();
const L = () => s().windowLayout!;
const live = () => screen.getByTestId("wl-live").textContent;

function setup(layout = float(emptyLayout(), "plot:w1"), windows: PlotWindow[] = [win("w1", "d1")], datasets = [mk("d1", "two-peaks.csv")]) {
  localStorage.clear();
  resetInspectedForTests();
  useAnalysisSelection.getState().clear();
  useApp.setState({
    datasets, activeId: "d1", worksheetId: null, selectedIds: ["d1"], selection: null, worksheetSelections: {},
    plotWindows: windows, focusedWindowId: "w1", layoutMode: "windows", windowLayout: layout, leftCollapsed: false, toolWindowLayout: {},
    analysisResults: [], editableFigures: [], reports: [], staleDatasets: [], staleFits: [], status: "",
  });
}
beforeEach(() => setup());

describe("B2 a tool opens in sight on a small screen", () => {
  it("under 1280 px a tool never placed opens floating (D6), in front; at 1280 and over it docks at the bottom", () => {
    (window as { innerWidth: number }).innerWidth = 1024;
    openToolPlacement("curvefit");
    expect(L().placements["tool:curvefit"]).toMatchObject({ slot: null, open: true, lastSlot: "bottom" });
    expect(L().z.at(-1)).toBe("tool:curvefit");
    checkInvariants(L());
    setup();
    (window as { innerWidth: number }).innerWidth = 1440;
    openToolPlacement("curvefit");
    expect(L().placements["tool:curvefit"]).toMatchObject({ slot: "bottom", open: true });
  });

  it("a tool placement the user saved keeps its slot on a small screen", () => {
    setup(dock(float(emptyLayout(), "plot:w1"), "tool:curvefit", "left"));
    useApp.setState({ windowLayout: { ...L(), placements: { ...L().placements, "tool:curvefit": { ...L().placements["tool:curvefit"]!, open: false } } } });
    (window as { innerWidth: number }).innerWidth = 1024;
    openToolPlacement("curvefit");
    expect(L().placements["tool:curvefit"]).toMatchObject({ slot: "left", open: true });
  });

  it("together, floating boxes hide a slot that no single one covers; a visible quarter keeps it docked", () => {
    const bottom = slotBox("bottom", 320, { width: 814, height: 642 });
    expect(slotHidden(bottom, [{ x: 0, y: 0, w: 420, h: 642 }, { x: 400, y: 0, w: 414, h: 642 }])).toBe(true);
    expect(slotHidden(bottom, [{ x: 0, y: 0, w: 814, h: 642 }])).toBe(true);
    expect(slotHidden(bottom, [{ x: 0, y: 0, w: 600, h: 642 }])).toBe(false);
    expect(slotHidden(bottom, [{ x: 0, y: 0, w: 814, h: 400 }])).toBe(false);
  });

  it("a maximized floating plot fills the desk from its corner, not from its saved geometry", () => {
    const base = float(emptyLayout(), "plot:w1");
    const closed = { ...base, placements: { ...base.placements, data: { slot: "right" as const, order: 0, share: 1, lastSlot: "right" as const, open: false } } };
    setup(closed, [win("w1", "d1", { winState: "maximized" })]);
    const desk = document.createElement("div");
    desk.className = "qzk-wl-desk";
    desk.getBoundingClientRect = () => ({ left: 210, top: 102, width: 814, height: 642, right: 1024, bottom: 744, x: 210, y: 102, toJSON: () => ({}) }) as DOMRect;
    document.body.append(desk);
    try {
      reopenRef("data");
      expect(L().placements.data).toMatchObject({ slot: null, open: true });
    } finally {
      desk.remove();
    }
  });
});

describe("M2 the mode gives way before the dataset name", () => {
  it("shrinks the mode first, keeps six characters of the name, and carries the full text in a tooltip", () => {
    expect(css).toMatch(/\.qzk-wl-data-name \{ flex: 0 1 auto; min-width: 6ch;/);
    expect(css).toMatch(/\.qzk-wl-data-mode \{ flex: 0 100 auto; min-width: 0;/);
    setup(dock(dock(emptyLayout(), "plot:w1", "centre"), "analysis", "right"));
    render(<LayoutHost />);
    expect(screen.getByTestId("analysis-source").getAttribute("title")).toBe("two-peaks.csv · following the plot");
  });
});

describe("M4 the Analysis window takes most of a shared slot", () => {
  it("giveShare rescales the others in proportion and keeps the invariants", () => {
    const l = dock(dock(dock(emptyLayout(), "style", "right"), "data", "right"), "analysis", "right");
    const next = giveShare(l, "analysis", ANALYSIS_SHARE);
    expect(next.placements.analysis!.share).toBeCloseTo(ANALYSIS_SHARE);
    expect(next.placements.style!.share).toBeCloseTo(next.placements.data!.share);
    checkInvariants(next);
    expect(giveShare(next, "analysis", ANALYSIS_SHARE)).toBe(next);
  });

  it("opening Analysis beside Style gives it 65%; Data opening after it leaves it at least half", () => {
    const base = dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right");
    const closed = (r: "analysis" | "data") => ({ slot: "right" as const, order: 0, share: 1, lastSlot: "right" as const, open: false, ...(r ? {} : {}) });
    setup({ ...base, placements: { ...base.placements, analysis: closed("analysis"), data: closed("data") } });
    reopenRef("analysis");
    expect(L().placements.analysis!.share).toBeCloseTo(ANALYSIS_SHARE);
    reopenRef("data");
    expect(L().placements.analysis!.share).toBeGreaterThanOrEqual(ANALYSIS_MIN_SHARE - 1e-9);
    checkInvariants(L());
  });
});

describe("M3 back from the figure setup, focus returns to the Analysis window", () => {
  it("the host, mounting again, focuses the window that started the setup and says so", async () => {
    setup(dock(dock(emptyLayout(), "plot:w1", "centre"), "analysis", "right"));
    markLayoutReturn("analysis");
    render(<LayoutHost />);
    await expect.poll(() => document.activeElement?.closest('[data-wl-window="analysis"]') !== null).toBe(true);
    expect(live()).toBe("Back in the window layout; your windows are as you left them.");
  });
});

describe("m-1 / m-2 the technique section", () => {
  it("'Looks like' moves focus to the Treat as menu, and the announcement names the technique and the dataset", async () => {
    const xrd = mk("d1", "scan.csv", { x_column_name: "2θ", x_column_unit: "deg" });
    setup(dock(dock(emptyLayout(), "plot:w1", "centre"), "analysis", "right"), [win("w1", "d1")], [xrd]);
    render(<LayoutHost />);
    const group = await screen.findByRole("group", { name: "Suggested techniques" });
    const first = within(group).getAllByRole("button")[0];
    fireEvent.click(first);
    expect(document.activeElement?.tagName).toBe("SELECT");
    expect(live()).toMatch(/^Technique set to .+ for scan\.csv\. Ctrl\+Z undoes\.$/);
  });

  it("the sentence for a reset also names the dataset", () => {
    setTechniqueOverride("d1", "xrd.powder");
    expect(setTechniqueOverride("d1", null)).toBe("Technique reset to what the import recorded for two-peaks.csv. Ctrl+Z undoes.");
  });
});

describe("m-5 / m-6 the tool list", () => {
  it("marks nothing 'suggested' for unidentified data", async () => {
    setup(dock(dock(emptyLayout(), "plot:w1", "centre"), "analysis", "right"));
    render(<LayoutHost />);
    await screen.findByRole("heading", { name: "Tools" });
    expect(document.querySelectorAll(".qzk-wl-an-badge")).toHaveLength(0);
  });

  it("a search says how many tools match, and the empty state is a status", async () => {
    setup(dock(dock(emptyLayout(), "plot:w1", "centre"), "analysis", "right"));
    render(<LayoutHost />);
    const box = await screen.findByRole("searchbox", { name: "Search analysis tools" });
    fireEvent.change(box, { target: { value: "curve fit" } });
    expect(screen.getAllByRole("status").some((e) => /tools? match(es)? this search\.$/.test(e.textContent ?? ""))).toBe(true);
    fireEvent.change(box, { target: { value: "zzzzzz" } });
    expect(screen.getByText("No tools match this search.").getAttribute("role")).toBe("status");
  });
});

describe("m-3 focus after a dock button", () => {
  it("the window's title bar takes focus where it lands", async () => {
    setup(dock(dock(emptyLayout(), "plot:w1", "centre"), "style", "right"));
    render(<LayoutHost />);
    fireEvent.click(within(screen.getByRole("region", { name: "Style" })).getByRole("button", { name: "Dock left" }));
    await expect.poll(() => document.activeElement?.closest('[data-wl-window="style"]') !== null).toBe(true);
    expect(L().placements.style!.slot).toBe("left");
  });
});

describe("m-7 a pin to a removed dataset names it", () => {
  it("Analysis keeps the name it showed", async () => {
    setup(dock(dock(emptyLayout(), "plot:w1", "centre"), "analysis", "right"));
    render(<LayoutHost />);
    fireEvent.click(await screen.findByRole("button", { name: /^Pin the Analysis window/ }));
    expect(screen.getByTestId("analysis-source").textContent).toBe("two-peaks.csv · pinned");
    act(() => useApp.setState({ datasets: [mk("d2", "other.csv")] }));
    expect(screen.getByTestId("analysis-source").textContent).toBe("two-peaks.csv · pinned, removed");
  });
});

describe("m-4 / m-9 floating chrome and captions", () => {
  it("a floated frame keeps 24 px close, collapse and help targets; classic frames are not matched", () => {
    expect(css).toMatch(/\.qzk-win-title:has\(\.qzk-wl-dock\) \.qzk-win-close \{ width: 24px; height: 24px;/);
    expect(css).toMatch(/\.qzk-win-title:has\(\.qzk-wl-dock\) \.qzk-win-collapse, \.qzk-win-title:has\(\.qzk-wl-dock\) \.qz-card-help \{ width: 24px; height: 24px;/);
    expect(css).toMatch(/\.qzk-wl-tool-node \.qz-btn\.qz-sm, \.qzk-wl-analysis \.qz-btn\.qz-sm \{ height: 24px;/);
  });

  it("the captions use the dim text colour (the faint one is under 4.5:1 on the dark selected step) and at least 10 px", () => {
    expect(css).toMatch(/\.qzk-wl-an-detail, \.qzk-wl-an-reason, \.qzk-wl-an-tool\.unavailable \.qzk-wl-an-toolbtn, \.qzk-wl-data-src \{ color: var\(--text-dim\); \}/);
    expect(css).toMatch(/font-size: max\(var\(--type-nano\), 10px\);/);
  });

  it("the singleton windows and tools first float below a plot's title bar", () => {
    const layer = readFileSync(join(here, "FloatLayer.tsx"), "utf8");
    const tool = readFileSync(join(here, "FloatingTool.tsx"), "utf8");
    expect(layer).toContain("y={deskTop + PLOT_BAR_CLEAR}");
    expect(tool).toContain("deskTop + PLOT_BAR_CLEAR");
  });
});

describe("selection identity", () => {
  it("a re-seed of the same inputs hands back the same items; changed inputs do not", () => {
    const first = seedAnalysisSelection("peaks", "tool-default");
    const same = seedAnalysisSelection("peaks", "tool-default", true);
    expect(same.items).toBe(first.items);
    useApp.setState({ yKeys: [1] });
    const changed = seedAnalysisSelection("peaks", "tool-default", true);
    expect(changed.items).not.toBe(first.items);
  });
});
