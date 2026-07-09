import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsDescriptive } from "../../lib/api";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import Worksheet from "./Worksheet";

vi.mock("../../lib/api", () => ({
  statsDescriptive: vi.fn(),
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
}));

const data: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 20],
    [40, 50],
    [11, 12],
  ],
  labels: ["A", "B"],
  units: ["u1", "u2"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsDescriptive).mockResolvedValue({
    mean: 5, std: 1, min: 1, max: 9, median: 5, N: 3,
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data }],
    activeId: "d1",
    status: "",
    selection: null,
  });
});

describe("Worksheet context menus", () => {
  // Header cells in order: [ #, x(time), A, B ].
  const header = (i: number) => screen.getAllByRole("columnheader")[i];
  // Rows: [ headerRow, dataRow0, dataRow1, … ] (no stats footer by default).
  const dataRow = (i: number) => screen.getAllByRole("row")[i + 1];

  it("right-clicking a column header opens a menu that sets the X axis", () => {
    render(<Worksheet />);
    fireEvent.contextMenu(header(2)); // channel A
    const setX = screen.getByText("Set as X axis");
    fireEvent.click(setX);
    expect(useApp.getState().xKey).toBe(0); // channel A is index 0
  });

  it("right-clicking a data row opens a menu that masks the row", () => {
    render(<Worksheet />);
    fireEvent.contextMenu(dataRow(0));
    fireEvent.click(screen.getByText("Mask row"));
    // After masking, the same row offers "Unmask row".
    fireEvent.contextMenu(dataRow(0));
    expect(screen.getByText("Unmask row")).toBeInTheDocument();
  });

  it("a column header menu can toggle plot visibility", () => {
    render(<Worksheet />);
    fireEvent.contextMenu(header(3)); // channel B
    fireEvent.click(screen.getByText("Hide from plot"));
    // yKeys now excludes channel B (index 1) → [0].
    expect(useApp.getState().yKeys).toEqual([0]);
  });
});

describe("Worksheet column statistics", () => {
  it("shows no stats footer until toggled", () => {
    render(<Worksheet />);
    expect(screen.queryByText("Median")).not.toBeInTheDocument();
  });

  it("fetches descriptive stats for x + every channel over the full arrays", async () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByRole("button", { name: /Stats/ }));

    await waitFor(() => expect(statsDescriptive).toHaveBeenCalledTimes(3));
    expect(statsDescriptive).toHaveBeenCalledWith([1, 2, 3]); // x column
    expect(statsDescriptive).toHaveBeenCalledWith([10, 40, 11]); // channel A
    expect(statsDescriptive).toHaveBeenCalledWith([20, 50, 12]); // channel B
    // The footer surfaces the stat labels.
    expect(await screen.findByText("Median")).toBeInTheDocument();
    expect(screen.getByText("Std")).toBeInTheDocument();
  });

  it("hides the stats footer again when toggled off", async () => {
    render(<Worksheet />);
    const btn = screen.getByRole("button", { name: /Stats/ });
    fireEvent.click(btn);
    expect(await screen.findByText("Median")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByText("Median")).not.toBeInTheDocument();
  });

  it("degrades gracefully when the stats endpoint is unavailable", async () => {
    vi.mocked(statsDescriptive).mockRejectedValue(new Error("offline"));
    render(<Worksheet />);
    fireEvent.click(screen.getByRole("button", { name: /Stats/ }));
    expect(await screen.findByText(/unavailable offline/)).toBeInTheDocument();
  });
});

describe("Worksheet row filter", () => {
  const applyFilter = (col: string, value: string, op?: string) => {
    fireEvent.change(screen.getByLabelText("filter column"), { target: { value: col } });
    if (op) fireEvent.change(screen.getByLabelText("filter operator"), { target: { value: op } });
    fireEvent.change(screen.getByLabelText("filter value"), { target: { value } });
  };

  it("does not filter while the value is blank (Number('') is 0 trap)", () => {
    render(<Worksheet />);
    fireEvent.change(screen.getByLabelText("filter column"), { target: { value: "0" } });
    // operator ">" + empty value must NOT activate (would otherwise drop A<=0 rows).
    expect(screen.getByText("3 rows")).toBeInTheDocument();
  });

  it("hides rows that fail the predicate and reports the count", () => {
    render(<Worksheet />);
    applyFilter("0", "15"); // channel A > 15 keeps only the A=40 row
    expect(screen.getByText("1 of 3 rows")).toBeInTheDocument();
    expect(screen.getByText("40.0000")).toBeInTheDocument(); // kept row's A
    expect(screen.queryByText("10.0000")).not.toBeInTheDocument(); // dropped row's A
    expect(screen.queryByText("11.0000")).not.toBeInTheDocument(); // dropped row's A
  });

  it("narrows the descriptive-stats subset to the filtered rows", async () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByRole("button", { name: /Stats/ }));
    applyFilter("0", "15"); // keep only row index 1 → x=[2], A=[40], B=[50]
    await waitFor(() => expect(statsDescriptive).toHaveBeenCalledWith([40]));
    expect(statsDescriptive).toHaveBeenCalledWith([2]);
    expect(statsDescriptive).toHaveBeenCalledWith([50]);
  });

  it("Extract → materializes the filtered rows as a new dataset", () => {
    render(<Worksheet />);
    applyFilter("0", "15");
    fireEvent.click(screen.getByRole("button", { name: /Extract/ }));
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    expect(ds[1].name).toBe("scan (subset)");
    expect(ds[1].data.time).toEqual([2]);
    expect(ds[1].data.values).toEqual([[40, 50]]);
  });

  it("supports a between range on the x column", () => {
    render(<Worksheet />);
    applyFilter("-1", "1.5", "between"); // x between 1.5 and …
    fireEvent.change(screen.getByLabelText("filter value upper"), { target: { value: "2.5" } });
    expect(screen.getByText("1 of 3 rows")).toBeInTheDocument(); // only x=2
  });
});

describe("Worksheet row masking", () => {
  // Mask row index 1 via the right-click menu (the row-number click now selects).
  const maskRow1 = () => {
    fireEvent.contextMenu(screen.getAllByRole("row")[2]); // data row index 1
    fireEvent.click(screen.getByText("Mask row"));
  };

  it("keeps a masked row visible but flags the masked count", () => {
    render(<Worksheet />);
    maskRow1();
    expect(screen.getByText("40.0000")).toBeInTheDocument(); // still rendered (greyed)
    expect(screen.getByText(/1 masked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unmask/ })).toBeInTheDocument();
  });

  it("excludes masked rows from the descriptive-stats subset", async () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByRole("button", { name: /Stats/ }));
    maskRow1(); // leaves rows 0, 2
    await waitFor(() => expect(statsDescriptive).toHaveBeenCalledWith([10, 11])); // A minus masked
    expect(statsDescriptive).toHaveBeenCalledWith([1, 3]); // x minus masked
    expect(statsDescriptive).toHaveBeenCalledWith([20, 12]); // B minus masked
  });

  it("excludes masked rows from Extract", () => {
    render(<Worksheet />);
    maskRow1();
    fireEvent.click(screen.getByRole("button", { name: /Extract/ }));
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    expect(ds[1].name).toBe("scan (subset)");
    expect(ds[1].data.time).toEqual([1, 3]);
    expect(ds[1].data.values).toEqual([
      [10, 20],
      [11, 12],
    ]);
  });

  it("unmask restores the full analysis set", () => {
    render(<Worksheet />);
    maskRow1();
    expect(screen.getByText(/1 masked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unmask/ }));
    expect(screen.queryByText(/masked/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Extract/ })).not.toBeInTheDocument();
  });
});

describe("Worksheet row selection (#50)", () => {
  // Row-number cells carry the visible index; "2" is data row index 1.
  it("selects a row on row-number click and bulk-excludes the selection", () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByText("2")); // select row index 1
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Exclude" }));
    // selection → persistent exclusion (row index 1 masked); selection cleared
    expect(useApp.getState().datasets[0].excludedRows).toEqual([1]);
    expect(useApp.getState().selection).toBeNull();
    expect(screen.getByText(/1 masked/)).toBeInTheDocument();
  });

  it("shift-click selects a contiguous range of displayed rows", () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByText("1")); // anchor at row index 0
    fireEvent.click(screen.getByText("3"), { shiftKey: true }); // extend to row index 2
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("keep-only excludes every unselected row", () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByText("2")); // select only row index 1
    fireEvent.click(screen.getByRole("button", { name: "Keep only" }));
    expect(useApp.getState().datasets[0].excludedRows).toEqual([0, 2]);
  });
});

describe("Worksheet global-filter greying (#53 residual, item 7b)", () => {
  // Channel A (index 0) values are 10, 40, 11 — a filter keeping A >= 15
  // drops rows 0 and 2, leaving row 1.
  it("greys rows dropped by the global data filter, distinct from an exclusion", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "scan.dat", data, filter: [{ col: 0, kind: "range", min: 15 }] }],
      activeId: "d1",
    });
    render(<Worksheet />);
    // still visible (not the LOCAL worksheet-view filter, which would hide it)
    expect(screen.getByText("10.0000")).toBeInTheDocument();
    // rows 0 (A=10) and 2 (A=11) both fail the filter
    expect(screen.getAllByTitle("dropped by data filter")).toHaveLength(2);
  });

  it("a manually-excluded row keeps the exclusion styling even if it ALSO fails the filter", () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "scan.dat",
          data,
          filter: [{ col: 0, kind: "range", min: 15 }],
          excludedRows: [0],
        },
      ],
      activeId: "d1",
    });
    render(<Worksheet />);
    expect(screen.getByTitle("excluded row")).toBeInTheDocument();
    // exactly one row is greyed-as-filtered (row 2, value 11) — row 0 is excluded instead
    expect(screen.getAllByTitle("dropped by data filter")).toHaveLength(1);
  });

  it("no filter set → no row carries the filtered-out title", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data }], activeId: "d1" });
    render(<Worksheet />);
    expect(screen.queryByTitle("dropped by data filter")).not.toBeInTheDocument();
  });
});

describe("Worksheet computed columns (recompute)", () => {
  const addColumn = (expr: string, name?: string) => {
    fireEvent.change(screen.getByPlaceholderText("2*A + sqrt(B)"), { target: { value: expr } });
    if (name) fireEvent.change(screen.getByPlaceholderText("column name"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: /Add column/ }));
  };

  it("adds a live computed column to the active dataset (in place, no new dataset)", () => {
    render(<Worksheet />);
    addColumn("A + B", "S");
    expect(useApp.getState().datasets).toHaveLength(1); // in place, not a new dataset
    const d = useApp.getState().datasets[0];
    expect(d.formulas).toEqual([{ name: "S", expr: "A + B" }]);
    expect(d.data.values[0][2]).toBe(30); // 10 + 20
    expect(screen.getByText("30.0000")).toBeInTheDocument();
  });

  it("recomputes the column when a base cell is edited", () => {
    render(<Worksheet />);
    addColumn("A + B", "S");
    fireEvent.doubleClick(screen.getByText("10.0000")); // base A row 0
    const input = screen.getByDisplayValue("10");
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().datasets[0].data.values[0][2]).toBe(120); // S recomputed
    expect(screen.getByText("120.0000")).toBeInTheDocument();
  });

  it("removes a computed column via its header ×", () => {
    render(<Worksheet />);
    addColumn("A + B", "S");
    fireEvent.click(screen.getByRole("button", { name: "remove computed column" }));
    expect(useApp.getState().datasets[0].formulas).toBeUndefined();
    expect(useApp.getState().datasets[0].data.labels).toEqual(["A", "B"]);
  });
});

describe("Worksheet Origin designation + comment headers (item 4)", () => {
  const header = (i: number) => screen.getAllByRole("columnheader")[i];

  // A book shaped like the reflectometry corpus: A (unused here) is X, R++ is
  // Y with a comment, dR++ is its Y-error pair.
  const originData: DataStruct = {
    time: [1, 2],
    values: [
      [10, 0.5],
      [20, 0.6],
    ],
    labels: ["R++", "dR++"],
    units: ["a.u.", "a.u."],
    metadata: {
      origin_column_names: ["R++", "dR++"],
      column_designations: { A: "X", "R++": "Y", "dR++": "Y-error" },
      column_comments: { "R++": "spin-up reflectivity" },
    },
  };

  it("shows the Origin designation badge instead of the bare channel letter", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: originData }], activeId: "d1" });
    render(<Worksheet />);
    expect(header(2).textContent).toContain("Y"); // R++ -> Y, not "A"
    expect(header(3).textContent).toContain("yEr"); // dR++ -> Y-error, not "B"
  });

  it("shows a comment as a second header line with the full text in the tooltip", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: originData }], activeId: "d1" });
    render(<Worksheet />);
    expect(screen.getByText("spin-up reflectivity")).toBeInTheDocument();
    expect(header(2).getAttribute("title") ?? "").toContain("spin-up reflectivity");
  });

  it("dims a Label/Disregard-designated column like a channelRoles column is dimmed today", () => {
    const labelData: DataStruct = {
      ...originData,
      labels: ["Sample", "dR++"],
      metadata: {
        origin_column_names: ["Sample", "dR++"],
        column_designations: { A: "X", Sample: "Label", "dR++": "Y-error" },
      },
    };
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: labelData }], activeId: "d1" });
    render(<Worksheet />);
    expect(header(2).textContent).toContain("Label");
    expect(header(2)).toHaveStyle({ opacity: "0.55" });
  });

  it("non-Origin datasets show no badge noise (bare channel letter unchanged)", () => {
    render(<Worksheet />); // default `data` fixture — no Origin metadata at all
    expect(header(2).textContent).toContain("A");
    expect(header(3).textContent).toContain("B");
  });
});

describe("Worksheet column selection (item 6)", () => {
  // Header cells in order: [ #, x(time), A, B ].
  const header = (i: number) => screen.getAllByRole("columnheader")[i];
  const dataRow = (i: number) => screen.getAllByRole("row")[i + 1];

  it("clicking a header selects that column", () => {
    render(<Worksheet />);
    fireEvent.click(header(2)); // channel A
    expect(screen.getByText("1 column selected")).toBeInTheDocument();
    expect(header(2).getAttribute("style") ?? "").toContain("accent-soft");
  });

  it("clicking a different header REPLACES the selection (plain click is not additive)", () => {
    render(<Worksheet />);
    fireEvent.click(header(2));
    fireEvent.click(header(3));
    expect(screen.getByText("1 column selected")).toBeInTheDocument();
  });

  it("ctrl-click adds a column to a multi-selection", () => {
    render(<Worksheet />);
    fireEvent.click(header(2));
    fireEvent.click(header(3), { ctrlKey: true });
    expect(screen.getByText("2 columns selected")).toBeInTheDocument();
  });

  it("ctrl-click on an already-selected column removes it", () => {
    render(<Worksheet />);
    fireEvent.click(header(2));
    fireEvent.click(header(3), { ctrlKey: true });
    fireEvent.click(header(2), { ctrlKey: true });
    expect(screen.getByText("1 column selected")).toBeInTheDocument();
  });

  it("shift-click selects a contiguous range of columns, including the pinned x column", () => {
    render(<Worksheet />);
    fireEvent.click(header(1)); // x/time column (col -1), anchor
    fireEvent.click(header(3), { shiftKey: true }); // channel B (col 1)
    expect(screen.getByText("3 columns selected")).toBeInTheDocument(); // x, A, B
  });

  it("selection is keyed by column index, not DOM position — survives being re-derived after a re-render", () => {
    const { rerender } = render(<Worksheet />);
    fireEvent.click(header(3)); // channel B
    rerender(<Worksheet />);
    expect(screen.getByText("1 column selected")).toBeInTheDocument();
  });

  it("Escape clears the column selection", () => {
    render(<Worksheet />);
    fireEvent.click(header(2));
    expect(screen.getByText("1 column selected")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/columns? selected/)).not.toBeInTheDocument();
  });

  it("switching the viewed dataset clears the column selection", async () => {
    render(<Worksheet />);
    fireEvent.click(header(2));
    expect(screen.getByText("1 column selected")).toBeInTheDocument();
    useApp.setState({
      datasets: [
        { id: "d1", name: "scan.dat", data },
        { id: "d2", name: "other.dat", data },
      ],
      activeId: "d2",
    });
    // The clear runs in a useEffect keyed on ds.id — give it a tick to flush.
    await waitFor(() => expect(screen.queryByText(/columns? selected/)).not.toBeInTheDocument());
  });

  it("the 'Deselect columns' button clears the selection", () => {
    render(<Worksheet />);
    fireEvent.click(header(2));
    fireEvent.click(screen.getByRole("button", { name: "Deselect columns" }));
    expect(screen.queryByText(/columns? selected/)).not.toBeInTheDocument();
  });

  // The one sanctioned behaviour change (WORKSHEET_PLAN item 6, owner decision
  // D1): header click used to sort; it now selects. Sort moved to the column
  // context menu (already there) — verified still works, right below.
  it("SANCTIONED BEHAVIOUR CHANGE: a header click no longer sorts the rows", () => {
    render(<Worksheet />);
    fireEvent.click(header(2)); // channel A: values 10, 40, 11 in natural row order
    expect(dataRow(0).textContent).toContain("10.0000");
    expect(dataRow(1).textContent).toContain("40.0000");
    expect(dataRow(2).textContent).toContain("11.0000");
    expect(header(2).textContent).not.toMatch(/[▲▼]/); // no sort glyph either
  });

  it("sort is still reachable via the column context menu (relocated, not removed)", () => {
    render(<Worksheet />);
    fireEvent.contextMenu(header(2)); // channel A
    fireEvent.click(screen.getByText("Sort ascending"));
    // A's values are 10, 40, 11 -> ascending order is original rows [0, 2, 1].
    expect(dataRow(0).textContent).toContain("10.0000");
    expect(dataRow(1).textContent).toContain("11.0000");
    expect(dataRow(2).textContent).toContain("40.0000");
    expect(header(2).textContent).toMatch(/▲/); // the sort-direction glyph shows
  });

  it("right-click still opens the column context menu regardless of the click-selects change", () => {
    render(<Worksheet />);
    fireEvent.contextMenu(header(2));
    expect(screen.getByText("Set as X axis")).toBeInTheDocument();
  });
});

describe("Worksheet selection → plot (item 7)", () => {
  // A reflectometry-shaped Origin book: R++ (Y, col 0) with dR++ (Y-error, col 1).
  const originData: DataStruct = {
    time: [1, 2],
    values: [
      [10, 0.5],
      [20, 0.6],
    ],
    labels: ["R++", "dR++"],
    units: ["a.u.", "a.u."],
    metadata: {
      origin_column_names: ["R++", "dR++"],
      column_designations: { A: "X", "R++": "Y", "dR++": "Y-error" },
    },
  };
  const header = (i: number) => screen.getAllByRole("columnheader")[i];

  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "d1", name: "scan.dat", data: originData }],
      activeId: "d1",
      xKey: null,
      yKeys: null,
      errKeys: {},
      macroRecording: false,
      macroSteps: [],
    });
  });

  it("Plot selection: a selected Y + its Y-error pairs the error and plots the Y — never the error", () => {
    render(<Worksheet />);
    fireEvent.click(header(2)); // R++ (col 0)
    fireEvent.click(header(3), { ctrlKey: true }); // dR++ (col 1)
    fireEvent.click(screen.getByRole("button", { name: "Plot selection" }));
    expect(useApp.getState().yKeys).toEqual([0]);
    expect(useApp.getState().errKeys).toEqual({ 0: 1 });
  });

  it("Add to plot unions the selection into the CURRENT yKeys instead of replacing it", () => {
    useApp.setState({ yKeys: [] }); // an explicit (empty) current selection to union into
    render(<Worksheet />);
    fireEvent.click(header(2)); // R++
    fireEvent.click(screen.getByRole("button", { name: "Add to plot" }));
    expect(useApp.getState().yKeys).toEqual([0]);
  });

  it("selecting only the Y-error column (no preceding selected Y) plots nothing", () => {
    render(<Worksheet />);
    fireEvent.click(header(3)); // dR++ alone
    fireEvent.click(screen.getByRole("button", { name: "Plot selection" }));
    expect(useApp.getState().yKeys).toBeNull(); // unchanged
    expect(useApp.getState().status).toBe("nothing plottable in the selection");
  });

  it("Plot selection via the column context menu acts on just the right-clicked column when nothing is selected", () => {
    render(<Worksheet />);
    fireEvent.contextMenu(header(2)); // R++, nothing selected
    fireEvent.click(screen.getByText("Plot selection"));
    expect(useApp.getState().yKeys).toEqual([0]);
  });

  it("the context menu's plot actions act on the WHOLE selection when the right-clicked column is already selected", () => {
    render(<Worksheet />);
    fireEvent.click(header(2)); // R++
    fireEvent.click(header(3), { ctrlKey: true }); // dR++, still selected together
    fireEvent.contextMenu(header(3)); // right-click the already-selected dR++
    // Both the toolbar ("N selected") and the open context menu offer "Plot
    // selection" text now — scope the click to the menu portal.
    const menu = document.querySelector(".qzk-ctx") as HTMLElement;
    fireEvent.click(within(menu).getByText("Plot selection"));
    expect(useApp.getState().yKeys).toEqual([0]); // R++ plotted, error paired — same as the toolbar path
    expect(useApp.getState().errKeys).toEqual({ 0: 1 });
  });

  it("records a macro step for free — Plot selection goes through the SAME setYKeys the Channels card uses", () => {
    useApp.setState({ macroRecording: true });
    render(<Worksheet />);
    fireEvent.click(header(2)); // R++
    fireEvent.click(screen.getByRole("button", { name: "Plot selection" }));
    const codes = useApp.getState().macroSteps.map((s) => s.code);
    expect(codes).toContain("qz.setYKeys([0])");
  });

  it("row-state proof: Plot selection never touches exclusions — the plotted result still honors them via the existing plot pipeline", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "scan.dat", data: originData, excludedRows: [1] }],
      activeId: "d1",
    });
    render(<Worksheet />);
    fireEvent.click(header(2)); // R++
    fireEvent.click(screen.getByRole("button", { name: "Plot selection" }));
    expect(useApp.getState().yKeys).toEqual([0]);
    // Row exclusion (#50) is an entirely separate dimension — untouched by the plot action.
    expect(useApp.getState().datasets[0].excludedRows).toEqual([1]);
  });
});

describe("Worksheet text-sheet rendering (item 8)", () => {
  const textData: DataStruct = {
    time: [1, 2, 3],
    values: [[10], [20], [30]],
    labels: ["A"],
    units: [""],
    metadata: { origin_text_columns: { C: ["alpha", "beta", "gamma"] } },
  };

  it("appends a read-only text column after the numeric ones", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: textData }], activeId: "d1" });
    render(<Worksheet />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[headers.length - 1].textContent).toContain("C");
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });

  it("a text-only book (no numeric columns at all) renders its rows entirely from the text columns", () => {
    const textOnly: DataStruct = {
      time: [],
      values: [],
      labels: [],
      units: [],
      metadata: { origin_text_columns: { A: ["NaN", "NaN", "NaN"] } },
    };
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: textOnly }], activeId: "d1" });
    render(<Worksheet />);
    expect(screen.getAllByText("NaN")).toHaveLength(3);
    expect(screen.getByText("1")).toBeInTheDocument(); // row-number gutter
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not offer double-click-to-edit on a text cell (read-only)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: textData }], activeId: "d1" });
    render(<Worksheet />);
    fireEvent.doubleClick(screen.getByText("alpha"));
    expect(screen.queryByDisplayValue("alpha")).not.toBeInTheDocument();
  });

  it("shows a one-line hint pointing to the Inspector when the sheet carries report-sheet columns", () => {
    const ds: DataStruct = { ...data, metadata: { origin_report_sheets: { C: ["cell://Notes.Equation"] } } };
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: ds }], activeId: "d1" });
    render(<Worksheet />);
    expect(screen.getByText(/Origin report-sheet columns/)).toBeInTheDocument();
  });

  it("shows no hint when the sheet carries no report-sheet columns", () => {
    render(<Worksheet />);
    expect(screen.queryByText(/Origin report-sheet columns/)).not.toBeInTheDocument();
  });
});

describe("Worksheet cell editing", () => {
  it("double-click → edit → Enter commits to the active dataset", () => {
    render(<Worksheet />);
    fireEvent.doubleClick(screen.getByText("10.0000")); // row 0, channel A
    const input = screen.getByDisplayValue("10");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().datasets[0].data.values[0][0]).toBe(99);
    expect(screen.getByText("99.0000")).toBeInTheDocument(); // re-rendered live
  });

  it("edits the x/time column (col -1) and commits on blur", () => {
    render(<Worksheet />);
    fireEvent.doubleClick(screen.getByText("1.0000")); // x of row 0
    const input = screen.getByDisplayValue("1");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.blur(input);
    expect(useApp.getState().datasets[0].data.time[0]).toBe(7);
  });

  it("Escape cancels without committing", () => {
    render(<Worksheet />);
    fireEvent.doubleClick(screen.getByText("20.0000")); // row 0, channel B
    const input = screen.getByDisplayValue("20");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useApp.getState().datasets[0].data.values[0][1]).toBe(20); // unchanged
  });
});
