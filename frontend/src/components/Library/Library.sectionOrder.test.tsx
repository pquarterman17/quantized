// Re-audit #9: an Origin import inserted the Origin fidelity section and the
// book-family card ABOVE the tree (two jumps of ~22 and ~96 px within half a
// second), so a double-click aimed at a row landed on whatever slid under
// the pointer. In the tree those project-wide sections now come after the
// rows; the flat list keeps them above its rows, as before.
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import Library from "./Library";
import { LIBRARY_VIEW_PREFS_KEY } from "../../lib/libraryViewPrefs";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

const book = (id: string, origin: string): Dataset => ({
  id,
  name: `proj:${origin}`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: { origin_book: origin } },
});
const csv: Dataset = { id: "csv", name: "decay-err.csv", data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} } };

beforeAll(async () => {
  await import("./LibraryTree");
  await import("./BookFamiliesSection");
});

beforeEach(() => {
  localStorage.removeItem(LIBRARY_VIEW_PREFS_KEY);
  useApp.setState({
    datasets: [csv, book("b1", "Moke"), book("b2", "Loop")],
    folders: [], workbooks: [], expandedFolders: [], expandedWorkbookIds: [],
    originFigures: [], originFidelity: [], smartFolders: [], collections: [],
    activeId: "csv", selectedIds: ["csv"], librarySelection: null,
  });
});

describe("Library tree: project-wide sections come after the rows (re-audit #9)", () => {
  it("the Book families section renders below the tree's rows", async () => {
    render(<Library />);
    const families = await screen.findByText("Book families");
    const row = await screen.findByText("decay-err.csv");
    // DOCUMENT_POSITION_FOLLOWING (4): the section follows the row.
    expect(row.compareDocumentPosition(families) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
