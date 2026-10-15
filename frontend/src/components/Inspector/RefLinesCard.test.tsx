// Data-loss class bug, same mechanism as RegionShadesCard/ShapesCard
// (lib/focusGuard): the ✕ button unmounts its own row on click; without a
// focus handoff the browser drops focus to <body>, which
// useGlobalShortcuts.ts's Delete handler treats as "nothing is being edited"
// and removes the ACTIVE DATASET instead.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import RefLinesCard from "./RefLinesCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({ refLines: [{ id: "ref-1", axis: "x", value: 5 }] });
});

describe("RefLinesCard — remove", () => {
  it("removes the line via removeRefLine", () => {
    render(<RefLinesCard />);
    fireEvent.click(screen.getByTitle("Remove"));
    expect(useApp.getState().refLines).toHaveLength(0);
  });

  it("focus never lands on <body> after removing a line via its ✕", () => {
    render(<RefLinesCard />);
    fireEvent.click(screen.getByTitle("Remove"));
    expect(document.activeElement).not.toBe(document.body);
  });

  // Focus alone is NOT sufficient — see RegionShadesCard's test of the same
  // name for the full explanation.
  it("a Delete keystroke on the post-removal focus anchor is prevented, not left to bubble", () => {
    render(<RefLinesCard />);
    fireEvent.click(screen.getByTitle("Remove"));
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows generated-line identity and removes a generated group in one action", () => {
    useApp.setState({ refLines: [
      { id: "r1", axis: "x", value: 28.4, label: "(111)", groupId: "p1", groupLabel: "scan · Pawley reflections" },
      { id: "r2", axis: "x", value: 35.2, label: "(200)", groupId: "p1", groupLabel: "scan · Pawley reflections" },
    ], history: [], future: [] });
    render(<RefLinesCard />);
    expect(screen.getByText(/\(111\).*X =/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove scan · Pawley reflections" }));
    expect(useApp.getState().refLines).toEqual([]);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("names each generated-group removal control for its own group", () => {
    useApp.setState({ refLines: [
      { id: "r1", axis: "x", value: 28.4, groupId: "p1", groupLabel: "phase A" },
      { id: "r2", axis: "x", value: 35.2, groupId: "p2", groupLabel: "phase B" },
    ] });
    render(<RefLinesCard />);
    expect(screen.getByRole("button", { name: "Remove phase A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove phase B" })).toBeInTheDocument();
  });

  it("summarizes a large stick group and edits it as one object", () => {
    const stick = { intensity: 1, baseline: 0.03, height: 0.18, color: "#d97706", visible: true, showLabel: false };
    useApp.setState({ refLines: [
      { id: "r1", axis: "x", value: 28.4, groupId: "p1", groupLabel: "phase A", stick },
      { id: "r2", axis: "x", value: 35.2, groupId: "p1", stick: { ...stick, intensity: 0.5 } },
    ], history: [], future: [] });
    const { container } = render(<RefLinesCard />);
    expect(screen.getByText("phase A · 2 sticks")).toBeInTheDocument();
    expect(container.querySelector(".qz-badge")).toHaveTextContent("1");
    // The two generated lines are deliberately not repeated as individual
    // Inspector rows; a 2,000-stick pattern must not create 2,000 controls.
    expect(screen.queryByText(/X =/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("phase A color"));
    fireEvent.change(screen.getByLabelText("phase A color"), { target: { value: "#123456" } });
    expect(useApp.getState().refLines.every((line) => line.stick?.color === "#123456")).toBe(true);
  });
});
