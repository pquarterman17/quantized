import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../overlays/ConfirmDialog";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import DatasetRow from "./DatasetRow";
import { DATASET_DND } from "./dnd";

// GUI_INTERACTION #8: "Remove"/"Remove N selected" now confirm first.
vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const plain: Dataset = {
  id: "plain",
  name: "sample.dat",
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
};

const sheet1: Dataset = {
  id: "sheet1",
  name: "XRD:Book4",
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: { origin_book: "Book4" } },
};

const baseProps = {
  active: false,
  selected: false,
  showReorder: false,
  canMoveUp: false,
  canMoveDown: false,
  onFilterTag: () => {},
};

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, selectedIds: [] });
});

describe("DatasetRow sheet affordance", () => {
  it("renders no sheet chip or indent for an ordinary dataset", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    expect(screen.queryByText(/sheet \d/)).not.toBeInTheDocument();
    expect(container.querySelector(".qzk-ds")).not.toHaveClass("qzk-ds-sheet");
  });

  it("renders no sheet chip for a group's parent (sheet 1, sheetNumber undefined)", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} />);
    expect(screen.queryByText(/sheet \d/)).not.toBeInTheDocument();
    expect(container.querySelector(".qzk-ds")).not.toHaveClass("qzk-ds-sheet");
  });

  it("renders the indent class + 'sheet N' chip for a non-first sheet", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} sheetNumber={2} />);
    expect(screen.getByText(/sheet 2/)).toBeInTheDocument();
    expect(container.querySelector(".qzk-ds")).toHaveClass("qzk-ds-sheet");
  });
});

describe("DatasetRow pending lazy book (ORIGIN_FILE_DECODE_PLAN #38)", () => {
  it("shows the TRUE row/channel counts from `pending`, not the small preview's", () => {
    const lazy: Dataset = {
      id: "lazy1",
      name: "PNR:Book2",
      data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: ["Oe"], metadata: {} },
      pending: { kind: "path", path: "/PNR.opj", bookId: "Book2", rows: 42180, cols: 4 },
    };
    render(<DatasetRow dataset={lazy} {...baseProps} />);
    expect(screen.getByText(/42180 pts/)).toBeInTheDocument();
    expect(screen.getByText("4ch")).toBeInTheDocument();
  });

  it("shows the real (preview) counts for a fully-loaded dataset", () => {
    render(<DatasetRow dataset={plain} {...baseProps} />);
    expect(screen.getByText(/1 pts/)).toBeInTheDocument();
    expect(screen.getByText("1ch")).toBeInTheDocument();
  });
});

describe("DatasetRow activation routing (WORKSHEET_PLAN item 15 — origin book click opens…)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [plain, sheet1],
      activeId: null,
      worksheetId: null,
      selectedIds: [],
      stageTab: "plot",
      originBookClickOpens: "worksheet",
    });
  });

  it("a plain click on a non-Origin row activates it exactly as before (plot-intent)", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!);
    const s = useApp.getState();
    expect(s.activeId).toBe("plain");
    expect(s.worksheetId).toBeNull();
  });

  it("a plain click on an Origin book row opens the Worksheet instead of plotting it (default pref)", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!);
    const s = useApp.getState();
    expect(s.worksheetId).toBe("sheet1");
    expect(s.stageTab).toBe("worksheet");
    expect(s.activeId).toBeNull(); // the plot (nothing, here) is untouched
  });

  it("right-clicking an unselected Origin book row also routes through the worksheet-intent path", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} selected={false} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(useApp.getState().worksheetId).toBe("sheet1");
    expect(useApp.getState().activeId).toBeNull();
  });

  it("'Plot (make active)' in the context menu ALWAYS forces the plot, even for an Origin book", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Plot (make active)"));
    const s = useApp.getState();
    expect(s.activeId).toBe("sheet1");
    expect(s.worksheetId).toBeNull();
  });

  it("the 'plot' preference restores click-to-plot for an Origin book too", () => {
    useApp.setState({ originBookClickOpens: "plot" });
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!);
    expect(useApp.getState().activeId).toBe("sheet1");
    expect(useApp.getState().worksheetId).toBeNull();
  });
});

describe("DatasetRow — PR C: librarySelection clearing + workbookLastChild", () => {
  const inWorkbook: Dataset = { ...plain, id: "wd1", workbookId: "w1" };

  beforeEach(() => {
    useApp.setState({
      datasets: [inWorkbook],
      activeId: null,
      selectedIds: [],
      librarySelection: { kind: "folder", id: "f1" },
      workbookLastChild: {},
    });
  });

  it("a plain click clears any folder/workbook selection and records the opened child", () => {
    const { container } = render(<DatasetRow dataset={inWorkbook} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!);
    expect(useApp.getState().librarySelection).toBeNull();
    expect(useApp.getState().workbookLastChild.w1).toBe("worksheet:wd1");
  });

  it("a ctrl-click (multi-select toggle) also clears librarySelection", () => {
    const { container } = render(<DatasetRow dataset={inWorkbook} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!, { ctrlKey: true });
    expect(useApp.getState().librarySelection).toBeNull();
    expect(useApp.getState().selectedIds).toContain("wd1");
  });

  it("a dataset with no workbookId doesn't record workbookLastChild", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!);
    expect(useApp.getState().workbookLastChild).toEqual({});
  });
});

describe("DatasetRow re-import menu entry (MAIN_PLAN #10)", () => {
  it("labels it 'Re-import from source' and calls reimportDataset for a sourced dataset", () => {
    const withSource: Dataset = { ...plain, id: "src1", source: { kind: "path", path: "/data/x.dat" } };
    useApp.setState({ datasets: [withSource], activeId: null, selectedIds: [] });
    const spy = vi.spyOn(useApp.getState(), "reimportDataset").mockResolvedValue(undefined);
    const { container } = render(<DatasetRow dataset={withSource} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.getByText("Re-import from source")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Re-import from source"));
    expect(spy).toHaveBeenCalledWith("src1");
  });

  it("labels it 'Re-import from file…' for a source-less dataset", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.getByText("Re-import from file…")).toBeInTheDocument();
  });
});

describe("DatasetRow split-by-column-value menu entry (MAIN_PLAN #26)", () => {
  it("opens the split dialog for THIS row's dataset", () => {
    useApp.setState({ datasets: [plain], activeId: null, selectedIds: [] });
    const spy = vi.spyOn(useApp.getState(), "openSplitDialog");
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.getByText("Split by column value…")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Split by column value…"));
    expect(spy).toHaveBeenCalledWith("plain");
  });
});

// jsdom has no real DnD (see AxisDropZones.test.tsx's header note for the
// same workaround this borrows: a hand-built DragEvent dispatched via RTL's
// low-level fireEvent).
function fireDragStart(el: Element, dataTransfer: unknown) {
  const evt = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

describe("DatasetRow — drag starts only from the handle (GUI_INTERACTION_PLAN #13 sub-item 1)", () => {
  it("does not arm a drag from the row body — only the grip handle", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    const handle = container.querySelector(".qzk-drag-handle")!;
    expect(row.getAttribute("draggable")).not.toBe("true");
    expect(handle.getAttribute("draggable")).toBe("true");

    const setData = vi.fn();
    fireDragStart(row, { setData });
    expect(setData).not.toHaveBeenCalled();

    fireDragStart(handle, { setData });
    expect(setData).toHaveBeenCalledWith(DATASET_DND, "plain");
  });

  it("GUI_INTERACTION #3 sub-item 2b: flags activeDrag on dragstart, clears it on dragend", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    const handle = container.querySelector(".qzk-drag-handle")!;
    fireDragStart(handle, { setData: () => {} });
    expect(useApp.getState().activeDrag).toEqual({ kind: "dataset", id: "plain" });
    fireEvent.dragEnd(handle);
    expect(useApp.getState().activeDrag).toBeNull();
  });
});

describe("DatasetRow — Show in folder + path caption (GUI_INTERACTION_PLAN #13 sub-item 2)", () => {
  it("offers 'Show in folder' only for a foldered dataset, and posts revealTarget", () => {
    const foldered: Dataset = { ...plain, id: "f-ds", folderId: "grp" };
    useApp.setState({
      datasets: [foldered],
      folders: [{ id: "grp", name: "Grp", parentId: null, order: 0 }],
      activeId: null,
      selectedIds: [],
    });
    const { container } = render(<DatasetRow dataset={foldered} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.getByText("Show in folder")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show in folder"));
    expect(useApp.getState().revealTarget).toBe("f-ds");
  });

  it("omits 'Show in folder' for a root-level dataset", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.queryByText("Show in folder")).not.toBeInTheDocument();
  });

  it("renders the folder-path caption when supplied", () => {
    render(<DatasetRow dataset={plain} {...baseProps} folderCaption="Samples › Batch3" />);
    expect(screen.getByText("Samples › Batch3")).toBeInTheDocument();
  });

  it("renders no caption by default", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    expect(container.querySelector(".qzk-ds-path")).not.toBeInTheDocument();
  });
});

// PR C review fix: the worksheet→folder drag (a lone DatasetRow dropped onto
// another row or a folder) is RETIRED — the tree places a worksheet by its
// WORKBOOK (lib/libraryHierarchy.ts), not its own `folderId`, so the old
// between-row reorder/move-into-folder drop silently diverged from what the
// tree actually rendered (the same defect class FolderRow's retired
// dataset-onto-folder drop had). The drag handle itself stays live — it's
// still the DATASET_DND SOURCE the plot-window rebind drop target consumes
// (WindowCanvas.tsx/PlotWindowFrame.tsx; see "drag starts only from the
// handle" above) — only this row's role as a DROP TARGET is gone.
describe("DatasetRow — no longer a DATASET_DND drop target (PR C review fix)", () => {
  const dsA: Dataset = { id: "a", name: "a", data: plain.data, folderId: "f1", order: 0 };
  const dsC: Dataset = { id: "c", name: "c", data: plain.data, folderId: "f2", order: 0 };

  beforeEach(() => {
    useApp.setState({
      datasets: [dsA, dsC],
      folders: [
        { id: "f1", name: "F1", parentId: null, order: 0 },
        { id: "f2", name: "F2", parentId: null, order: 1 },
      ],
      activeId: null,
      selectedIds: [],
    });
  });

  it("dropping another dataset row onto this one is a no-op — folderId and order stay put", () => {
    const { container } = render(<DatasetRow dataset={dsA} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    const evt = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "dataTransfer", {
      value: { types: [DATASET_DND], getData: (t: string) => (t === DATASET_DND ? "c" : ""), setData: () => {} },
      configurable: true,
    });
    fireEvent(row, evt);
    expect(useApp.getState().datasets.find((d) => d.id === "c")!.folderId).toBe("f2");
  });
});

describe("DatasetRow bulk move (project-organization plan item 8)", () => {
  const a: Dataset = { id: "a", name: "a", data: plain.data };
  const b: Dataset = { id: "b", name: "b", data: plain.data };
  const c: Dataset = { id: "c", name: "c", data: plain.data };
  const grp = { id: "grp", name: "Grp", parentId: null, order: 0 };

  it("moves the whole multi-selection into the picked folder", () => {
    useApp.setState({
      datasets: [a, b, c],
      folders: [grp],
      activeId: "a",
      selectedIds: ["a", "b"],
    });
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText('Move 2 selected to "Grp"'));
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "a")!.folderId).toBe("grp");
    expect(s.datasets.find((d) => d.id === "b")!.folderId).toBe("grp");
    expect(s.datasets.find((d) => d.id === "c")!.folderId).toBeUndefined();
  });

  it("a lone row keeps the single-dataset move label and behavior", () => {
    useApp.setState({ datasets: [a, b], folders: [grp], activeId: "a", selectedIds: ["a"] });
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText('Move to "Grp"'));
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "a")!.folderId).toBe("grp");
    expect(s.datasets.find((d) => d.id === "b")!.folderId).toBeUndefined();
  });

  it("offers 'Move N selected to top level' for a multi-selection of foldered rows", () => {
    useApp.setState({
      datasets: [
        { ...a, folderId: "grp" },
        { ...b, folderId: "grp" },
      ],
      folders: [grp],
      activeId: "a",
      selectedIds: ["a", "b"],
    });
    const { container } = render(
      <DatasetRow dataset={{ ...a, folderId: "grp" }} {...baseProps} selected />,
    );
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Move 2 selected to top level"));
    const s = useApp.getState();
    expect(s.datasets.every((d) => d.folderId === undefined)).toBe(true);
  });
});

describe("DatasetRow panel/overlay quick picks (MAIN_PLAN #19 v1)", () => {
  const a: Dataset = { id: "a", name: "A", data: plain.data };
  const b: Dataset = { id: "b", name: "B", data: plain.data };

  // Reset plotWindows to the ≥1-window invariant's singleton default before
  // each test — otherwise a panel window opened by one test would linger and
  // be mistaken for the next test's window.
  beforeEach(() => {
    const s = useApp.getState();
    useApp.setState({ plotWindows: [s.plotWindows[0]], focusedWindowId: s.plotWindows[0].id });
  });

  it("is absent for a single selection (gated at >=2)", () => {
    useApp.setState({ datasets: [a], activeId: "a", selectedIds: ["a"] });
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.queryByText("Panel: side by side")).not.toBeInTheDocument();
    expect(screen.queryByText("Overlay in one plot")).not.toBeInTheDocument();
  });

  it("offers all 4 panel/overlay quick picks + Plot selected together for a >=2 multi-selection", () => {
    useApp.setState({ datasets: [a, b], activeId: "a", selectedIds: ["a", "b"] });
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.getByText("Panel: side by side")).toBeInTheDocument();
    expect(screen.getByText("Panel: stacked")).toBeInTheDocument();
    expect(screen.getByText("Panel: grid")).toBeInTheDocument();
    expect(screen.getByText("Overlay in one plot")).toBeInTheDocument();
    // PLOT_WORKFLOW_PLAN #3 — distinct from "Overlay in one plot" above (a
    // composite panel window): this merges the selection into ONE real
    // Library dataset.
    expect(screen.getByText("Plot selected together")).toBeInTheDocument();
  });

  it("'Overlay in one plot' opens a new kind:'panel' overlay window over the selection, raised on top", () => {
    useApp.setState({ datasets: [a, b], activeId: "a", selectedIds: ["a", "b"] });
    const before = useApp.getState().plotWindows.length;
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Overlay in one plot"));
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(before + 1);
    const win = s.plotWindows.find((w) => w.kind === "panel")!;
    expect(win.panel).toEqual({ datasetIds: ["a", "b"], layout: "overlay" });
    // A panel window (like snapshot/worksheet/map) can never hold the
    // view-facade focus — the quick pick's focusWindow call only RAISES it
    // (highest z), matching every other non-plot window kind.
    expect(win.z).toBe(Math.max(...s.plotWindows.map((w) => w.z)));
  });

  it("'Panel: grid' opens a grid-layout composite window", () => {
    useApp.setState({ datasets: [a, b], activeId: "a", selectedIds: ["a", "b"] });
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Panel: grid"));
    const win = useApp.getState().plotWindows.find((w) => w.kind === "panel")!;
    expect(win.panel?.layout).toBe("grid");
  });

  it("'Plot selected together' merges the selection into one new overlay dataset and makes it active", async () => {
    useApp.setState({ datasets: [a, b], activeId: "a", selectedIds: ["a", "b"] });
    const before = useApp.getState().datasets.length;
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Plot selected together"));
    await waitFor(() => expect(useApp.getState().datasets.length).toBe(before + 1));
    const s = useApp.getState();
    const created = s.datasets.find((d) => d.id !== "a" && d.id !== "b")!;
    expect(created.data.labels).toEqual(["A", "B"]); // one curve per dataset, labelled by name
    expect(s.activeId).toBe(created.id); // lands as the active plot, same as Origin apply's overlay
  });
});

describe("DatasetRow — keyboard-reachable context menu (GUI_INTERACTION #8)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [plain], activeId: null, selectedIds: [] });
  });

  it("is focusable and opens the SAME menu on the ContextMenu key", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    expect(row).toHaveAttribute("tabindex", "0");
    expect(screen.queryByText("Duplicate")).toBeNull();
    fireEvent.keyDown(row, { key: "ContextMenu" });
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
  });

  it("also opens on Shift+F10", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.keyDown(container.querySelector(".qzk-ds")!, { key: "F10", shiftKey: true });
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
  });

  it("ignores an unrelated key", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.keyDown(container.querySelector(".qzk-ds")!, { key: "Enter" });
    expect(screen.queryByText("Duplicate")).toBeNull();
  });

  it("the resting-cue '⋯' button opens the same menu", () => {
    render(<DatasetRow dataset={plain} {...baseProps} />);
    expect(screen.queryByText("Duplicate")).toBeNull();
    fireEvent.click(screen.getByTitle("More actions"));
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
  });
});

describe("DatasetRow — destructive Remove confirms first (GUI_INTERACTION #8)", () => {
  beforeEach(() => {
    vi.mocked(askConfirm).mockReset();
    useApp.setState({ datasets: [plain], activeId: null, selectedIds: [] });
  });

  it("declining the confirm leaves the dataset in place", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Remove"));
    expect(askConfirm).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["plain"]);
  });

  it("confirming removes the dataset", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Remove"));
    await Promise.resolve();
    expect(useApp.getState().datasets).toEqual([]);
  });

  // GUI_INTERACTION #17: the row's footer "✕" icon button called
  // removeDataset() straight on the store, so the SAME irreversible deletion
  // had a confirmed path (this menu entry) and an unconfirmed one (the icon).
  // Both now route through the one registry action. Pinned from both sides so
  // a future refactor can't silently re-open the hole.
  it("the ✕ icon button ALSO confirms before removing", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.click(screen.getByLabelText(`Remove ${plain.name}`));
    expect(askConfirm).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["plain"]);
  });

  it("the ✕ icon button removes once confirmed", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.click(screen.getByLabelText(`Remove ${plain.name}`));
    await Promise.resolve();
    expect(useApp.getState().datasets).toEqual([]);
  });

  it("names the dataset in the icon button's confirm, like the menu entry does", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.click(screen.getByLabelText(`Remove ${plain.name}`));
    expect(vi.mocked(askConfirm).mock.calls[0][0]).toContain(plain.name);
  });
});
