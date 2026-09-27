// The Statistics stage's summary table, linked both ways to the app's row
// selection (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 4). Drives the REAL stage
// (StatStage + useStatStage + useStatGroupSelection) against the real store:
// the row selection it writes is the one the Worksheet and the XY plot read.
// Every wait is on rendered STATE (a row, an attribute), never on a mock call.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import StatStage from "./StatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

// grp declares A B C D. A: rows 0-2. B: row 3 (row 4 EXCLUDED). C: declared,
// no rows. D: rows 5-6.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6],
  values: [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 10],
    [1, 11],
    [3, 20],
    [3, 22],
  ],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C", "D"] },
};
const DS: Dataset = { id: "ds", name: "ds", data: DATA, excludedRows: [4] };
const OTHER: Dataset = { id: "other", name: "other", data: { ...DATA, values: DATA.values.map(([g]) => [g, 1]) } };

const sel = () => useApp.getState().selection;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  useApp.setState({
    theme: "dark", accent: "violet", datasets: [DS, OTHER], activeId: "ds", selection: null,
    yKeys: [1], xKey: null, seriesOrder: null, statStageSeed: null, statHideEmptyLevels: false,
  });
});

async function openTable() {
  render(<StatStage />);
  await userEvent.click(screen.getByRole("checkbox", { name: /summary/ }));
  const grid = await screen.findByRole("grid", { name: "Group summary" });
  const row = (label: string) => within(grid).getByText(label).closest("tr") as HTMLTableRowElement;
  return { grid, row };
}

describe("StatStage summary table — table -> selection", () => {
  it("lists every level, the empty one included, with n and stats", async () => {
    const { grid, row } = await openTable();
    expect(within(grid).getAllByRole("row")).toHaveLength(5); // header + A B C D
    expect(row("grp = C").getAttribute("aria-selected")).toBe("false");
    expect(within(row("grp = A")).getAllByRole("gridcell").map((c) => c.textContent).slice(1, 3)).toEqual(["3", "2"]);
    // B: one row excluded — dropped, and n=1.
    expect(within(row("grp = B")).getAllByRole("gridcell")[1].textContent).toBe("1");
  });

  it("clicking a group selects its rows (original indices, excluded row left out)", async () => {
    const { row } = await openTable();
    await userEvent.click(row("grp = B"));
    await waitFor(() => expect(row("grp = B").getAttribute("aria-selected")).toBe("true"));
    expect(sel()).toEqual({ datasetId: "ds", rows: [3] });
    await userEvent.click(row("grp = D"));
    await waitFor(() => expect(sel()?.rows).toEqual([5, 6]));
    expect(row("grp = B").getAttribute("aria-selected")).toBe("false");
  });

  it("ctrl-click adds and removes; shift-click selects the run", async () => {
    const { row } = await openTable();
    await userEvent.click(row("grp = A"));
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(row("grp = D"));
    await user.keyboard("{/Control}");
    await waitFor(() => expect(sel()?.rows).toEqual([0, 1, 2, 5, 6]));
    fireEvent.click(row("grp = A"), { ctrlKey: true });
    await waitFor(() => expect(sel()?.rows).toEqual([5, 6]));
    fireEvent.click(row("grp = A"));
    fireEvent.click(row("grp = C"), { shiftKey: true });
    await waitFor(() => expect(sel()?.rows).toEqual([0, 1, 2, 3]));
    expect(row("grp = C").getAttribute("aria-selected")).toBe("true");
  });

  it("an empty level is selectable and selects nothing — and does not resurrect", async () => {
    const { row } = await openTable();
    await userEvent.click(row("grp = A"));
    await waitFor(() => expect(sel()?.rows).toEqual([0, 1, 2]));
    await userEvent.click(row("grp = C"));
    await waitFor(() => expect(row("grp = C").getAttribute("aria-selected")).toBe("true"));
    expect(sel()).toBeNull();
    // Something else selects rows: the empty pick is dropped…
    act(() => useApp.getState().setRowSelection([0]));
    await waitFor(() => expect(row("grp = C").getAttribute("aria-selected")).toBe("false"));
    // …and a selection returning to null does not bring it back.
    act(() => useApp.getState().clearRowSelection());
    await waitFor(() => expect(within(row("grp = A")).getAllByRole("gridcell").at(-1)?.textContent).toBe(""));
    expect(row("grp = C").getAttribute("aria-selected")).toBe("false");
  });

  it("keyboard: arrows move, Enter picks, Shift+Arrow extends, Escape clears, Delete is consumed", async () => {
    const { row } = await openTable();
    const user = userEvent.setup();
    row("grp = A").focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(row("grp = B"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(sel()?.rows).toEqual([3]));
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    await waitFor(() => expect(sel()?.rows).toEqual([3, 5, 6]));
    expect(row("grp = B").getAttribute("aria-selected")).toBe("true");
    expect(row("grp = D").getAttribute("aria-selected")).toBe("true");
    const del = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    row("grp = D").dispatchEvent(del);
    expect(del.defaultPrevented).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(2);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(sel()).toBeNull());
    expect(row("grp = D").getAttribute("aria-selected")).toBe("false");
  });
});

describe("StatStage summary table — selection -> table, and the plot", () => {
  it("a selection made elsewhere shows as all / partial per group", async () => {
    const { row } = await openTable();
    act(() => useApp.getState().setRowSelection([5]));
    await waitFor(() => expect(within(row("grp = D")).getAllByRole("gridcell").at(-1)?.textContent).toBe("1/2"));
    expect(row("grp = D").getAttribute("aria-selected")).toBe("false");
    // Row 4 is excluded: selecting it does not make B look selected.
    act(() => useApp.getState().setRowSelection([4, 5, 6]));
    await waitFor(() => expect(row("grp = D").getAttribute("aria-selected")).toBe("true"));
    expect(within(row("grp = B")).getAllByRole("gridcell").at(-1)?.textContent).toBe("");
  });

  it("a dataset switch leaves no stale selection on the table", async () => {
    const { row } = await openTable();
    await userEvent.click(row("grp = A"));
    await waitFor(() => expect(row("grp = A").getAttribute("aria-selected")).toBe("true"));
    act(() => useApp.setState({ activeId: "other" }));
    await waitFor(() => expect(row("grp = A").getAttribute("aria-selected")).toBe("false"));
    expect(within(row("grp = A")).getAllByRole("gridcell").at(-1)?.textContent).toBe("");
  });

  it("clicking a category slot on the plot selects that group (the plot -> table direction)", async () => {
    const { row } = await openTable();
    const host = await screen.findByTestId("stat-canvas-host");
    // jsdom lays out 0x0: the canvas falls back to 600x400, whose plot rect
    // spans x 60..580 — four slots, D is the last (x ~ 515).
    fireEvent.click(host, { clientX: 515, clientY: 200 });
    await waitFor(() => expect(row("grp = D").getAttribute("aria-selected")).toBe("true"));
    expect(sel()?.rows).toEqual([5, 6]);
    // Ctrl-click on slot A adds it.
    fireEvent.click(host, { clientX: 100, clientY: 200, ctrlKey: true });
    await waitFor(() => expect(sel()?.rows).toEqual([0, 1, 2, 5, 6]));
    // Outside the plot: nothing.
    fireEvent.click(host, { clientX: 10, clientY: 200 });
    expect(sel()?.rows).toEqual([0, 1, 2, 5, 6]);
  });
});
