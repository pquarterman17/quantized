// SegmentedControl is a WAI-ARIA radio group: one checked radio, roving
// tabindex, and arrows/Home/End that move focus AND select, wrapping.
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "./SegmentedControl";

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("b");
  return (
    <SegmentedControl
      aria-label="mode"
      options={["a", { value: "b", label: "Bee" }, "c"]}
      value={v}
      onChange={(next) => {
        setV(next);
        onChange?.(next);
      }}
    />
  );
}

const radios = () => screen.getAllByRole("radio");
const checked = () => radios().find((r) => r.getAttribute("aria-checked") === "true");

describe("SegmentedControl", () => {
  it("is a named radiogroup with one checked radio and a roving tabindex", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "mode" });
    expect(group).toHaveClass("qz-seg");
    expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByRole("radio", { name: "Bee" })).toHaveClass("qz-seg-btn", "qz-active");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("arrows move focus and select, wrapping in both directions", () => {
    render(<Harness />);
    radios()[1].focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(checked()).toHaveTextContent("c");
    expect(document.activeElement).toBe(checked());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); // wraps forward
    expect(checked()).toHaveTextContent("a");
    expect(document.activeElement).toBe(checked());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" }); // wraps back
    expect(checked()).toHaveTextContent("c");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(checked()).toHaveTextContent("Bee");
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("Home/End jump to the first/last option and select it", () => {
    render(<Harness />);
    radios()[1].focus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(checked()).toHaveTextContent("c");
    expect(document.activeElement).toBe(radios()[2]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(checked()).toHaveTextContent("a");
    expect(document.activeElement).toBe(radios()[0]);
  });

  it("consumes handled keys and leaves modified or unrelated keys alone", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    radios()[1].focus();
    expect(fireEvent.keyDown(document.activeElement!, { key: "ArrowRight", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.activeElement!, { key: "x" })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" })).toBe(false); // defaultPrevented
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("keeps the group tabbable when the value matches no option", () => {
    render(<SegmentedControl options={["a", "b"]} value={"z" as "a"} />);
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1]);
  });

  it("clicking still selects", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "a" }));
    expect(onChange).toHaveBeenCalledWith("a");
    expect(checked()).toHaveTextContent("a");
  });
});
