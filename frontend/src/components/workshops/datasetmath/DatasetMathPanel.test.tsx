// P2.5 dialog test: Dataset Math shows the transform-safety analysis BEFORE
// Combine, and a unit mismatch keeps Combine disabled until the explicit
// acknowledgment is ticked.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import DatasetMathPanel from "./DatasetMathPanel";

vi.mock("../../../lib/api/datasetAlgebra", () => ({ datasetAlgebra: vi.fn() }));
const { datasetAlgebra } = await import("../../../lib/api/datasetAlgebra");

const a: DataStruct = { time: [0, 1, 2, 3], values: [[1], [2], [3], [4]], labels: ["M"], units: ["emu"], metadata: {} };
const b: DataStruct = { time: [1, 2], values: [[1], [1]], labels: ["M"], units: ["A m2"], metadata: {} };

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [
      { id: "d1", name: "a.dat", data: a },
      { id: "d2", name: "b.dat", data: b },
    ],
    activeId: "d1",
    datasetMathOpen: true,
  });
});

describe("DatasetMathPanel — P2.5 preview", () => {
  it("lists the unit mismatch and the rows outside B's range, and gates Combine on the acknowledgment", async () => {
    vi.mocked(datasetAlgebra).mockResolvedValue({ ...a, labels: ["M - M"] });
    render(<DatasetMathPanel />);

    const list = screen.getByRole("list", { name: "Transform warnings" });
    expect(list.textContent).toContain("Y units differ");
    expect(list.textContent).toContain("2 of 4 rows of a.dat lie outside b.dat's x-range [1, 2]");

    const combine = screen.getByRole("button", { name: /Combine/ });
    expect(combine).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Combine despite the unit mismatch" }));
    expect(combine).not.toBeDisabled();
    fireEvent.click(combine);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(useApp.getState().datasets[2].data.metadata.transform_warnings).toHaveLength(2);
  });

  it("shows nothing and needs no acknowledgment for a clean pick", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a.dat", data: a },
        { id: "d2", name: "c.dat", data: { ...a, labels: ["M"] } },
      ],
    });
    render(<DatasetMathPanel />);
    expect(screen.queryByRole("list", { name: "Transform warnings" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: /Combine/ })).not.toBeDisabled();
  });
});
