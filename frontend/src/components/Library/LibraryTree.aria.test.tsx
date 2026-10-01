// U5 — the Library tree as a WAI-ARIA tree: role="tree" / role="treeitem"
// semantics with explicit level/expanded/selected/position facts, ONE roving
// tab stop (the plan's residual: the rendered window carried ~170 natively-
// tabbable buttons, so Tab walked into row internals instead of leaving the
// list), Home/End, Escape returning focus to the row from a nested control or
// inline editor, and real accessible names on icon-only buttons.
//
// The scale half (the roving stop surviving a scroll of a 400-item tree)
// lives in LibraryTree.scale.test.tsx beside the other virtualization tests.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import { createFigureDocument } from "../../lib/figureDocument";
import type { OriginFigureEntry } from "../../lib/originFigures";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const fld = (id: string): FolderNode => ({ id, name: `Folder ${id}`, parentId: null, order: 0 });
const wb = (id: string, folderId?: string): WorkbookNode => ({ id, name: `Book ${id}`, folderId });
const ds = (id: string, workbookId?: string, tags?: string[]): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  ...(workbookId ? { workbookId } : {}),
  ...(tags ? { tags } : {}),
});
const originEntry: OriginFigureEntry = {
  id: "g1",
  stem: "Moke",
  datasetId: "d1",
  siblingIds: ["d1"],
  figure: { name: "MokeGraph", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 1, annotations: [] },
};

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={() => {}} />;
}

const row = (key: string): HTMLElement =>
  document.querySelector(key.startsWith("worksheet:") ? `[data-ds-id="${key.slice(10)}"]` : `[data-lib-row="${key}"]`) as HTMLElement;

/** Every element in `root` that sequential Tab navigation would stop on. */
const tabStops = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled,
  );

/** The tree's Tab surface is ONE row: `anchor` is the only tabbable treeitem
 *  and every other stop is a control inside it (Details' rule — the roving
 *  row's own reveal/rename controls ride along with its stop). */
const expectSingleStop = (anchor: HTMLElement): void => {
  const stops = tabStops(screen.getByRole("tree"));
  expect(stops.filter((el) => el.getAttribute("role") === "treeitem")).toEqual([anchor]);
  expect(stops.every((el) => anchor.contains(el))).toBe(true);
  // The drag grip can't be operated from the keyboard at all, so it is never a stop.
  expect(stops.some((el) => el.classList.contains("qzk-drag-handle"))).toBe(false);
};

beforeEach(() => {
  useApp.setState({
    folders: [fld("f1")],
    workbooks: [wb("w1", "f1")],
    datasets: [ds("d1", "w1", ["alpha"]), ds("d2", "w1")],
    originFigures: [originEntry],
    editableFigures: [createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView() })],
    figureDocs: [],
    pages: [],
    reports: [],
    expandedFolders: ["f1"],
    expandedWorkbookIds: ["w1"],
    librarySelection: null,
    workbookLastChild: {},
    activeId: null,
    selectedIds: [],
  });
});

describe("LibraryTree — WAI-ARIA tree semantics", () => {
  it("the container is a named, multi-selectable tree and every row anchor is a treeitem", () => {
    render(<Harness />);
    const tree = screen.getByRole("tree", { name: "Library" });
    expect(tree).toHaveAttribute("aria-multiselectable", "true");
    const items = within(tree).getAllByRole("treeitem");
    const anchors = tree.querySelectorAll("[data-lib-row], [data-ds-id]");
    expect(items).toHaveLength(anchors.length);
    expect(items.length).toBeGreaterThanOrEqual(6); // folder, workbook, 2 sheets, 2 artifacts
  });

  it("level, expanded, set size and position are explicit — the flattened DOM carries no nesting", () => {
    useApp.setState({ selectedIds: ["d2"] });
    render(<Harness />);
    const folder = screen.getByRole("treeitem", { name: "Folder f1" });
    expect(folder).toHaveAttribute("aria-level", "1");
    expect(folder).toHaveAttribute("aria-expanded", "true");
    const book = screen.getByRole("treeitem", { name: "Book w1" });
    expect(book).toHaveAttribute("aria-level", "2");
    expect(book).toHaveAttribute("aria-expanded", "true");
    const d1 = screen.getByRole("treeitem", { name: "d1.dat" });
    const d2 = screen.getByRole("treeitem", { name: "d2.dat" });
    expect(d1).toHaveAttribute("aria-level", "3");
    expect(d1).not.toHaveAttribute("aria-expanded"); // a leaf has no disclosure state
    expect(d1).toHaveAttribute("aria-selected", "false");
    expect(d2).toHaveAttribute("aria-selected", "true");
    const siblings = [d1, d2, row("origin-figure:g1"), row("editable-figure:fig1")];
    const size = siblings[0].getAttribute("aria-setsize");
    expect(Number(size)).toBeGreaterThanOrEqual(2);
    expect(siblings.filter((el) => el.getAttribute("aria-level") === "3").every((el) => el.getAttribute("aria-setsize") === size)).toBe(true);
    expect(d1).toHaveAttribute("aria-posinset", "1");
    expect(d2).toHaveAttribute("aria-posinset", "2");
  });

  it("artifact and graph anchors are not <button>s (ARIA-in-HTML bars treeitem on a button); Space selects, Enter opens", () => {
    render(<Harness />);
    expect(screen.getByRole("tree").querySelectorAll('button[role="treeitem"]')).toHaveLength(0);
    const cases: Array<[string, { kind: string; id: string }]> = [
      ["origin-figure:g1", { kind: "origin-figure", id: "g1" }],
      ["editable-figure:fig1", { kind: "editable-figure", id: "fig1" }],
    ];
    for (const [key, selection] of cases) {
      const anchor = row(key);
      expect(anchor.tagName).not.toBe("BUTTON");
      expect(anchor).toHaveAttribute("role", "treeitem");
      anchor.focus();
      expect(document.activeElement).toBe(anchor);
      useApp.setState({ librarySelection: null });
      // Consumed (returns false), as a button's Space is: no page scroll.
      expect(fireEvent.keyDown(anchor, { key: " " })).toBe(false);
      expect(useApp.getState().librarySelection).toEqual(selection);
    }
    fireEvent.keyDown(row("editable-figure:fig1"), { key: "Enter" });
    expect(useApp.getState().workbookLastChild.w1).toBe("editable-figure:fig1");
  });

  it("collapsing a folder flips its aria-expanded", () => {
    render(<Harness />);
    const folder = row("folder:f1");
    folder.focus();
    fireEvent.keyDown(folder, { key: "ArrowLeft" });
    expect(row("folder:f1")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("LibraryTree — one roving tab stop", () => {
  it("before any focus the whole tree has ONE sequential tab stop: the first row", () => {
    render(<Harness />);
    expectSingleStop(row("folder:f1"));
  });

  it("the stop defaults to the selected row when nothing has been focused yet", () => {
    useApp.setState({ librarySelection: { kind: "workbook", id: "w1" } });
    render(<Harness />);
    expectSingleStop(row("workbook:w1"));
  });

  it("the stop follows focus; only the roving row's own controls join it, never another row's", async () => {
    render(<Harness />);
    row("folder:f1").focus();
    fireEvent.keyDown(row("folder:f1"), { key: "ArrowDown" });
    fireEvent.keyDown(row("workbook:w1"), { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(row("worksheet:d1")));
    await waitFor(() => expect(row("worksheet:d1").tabIndex).toBe(0));
    expectSingleStop(row("worksheet:d1"));
    // …and the row's own controls (no menu equivalent for the preview toggle
    // or tag removal) are still reachable by Tab from it.
    expect(tabStops(row("worksheet:d1")).length).toBeGreaterThan(1);
  });

  it("an UNRESOLVED recovered graph is still a reachable treeitem (aria-disabled, not a disabled button)", () => {
    useApp.setState({ originFigures: [{ ...originEntry, datasetId: null }] });
    render(<Harness />);
    const fig = row("origin-figure:g1");
    expect(fig).toHaveAttribute("aria-disabled", "true");
    // A disabled <button> can't take focus at all, so arrows would skip it and
    // it could never hold the tree's one tab stop.
    const items = screen.getAllByRole("treeitem");
    const before = items[items.indexOf(fig) - 1];
    before.focus();
    fireEvent.keyDown(before, { key: "ArrowDown" });
    expect(document.activeElement).toBe(fig);
  });

  it("Home and End move to the first and last visible rows", () => {
    render(<Harness />);
    const start = row("worksheet:d2");
    start.focus();
    fireEvent.keyDown(start, { key: "End" });
    const items = screen.getAllByRole("treeitem");
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(row("folder:f1"));
  });
});

describe("LibraryTree — Escape returns focus to the row", () => {
  it("on the row itself: focus stays, and the key still reaches the app's Escape ladder (Details' model)", () => {
    render(<Harness />);
    for (const key of ["folder:f1", "worksheet:d1", "origin-figure:g1"]) {
      const anchor = row(key);
      anchor.focus();
      // fireEvent returns false only when the keystroke was preventDefault()ed.
      expect(fireEvent.keyDown(anchor, { key: "Escape" })).toBe(true);
      expect(document.activeElement).toBe(anchor);
    }
  });

  it("from a nested control (the row's menu button)", () => {
    render(<Harness />);
    const sheet = row("worksheet:d1");
    const menuBtn = within(sheet).getByRole("button", { name: "More actions" });
    menuBtn.focus();
    fireEvent.keyDown(menuBtn, { key: "Escape" });
    expect(document.activeElement).toBe(sheet);
  });

  it("from an inline rename: the edit is discarded and focus lands back on the row, not <body>", async () => {
    render(<Harness />);
    fireEvent.doubleClick(row("folder:f1").querySelector(".qzk-group-name")!);
    const input = row("folder:f1").querySelector("input")!;
    input.focus();
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(row("folder:f1")));
    expect(useApp.getState().folders[0].name).toBe("Folder f1");
  });

  it("Enter commits an inline rename and also hands focus back to the row", async () => {
    render(<Harness />);
    fireEvent.doubleClick(row("worksheet:d2").querySelector(".qzk-ds-name")!);
    const input = row("worksheet:d2").querySelector("input")!;
    input.focus();
    fireEvent.change(input, { target: { value: "renamed.dat" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(row("worksheet:d2")));
    expect(useApp.getState().datasets.find((d) => d.id === "d2")?.name).toBe("renamed.dat");
  });
});

describe("LibraryTree — icon-only buttons carry real accessible names", () => {
  it("tag remove/add buttons are named for what they do, not their glyph", () => {
    render(<Harness />);
    const sheet = row("worksheet:d1");
    expect(within(sheet).getByRole("button", { name: "Remove tag alpha" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Add tag" })).toBeInTheDocument();
  });

  it("no button anywhere in the tree is named by a bare glyph", () => {
    render(<Harness />);
    const glyphNamed = within(screen.getByRole("tree")).queryAllByRole("button", {
      name: (name) => !/[\p{L}\p{N}]{2,}/u.test(name),
    });
    expect(glyphNamed.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });
});
