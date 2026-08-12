import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RefLine } from "../../../lib/types";
import RefLinePropertiesPanel from "./RefLinePropertiesPanel";

const X_LINE: RefLine = { id: "r1", axis: "x", value: 500 };
const Y_LINE: RefLine = { id: "r2", axis: "y", value: -3 };

function renderPanel(refLines: RefLine[]) {
  const onValue = vi.fn();
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <RefLinePropertiesPanel refLines={refLines} onValue={onValue} onAdd={onAdd} onRemove={onRemove} />,
  );
  return { onValue, onAdd, onRemove };
}

describe("RefLinePropertiesPanel", () => {
  it("lists every line with its compact axis-scoped label", () => {
    renderPanel([X_LINE, Y_LINE, { id: "r3", axis: "x", value: 1 }]);
    expect(screen.getByText("X 1")).toBeInTheDocument();
    expect(screen.getByText("Y 1")).toBeInTheDocument();
    expect(screen.getByText("X 2")).toBeInTheDocument();
  });

  it("still exposes the FULL phrase to assistive tech, not just the compact text", () => {
    renderPanel([X_LINE]);
    expect(screen.getByLabelText("X reference 1 value")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove X reference 1")).toBeInTheDocument();
  });

  it("edits a line's value through the required-numeric field", () => {
    const { onValue } = renderPanel([X_LINE]);
    fireEvent.change(screen.getByLabelText("X reference 1 value"), { target: { value: "750" } });
    expect(onValue).toHaveBeenCalledWith("r1", 750);
  });

  it("clearing a value field does not commit an undefined write", () => {
    // `required` keeps the last value; a cleared field must not reach the draft.
    const { onValue } = renderPanel([X_LINE]);
    fireEvent.change(screen.getByLabelText("X reference 1 value"), { target: { value: "" } });
    expect(onValue).not.toHaveBeenCalled();
  });

  it("offers no per-row axis control — nothing in the app flips an existing line's axis", () => {
    renderPanel([X_LINE]);
    expect(screen.queryByLabelText("X reference 1 axis")).not.toBeInTheDocument();
  });

  it("removes a line via its remove button", () => {
    const { onRemove } = renderPanel([X_LINE, Y_LINE]);
    fireEvent.click(screen.getByLabelText("Remove Y reference 1"));
    expect(onRemove).toHaveBeenCalledWith("r2");
  });

  it("labels the axis picker, which the Stage card leaves as bare X/Y glyphs", () => {
    renderPanel([]);
    expect(screen.getByText("axis")).toBeInTheDocument();
  });

  it("adds a line on the axis the segmented control selects", () => {
    const { onAdd } = renderPanel([]);
    fireEvent.change(screen.getByLabelText("new reference line value"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("x", 250);

    fireEvent.click(screen.getByRole("tab", { name: "Y" }));
    fireEvent.change(screen.getByLabelText("new reference line value"), { target: { value: "-8" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenLastCalledWith("y", -8);
  });

  it("renders the Add form with no lines yet, so the first line is reachable here", () => {
    // The whole point of not gating this group on a non-empty list: the only
    // other way to add one is the Stage card, which invalidates the session.
    renderPanel([]);
    expect(screen.getByLabelText("new reference line value")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("disables Add and explains why for a non-numeric value", () => {
    const { onAdd } = renderPanel([]);
    fireEvent.change(screen.getByLabelText("new reference line value"), { target: { value: "abc" } });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByText("value must be a number")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("disables Add for an empty value without shouting an error at an untouched field", () => {
    renderPanel([]);
    fireEvent.change(screen.getByLabelText("new reference line value"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.queryByText("enter a value")).not.toBeInTheDocument();
  });

  it("commits on Enter, matching the Stage card's own keyboard affordance", () => {
    // Inspector/RefLinesCard has `onKeyDown={(e) => e.key === "Enter" && add()}`;
    // without it here, adding several lines means a mouse trip per line.
    const { onAdd } = renderPanel([]);
    const field = screen.getByLabelText("new reference line value");
    fireEvent.change(field, { target: { value: "300" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("x", 300);
    expect(field).toHaveValue("0");
  });

  it("ignores Enter when the value is not addable", () => {
    const { onAdd } = renderPanel([]);
    const field = screen.getByLabelText("new reference line value");
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const { onAdd } = renderPanel([]);
    const field = screen.getByLabelText("new reference line value");
    fireEvent.change(field, { target: { value: "300" } });
    fireEvent.keyDown(field, { key: "a" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("resets the Add field after a successful add, so the next one starts clean", () => {
    renderPanel([]);
    const field = screen.getByLabelText("new reference line value");
    fireEvent.change(field, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(field).toHaveValue("0");
  });
});
