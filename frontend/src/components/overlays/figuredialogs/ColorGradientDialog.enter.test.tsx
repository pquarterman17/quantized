// UX8-I: Enter in the colour-gradient dialog applies it (from the colormap
// <select> or a checkbox) instead of opening the select; a button keeps its own Enter.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../../store/useApp";
import ColorGradientDialog from "./ColorGradientDialog";

const ds = {
  id: "d1",
  name: "d.csv",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["a", "b"], units: ["", ""], metadata: {} },
};

beforeEach(() => {
  useApp.setState({ datasets: [ds], activeId: "d1", seriesRamp: null, selectedIds: [] });
});

describe("ColorGradientDialog Enter", () => {
  it("applies the draft and closes when Enter is pressed on the colormap select", () => {
    const onClose = vi.fn();
    render(<ColorGradientDialog onClose={onClose} />);
    const select = screen.getByRole("combobox", { name: "Colormap" });
    fireEvent.change(select, { target: { value: "plasma" } });
    fireEvent.keyDown(select, { key: "Enter" });
    expect(useApp.getState().seriesRamp).toMatchObject({ map: "plasma" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter on Cancel alone (it must not apply)", () => {
    const onClose = vi.fn();
    render(<ColorGradientDialog onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Enter" });
    expect(useApp.getState().seriesRamp).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
