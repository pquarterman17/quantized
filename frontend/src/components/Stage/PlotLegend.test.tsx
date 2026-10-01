import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LegendSample from "./LegendSample";
import PlotLegend from "./PlotLegend";
import { CHANNEL_DND, decodeChannelDrag } from "../../lib/dragaxis";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import { displayPositions } from "../../lib/seriesStyleCycle";
import type { DataStruct, SeriesStyle } from "../../lib/types";
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
    legendSize: null,
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

describe("PlotLegend — P1.4 encoded legend text", () => {
  it("an encoded render's finished text wins over the channel rename; without it the rename shows", () => {
    useApp.setState({ seriesLabels: { 0: "Renamed" } });
    const split: PlotSeriesSpec[] = [
      { label: "A (s=S1)", unit: "" },
      { label: "A (s=S2)", unit: "" },
    ];
    const labels = ["Renamed (s=S1)", "Renamed (s=S2)"];
    const { container, rerender } = render(
      <PlotLegend series={split} plotted={[0, 0]} hidden={[false, false]} labels={labels} />,
    );
    const legend = () => container.querySelector(".qzk-legend")!;
    expect(legend()).toHaveTextContent("Renamed (s=S1)");
    expect(legend()).toHaveTextContent("Renamed (s=S2)");
    rerender(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    expect(legend()).toHaveTextContent("Renamed");
    expect(legend()).not.toHaveTextContent("(s=");
  });
});

// BUGS_AND_ISSUES BUG-014 finding 4: the export drops a zero-length legend
// label (matplotlib's rule, `test_an_empty_rename_drops_the_series_from_the_
// rendered_legend`). The screen now does the same: an empty display name hides
// the ROW, never the series, so the plot and its hidden state are untouched.
describe("PlotLegend — empty display name (matches the export)", () => {
  it("an empty rename drops that series' legend row but leaves it plotted", () => {
    useApp.setState({ seriesLabels: { 1: "" } });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const rows = container.querySelectorAll(".qzk-legend .it");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("A");
    expect(container.querySelectorAll(".qzk-legend-sample")).toHaveLength(1);
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });

  // matplotlib draws no legend when no artist has a label, so the screen
  // draws no box either, in both modes. A title or a colour scale keeps it.
  it.each([false, true])("no box at all when every row is empty and there is no title (static=%s)", (legendStatic) => {
    useApp.setState({ legendStatic, seriesLabels: { 0: "", 1: "" } });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    expect(container.querySelector(".qzk-legend")).toBeNull();
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });

  it("a title keeps the box when every row is empty", () => {
    useApp.setState({ seriesLabels: { 0: "", 1: "" }, legendTitle: "Runs" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    expect(container.querySelector(".qzk-legend")).not.toBeNull();
    expect(container.querySelectorAll(".qzk-legend .it:not(.qzk-legend-title)")).toHaveLength(0);
  });

  it("static mode: empty rows plus hidden rows leave nothing, so no box", () => {
    useApp.setState({ legendStatic: true, seriesLabels: { 1: "" } });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[true, false]} />);
    expect(container.querySelector(".qzk-legend")).toBeNull();
  });

  it("an empty ENCODED label drops the row too, in static mode as well", () => {
    useApp.setState({ legendStatic: true });
    const { container } = render(
      <PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} labels={["", "B"]} />,
    );
    const rows = container.querySelectorAll(".qzk-legend .it");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("B");
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

  it("moves an enlarged legend from empty space in its content body", () => {
    useApp.setState({ legendSize: [240, 140] });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    setParentRect(container, { width: 400, height: 200 });
    const content = container.querySelector(".qzk-legend-content") as HTMLElement;
    fireEvent.mouseDown(content, { clientX: 80, clientY: 60, button: 0 });
    fireEvent.mouseMove(document, { clientX: 200, clientY: 100 });
    fireEvent.mouseUp(document, { clientX: 200, clientY: 100 });
    expect(useApp.getState().legendXY).toEqual([0.5, 0.5]);
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

  it("the inline label editor is named for the series it relabels", () => {
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    fireEvent.doubleClick(container.querySelectorAll(".qzk-legend .it")[1]);
    const input = container.querySelector(".qzk-legend input");
    expect(input).toHaveAttribute("placeholder", "B");
    expect(input).toHaveAccessibleName("Legend label for B");
  });

  it("double-click on the box background resets to the nearest corner and clears legendXY", () => {
    useApp.setState({ legendXY: [0.9, 0.1], legendPos: "sw" }); // near the top-right -> "ne"
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const el = container.querySelector(".qzk-legend") as HTMLElement;
    fireEvent.doubleClick(el);
    expect(useApp.getState().legendXY).toBeNull();
    expect(useApp.getState().legendPos).toBe("ne");
  });

  it("double-click on the content body's empty space resets like the box background", () => {
    useApp.setState({ legendXY: [0.9, 0.1], legendPos: "sw" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    fireEvent.doubleClick(container.querySelector(".qzk-legend-content") as HTMLElement);
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

describe("PlotLegend edge and corner resize", () => {
  it("shows eight direct-manipulation handles only in pointer mode", async () => {
    const { container, rerender } = render(
      <PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />,
    );
    await waitFor(() => expect(container.querySelectorAll(".qzk-legend-resize")).toHaveLength(8));
    useApp.setState({ plotTool: "zoom" });
    rerender(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    expect(container.querySelectorAll(".qzk-legend-resize")).toHaveLength(0);
  });

  it("resizes from a corner, preserves the top-left, and commits position plus size once", async () => {
    const history = vi.spyOn(useApp.getState(), "recordHistory");
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const legend = container.querySelector(".qzk-legend") as HTMLElement;
    setParentRect(container, { width: 400, height: 300 });
    setParentRect(legend, { left: 50, top: 20, width: 120, height: 80 });
    await waitFor(() => expect(container.querySelector(".qzk-legend-resize-se")).toBeInTheDocument());
    const handle = container.querySelector(".qzk-legend-resize-se") as HTMLElement;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 170, clientY: 100, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 220, clientY: 150 });
    await waitFor(() => expect(legend.style.width).toBe("170px"));
    expect(legend.style.height).toBe("130px");
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 220, clientY: 150 });
    expect(useApp.getState().legendXY).toEqual([0.125, 20 / 300]);
    expect(useApp.getState().legendSize).toEqual([170, 130]);
    expect(history).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledWith("resize legend");
  });

  it("double-clicking a resize handle returns to content-driven sizing", async () => {
    useApp.setState({ legendSize: [240, 120] });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} />);
    const legend = container.querySelector(".qzk-legend") as HTMLElement;
    expect(legend.style.width).toBe("240px");
    await waitFor(() => expect(container.querySelector(".qzk-legend-resize-e")).toBeInTheDocument());
    fireEvent.doubleClick(container.querySelector(".qzk-legend-resize-e")!);
    expect(useApp.getState().legendSize).toBeNull();
    expect(legend.style.width).toBe("");
  });

  it("ignores sub-threshold pointer jitter without adding an undo entry", async () => {
    const history = vi.spyOn(useApp.getState(), "recordHistory");
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} />);
    const legend = container.querySelector(".qzk-legend") as HTMLElement;
    setParentRect(container, { width: 400, height: 300 });
    setParentRect(legend, { left: 50, top: 20, width: 120, height: 80 });
    await waitFor(() => expect(container.querySelector(".qzk-legend-resize-se")).toBeInTheDocument());
    const handle = container.querySelector(".qzk-legend-resize-se") as HTMLElement;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });
    fireEvent.pointerDown(handle, { pointerId: 8, clientX: 170, clientY: 100, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 171, clientY: 101 });
    fireEvent.pointerUp(handle, { pointerId: 8, clientX: 171, clientY: 101 });
    expect(useApp.getState().legendSize).toBeNull();
    expect(history).not.toHaveBeenCalled();
  });

  it("once resizing, follows the pointer back inside the start threshold", async () => {
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} />);
    const legend = container.querySelector(".qzk-legend") as HTMLElement;
    setParentRect(container, { width: 400, height: 300 });
    setParentRect(legend, { left: 50, top: 20, width: 120, height: 80 });
    await waitFor(() => expect(container.querySelector(".qzk-legend-resize-e")).toBeInTheDocument());
    const handle = container.querySelector(".qzk-legend-resize-e") as HTMLElement;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
      releasePointerCapture: { value: vi.fn() },
    });
    fireEvent.pointerDown(handle, { pointerId: 10, clientX: 170, clientY: 60, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 220, clientY: 60 });
    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 172, clientY: 60 });
    fireEvent.pointerUp(handle, { pointerId: 10, clientX: 172, clientY: 60 });
    expect(useApp.getState().legendSize).toEqual([122, 80]);
  });

  it("cancels an in-progress preview if pointer capture is lost", async () => {
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} />);
    const legend = container.querySelector(".qzk-legend") as HTMLElement;
    setParentRect(container, { width: 400, height: 300 });
    setParentRect(legend, { left: 50, top: 20, width: 120, height: 80 });
    await waitFor(() => expect(container.querySelector(".qzk-legend-resize-se")).toBeInTheDocument());
    const handle = container.querySelector(".qzk-legend-resize-se") as HTMLElement;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() }, hasPointerCapture: { value: () => false },
      releasePointerCapture: { value: vi.fn() },
    });
    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 170, clientY: 100, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 220, clientY: 150 });
    await waitFor(() => expect(legend.style.width).toBe("170px"));
    fireEvent.lostPointerCapture(handle, { pointerId: 9 });
    expect(legend.style.width).toBe("");
    expect(useApp.getState().legendSize).toBeNull();
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

  it("renders the title as the interactive legend's heading and accessible name (R2)", () => {
    useApp.setState({ legendStatic: false, legendTitle: "Runs" });
    const { container, getByRole } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const title = container.querySelector(".qzk-legend-title");
    expect(title?.textContent).toBe("Runs");
    // The heading sits first INSIDE the content wrapper, so content-driven
    // (fit-to-contents) sizing and scrolling include it.
    expect(container.querySelector(".qzk-legend-content")?.firstElementChild).toBe(title);
    expect(getByRole("group", { name: "Runs" })).toBe(container.querySelector(".qzk-legend"));
    // The rows stay interactive beside the heading.
    expect(container.querySelectorAll(".qzk-legend-content > .it:not(.qzk-legend-title)")).toHaveLength(2);
  });

  it("renders no heading for a null, empty or blank title", () => {
    for (const legendTitle of [null, "", "  "]) {
      for (const legendStatic of [false, true]) {
        useApp.setState({ legendStatic, legendTitle });
        const r = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
        expect(r.container.querySelector(".qzk-legend-title")).toBeNull();
        expect(r.getByRole("group", { name: "Plot legend" })).toBe(r.container.querySelector(".qzk-legend"));
        r.unmount();
      }
    }
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

// ── P3.3: the legend swatch must resolve the SAME cycle its canvas did ──────
// The legend is the third renderer of a series' look, after the canvas and the
// publication export, and it is the one a reader checks the other two against.
// Nothing pinned it in the first cut: reverting both `resolveSeriesStyle` calls
// in PlotLegend.tsx to the raw `styleList?.[i]` left the whole Stage suite
// green, because no test anywhere turned the cycle on and rendered a legend.
describe("PlotLegend — auto dash/marker cycle (P3.3)", () => {
  const three: PlotSeriesSpec[] = [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
    { label: "C", unit: "" },
  ];
  const samples = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".qzk-legend .it .qzk-legend-sample")) as SVGElement[];
  const dashOf = (sample: SVGElement) => sample.querySelector("line")?.getAttribute("stroke-dasharray");

  it("draws no dash without a cycle — unchanged from before the feature", () => {
    const { container } = render(<PlotLegend series={three} plotted={[0, 1, 2]} />);
    expect(samples(container).map(dashOf)).toEqual([null, null, null]);
  });

  it("draws the cycle's dash per display position when its canvas is cycling", () => {
    const { container } = render(
      <PlotLegend series={three} plotted={[0, 1, 2]} seriesCycle={displayPositions(true, 3)} />,
    );
    // LegendSample's own SVG spelling of solid / dashed / dotted.
    expect(samples(container).map(dashOf)).toEqual([null, "6 3", "1.5 3"]);
  });

  it("reads the DISPLAY POSITION the canvas used, not the legend row index", () => {
    // The hidden-series case, from the legend's side: the canvas kept the
    // hidden series in place, so B and C are still at positions 1 and 2 even
    // though a filtered list would renumber them.
    const { container } = render(
      <PlotLegend series={three} plotted={[0, 1, 2]} seriesCycle={[2, 0, 1]} />,
    );
    expect(samples(container).map(dashOf)).toEqual(["1.5 3", null, "6 3"]);
  });

  it("an explicit per-series dash still wins in the legend, as on the canvas", () => {
    const { container } = render(
      <PlotLegend
        series={three}
        plotted={[0, 1, 2]}
        styleList={[undefined, { line: "solid" }, undefined]}
        seriesCycle={displayPositions(true, 3)}
      />,
    );
    expect(samples(container).map(dashOf)).toEqual([null, null, "1.5 3"]);
  });

  it("cycles the glyph only for a series that actually draws markers", () => {
    const { container } = render(
      <PlotLegend
        series={three}
        plotted={[0, 1, 2]}
        styleList={[{ marker: true }, { marker: true }, undefined]}
        seriesCycle={displayPositions(true, 3)}
      />,
    );
    expect(samples(container).map((s) => s.getAttribute("data-marker"))).toEqual([
      "circle",
      "square",
      "none",
    ]);
  });

  // The case the test above could not see, because it never set `defaultTrace`.
  // An AMBIENT Scatter / Line + markers trace draws markers without any
  // `style.marker`, and the swatch used to take the glyph from
  // `style.markerShape` whenever markers showed at all — so with the cycle on it
  // drew circle / square / triangle while `buildOpts` gave all three uPlot's own
  // plain 5px circle and `buildExportStyles` emitted no marker whatsoever.
  // Measured before the fix: data-marker ["circle","square","triangle"] against a
  // canvas of three {show:true,size:5}.
  it.each(["Scatter", "Line + markers"] as const)(
    "does NOT cycle the glyph for the ambient %s default trace (nor does the canvas)",
    (defaultTrace) => {
      const { container } = render(
        <PlotLegend
          series={three}
          plotted={[0, 1, 2]}
          defaultTrace={defaultTrace}
          seriesCycle={displayPositions(true, 3)}
        />,
      );
      expect(samples(container).map((s) => s.getAttribute("data-marker"))).toEqual([
        "circle",
        "circle",
        "circle",
      ]);
    },
  );

  it("an EXPLICIT marker still cycles its glyph under a default trace", () => {
    // `style.marker` is what the export keys on, so an explicit marker is the one
    // case where a cycled glyph does reach the PDF — and the legend must show it.
    const { container } = render(
      <PlotLegend
        series={three}
        plotted={[0, 1, 2]}
        defaultTrace="Scatter"
        styleList={[{ marker: true }, { marker: true }, { marker: true }]}
        seriesCycle={displayPositions(true, 3)}
      />,
    );
    expect(samples(container).map((s) => s.getAttribute("data-marker"))).toEqual([
      "circle",
      "square",
      "triangle",
    ]);
  });

  // The ONE render path this feature changed with the preference OFF, frozen as
  // a literal so it is a decision on the record rather than a silent drift.
  //
  // At d28fcd6e (before the feature) `LegendSample` decided markers locally:
  // `showMarker = marker || scatter || line+markers`, then `shape =
  // style.markerShape ?? "circle"` and `radius` from `style.markerSize`. So a
  // stored `{marker:false, markerShape:"diamond", markerSize:9}` on a Scatter
  // series — the combination `Inspector/SeriesStyleCard.tsx` leaves behind when
  // "Markers" is unticked — rendered data-marker="diamond" with a 4.5px polygon.
  // The canvas has never drawn that: with `marker` off, `buildOpts` hands uPlot
  // its plain 5px circle, and `buildExportStyles` emits no marker at all. The
  // legend was lying about a glyph nothing else drew, so `markerDecision` (which
  // both sides now share) corrects it to a 2.5px circle.
  //
  // The 32-combination differential proof below CANNOT see this: it compares
  // PlotLegend against the post-change `LegendSample`, i.e. the component
  // against itself.
  it("the deliberate OFF-state change: marker:false on a Scatter trace draws the CIRCLE the canvas draws", () => {
    const { container } = render(
      <PlotLegend
        series={[{ label: "A", unit: "" }]}
        plotted={[0]}
        styleList={[{ marker: false, markerShape: "diamond", markerSize: 9 }]}
        defaultTrace="Scatter"
        seriesCycle={null}
      />,
    );
    const swatch = samples(container)[0];
    // Frozen literal, not a re-derivation: `d28fcd6e` produced
    // data-marker="diamond" with a `<polygon>` at radius 4.5.
    expect(swatch.getAttribute("data-marker")).toBe("circle");
    expect(swatch.getAttribute("data-line")).toBe("false"); // Scatter => width 0
    expect(swatch.querySelector("polygon")).toBeNull();
    const glyph = swatch.querySelector("circle");
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("r")).toBe("2.5");
    expect(glyph?.getAttribute("fill")).toBe("#fff");
    expect(glyph?.getAttribute("stroke")).toBe("var(--series-1)");
  });

  // The legend's half of the differential OFF proof the review made for
  // `buildOpts` (288 combinations) and `buildFigureSpecFromDocument` (16): with no
  // cycle, PlotLegend's `resolveSeriesStyle` call must be the identity, so the
  // swatch it renders has to be the SAME DOM as handing `LegendSample` the raw
  // stored style directly — which is exactly the call this component made before
  // the cycle existed. 32 style x trace combinations, compared as markup.
  //
  // It proves the CYCLE ARGUMENT is inert with no positions. It does NOT prove
  // the swatch is unchanged from before the feature: both sides of the
  // comparison are the post-`markerDecision` `LegendSample`. The one case where
  // those two claims come apart is frozen in the test above.
  it("OFF is byte-identical: the swatch equals LegendSample on the RAW style", () => {
    const traces = ["Line", "Line + markers", "Scatter", "Step"] as const;
    const styles: (SeriesStyle | undefined)[] = [
      undefined,
      {},
      { line: "dashed" },
      { line: "dotted", width: 3 },
      { marker: true },
      { marker: true, markerShape: "star", markerSize: 11 },
      // marker:false with a stored shape/size — reachable from SeriesStyleCard
      // when "Markers" is unticked, and the shape of the pref-OFF regression the
      // first review found on the canvas.
      { marker: false, markerShape: "diamond", markerSize: 9 },
      { width: 0, color: "--series-4" },
    ];
    let compared = 0;
    for (const defaultTrace of traces) {
      for (const style of styles) {
        const swatch = render(
          <PlotLegend
            series={[{ label: "A", unit: "" }]}
            plotted={[0]}
            styleList={[style]}
            defaultTrace={defaultTrace}
            seriesCycle={null}
          />,
        );
        const withCycleArg = samples(swatch.container)[0].outerHTML;
        swatch.unmount();
        // The pre-feature call: the raw style, and the swatch colour PlotLegend
        // derives for display position 0 (a token override passes through as
        // `var(--token)`; no override is the palette slot).
        const before = render(
          <LegendSample
            color={style?.color ? `var(${style.color})` : "var(--series-1)"}
            style={style}
            defaultTrace={defaultTrace}
          />,
        );
        const raw = (before.container.querySelector(".qzk-legend-sample") as SVGElement).outerHTML;
        before.unmount();
        expect(withCycleArg).toBe(raw);
        compared += 1;
      }
    }
    expect(compared).toBe(traces.length * styles.length);
  });
});

describe("PlotLegend greyed excluded rows (audit item 1)", () => {
  // `maskExcludedPayload` grey mode appends one muted "(excluded)" companion
  // per series. The canvas draws it as dim-ink hollow markers and the export
  // as a grey, line-free marker entry (`EXCLUDED_GHOST_STYLE`), so its legend
  // row must be a grey marker too, never the next palette colour.
  const withGhosts: PlotSeriesSpec[] = [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
    { label: "A (excluded)", unit: "", kind: "points", muted: true },
    { label: "B (excluded)", unit: "", kind: "points", muted: true },
  ];

  it("draws each excluded companion as a grey marker, not a palette colour", () => {
    const { container } = render(
      <PlotLegend series={withGhosts} plotted={[0, 1]} hidden={[false, false, false, false]} isDarkBg />,
    );
    const rows = [...container.querySelectorAll(".qzk-legend .it")];
    expect(rows.map((r) => r.textContent)).toEqual(["A▲▼", "B▲▼", "A (excluded)", "B (excluded)"]);
    for (const row of rows.slice(2)) {
      const sample = row.querySelector(".qzk-legend-sample")!;
      expect(sample).toHaveAttribute("data-line", "false");
      expect(sample.querySelector("circle")).toHaveAttribute("stroke", "var(--ink-dim-on-dark)");
      expect(sample.outerHTML).not.toMatch(/--series-/);
    }
  });

  it("follows the plot background's dim ink on a light canvas", () => {
    const { container } = render(<PlotLegend series={withGhosts} plotted={[0, 1]} isDarkBg={false} />);
    const ghost = container.querySelectorAll(".qzk-legend .it")[2];
    expect(ghost.querySelector("circle")).toHaveAttribute("stroke", "var(--ink-dim-on-light)");
  });
});

describe("PlotLegend selected-row highlight companions (audit follow-up)", () => {
  // `highlightSelectedPayload` appends one "(selected)" companion per series.
  // The canvas draws it as accent-filled 7px markers with no line
  // (`buildOpts`' `s.selected` branch), so its legend row must match, never
  // take the next palette colour.
  const withSelected: PlotSeriesSpec[] = [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
    { label: "A (selected)", unit: "", kind: "points", selected: true },
    { label: "B (selected)", unit: "", kind: "points", selected: true },
  ];

  it.each([true, false])("draws each selected companion as a filled accent circle (dark bg: %s)", (isDarkBg) => {
    const { container } = render(<PlotLegend series={withSelected} plotted={[0, 1]} isDarkBg={isDarkBg} />);
    const rows = [...container.querySelectorAll(".qzk-legend .it")];
    expect(rows.map((r) => r.textContent)).toEqual(["A▲▼", "B▲▼", "A (selected)", "B (selected)"]);
    for (const row of rows.slice(2)) {
      const sample = row.querySelector(".qzk-legend-sample")!;
      expect(sample).toHaveAttribute("data-line", "false");
      expect(sample).toHaveAttribute("data-marker", "circle");
      const dot = sample.querySelector("circle")!;
      expect(dot).toHaveAttribute("stroke", "var(--accent)");
      expect(dot).toHaveAttribute("fill", "var(--accent)");
      expect(sample.outerHTML).not.toMatch(/--series-/);
    }
  });
});
