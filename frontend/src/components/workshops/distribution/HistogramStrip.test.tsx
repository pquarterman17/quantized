import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import HistogramStrip from "./HistogramStrip";
import type { HistBins } from "./useDistribution";

const HIST: HistBins = { counts: [2, 4, 1], centers: [15, 35, 55], edges: [10, 30, 50, 70] };

const bars = (container: HTMLElement) => container.querySelectorAll(".qzk-hist-bar");

describe("HistogramStrip", () => {
  it("renders one bar per count with a count-bearing title", () => {
    const { container } = render(
      <HistogramStrip hist={HIST} fitCurve={null} brushedBins={null} onBrush={vi.fn()} />,
    );
    const b = bars(container);
    expect(b).toHaveLength(3);
    expect(b[0]).toHaveAttribute("title", expect.stringContaining(": 2"));
  });

  it("a plain click (mousedown+mouseup, no drag) brushes that single bin", () => {
    const onBrush = vi.fn();
    const { container } = render(
      <HistogramStrip hist={HIST} fitCurve={null} brushedBins={null} onBrush={onBrush} />,
    );
    const b = bars(container);
    fireEvent.mouseDown(b[1]);
    fireEvent.mouseUp(window);
    expect(onBrush).toHaveBeenCalledWith(1, 1, false);
  });

  it("dragging across bars brushes the spanned range on release", () => {
    const onBrush = vi.fn();
    const { container } = render(
      <HistogramStrip hist={HIST} fitCurve={null} brushedBins={null} onBrush={onBrush} />,
    );
    const b = bars(container);
    fireEvent.mouseDown(b[0]);
    fireEvent.mouseEnter(b[1]);
    fireEvent.mouseEnter(b[2]);
    fireEvent.mouseUp(window);
    expect(onBrush).toHaveBeenCalledWith(0, 2, false);
  });

  it("forwards shiftKey from the release event", () => {
    const onBrush = vi.fn();
    const { container } = render(
      <HistogramStrip hist={HIST} fitCurve={null} brushedBins={null} onBrush={onBrush} />,
    );
    const b = bars(container);
    fireEvent.mouseDown(b[2]);
    fireEvent.mouseUp(window, { shiftKey: true });
    expect(onBrush).toHaveBeenCalledWith(2, 2, true);
  });

  it("highlights bars within the brushed range", () => {
    const { container } = render(
      <HistogramStrip hist={HIST} fitCurve={null} brushedBins={[0, 1]} onBrush={vi.fn()} />,
    );
    const b = bars(container);
    expect((b[0] as HTMLElement).style.background).toBe("var(--accent)");
    expect((b[1] as HTMLElement).style.background).toBe("var(--accent)");
    expect((b[2] as HTMLElement).style.background).not.toBe("var(--accent)");
  });

  it("draws an SVG fit-curve overlay when a fit curve is supplied", () => {
    render(
      <HistogramStrip
        hist={HIST}
        fitCurve={{ x: [10, 40, 70], y: [0.01, 0.02, 0.005] }}
        brushedBins={null}
        onBrush={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("distribution fit overlay")).toBeInTheDocument();
  });

  it("omits the SVG overlay when there is no fit curve", () => {
    render(<HistogramStrip hist={HIST} fitCurve={null} brushedBins={null} onBrush={vi.fn()} />);
    expect(screen.queryByLabelText("distribution fit overlay")).not.toBeInTheDocument();
  });
});
