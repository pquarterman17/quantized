// P2.8 residual (b): a blank side of the X/Y limit pair is "auto for that
// side" (half-open). It used to read as `Number("") === 0`, so a blank min
// with a typed max fixed the axis at [0, max] while the field still showed
// its "auto" placeholder.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import AxisLimits from "./AxisLimits";

const field = (axis: "X" | "Y", side: "minimum" | "maximum") => screen.getByLabelText(`${axis} axis ${side}`);

/** Type a value and commit it the way the user does: Enter, then blur. */
function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.keyDown(el, { key: "Enter" });
  fireEvent.blur(el);
}

beforeEach(() => {
  useApp.setState({ xLim: null, yLim: null });
});

describe("AxisLimits: a blank side is auto for that side", () => {
  it("a blank minimum with a typed maximum commits [auto, max], not [0, max]", () => {
    render(<AxisLimits />);
    commit(field("Y", "maximum"), "5");
    expect(useApp.getState().yLim).toEqual([null, 5]);
    // The blank side still shows its "auto" placeholder — and means it.
    expect(field("Y", "minimum")).toHaveValue("");
  });

  it("a typed minimum with a blank maximum commits [min, auto]", () => {
    render(<AxisLimits />);
    commit(field("X", "minimum"), "2");
    expect(useApp.getState().xLim).toEqual([2, null]);
    expect(field("X", "maximum")).toHaveValue("");
  });

  it("a fully typed pair still fixes both sides", () => {
    render(<AxisLimits />);
    fireEvent.change(field("X", "minimum"), { target: { value: "1" } });
    commit(field("X", "maximum"), "4");
    expect(useApp.getState().xLim).toEqual([1, 4]);
  });

  it("clearing both sides restores full autoscale", () => {
    useApp.setState({ yLim: [null, 5] });
    render(<AxisLimits />);
    expect(field("Y", "maximum")).toHaveValue("5");
    commit(field("Y", "maximum"), "");
    expect(useApp.getState().yLim).toBeNull();
  });

  it("an inverted or non-numeric pair leaves the committed value alone", () => {
    useApp.setState({ xLim: [1, 4] });
    render(<AxisLimits />);
    commit(field("X", "minimum"), "9");
    expect(useApp.getState().xLim).toEqual([1, 4]);
    commit(field("X", "minimum"), "abc");
    expect(useApp.getState().xLim).toEqual([1, 4]);
  });

  it("a half-open value set elsewhere (undo, reopen) shows its blank side blank", () => {
    render(<AxisLimits />);
    act(() => useApp.setState({ xLim: [3, null] }));
    expect(field("X", "minimum")).toHaveValue("3");
    expect(field("X", "maximum")).toHaveValue("");
  });
});
