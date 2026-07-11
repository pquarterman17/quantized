// Inspector Axes card: X/Y scale pick (MAIN #12 — linear/log/reciprocal).

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import AxisScaleControls from "./AxisScaleControls";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({ xScale: "linear", yScale: "linear" });
});

describe("AxisScaleControls", () => {
  it("renders the current X/Y scale, defaulting to Linear", () => {
    const { getByText, container } = render(<AxisScaleControls />);
    expect(getByText("X scale")).toBeTruthy();
    expect(getByText("Y scale")).toBeTruthy();
    const selects = container.querySelectorAll("select");
    expect(selects).toHaveLength(2);
    expect((selects[0] as HTMLSelectElement).value).toBe("linear");
    expect((selects[1] as HTMLSelectElement).value).toBe("linear");
  });

  it("offers Linear/Log/Reciprocal options on both selects", () => {
    const { container } = render(<AxisScaleControls />);
    const selects = container.querySelectorAll("select");
    for (const select of Array.from(selects)) {
      const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
      expect(values).toEqual(["linear", "log", "reciprocal"]);
    }
  });

  it("changing the X select writes xScale through to the store", () => {
    const { container } = render(<AxisScaleControls />);
    const [xSelect] = container.querySelectorAll("select");
    fireEvent.change(xSelect, { target: { value: "reciprocal" } });
    expect(useApp.getState().xScale).toBe("reciprocal");
    expect(useApp.getState().yScale).toBe("linear"); // untouched
  });

  it("changing the Y select writes yScale through to the store", () => {
    const { container } = render(<AxisScaleControls />);
    const [, ySelect] = container.querySelectorAll("select");
    fireEvent.change(ySelect, { target: { value: "log" } });
    expect(useApp.getState().yScale).toBe("log");
    expect(useApp.getState().xScale).toBe("linear"); // untouched
  });

  it("reflects a reciprocal scale already set in the store (e.g. an Arrhenius plot)", () => {
    useApp.setState({ xScale: "reciprocal", yScale: "log" });
    const { container } = render(<AxisScaleControls />);
    const selects = container.querySelectorAll("select");
    expect((selects[0] as HTMLSelectElement).value).toBe("reciprocal");
    expect((selects[1] as HTMLSelectElement).value).toBe("log");
  });
});
