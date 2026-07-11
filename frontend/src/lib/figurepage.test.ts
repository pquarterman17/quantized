// Pure slot-model tests for the figure page composer (GOTO #4).

import { describe, expect, it } from "vitest";

import {
  assignSlot,
  clearSlot,
  emptySlots,
  filledCount,
  panelLabel,
  patchSlot,
  resizeSlots,
  slotLabels,
  type PanelSource,
} from "./figurepage";

const winA: PanelSource = { kind: "window", id: "w1", name: "Graph 1" };
const winB: PanelSource = { kind: "window", id: "w2", name: "Graph 2" };
const doc: PanelSource = { kind: "figdoc", id: "f1", name: "MvsH fig" };

describe("panelLabel", () => {
  it("mirrors the backend formats", () => {
    expect(panelLabel(0, "(a)")).toBe("(a)");
    expect(panelLabel(1, "(a)")).toBe("(b)");
    expect(panelLabel(2, "A)")).toBe("C)");
    expect(panelLabel(3, "a.")).toBe("d.");
    expect(panelLabel(0, "(A)")).toBe("(A)");
    expect(panelLabel(1, "A.")).toBe("B.");
    expect(panelLabel(4, "a)")).toBe("e)");
    expect(panelLabel(9, "none")).toBe("");
  });

  it("rolls over spreadsheet-style past z", () => {
    expect(panelLabel(25, "(a)")).toBe("(z)");
    expect(panelLabel(26, "(a)")).toBe("(aa)");
    expect(panelLabel(27, "(A)")).toBe("(AB)");
  });
});

describe("slot model", () => {
  it("builds an empty rows x cols grid", () => {
    const slots = emptySlots(2, 3);
    expect(slots).toHaveLength(6);
    expect(filledCount(slots)).toBe(0);
  });

  it("assigns a source and moves it when re-assigned elsewhere", () => {
    let slots = emptySlots(2, 2);
    slots = assignSlot(slots, 0, winA);
    slots = assignSlot(slots, 3, winB);
    expect(slots[0].source?.id).toBe("w1");
    expect(slots[3].source?.id).toBe("w2");
    // Re-assigning winA into slot 1 empties slot 0 (a plot appears once).
    slots = assignSlot(slots, 1, winA);
    expect(slots[0].source).toBeNull();
    expect(slots[1].source?.id).toBe("w1");
    expect(filledCount(slots)).toBe(2);
  });

  it("does not conflate a window and a figdoc with the same id", () => {
    let slots = emptySlots(1, 2);
    slots = assignSlot(slots, 0, { ...winA, id: "same" });
    slots = assignSlot(slots, 1, { ...doc, id: "same" });
    expect(slots[0].source?.kind).toBe("window");
    expect(slots[1].source?.kind).toBe("figdoc");
  });

  it("clears a slot including its overrides", () => {
    let slots = emptySlots(1, 1);
    slots = assignSlot(slots, 0, winA);
    slots = patchSlot(slots, 0, { label: "(x)", title: "T" });
    slots = clearSlot(slots, 0);
    expect(slots[0]).toEqual({ source: null, label: null, title: null });
  });

  it("preserves slots by (row, col) position across a grid resize", () => {
    let slots = emptySlots(2, 2);
    slots = assignSlot(slots, 0, winA); // (0,0)
    slots = assignSlot(slots, 3, winB); // (1,1)
    // Grow 2x2 -> 2x3: (0,0) stays index 0, (1,1) becomes index 4.
    const grown = resizeSlots(slots, 2, 2, 3);
    expect(grown).toHaveLength(6);
    expect(grown[0].source?.id).toBe("w1");
    expect(grown[4].source?.id).toBe("w2");
    // Shrink 2x2 -> 1x2: row 1 falls off, winB is dropped.
    const shrunk = resizeSlots(slots, 2, 1, 2);
    expect(shrunk).toHaveLength(2);
    expect(shrunk[0].source?.id).toBe("w1");
    expect(filledCount(shrunk)).toBe(1);
  });
});

describe("slotLabels", () => {
  it("auto-numbers only filled slots, in row-major order", () => {
    let slots = emptySlots(2, 2);
    slots = assignSlot(slots, 1, winA);
    slots = assignSlot(slots, 3, winB);
    expect(slotLabels(slots, "(a)")).toEqual(["", "(a)", "", "(b)"]);
  });

  it("lets an explicit override win without consuming the sequence position", () => {
    let slots = emptySlots(1, 3);
    slots = assignSlot(slots, 0, winA);
    slots = assignSlot(slots, 1, winB);
    slots = assignSlot(slots, 2, doc);
    slots = patchSlot(slots, 1, { label: "(ii)" });
    // The override replaces "(b)"; the third panel still previews "(c)" —
    // matching the backend, where the auto index counts panels, not labels.
    expect(slotLabels(slots, "(a)")).toEqual(["(a)", "(ii)", "(c)"]);
  });

  it("suppresses everything under the none format", () => {
    let slots = emptySlots(1, 2);
    slots = assignSlot(slots, 0, winA);
    expect(slotLabels(slots, "none")).toEqual(["", ""]);
  });
});
