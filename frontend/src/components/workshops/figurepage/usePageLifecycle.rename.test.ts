// A Library rename of the page that is OPEN in the Figure Page workshop must
// reach the open session (FIGURE_AUTHORING_WORKFLOW_PLAN F3.3 residue): the
// session's name was a local snapshot, so the next Save wrote the old name
// back over the rename.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../../../lib/figureDocument";
import { createPageDocument } from "../../../lib/pageDocumentActions";
import { defaultPlotView } from "../../../lib/plotview";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFigurePage } from "./useFigurePage";

vi.mock("../../../lib/api", () => ({
  exportFigurePage: vi.fn().mockResolvedValue(undefined),
  renderFigurePageBlob: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
  fetchBookData: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["A"],
  units: ["u"],
  metadata: {},
};

const FIGURE = createFigureDocument({
  id: "figure-1",
  name: "Saved loop",
  datasetId: "d1",
  view: { ...defaultPlotView(), yKeys: [0] },
});

const SAVED = createPageDocument({
  id: "page-1",
  name: "Original name",
  rows: 1,
  cols: 1,
  panels: [{ figureId: "figure-1", label: null, title: null }],
});

function openSavedPage() {
  useApp.getState().openPageDocument("page-1");
  return renderHook(() => useFigurePage());
}

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: DATA }],
    plotWindows: [],
    figureDocs: [],
    editableFigures: [FIGURE],
    pages: [SAVED],
    pageDocSeed: null,
    figurePageOpen: false,
    history: [],
    future: [],
    status: "",
  });
});

describe("Figure Page session follows a Library rename", () => {
  it("Save after a Library rename keeps the new name", () => {
    const { result } = openSavedPage();
    expect(result.current.name).toBe("Original name");

    act(() => useApp.getState().renamePageDocument("page-1", "Renamed in Library"));
    act(() => result.current.save());

    expect(useApp.getState().pages).toHaveLength(1);
    expect(useApp.getState().pages[0].name).toBe("Renamed in Library");
  });

  it("the open session's title follows the rename and stays clean", () => {
    const { result } = openSavedPage();
    act(() => useApp.getState().renamePageDocument("page-1", "Renamed in Library"));

    expect(result.current.name).toBe("Renamed in Library");
    expect(result.current.pageDocument.name).toBe("Renamed in Library");
    expect(result.current.dirty).toBe(false);
  });

  it("undoing the rename restores the old name in the session, and Save keeps it", () => {
    const { result } = openSavedPage();
    act(() => useApp.getState().renamePageDocument("page-1", "Renamed in Library"));
    act(() => useApp.getState().undo());

    expect(useApp.getState().pages[0].name).toBe("Original name");
    expect(result.current.name).toBe("Original name");
    expect(result.current.dirty).toBe(false);

    act(() => result.current.save());
    expect(useApp.getState().pages[0].name).toBe("Original name");
  });

  it("keeps the session's other unsaved edits when following a rename", () => {
    const { result } = openSavedPage();
    act(() => result.current.setDpi(150));
    act(() => useApp.getState().renamePageDocument("page-1", "Renamed in Library"));

    expect(result.current.name).toBe("Renamed in Library");
    expect(result.current.dpi).toBe(150);
    expect(result.current.dirty).toBe(true);

    act(() => result.current.save());
    expect(useApp.getState().pages[0].name).toBe("Renamed in Library");
    expect(useApp.getState().pages[0].output.dpi).toBe(150);
  });

  it("an unsaved name typed in the session is not overwritten by a Library rename or its undo", () => {
    const { result } = openSavedPage();
    act(() => useApp.getState().renamePageDocument("page-1", "Renamed in Library"));
    act(() => result.current.setName("Typed in session"));

    act(() => useApp.getState().undo()); // reverts the Library rename only
    expect(useApp.getState().pages[0].name).toBe("Original name");
    expect(result.current.name).toBe("Typed in session");
    expect(result.current.dirty).toBe(true);

    act(() => useApp.getState().renamePageDocument("page-1", "Renamed again"));
    expect(result.current.name).toBe("Typed in session");

    act(() => result.current.save());
    expect(useApp.getState().pages[0].name).toBe("Typed in session");
  });

  it("a rename of a DIFFERENT page leaves the open session alone", () => {
    const other = createPageDocument({ id: "page-2", name: "Other page" });
    useApp.setState({ pages: [SAVED, other] });
    const { result } = openSavedPage();
    act(() => useApp.getState().renamePageDocument("page-2", "Other renamed"));

    expect(result.current.name).toBe("Original name");
    expect(result.current.dirty).toBe(false);
  });
});
