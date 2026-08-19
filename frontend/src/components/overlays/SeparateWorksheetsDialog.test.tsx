import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import type { Dataset } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import SeparateWorksheetsDialog from "./SeparateWorksheetsDialog";

vi.mock("../../store/toasts", () => ({ toast: vi.fn() }));

const wb = (id: string, name: string, folderId?: string): WorkbookNode => ({ id, name, folderId });
const ds = (id: string, name: string, workbookId: string | undefined, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
  ...extra,
});

beforeEach(() => {
  useApp.setState({
    datasets: [ds("d1", "A.dat", "w1"), ds("d2", "B.dat", "w1")],
    workbooks: [wb("w1", "Source", "f1")],
    folders: [{ id: "f1", name: "Folder", parentId: null, order: 0 }],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    reports: [],
    pages: [],
    quickPlotTemplates: [],
    activeId: null,
    selectedIds: [],
    trash: [],
    history: [],
    future: [],
    status: "",
    separatePreview: null,
  });
});

describe("SeparateWorksheetsDialog — visibility", () => {
  it("renders nothing when no preview is open", () => {
    const { container } = render(<SeparateWorksheetsDialog />);
    expect(container.firstChild).toBeNull();
  });
});

describe("SeparateWorksheetsDialog — affected-item preview", () => {
  it("shows the previewed plan's items with their move/stay verdict before commit", () => {
    useApp.getState().previewSeparateWorksheets(["d1"]);
    render(<SeparateWorksheetsDialog />);
    expect(screen.getByText("A.dat")).toBeInTheDocument();
    expect(screen.getByText("selected for separation")).toBeInTheDocument();
  });

  it("Cancel discards the preview with zero mutation", () => {
    useApp.getState().previewSeparateWorksheets(["d1"]);
    render(<SeparateWorksheetsDialog />);
    const before = useApp.getState();
    fireEvent.click(screen.getByText("Cancel"));
    expect(useApp.getState().separatePreview).toBeNull();
    expect(useApp.getState().workbooks).toBe(before.workbooks);
    expect(useApp.getState().datasets).toBe(before.datasets);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("Separate commits exactly the previewed plan and closes", () => {
    useApp.getState().previewSeparateWorksheets(["d1"]);
    render(<SeparateWorksheetsDialog />);
    fireEvent.click(screen.getByText("Separate"));
    expect(useApp.getState().separatePreview).toBeNull();
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "d1")?.workbookId).not.toBe("w1");
    expect(s.datasets.find((d) => d.id === "d2")?.workbookId).toBe("w1");
    expect(s.history).toHaveLength(1);
  });

  it("a stale preview fails closed with a clear message, surfaced in the dialog rather than swallowed", () => {
    useApp.getState().previewSeparateWorksheets(["d1"]);
    render(<SeparateWorksheetsDialog />);
    // Race: d1 vanishes after the preview opened, before commit.
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "d1") }));
    fireEvent.click(screen.getByText("Separate"));
    expect(screen.getByText(/previewed worksheet changed/)).toBeInTheDocument();
    // The dialog stays open so the user can re-preview, per the store contract.
    expect(useApp.getState().separatePreview).not.toBeNull();
  });
});
