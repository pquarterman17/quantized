// Acceptance pass 15 U1: an axis-break plot has no on-plot selection, but its curves are still plot objects:
// the Selection list names them, so "Use row states" can be changed after the break exists.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";
import { usePlotSelection } from "../../store/plotSelection";
import { useApp } from "../../store/useApp";
import Inspector from "./Inspector";

vi.mock("../../lib/objectEditorMode", () => ({ OBJECT_EDITOR: "panel", objectEditorIsPopup: () => false }));

function gapData(): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let i = 0; i <= 20; i++) { time.push(i); values.push([10 + i, 100 + i]); }
  for (let i = 0; i < 3; i++) { time.push(100 + i); values.push([300 + i, 400 + i]); }
  return { time, values, labels: ["Field", "Signal"], units: ["T", "au"], metadata: {} };
}

beforeEach(() => {
  usePlotSelection.setState({ sel: null, onCanvas: false });
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data: gapData() }], activeId: "d1", stageTab: "plot", xKey: null, yKeys: null,
    y2Keys: null, seriesOrder: null, hiddenChannels: [], stackMode: false, composition: null, facetKey: null,
    plotWindows: [], focusedWindowId: null, seriesStyles: {}, showLegend: true,
  });
});

describe("Selection list on an axis-break plot", () => {
  it("lists no curves without a break (no on-plot selection)", () => {
    render(<Inspector />);
    const picker = screen.getByRole("combobox", { name: "Select plot object" });
    expect(within(picker).getAllByRole("option")).toHaveLength(1);
  });

  it("lists the curves once the plot is broken, and Use row states can be set", () => {
    useApp.getState().breakAtGaps("d1", [[20, 100]]);
    render(<Inspector />);
    const picker = screen.getByRole("combobox", { name: "Select plot object" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Nothing selected", "Curve: Field", "Curve: Signal",
    ]);
    fireEvent.change(picker, { target: { value: "series:1" } });
    const row = document.getElementById("series-style-1") as HTMLElement;
    fireEvent.click(within(row).getByRole("checkbox", { name: "Use row states" }));
    expect(useApp.getState().seriesStyles[1]?.rowStates).toBe(true);
  });
});
