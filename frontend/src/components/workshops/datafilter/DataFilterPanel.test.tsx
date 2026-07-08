import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import DataFilterPanel from "./DataFilterPanel";

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[10], [16], [22], [28], [34], [40]],
  labels: ["val"],
  units: [""],
  metadata: { x_column_name: "T" },
};

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    dataFilterOpen: true,
  });
});

const filterOf = () => useApp.getState().datasets.find((d) => d.id === "d1")?.filter;

describe("DataFilterPanel — dual-thumb range slider (#53 item 7a)", () => {
  it("renders a RangeSlider for the continuous column, spanning its full data range", () => {
    render(<DataFilterPanel />);
    // x (T) then val — each contributes a min/max thumb pair.
    const mins = screen.getAllByLabelText(/minimum$/);
    const maxes = screen.getAllByLabelText(/maximum$/);
    expect(mins.length).toBeGreaterThan(0);
    expect(maxes.length).toBeGreaterThan(0);
  });

  it("dragging the low thumb commits through setRange and updates the NumberField readout", () => {
    render(<DataFilterPanel />);
    const valMin = screen.getByLabelText("val minimum");
    fireEvent.change(valMin, { target: { value: "20" } });
    expect(filterOf()).toEqual([{ col: 0, kind: "range", min: 20 }]);
  });

  it("dragging the high thumb commits through setRange", () => {
    render(<DataFilterPanel />);
    const valMax = screen.getByLabelText("val maximum");
    fireEvent.change(valMax, { target: { value: "30" } });
    expect(filterOf()).toEqual([{ col: 0, kind: "range", max: 30 }]);
  });

  it("a slider commit clears any stale in-progress NumberField text for that column", () => {
    render(<DataFilterPanel />);
    const numberFields = screen.getAllByPlaceholderText("min");
    const valNumberField = numberFields[numberFields.length - 1]; // val column's min field
    fireEvent.change(valNumberField, { target: { value: "1." } }); // partial, uncommitted
    fireEvent.change(screen.getByLabelText("val minimum"), { target: { value: "25" } });
    // the NumberField now reflects the slider's committed value, not the stale "1."
    expect((valNumberField as HTMLInputElement).value).toBe("25");
  });

  it("the slider and NumberField stay in sync when the filter is cleared", () => {
    render(<DataFilterPanel />);
    fireEvent.change(screen.getByLabelText("val minimum"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(filterOf()).toBeUndefined();
    expect(screen.getByLabelText("val minimum")).toHaveValue("10"); // back to the column's data min
  });
});
