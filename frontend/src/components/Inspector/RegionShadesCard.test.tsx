// F2.3j: region shades are EDITABLE plot objects, not immutable provenance
// (owner decision 2026-08-13). This card follows RefLinesCard's "ADD belongs
// here" convention (a shade is fully specified by numbers) plus ShapesCard's
// editable-coordinate-fields convention (a shade has four coordinates + a
// fill color, not one value).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import RegionShadesCard from "./RegionShadesCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({ regionShades: [] });
});

describe("RegionShadesCard — empty state + Add", () => {
  it("renders the Add form's coordinate fields with sensible defaults", () => {
    render(<RegionShadesCard />);
    expect(screen.getByPlaceholderText("x1")).toHaveValue("0");
    expect(screen.getByPlaceholderText("y1")).toHaveValue("0");
    expect(screen.getByPlaceholderText("x2")).toHaveValue("1");
    expect(screen.getByPlaceholderText("y2")).toHaveValue("1");
  });

  it("Add commits a new shade via addRegionShade with the entered coordinates + fill", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getByPlaceholderText("x1"), { target: { value: "2" } });
    fireEvent.change(screen.getByPlaceholderText("y1"), { target: { value: "3" } });
    fireEvent.change(screen.getByPlaceholderText("x2"), { target: { value: "4" } });
    fireEvent.change(screen.getByPlaceholderText("y2"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("New shade fill color"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByText("Add"));
    expect(useApp.getState().regionShades).toEqual([
      expect.objectContaining({ x1: 2, y1: 3, x2: 4, y2: 5, fill: "#ff0000" }),
    ]);
  });

  it("Add defaults a fresh shade to the primary axis (no axis key at all)", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getByText("Add"));
    expect(useApp.getState().regionShades[0]).not.toHaveProperty("axis");
  });

  it("picking Y2 before Add tags the new shade axis: 1", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Y2" })[0]);
    fireEvent.click(screen.getByText("Add"));
    expect(useApp.getState().regionShades[0].axis).toBe(1);
  });

  it("disables Add and explains why when a coordinate is left blank", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getByPlaceholderText("x1"), { target: { value: "" } });
    expect(screen.getByText("Add")).toBeDisabled();
  });

  it("disables Add when a coordinate is not a number", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getByPlaceholderText("x1"), { target: { value: "abc" } });
    expect(screen.getByText("Add")).toBeDisabled();
  });
});

describe("RegionShadesCard — existing shade: edit + remove", () => {
  beforeEach(() => {
    useApp.setState({
      regionShades: [{ id: "sh1", x1: 1, y1: 2, x2: 3, y2: 4, fill: "#336699" }],
    });
  });

  it("shows the shade's current coordinates and fill in editable fields", () => {
    render(<RegionShadesCard />);
    expect(screen.getAllByPlaceholderText("x1")[0]).toHaveValue("1");
    expect(screen.getAllByPlaceholderText("y1")[0]).toHaveValue("2");
    expect(screen.getAllByPlaceholderText("x2")[0]).toHaveValue("3");
    expect(screen.getAllByPlaceholderText("y2")[0]).toHaveValue("4");
    expect(screen.getByLabelText("Fill color")).toHaveValue("#336699");
  });

  it("typing a new x2 commits it via updateRegionShade", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getAllByPlaceholderText("x2")[0], { target: { value: "10" } });
    expect(useApp.getState().regionShades[0].x2).toBe(10);
  });

  // Wrong-result bug (reproduced live): the row fields used to bind straight
  // to the store number with no local buffer, so an unparseable keystroke
  // ("-") committed nothing and the controlled field snapped back to the OLD
  // digits — the NEXT keystroke then landed appended to that old value.
  // Editing 1 to -5 silently produced 15. BufferedNumberField decouples the
  // DOM value into a local buffer so the in-progress "-" stays visible.
  describe("negative-number typing (BufferedNumberField)", () => {
    it("typing '-' then '5' commits -5, not 15", () => {
      render(<RegionShadesCard />);
      const field = screen.getAllByPlaceholderText("x1")[0];
      // Simulates the keystroke sequence: "-" first (an incomplete number —
      // nothing commits yet), then the full "-5".
      fireEvent.change(field, { target: { value: "-" } });
      expect(useApp.getState().regionShades[0].x1).toBe(1); // unchanged mid-typing
      expect(field).toHaveValue("-"); // buffer shows the in-progress text, doesn't snap back
      fireEvent.change(field, { target: { value: "-5" } });
      expect(useApp.getState().regionShades[0].x1).toBe(-5);
      expect(field).toHaveValue("-5");
    });

    it("Select-All+Backspace clears the buffer; blur reverts to the last committed value", () => {
      render(<RegionShadesCard />);
      const field = screen.getAllByPlaceholderText("x1")[0];
      fireEvent.change(field, { target: { value: "" } });
      expect(field).toHaveValue(""); // the field can actually go empty now
      expect(useApp.getState().regionShades[0].x1).toBe(1); // no undefined write
      fireEvent.blur(field);
      expect(field).toHaveValue("1"); // required: reverts to the committed value
      expect(useApp.getState().regionShades[0].x1).toBe(1);
    });
  });

  it("changing the fill color commits it via updateRegionShade", () => {
    render(<RegionShadesCard />);
    fireEvent.change(screen.getByLabelText("Fill color"), { target: { value: "#00ff00" } });
    expect(useApp.getState().regionShades[0].fill).toBe("#00ff00");
  });

  it("toggling the row's axis to Y2 commits axis: 1 via updateRegionShade", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Y2" })[0]);
    expect(useApp.getState().regionShades[0].axis).toBe(1);
  });

  it("toggling back to Y commits axis: 0 (not undefined) via updateRegionShade", () => {
    useApp.setState({
      regionShades: [{ id: "sh1", x1: 1, y1: 2, x2: 3, y2: 4, fill: "#336699", axis: 1 }],
    });
    render(<RegionShadesCard />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Y" })[0]);
    expect(useApp.getState().regionShades[0].axis).toBe(0);
  });

  it("Remove drops the shade via removeRegionShade", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getByLabelText("Remove region shade"));
    expect(useApp.getState().regionShades).toHaveLength(0);
  });

  // Data-loss class bug (reproduced live): the ✕ button unmounts itself on
  // click, and without a focus handoff the browser drops focus to <body> —
  // which useGlobalShortcuts.ts's Delete handler treats as "nothing is being
  // edited" and removes the ACTIVE DATASET. lib/focusGuard moves focus to the
  // card's own container first, synchronously, so body never receives it.
  it("focus never lands on <body> after removing a shade via its ✕", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getByLabelText("Remove region shade"));
    expect(document.activeElement).not.toBe(document.body);
  });

  // Focus alone is NOT sufficient: a focused plain <div> is not an "editing
  // target" either, so useGlobalShortcuts' `!isEditing(e.target)` guard would
  // still let a Delete/Backspace through and remove the active dataset even
  // though body never received focus (measured live — this exact assertion
  // caught it: the interim focus-only version left activeElement as the
  // container but the keystroke still bubbled un-prevented). The container's
  // own onKeyDown (lib/focusGuard's absorbStrayDeleteOnContainer) must call
  // preventDefault() so useGlobalShortcuts' window listener never sees an
  // un-prevented Delete for this target.
  it("a Delete keystroke on the post-removal focus anchor is prevented, not left to bubble", () => {
    render(<RegionShadesCard />);
    fireEvent.click(screen.getByLabelText("Remove region shade"));
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the shade count badge", () => {
    render(<RegionShadesCard />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
