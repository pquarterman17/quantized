// Collections section (LIBRARY_WORKBOOK_UX_PLAN PR L, L0.48/L0.49):
// derived-membership sections over saved queries against the canonical
// hierarchy — collapsed by default with a live count chip, expand to member
// rows, edit/rename/create through the shared param dialog (mocked here),
// delete leaves members untouched. Mirrors SmartFoldersSection.test.tsx.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CollectionsSection from "./CollectionsSection";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const ds = (id: string, name: string, workbookId: string, tags?: string[]): Dataset => ({
  id,
  name,
  workbookId,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  ...(tags ? { tags } : {}),
});

const hierarchy = buildLibraryHierarchy({
  folders: [],
  workbooks: [{ id: "w", name: "Run" }],
  datasets: [ds("d1", "loop1.dat", "w", ["MvsH"]), ds("d2", "xrd.raw", "w")],
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [ds("d1", "loop1.dat", "w", ["MvsH"]), ds("d2", "xrd.raw", "w")],
    workbooks: [{ id: "w", name: "Run" }],
    collections: [{ id: "c1", name: "Loops", query: "tag:mvsh" }],
    activeId: "d1",
    selectedIds: ["d1"],
    history: [],
  });
});

describe("CollectionsSection", () => {
  it("renders nothing when no Collections exist", () => {
    useApp.setState({ collections: [] });
    const { container } = render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the Collection collapsed with a derived member count; expands to members", () => {
    render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={() => {}} />);
    expect(screen.getByText("⊙ Loops")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // count chip (d1 only)
    expect(screen.queryByText("loop1.dat")).not.toBeInTheDocument(); // collapsed
    fireEvent.click(screen.getByText("⊙ Loops"));
    expect(screen.getByText("loop1.dat")).toBeInTheDocument();
    expect(screen.queryByText("xrd.raw")).not.toBeInTheDocument(); // not a member
  });

  it("membership is derived live from the hierarchy — never a stored id list", () => {
    render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={() => {}} />);
    fireEvent.click(screen.getByText("⊙ Loops"));
    expect(screen.queryByText("xrd.raw")).not.toBeInTheDocument();
    const tagged = buildLibraryHierarchy({
      folders: [],
      workbooks: [{ id: "w", name: "Run" }],
      datasets: [ds("d1", "loop1.dat", "w", ["MvsH"]), ds("d2", "xrd.raw", "w", ["MvsH"])],
    });
    render(<CollectionsSection hierarchy={tagged} onShowInLibrary={() => {}} />);
    expect(useApp.getState().collections).toHaveLength(1); // nothing stored changed
    expect(screen.getAllByText("2").length).toBeGreaterThan(0); // count chip updated
  });

  it("clicking a member calls onShowInLibrary with its node — reveals the ONE real location, never a second place (L0.48)", () => {
    const onShow = vi.fn();
    render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={onShow} />);
    fireEvent.click(screen.getByText("⊙ Loops"));
    fireEvent.click(screen.getByText("loop1.dat"));
    expect(onShow).toHaveBeenCalledOnce();
    expect(onShow.mock.calls[0][0].key).toBe("worksheet:d1");
  });

  it("delete removes the Collection but never its members", () => {
    render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={() => {}} />);
    fireEvent.click(screen.getByTitle("Delete Collection (its members are untouched — L0.48)"));
    expect(useApp.getState().collections).toEqual([]);
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("delete is undoable", () => {
    render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={() => {}} />);
    fireEvent.click(screen.getByTitle("Delete Collection (its members are untouched — L0.48)"));
    useApp.getState().undo();
    expect(useApp.getState().collections).toHaveLength(1);
  });

  it("rename round-trips through the param dialog", async () => {
    vi.mocked(askParams).mockResolvedValue({ name: "Hysteresis loops" });
    render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={() => {}} />);
    fireEvent.click(screen.getByTitle("Rename Collection…"));
    await vi.waitFor(() => expect(useApp.getState().collections[0].name).toBe("Hysteresis loops"));
    expect(useApp.getState().collections[0].query).toBe("tag:mvsh"); // query untouched
  });

  it("editing the filter round-trips through the param dialog, name untouched", async () => {
    vi.mocked(askParams).mockResolvedValue({ query: "format:qd" });
    render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={() => {}} />);
    fireEvent.click(screen.getByTitle("Edit Collection filter…"));
    await vi.waitFor(() => expect(useApp.getState().collections[0].query).toBe("format:qd"));
    expect(useApp.getState().collections[0].name).toBe("Loops");
  });

  it("＋ creates a new Collection via the dialog (cancel = no-op)", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(null); // cancelled
    render(<CollectionsSection hierarchy={hierarchy} onShowInLibrary={() => {}} />);
    fireEvent.click(screen.getByTitle("New Collection…"));
    await Promise.resolve();
    expect(useApp.getState().collections).toHaveLength(1);

    vi.mocked(askParams).mockResolvedValueOnce({ name: "XRD", query: "format:rigaku" });
    fireEvent.click(screen.getByTitle("New Collection…"));
    await vi.waitFor(() => expect(useApp.getState().collections).toHaveLength(2));
    expect(useApp.getState().collections[1]).toMatchObject({ name: "XRD", query: "format:rigaku" });
  });
});
