// Map gridding: two Applies in a row. The first Apply makes its new map the active dataset; the
// X/Y/Z pickers must then sit on valid, different columns of THAT dataset (acceptance defect:
// they re-synced to the wrong columns and the second Apply failed "three different columns"),
// and a pick the user made stays with the dataset it was made on.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import MapGridPanel from "./MapGridPanel";

const { gridMock } = vi.hoisted(() => ({ gridMock: vi.fn() }));
vi.mock("../../../lib/api/mapGrid", () => ({ gridXyz: gridMock, mapFormula: vi.fn(), extractPixels: vi.fn() }));

// What /api/map-ops/grid really returns: columns x, y, Intensity on a native grid, no axis names.
const gridded = (tag: string): DataStruct => ({
  time: [0, 1, 0, 1],
  values: [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 4]],
  labels: ["x", "y", "Intensity"],
  units: ["", "", ""],
  metadata: { is2D: true, map_shape: [2, 2], map_grid: "native", x_column_name: "x", x_column_unit: "", map_op: { op: "grid_xyz", tag } },
});
const sheet: DataStruct = {
  time: [1, 2, 3, 4, 5],
  values: [[10, 0.1, 5], [20, 0.4, 6], [30, 0.2, 7], [15, 0.9, 8], [25, 0.5, 9]],
  labels: ["y", "z", "w"],
  units: ["", "", ""],
  metadata: { x_column_name: "x", x_column_unit: "" },
};
const sel = (name: string): HTMLSelectElement => screen.getByLabelText(`${name} column`) as HTMLSelectElement;
const shown = (): string[] => ["X", "Y", "Z"].map((n) => sel(n).selectedOptions[0]!.textContent!);

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  gridMock.mockImplementation(async () => gridded(`run${++n}`));
  useApp.setState({ datasets: [{ id: "s", name: "scatter.csv", data: sheet }], activeId: "s", status: "" });
});
afterEach(cleanup);

describe("MapGridPanel, repeated Apply", () => {
  it("a second Apply works on the new map, with X, Y, Z on its x, y and Intensity columns", async () => {
    render(<MapGridPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    await waitFor(() => expect(useApp.getState().activeId).not.toBe("s"));
    expect(shown()).toEqual(["x", "y", "Intensity"]);
    expect(new Set(["X", "Y", "Z"].map((n) => sel(n).value)).size).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(gridMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    const second = gridMock.mock.calls[1]![0];
    expect(second.dataset.labels).toEqual(["y", "Intensity"]);
    expect(second.dataset.time).toEqual([0, 1, 0, 1]); // x of the new map
    expect(useApp.getState().datasets).toHaveLength(3);
  });

  it("keeps what the user picked on a dataset when another becomes active and back", async () => {
    render(<MapGridPanel />);
    fireEvent.change(sel("X"), { target: { value: "1" } }); // z
    fireEvent.change(sel("Z"), { target: { value: "-1" } }); // x
    expect(shown()).toEqual(["z", "y", "x"]);
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    await waitFor(() => expect(useApp.getState().activeId).not.toBe("s"));
    expect(shown()).toEqual(["x", "y", "Intensity"]); // not the sheet's picks re-read on the map
    act(() => useApp.setState({ activeId: "s" }));
    expect(shown()).toEqual(["z", "y", "x"]); // the user's choice on the sheet is still there
    expect(gridMock.mock.calls[0]![0].dataset.labels).toEqual(["y", "x"]);
  });

  it("still refuses a duplicate the user picked", async () => {
    render(<MapGridPanel />);
    fireEvent.change(sel("Y"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/three different columns/);
    expect(gridMock).not.toHaveBeenCalled();
  });
});
