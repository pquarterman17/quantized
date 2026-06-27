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
