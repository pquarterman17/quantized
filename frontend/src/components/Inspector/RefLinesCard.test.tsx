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
});
