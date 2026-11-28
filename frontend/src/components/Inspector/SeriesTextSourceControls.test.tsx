import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LegendSample from "../Stage/LegendSample";
import { withMarkerTexts } from "../../lib/markerTextRows";
import { windowCyclesSeriesStyles } from "../../lib/seriesStyleCycle";
import type { Dataset, SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SeriesTextSourceControls from "./SeriesTextSourceControls";

const DATASET = {
  id: "d1", name: "d1",
  data: {
    time: [0, 1, 2], values: [[1, 0], [4, 1], [9, 0]], labels: ["y", "wafer"], units: ["", ""],
    metadata: { text_columns: { Tag: ["a", "b", "c"] } }, cat_levels: { 1: ["W1", "W2"] },
  },
} as unknown as Dataset;

beforeEach(() => { useApp.setState({ datasets: [DATASET], activeId: "d1" }); });

describe("Text from (a series' text symbol, plan item 24)", () => {
  it("offers letters, row numbers, each column and each text column, and writes the source", () => {
    const set = vi.fn();
    render(<SeriesTextSourceControls channel={0} style={{}} setSeriesStyle={set} />);
    const pick = screen.getByLabelText("Text symbol source");
    expect(screen.getByRole("option", { name: "wafer (text)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tag (text column)" })).toBeInTheDocument();
    for (const [value, want] of [["letters", "letters"], ["rows", "rows"], ["col:1", 1], ["text:Tag", { name: "Tag" }], ["", undefined]] as const) {
      fireEvent.change(pick, { target: { value } });
      expect(set).toHaveBeenLastCalledWith(0, { markerTextFrom: want }, "marker-text-from:0");
    }
  });

  it("shows the current source", () => {
    const { rerender } = render(<SeriesTextSourceControls channel={0} style={{ markerTextFrom: { name: "Tag" } }} setSeriesStyle={vi.fn()} />);
    expect(screen.getByLabelText("Text symbol source")).toHaveValue("text:Tag");
    rerender(<SeriesTextSourceControls channel={0} style={{ markerTextFrom: 1 }} setSeriesStyle={vi.fn()} />);
    expect(screen.getByLabelText("Text symbol source")).toHaveValue("col:1");
  });
});

describe("the legend swatch of a text symbol", () => {
  it("is the text, or the first character of per-point text, instead of a marker", () => {
    const { container, rerender } = render(<LegendSample color="#f00" style={{ markerText: "Fe" }} />);
    expect(container.querySelector("text")?.textContent).toBe("F");
    const derived = withMarkerTexts([{ markerTextFrom: "letters" } as SeriesStyle], [0], DATASET, [[0, 1, 2]])[0];
    rerender(<LegendSample color="#f00" style={derived} />);
    expect(container.querySelector("text")?.textContent).toBe("A");
    rerender(<LegendSample color="#f00" style={{ markerText: "Fe", bars: true }} />);
    expect(container.querySelector("text")).toBeNull();
    rerender(<LegendSample color="#f00" style={{ marker: true }} />);
    expect(container.querySelector("text")).toBeNull();
  });
});

describe("a facet grid that cannot draw text symbols says why (acceptance 8 U2)", () => {
  const NOTE = "Text symbols are not drawn on a facet grid that is split by a group or an encoding, or that greys excluded rows";
  it("shows the note only for a split or greyed grid, and only while a text source is chosen", () => {
    const chosen = { markerTextFrom: "rows" } as const;
    const OFF = { groupKey: null, facetKey: null, excludedDisplay: "hide" as const };
    const { rerender } = render(<SeriesTextSourceControls channel={0} style={chosen} setSeriesStyle={vi.fn()} />);
    expect(screen.queryByRole("note")).toBeNull(); // ungrouped: drawn
    for (const view of [{ groupKey: 1 }, { facetKey: 1 }]) {
      act(() => useApp.setState({ ...OFF, ...view }));
      expect(screen.queryByRole("note")).toBeNull(); // a group alone and a plain facet grid draw it
    }
    for (const view of [{ facetKey: 1, groupKey: 1 }, { facetKey: 1, excludedDisplay: "grey" as const }]) {
      act(() => useApp.setState({ ...OFF, ...view }));
      expect(screen.getByRole("note")).toHaveTextContent(NOTE);
      rerender(<SeriesTextSourceControls channel={0} style={{}} setSeriesStyle={vi.fn()} />);
      expect(screen.queryByRole("note")).toBeNull(); // "The text above" is not per-point text
      rerender(<SeriesTextSourceControls channel={0} style={chosen} setSeriesStyle={vi.fn()} />);
    }
    expect(screen.getByLabelText("Text symbol source")).toHaveValue("rows"); // the choice is kept
    act(() => useApp.setState(OFF));
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the refusal names the cause", () => {
  it("says split by a group, or greying excluded rows, for the grid in front of the user", () => {
    const chosen = { markerTextFrom: "letters" } as const;
    render(<SeriesTextSourceControls channel={0} style={chosen} setSeriesStyle={vi.fn()} />);
    act(() => useApp.setState({ groupKey: 1, facetKey: 1, excludedDisplay: "hide" }));
    expect(screen.getByRole("note")).toHaveTextContent("this grid is split by a group)");
    act(() => useApp.setState({ groupKey: null, facetKey: 1, excludedDisplay: "grey" }));
    expect(screen.getByRole("note")).toHaveTextContent("this grid is greying excluded rows)");
    act(() => useApp.setState({ groupKey: null, facetKey: null, excludedDisplay: "hide" }));
  });
});

describe("withMarkerTexts", () => {
  it("leaves a series whose rows are not the dataset's rows (or a whole number of blocks of them) alone", () => {
    const list = [{ markerTextFrom: "rows" } as SeriesStyle];
    expect(withMarkerTexts(list, [0], DATASET, [[0, 1]])).toBe(list);
    expect((withMarkerTexts(list, [0], DATASET, [[0, 1, 2, 3, 4, 5]])[0] as { markerTexts?: string[] }).markerTexts).toEqual(["1", "2", "3", "1", "2", "3"]); // a per-series-X view: the rows once per block
    expect(withMarkerTexts([{ color: "#000" }], [0], DATASET, [[0, 1, 2]])[0]).toEqual({ color: "#000" });
    const out = withMarkerTexts(list, [0], DATASET, [[0, 1, 2]])[0] as { markerTexts?: string[] };
    expect(out.markerTexts).toEqual(["1", "2", "3"]);
  });
});

describe("the subgroup size rides the cycle decision", () => {
  const view = { groupKey: null, facetKey: null, stackMode: false, polarMode: false, statMode: false, xKey: null, yKeys: null };
  it("a number is the size, true is none, and a refused view is off", () => {
    expect(windowCyclesSeriesStyles(3, view, undefined, 4)).toBe(3);
    expect(windowCyclesSeriesStyles(true, view, undefined, 4)).toBe(true);
    expect(windowCyclesSeriesStyles(false, view, undefined, 4)).toBe(false);
    expect(windowCyclesSeriesStyles(3, { ...view, facetKey: 1 }, undefined, 4)).toBe(false);
    expect(windowCyclesSeriesStyles(false, view, undefined, 9)).toBe(true); // past the palette, no size
  });
});
