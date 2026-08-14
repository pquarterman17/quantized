// GUI_INTERACTION #3 sub-item 4: a drawn shape's x1/y1 → x2/y2 fields are
// the non-mouse "move/reshape this shape" path — until this landed, a shape
// had no way to reposition it except dragging its body/handle on the canvas.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../overlays/ConfirmDialog";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

import ShapesCard from "./ShapesCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  useApp.setState({
    shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
    selectedShapeId: null,
  });
});

describe("ShapesCard — editable x1/y1 → x2/y2", () => {
  it("shows the shape's current coordinates in editable fields", () => {
    render(<ShapesCard />);
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
  });

  it("typing a new x2 commits it via updateShape", () => {
    render(<ShapesCard />);
    fireEvent.change(screen.getByPlaceholderText("x2"), { target: { value: "10" } });
    expect(useApp.getState().shapes[0].x2).toBe(10);
  });

  it("typing a new y1 commits it via updateShape", () => {
    render(<ShapesCard />);
    fireEvent.change(screen.getByPlaceholderText("y1"), { target: { value: "-3" } });
    expect(useApp.getState().shapes[0].y1).toBe(-3);
  });

  it("clicking the kind label still toggles selection (unaffected by the new fields)", () => {
    render(<ShapesCard />);
    fireEvent.click(screen.getByText("rect"));
    expect(useApp.getState().selectedShapeId).toBe("s1");
  });

  it("Remove still works from the reflowed row", () => {
    render(<ShapesCard />);
    fireEvent.click(screen.getByTitle("Remove"));
    expect(useApp.getState().shapes).toHaveLength(0);
  });

  // Data-loss class bug, same mechanism as RegionShadesCard (lib/focusGuard):
  // the ✕ button unmounts its own row on click; without a focus handoff the
  // browser drops focus to <body>, which useGlobalShortcuts.ts's Delete
  // handler treats as "nothing is being edited" and removes the ACTIVE
  // DATASET instead.
  it("focus never lands on <body> after removing a shape via its ✕", () => {
    render(<ShapesCard />);
    fireEvent.click(screen.getByTitle("Remove"));
    expect(document.activeElement).not.toBe(document.body);
  });

  // Focus alone is NOT sufficient — see RegionShadesCard's test of the same
  // name for the full explanation. The container's own onKeyDown
  // (absorbStrayDeleteOnContainer) must preventDefault() a Delete/Backspace
  // targeting it directly, or useGlobalShortcuts' window listener still
  // treats it as "nothing is being edited."
  it("a Delete keystroke on the post-removal focus anchor is prevented, not left to bubble", () => {
    render(<ShapesCard />);
    fireEvent.click(screen.getByTitle("Remove"));
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

// GUI_INTERACTION #17's parked judgment call, decided 2026-08-13: the bulk
// "Clear all" pauses for a confirm; the per-shape ✕ stays confirm-free.
describe("ShapesCard — Clear all confirm", () => {
  it("does not clear synchronously; clears once the confirm resolves true", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    render(<ShapesCard />);
    fireEvent.click(screen.getByText("Clear all"));
    expect(useApp.getState().shapes).toHaveLength(1);
    await Promise.resolve();
    expect(useApp.getState().shapes).toHaveLength(0);
    expect(vi.mocked(askConfirm).mock.calls[0][0]).toBe("Clear all 1 shape?");
  });

  it("declining the confirm leaves every shape in place", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    render(<ShapesCard />);
    fireEvent.click(screen.getByText("Clear all"));
    await Promise.resolve();
    expect(useApp.getState().shapes).toHaveLength(1);
  });

  it("pluralizes the title for several shapes", () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    useApp.setState({
      shapes: [
        { id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 },
        { id: "s2", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 },
      ],
    });
    render(<ShapesCard />);
    fireEvent.click(screen.getByText("Clear all"));
    expect(vi.mocked(askConfirm).mock.calls[0][0]).toBe("Clear all 2 shapes?");
  });
});
