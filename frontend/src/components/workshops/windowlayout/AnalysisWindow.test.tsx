// The Analysis window (WORKSPACE_LAYOUT_PLAN P4), mounted in the real layout
// host: the guide for the focused plot's dataset (technique, the five steps
// with status, the tool list with greyed tools and reasons), the technique
// override saved on the dataset, a step click reopening its step, follow and
// pin, the toolbar / Window-menu toggle, the classic Analysis Center and
// Workflow views routed here, and Dock all placing it. Every assertion reads
// the store or the DOM, never a mock call count.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { checkInvariants } from "../../../test/windowLayoutInvariants";
import { resetAnalysisCenterPreferencesForTests } from "../../../store/analysisCenter";
import { runAction, useCommands } from "../../../store/commands";
import { useApp } from "../../../store/useApp";
import { resetInspectedForTests } from "./inspectedDatasets";
import LayoutHost from "./LayoutHost";

vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../windows/BackgroundPlotWindow", () => ({ default: ({ windowId }: { windowId: string }) => <div data-testid={`bg-${windowId}`} /> }));
vi.mock("../../Inspector/Inspector", () => ({ default: () => <aside className="qzk-inspector" data-testid="inspector" /> }));
vi.mock("../../Stage/worksheet/WorksheetPane", () => ({ default: ({ datasetId }: { datasetId: string }) => <div data-testid={`grid-${datasetId}`} /> }));
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

const sheet = (id: string, name: string, technique: string): Dataset => ({
  id,
  name,
  data: {
    time: Array.from({ length: 12 }, (_, i) => i),
    values: Array.from({ length: 12 }, (_, i) => [i, i * 2]),
    labels: ["A", "B"],
    units: ["", ""],
    metadata: { technique },
  },
});
const D1 = sheet("d1", "Pattern one", "xrd.powder");
const D2 = sheet("d2", "Loop two", "magnetometry.mvsh");
const win = (id: string, datasetId: string, z: number): PlotWindow => ({
  id, kind: "plot", title: `Graph ${id}`, datasetId, geometry: { x: 40, y: 40, w: 480, h: 360 }, z, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
});
const result = (datasetId: string): AnalysisResult => ({
  version: 1, id: `r-${datasetId}`, name: "Fit", producer: { id: "curve-fit", label: "Curve Fit", version: 1 },
  sources: [{ datasetId, role: "input" }], outputs: [], warnings: [], createdAt: "2026-01-01T00:00:00Z",
});

const s = () => useApp.getState();
const L = () => s().windowLayout!;

function seed(analysisOpen = true) {
  localStorage.clear();
  resetAnalysisCenterPreferencesForTests();
  resetInspectedForTests();
  let l = dock(dock(emptyLayout(), "plot:w1", "centre"), "plot:w2", "left");
  l = dock(l, "analysis", "right");
  if (!analysisOpen) l = { ...l, placements: { ...l.placements, analysis: { ...l.placements.analysis!, open: false } } };
  useApp.setState({
    datasets: [D1, D2],
    activeId: "d1",
    selectedIds: ["d1"],
    plotWindows: [win("w1", "d1", 2), win("w2", "d2", 1)],
    focusedWindowId: "w1",
    layoutMode: "windows",
    windowLayout: l,
    leftCollapsed: false,
    analysisResults: [],
    editableFigures: [],
    reports: [],
    staleDatasets: [],
    staleFits: [],
    openAnalysisResultId: null,
    curveFitOpen: false,
    stageTab: "plot",
  });
}
beforeEach(() => seed());

const frame = () => screen.getByRole("region", { name: "Analysis" });
/** Mount the host and wait for the Analysis body (its own lazy chunk). */
async function mount() {
  const r = render(<LayoutHost />);
  await expect.poll(() => document.querySelector('[data-wl-window="analysis"] .qzk-wl-analysis, [data-wl-window="analysis"] [role="status"]')).not.toBeNull();
  return r;
}
const source = () => within(frame()).getByTestId("analysis-source").textContent;
const step = (name: string) => within(frame()).getByRole("button", { name: new RegExp(`^${name}`) });
const stepItem = (name: string) => step(name).closest("li")!;
const technique = () => frame().querySelector(".qzk-wl-an-technique")!.textContent;
const tool = (id: string) => within(frame()).getByTestId(`an-tool-${id}`);

describe("the guide for the focused plot's dataset", () => {
  it("shows the technique, the five steps with status, and the next one highlighted", async () => {
    await mount();
    expect(source()).toBe("Pattern one · following the plot");
    expect(technique()).toBe("Powder XRD (recorded at import)");
    const items = within(frame()).getAllByRole("listitem").filter((li) => li.classList.contains("qzk-wl-an-step"));
    expect(items.map((li) => li.querySelector(".qzk-wl-an-steplabel")!.textContent)).toEqual(["Inspect", "Clean", "Plot", "Analyze", "Report"]);
    expect(stepItem("Inspect").getAttribute("aria-current")).toBe("step");
    expect(stepItem("Inspect").textContent).toContain("Not started · next");
  });

  it("greys out a tool that does not fit, with the shared one-line reason; a fitting one is suggested", async () => {
    await mount();
    const hysteresis = tool("hysteresis");
    expect(hysteresis.classList.contains("unavailable")).toBe(true);
    expect(hysteresis.textContent).toContain("This tool needs a magnetometry field sweep and response; the active worksheet is xrd powder.");
    expect(within(tool("peak-wizard")).getByRole("button").getAttribute("aria-disabled")).toBeNull();
    expect(tool("peak-wizard").textContent).toContain("suggested");
    // A greyed tool's click says why and opens nothing.
    fireEvent.click(within(hysteresis).getByRole("button"));
    expect(s().status).toMatch(/^This tool needs a magnetometry field sweep/);
  });

  it("step status follows the result lifecycle: a result marks Analyze done, a stale one out of date", async () => {
    useApp.setState({ analysisResults: [result("d1")] });
    const { rerender } = await mount();
    expect(stepItem("Analyze").classList.contains("done")).toBe(true);
    act(() => useApp.setState({ analysisResults: [{ ...result("d1"), stale: true }] }));
    rerender(<LayoutHost />);
    expect(stepItem("Analyze").classList.contains("out-of-date")).toBe(true);
    expect(stepItem("Analyze").textContent).toContain("Out of date");
  });

  it("clicking a step reopens it: Inspect opens Data (and is then done), Analyze opens the latest result", async () => {
    useApp.setState({ analysisResults: [result("d1")] });
    await mount();
    fireEvent.click(step("Inspect"));
    expect(L().placements.data?.open).toBe(true);
    await waitFor(() => expect(stepItem("Inspect").classList.contains("done")).toBe(true));
    fireEvent.click(step("Analyze"));
    expect(s().openAnalysisResultId).toBe("r-d1");
    // Report with no report but a result: the result (where reports are built).
    useApp.setState({ openAnalysisResultId: null });
    fireEvent.click(step("Report"));
    expect(s().openAnalysisResultId).toBe("r-d1");
  });

  it("Analyze with no result yet moves to the tool list", async () => {
    await mount();
    fireEvent.click(step("Analyze"));
    expect(document.activeElement).toBe(within(frame()).getByRole("heading", { name: "Tools" }));
    expect(s().openAnalysisResultId).toBeNull();
  });

  it("a tool that is already open is only brought forward: its input is not re-seeded", async () => {
    const { launchFromAnalysis } = await import("../../../store/analysisWindowActions");
    const { analysisCenterActions } = await import("../../../store/analysisCenterRun");
    const { analysisTools } = await import("../../../lib/analysisCenter");
    const { useAnalysisSelection } = await import("../../../store/analysisSelection");
    useAnalysisSelection.getState().setSelection("curvefit", { version: 1, source: "plot", createdAt: "x", items: [] } as never);
    const before = useAnalysisSelection.getState().selection;
    const fit = analysisTools(analysisCenterActions(), D1, [D1, D2]).find((t) => t.action.id === "curvefit")!;
    await expect(launchFromAnalysis(fit, "d1", () => "curvefit")).resolves.toBe("curvefit");
    expect(useAnalysisSelection.getState().selection).toBe(before);
    expect(s().curveFitOpen).toBe(false);
  });

  it("opens a tool through the shared launch path", async () => {
    await mount();
    fireEvent.click(within(tool("curvefit")).getByRole("button"));
    await waitFor(() => expect(s().curveFitOpen).toBe(true));
  });
});

describe("technique override, saved on the dataset", () => {
  it("choosing a technique saves it on the dataset as one undo step, and the guide follows it", async () => {
    await mount();
    fireEvent.change(within(frame()).getByLabelText("Treat as"), { target: { value: "spectroscopy" } });
    expect(s().datasets.find((d) => d.id === "d1")!.data.metadata.technique_override).toBe("spectroscopy");
    // The recorded technique is untouched (plot defaults and the Analyze menu keep reading it).
    expect(s().datasets.find((d) => d.id === "d1")!.data.metadata.technique).toBe("xrd.powder");
    expect(technique()).toBe("Spectroscopy (your choice, saved on the dataset)");
    fireEvent.change(within(frame()).getByLabelText("Treat as"), { target: { value: "" } });
    expect(s().datasets.find((d) => d.id === "d1")!.data.metadata.technique_override).toBeUndefined();
  });

  it("a lazy preview loads its full data before the override is written (never into the preview)", async () => {
    useApp.setState({ datasets: [{ ...D1, pending: { kind: "path", path: "C:/p.opju", bookId: "b", rows: 12, cols: 2 } }, D2] });
    await mount();
    fireEvent.change(within(frame()).getByLabelText("Treat as"), { target: { value: "spectroscopy" } });
    expect(s().datasets[0].data.metadata.technique_override).toBeUndefined();
    expect(screen.getByTestId("wl-live").textContent).toBe("Loading the full worksheet; the technique is saved once it has loaded.");
  });
});

describe("follows the focused plot, with a pin", () => {
  const pin = () => within(frame()).getByRole("button", { name: /^Pin the Analysis window/ });

  it("follows a focus change; the pin keeps it; tools then refuse to run on the unfocused dataset", async () => {
    await mount();
    act(() => s().focusWindow("w2"));
    expect(source()).toBe("Loop two · following the plot");
    fireEvent.click(pin());
    expect(L().pins).toEqual({ analysis: "d2" });
    act(() => s().focusWindow("w1"));
    expect(source()).toBe("Loop two · pinned");
    expect(tool("curvefit").textContent).toContain("focus a plot of Loop two to run them on it");
    fireEvent.click(pin());
    expect(source()).toBe("Pattern one · following the plot");
  });

  it("a pin to a removed dataset fails closed and offers Unpin", async () => {
    useApp.setState({ windowLayout: { ...L(), pins: { analysis: "gone" } } });
    await mount();
    expect(within(frame()).getByRole("status").textContent).toContain("The pinned dataset was removed");
    fireEvent.click(within(frame()).getByRole("button", { name: "Unpin" }));
    expect(L().pins).toEqual({});
  });
});

describe("opening it", () => {
  it("the toolbar toggle, the Window-menu command and the classic views open it; Dock all puts it right", async () => {
    seed(false);
    render(<LayoutHost />);
    const pill = screen.getByRole("button", { name: "Analysis" });
    expect(pill.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pill);
    expect(L().placements.analysis?.open).toBe(true);
    const cmd = useCommands.getState().menuCommands.find((c) => c.id === "layout-toggle-analysis");
    act(() => runAction(cmd!));
    expect(L().placements.analysis?.open).toBe(false);
    act(() => s().setStageTab("analysis"));
    expect(L().placements.analysis?.open).toBe(true);
    expect(s().stageTab).toBe("plot");
    act(() => {
      useApp.setState({ windowLayout: { ...L(), placements: { ...L().placements, analysis: { ...L().placements.analysis!, open: false } } } });
      s().setStageTab("technique");
    });
    expect(L().placements.analysis?.open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "▦ Dock all" }));
    expect(L().placements.analysis).toMatchObject({ open: true, slot: "right" });
    checkInvariants(L());
  });
});
