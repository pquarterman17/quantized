// L1.4 interaction parity for the Details renderer: rename, move, and
// drag/drop must mean in Details exactly what they mean in the Tree, through
// the SAME store actions and the SAME menu registries.
//
// These render the real <LibraryDetails> over a store-backed hierarchy (the
// Harness rebuilds it from the store exactly as Library.tsx does), so a move
// is asserted at the layer the user experiences: the store changed AND the
// row's rendered Location changed.
//
// jsdom has no real drag-and-drop, so drag events are hand-built with a fake
// `dataTransfer` and dispatched through RTL's low-level fireEvent — the same
// workaround FolderRow.test.tsx uses for the Tree's identical gestures.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryDetails from "./LibraryDetails";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import { FOLDER_DND, WORKBOOK_DND } from "./dnd";
import { defaultVisibleDetailsColumnKeys } from "../../lib/libraryDetailsColumns";
import type { Dataset, FolderNode } from "../../lib/types";
import { askParams } from "../overlays/ParamDialog";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

function dataset(id: string, name: string, order: number): Dataset {
  return {
    id,
    name,
    workbookId: "w",
    order,
    data: { time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: {} },
  };
}

const folder = (id: string, name: string, parentId: string | null, order: number): FolderNode => ({
  id,
  name,
  parentId,
  order,
});

/** Rebuilds the canonical hierarchy from the store on every render, the way
 *  Library.tsx does — so a move is visible in the rendered Location column,
 *  not only in the store. */
function Harness() {
  const { hierarchy } = useLibraryHierarchyModel();
  return <LibraryDetails hierarchy={hierarchy} />;
}

const datasets = [dataset("b", "beta.csv", 0), dataset("a", "alpha.csv", 1)];

beforeEach(() => {
  useApp.setState({
    datasets,
    workbooks: [{ id: "w", name: "Run", folderId: "f1" }],
    folders: [folder("f1", "Alpha", null, 0), folder("f2", "Beta", null, 1)],
    selectedIds: [],
    librarySelection: null,
    activeId: null,
    expandedFolders: ["f1", "f2"],
    expandedWorkbookIds: ["w"],
    workbookLastChild: {},
    trash: [],
    history: [],
    confirmRemove: false,
    activeDrag: null,
    visibleDetailsColumns: defaultVisibleDetailsColumnKeys(),
  });
  vi.mocked(askParams).mockReset();
});

const rowFor = (key: string): HTMLElement =>
  document.querySelector(`tr[data-lib-row="${key}"]`) as HTMLElement;

/** The row's rendered location, read from the compact Name-cell caption (the
 *  narrow-panel fallback) — the same string the Location column shows. */
const locationOnScreen = (key: string): string =>
  (rowFor(key).querySelector(".qzk-details-name small")?.textContent ?? "").split(" · ")[0];

/** Apply a store change and let React flush it, so the rows' props (and the
 *  handler closures that read them) are current before the next gesture. */
const applyToStore = (change: () => void): void => act(() => { change(); });

/** Open a Details row's context menu and click one of its items. */
function menuAction(key: string, label: string): void {
  fireEvent.contextMenu(rowFor(key));
  fireEvent.click(screen.getByText(label));
}

function transfer(type: string, id: string) {
  return { types: [type], getData: (t: string) => (t === type ? id : ""), setData: () => {} };
}

/** Dispatch one drag event; returns false when a handler called
 *  preventDefault — which for `dragover` is precisely "this target ACCEPTS
 *  the drop" (a real browser fires no drop event without it). */
function fireDrag(el: Element, type: "dragstart" | "dragover" | "drop", dataTransfer: unknown): boolean {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  return fireEvent(el, evt);
}

/** dragstart on the source's grip, then dragover the destination row.
 *  Returns whether the destination ACCEPTED the drag. */
function beginDragOver(sourceKey: string, destKey: string, type: string, id: string): boolean {
  const grip = rowFor(sourceKey).querySelector(".qzk-drag-handle") as HTMLElement;
  const payload = { ...transfer(type, id), effectAllowed: "" };
  fireDrag(grip, "dragstart", payload);
  return !fireDrag(rowFor(destKey), "dragover", payload);
}

/** The full Tree-equivalent drag: grip dragstart (which publishes activeDrag,
 *  the signal a drop target consults during dragover) then dragover + drop on
 *  the destination row. */
function dragRowOnto(sourceKey: string, destKey: string, type: string, id: string): void {
  const grip = rowFor(sourceKey).querySelector(".qzk-drag-handle") as HTMLElement;
  const payload = { ...transfer(type, id), effectAllowed: "" };
  fireDrag(grip, "dragstart", payload);
  fireDrag(rowFor(destKey), "dragover", payload);
  fireDrag(rowFor(destKey), "drop", payload);
}

describe("LibraryDetails — L1.4 rename parity", () => {
  it("offers the Tree's Rename… on EVERY node kind, not just artifacts", () => {
    render(<Harness />);
    for (const key of ["folder:f1", "workbook:w", "worksheet:b"]) {
      fireEvent.contextMenu(rowFor(key));
      expect(screen.getByRole("menuitem", { name: "Rename…" })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: "Escape" });
    }
  });

  it("Rename… opens the Tree's inline editor and commits to the store and the screen", () => {
    render(<Harness />);
    menuAction("workbook:w", "Rename…");
    const input = document.querySelector(".qzk-folder-rename") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "Renamed Run" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.name).toBe("Renamed Run");
    // The layer the user experiences: the new label is on the row.
    expect(within(rowFor("workbook:w")).getByText("Renamed Run")).toBeInTheDocument();
  });

  it("renames a FOLDER through the same shared store action", () => {
    render(<Harness />);
    menuAction("folder:f2", "Rename…");
    const input = document.querySelector(".qzk-folder-rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Gamma" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().folders.find((f) => f.id === "f2")!.name).toBe("Gamma");
    expect(within(rowFor("folder:f2")).getByText("Gamma")).toBeInTheDocument();
  });

  it("Escape cancels the rename and writes nothing", () => {
    render(<Harness />);
    menuAction("workbook:w", "Rename…");
    const input = document.querySelector(".qzk-folder-rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.name).toBe("Run");
    expect(document.querySelector(".qzk-folder-rename")).toBeNull();
  });

  // A blank or unchanged commit must not reach the store at all. The store
  // guards the NAME itself (`renameDataset` falls back to the old one), but
  // it records its undo entry BEFORE that fallback — so without the editor's
  // own check a cancelled rename would leave a do-nothing step on the undo
  // stack. The editor's check is what makes the no-op complete.
  it.each([
    ["a blank name", "   "],
    ["an unchanged name", "beta.csv"],
  ])("%s reverts without touching the store or the undo stack", (_label, typed) => {
    render(<Harness />);
    const historyBefore = useApp.getState().history.length;
    menuAction("worksheet:b", "Rename…");
    const input = document.querySelector(".qzk-folder-rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: typed } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().datasets.find((d) => d.id === "b")!.name).toBe("beta.csv");
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("a rename leaves a live multi-selection EXACTLY as it was (L0.25)", () => {
    render(<Harness />);
    applyToStore(() => useApp.getState().selectIds(["b", "a"]));
    const before = [...useApp.getState().selectedIds];

    // Right-click a row that is ALREADY part of the selection: the menu acts
    // on what is highlighted without collapsing it (DatasetRow's rule).
    menuAction("worksheet:b", "Rename…");
    const input = document.querySelector(".qzk-folder-rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "beta-renamed.csv" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useApp.getState().datasets.find((d) => d.id === "b")!.name).toBe("beta-renamed.csv");
    expect(useApp.getState().selectedIds).toEqual(before);
    expect(useApp.getState().librarySelection).toBeNull();
  });

  it("keys typed in the rename input never reach the row or the table (no delete, no roving nav)", () => {
    render(<Harness />);
    applyToStore(() => useApp.getState().selectIds(["b"]));
    menuAction("worksheet:b", "Rename…");
    const input = document.querySelector(".qzk-folder-rename") as HTMLInputElement;
    input.focus();

    // Backspace/Delete inside the editor are text edits, NOT a row delete —
    // `.closest("[data-lib-row]")` would otherwise resolve the input to its
    // row (LibraryTree's P2 keyboard-hijack hazard).
    fireEvent.keyDown(input, { key: "Backspace" });
    fireEvent.keyDown(input, { key: "Delete" });
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().trash ?? []).toHaveLength(0);

    // Arrows stay native text-cursor movement: not consumed, focus unmoved.
    const moved = fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(moved).toBe(true); // nothing called preventDefault()
    expect(document.activeElement).toBe(input);
  });
});

describe("LibraryDetails — L1.4 move / drag-drop parity", () => {
  it("dragging a workbook row onto a folder row moves it, in the store AND on screen", () => {
    render(<Harness />);
    expect(locationOnScreen("workbook:w")).toBe("Alpha");

    dragRowOnto("workbook:w", "folder:f2", WORKBOOK_DND, "w");

    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.folderId).toBe("f2");
    expect(locationOnScreen("workbook:w")).toBe("Beta");
  });

  it("dragging a folder row onto another folder row reparents it", () => {
    render(<Harness />);
    dragRowOnto("folder:f2", "folder:f1", FOLDER_DND, "f2");
    expect(useApp.getState().folders.find((f) => f.id === "f2")!.parentId).toBe("f1");
  });

  it("the menu's Move to … and the drag reach the same destination", () => {
    render(<Harness />);
    menuAction("workbook:w", 'Move to "Beta"');
    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.folderId).toBe("f2");
  });

  it("only the grip starts a drag — the row body is not draggable (Tree convention)", () => {
    render(<Harness />);
    const row = rowFor("workbook:w");
    expect(row).not.toHaveAttribute("draggable");
    expect(row.querySelector(".qzk-drag-handle")).toHaveAttribute("draggable", "true");
    // Artifact-free kinds only: a worksheet drags as the plot-target payload,
    // and every row that can be dragged in the Tree can be dragged here.
    expect(rowFor("worksheet:b").querySelector(".qzk-drag-handle")).not.toBeNull();
  });

  // An illegal folder-onto-folder drop is refused at BOTH ends: the target
  // never accepts it (no preventDefault on dragover, so a real browser fires
  // no drop at all and shows no candidate highlight), and the drop handler
  // refuses it again rather than calling `moveFolder` — which would record a
  // do-nothing "move folder" step on the undo stack even though the store's
  // own cycle guard then refuses the move.
  it("a folder dropped on ITSELF is refused, leaving placement, undo stack and selection untouched", () => {
    render(<Harness />);
    applyToStore(() => useApp.getState().selectIds(["b", "a"]));
    const before = [...useApp.getState().selectedIds];
    const parentBefore = useApp.getState().folders.find((f) => f.id === "f2")!.parentId;
    const historyBefore = useApp.getState().history.length;

    const accepted = beginDragOver("folder:f2", "folder:f2", FOLDER_DND, "f2");
    expect(accepted).toBe(false);
    expect(rowFor("folder:f2").className).not.toContain("drop-candidate");
    fireDrag(rowFor("folder:f2"), "drop", { ...transfer(FOLDER_DND, "f2"), effectAllowed: "" });

    expect(useApp.getState().folders.find((f) => f.id === "f2")!.parentId).toBe(parentBefore);
    expect(useApp.getState().history).toHaveLength(historyBefore);
    expect(useApp.getState().selectedIds).toEqual(before);
  });

  it("a folder dropped on its OWN DESCENDANT is refused the same way", () => {
    applyToStore(() =>
      useApp.setState({ folders: [...useApp.getState().folders, folder("f3", "Child", "f2", 0)] }),
    );
    render(<Harness />);
    const historyBefore = useApp.getState().history.length;

    expect(beginDragOver("folder:f2", "folder:f3", FOLDER_DND, "f2")).toBe(false);
    fireDrag(rowFor("folder:f3"), "drop", { ...transfer(FOLDER_DND, "f2"), effectAllowed: "" });

    expect(useApp.getState().folders.find((f) => f.id === "f2")!.parentId).toBeNull();
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  // REVIEW ROUND (F2): Details shipped `drop-candidate` on the HOVERED row and
  // never showed a resting candidate at all, inverting the Tree's two cues.
  // They now mean here exactly what they mean there: `dropinto` = "this is
  // where it would land", `drop-candidate` = "this row would accept it".
  it("the hovered target shows `dropinto` while every OTHER legal target rests at `drop-candidate`", () => {
    // A third top-level folder: a legal destination for the f2 drag that is
    // NOT the one under the pointer.
    applyToStore(() =>
      useApp.setState({ folders: [...useApp.getState().folders, folder("f3", "Gamma", null, 2)] }),
    );
    render(<Harness />);

    expect(beginDragOver("folder:f2", "folder:f1", FOLDER_DND, "f2")).toBe(true);
    expect(rowFor("folder:f1").className).toContain("dropinto");
    expect(rowFor("folder:f1").className).not.toContain("drop-candidate");
    expect(rowFor("folder:f3").className).toContain("drop-candidate");
    expect(rowFor("folder:f3").className).not.toContain("dropinto");
    // The dragged folder itself is never a candidate for itself.
    expect(rowFor("folder:f2").className).toBe("");
    // Nor is a row that cannot accept a move at all.
    expect(rowFor("worksheet:b").className).toBe("");
  });

  // REVIEW ROUND (F4): both store actions call `recordHistory` as their FIRST
  // statement, so a drop that changes nothing still left a do-nothing step on
  // the undo stack.
  it("dropping a workbook on the folder it is ALREADY in records no undo step", () => {
    render(<Harness />);
    const historyBefore = useApp.getState().history.length;

    dragRowOnto("workbook:w", "folder:f1", WORKBOOK_DND, "w");

    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.folderId).toBe("f1");
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("dropping a folder on the parent it ALREADY has records no undo step", () => {
    applyToStore(() =>
      useApp.setState({ folders: [...useApp.getState().folders, folder("f3", "Child", "f2", 0)] }),
    );
    render(<Harness />);
    const historyBefore = useApp.getState().history.length;

    dragRowOnto("folder:f3", "folder:f2", FOLDER_DND, "f3");

    expect(useApp.getState().folders.find((f) => f.id === "f3")!.parentId).toBe("f2");
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  // REVIEW ROUND (F5): the workbook branch of `onDrop` checked only the
  // payload TYPE and a non-empty id, so a `drop` that never went through
  // `dragover` — with no drag in flight at all — still performed the move.
  it("a bare `drop` with no preceding dragover is refused for a workbook as it is for a folder", () => {
    render(<Harness />);
    const historyBefore = useApp.getState().history.length;

    fireDrag(rowFor("folder:f2"), "drop", { ...transfer(WORKBOOK_DND, "w"), effectAllowed: "" });

    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.folderId).toBe("f1");
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  // REVIEW ROUND (F11): the grip stopped a single click from selecting but not
  // a double-click from opening, so grabbing it twice quickly toggled a folder.
  it("a double-click on the grip neither selects nor opens the row", () => {
    render(<Harness />);
    const grip = rowFor("folder:f2").querySelector(".qzk-drag-handle") as HTMLElement;

    fireEvent.doubleClick(grip);

    expect(useApp.getState().expandedFolders).toContain("f2");
    expect(useApp.getState().librarySelection).toBeNull();
  });
});

// REVIEW ROUND (F1): the parity suite asserted CLASS NAMES only, so the grip
// shipped permanently INVISIBLE (`.qzk-drag-handle { opacity: 0 }` is revealed
// by `.qzk-ds:hover` / `.qzk-folder-head:hover` / `:focus`, none of which a
// Details grip matches — it lives in a <td> and is aria-hidden and
// non-focusable) and a hovered Details folder row got no highlight at all
// (`.drop-candidate` existed only for `.qzk-folder-head` and `.qzk-plotwin`).
// These tests therefore assert against the real stylesheet: a cue counts only
// if some rule keyed on it actually MATCHES the rendered element.
describe("LibraryDetails — L1.4 cues are painted, not just classed", () => {
  // Read from disk, the established pattern for a stylesheet assertion here
  // (styles/reducedMotion.test.ts, workshops/peaks/PeakTable.test.tsx): Vite's
  // CSS pipeline claims `.css` imports, so `?raw` returns an empty string.
  const SHELL_CSS = readFileSync(join(__dirname, "../../styles/shell.css"), "utf8");

  /** Every style rule in the sheet, flattened out of its `@media`/`@container`
   *  blocks. Parsed from the text rather than through jsdom's CSSOM so an
   *  unsupported modern property can never silently drop a rule these tests
   *  are looking for. */
  function flatRules(css: string): { selector: string; body: string }[] {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const out: { selector: string; body: string }[] = [];
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      const prelude = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const body = src.slice(open + 1, j - 1);
      if (prelude.startsWith("@")) out.push(...flatRules(body));
      else out.push({ selector: prelude, body });
      i = j;
    }
    return out;
  }

  /** Does this selector reach `el` when a pointer is over its row? `:hover` is
   *  exactly what the pointer supplies, so it is erased before matching; a
   *  `:focus`-gated rule is NOT an answer for the Details grip, which is
   *  `aria-hidden` and has no tabindex, so those selectors are discarded. */
  function reachesOnHover(selector: string, el: Element): boolean {
    if (selector.includes(":focus")) return false;
    return selector.split(",").some((part) => {
      const stripped = part.trim().replace(/:hover/g, "");
      try {
        return stripped !== "" && el.matches(stripped);
      } catch {
        return false;
      }
    });
  }

  const declares = (body: string, prop: string, value: string): boolean =>
    new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*${value}\\s*(;|$)`).test(body.trim());

  it("the grip is hidden at rest AND revealed by a rule that reaches it on row hover", () => {
    render(<Harness />);
    const grip = rowFor("workbook:w").querySelector(".qzk-drag-handle") as HTMLElement;
    const rules = flatRules(SHELL_CSS);

    // The resting state that makes a reveal necessary in the first place.
    expect(
      rules.filter((r) => declares(r.body, "opacity", "0") && reachesOnHover(r.selector, grip)).length,
    ).toBeGreaterThan(0);
    // The reveal itself — this is what was missing for Details.
    const revealing = rules
      .filter((r) => declares(r.body, "opacity", "1") && reachesOnHover(r.selector, grip))
      .map((r) => r.selector);
    expect(revealing, "no stylesheet rule raises the Details grip's opacity — it is invisible").not.toEqual([]);
  });

  // F10: `.qzk-details-name > span { margin-right: 4px }` reaches the grip too,
  // and `.qzk-drag-handle`'s own `width: 12px` is INERT on an inline span (it
  // is a flex item only in the Tree's rows). So the grip and the empty slot a
  // non-draggable kind gets must both be laid out as a 12px inline-block, or
  // the two kinds' names start at different x positions.
  it("the grip and the non-draggable slot are laid out as the same 12px inline-block box", () => {
    render(<Harness />);
    const rules = flatRules(SHELL_CSS);
    const declared = (el: Element, prop: string): string[] =>
      rules
        .filter((r) => reachesOnHover(r.selector, el))
        .flatMap((r) => {
          const m = r.body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`));
          return m ? [m[1].trim()] : [];
        });
    const grip = rowFor("workbook:w").querySelector(".qzk-drag-handle") as HTMLElement;
    // The harness seeds no artifact rows, so the non-draggable branch's slot is
    // materialized here and matched against the same sheet.
    const slot = document.createElement("span");
    slot.className = "qzk-details-grip-space";
    (rowFor("workbook:w").querySelector(".qzk-details-name") as HTMLElement).appendChild(slot);

    for (const el of [grip, slot]) {
      expect(declared(el, "width")).toContain("12px");
      expect(declared(el, "display")).toContain("inline-block");
    }
    slot.remove();
  });

  it.each(["drop-candidate", "dropinto"])("the `%s` cue on a Details <tr> is painted by the stylesheet", (cue) => {
    render(<Harness />);
    const row = rowFor("folder:f1");
    const rules = flatRules(SHELL_CSS);

    row.classList.add(cue);
    const painting = rules
      .filter((r) => r.selector.includes(cue) && reachesOnHover(r.selector, row))
      .filter((r) => /(^|[;{\s])(outline|background|box-shadow)\s*:/.test(r.body))
      .map((r) => r.selector);
    row.classList.remove(cue);

    expect(painting, `no rule keyed on .${cue} matches a Details row — the cue is invisible`).not.toEqual([]);
  });
});

// REVIEW ROUND (F3): Details reused the TILES menu builder, which made one
// Tiles-only item an enabled no-op and handed a SELECTION writer to the
// folder-reveal hook.
describe("LibraryDetails — L1.4 menu honesty", () => {
  it("Browse renders DISABLED in Details rather than as an enabled row re-select", () => {
    render(<Harness />);
    fireEvent.contextMenu(rowFor("workbook:w"));
    expect(screen.getByRole("menuitem", { name: /^Browse/ })).toHaveAttribute("aria-disabled", "true");
  });

  // F7: the header claimed the menu is "built ON OPEN, not per render" while
  // `items={buildMenu()}` re-ran the O(datasets) builder on every render of an
  // open menu. Parked in state now — which is observable: the item labels are
  // the ones captured at open.
  it("the menu is built once per OPEN — a store change behind it does not rebuild its items", () => {
    render(<Harness />);
    fireEvent.contextMenu(rowFor("workbook:w"));
    expect(screen.getByRole("menuitem", { name: 'Move to "Beta"' })).toBeInTheDocument();

    applyToStore(() => useApp.getState().renameFolder("f2", "Gamma"));

    expect(screen.getByRole("menuitem", { name: 'Move to "Beta"' })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: 'Move to "Gamma"' })).toBeNull();
  });

  it("New subfolder creates the child WITHOUT writing selection", () => {
    render(<Harness />);
    fireEvent.contextMenu(rowFor("folder:f1"));
    // The right-click itself selected f1 (L0.25). Move the highlight somewhere
    // else so a selection write from the menu item is visible: with `browse`
    // wired to the folder hook, "New subfolder" re-selected the PARENT.
    applyToStore(() => useApp.getState().selectIds(["b"]));

    fireEvent.click(screen.getByRole("menuitem", { name: "New subfolder" }));

    expect(useApp.getState().folders.some((f) => f.parentId === "f1")).toBe(true);
    expect(useApp.getState().librarySelection).toBeNull();
    expect(useApp.getState().selectedIds).toEqual(["b"]);
  });
});

describe("LibraryDetails — L1.4 move / drag-drop parity (continued)", () => {
  it("a CANCELLED drag (dragstart then dragend, no drop) writes nothing at all", () => {
    render(<Harness />);
    applyToStore(() => useApp.getState().selectIds(["b", "a"]));
    const before = [...useApp.getState().selectedIds];
    const grip = rowFor("workbook:w").querySelector(".qzk-drag-handle") as HTMLElement;

    fireDrag(grip, "dragstart", { ...transfer(WORKBOOK_DND, "w"), effectAllowed: "" });
    expect(useApp.getState().activeDrag).toEqual({ kind: "workbook", id: "w" });
    fireEvent.dragEnd(grip);

    expect(useApp.getState().activeDrag).toBeNull();
    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.folderId).toBe("f1");
    expect(useApp.getState().selectedIds).toEqual(before);
  });

  it("a workbook dropped on a WORKSHEET row is refused — only folders accept a move", () => {
    render(<Harness />);
    dragRowOnto("workbook:w", "worksheet:a", WORKBOOK_DND, "w");
    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.folderId).toBe("f1");
  });
});

// REVIEW ROUND (F6): the editor and its draft were `useState` inside the ROW,
// which the virtualizer unmounts when it scrolls out of the window. React
// fires no blur on unmount, so nothing was committed and the typed name was
// silently destroyed.
describe("LibraryDetails — L1.4 inline rename under virtualization", () => {
  it("an open editor and its half-typed draft survive the row scrolling out of the window and back", () => {
    applyToStore(() =>
      useApp.setState({ datasets: Array.from({ length: 4000 }, (_, i) => dataset(`d${i}`, `run-${i}.csv`, i)) }),
    );
    render(<Harness />);
    menuAction("workbook:w", "Rename…");
    const input = document.querySelector(".qzk-folder-rename") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Half typed" } });

    const panel = document.querySelector(".qzk-details-scroll") as HTMLElement;
    fireEvent.scroll(panel, { target: { scrollTop: 40000 } });
    // The row really is gone — otherwise this test proves nothing.
    expect(rowFor("workbook:w")).toBeNull();
    // And nothing was committed behind the user's back on the way out.
    expect(useApp.getState().workbooks.find((w) => w.id === "w")!.name).toBe("Run");

    fireEvent.scroll(panel, { target: { scrollTop: 0 } });
    const reopened = rowFor("workbook:w").querySelector(".qzk-folder-rename") as HTMLInputElement | null;
    expect(reopened, "the rename editor was destroyed by the scroll").not.toBeNull();
    expect(reopened!.value).toBe("Half typed");
  });
});
