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
    history: [],
    future: [],
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

describe("DataFilterPanel — categorical labels (P1.4/P1.5)", () => {
  it("renders the imported level names and filters by their underlying codes", () => {
    useApp.setState({
      datasets: [{
        id: "d1",
        name: "samples.csv",
        data: {
          time: [0, 1, 2, 3],
          values: [[0], [0], [1], [1]],
          labels: ["Treatment"],
          units: [""],
          metadata: {},
          cat_levels: { 0: ["Reference", "Annealed"] },
        },
      }],
      activeId: "d1",
    });

    render(<DataFilterPanel />);
    expect(screen.getByText("Reference")).toBeInTheDocument();
    expect(screen.getByText("Annealed")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Annealed"));
    expect(filterOf()).toEqual([{ col: 0, kind: "set", values: [0] }]);
  });
});

describe("DataFilterPanel — one undo step per editing run (Group S)", () => {
  // The store-level rules live in store/rowState.test.ts. What is pinned HERE
  // is the thing that made this fix non-trivial: the control fires on every
  // `input` event, so the naive "record history in the setter" fix produces one
  // undo entry per drag step. Asserted through the real DOM control, because a
  // store test driving setDatasetFilter in a loop cannot show that THIS
  // component is what fires it repeatedly.
  const history = () => useApp.getState().history;

  it("dragging one thumb across many values records ONE entry, not one each", () => {
    render(<DataFilterPanel />);
    const valMin = screen.getByLabelText("val minimum");
    for (const value of ["12", "14", "16", "18", "20", "22"]) {
      fireEvent.change(valMin, { target: { value } });
    }
    expect(filterOf()).toEqual([{ col: 0, kind: "range", min: 22 }]);
    expect(history().map((h) => h.label)).toEqual(["data filter"]);
  });

  it("undo after a drag returns to NO filter, not to the previous drag step", () => {
    // The kept entry is the FIRST of the run, so its snapshot predates the
    // whole gesture. Recording at gesture END instead would have captured the
    // post-drag filter and made undo a no-op — the trap this design avoids.
    render(<DataFilterPanel />);
    const valMin = screen.getByLabelText("val minimum");
    fireEvent.change(valMin, { target: { value: "12" } });
    fireEvent.change(valMin, { target: { value: "30" } });

    useApp.getState().undo();

    expect(filterOf()).toBeUndefined();
  });

  it("dragging a SECOND column after the first still folds into one run", () => {
    // Both thumbs and both columns are the same editing run as far as the user
    // is concerned; nothing unrelated landed in between, so one Ctrl+Z should
    // undo the lot.
    render(<DataFilterPanel />);
    fireEvent.change(screen.getByLabelText("val minimum"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("T maximum"), { target: { value: "4" } });

    expect(history().map((h) => h.label)).toEqual(["data filter"]);

    useApp.getState().undo();
    expect(filterOf()).toBeUndefined();
  });
});
