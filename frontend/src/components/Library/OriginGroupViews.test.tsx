// The derived "Unresolved Origin figures" group in the Tiles and Details
// renderers (the tree half lives in OriginGroupRow.test.tsx): one hierarchy,
// so the same node shows up as a browsable container tile and a listed row.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryDetails from "./LibraryDetails";
import LibraryWorkspace from "./LibraryWorkspace";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import { defaultVisibleDetailsColumnKeys } from "../../lib/libraryDetailsColumns";
import type { OriginFigureEntry } from "../../lib/originFigures";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const sheet: Dataset = {
  id: "d1", name: "d1.dat", workbookId: "w1",
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
};
const entry = (id: string, datasetId: string | null): OriginFigureEntry => ({
  id, stem: "Proj", datasetId, siblingIds: ["d1"],
  figure: {
    name: id, x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false,
    n_curves: 0, annotations: [],
  },
});
const folders = [{ id: "f1", name: "Proj", parentId: null, order: 0 }];
const workbooks = [{ id: "w1", name: "Book1", folderId: "f1" }];
const originFigures = [entry("good", "d1"), entry("u1", null), entry("u2", null)];

beforeEach(() => {
  useApp.setState({
    datasets: [sheet], folders, workbooks, originFigures,
    editableFigures: [], figureDocs: [], pages: [], reports: [],
    selectedIds: [], librarySelection: null, activeId: null,
    expandedFolders: ["f1"], expandedWorkbookIds: [], expandedOriginGroupIds: [],
    revealTarget: null, workbookLastChild: {},
    visibleDetailsColumns: defaultVisibleDetailsColumnKeys(),
  });
});

describe("Unresolved Origin figures group — Tiles", () => {
  it("is a container tile with a count; opening it browses to its figures without selecting it", () => {
    render(<LibraryWorkspace onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("listitem", { name: "Proj, Folder" }));
    const tile = screen.getByRole("listitem", { name: "Unresolved Origin figures (2), Unresolved Origin figures" });
    expect(within(tile).getByText(/2 figures/)).toBeInTheDocument();

    fireEvent.doubleClick(tile);
    expect(useApp.getState().librarySelection).toEqual({ kind: "folder", id: "f1" }); // group never selected
    const list = screen.getByRole("list", { name: "Unresolved Origin figures (2) items" });
    expect(within(list).getAllByRole("listitem").map((t) => t.getAttribute("aria-label"))).toEqual([
      "u1, Origin figure", "u2, Origin figure",
    ]);
  });
});

describe("Unresolved Origin figures group — Details", () => {
  it("is listed as an Unresolved row, ahead of its members, with no selection of its own", () => {
    const hierarchy = buildLibraryHierarchy({ folders, workbooks, datasets: [sheet], originFigures });
    render(<LibraryDetails hierarchy={hierarchy} />);
    const body = screen.getAllByRole("rowgroup")[1];
    const keys = within(body).getAllByRole("row").map((r) => r.getAttribute("data-lib-row"));
    const at = keys.indexOf("origin-group:unresolved-d1");
    expect(at).toBeGreaterThan(-1);
    expect(keys.slice(at, at + 3)).toEqual(["origin-group:unresolved-d1", "origin-figure:u1", "origin-figure:u2"]);
    const groupRow = within(body).getAllByRole("row")[at];
    fireEvent.click(groupRow);
    expect(useApp.getState().librarySelection).toBeNull();
    expect(groupRow).toHaveAttribute("aria-selected", "false");
    expect(within(groupRow).getAllByText("Unresolved").length).toBeGreaterThan(0);
  });
});
