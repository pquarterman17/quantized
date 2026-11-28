// A saved figure made from a plot that follows a NAMED range follows it too (ROW_RANGE_CONTRACT 3.3 and 5.2): the live
// document keeps `{ named: id }` plus the cached rows, re-read on every range change, and is refused with the reason when
// the range is deleted. A FROZEN document keeps its rows on purpose (the contract resolves the range when it is frozen):
// the Library says so ("rows frozen from range X") and "Re-link to range" makes it follow again. Through the real
// gestures: Plot named range, Save figure, Named Range retarget and delete, the Library row and its context menu.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));

import { buildArtifactMenu, type ArtifactNode } from "../components/Library/artifactContextActions";
import EditableFiguresSection from "../components/Library/EditableFiguresSection";
import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import { frozenRangeNote } from "../lib/figureRangeFrozen";
import { buildFigureSpecFromDocument } from "../lib/figureSpec";
import { buildLibraryHierarchy } from "../lib/libraryHierarchy";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace, WORKSPACE_VERSION_POST_045 } from "../lib/workspace";
import { defineNamedRange, removeNamedRange, retargetNamedRange } from "./namedRanges";
import { plotNamedRange } from "./namedRangeUse";
import { resetRangeLinkSyncForTests } from "./rangeLinkSync";
import { editableFigureDirty } from "./figureLifecycle";
import { useApp } from "./useApp";

const N = 10;
const ds: Dataset = {
  id: "d1", name: "run.csv",
  data: { time: Array.from({ length: N }, (_v, i) => i), values: Array.from({ length: N }, (_v, i) => [i + 1]), labels: ["A"], units: [""], metadata: {} },
};
const st = () => useApp.getState();
let rangeId = "";
const saved = (): FigureDocument => st().editableFigures[0]!;
const rows = () => saved().plot.view.rowRange;
const retarget = (r: { from: number; to: number }) => expect(retargetNamedRange(rangeId, { datasetId: "d1", cols: [0], rows: r })).toMatchObject({ ok: true });
/** The y values the exported figure carries, for the document as saved. */
const exported = () => {
  const spec = buildFigureSpecFromDocument(saved(), st().datasets[0], "fig");
  return spec.dataset.values.map((r) => r[0]);
};

function window1(): PlotWindow {
  const view = defaultPlotView();
  const document = createFigureDocument({ id: "figure-w1", name: "Run", datasetId: "d1", view });
  return { id: "w1", kind: "plot", title: "Run", datasetId: "d1", geometry: { x: 0, y: 0, w: 600, h: 400 }, z: 1, winState: "maximized", view, document, bg: "theme", linkGroup: null, pinned: false };
}

beforeEach(() => {
  resetRangeLinkSyncForTests();
  useApp.setState({
    datasets: [ds], workbooks: [], activeId: "d1", selectedIds: [], plotWindows: [window1()], focusedWindowId: "w1", editableFigures: [], namedRanges: [],
    figurePublicationSession: null, pages: [], history: [], future: [], status: "", ...defaultPlotView(),
  });
  // rows 2-5 (0-based) of A = 1..10 are 3, 4, 5, 6
  const made = defineNamedRange({ name: "Base", scope: "sheet", datasetId: "d1", cols: [0], rows: { from: 2, to: 5 } });
  rangeId = made.ok ? made.id : "";
});

const savePlotOfRange = () => {
  expect(plotNamedRange(rangeId)).toEqual({ ok: true });
  expect(st().saveFigure("w1")).not.toBeNull();
};

describe("a live saved figure made from a plot that follows named range Base", () => {
  it("keeps the link and the rows it covers now", () => {
    savePlotOfRange();
    expect(rows()).toEqual({ from: 2, to: 5, named: rangeId, namedAs: "Base" });
    expect(exported()).toEqual([3, 4, 5, 6]); // A = 1..10, rows 3-6 (numpy: np.arange(1, 11)[2:6])
  });

  it("follows a retarget, and the export draws the new rows; the figure is not 'edited' by it", () => {
    savePlotOfRange();
    retarget({ from: 4, to: 7 });
    expect(rows()).toEqual({ from: 4, to: 7, named: rangeId, namedAs: "Base" });
    expect(exported()).toEqual([5, 6, 7, 8]); // np.arange(1, 11)[4:8]
    expect(editableFigureDirty(st(), st().plotWindows[0]!)).toBe(false);
  });

  it("follows a row insert above it (one range, one source of truth for window and figure)", () => {
    savePlotOfRange();
    st().insertRows("d1", 0, 2);
    expect(rows()).toMatchObject({ from: 4, to: 7, named: rangeId });
  });

  it("is refused with the reason when the range is deleted (never every row), and Undo brings range and figure back together", () => {
    savePlotOfRange();
    expect(removeNamedRange(rangeId, { confirmed: true })).toMatchObject({ removed: true });
    expect(rows()).toMatchObject({ from: 0, to: -1, named: rangeId, refused: "the named range was removed" });
    expect(() => exported()).toThrow(/the named range was removed/);
    st().undo();
    expect(rows()).toEqual({ from: 2, to: 5, named: rangeId, namedAs: "Base" });
    expect(exported()).toEqual([3, 4, 5, 6]);
  });

  it("the delete dialog lists the saved figure as a dependant", () => {
    savePlotOfRange();
    const out = removeNamedRange(rangeId);
    expect(out).toMatchObject({ removed: false, dependants: expect.arrayContaining([{ kind: "figure", label: 'the editable figure "Run" (run.csv)' }]) });
  });

  it("survives the .dwk as the gated v9 rung, and a range moved while the file was closed wins over the saved cache", async () => {
    savePlotOfRange();
    const doc = JSON.parse(serializeWorkspace({ ...st() })) as { version: number; namedRanges: { target: { rows: { from: number; to: number } } }[] };
    expect(doc.version).toBe(WORKSPACE_VERSION_POST_045);
    doc.namedRanges[0]!.target.rows = { from: 6, to: 8 };
    useApp.setState({ datasets: [], editableFigures: [], namedRanges: [], plotWindows: [] });
    st().loadWorkspace(parseWorkspace(JSON.stringify(doc), { width: 1600, height: 900 }));
    await waitFor(() => expect(rows()).toMatchObject({ from: 6, to: 8, named: rangeId }));
  });
});

const frozenFigure = (): FigureDocument => createFigureDocument({
  id: "frozen-1", name: "Frozen run", datasetId: null,
  view: { ...defaultPlotView(), rowRange: { from: 2, to: 5, named: rangeId, namedAs: "Base" } },
  data: { mode: "frozen", snapshot: ds.data },
});
const frozenNode = (): Extract<ArtifactNode, { kind: "editable-figure" }> =>
  buildLibraryHierarchy({ folders: [], workbooks: [], datasets: [ds], editableFigures: st().editableFigures }).byKey.get("editable-figure:frozen-1") as never;
type ActionItem = Extract<ContextMenuItem, { run: () => void }>;
const relinkItem = (): ActionItem | undefined =>
  buildArtifactMenu(frozenNode()).find((item): item is ActionItem => "label" in item && item.label === "Re-link to range" && "run" in item);

describe("a FROZEN saved figure made from a named range keeps its rows on purpose", () => {
  beforeEach(() => useApp.setState({ editableFigures: [frozenFigure()] }));

  it("does not follow a retarget, and the Library says the rows are frozen from range Base", () => {
    const before = saved();
    retarget({ from: 4, to: 7 });
    expect(st().editableFigures[0]).toBe(before); // untouched: same object
    expect(frozenRangeNote(before)).toBe("rows frozen from range Base");
    render(<EditableFiguresSection />);
    expect(screen.getByText(/rows frozen from range Base/)).toBeTruthy();
  });

  it("offers Re-link to range, which makes it a live figure following the range again (one undo step)", async () => {
    retarget({ from: 4, to: 7 });
    const item = relinkItem()!;
    expect(item).toBeTruthy();
    expect("disabled" in item && item.disabled).toBeFalsy();
    item.run();
    await waitFor(() => expect(saved().data.mode).toBe("live"));
    expect(saved().bindings.datasetId).toBe("d1");
    expect(rows()).toEqual({ from: 4, to: 7, named: rangeId, namedAs: "Base" });
    retarget({ from: 0, to: 1 });
    expect(rows()).toMatchObject({ from: 0, to: 1 }); // it follows from now on
    st().undo(); // the retarget
    st().undo(); // the re-link
    expect(saved().data.mode).toBe("frozen");
    expect(rows()).toEqual({ from: 2, to: 5, named: rangeId, namedAs: "Base" });
  });

  it("is disabled, with the reason, when the range is gone, the columns differ, or a window shows the figure", () => {
    useApp.setState({ plotWindows: [{ ...window1(), document: { ...saved() } }] });
    expect(relinkItem()).toMatchObject({ disabled: true, title: "close the window showing this figure first" });
    useApp.setState({ plotWindows: [window1()], datasets: [{ ...ds, data: { ...ds.data, labels: ["Other"] } }] });
    expect(relinkItem()).toMatchObject({ disabled: true, title: expect.stringMatching(/no longer has the columns this figure was frozen from/) });
    useApp.setState({ datasets: [ds], namedRanges: [] });
    expect(relinkItem()).toMatchObject({ disabled: true, title: expect.stringMatching(/was removed, so there is nothing to follow/) });
  });

  it("a live figure has no such menu entry", () => {
    useApp.setState({ editableFigures: [{ ...frozenFigure(), data: { mode: "live" } }] });
    expect(relinkItem()).toBeUndefined();
  });
});
