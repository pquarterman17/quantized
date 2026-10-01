// The legend's click-to-hide entries were mouse-only (a clickable row with no
// role or tab stop). Each entry's toggle is now a checkbox: Space/Enter toggle
// with the click's own last-visible guard; the row's menu (Shift+F10) renames.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import PlotLegend from "./PlotLegend";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";

const series: PlotSeriesSpec[] = [
  { label: "A", unit: "" },
  { label: "B", unit: "" },
];

beforeEach(() => {
  useApp.setState({ hiddenChannels: [], seriesLabels: {}, legendPos: "ne", legendStatic: false, plotTool: "pointer" });
});

const legend = () => <PlotLegend series={series} plotted={[0, 1]} hidden={series.map((_, i) => useApp.getState().hiddenChannels.includes(i))} />;

describe("PlotLegend entries by keyboard", () => {
  it("Space and Enter toggle a series, and the last visible one stays", () => {
    const { rerender } = render(legend());
    const b = screen.getByRole("checkbox", { name: "B" });
    expect(fireEvent.keyDown(b, { key: " " })).toBe(false); // handled: no page scroll
    expect(useApp.getState().hiddenChannels).toEqual([1]);
    rerender(legend());
    expect(screen.getByRole("checkbox", { name: "B" })).toHaveAttribute("aria-checked", "false");
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "A" }), { key: "Enter" });
    expect(useApp.getState().hiddenChannels).toEqual([1]); // A is the last visible series
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "B" }), { key: "Enter" });
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });

  it("other keys pass through, and the context-menu key reaches Rename", () => {
    render(legend());
    const a = screen.getByRole("checkbox", { name: "A" });
    expect(fireEvent.keyDown(a, { key: "x" })).toBe(true);
    expect(useApp.getState().hiddenChannels).toEqual([]);
    // Shift+F10 / the Menu key fire `contextmenu` at the focused element.
    fireEvent.contextMenu(a);
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    expect(screen.getByPlaceholderText("A")).toHaveFocus();
  });

  it("a static (Origin) legend has no toggles", () => {
    useApp.setState({ legendStatic: true });
    render(legend());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
