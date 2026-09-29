// Perf audit 2026-09-29: the custom `<input type=color>` fires `onChange` on
// every step of a picker drag. Each event used to push its own "style curve"
// undo entry, so one drag could flood the 50-entry history and evict every
// real edit before it. One drag must be ONE undo entry, and undo must restore
// the colour from before the drag.

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SeriesStyleCard from "./SeriesStyleCard";

const DS: Dataset = {
  id: "d1",
  name: "ds",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};

function colorInput(container: HTMLElement, channel: number): HTMLInputElement {
  return container.querySelector(`#series-style-${channel} input[type="color"]`) as HTMLInputElement;
}

function drag(input: HTMLInputElement, colors: string[]) {
  fireEvent.pointerDown(input);
  for (const c of colors) fireEvent.change(input, { target: { value: c } });
}

beforeEach(() => {
  useApp.setState({ seriesStyles: { 0: { color: "#000000" } }, history: [], future: [] });
});

describe("SeriesStyleCard — custom colour picker history", () => {
  it("one picker drag records ONE undo entry, and undo restores the pre-drag colour", () => {
    const { container } = render(<SeriesStyleCard active={DS} />);
    drag(colorInput(container, 0), ["#110000", "#220000", "#330000", "#440000", "#550000"]);
    expect(useApp.getState().seriesStyles[0]?.color).toBe("#550000");
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().seriesStyles[0]?.color).toBe("#000000");
  });

  it("a second drag on the same channel is its own undo step", () => {
    const { container } = render(<SeriesStyleCard active={DS} />);
    drag(colorInput(container, 0), ["#110000", "#220000"]);
    drag(colorInput(container, 0), ["#003300", "#004400"]);
    expect(useApp.getState().history).toHaveLength(2);
    useApp.getState().undo();
    expect(useApp.getState().seriesStyles[0]?.color).toBe("#220000");
  });

  it("drags on two different channels never fold together", () => {
    const { container } = render(<SeriesStyleCard active={DS} />);
    fireEvent.change(colorInput(container, 0), { target: { value: "#110000" } });
    fireEvent.change(colorInput(container, 1), { target: { value: "#001100" } });
    expect(useApp.getState().history).toHaveLength(2);
  });

  it("a palette click after a drag is a separate entry", () => {
    const { container } = render(<SeriesStyleCard active={DS} />);
    drag(colorInput(container, 0), ["#110000", "#220000"]);
    const swatch = container.querySelector('#series-style-0 button[title="Series 3"]') as HTMLButtonElement;
    fireEvent.click(swatch);
    expect(useApp.getState().history).toHaveLength(2);
    useApp.getState().undo();
    expect(useApp.getState().seriesStyles[0]?.color).toBe("#220000");
  });
});
