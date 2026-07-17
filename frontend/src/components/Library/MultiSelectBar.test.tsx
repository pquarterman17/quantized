// Multi-select action bar (GUI_INTERACTION_PLAN #13 sub-item 3): appears at
// >=2 selected rows, every button dispatches an EXISTING bulk operation.
// askParams (Move/Tag's prompts) and the CSV exporter are mocked exactly like
// folderOps.test.ts — these ops are the SAME primitives it already covers.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MultiSelectBar from "./MultiSelectBar";
import { exportConsolidated } from "../../lib/api";
import type { Dataset, DataStruct, FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";

vi.mock("../../lib/api", () => ({ exportConsolidated: vi.fn() }));
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const raw: DataStruct = { time: [1, 2], values: [[1], [2]], labels: ["m"], units: ["emu"], metadata: {} };
const ds = (id: string): Dataset => ({ id, name: `${id}.dat`, data: raw });
const fld = (id: string, name: string): FolderNode => ({ id, name, parentId: null, order: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  const s = useApp.getState();
  useApp.setState({
    datasets: [ds("a"), ds("b"), ds("c")],
    folders: [fld("grp", "Grp")],
    activeId: "a",
    selectedIds: ["a", "b"],
    plotWindows: [s.plotWindows[0]],
    focusedWindowId: s.plotWindows[0].id,
  });
});

describe("MultiSelectBar visibility", () => {
  it("is absent below 2 selected", () => {
    useApp.setState({ selectedIds: ["a"] });
    const { container } = render(<MultiSelectBar />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the count at >=2 selected", () => {
    render(<MultiSelectBar />);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });
});

describe("MultiSelectBar actions dispatch the existing bulk operations", () => {
  it("Plot opens an overlay panel window over the selection and focuses it", () => {
    const before = useApp.getState().plotWindows.length;
    render(<MultiSelectBar />);
    fireEvent.click(screen.getByText("Plot"));
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(before + 1);
    const win = s.plotWindows.find((w) => w.kind === "panel")!;
    expect(win.panel).toEqual({ datasetIds: ["a", "b"], layout: "overlay" });
  });

  it("Move prompts a folder pick, then moves every selected id there", async () => {
    vi.mocked(askParams).mockResolvedValue({ folder: "Grp" });
    render(<MultiSelectBar />);
    fireEvent.click(screen.getByText("Move"));
    await waitFor(() => {
      expect(useApp.getState().datasets.find((d) => d.id === "a")!.folderId).toBe("grp");
    });
    expect(useApp.getState().datasets.find((d) => d.id === "b")!.folderId).toBe("grp");
    expect(useApp.getState().datasets.find((d) => d.id === "c")!.folderId).toBeUndefined();
  });

  it("Move to top level clears folderId", async () => {
    useApp.setState({ datasets: [{ ...ds("a"), folderId: "grp" }, { ...ds("b"), folderId: "grp" }, ds("c")] });
    vi.mocked(askParams).mockResolvedValue({ folder: "(top level)" });
    render(<MultiSelectBar />);
    fireEvent.click(screen.getByText("Move"));
    await waitFor(() => {
      expect(useApp.getState().datasets.find((d) => d.id === "a")!.folderId).toBeUndefined();
    });
  });

  it("Tag adds the entered tag to every selected dataset", async () => {
    vi.mocked(askParams).mockResolvedValue({ tag: "MvsH" });
    render(<MultiSelectBar />);
    fireEvent.click(screen.getByText("Tag"));
    await waitFor(() => {
      expect(useApp.getState().datasets.find((d) => d.id === "a")!.tags).toEqual(["MvsH"]);
    });
    expect(useApp.getState().datasets.find((d) => d.id === "b")!.tags).toEqual(["MvsH"]);
    expect(useApp.getState().datasets.find((d) => d.id === "c")!.tags ?? []).toEqual([]);
  });

  it("a blank tag entry does nothing", async () => {
    vi.mocked(askParams).mockResolvedValue({ tag: "   " });
    render(<MultiSelectBar />);
    fireEvent.click(screen.getByText("Tag"));
    await waitFor(() => expect(askParams).toHaveBeenCalled());
    expect(useApp.getState().datasets.find((d) => d.id === "a")!.tags ?? []).toEqual([]);
  });

  it("Export sends the selected ids to the consolidated exporter", async () => {
    vi.mocked(exportConsolidated).mockResolvedValue(undefined);
    render(<MultiSelectBar />);
    fireEvent.click(screen.getByText("Export"));
    await waitFor(() => expect(exportConsolidated).toHaveBeenCalled());
    expect(exportConsolidated).toHaveBeenCalledWith({
      datasets: [
        { dataset: raw, name: "a.dat" },
        { dataset: raw, name: "b.dat" },
      ],
      filename: "selection-2.csv",
    });
  });

  it("Clear empties the multi-selection", () => {
    render(<MultiSelectBar />);
    fireEvent.click(screen.getByText("Clear"));
    expect(useApp.getState().selectedIds).toEqual([]);
  });
});
