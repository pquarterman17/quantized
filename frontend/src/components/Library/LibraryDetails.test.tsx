import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryDetails from "./LibraryDetails";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import type { Dataset } from "../../lib/types";
import { askParams } from "../overlays/ParamDialog";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

function dataset(id: string, name: string, order: number): Dataset {
  return {
    id,
    name,
    workbookId: "w",
    order,
    data: { time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: {} },
  };
}

const datasets = [dataset("b", "beta.csv", 0), dataset("a", "alpha.csv", 1)];
const hierarchy = buildLibraryHierarchy({
  folders: [],
  workbooks: [{ id: "w", name: "Run" }],
  datasets,
});

beforeEach(() => {
  useApp.setState({
    datasets,
    workbooks: [{ id: "w", name: "Run" }],
    folders: [],
    selectedIds: [],
    librarySelection: null,
    activeId: null,
    expandedWorkbookIds: [],
    trash: [],
    history: [],
    confirmRemove: false,
  });
  vi.mocked(askParams).mockReset();
});

describe("LibraryDetails", () => {
  it("selects and opens the same canonical worksheet represented by its row", () => {
    render(<LibraryDetails hierarchy={hierarchy} />);
    const row = screen.getByText("beta.csv").closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(useApp.getState().selectedIds).toEqual(["b"]);
    expect(row).toHaveAttribute("aria-selected", "true");

    fireEvent.doubleClick(row!);
    expect(useApp.getState().activeId).toBe("b");
  });

  it("sorts visibly without losing the explicit route back to manual order", () => {
    render(<LibraryDetails hierarchy={hierarchy} />);
    const body = screen.getAllByRole("rowgroup")[1];
    expect(within(body).getAllByRole("row").map((row) => row.getAttribute("data-lib-row"))).toEqual([
      "workbook:w", "worksheet:b", "worksheet:a",
    ]);
    expect(screen.getByText("beta.csv").closest("td")).toHaveStyle({ paddingLeft: "18px" });

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(within(body).getAllByRole("row").map((row) => row.getAttribute("data-lib-row"))).toEqual([
      "worksheet:a", "worksheet:b", "workbook:w",
    ]);
    expect(screen.getByText("alpha.csv").closest("td")).toHaveStyle({ paddingLeft: "8px" });
    fireEvent.click(screen.getByRole("button", { name: "Manual order" }));
    expect(within(body).getAllByRole("row").map((row) => row.getAttribute("data-lib-row"))).toEqual([
      "workbook:w", "worksheet:b", "worksheet:a",
    ]);
    expect(screen.getByText("beta.csv").closest("td")).toHaveStyle({ paddingLeft: "18px" });
  });

  it("keeps location and dimensions in the compact Name cell for narrow panels", () => {
    render(<LibraryDetails hierarchy={hierarchy} />);
    const row = screen.getByText("beta.csv").closest("tr")!;
    const compact = row.querySelector(".qzk-details-name small");
    expect(compact).toHaveTextContent("Run · 2 × 1");
    expect(row.querySelectorAll(".qzk-details-medium")).toHaveLength(2);
    expect(row.querySelectorAll(".qzk-details-wide")).toHaveLength(4);
  });
});

describe("LibraryDetails — focused-row Delete owns the keystroke (PR #140 review)", () => {
  const deletionDatasets = [
    dataset("d1", "one.csv", 0),
    dataset("d2", "two.csv", 1),
    { ...dataset("solo", "active.csv", 2), workbookId: undefined },
  ];

  function GlobalHarness() {
    useGlobalShortcuts();
    const { hierarchy: liveHierarchy } = useLibraryHierarchyModel();
    return <LibraryDetails hierarchy={liveHierarchy} />;
  }

  const row = (key: string): HTMLElement => document.querySelector(`[data-lib-row="${key}"]`) as HTMLElement;

  beforeEach(() => {
    useApp.setState({
      folders: [],
      workbooks: [{ id: "w", name: "Run" }],
      datasets: deletionDatasets,
      originFigures: [],
      editableFigures: [],
      figureDocs: [],
      pages: [],
      reports: [],
      librarySelection: null,
      activeId: "solo",
      selectedIds: [],
      trash: [],
      history: [],
      confirmRemove: false,
    });
    vi.mocked(askParams).mockReset();
  });

  it("consumes Delete on a non-worksheet row instead of deleting the active plot dataset", () => {
    render(<GlobalHarness />);
    fireEvent.click(row("workbook:w"));
    row("workbook:w").focus();
    fireEvent.keyDown(row("workbook:w"), { key: "Delete" });
    expect(useApp.getState().datasets.map((item) => item.id).sort()).toEqual(["d1", "d2", "solo"]);
    expect(useApp.getState().trash).toHaveLength(0);
  });

  it("focus wins over the activeId fallback when selection is empty", () => {
    render(<GlobalHarness />);
    fireEvent.click(row("workbook:w")); // clears selectedIds
    row("worksheet:d1").focus();
    fireEvent.keyDown(row("worksheet:d1"), { key: "Delete" });
    expect(useApp.getState().datasets.map((item) => item.id).sort()).toEqual(["d2", "solo"]);
    expect(useApp.getState().trash.map((item) => item.dataset.id)).toEqual(["d1"]);
  });

  it("focus wins over a stale worksheet selection", () => {
    render(<GlobalHarness />);
    fireEvent.click(row("worksheet:d1"));
    row("worksheet:d2").focus();
    fireEvent.keyDown(row("worksheet:d2"), { key: "Backspace" });
    expect(useApp.getState().datasets.map((item) => item.id).sort()).toEqual(["d1", "solo"]);
    expect(useApp.getState().trash.map((item) => item.dataset.id)).toEqual(["d2"]);
  });

  it("deletes one focused worksheet's enclosing multi-selection as one batch", () => {
    useApp.setState({ selectedIds: ["d1", "d2"] });
    render(<GlobalHarness />);
    row("worksheet:d2").focus();
    fireEvent.keyDown(row("worksheet:d2"), { key: "Delete" });
    expect(useApp.getState().datasets.map((item) => item.id)).toEqual(["solo"]);
    expect(useApp.getState().trash.map((item) => item.dataset.id).sort()).toEqual(["d1", "d2"]);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("honors a cancelled confirmation without changing data, Trash, history, or selection", async () => {
    useApp.setState({ confirmRemove: true, selectedIds: ["d1"] });
    vi.mocked(askParams).mockResolvedValue(false as never);
    render(<GlobalHarness />);
    row("worksheet:d1").focus();
    fireEvent.keyDown(row("worksheet:d1"), { key: "Delete" });
    expect(askParams).toHaveBeenCalledOnce();
    await act(() => Promise.resolve());
    const state = useApp.getState();
    expect(state.datasets).toHaveLength(3);
    expect(state.trash).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    expect(state.selectedIds).toEqual(["d1"]);
  });
});
