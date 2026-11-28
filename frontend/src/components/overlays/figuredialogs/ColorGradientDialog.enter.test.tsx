// UX8-I: Enter in the colour-gradient dialog applies it (from a checkbox only; never a
// <select>, whose open list Enter commits); a button keeps its own Enter.

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
  it("applies the draft and closes when Enter is pressed on the Reverse checkbox", () => {
    const onClose = vi.fn();
    render(<ColorGradientDialog onClose={onClose} />);
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useApp.getState().seriesRamp).toMatchObject({ reverse: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not apply on Enter from the colormap select (its native list may be open)", () => {
    const onClose = vi.fn();
    render(<ColorGradientDialog onClose={onClose} />);
    const select = screen.getByRole("combobox", { name: "Colormap" });
    fireEvent.change(select, { target: { value: "plasma" } });
    fireEvent.keyDown(select, { key: "Enter" });
    expect(useApp.getState().seriesRamp).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Enter on Cancel alone (it must not apply)", () => {
    const onClose = vi.fn();
    render(<ColorGradientDialog onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Enter" });
    expect(useApp.getState().seriesRamp).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ColorGradientDialog Apply and OK (plan item 44)", () => {
  it("Apply writes and stays open; two Applies then OK are one undo step; an unchanged Apply adds none", () => {
    useApp.setState({ history: [], future: [] });
    const onClose = vi.fn();
    render(<ColorGradientDialog onClose={onClose} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Colormap" }), { target: { value: "plasma" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().seriesRamp).toMatchObject({ map: "plasma" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" })); // unchanged: no write
    fireEvent.change(screen.getByRole("combobox", { name: "Colormap" }), { target: { value: "magma" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().seriesRamp).toBeNull();
  });
});
