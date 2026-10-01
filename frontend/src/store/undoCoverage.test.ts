// Undo-coverage audit (2026-10-01): one user gesture must be exactly ONE undo
// step, and undoing it must restore the state from just before it — no more,
// no less. Each spec below does the gesture, presses Ctrl+Z once, and checks
// both halves: the gesture is gone, and an UNRELATED earlier edit survives.
//
// The two failure shapes this pins:
//   - NO entry: the mutation lands silently inside the PREVIOUS entry's span,
//     so Ctrl+Z reverts the gesture together with an unrelated earlier edit
//     (and a gesture made first in a session cannot be undone at all).
//   - N entries for one gesture: Ctrl+Z steps back through half-applied states.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDatasetRowMenu } from "../components/Library/datasetRowMenu";
import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import type { FigureDoc } from "../lib/figuredoc";
import type { LibraryNode } from "../lib/libraryHierarchy";
import { renameLibraryNode } from "../lib/libraryRename";
import type { ReportEntry } from "../lib/report";
import type { Dataset, DataStruct } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await loadOriginApplyLibs();
});

const data = (book: string): DataStruct => ({
  time: [1, 2, 3],
  values: [[10, 1], [20, 2], [30, 3]],
  labels: ["a", "b"],
  units: ["", ""],
  metadata: { origin_book: book, x_column_name: "A", origin_column_names: ["B", "C"] },
});
const ds = (id: string, folderId?: string, book = "Book1"): Dataset =>
  ({ id, name: `${id}.dat`, data: data(book), ...(folderId ? { folderId } : {}) });

const report = (id: string, name: string): ReportEntry =>
  ({ id, name, datasetId: null, report: { title: name, blocks: [] } }) as unknown as ReportEntry;
const figureDoc = (id: string, name: string): FigureDoc =>
  ({ id, name, datasetId: null, live: false, config: {} }) as unknown as FigureDoc;
const node = (kind: LibraryNode["kind"], entityId: string): LibraryNode =>
  ({ kind, entityId }) as unknown as LibraryNode;

beforeEach(() => {
  useApp.setState({
    datasets: [ds("d1"), ds("d2", undefined, "Book2"), ds("d3")],
    activeId: "d1",
    selectedIds: [],
    folders: [{ id: "f1", name: "Films", parentId: null, order: 0 }],
    reports: [report("r1", "Fit report")],
    figureDocs: [figureDoc("fd1", "Figure A")],
    originFigures: [],
    history: [],
    future: [],
  });
});

const name = (id: string): string | undefined => useApp.getState().datasets.find((d) => d.id === id)?.name;

describe("Library rename / duplicate / save of reports and publication figures", () => {
  it("renaming a report is its own undo step", () => {
    useApp.getState().renameDataset("d1", "edited.dat");
    renameLibraryNode(node("report", "r1"), "Renamed report");
    useApp.getState().undo();
    expect(useApp.getState().reports[0].name).toBe("Fit report");
    expect(name("d1")).toBe("edited.dat");
  });

  it("renaming a publication figure is its own undo step", () => {
    useApp.getState().renameDataset("d1", "edited.dat");
    renameLibraryNode(node("publication-figure", "fd1"), "Figure B");
    useApp.getState().undo();
    expect(useApp.getState().figureDocs[0].name).toBe("Figure A");
    expect(name("d1")).toBe("edited.dat");
  });

  it("duplicating a publication figure is its own undo step", () => {
    useApp.getState().renameDataset("d1", "edited.dat");
    useApp.getState().duplicateFigureDoc("fd1");
    expect(useApp.getState().figureDocs).toHaveLength(2);
    useApp.getState().undo();
    expect(useApp.getState().figureDocs.map((f) => f.id)).toEqual(["fd1"]);
    expect(name("d1")).toBe("edited.dat");
  });

  it("saving a publication figure is its own undo step", () => {
    useApp.getState().renameDataset("d1", "edited.dat");
    useApp.getState().addFigureDoc(figureDoc("fd2", "Saved"));
    useApp.getState().undo();
    expect(useApp.getState().figureDocs.map((f) => f.id)).toEqual(["fd1"]);
    expect(name("d1")).toBe("edited.dat");
  });
});

describe("bulk move of a dataset multi-selection", () => {
  const runMenu = (label: string): void => {
    const s = useApp.getState();
    const items = buildDatasetRowMenu(s.datasets[0], false, true, s.folders, false, false, () => {}, () => {});
    const item = items.find((i): i is ContextMenuItem & { run: () => void } => "label" in i && i.label === label);
    if (!item) throw new Error(`no menu item "${label}"`);
    item.run();
  };

  it("moving N selected datasets is ONE undo step that puts every one back", () => {
    useApp.setState({ selectedIds: ["d1", "d2", "d3"] });
    const before = useApp.getState().datasets;
    runMenu('Move 3 selected to "Films"');
    expect(useApp.getState().datasets.every((d) => d.folderId === "f1")).toBe(true);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets).toBe(before);
  });

  it("moving N selected datasets back to the top level is ONE undo step", () => {
    useApp.setState({ datasets: [ds("d1", "f1"), ds("d2", "f1")], selectedIds: ["d1", "d2"] });
    const before = useApp.getState().datasets;
    runMenu("Move 2 selected to top level");
    expect(useApp.getState().datasets.every((d) => !d.folderId)).toBe(true);
    useApp.getState().undo();
    expect(useApp.getState().datasets).toBe(before);
  });
});

describe("applying an Origin figure onto the focused plot", () => {
  const figure = {
    id: "fig",
    stem: "XRD",
    datasetId: "d2",
    siblingIds: ["d2"],
    figure: { name: "Graph1", x_from: 0, x_to: 9, x_log: false, y_from: 1, y_to: 1e6, y_log: true, n_curves: 2, annotations: [] as string[] },
  };

  beforeEach(() => {
    useApp.setState({ originFigures: [figure] as unknown as ReturnType<typeof useApp.getState>["originFigures"] });
  });

  it("is ONE undo step that restores the plot's own styling, keeping the earlier edit", () => {
    useApp.getState().setActive("d2");
    useApp.getState().setPlotTitle("my title");
    useApp.getState().setSeriesStyle(0, { color: "#ff0000" });
    const styled = useApp.getState();
    useApp.getState().applyOriginFigure("fig");
    expect(useApp.getState().yScale).toBe("log");
    useApp.getState().undo();
    const s = useApp.getState();
    expect(s.yScale).toBe(styled.yScale);
    expect(s.showGrid).toBe(styled.showGrid);
    expect(s.seriesStyles).toEqual({ 0: { color: "#ff0000" } });
    expect(s.plotTitle).toBe("my title");
  });

  // Curves from two books: the apply materializes an overlay dataset.
  const overlay = {
    id: "fig-ov",
    stem: "XRD",
    datasetId: "d1",
    siblingIds: ["d1", "d2"],
    figure: {
      ...figure.figure,
      curves: [{ book: "Book1", x: "A", y: "B" }, { book: "Book2", x: "A", y: "B" }],
    },
  };

  it("building an overlay in a new window is ONE undo step that removes both", () => {
    useApp.setState({ originFigures: [overlay] as unknown as ReturnType<typeof useApp.getState>["originFigures"] });
    const before = useApp.getState();
    useApp.getState().applyOriginFigure("fig-ov", { newWindow: true });
    expect(useApp.getState().datasets).toHaveLength(before.datasets.length + 1);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets).toBe(before.datasets);
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(before.plotWindows.map((w) => w.id));
  });

  it("re-applying rebuilds the overlay dataset as its own undo step", () => {
    useApp.setState({ originFigures: [overlay] as unknown as ReturnType<typeof useApp.getState>["originFigures"] });
    useApp.getState().applyOriginFigure("fig-ov");
    const built = useApp.getState().datasets.find((d) => d.data.metadata?.origin_overlay_source === "fig-ov")!;
    useApp.getState().renameDataset("d3", "edited.dat");
    useApp.getState().applyOriginFigure("fig-ov");
    expect(useApp.getState().datasets.find((d) => d.id === built.id)).not.toBe(built);
    useApp.getState().undo();
    expect(useApp.getState().datasets.find((d) => d.id === built.id)).toBe(built);
    expect(name("d3")).toBe("edited.dat");
  });
});
