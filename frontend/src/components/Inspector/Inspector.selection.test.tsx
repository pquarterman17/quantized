// UX-A: the Inspector follows the context and the selection — the selected
// object's card comes first, opened; cards that don't apply are not shown;
// an empty project shows a hint; cards the user opens are remembered per
// context; and every selection can be made and cleared from the keyboard.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";
import { useFigureDialog } from "../../store/figureDialogs";
import { INSPECTOR_CARDS_KEY, loadOpenCards, useInspectorCards } from "../../store/inspectorCards";
import { usePlotSelection, type PlotSelection } from "../../store/plotSelection";
import { useApp } from "../../store/useApp";
import Inspector from "./Inspector";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[10, 1], [20, 2], [30, 3]],
  labels: ["Moment", "Field"],
  units: ["emu", "Oe"],
  metadata: { sample: "A" },
};

beforeEach(() => {
  localStorage.removeItem(INSPECTOR_CARDS_KEY);
  useInspectorCards.setState({ open: {} });
  usePlotSelection.setState({ sel: null });
  useFigureDialog.setState({ open: null });
  useApp.setState({
    datasets: [{ id: "d1", name: "sample", data }],
    activeId: "d1",
    folders: [],
    stageTab: "plot",
    yKeys: [0, 1],
    showLegend: true,
    annotations: [{ id: "a1", x: 1, y: 1, text: "peak" }] as never,
    shapes: [],
    selectedAnnotationId: null,
    selectedShapeId: null,
  });
});

const cardTitles = () =>
  [...document.querySelectorAll<HTMLDetailsElement>(".qzk-inspector > details.qz-card")].map(
    (d) => d.querySelector(".qz-card-heading")?.textContent,
  );
const card = (title: string) =>
  document.querySelector<HTMLDetailsElement>(`.qzk-inspector > details.qz-card[data-card-id="${title}"]`);
const select = (sel: PlotSelection | null) => act(() => usePlotSelection.setState({ sel }));

describe("selection-driven Inspector", () => {
  it("a selected curve puts its style first, opened at that curve", () => {
    render(<Inspector />);
    expect(card("Series style")?.open).toBe(false);
    select({ kind: "series", channel: 1 });
    expect(screen.getByRole("region", { name: "Selection" })).toHaveTextContent("Curve: Field");
    expect(cardTitles()[0]).toBe("Series style");
    expect(card("Series style")?.open).toBe(true);
    const row = document.getElementById("series-style-1") as HTMLDetailsElement;
    expect(row.open).toBe(true);
    expect((document.getElementById("series-style-0") as HTMLDetailsElement).open).toBe(false);
    // Two clicks from the plot to a new colour: the swatches are already shown.
    fireEvent.click(within(row).getByTitle("Series 4"));
    expect(useApp.getState().seriesStyles[1]?.color).toBe("--series-4");
  });

  it("a new selection scrolls the Inspector back to the Selection section, then to the curve's row", () => {
    const scroll = vi.fn();
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
    const before = proto.scrollIntoView;
    proto.scrollIntoView = function (this: HTMLElement) {
      scroll(this.id || this.getAttribute("data-card-id"));
    };
    try {
      render(<Inspector />);
      const aside = document.querySelector<HTMLElement>(".qzk-inspector")!;
      // jsdom has no layout, so give the panel a writable scroll offset.
      Object.defineProperty(aside, "scrollTop", { value: 300, writable: true });
      select({ kind: "series", channel: 1 });
      expect(aside.scrollTop).toBe(0);
      expect(scroll).toHaveBeenLastCalledWith("series-style-1");
    } finally {
      proto.scrollIntoView = before;
    }
  });

  it("a selected axis puts the Axes card first and offers its full settings", () => {
    render(<Inspector />);
    select({ kind: "axis", axis: "y" });
    expect(cardTitles()[0]).toBe("Axes");
    expect(card("Axes")?.open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Y axis settings…" }));
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y" });
  });

  it("a selected legend shows its controls in the Selection section", () => {
    render(<Inspector />);
    select({ kind: "legend" });
    const section = screen.getByRole("region", { name: "Selection" });
    fireEvent.change(within(section).getByRole("combobox", { name: "Legend position" }), { target: { value: "sw" } });
    expect(useApp.getState().legendPos).toBe("sw");
  });

  it("a selected annotation opens the Annotations card first and drops a plot selection", () => {
    render(<Inspector />);
    select({ kind: "series", channel: 0 });
    act(() => useApp.setState({ selectedAnnotationId: "a1" }));
    expect(usePlotSelection.getState().sel).toBeNull();
    expect(cardTitles()[0]).toBe("Annotations");
    expect(card("Annotations")?.open).toBe(true);
    expect(screen.getByRole("region", { name: "Selection" })).toHaveTextContent("Annotation “peak”");
  });

  it("the user can collapse the card the selection opened", () => {
    render(<Inspector />);
    select({ kind: "axis", axis: "x" });
    const axes = card("Axes")!;
    act(() => {
      axes.open = false;
      fireEvent(axes, new Event("toggle"));
    });
    expect(card("Axes")?.open).toBe(false);
  });

  it("selects and clears from the keyboard", () => {
    render(<Inspector />);
    const picker = screen.getByRole("combobox", { name: "Select plot object" });
    fireEvent.change(picker, { target: { value: "series:0" } });
    expect(usePlotSelection.getState().sel).toEqual({ kind: "series", channel: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(usePlotSelection.getState().sel).toBeNull();
    expect(screen.getByRole("region", { name: "Selection" })).toHaveTextContent(/Click a curve, axis or legend/);
  });
});

describe("contextual cards", () => {
  it("the Worksheet tab lists only the data cards", () => {
    useApp.setState({ stageTab: "worksheet" });
    render(<Inspector />);
    const titles = cardTitles();
    expect(titles).toEqual(expect.arrayContaining(["Notes", "Channels", "Channel statistics", "Metadata"]));
    for (const plotOnly of ["Reference lines", "Region shades", "Shapes", "Series style", "Axes", "Annotations"])
      expect(titles).not.toContain(plotOnly);
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  });

  it("an empty project shows a hint and no cards", () => {
    useApp.setState({ datasets: [], activeId: null });
    render(<Inspector />);
    expect(screen.getByRole("region", { name: "Nothing to inspect" })).toBeInTheDocument();
    expect(document.querySelectorAll(".qz-card")).toHaveLength(0);
  });

  it("remembers the cards the user opened, per context and across reloads", () => {
    const view = render(<Inspector />);
    const notes = card("Notes")!;
    act(() => {
      notes.open = true;
      fireEvent(notes, new Event("toggle"));
    });
    expect(card("Notes")?.open).toBe(true);
    // Another context keeps its own set.
    act(() => useApp.setState({ stageTab: "worksheet" }));
    expect(card("Notes")?.open).toBe(false);
    act(() => useApp.setState({ stageTab: "plot" }));
    expect(card("Notes")?.open).toBe(true);
    // A reload reads it back.
    view.unmount();
    expect(loadOpenCards()).toEqual({ plot: { Notes: true } });
    useInspectorCards.setState({ open: loadOpenCards() });
    render(<Inspector />);
    expect(card("Notes")?.open).toBe(true);
  });
});
