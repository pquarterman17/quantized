// project-organization plan item 3b: folder-onto-folder drag (reparent via the
// middle band, reposition-as-sibling via the top/bottom edge bands) plus the
// pre-existing dataset-onto-folder-header "drop into" behavior. jsdom has no
// real DnD or layout — see AxisDropZones.test.tsx's header note for the same
// workaround this borrows: a hand-built DragEvent with clientX/clientY +
// dataTransfer, dispatched via RTL's low-level fireEvent, plus a mocked
// getBoundingClientRect.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FolderRow from "./FolderRow";
import { DATASET_DND, FOLDER_DND } from "./useLibraryTree";
import { askConfirm } from "../overlays/ConfirmDialog";
import { childFolders } from "../../lib/foldertree";
import type { Dataset, FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";

// GUI_INTERACTION #8: destructive registry actions (Delete folder [+
// datasets]) now confirm first — stub the shared ConfirmDialog like every
// other askConfirm-gated store test does (see store/useApp.test.ts).
vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

function folderTransfer(id: string) {
  return {
    types: [FOLDER_DND],
    getData: (t: string) => (t === FOLDER_DND ? id : ""),
    setData: () => {},
  };
}
function datasetTransfer(id: string) {
  return {
    types: [DATASET_DND],
    getData: (t: string) => (t === DATASET_DND ? id : ""),
    setData: () => {},
  };
}

function fireDrag(el: Element, type: "dragover" | "drop", clientY: number, dataTransfer: unknown) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clientX", { value: 10, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

function fireDragStart(el: Element, dataTransfer: unknown) {
  const evt = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

// height 40 → edge band = min(40/3, max(6, 10)) = 10: above y<110, into
// 110<=y<=130, below y>130 (rect top pinned at 100 by setRowRect).
function setRowRect(el: Element) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 100,
    height: 40,
    bottom: 140,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: 100,
    toJSON: () => "",
  } as DOMRect);
}

const fld = (id: string, parentId: string | null, order: number): FolderNode => ({
  id,
  name: id,
  parentId,
  order,
});
const ds = (id: string, folderId?: string): Dataset => ({
  id,
  name: id,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  ...(folderId ? { folderId } : {}),
});

const baseProps = { depth: 0, count: 0, expanded: false };

describe("FolderRow — dataset drop (pre-existing whole-row target)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("d1")],
      folders: [fld("target", null, 0)],
      expandedFolders: [],
    });
  });

  it("moves a dropped dataset into this folder and expands it", () => {
    const { container } = render(<FolderRow folder={fld("target", null, 0)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    fireDrag(row, "drop", 0, datasetTransfer("d1"));
    expect(useApp.getState().datasets[0].folderId).toBe("target");
    expect(useApp.getState().expandedFolders).toContain("target");
  });
});

describe("FolderRow — folder drop (project-organization plan item 3b)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [],
      folders: [fld("a", null, 0), fld("b", null, 1), fld("c", null, 2)],
      expandedFolders: [],
    });
  });

  it("shows dropinto for the middle band and drop-above/below for the edge bands", () => {
    const { container } = render(<FolderRow folder={fld("b", null, 1)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    setRowRect(row);
    fireDrag(row, "dragover", 105, folderTransfer("c")); // top edge
    expect(row).toHaveClass("drop-above");
    fireDrag(row, "dragover", 120, folderTransfer("c")); // middle
    expect(row).toHaveClass("dropinto");
    fireDrag(row, "dragover", 135, folderTransfer("c")); // bottom edge
    expect(row).toHaveClass("drop-below");
  });

  it("reparents into the target on a middle-band drop", () => {
    const { container } = render(<FolderRow folder={fld("b", null, 1)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    setRowRect(row);
    fireDrag(row, "drop", 120, folderTransfer("c")); // middle band → "into"
    const s = useApp.getState();
    expect(s.folders.find((f) => f.id === "c")!.parentId).toBe("b");
    expect(s.expandedFolders).toContain("b");
  });

  it("repositions as a sibling before the target on a top-edge drop", () => {
    const { container } = render(<FolderRow folder={fld("b", null, 1)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    setRowRect(row);
    fireDrag(row, "drop", 105, folderTransfer("c")); // top edge → "above"
    const s = useApp.getState();
    expect(childFolders(s.folders, null).map((f) => f.id)).toEqual(["a", "c", "b"]);
  });

  it("repositions as a sibling after the target on a bottom-edge drop", () => {
    const { container } = render(<FolderRow folder={fld("a", null, 0)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    setRowRect(row);
    fireDrag(row, "drop", 135, folderTransfer("c")); // bottom edge → "below"
    const s = useApp.getState();
    expect(childFolders(s.folders, null).map((f) => f.id)).toEqual(["a", "c", "b"]);
  });

  it("dropping a folder onto itself is a no-op", () => {
    const { container } = render(<FolderRow folder={fld("a", null, 0)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    setRowRect(row);
    fireDrag(row, "drop", 120, folderTransfer("a"));
    expect(childFolders(useApp.getState().folders, null).map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("dropping a folder into its own descendant is a silent no-op (cycle guard)", () => {
    useApp.setState({
      folders: [fld("parent", null, 0), fld("child", "parent", 0)],
    });
    const { container } = render(<FolderRow folder={fld("child", "parent", 0)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    setRowRect(row);
    fireDrag(row, "drop", 120, folderTransfer("parent")); // parent dropped INTO its own child
    const s = useApp.getState();
    // Unchanged: "parent" is still the root, "child" still its child.
    expect(s.folders.find((f) => f.id === "parent")!.parentId).toBeNull();
    expect(s.folders.find((f) => f.id === "child")!.parentId).toBe("parent");
  });

  it("ignores an unrelated drag type", () => {
    const { container } = render(<FolderRow folder={fld("b", null, 1)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    setRowRect(row);
    const foreign = { types: ["Files"], getData: () => "", setData: () => {} };
    fireDrag(row, "dragover", 120, foreign);
    expect(row).not.toHaveClass("dropinto");
    expect(row).not.toHaveClass("drop-above");
    expect(row).not.toHaveClass("drop-below");
  });
});

describe("FolderRow — drag starts only from the handle (GUI_INTERACTION_PLAN #13 sub-item 1)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], folders: [fld("a", null, 0)], expandedFolders: [] });
  });

  it("does not arm a drag from the header body — only the grip handle", () => {
    const { container } = render(<FolderRow folder={fld("a", null, 0)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    const handle = container.querySelector(".qzk-drag-handle")!;
    expect(row.getAttribute("draggable")).not.toBe("true");
    expect(handle.getAttribute("draggable")).toBe("true");

    const setData = vi.fn();
    fireDragStart(row, { setData });
    expect(setData).not.toHaveBeenCalled();

    fireDragStart(handle, { setData });
    expect(setData).toHaveBeenCalledWith(FOLDER_DND, "a");
  });
});

describe("FolderRow — Properties dialog (GUI_INTERACTION_PLAN #13 sub-item 4)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], folders: [fld("a", null, 0)], expandedFolders: [] });
  });

  it("offers 'Properties…' in the context menu", () => {
    const { container } = render(<FolderRow folder={fld("a", null, 0)} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-folder-head")!);
    expect(screen.getByText("Properties…")).toBeInTheDocument();
  });

  it("tints the caret when the folder has a colour set", () => {
    const colored = { ...fld("a", null, 0), color: "amber" };
    const { container } = render(<FolderRow folder={colored} {...baseProps} />);
    const caret = container.querySelector(".qzk-group-caret") as HTMLElement;
    expect(caret.style.color).toBeTruthy();
  });
});

describe("FolderRow — bulk-ops context menu (project-organization plan item 8)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("d1", "grp"), ds("d2", "grp"), ds("d3")],
      folders: [fld("grp", null, 0)],
      activeId: "d3",
      selectedIds: ["d3"],
      expandedFolders: [],
    });
    localStorage.clear();
  });

  const open = (folder: FolderNode, count: number) => {
    const { container } = render(<FolderRow folder={folder} depth={0} count={count} expanded={false} />);
    fireEvent.contextMenu(container.querySelector(".qzk-folder-head")!);
  };

  it("offers the bulk ops; 'Select all' replaces the selection without moving the plot", () => {
    open(fld("grp", null, 0), 2);
    expect(screen.getByText("Export folder as consolidated CSV")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Select all in folder (2)"));
    expect(useApp.getState().selectedIds).toEqual(["d1", "d2"]);
    expect(useApp.getState().activeId).toBe("d3"); // plot unaffected
  });

  it("'Delete folder + N dataset(s)' confirms, then destroys the folder and its datasets", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    open(fld("grp", null, 0), 2);
    fireEvent.click(screen.getByText("Delete folder + 2 dataset(s)"));
    expect(askConfirm).toHaveBeenCalledOnce();
    await Promise.resolve(); // flush the askConfirm promise
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["d3"]);
    expect(s.folders).toEqual([]);
  });

  it("declining the confirm leaves the folder and its datasets untouched", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    open(fld("grp", null, 0), 2);
    fireEvent.click(screen.getByText("Delete folder + 2 dataset(s)"));
    await Promise.resolve();
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id).sort()).toEqual(["d1", "d2", "d3"]);
    expect(s.folders.map((f) => f.id)).toEqual(["grp"]);
  });

  it("gates the bulk items on an empty folder", () => {
    useApp.setState({ datasets: [], folders: [fld("empty", null, 0)] });
    open(fld("empty", null, 0), 0);
    // GUI_INTERACTION #8: menu items carry role="menuitem" now, not the
    // button's implicit "button" role.
    expect(screen.getByRole("menuitem", { name: "Select all in folder (0)" })).toBeDisabled();
    expect(screen.queryByText(/Delete folder \+/)).not.toBeInTheDocument();
    // No corrections on the active dataset / no saved templates → gated items absent.
    expect(screen.queryByText(/Apply active corrections/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Run analysis template/)).not.toBeInTheDocument();
  });

  it("offers the template run only when a saved template exists", () => {
    localStorage.setItem(
      "qz.analysisTemplates",
      JSON.stringify([
        {
          version: 1,
          name: "T",
          steps: [{ id: "", kind: "fit", label: "Fit", code: "qz.fit()", params: { model: "Linear" } }],
          outputs: ["R2"],
        },
      ]),
    );
    open(fld("grp", null, 0), 2);
    expect(screen.getByText("Run analysis template on folder…")).toBeInTheDocument();
  });
});

describe("FolderRow — keyboard-reachable context menu (GUI_INTERACTION #8)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], folders: [fld("a", null, 0)], expandedFolders: [] });
  });

  it("is focusable and opens the SAME menu on the ContextMenu key", () => {
    const { container } = render(<FolderRow folder={fld("a", null, 0)} {...baseProps} />);
    const row = container.querySelector(".qzk-folder-head")!;
    expect(row).toHaveAttribute("tabindex", "0");
    expect(screen.queryByText("Properties…")).toBeNull();
    fireEvent.keyDown(row, { key: "ContextMenu" });
    expect(screen.getByText("Properties…")).toBeInTheDocument();
  });

  it("also opens on Shift+F10", () => {
    const { container } = render(<FolderRow folder={fld("a", null, 0)} {...baseProps} />);
    fireEvent.keyDown(container.querySelector(".qzk-folder-head")!, { key: "F10", shiftKey: true });
    expect(screen.getByText("Properties…")).toBeInTheDocument();
  });

  it("the resting-cue '⋯' button opens the same menu", () => {
    render(<FolderRow folder={fld("a", null, 0)} {...baseProps} />);
    expect(screen.queryByText("Properties…")).toBeNull();
    fireEvent.click(screen.getByTitle("More actions"));
    expect(screen.getByText("Properties…")).toBeInTheDocument();
  });
});
