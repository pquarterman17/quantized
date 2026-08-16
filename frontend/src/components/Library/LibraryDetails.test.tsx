import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryDetails from "./LibraryDetails";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import { buildLibraryHierarchy } from "../../lib/libraryHierarchy";
import type { Dataset } from "../../lib/types";
import { askConfirm } from "../overlays/ConfirmDialog";
import { askParams } from "../overlays/ParamDialog";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

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

  it("Delete on a focused artifact row routes to the registry's confirmed delete", () => {
    vi.mocked(askConfirm).mockReset();
    vi.mocked(askConfirm).mockResolvedValue(false as never);
    useApp.setState({ reports: [{ id: "rep1", name: "Fit report", datasetId: "d1", report: { title: "R", sections: [] } }] });
    render(<GlobalHarness />);
    row("report:rep1").focus();
    fireEvent.keyDown(row("report:rep1"), { key: "Delete" });
    expect(askConfirm).toHaveBeenCalledWith(
      'Delete "Fit report"?',
      expect.stringContaining("cannot be recovered"),
      "Delete",
      true,
    );
    // The declined confirm leaves the report — and the swallowed-key guard
    // still protects the unrelated active dataset either way.
    expect(useApp.getState().reports).toHaveLength(1);
    expect(useApp.getState().datasets.map((item) => item.id).sort()).toEqual(["d1", "d2", "solo"]);
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

describe("LibraryDetails — roving keyboard traversal (plan follow-up 4a)", () => {
  const navDatasets = [
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
  const rowKeys = (): Array<string | null> =>
    [...document.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-lib-row"));
  const tabStops = (): Array<string | null> =>
    [...document.querySelectorAll('tbody tr[tabindex="0"]')].map((tr) => tr.getAttribute("data-lib-row"));

  beforeEach(() => {
    useApp.setState({
      folders: [],
      workbooks: [{ id: "w", name: "Run" }],
      datasets: navDatasets,
      originFigures: [], editableFigures: [], figureDocs: [], pages: [], reports: [],
      librarySelection: null,
      activeId: "solo",
      selectedIds: [],
      trash: [],
      history: [],
      confirmRemove: false,
    });
  });

  it("the roving row is the component's ONLY sequential tab stop — the scroll wrapper is not in the Tab order (P1 review fix)", () => {
    const { container } = render(<GlobalHarness />);
    // Manual order: keyed root worksheet "solo" (order 2) sorts before the
    // unkeyed workbook (byOrder sinks unkeyed after keyed siblings).
    expect(rowKeys()).toEqual(["worksheet:solo", "workbook:w", "worksheet:d1", "worksheet:d2"]);
    // The FULL component tab sequence, not just tbody rows: everything with
    // a non-negative tabindex (native buttons excluded — the sort headers
    // are toolbar controls, not table entry points... they ARE focusable
    // buttons, so enumerate explicitly what precedes the row).
    // Hardening follow-on (Sol's #141 note): the eight sort headers rove
    // too, so the component's WHOLE sequential tab surface is exactly two
    // stops — one header button and one data row. No wrapper stop.
    const sequentialStops = [...container.querySelectorAll('[tabindex="0"]')];
    expect(sequentialStops).toHaveLength(2);
    expect(sequentialStops[0]?.closest("th")?.getAttribute("data-col")).toBe("name");
    expect(sequentialStops[1]?.getAttribute("data-lib-row")).toBe("worksheet:solo");
    expect(container.querySelector(".qzk-details-scroll")?.hasAttribute("tabindex")).toBe(false);
    act(() => row("worksheet:d2").focus());
    expect(tabStops()).toEqual(["worksheet:d2"]); // the rove moved
  });

  it("harness control: an arrow that misses the component entirely DOES step the global nav (so the assertions below mean something)", () => {
    render(<GlobalHarness />);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(useApp.getState().activeId).not.toBe("solo");
  });

  it("sort headers rove: one header tab stop, Left/Right traverse and clamp (Sol's #141 follow-on)", () => {
    const { container } = render(<GlobalHarness />);
    expect(container.querySelectorAll('thead [tabindex="0"]')).toHaveLength(1);
    const headerBtn = (key: string): HTMLElement =>
      container.querySelector(`th[data-col="${key}"] button`) as HTMLElement;
    headerBtn("name").focus();
    fireEvent.keyDown(headerBtn("name"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(headerBtn("type"));
    expect(container.querySelectorAll('thead [tabindex="0"]')).toHaveLength(1); // the rove moved, count didn't
    fireEvent.keyDown(headerBtn("type"), { key: "ArrowLeft" });
    fireEvent.keyDown(headerBtn("name"), { key: "ArrowLeft" }); // clamp at the first header
    expect(document.activeElement).toBe(headerBtn("name"));
    expect(useApp.getState().activeId).toBe("solo"); // horizontal keys never touch the dataset list
  });

  it("Delete on a focused sort-header button never reaches the global dataset handler (retrospective-audit P1)", () => {
    render(<GlobalHarness />);
    const header = screen.getByRole("button", { name: "Name" });
    header.focus();
    fireEvent.keyDown(header, { key: "Delete" });
    fireEvent.keyDown(header, { key: "Backspace" });
    const s = useApp.getState();
    expect(s.datasets).toHaveLength(3);
    expect(s.trash).toHaveLength(0);
  });

  it("a SINGLE wrapper-targeted ArrowDown leaves the active dataset unchanged (P1 review fix, belt)", () => {
    // One arrow, deliberately: a down-then-up pair is vacuous — the global
    // navigator wraps, so solo -> d1 -> solo passes WITH the leak present
    // (caught during this review round by flipping the assertion first).
    const { container } = render(<GlobalHarness />);
    const wrapper = container.querySelector(".qzk-details-scroll") as HTMLElement;
    fireEvent.keyDown(wrapper, { key: "ArrowDown" });
    expect(useApp.getState().activeId).toBe("solo");
  });

  it("Up/Down traverse and clamp; Home/End jump; the active dataset never changes (global nav gated)", () => {
    render(<GlobalHarness />);
    row("worksheet:solo").focus();
    fireEvent.keyDown(row("worksheet:solo"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("workbook:w"));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(row("worksheet:d2"));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" }); // clamp at the last row
    expect(document.activeElement).toBe(row("worksheet:d2"));
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(row("worksheet:solo"));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" }); // clamp at the first row
    expect(document.activeElement).toBe(row("worksheet:solo"));
    expect(useApp.getState().activeId).toBe("solo"); // the global prev/next-dataset arrows never fired
  });

  it("Left/Right are NOT navigation here — no disclosure semantics in a flat table", () => {
    render(<GlobalHarness />);
    row("worksheet:d1").focus();
    fireEvent.keyDown(row("worksheet:d1"), { key: "ArrowLeft" });
    fireEvent.keyDown(row("worksheet:d1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("worksheet:d1")); // focus never moved
  });

  it("arrows follow the CURRENT sorted order, and focus survives the re-sort on the same row", () => {
    render(<GlobalHarness />);
    row("worksheet:d2").focus(); // two.csv
    fireEvent.click(screen.getByRole("button", { name: "Name" })); // sort by name asc
    expect(document.activeElement).toBe(row("worksheet:d2")); // the moved <tr> keeps focus
    expect(rowKeys()).toEqual(["worksheet:solo", "worksheet:d1", "workbook:w", "worksheet:d2"]); // active/one/Run/two
    fireEvent.keyDown(row("worksheet:d2"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("workbook:w")); // the SORTED predecessor, not the manual one
  });

  it("Enter still opens canonically from a roved-to row", () => {
    render(<GlobalHarness />);
    row("workbook:w").focus();
    fireEvent.keyDown(row("workbook:w"), { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(useApp.getState().activeId).toBe("d1"); // opened the worksheet the rove landed on
  });

  it("focus lands on the nearest surviving row after the focused row is deleted", () => {
    render(<GlobalHarness />);
    row("worksheet:d1").focus();
    fireEvent.keyDown(row("worksheet:d1"), { key: "Delete" });
    expect(useApp.getState().datasets.some((d) => d.id === "d1")).toBe(false);
    expect(document.activeElement?.getAttribute("data-lib-row")).toBe("worksheet:d2"); // same position, next row
  });
});

describe("LibraryDetails — search-results surface (PR D2, L0.26)", () => {
  const searchDatasets = [
    dataset("d1", "moke-loop.csv", 0),
    dataset("d2", "xrd-scan.csv", 1),
  ];
  const searchHierarchy = buildLibraryHierarchy({
    folders: [{ id: "f1", name: "Growth", parentId: null, order: 0 }],
    workbooks: [{ id: "w", name: "MokeRun", folderId: "f1" }],
    datasets: searchDatasets,
  });

  beforeEach(() => {
    useApp.setState({
      datasets: searchDatasets,
      workbooks: [{ id: "w", name: "MokeRun", folderId: "f1" }],
      folders: [{ id: "f1", name: "Growth", parentId: null, order: 0 }],
      selectedIds: [],
      librarySelection: null,
      activeId: null,
      revealTarget: null,
    });
  });

  it("filters project-wide (workbook AND worksheet match by name) with full breadcrumbs, flat indent", () => {
    render(<LibraryDetails hierarchy={searchHierarchy} searchQuery="moke" />);
    const keys = [...document.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-lib-row"));
    expect(keys).toEqual(["workbook:w", "worksheet:d1"]); // xrd-scan excluded
    expect(screen.getByText("2 matches")).toBeInTheDocument();
    // Full breadcrumb: the worksheet row carries its Folder / Workbook path.
    const wsRow = screen.getByText("moke-loop.csv").closest("tr")!;
    expect(wsRow.querySelector(".qzk-details-name small")).toHaveTextContent("Growth / MokeRun");
    // Flat: no hierarchy indent even in manual order (breadcrumbs carry location).
    expect(screen.getByText("moke-loop.csv").closest("td")).toHaveStyle({ paddingLeft: "8px" });
  });

  it("open behavior is the node's normal open (worksheet activates); selection uses the L0.25 contract", () => {
    render(<LibraryDetails hierarchy={searchHierarchy} searchQuery="moke" />);
    const wsRow = screen.getByText("moke-loop.csv").closest("tr")!;
    fireEvent.click(wsRow);
    expect(useApp.getState().selectedIds).toEqual(["d1"]);
    fireEvent.doubleClick(wsRow);
    expect(useApp.getState().activeId).toBe("d1");
    // A workbook result selects through librarySelection (mutual exclusion holds).
    fireEvent.click(screen.getByText("MokeRun").closest("tr")!);
    const s = useApp.getState();
    expect(s.librarySelection).toEqual({ kind: "workbook", id: "w" });
    expect(s.selectedIds).toEqual([]);
  });

  it("Show in Library fires the callback with the row's node and never also selects/opens the row", () => {
    const onShow = vi.fn();
    render(<LibraryDetails hierarchy={searchHierarchy} searchQuery="moke" onShowInLibrary={onShow} />);
    const wsRow = screen.getByText("moke-loop.csv").closest("tr")!;
    const btn = wsRow.querySelector(".qzk-details-reveal") as HTMLElement;
    fireEvent.click(btn);
    expect(onShow).toHaveBeenCalledOnce();
    expect(onShow.mock.calls[0][0].key).toBe("worksheet:d1");
    expect(useApp.getState().selectedIds).toEqual([]); // stopPropagation held
  });

  it("Enter on the focused reveal button activates the button, not the row's open", () => {
    const onShow = vi.fn();
    render(<LibraryDetails hierarchy={searchHierarchy} searchQuery="moke" onShowInLibrary={onShow} />);
    const btn = screen.getByText("moke-loop.csv").closest("tr")!.querySelector(".qzk-details-reveal") as HTMLElement;
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    // The row's Enter handler stood down: no open happened…
    expect(useApp.getState().activeId).toBeNull();
    // …and the keystroke stayed available for the button's own activation
    // (jsdom doesn't synthesize click-from-Enter; a real browser does).
    fireEvent.click(btn);
    expect(onShow).toHaveBeenCalledOnce();
  });

  it("no matches renders the empty note; without a query the table is the ordinary Details renderer", () => {
    const { rerender } = render(<LibraryDetails hierarchy={searchHierarchy} searchQuery="zzz" />);
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.getByText("0 matches")).toBeInTheDocument();
    rerender(<LibraryDetails hierarchy={searchHierarchy} />);
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
    expect(screen.getByText(/items$/)).toBeInTheDocument();
    expect(document.querySelector(".qzk-details-reveal")).toBeNull(); // no reveal column outside search
  });

  it("roving traversal works over the filtered result order", () => {
    render(<LibraryDetails hierarchy={searchHierarchy} searchQuery="moke" />);
    const rowEl = (key: string): HTMLElement => document.querySelector(`[data-lib-row="${key}"]`) as HTMLElement;
    rowEl("workbook:w").focus();
    fireEvent.keyDown(rowEl("workbook:w"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(rowEl("worksheet:d1"));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" }); // clamp at last result
    expect(document.activeElement).toBe(rowEl("worksheet:d1"));
  });
});
