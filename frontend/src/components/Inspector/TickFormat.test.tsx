// Inspector Axes card: X/Y tick number format, incl. the "Eng" mode added
// for MAIN #20 (engineering notation, alongside the increment-aware auto
// override and the fixed/sci precision floor — see uplotOpts.ts).

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import TickFormat from "./TickFormat";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    y2Fmt: null,
    y2Keys: null,
  });
});

describe("TickFormat", () => {
  it("offers Auto/Fixed/Sci/Eng on both the X and Y rows", () => {
    const { getByText, container } = render(<TickFormat />);
    expect(getByText("Tick format")).toBeTruthy();
    const groups = container.querySelectorAll('[role="tablist"]');
    expect(groups).toHaveLength(2);
    for (const group of Array.from(groups)) {
      const labels = Array.from(group.querySelectorAll('[role="tab"]')).map((b) => b.textContent);
      expect(labels).toEqual(["Auto", "Fixed", "Sci", "Eng"]);
    }
  });

  it("hides the digits field in Auto mode (no fixed/mantissa digit count to set)", () => {
    const { container } = render(<TickFormat />);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("selecting Eng on the Y row writes yFmt.mode through to the store and reveals the digits field", () => {
    const { container } = render(<TickFormat />);
    const [, yGroup] = container.querySelectorAll('[role="tablist"]');
    fireEvent.click(Array.from(yGroup.querySelectorAll('[role="tab"]')).find((b) => b.textContent === "Eng")!);
    expect(useApp.getState().yFmt).toEqual({ mode: "eng", digits: 2 });
    expect(useApp.getState().xFmt.mode).toBe("auto"); // untouched
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });

  it("selecting Eng on the X row writes xFmt.mode through to the store", () => {
    const { container } = render(<TickFormat />);
    const [xGroup] = container.querySelectorAll('[role="tablist"]');
    fireEvent.click(Array.from(xGroup.querySelectorAll('[role="tab"]')).find((b) => b.textContent === "Eng")!);
    expect(useApp.getState().xFmt).toEqual({ mode: "eng", digits: 2 });
    expect(useApp.getState().yFmt.mode).toBe("auto"); // untouched
  });

  const withDateColumn = () =>
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "run",
          data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: { time_is_datetime: true } },
        },
      ],
      activeId: "d1",
    });

  it("offers compact UTC date/time modes for X (date-recognized column) without a digits field", () => {
    withDateColumn();
    const { getByLabelText, container } = render(<TickFormat />);
    fireEvent.change(getByLabelText("X date/time format"), { target: { value: "datetime" } });
    expect(useApp.getState().xFmt).toEqual({ mode: "datetime", digits: 2 });
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
  });

  it("HIDES the date/time control when the X column is not a recognized timestamp", () => {
    // #68 gate: a date format applied to a physics axis produced out-of-range
    // epochs that crashed export — so the control is only offered for
    // date-recognized columns.
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "run",
          data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
        },
      ],
      activeId: "d1",
    });
    const { queryByLabelText } = render(<TickFormat />);
    expect(queryByLabelText("X date/time format")).toBeNull();
  });

  it("editing the digits field in Eng mode updates the mantissa digit count", () => {
    useApp.setState({ yFmt: { mode: "eng", digits: 2 } });
    const { container } = render(<TickFormat />);
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4" } });
    expect(useApp.getState().yFmt).toEqual({ mode: "eng", digits: 4 });
  });

  it("reflects an eng mode already set in the store", () => {
    useApp.setState({ xFmt: { mode: "eng", digits: 1 }, yFmt: { mode: "sci", digits: 3 } });
    const { container } = render(<TickFormat />);
    const [xGroup, yGroup] = container.querySelectorAll('[role="tablist"]');
    expect(xGroup.querySelector('[aria-selected="true"]')?.textContent).toBe("Eng");
    expect(yGroup.querySelector('[aria-selected="true"]')?.textContent).toBe("Sci");
  });

  it("hides the Y2 row entirely when no y2 channel is plotted", () => {
    const { queryByText } = render(<TickFormat />);
    expect(queryByText("Y2")).toBeNull();
  });

  it("shows the Y2 row (checked 'inherits Y', no controls) once a y2 channel is plotted", () => {
    useApp.setState({ y2Keys: [1] });
    const { getByText, container } = render(<TickFormat />);
    expect(getByText("Y2")).toBeTruthy();
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(2); // X, Y only — no Y2 controls yet
  });

  it("unchecking 'inherits Y' sets y2Fmt to the current yFmt and reveals its own controls", () => {
    useApp.setState({ y2Keys: [1], yFmt: { mode: "sci", digits: 3 } });
    const { container } = render(<TickFormat />);
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(useApp.getState().y2Fmt).toEqual({ mode: "sci", digits: 3 });
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(3); // X, Y, Y2
  });

  it("changing the Y2 mode writes y2Fmt independently, leaving yFmt untouched", () => {
    useApp.setState({ y2Keys: [1], y2Fmt: { mode: "auto", digits: 2 } });
    const { container } = render(<TickFormat />);
    const [, , y2Group] = container.querySelectorAll('[role="tablist"]');
    fireEvent.click(Array.from(y2Group.querySelectorAll('[role="tab"]')).find((b) => b.textContent === "Fixed")!);
    expect(useApp.getState().y2Fmt).toEqual({ mode: "fixed", digits: 2 });
    expect(useApp.getState().yFmt.mode).toBe("auto"); // untouched
  });

  it("re-checking 'inherits Y' resets y2Fmt back to null", () => {
    useApp.setState({ y2Keys: [1], y2Fmt: { mode: "fixed", digits: 1 } });
    const { container } = render(<TickFormat />);
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(useApp.getState().y2Fmt).toBeNull();
  });
});
