import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data }], activeId: "d1", status: "" });
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
  it("keeps a masked row visible but flags the masked count", () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByText("2")); // mask row index 1 (row number "2")
    expect(screen.getByText("40.0000")).toBeInTheDocument(); // still rendered (greyed)
    expect(screen.getByText(/1 masked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unmask/ })).toBeInTheDocument();
  });

  it("excludes masked rows from the descriptive-stats subset", async () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByRole("button", { name: /Stats/ }));
    fireEvent.click(screen.getByText("2")); // mask row index 1 → leaves rows 0,2
    await waitFor(() => expect(statsDescriptive).toHaveBeenCalledWith([10, 11])); // A minus masked
    expect(statsDescriptive).toHaveBeenCalledWith([1, 3]); // x minus masked
    expect(statsDescriptive).toHaveBeenCalledWith([20, 12]); // B minus masked
  });

  it("excludes masked rows from Extract", () => {
    render(<Worksheet />);
    fireEvent.click(screen.getByText("2")); // mask row index 1
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
    fireEvent.click(screen.getByText("2"));
    expect(screen.getByText(/1 masked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unmask/ }));
    expect(screen.queryByText(/masked/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Extract/ })).not.toBeInTheDocument();
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
