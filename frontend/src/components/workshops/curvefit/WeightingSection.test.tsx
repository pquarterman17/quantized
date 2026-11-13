// Weighting control: the direct-weight mode (review item 11) and the
// scale-errors switch (audit #12) are reachable, named and wired.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Dataset, WeightMode } from "../../../lib/types";
import WeightingSection from "./WeightingSection";

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["moment", "w"], units: ["emu", ""], metadata: {} },
};

function setup(weightMode: WeightMode, scaleErrors = true) {
  const props = {
    active: DS, weightMode, setWeightMode: vi.fn(), manualKey: null, setManualKey: vi.fn(),
    scaleErrors, setScaleErrors: vi.fn(), hasYErr: false, weightNote: null,
  };
  render(<WeightingSection {...props} />);
  return props;
}

describe("WeightingSection", () => {
  it("offers Direct (weight column) and reports the choice", () => {
    const props = setup("none");
    expect(screen.getByRole("option", { name: "Direct (weight column)" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Weighting" }), { target: { value: "direct" } });
    expect(props.setWeightMode).toHaveBeenCalledWith("direct");
    // Unweighted: no column picker and no scale switch to distract.
    expect(screen.queryByRole("combobox", { name: "Weight column" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("direct mode picks a WEIGHT column; manual mode an ERROR column", () => {
    const props = setup("direct");
    fireEvent.change(screen.getByRole("combobox", { name: "Weight column" }), { target: { value: "1" } });
    expect(props.setManualKey).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("combobox", { name: "Manual error column" })).toBeNull();
  });

  it("a weighted mode shows the scale-errors switch, on by default", () => {
    const props = setup("manual");
    expect(screen.getByRole("combobox", { name: "Manual error column" })).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: "Scale errors with √(reduced χ²)" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(props.setScaleErrors).toHaveBeenCalledWith(false);
  });
});
