import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Shape } from "../../../lib/types";
import ShapePropertiesPanel from "./ShapePropertiesPanel";

const ARROW: Shape = { id: "s1", kind: "arrow", x1: 0, y1: 1, x2: 2, y2: 3 };
const RECT: Shape = { id: "s2", kind: "rect", x1: 4, y1: 5, x2: 6, y2: 7 };

function renderPanel(shapes: Shape[]) {
  const onStyle = vi.fn();
  const onRemove = vi.fn();
  render(<ShapePropertiesPanel shapes={shapes} onStyle={onStyle} onRemove={onRemove} />);
  return { onStyle, onRemove };
}

describe("ShapePropertiesPanel", () => {
  it("lists every shape with its kind-scoped label", () => {
    renderPanel([ARROW, RECT]);
    expect(screen.getByText("arrow 1")).toBeInTheDocument();
    expect(screen.getByText("rect 1")).toBeInTheDocument();
  });

  it("edits coordinates through the required-numeric field", () => {
    const { onStyle } = renderPanel([ARROW]);
    fireEvent.change(screen.getByLabelText("arrow 1 x2"), { target: { value: "9" } });
    expect(onStyle).toHaveBeenCalledWith("s1", { x2: 9 });
  });

  it("clearing a coordinate field does not commit an undefined write", () => {
    const { onStyle } = renderPanel([ARROW]);
    fireEvent.change(screen.getByLabelText("arrow 1 x1"), { target: { value: "" } });
    expect(onStyle).not.toHaveBeenCalled();
  });

  it("shows the fill color field only for rect/ellipse, never arrow/line", () => {
    renderPanel([ARROW, RECT]);
    expect(screen.queryByLabelText("arrow 1 fill")).not.toBeInTheDocument();
    expect(screen.getByLabelText("rect 1 fill")).toBeInTheDocument();
  });

  it("edits stroke via a palette preset and the custom picker", () => {
    const { onStyle } = renderPanel([ARROW]);
    fireEvent.click(screen.getByLabelText("arrow 1 stroke preset 4"));
    expect(onStyle).toHaveBeenCalledWith("s1", { stroke: "--series-4" });

    fireEvent.change(screen.getByLabelText("arrow 1 stroke"), { target: { value: "#123456" } });
    expect(onStyle).toHaveBeenCalledWith("s1", { stroke: "#123456" });
  });

  it("resets stroke to the default (undefined) via the reset swatch", () => {
    const { onStyle } = renderPanel([{ ...ARROW, stroke: "--series-2" }]);
    fireEvent.click(screen.getByLabelText("arrow 1 stroke: Default (plot ink color)"));
    expect(onStyle).toHaveBeenCalledWith("s1", { stroke: undefined });
  });

  it("edits fill via a palette preset for a fill-capable shape", () => {
    const { onStyle } = renderPanel([RECT]);
    fireEvent.click(screen.getByLabelText("rect 1 fill preset 1"));
    expect(onStyle).toHaveBeenCalledWith("s2", { fill: "--series-1" });
  });

  it("edits opacity and width as free-typed numbers", () => {
    const { onStyle } = renderPanel([ARROW]);
    fireEvent.change(screen.getByLabelText("arrow 1 opacity"), { target: { value: "0.6" } });
    expect(onStyle).toHaveBeenCalledWith("s1", { opacity: 0.6 });
    fireEvent.change(screen.getByLabelText("arrow 1 width"), { target: { value: "2.5" } });
    expect(onStyle).toHaveBeenCalledWith("s1", { width: 2.5 });
  });

  it("toggles the dash checkbox", () => {
    const { onStyle } = renderPanel([ARROW]);
    fireEvent.click(screen.getByLabelText("dashed"));
    expect(onStyle).toHaveBeenCalledWith("s1", { dash: true });
  });

  it("removes a shape via its remove button", () => {
    const { onRemove } = renderPanel([ARROW, RECT]);
    fireEvent.click(screen.getByLabelText("Remove arrow 1"));
    expect(onRemove).toHaveBeenCalledWith("s1");
  });

  // Data-loss class bug (lib/focusGuard): the ✕ button unmounts its own row
  // on click; without a focus handoff the browser drops focus to <body>,
  // which useGlobalShortcuts.ts's Delete handler treats as "nothing is being
  // edited" and removes the ACTIVE DATASET instead.
  it("focus never lands on <body> after removing a shape via its ✕", () => {
    renderPanel([ARROW, RECT]);
    fireEvent.click(screen.getByLabelText("Remove arrow 1"));
    expect(document.activeElement).not.toBe(document.body);
  });

  // Focus alone is NOT sufficient — see Inspector/RegionShadesCard's test of
  // the same name for the full explanation.
  it("a Delete keystroke on the post-removal focus anchor is prevented, not left to bubble", () => {
    renderPanel([ARROW, RECT]);
    fireEvent.click(screen.getByLabelText("Remove arrow 1"));
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
