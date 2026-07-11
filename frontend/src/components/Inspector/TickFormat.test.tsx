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
});
