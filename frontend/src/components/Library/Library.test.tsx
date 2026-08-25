// Integration: the Library composes the folder tree, and Origin figures nest
// inside it under their project folder (plan item 5). Verifies the wiring the
// buildTreeRows unit tests can't: that a figure actually renders as a tree row
// in tree mode, that the flat Figures section is hidden then (no duplication),
// and that it reappears in the flat no-folders mode.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import Library from "./Library";
import { createFigureDocument } from "../../lib/figureDocument";
import type { OriginFigureEntry } from "../../lib/originFigures";
import { createPageDocument } from "../../lib/pageDocumentActions";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset, FolderNode } from "../../lib/types";
import { LIBRARY_VIEW_PREFS_KEY } from "../../lib/libraryViewPrefs";
import { useApp } from "../../store/useApp";

const dsWith = (id: string, folderId?: string): Dataset => ({
  id,
  name: id,
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  ...(folderId ? { folderId } : {}),
});
const folder = (id: string, name: string): FolderNode => ({ id, name, parentId: null, order: 0 });
const figEntry = (id: string, datasetId: string | null, name: string): OriginFigureEntry => ({
  id,
  stem: "Moke",
  datasetId,
  siblingIds: datasetId ? [datasetId] : [],
  figure: {
    name,
    x_from: 0,
    x_to: 1,
    x_log: false,
    y_from: 0,
    y_to: 1,
    y_log: false,
    n_curves: 1,
    annotations: [],
  },
});

beforeEach(() => {
  localStorage.removeItem(LIBRARY_VIEW_PREFS_KEY);
  useApp.setState({
    datasets: [],
    folders: [],
    workbooks: [],
    expandedFolders: [],
    expandedWorkbookIds: [],
    originFigures: [],
    originFidelity: [],
    smartFolders: [],
    activeId: null,
    selectedIds: [],
    librarySelection: null,
    originFidelitySectionExpanded: false,
  });
});

describe("Library — figures nested in the tree", () => {
  // PR C: LibraryTree is a lazy chunk (bundle-size budget, MAIN_PLAN #29 —
  // same idiom as EditableFiguresSection/PagesSection) — its content awaits
  // the Suspense resolve, so tree-content assertions use findBy* here.
  it("renders a figure inside the tree and hides the flat Figures section (folders exist)", async () => {
    useApp.setState({
      datasets: [dsWith("a", "f1")],
      folders: [folder("f1", "Project")],
      expandedFolders: ["f1"],
      originFigures: [figEntry("g1", "a", "MokeGraph")],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    expect(await screen.findByText("Project")).toBeInTheDocument(); // folder header
    expect(screen.getByRole("button", { name: /MokeGraph/ })).toBeInTheDocument(); // figure row
    // The flat "Figures" section header must be absent in tree mode (no dup).
    expect(screen.queryByText("Figures")).not.toBeInTheDocument();
  });

  it("PR C: still renders as a tree (not the flat Figures section) even with no folders — the library is non-empty", async () => {
    useApp.setState({
      datasets: [dsWith("a")],
      originFigures: [figEntry("g1", "a", "MokeGraph")],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    // The old "flat mode when no folders" trigger is retired: any non-empty
    // library renders the tree, so the flat "Figures" section header stays
    // hidden and the figure appears as a tree row instead (root-level, since
    // there's no workbook to nest it under in this legacy-shaped fixture).
    expect(await screen.findByRole("button", { name: /MokeGraph/ })).toBeInTheDocument();
    expect(screen.queryByText("Figures")).not.toBeInTheDocument();
  });
});

// project-organization plan item 6: the group-chip UI (filter dropdown +
// collapsible group sections) is retired — folders are the one organizational
// model. A dataset that still carries a legacy `.group` (bypassing the
// loadWorkspace migration, e.g. set directly on the store as a stale/edited
// doc would) must NOT resurrect any of that UI; the flat-list fallback keeps
// rendering it normally instead.
describe("Library — group-chip UI retired (item 6)", () => {
  const grouped = (id: string, group: string): Dataset => ({ ...dsWith(id), group });

  it("never renders a group-filter dropdown, regardless of .group data", () => {
    useApp.setState({
      datasets: [grouped("a", "Batch A"), grouped("b", "Batch B")],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    expect(screen.queryByTitle("Filter the library to one group")).not.toBeInTheDocument();
    expect(screen.queryByText("All groups")).not.toBeInTheDocument();
  });

  it("never splits the list into collapsible group sections — falls back to a flat list", async () => {
    useApp.setState({
      datasets: [grouped("a", "Batch A"), grouped("b", "Batch B")],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    // Both datasets render as plain rows, not headed by a "Batch A"/"Batch B"
    // collapsible section (the retired qzk-group-head rendering). PR C:
    // LibraryTree is a lazy chunk (MAIN_PLAN #29) — await its Suspense resolve.
    expect(await screen.findByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.queryByText("Batch A")).not.toBeInTheDocument();
    expect(screen.queryByText("Batch B")).not.toBeInTheDocument();
  });

  it("still renders normally (fallback intact) once folders exist alongside a stray .group", async () => {
    useApp.setState({
      datasets: [grouped("a", "Batch A"), dsWith("b", "f1")],
      folders: [folder("f1", "F1")],
      expandedFolders: ["f1"],
      activeId: "a",
      selectedIds: ["a"],
    });
    render(<Library />);
    expect(await screen.findByText("F1")).toBeInTheDocument(); // folder header renders
    expect(screen.getByText("a")).toBeInTheDocument(); // un-foldered dataset still shown at root
    expect(screen.getByText("b")).toBeInTheDocument(); // foldered dataset shown nested
  });
});

describe("Library — Show in folder reveal (GUI_INTERACTION_PLAN #13 sub-item 2)", () => {
  it("clears the filter, expands every ancestor folder, and selects the target", () => {
    useApp.setState({
      datasets: [dsWith("a", "child")],
      folders: [
        { id: "parent", name: "Parent", parentId: null, order: 0 },
        { id: "child", name: "Child", parentId: "parent", order: 0 },
      ],
      expandedFolders: [],
      activeId: null,
      selectedIds: [],
    });
    render(<Library />);
    const input = screen.getByPlaceholderText(/Filter/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "something" } });
    expect(input.value).toBe("something");

    act(() => {
      useApp.getState().requestReveal("a");
    });

    expect(input.value).toBe("");
    expect(useApp.getState().expandedFolders).toEqual(expect.arrayContaining(["parent", "child"]));
    expect(useApp.getState().selectedIds).toEqual(["a"]);
    expect(useApp.getState().revealTarget).toBeNull();
  });

  it("silently no-ops for a stale/removed dataset id", () => {
    useApp.setState({ datasets: [dsWith("a")], folders: [], expandedFolders: [], selectedIds: [] });
    render(<Library />);
    act(() => {
      useApp.getState().requestReveal("gone");
    });
    expect(useApp.getState().revealTarget).toBeNull();
    expect(useApp.getState().selectedIds).toEqual([]);
  });

  // PR C: the reveal effect now also expands the dataset's WORKBOOK, not
  // just its ancestor folders — otherwise the row would be selected but
  // invisible (a collapsed workbook's children don't render).
  it("PR C: also expands the dataset's workbook", () => {
    useApp.setState({
      datasets: [{ ...dsWith("a", "f1"), workbookId: "w1" }],
      workbooks: [{ id: "w1", name: "wb", folderId: "f1" }],
      folders: [{ id: "f1", name: "F1", parentId: null, order: 0 }],
      expandedFolders: [],
      expandedWorkbookIds: [],
      activeId: null,
      selectedIds: [],
    });
    render(<Library />);
    act(() => {
      useApp.getState().requestReveal("a");
    });
    expect(useApp.getState().expandedFolders).toContain("f1");
    expect(useApp.getState().expandedWorkbookIds).toContain("w1");
    expect(useApp.getState().selectedIds).toEqual(["a"]);
  });
});

// PR C: the tree owns worksheets/figures/editable figures/publication
// figures/pages/reports whenever it renders — their flat sections must hide
// then. PR D2 (L0.26): search no longer resurrects the UNFILTERED sections —
// the project-wide results surface covers every kind WITH the query applied.
describe("Library — sections hidden in tree mode AND search mode (PR C / PR D2)", () => {
  const editableFig = createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "a", view: defaultPlotView() });
  const page = createPageDocument({ id: "pg1", name: "My Page", rows: 1, cols: 1 });
  const report = { id: "rep1", name: "My Report", datasetId: "a", report: { rows: [] } as never };

  beforeEach(() => {
    useApp.setState({
      datasets: [dsWith("a")],
      folders: [],
      workbooks: [],
      editableFigures: [editableFig],
      figureDocs: [],
      pages: [page],
      reports: [report],
      activeId: "a",
      selectedIds: ["a"],
    });
  });

  it("hides the flat sections while the tree renders (library non-empty, no search)", () => {
    render(<Library />);
    expect(screen.queryByText("Editable figures")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved pages")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
  });

  it("search renders the flat results surface, NOT the unfiltered sections (PR D2)", async () => {
    render(<Library />);
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: "my" } });
    // The results table (lazy LibraryDetails) carries the matches — every
    // artifact kind, query APPLIED — while the legacy section headers stay
    // hidden (they were unfiltered lists).
    expect(await screen.findByLabelText("Library details table")).toBeInTheDocument();
    expect(screen.getByText("My Figure")).toBeInTheDocument();
    expect(screen.getByText("My Page")).toBeInTheDocument();
    expect(screen.getByText("My Report")).toBeInTheDocument();
    expect(screen.queryByText("Editable figures")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved pages")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
    // The query really is applied: the dataset "a" doesn't match "my".
    expect(screen.queryByText(/^a$/)).not.toBeInTheDocument();
  });
});

// PR D2 (L0.26): the search results' "Show in Library" — and the generalized
// reveal signal behind it — work for EVERY hierarchy node kind, not just
// worksheets: clear the query, expand collapsed ancestors, select per L0.25.
describe("Library — project-wide search + Show in Library reveal (PR D2)", () => {
  const editableFig = createFigureDocument({ id: "fig1", name: "Loop Figure", datasetId: "a", view: defaultPlotView() });

  beforeEach(() => {
    useApp.setState({
      datasets: [{ ...dsWith("a", "f1"), workbookId: "w1", name: "loop.dat" }],
      workbooks: [{ id: "w1", name: "Run", folderId: "f1" }],
      folders: [folder("f1", "Growth")],
      editableFigures: [editableFig],
      expandedFolders: [],
      expandedWorkbookIds: [],
      activeId: null,
      selectedIds: [],
      librarySelection: null,
      revealTarget: null,
    });
  });

  it("Show in Library on an artifact result clears the query, expands its ancestors, and selects it", async () => {
    render(<Library />);
    const input = screen.getByPlaceholderText(/Filter/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "loop figure" } });
    const figRow = (await screen.findByText("Loop Figure")).closest("tr")!;
    fireEvent.click(figRow.querySelector(".qzk-details-reveal") as HTMLElement);

    expect(input.value).toBe(""); // search cleared — back to the hierarchy
    const s = useApp.getState();
    expect(s.librarySelection).toEqual({ kind: "editable-figure", id: "fig1" });
    expect(s.revealTarget).toBeNull();
    // The observable reveal contract: whatever the figure's parent chain is,
    // every collapsed ancestor is now disclosed, so its row RENDERS in the
    // tree the query cleared back to.
    expect(await screen.findByRole("button", { name: /Loop Figure/ })).toBeInTheDocument();
  });

  it("a kind:id reveal request expands the target worksheet's folder AND workbook ancestors", () => {
    render(<Library />);
    act(() => {
      useApp.getState().requestReveal("worksheet:a");
    });
    const s = useApp.getState();
    expect(s.expandedFolders).toContain("f1");
    expect(s.expandedWorkbookIds).toContain("w1");
    expect(s.selectedIds).toEqual(["a"]);
    expect(s.revealTarget).toBeNull();
  });

  it("search matches artifacts and workbooks by name project-wide", async () => {
    render(<Library />);
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: "run" } });
    expect(await screen.findByLabelText("Library details table")).toBeInTheDocument();
    expect(screen.getByText("Run")).toBeInTheDocument(); // the workbook itself is a result
    expect(screen.queryByText("loop.dat")).not.toBeInTheDocument(); // non-matching worksheet excluded
  });
});

describe("Library — multi-select bar (GUI_INTERACTION_PLAN #13 sub-item 3)", () => {
  it("is absent below 2 selected, appears at >=2 with the N-selected count", () => {
    useApp.setState({ datasets: [dsWith("a"), dsWith("b")], selectedIds: ["a"] });
    const { rerender } = render(<Library />);
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    useApp.setState({ selectedIds: ["a", "b"] });
    rerender(<Library />);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("Clear empties the multi-selection", () => {
    useApp.setState({ datasets: [dsWith("a"), dsWith("b")], selectedIds: ["a", "b"] });
    render(<Library />);
    fireEvent.click(screen.getByText("Clear"));
    expect(useApp.getState().selectedIds).toEqual([]);
  });
});

describe("Library — smart-folder query grammar in the filter box (item 9)", () => {
  const tagged = (id: string, tags: string[]): Dataset => ({ ...dsWith(id), tags });

  it("a bare term still matches name OR tag (historical behavior)", () => {
    useApp.setState({ datasets: [tagged("loop.dat", ["MvsH"]), dsWith("xrd.raw")] });
    render(<Library />);
    const input = screen.getByPlaceholderText(/Filter/);
    fireEvent.change(input, { target: { value: "mvsh" } });
    expect(screen.getByText("loop.dat")).toBeInTheDocument();
    expect(screen.queryByText("xrd.raw")).not.toBeInTheDocument();
  });

  it("tag: narrows to tags only", () => {
    useApp.setState({
      datasets: [tagged("loop.dat", ["MvsH"]), dsWith("mvsh-named-but-untagged.dat")],
    });
    render(<Library />);
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: "tag:mvsh" } });
    expect(screen.getByText("loop.dat")).toBeInTheDocument();
    expect(screen.queryByText("mvsh-named-but-untagged.dat")).not.toBeInTheDocument();
  });

  it("offers ☆ save-as-smart-folder and ⊙ save-as-Collection only while a query is typed", () => {
    useApp.setState({ datasets: [dsWith("a")], smartFolders: [], collections: [] });
    render(<Library />);
    expect(screen.queryByTitle(/Save this filter as a smart folder/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Save this filter as a Collection/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter/), { target: { value: "tag:x" } });
    expect(screen.getByTitle(/Save this filter as a smart folder/)).toBeInTheDocument();
    expect(screen.getByTitle(/Save this filter as a Collection/)).toBeInTheDocument();
  });

  it("renders the smart-folders section when saved queries exist", () => {
    useApp.setState({
      datasets: [tagged("loop.dat", ["MvsH"])],
      smartFolders: [{ id: "s1", name: "Loops", query: "tag:mvsh" }],
    });
    render(<Library />);
    expect(screen.getByText("Smart folders")).toBeInTheDocument();
    expect(screen.getByText("☆ Loops")).toBeInTheDocument();
  });
});

describe("Library — Tree / Details renderer continuity (PR D)", () => {
  it("restores the preference and preserves selection, query, and focused item", async () => {
    const dataset = { ...dsWith("beta.csv"), workbookId: "w1" };
    localStorage.setItem(LIBRARY_VIEW_PREFS_KEY, JSON.stringify({ mode: "details" }));
    useApp.setState({
      datasets: [dataset],
      workbooks: [{ id: "w1", name: "Run" }],
    });
    render(<Library />);

    await screen.findByLabelText("Library details table");
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-pressed", "true");
    const row = screen.getByText("beta.csv").closest("tr") as HTMLTableRowElement;
    fireEvent.click(row);
    row.focus();

    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    await waitFor(() => expect(document.querySelector('[data-ds-id="beta.csv"]')).not.toBeNull());
    expect(useApp.getState().selectedIds).toEqual(["beta.csv"]);
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-ds-id", "beta.csv"));
    expect(JSON.parse(localStorage.getItem(LIBRARY_VIEW_PREFS_KEY) ?? "{}")).toEqual({ mode: "tree" });

    const filter = screen.getByPlaceholderText(/Filter/);
    fireEvent.change(filter, { target: { value: "beta" } });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(filter).toHaveValue("beta");
    expect(screen.getByText("beta.csv")).toBeInTheDocument();
  });
});

// FU-2 (provenance-disclosure follow-ups): OriginFidelitySection used to hold
// its collapsed flag in a per-mount useState, and Library.tsx unmounts the
// section whenever search is active (`{!searchActive && <OriginFidelitySection />}`)
// — so a deliberate expand was lost on every search, and since the section
// defaults collapsed, the loss always resolved toward hidden. The flag now
// lives in the store (store/libraryPanel.ts's `originFidelitySectionExpanded`)
// so it survives the unmount/remount.
describe("Library — OriginFidelitySection disclosure survives search (FU-2)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [dsWith("a")],
      folders: [],
      workbooks: [],
      activeId: null,
      selectedIds: [],
      originFidelity: [
        {
          id: "fidelity-a",
          stem: "XRD",
          siblingIds: ["a"],
          manifest: {
            version: 1,
            container: "opj",
            status: "best_effort",
            graph_records_total: 1,
            graph_records_actionable: 1,
            graph_records_filtered: 0,
            omissions: [],
            filtered_figures: [],
          },
        },
      ],
    });
  });

  it("expanding the section, then activating and clearing search, leaves it expanded", async () => {
    render(<Library />);

    // Expand it — the per-project fidelity summary becomes visible.
    fireEvent.click(screen.getByText("Origin fidelity"));
    expect(screen.getByText(/XRD · Best effort/)).toBeInTheDocument();

    // Activate search: Library.tsx unmounts OriginFidelitySection entirely
    // while a query is active.
    const filter = screen.getByPlaceholderText(/Filter/);
    fireEvent.change(filter, { target: { value: "xrd" } });
    await screen.findByLabelText("Library details table");
    expect(screen.queryByText("Origin fidelity")).not.toBeInTheDocument();

    // Clear search: the section remounts. It must come back EXPANDED, not
    // reset to its collapsed default.
    fireEvent.change(filter, { target: { value: "" } });
    expect(screen.getByText("Origin fidelity")).toBeInTheDocument();
    expect(screen.getByText(/XRD · Best effort/)).toBeInTheDocument();
  });
});
