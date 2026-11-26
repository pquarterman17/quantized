import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { formatSelectionStats } from "../../lib/selectionStats";
import { useSelectionStats } from "../../store/selectionStats";
import StatusBar from "./StatusBar";

afterEach(() => useSelectionStats.setState({ owner: null, text: null }));

const stats = formatSelectionStats({ count: 3, sum: 6, mean: 2, min: 1, max: 3, text: 1, skipped: 0, cells: 4 }, (_k, v) => String(v));

describe("StatusBar selection statistics", () => {
  it("is hidden until a selection publishes numeric stats", () => {
    render(<StatusBar />);
    expect(screen.queryByLabelText("Selection statistics")).toBeNull();
  });
  it("shows Count, Sum, Mean, Min, Max and the text note, and a stale owner cannot clear it", () => {
    render(<StatusBar />);
    act(() => useSelectionStats.getState().publish("a", stats));
    const el = screen.getByLabelText("Selection statistics");
    for (const w of ["Count 3", "Sum 6", "Mean 2", "Min 1", "Max 3", "1 text"]) expect(el.textContent).toContain(w);
    act(() => useSelectionStats.getState().publish("b", null));
    expect(screen.getByLabelText("Selection statistics")).toBeTruthy();
    act(() => useSelectionStats.getState().publish("a", null));
    expect(screen.queryByLabelText("Selection statistics")).toBeNull();
  });
});
