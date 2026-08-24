// UX-R3 (plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md, "Owner-observed field
// issues"): "imported projects reveal hierarchy progressively; plain,
// visually distinct object types ... with useful summaries; the common path
// must not require understanding Origin internals." This file exercises the
// acceptance points end to end against the actual Tree/Details renderers —
// the store-level collapse contract itself is pinned in
// store/importWorkbooks.test.ts (the import action that PRODUCES this
// state); this file pins what the Library UI does with it.
//
// Fixture shape mirrors a REALISTIC multi-book .opju as lib/originFolders.ts
// would organize it: one project folder, one nested Project-Explorer
// subfolder, two workbooks in that subfolder, one worksheet per workbook —
// small enough to assert on directly, structurally identical (folder ->
// subfolder -> workbook -> worksheet) to what a real import produces.

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryDetails from "./LibraryDetails";
import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows, useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const noop = () => {};

function TreeHarness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={noop} />;
}

function DetailsHarness({ query }: { query: string }) {
  const { hierarchy } = useLibraryHierarchyModel();
  return <LibraryDetails hierarchy={hierarchy} searchQuery={query} />;
}

const folderRow = (id: string) => document.querySelector(`[data-lib-row="folder:${id}"]`) as HTMLElement;
const workbookRow = (id: string) => document.querySelector(`[data-lib-row="workbook:${id}"]`) as HTMLElement;
const worksheetRow = (id: string) => document.querySelector(`[data-ds-id="${id}"]`) as HTMLElement;
const caretOf = (row: HTMLElement) => row.querySelector(".qzk-group-caret") as HTMLElement;

/** The exact shape a multi-book .opju import lands in AFTER UX-R3
 *  (importDatasets.ts no longer merges the created folders/workbooks into
 *  expandedFolders/expandedWorkbookIds for a `books.length > 1` import). */
function seedMultiBookImport(): void {
  const project: FolderNode = { id: "proj", name: "Moke", parentId: null, order: 0 };
  const sub: FolderNode = { id: "sub", name: "Field sweeps", parentId: "proj", order: 0 };
  const wb1: WorkbookNode = { id: "wb1", name: "Book1", folderId: "sub", originBook: "Book1" };
  const wb2: WorkbookNode = { id: "wb2", name: "Book2", folderId: "sub", originBook: "Book2" };
  // A real import stamps BOTH `folderId` (the Project-Explorer leaf folder,
  // planOriginImport's folderMembership) and `workbookId` (the book layer) —
  // subtreeCount (lib/foldertree.ts) reads `folderId` directly, independent
  // of workbook nesting, so both must be set here for the count assertion
  // below to exercise the real invariant instead of a fixture artifact.
  const dataset = (id: string, workbookId: string): Dataset => ({
    id,
    name: `${id}.dat`,
    workbookId,
    folderId: "sub",
    data: { time: [0, 1], values: [[1, 2]], labels: ["M"], units: [""], metadata: {} },
  });
  useApp.setState({
    folders: [project, sub],
    workbooks: [wb1, wb2],
    datasets: [dataset("d1", "wb1"), dataset("d2", "wb2")],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    expandedFolders: [], // UX-R3: collapsed by default, not merged in at import
    expandedWorkbookIds: [], // UX-R3: collapsed by default, not merged in at import
    librarySelection: null,
    workbookLastChild: {},
    activeId: null,
    selectedIds: [],
  });
}

beforeEach(() => {
  useApp.setState({
    folders: [],
    workbooks: [],
    datasets: [],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    expandedFolders: [],
    expandedWorkbookIds: [],
    librarySelection: null,
    workbookLastChild: {},
    activeId: null,
    selectedIds: [],
  });
});

describe("UX-R3 — a multi-book Origin import reveals hierarchy progressively", () => {
  it("shows only the project folder at first — no subfolder, workbook, or worksheet row yet", () => {
    seedMultiBookImport();
    render(<TreeHarness />);
    expect(folderRow("proj")).toBeInTheDocument();
    expect(folderRow("sub")).not.toBeInTheDocument();
    expect(workbookRow("wb1")).not.toBeInTheDocument();
    expect(worksheetRow("d1")).not.toBeInTheDocument();
    expect(caretOf(folderRow("proj")).textContent).toBe("▸"); // collapsed
  });

  it("the collapsed project folder's count chip already reflects the full subtree (no expand needed to see scale)", () => {
    seedMultiBookImport();
    render(<TreeHarness />);
    expect(folderRow("proj").querySelector(".qzk-group-count")?.textContent).toBe("2");
  });

  it("expanding one level at a time reveals the subfolder, then the still-collapsed workbook groups, then worksheets", () => {
    seedMultiBookImport();
    render(<TreeHarness />);

    fireEvent.click(caretOf(folderRow("proj")));
    expect(folderRow("sub")).toBeInTheDocument();
    expect(workbookRow("wb1")).not.toBeInTheDocument();

    fireEvent.click(caretOf(folderRow("sub")));
    expect(workbookRow("wb1")).toBeInTheDocument();
    expect(workbookRow("wb2")).toBeInTheDocument();
    expect(caretOf(workbookRow("wb1")).textContent).toBe("▸"); // workbook group itself still collapsed
    expect(worksheetRow("d1")).not.toBeInTheDocument();

    fireEvent.click(caretOf(workbookRow("wb1")));
    expect(worksheetRow("d1")).toBeInTheDocument();
    expect(worksheetRow("d2")).not.toBeInTheDocument(); // wb2 is a separate, still-collapsed group
  });

  it("folder and workbook rows carry distinct icons/type labels even while collapsed", () => {
    seedMultiBookImport();
    render(<TreeHarness />);
    expect(folderRow("proj").querySelector('[title="Folder"]')).toBeInTheDocument();

    fireEvent.click(caretOf(folderRow("proj")));
    fireEvent.click(caretOf(folderRow("sub")));
    expect(workbookRow("wb1").querySelector('[title="Workbook"]')).toBeInTheDocument();
  });

  it("search still finds a worksheet tucked inside a fully collapsed folder -> workbook group", () => {
    seedMultiBookImport();
    // Nothing expanded — the collapsed default from seedMultiBookImport.
    render(<DetailsHarness query="d2" />);
    expect(screen.getByText("d2.dat")).toBeInTheDocument();
  });
});
