// UX8-I: the plot dock is ONE Tab stop (roving tabindex), arrows move within it,
// and the legend's reorder arrows are chrome that only shows on hover/focus.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PlotLegend from "./PlotLegend";
import PlotToolbar from "./PlotToolbar";
import { useApp } from "../../store/useApp";

const NOOP = () => {};
const props = { onReset: NOOP, onSmartScale: NOOP, onSavePng: NOOP, onCopyData: NOOP, onCopyFigure: NOOP, onSnapshotWindow: NOOP };

const stops = (bar: HTMLElement) => Array.from(bar.querySelectorAll<HTMLButtonElement>("button.qzk-tool-btn")).filter((b) => b.tabIndex >= 0);

describe("PlotToolbar roving tabindex", () => {
  it("exposes exactly one Tab stop, and it is the active tool", () => {
    render(<PlotToolbar {...props} />);
    const bar = screen.getByRole("toolbar", { name: "Plot tools" });
    const tabbable = stops(bar);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("Left/Right/Home/End move focus and carry the single Tab stop with them", () => {
    render(<PlotToolbar {...props} />);
    const bar = screen.getByRole("toolbar", { name: "Plot tools" });
    const first = stops(bar)[0];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = document.activeElement as HTMLButtonElement;
    expect(second).not.toBe(first);
    expect(bar.contains(second)).toBe(true);
    expect(stops(bar)).toEqual([second]);
    fireEvent.keyDown(second, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "End" });
    const last = document.activeElement as HTMLButtonElement;
    expect(stops(bar)).toEqual([last]);
    fireEvent.keyDown(last, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });
});

describe("PlotLegend chrome", () => {
  it("wraps the reorder arrows in the hover/focus-only container and names each toggle", () => {
    useApp.setState({ hiddenChannels: [], seriesLabels: {}, plotTool: "pointer" });
    const series = [{ label: "A", unit: "" }, { label: "B", unit: "" }];
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const reorder = container.querySelectorAll(".qzk-legend-reorder");
    expect(reorder).toHaveLength(2);
    expect(reorder[0].querySelectorAll("button")).toHaveLength(2);
    for (const t of container.querySelectorAll(".qzk-legend-toggle[tabindex]")) {
      expect(t.getAttribute("aria-labelledby") ?? t.getAttribute("aria-label")).toBeTruthy();
    }
    expect(screen.getByRole("checkbox", { name: "A" })).toBeInTheDocument();
  });
});
