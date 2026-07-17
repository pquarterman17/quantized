import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlotLegend from "./PlotLegend";
import { CHANNEL_DND, decodeChannelDrag } from "../../lib/dragaxis";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";

const series: PlotSeriesSpec[] = [
  { label: "A", unit: "" },
  { label: "B", unit: "" },
];

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 2], [2, 3], [3, 4]],
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({
    hiddenChannels: [],
    seriesLabels: {},
    y2Keys: null,
    legendPos: "ne",
    legendXY: null,
    legendFrameXY: null,
    legendStatic: false,
    legendTitle: null,
    plotTool: "pointer",
  });
});

function setParentRect(el: Element, rect: { width: number; height: number; left?: number; top?: number }) {
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width: rect.width,
    height: rect.height,
    left,
    top,
    right: left + rect.width,
    bottom: top + rect.height,
    x: left,
    y: top,
    toJSON: () => "",
  } as DOMRect);
}

describe("PlotLegend position", () => {
  it("applies the store legend-position class", () => {
    const { container, rerender } = render(
      <PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />,
    );
    expect(container.querySelector(".qzk-legend")).toHaveClass("ne");

    useApp.setState({ legendPos: "sw" });
    rerender(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    expect(container.querySelector(".qzk-legend")).toHaveClass("sw");
  });
});

describe("PlotLegend free position (MAIN #18 — pointer-mode drag)", () => {
  beforeEach(() => {
    // jsdom's requestAnimationFrame never fires on its own (no paint loop) —
    // stub it to run synchronously, same convention as PlotWindowFrame.test.tsx's
    // own rAF-throttled drag.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("positions via inline left/top % and drops the corner class when legendXY is set", () => {
    useApp.setState({ legendXY: [0.25, 0.75] });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    expect(el).not.toHaveClass("ne");
    expect(el.style.left).toBe("25%");
    expect(el.style.top).toBe("75%");
  });

  it("dragging the box background commits legendXY as fractions of the parent", () => {
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    setParentRect(container, { width: 200, height: 100 });
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.mouseDown(el, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 80 });
    fireEvent.mouseUp(document, { clientX: 100, clientY: 80 });
    expect(useApp.getState().legendXY).toEqual([0.5, 0.8]);
  });

  it("clamps the dragged fraction to [0, 1]", () => {
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    setParentRect(container, { width: 200, height: 100 });
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.mouseDown(el, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.mouseMove(document, { clientX: 999, clientY: -50 });
    fireEvent.mouseUp(document, { clientX: 999, clientY: -50 });
    expect(useApp.getState().legendXY).toEqual([1, 0]);
  });

  it("does not start a drag outside pointer mode", () => {
    useApp.setState({ plotTool: "zoom" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    setParentRect(container, { width: 200, height: 100 });
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.mouseDown(el, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 80 });
    fireEvent.mouseUp(document, { clientX: 100, clientY: 80 });
    expect(useApp.getState().legendXY).toBeNull();
  });

  it("a mousedown bubbled from a child .it row does not start a drag (item interactions stay untouched)", () => {
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    setParentRect(container, { width: 200, height: 100 });
    const item = container.querySelector(".qzk-legend .it") as HTMLElement;
    fireEvent.mouseDown(item, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 80 });
    fireEvent.mouseUp(document, { clientX: 100, clientY: 80 });
    expect(useApp.getState().legendXY).toBeNull();
  });

  it("double-click on the box background resets to the nearest corner and clears legendXY", () => {
    useApp.setState({ legendXY: [0.9, 0.1], legendPos: "sw" }); // near the top-right -> "ne"
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.doubleClick(el);
    expect(useApp.getState().legendXY).toBeNull();
    expect(useApp.getState().legendPos).toBe("ne");
  });

  it("double-click is a no-op when the legend has no free position to reset from", () => {
    useApp.setState({ legendPos: "sw" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.doubleClick(el);
    expect(useApp.getState().legendPos).toBe("sw"); // untouched — nothing to reset
  });
});

describe("PlotLegend frame anchor (decode #52 — faithful in-frame placement)", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("drops the corner class and positions off the frame vars (not the legendXY %)", () => {
    useApp.setState({ legendFrameXY: [0.2, 0.8], legendPos: "ne" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    expect(el).not.toHaveClass("ne"); // corner preset dropped
    // A positioned (not corner) legend sets right/bottom auto; and it is the
    // FRAME branch, not the legendXY percent branch (which would be "20%").
    expect(el.style.right).toBe("auto");
    expect(el.style.left).not.toBe("20%");
  });

  it("wins over a stale legendXY (precedence: frame > free > corner)", () => {
    useApp.setState({ legendFrameXY: [0.2, 0.8], legendXY: [0.5, 0.5] });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    expect(el.style.left).not.toBe("50%"); // not the legendXY branch
  });

  it("dragging the box hands over to legendXY and clears the frame anchor (one-way degrade)", () => {
    useApp.setState({ legendFrameXY: [0.2, 0.8] });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    setParentRect(container, { width: 200, height: 100 });
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.mouseDown(el, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 80 });
    fireEvent.mouseUp(document, { clientX: 100, clientY: 80 });
    expect(useApp.getState().legendXY).toEqual([0.5, 0.8]);
    expect(useApp.getState().legendFrameXY).toBeNull();
  });

  it("double-click clears the frame anchor, falling back to the pinned corner", () => {
    useApp.setState({ legendFrameXY: [0.2, 0.8], legendXY: null, legendPos: "sw" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.doubleClick(el);
    expect(useApp.getState().legendFrameXY).toBeNull();
    expect(useApp.getState().legendPos).toBe("sw"); // the corner the apply already pinned
    expect(el).toHaveClass("sw");
  });
});

describe("PlotLegend static mode (decode #52 — applied Origin figure)", () => {
  it("renders no reorder arrows and no per-row handlers", () => {
    useApp.setState({ legendStatic: true, datasets: [{ id: "d1", name: "run", data: DATA }], activeId: "d1" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    // No ▲▼ reorder buttons.
    expect(container.querySelectorAll(".qzk-legend .it button").length).toBe(0);
    const row = container.querySelector(".qzk-legend .it") as HTMLElement;
    // Not draggable, no hover-hint title.
    expect(row).toHaveAttribute("draggable", "false");
    expect(row).not.toHaveAttribute("title");
    // Clicking a row does NOT toggle visibility (no interactive handler).
    fireEvent.click(row);
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });

  it("omits hidden channels entirely rather than showing them greyed", () => {
    useApp.setState({ legendStatic: true });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[true, false]} />);
    const rows = container.querySelectorAll(".qzk-legend .it");
    expect(rows.length).toBe(1); // the hidden row is skipped, not struck through
    expect(rows[0].textContent).toContain("B");
  });

  it("renders the legend title header when set", () => {
    useApp.setState({ legendStatic: true, legendTitle: "Nb/Au" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const title = container.querySelector(".qzk-legend-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("Nb/Au");
  });

  it("does not render a title header without legendStatic, or without a title", () => {
    useApp.setState({ legendStatic: false, legendTitle: "Nb/Au" });
    const a = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    expect(a.container.querySelector(".qzk-legend-title")).toBeNull();
    useApp.setState({ legendStatic: true, legendTitle: null });
    const b = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    expect(b.container.querySelector(".qzk-legend-title")).toBeNull();
  });

  it("keeps the box draggable in pointer mode even when static", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    useApp.setState({ legendStatic: true });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    setParentRect(container, { width: 200, height: 100 });
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.mouseDown(el, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 80 });
    fireEvent.mouseUp(document, { clientX: 100, clientY: 80 });
    expect(useApp.getState().legendXY).toEqual([0.5, 0.8]);
    vi.unstubAllGlobals();
  });
});

describe("PlotLegend drag-to-axis (#49)", () => {
  it("makes a channel entry draggable and encodes the CHANNEL_DND payload on dragstart", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run", data: DATA }], activeId: "d1" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const items = container.querySelectorAll(".qzk-legend .it");
    expect(items[0]).toHaveAttribute("draggable", "true");

    const setData = vi.fn();
    fireEvent.dragStart(items[0], { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledTimes(1);
    const [type, raw] = setData.mock.calls[0] as [string, string];
    expect(type).toBe(CHANNEL_DND);
    expect(decodeChannelDrag(raw)).toEqual({ datasetId: "d1", channel: 0 });
  });

  it("is not draggable when there's no active dataset", () => {
    useApp.setState({ datasets: [], activeId: null });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const items = container.querySelectorAll(".qzk-legend .it");
    expect(items[0]).toHaveAttribute("draggable", "false");
  });
});

describe("PlotLegend swatch contrast (dark-lines-on-dark-mode fix, item 18)", () => {
  it("substitutes a literal black override's swatch on a dark background", () => {
    const { container } = render(
      <PlotLegend
        series={series}
        styleList={[{ color: "black" }, undefined]}
        plotted={[0, 1]}
        hidden={[false, false]}
        isDarkBg
        inkColor="#eef0f6"
      />,
    );
    const line = container.querySelector(".qzk-legend .it .ln line") as SVGLineElement;
    expect(line.getAttribute("stroke")).not.toBe("black");
    expect(line.getAttribute("stroke")).toBe("#eef0f6");
  });

  it("keeps a literal black override's swatch on a light background", () => {
    const { container } = render(
      <PlotLegend
        series={series}
        styleList={[{ color: "black" }, undefined]}
        plotted={[0, 1]}
        hidden={[false, false]}
        isDarkBg={false}
        inkColor="#1e1e26"
      />,
    );
    const line = container.querySelector(".qzk-legend .it .ln line") as SVGLineElement;
    expect(line.getAttribute("stroke")).toBe("black");
  });

  it("leaves a token ('--series-N') override as a var() reference, untouched by the contrast check", () => {
    const { container } = render(
      <PlotLegend
        series={series}
        styleList={[{ color: "--series-3" }, undefined]}
        plotted={[0, 1]}
        hidden={[false, false]}
        isDarkBg
      />,
    );
    const line = container.querySelector(".qzk-legend .it .ln line") as SVGLineElement;
    expect(line.getAttribute("stroke")).toBe("var(--series-3)");
  });
});

describe("PlotLegend trace samples", () => {
  it("shows markers without a line for scatter series", () => {
    const { container } = render(
      <PlotLegend series={series} styleList={[{ marker: true, markerShape: "circle", width: 0 }]} plotted={[0, 1]} />,
    );
    const sample = container.querySelector(".qzk-legend .it .qzk-legend-sample") as SVGElement;
    expect(sample).toHaveAttribute("data-line", "false");
    expect(sample).toHaveAttribute("data-marker", "circle");
    expect(sample.querySelector("line")).toBeNull();
    expect(sample.querySelector("circle")).not.toBeNull();
  });

  it("shows both the decoded line and decoded marker shape", () => {
    const { container } = render(
      <PlotLegend
        series={series}
        styleList={[{ marker: true, markerShape: "diamond", markerSize: 9, width: 2, line: "dashed" }]}
        plotted={[0, 1]}
      />,
    );
    const sample = container.querySelector(".qzk-legend .it .qzk-legend-sample") as SVGElement;
    expect(sample).toHaveAttribute("data-line", "true");
    expect(sample).toHaveAttribute("data-marker", "diamond");
    expect(sample.querySelector("line")).toHaveAttribute("stroke-dasharray", "6 3");
    expect(sample.querySelector("polygon")).not.toBeNull();
  });

  it("follows the global trace fallback when no per-series style exists", () => {
    const { container } = render(
      <PlotLegend series={series} plotted={[0, 1]} defaultTrace="Line + markers" />,
    );
    const sample = container.querySelector(".qzk-legend .it .qzk-legend-sample") as SVGElement;
    expect(sample).toHaveAttribute("data-line", "true");
    expect(sample).toHaveAttribute("data-marker", "circle");
  });
});
