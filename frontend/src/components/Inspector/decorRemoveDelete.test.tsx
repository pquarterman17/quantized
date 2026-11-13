// The Inspector decor cards' remove buttons are focusable, and a focused
// button is not an editing target, so Delete/Backspace on one used to reach
// the global Delete shortcut and remove the active DATASET instead of doing
// nothing. Each button now absorbs a Delete aimed at itself
// (lib/focusGuard.ts). The real global listener is mounted, so these specs
// check the outcome, not just the preventDefault() that produces it.

import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import AnnotationsCard from "./AnnotationsCard";
import RefLinesCard from "./RefLinesCard";
import RegionShadesCard from "./RegionShadesCard";
import ShapesCard from "./ShapesCard";
import type { AppState } from "../../store/useApp";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

type Case = {
  name: string;
  card: () => ReactElement;
  state: Partial<AppState>;
  count: () => number;
};

const cases: Case[] = [
  {
    name: "Remove shade 1",
    card: () => <RegionShadesCard />,
    state: { regionShades: [{ id: "sh1", x1: 1, y1: 2, x2: 3, y2: 4, fill: "#336699" }] },
    count: () => useApp.getState().regionShades.length,
  },
  {
    name: "Remove shape 1",
    card: () => <ShapesCard />,
    state: { shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }], selectedShapeId: null },
    count: () => useApp.getState().shapes.length,
  },
  {
    name: "Remove line X = 5",
    card: () => <RefLinesCard />,
    state: { refLines: [{ id: "ref-1", axis: "x", value: 5 }] },
    count: () => useApp.getState().refLines.length,
  },
  {
    name: "Remove phase A",
    card: () => <RefLinesCard />,
    state: { refLines: [{ id: "r1", axis: "x", value: 28.4, groupId: "p1", groupLabel: "phase A" }] },
    count: () => useApp.getState().refLines.length,
  },
  {
    name: "Remove annotation 1",
    card: () => <AnnotationsCard />,
    state: { annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }] },
    count: () => useApp.getState().annotations.length,
  },
];

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } }],
    activeId: "d1",
    selectedIds: ["d1"],
    confirmRemove: false,
  });
});

describe("decor cards: Delete on a focused remove button", () => {
  it.each(cases)("$name keeps the dataset and the object", ({ name, card, state, count }) => {
    useApp.setState(state);
    renderHook(() => useGlobalShortcuts());
    render(card());
    const remove = screen.getByRole("button", { name });
    remove.focus();
    expect(fireEvent.keyDown(remove, { key: "Delete" })).toBe(false); // defaultPrevented
    expect(fireEvent.keyDown(remove, { key: "Backspace" })).toBe(false);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(count()).toBe(1);
    // Control: the same key from <body> does remove it, so the listener is live.
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(useApp.getState().datasets).toHaveLength(0);
  });
});
