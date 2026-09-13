// L1.4 interaction parity for the TILE renderer: drag/drop must mean in Tiles
// exactly what it means in Details and in the Tree, through the SAME payload
// types, the SAME legality rules, the SAME cue classes and the SAME two store
// actions. Deliberately shaped as a mirror of LibraryDetails.parity.test.tsx's
// drag/drop block, assertion for assertion, so a future divergence shows up as
// a diff between two files rather than as a silent behaviour gap.
//
// These render the real <LibraryWorkspace> over a store-backed hierarchy, so a
// move is asserted at the layer the user experiences: the store changed AND
// the moved tile left the container it was in.
//
// jsdom has no real drag-and-drop, so drag events are hand-built with a fake
// `dataTransfer` and dispatched through RTL's low-level fireEvent — the same
// workaround FolderRow.test.tsx and LibraryDetails.parity.test.tsx use.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryWorkspace from "./LibraryWorkspace";
import { DATASET_DND, FOLDER_DND, WORKBOOK_DND } from "./dnd";
import { VIRTUALIZE_ABOVE } from "./useTileVirtualization";
import type { Dataset, FolderNode } from "../../lib/types";
import { declares, flatRules, reachesOnHover, readShellCss } from "../../styles/cssRules.testkit";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const worksheet = (id: string, workbookId: string, order = 0): Dataset => ({
  id,
  name: `${id}.csv`,
  workbookId,
  order,
  data: { time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: {} },
});

const folder = (id: string, name: string, parentId: string | null, order: number): FolderNode => ({
  id,
  name,
  parentId,
  order,
});

beforeEach(() => {
  useApp.setState({
    // A root container holding two folder tiles and one unfoldered workbook
    // tile — the Details fixture's shape (Alpha / Beta / Run) in tile form.
    datasets: [worksheet("a", "w")],
    workbooks: [{ id: "w", name: "Run" }],
    folders: [folder("f1", "Alpha", null, 0), folder("f2", "Beta", null, 1)],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    selectedIds: [],
    librarySelection: null,
    activeId: null,
    expandedFolders: ["f1", "f2"],
    expandedWorkbookIds: ["w"],
    revealTarget: null,
    workbookLastChild: {},
    figurePageOpen: false,
    cmdkOpen: false,
    confirmRemove: false,
    trash: [],
    history: [],
    activeDrag: null,
  });
});

const tileFor = (key: string): HTMLElement =>
  document.querySelector(`[data-library-tile="${key}"]`) as HTMLElement;

const gripOf = (key: string): HTMLElement =>
  tileFor(key).querySelector(".qzk-drag-handle") as HTMLElement;

const applyToStore = (change: () => void): void => act(() => { change(); });

function transfer(type: string, id: string) {
  return { types: [type], getData: (t: string) => (t === type ? id : ""), setData: () => {}, effectAllowed: "" };
}

/** Dispatch one drag event; returns false when a handler called
 *  preventDefault — which for `dragover` is precisely "this target ACCEPTS the
 *  drop" (a real browser fires no drop event without it). */
function fireDrag(el: Element, type: "dragstart" | "dragover" | "dragend" | "drop", dataTransfer: unknown): boolean {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  return fireEvent(el, evt);
}

/** dragstart on the source tile's grip, then dragover the destination tile.
 *  Returns whether the destination ACCEPTED the drag. */
function beginDragOver(sourceKey: string, destKey: string, type: string, id: string): boolean {
  const payload = transfer(type, id);
  fireDrag(gripOf(sourceKey), "dragstart", payload);
  return !fireDrag(tileFor(destKey), "dragover", payload);
}

/** The full Tree-equivalent drag: grip dragstart (which publishes activeDrag,
 *  the signal a drop target consults during dragover) then dragover + drop on
 *  the destination tile. */
function dragTileOnto(sourceKey: string, destKey: string, type: string, id: string): void {
  const payload = transfer(type, id);
  fireDrag(gripOf(sourceKey), "dragstart", payload);
  fireDrag(tileFor(destKey), "dragover", payload);
  fireDrag(tileFor(destKey), "drop", payload);
}

describe("LibraryTiles — L1.4 drag source parity", () => {
  it("only the grip starts a drag — the tile body is not draggable (Tree/Details convention)", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const tile = tileFor("workbook:w");

    expect(tile).not.toHaveAttribute("draggable");
    expect(gripOf("workbook:w")).toHaveAttribute("draggable", "true");
    // The grip is the ONLY draggable element anywhere in the grid.
    const draggables = [...document.querySelectorAll("[draggable='true']")];
    expect(draggables.every((el) => el.classList.contains("qzk-drag-handle"))).toBe(true);
    // Every kind the Tree/Details can drag has a grip here too: folders,
    // workbooks and (below, in its own container) worksheets.
    expect(gripOf("folder:f1")).not.toBeNull();
    expect(gripOf("folder:f2")).not.toBeNull();
  });

  it("a worksheet tile is a drag source publishing the Tree's DATASET_DND payload", () => {
    applyToStore(() => useApp.setState({ librarySelection: { kind: "workbook", id: "w" } }));
    render(<LibraryWorkspace onClose={vi.fn()} />);

    const grip = gripOf("worksheet:a");
    expect(grip).toHaveAttribute("draggable", "true");
    const setData = vi.fn();
    fireDrag(grip, "dragstart", { types: [], getData: () => "", setData, effectAllowed: "" });
    expect(setData).toHaveBeenCalledWith(DATASET_DND, "a");
    expect(useApp.getState().activeDrag).toEqual({ kind: "dataset", id: "a" });
  });

  it("the grip publishes the kind-matched payload for folders and workbooks", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);

    const wbSet = vi.fn();
    fireDrag(gripOf("workbook:w"), "dragstart", { types: [], getData: () => "", setData: wbSet, effectAllowed: "" });
    expect(wbSet).toHaveBeenCalledWith(WORKBOOK_DND, "w");
    expect(useApp.getState().activeDrag).toEqual({ kind: "workbook", id: "w" });

    const fSet = vi.fn();
    fireDrag(gripOf("folder:f2"), "dragstart", { types: [], getData: () => "", setData: fSet, effectAllowed: "" });
    expect(fSet).toHaveBeenCalledWith(FOLDER_DND, "f2");
    expect(useApp.getState().activeDrag).toEqual({ kind: "folder", id: "f2" });
  });

  it("the grip neither selects the tile nor browses into it nor opens it", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const grip = gripOf("folder:f1");

    fireEvent.click(grip);
    fireEvent.doubleClick(grip);

    // A tile-body click would have selected f1 AND navigated the workspace
    // into it; a double-click would have toggled its disclosure.
    expect(useApp.getState().librarySelection).toBeNull();
    expect(screen.getByRole("list", { name: "Project items" })).toBeInTheDocument();
    expect(useApp.getState().expandedFolders).toEqual(["f1", "f2"]);
  });

  it("the grip is not a tab stop, so the grid's roving keyboard model is untouched", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);

    expect(gripOf("folder:f1")).not.toHaveAttribute("tabindex");
    expect(gripOf("folder:f1")).toHaveAttribute("aria-hidden", "true");
    // Exactly one tile carries the grid's tab stop, as before the grip existed.
    const tabbable = [...document.querySelectorAll("[data-library-tile]")].filter(
      (el) => el.getAttribute("tabindex") === "0",
    );
    expect(tabbable).toHaveLength(1);
  });
});

describe("LibraryTiles — L1.4 drop target parity", () => {
  it("dragging a workbook tile onto a folder tile moves it, in the store AND on screen", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    expect(tileFor("workbook:w")).not.toBeNull();

    dragTileOnto("workbook:w", "folder:f2", WORKBOOK_DND, "w");

    // The SAME store action Details' drop and the Tree's FolderRow call.
    expect(useApp.getState().workbooks.find((wb) => wb.id === "w")!.folderId).toBe("f2");
    // …and the tile left the root container it was in.
    expect(tileFor("workbook:w")).toBeNull();
  });

  it("dragging a folder tile onto another folder tile reparents it", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);

    dragTileOnto("folder:f2", "folder:f1", FOLDER_DND, "f2");

    expect(useApp.getState().folders.find((f) => f.id === "f2")!.parentId).toBe("f1");
    expect(tileFor("folder:f2")).toBeNull();
  });

  it("the menu's Move to … and the drag reach the same destination", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    fireEvent.contextMenu(tileFor("workbook:w"), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByText('Move to "Beta"'));
    expect(useApp.getState().workbooks.find((wb) => wb.id === "w")!.folderId).toBe("f2");
  });

  it("the hovered target shows `dropinto` while every OTHER legal target rests at `drop-candidate`", () => {
    applyToStore(() =>
      useApp.setState({ folders: [...useApp.getState().folders, folder("f3", "Gamma", null, 2)] }),
    );
    render(<LibraryWorkspace onClose={vi.fn()} />);

    expect(beginDragOver("folder:f2", "folder:f1", FOLDER_DND, "f2")).toBe(true);
    expect(tileFor("folder:f1").className).toContain("dropinto");
    expect(tileFor("folder:f1").className).not.toContain("drop-candidate");
    expect(tileFor("folder:f3").className).toContain("drop-candidate");
    expect(tileFor("folder:f3").className).not.toContain("dropinto");
    // The dragged folder is never a candidate for itself…
    expect(tileFor("folder:f2").className).toBe("qzk-library-tile");
    // …nor is a tile that cannot accept a move at all.
    expect(tileFor("workbook:w").className).toBe("qzk-library-tile");
  });

  it("a drop on a NON-folder tile is refused: no cue, no move, no undo step", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const historyBefore = useApp.getState().history.length;

    // A folder dragged onto the WORKBOOK tile — only folders accept a move.
    expect(beginDragOver("folder:f2", "workbook:w", FOLDER_DND, "f2")).toBe(false);
    expect(tileFor("workbook:w").className).not.toContain("drop-candidate");
    expect(tileFor("workbook:w").className).not.toContain("dropinto");
    fireDrag(tileFor("workbook:w"), "drop", transfer(FOLDER_DND, "f2"));

    expect(useApp.getState().folders.find((f) => f.id === "f2")!.parentId).toBeNull();
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  // Selection note: unlike the Details fixture, a worksheet multi-selection
  // cannot be held on screen here — selecting one NAVIGATES the tile
  // workspace into its workbook (LibraryWorkspace's sidebar-follows-selection
  // effect), so the folder tiles under test would unmount. The drag's
  // selection invariant is asserted instead in "a drag of a SELECTED
  // worksheet tile moves only that node", which keeps a live two-worksheet
  // selection across a dragstart. What is checked here is that a refused drop
  // writes NO selection of its own.
  it("a folder dropped on ITSELF is refused, leaving placement, undo stack and selection untouched", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const selectedBefore = [...useApp.getState().selectedIds];
    const selectionBefore = useApp.getState().librarySelection;
    const historyBefore = useApp.getState().history.length;

    expect(beginDragOver("folder:f2", "folder:f2", FOLDER_DND, "f2")).toBe(false);
    expect(tileFor("folder:f2").className).not.toContain("drop-candidate");
    fireDrag(tileFor("folder:f2"), "drop", transfer(FOLDER_DND, "f2"));

    expect(useApp.getState().folders.find((f) => f.id === "f2")!.parentId).toBeNull();
    expect(useApp.getState().history).toHaveLength(historyBefore);
    expect(useApp.getState().selectedIds).toEqual(selectedBefore);
    expect(useApp.getState().librarySelection).toEqual(selectionBefore);
  });

  it("a folder dropped on its OWN DESCENDANT is refused the same way", () => {
    applyToStore(() =>
      useApp.setState({ folders: [...useApp.getState().folders, folder("f3", "Child", "f2", 0)] }),
    );
    render(<LibraryWorkspace onClose={vi.fn()} />);
    // Browse into f2 so its child folder tile is on screen.
    fireEvent.click(tileFor("folder:f2"));
    const historyBefore = useApp.getState().history.length;

    const payload = transfer(FOLDER_DND, "f2");
    // f2's own grip is not rendered inside f2, so publish the drag directly
    // from the store the way its dragstart would have.
    applyToStore(() => useApp.getState().setActiveDrag({ kind: "folder", id: "f2" }));
    expect(fireDrag(tileFor("folder:f3"), "dragover", payload)).toBe(true); // not accepted
    fireDrag(tileFor("folder:f3"), "drop", payload);

    expect(useApp.getState().folders.find((f) => f.id === "f2")!.parentId).toBeNull();
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("dropping a workbook on the folder it is ALREADY in records no undo step", () => {
    applyToStore(() => useApp.setState({ workbooks: [{ id: "w", name: "Run", folderId: "f1" }] }));
    render(<LibraryWorkspace onClose={vi.fn()} />);
    // Browse into Alpha, where the workbook tile now lives, then drag it back
    // onto Alpha via the breadcrumb-less route: publish the drag and drop on
    // the folder tile at root.
    const historyBefore = useApp.getState().history.length;
    applyToStore(() => useApp.getState().setActiveDrag({ kind: "workbook", id: "w" }));
    fireDrag(tileFor("folder:f1"), "dragover", transfer(WORKBOOK_DND, "w"));
    fireDrag(tileFor("folder:f1"), "drop", transfer(WORKBOOK_DND, "w"));

    expect(useApp.getState().workbooks.find((wb) => wb.id === "w")!.folderId).toBe("f1");
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("a bare `drop` with no drag in flight is refused (the drop handler re-decides for itself)", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const historyBefore = useApp.getState().history.length;

    // No dragstart at all: activeDrag is null, so nothing is legal here.
    fireDrag(tileFor("folder:f2"), "drop", transfer(WORKBOOK_DND, "w"));

    expect(useApp.getState().workbooks.find((wb) => wb.id === "w")!.folderId).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("a CANCELLED drag (dragstart then dragend, no drop) writes nothing at all", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const historyBefore = useApp.getState().history.length;

    const payload = transfer(WORKBOOK_DND, "w");
    fireDrag(gripOf("workbook:w"), "dragstart", payload);
    expect(useApp.getState().activeDrag).toEqual({ kind: "workbook", id: "w" });
    fireDrag(gripOf("workbook:w"), "dragend", payload);

    expect(useApp.getState().activeDrag).toBeNull();
    expect(useApp.getState().workbooks.find((wb) => wb.id === "w")!.folderId).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("a drag of a SELECTED worksheet tile moves only that node — Details does the same", () => {
    // Details' drag carries one entityId in one dataTransfer slot and has no
    // multi-selection variant; Tiles mirrors that exactly rather than
    // inventing a bulk drag Details and the Tree do not have. The keyboard/AT
    // and menu route to a bulk move stays "Move N selected to …".
    applyToStore(() => useApp.setState({ librarySelection: { kind: "workbook", id: "w" } }));
    applyToStore(() =>
      useApp.setState({ datasets: [worksheet("a", "w", 0), worksheet("b", "w", 1)] }),
    );
    render(<LibraryWorkspace onClose={vi.fn()} />);
    applyToStore(() => useApp.getState().selectIds(["a", "b"]));

    const setData = vi.fn();
    fireDrag(gripOf("worksheet:a"), "dragstart", { types: [], getData: () => "", setData, effectAllowed: "" });

    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith(DATASET_DND, "a");
    expect(useApp.getState().activeDrag).toEqual({ kind: "dataset", id: "a" });
    // The selection is untouched by the drag.
    expect(useApp.getState().selectedIds).toEqual(["a", "b"]);
  });

  it("right-click on an ALREADY-SELECTED tile keeps the multi-selection (Details' selectForMenu rule)", () => {
    applyToStore(() => useApp.setState({ librarySelection: { kind: "workbook", id: "w" } }));
    applyToStore(() =>
      useApp.setState({ datasets: [worksheet("a", "w", 0), worksheet("b", "w", 1)] }),
    );
    render(<LibraryWorkspace onClose={vi.fn()} />);
    applyToStore(() => useApp.getState().selectIds(["a", "b"]));

    fireEvent.contextMenu(tileFor("worksheet:a"), { clientX: 5, clientY: 5 });

    expect(useApp.getState().selectedIds).toEqual(["a", "b"]);
  });
});

describe("LibraryTiles — L1.4 drag under virtualization", () => {
  const MANY = VIRTUALIZE_ABOVE + 20;

  /** A workbook container holding enough worksheets to virtualize. */
  function seedVirtualized(): void {
    useApp.setState({
      datasets: Array.from({ length: MANY }, (_, i) => worksheet(`ws${i}`, "w", i)),
      librarySelection: { kind: "workbook", id: "w" },
    });
  }

  it("a drag whose SOURCE tile is virtualized out mid-drag cancels cleanly and never throws", () => {
    applyToStore(seedVirtualized);
    render(<LibraryWorkspace onClose={vi.fn()} />);
    expect(tileFor("worksheet:ws0")).not.toBeNull();

    fireDrag(gripOf("worksheet:ws0"), "dragstart", transfer(DATASET_DND, "ws0"));
    expect(useApp.getState().activeDrag).toEqual({ kind: "dataset", id: "ws0" });

    // Scroll far enough that the source tile's row leaves the window and
    // unmounts — the browser then has no element left to fire `dragend` on.
    const scroller = document.querySelector(".qzk-library-workspace") as HTMLElement;
    expect(() =>
      act(() => {
        scroller.scrollTop = 4000;
        fireEvent.scroll(scroller);
      }),
    ).not.toThrow();

    expect(tileFor("worksheet:ws0")).toBeNull();
    // Cancelled cleanly: nothing is left glowing as a drop candidate.
    expect(useApp.getState().activeDrag).toBeNull();
  });

  it("an unmount during someone ELSE's drag clears nothing", () => {
    applyToStore(seedVirtualized);
    render(<LibraryWorkspace onClose={vi.fn()} />);

    // A drag that belongs to a node which is NOT in the rendered window.
    applyToStore(() => useApp.getState().setActiveDrag({ kind: "folder", id: "f1" }));
    const scroller = document.querySelector(".qzk-library-workspace") as HTMLElement;
    act(() => {
      scroller.scrollTop = 4000;
      fireEvent.scroll(scroller);
    });

    expect(useApp.getState().activeDrag).toEqual({ kind: "folder", id: "f1" });
  });
});

describe("LibraryTiles — L1.4 cues are painted, not just classed", () => {
  // The same three helpers and the same sheet the Details parity test uses
  // (styles/cssRules.testkit.ts) — a drifted copy of "does any rule actually
  // paint this cue?" is not evidence.
  const SHELL_CSS = readShellCss();

  it("the tile grip is hidden at rest AND revealed by a rule that reaches it on tile hover", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const grip = gripOf("workbook:w");
    const rules = flatRules(SHELL_CSS);

    expect(
      rules.filter((r) => declares(r.body, "opacity", "0") && reachesOnHover(r.selector, grip)).length,
    ).toBeGreaterThan(0);
    const revealing = rules
      .filter((r) => declares(r.body, "opacity", "1") && reachesOnHover(r.selector, grip))
      .map((r) => r.selector);
    expect(revealing, "no stylesheet rule raises the Tiles grip's opacity — it is invisible").not.toEqual([]);
  });

  it("the grip is positioned OUT OF FLOW so it cannot change the measured tile height", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const grip = gripOf("workbook:w");
    const tile = tileFor("workbook:w");
    const rules = flatRules(SHELL_CSS);
    const declared = (el: Element, prop: string): string[] =>
      rules
        .filter((r) => reachesOnHover(r.selector, el))
        .flatMap((r) => {
          const m = r.body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`));
          return m ? [m[1].trim()] : [];
        });

    // useTileVirtualization sizes its spacers from tile offsetHeight, so an
    // in-flow grip would shift every row estimate.
    expect(declared(grip, "position")).toContain("absolute");
    // …which only works if the tile is the containing block.
    expect(declared(tile, "position")).toContain("relative");
  });

  it.each(["drop-candidate", "dropinto"])("the `%s` cue on a tile is painted by the stylesheet", (cue) => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const tile = tileFor("folder:f1");
    const rules = flatRules(SHELL_CSS);

    tile.classList.add(cue);
    const painting = rules
      .filter((r) => r.selector.includes(cue) && reachesOnHover(r.selector, tile))
      .filter((r) => /(^|[;{\s])(outline|background|box-shadow)\s*:/.test(r.body))
      .map((r) => r.selector);
    tile.classList.remove(cue);

    expect(painting, `no rule keyed on .${cue} matches a tile — the cue is invisible`).not.toEqual([]);
  });

  it("the tile cues carry the SAME declarations the Details rows' cues carry", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const rules = flatRules(SHELL_CSS);
    const outlineOf = (selector: string): string | undefined =>
      rules.find((r) => r.selector === selector)?.body.match(/outline\s*:\s*([^;]+)/)?.[1].trim();

    // Identical cue, identical paint — the plan's "drop cues mean what the
    // Tree's mean" requirement, checked against the sheet rather than trusted.
    expect(outlineOf(".qzk-library-tile.drop-candidate")).toBe(
      outlineOf(".qzk-details-table tbody tr.drop-candidate"),
    );
    expect(outlineOf(".qzk-library-tile.dropinto")).toBe(
      outlineOf(".qzk-details-table tbody tr.dropinto"),
    );
    expect(outlineOf(".qzk-library-tile.drop-candidate")).toBe(
      outlineOf(".qzk-folder-head.drop-candidate"),
    );
  });
});
