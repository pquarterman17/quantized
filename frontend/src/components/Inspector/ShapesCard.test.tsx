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
    const f = screen.getByPlaceholderText("x2");
    fireEvent.change(f, { target: { value: "10" } });
    fireEvent.keyDown(f, { key: "Enter" }); // committed on Enter (UX11-C N10), not per keystroke
    expect(useApp.getState().shapes[0].x2).toBe(10);
  });

  it("typing a new y1 commits it via updateShape", () => {
    render(<ShapesCard />);
    const f = screen.getByPlaceholderText("y1");
    fireEvent.change(f, { target: { value: "-3" } });
    fireEvent.blur(f); // an edited field commits on blur
    expect(useApp.getState().shapes[0].y1).toBe(-3);
  });

  // Wrong-result bug, same mechanism as RegionShadesCard: the row fields
  // used to bind straight to the store number with no local buffer, so an
  // unparseable keystroke ("-") committed nothing and the controlled field
  // snapped back to the OLD digits — the NEXT keystroke then landed appended
  // to that old value. Editing 1 to -5 silently produced 15.
  // BufferedNumberField (shared with RegionShadesCard/PropertyNumberField)
  // decouples the DOM value into a local buffer so the in-progress "-" stays
  // visible — this proves the shared fix took here too, not just on
  // RegionShadesCard.
  it("typing '-' then '5' commits -5, not 15", () => {
    render(<ShapesCard />);
    const field = screen.getByPlaceholderText("x1");
    fireEvent.change(field, { target: { value: "-" } });
    expect(useApp.getState().shapes[0].x1).toBe(1); // unchanged mid-typing
    expect(field).toHaveValue("-"); // buffer shows the in-progress text
    fireEvent.change(field, { target: { value: "-5" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useApp.getState().shapes[0].x1).toBe(-5);
    expect(field).toHaveValue("-5");
  });

  it("Select-All+Backspace clears the buffer; blur reverts to the last committed value", () => {
    render(<ShapesCard />);
    const field = screen.getByPlaceholderText("x1");
    fireEvent.change(field, { target: { value: "" } });
    expect(field).toHaveValue("");
    expect(useApp.getState().shapes[0].x1).toBe(1);
    fireEvent.blur(field);
    expect(field).toHaveValue("1");
    expect(useApp.getState().shapes[0].x1).toBe(1);
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

  // UX11-C N10: the display is rounded only while the field is idle; exact
  // values must be enterable, committed once, and an untouched blur must never
  // rewrite them.
  it("typing an exact value then Enter stores it at full precision as ONE undo step", () => {
    render(<ShapesCard />);
    const field = screen.getByPlaceholderText("x1");
    const before = useApp.getState().history.length;
    fireEvent.focus(field);
    for (const t of ["1.", "1.2", "1.23", "1.234567891"]) fireEvent.change(field, { target: { value: t } });
    expect(useApp.getState().shapes[0].x1).toBe(1); // nothing written mid-typing
    expect(field).toHaveValue("1.234567891"); // kept as typed while focused
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useApp.getState().shapes[0].x1).toBe(1.234567891);
    expect(useApp.getState().history.length).toBe(before + 1);
    expect(useApp.getState().history.at(-1)?.label).toMatch(/^edit /);
    fireEvent.blur(field);
    expect(useApp.getState().history.length).toBe(before + 1); // blur adds nothing
    expect(field).toHaveValue("1.2346"); // idle display is rounded
    expect(field).toHaveAttribute("title", "1.234567891"); // full value on hover
  });

  it("an edited field commits once on blur", () => {
    render(<ShapesCard />);
    const field = screen.getByPlaceholderText("y2");
    const before = useApp.getState().history.length;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "4.56789012" } });
    fireEvent.blur(field);
    expect(useApp.getState().shapes[0].y2).toBe(4.56789012);
    expect(useApp.getState().history.length).toBe(before + 1);
  });

  it("Escape reverts the edit and writes nothing", () => {
    render(<ShapesCard />);
    const field = screen.getByPlaceholderText("x2");
    const before = useApp.getState().history.length;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "99" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);
    expect(useApp.getState().shapes[0].x2).toBe(3);
    expect(field).toHaveValue("3");
    expect(useApp.getState().history.length).toBe(before);
  });

  it("focus then blur without editing leaves the exact value and history untouched", () => {
    useApp.setState({ shapes: [{ id: "s1", kind: "rect", x1: 0.007617511520737328, y1: 2, x2: 3, y2: 4 }] });
    render(<ShapesCard />);
    const field = screen.getByPlaceholderText("x1");
    const before = useApp.getState().history.length;
    expect(field).toHaveValue("0.0076175");
    fireEvent.focus(field);
    expect(field).toHaveValue("0.007617511520737328");
    fireEvent.blur(field);
    expect(useApp.getState().shapes[0].x1).toBe(0.007617511520737328);
    expect(useApp.getState().history.length).toBe(before);
  });
});
