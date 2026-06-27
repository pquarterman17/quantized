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
