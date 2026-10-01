// PRIMARY_SOFTWARE_AUDIT_PLAN P3.3 residual: with the opt-in auto dash/marker
// cycle on, the Inspector's Line picker and marker-shape picker must show the
// DRAWN value (the same `resolveSeriesStyle` the canvas uses), marked "(auto)",
// not the stored one. Choosing a value still stores an explicit style.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset, SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SeriesStyleCard from "./SeriesStyleCard";

const DS: Dataset = {
  id: "d1",
  name: "ds",
  data: {
    time: [0, 1],
    values: [
      [1, 2, 3],
      [4, 5, 6],
    ],
    labels: ["A", "B", "C"],
    units: ["", "", ""],
    metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    groupKey: null,
    facetKey: null,
    stackMode: false,
    polarMode: false,
    statMode: false,
    plotWindows: [],
    focusedWindowId: null,
    history: [],
    future: [],
  });
});

function renderCard(autoSeriesStyles: boolean, styles: Record<number, SeriesStyle> = {}) {
  useApp.setState({ autoSeriesStyles, seriesStyles: styles });
  return render(<SeriesStyleCard active={DS} />);
}

const row = (container: HTMLElement, ch: number) => container.querySelector(`#series-style-${ch}`) as HTMLElement;
const lineRadios = (el: HTMLElement) =>
  within(within(el).getByRole("radiogroup", { name: "Line style" })).getAllByRole("radio");
const checkedLine = (el: HTMLElement) => lineRadios(el).findIndex((r) => r.getAttribute("aria-checked") === "true");

describe("SeriesStyleCard — drawn style under the auto cycle (P3.3)", () => {
  it("the Line picker shows the cycled dash, marked auto", () => {
    const { container } = renderCard(true);
    // Display position 1 → dashed (index 1 of solid/dashed/dotted).
    expect(checkedLine(row(container, 1))).toBe(1);
    expect(within(row(container, 1)).getByText("Dashed (auto)")).toBeInTheDocument();
    expect(checkedLine(row(container, 2))).toBe(2);
    expect(within(row(container, 2)).getByText("Dotted (auto)")).toBeInTheDocument();
  });

  it("follows the canvas' display order (seriesOrder), not the channel index", () => {
    useApp.setState({ seriesOrder: [2, 0, 1] });
    const { container } = renderCard(true);
    expect(within(row(container, 2)).getByText("Solid (auto)")).toBeInTheDocument();
    expect(within(row(container, 1)).getByText("Dotted (auto)")).toBeInTheDocument();
  });

  it("choosing the auto value stores it explicitly", () => {
    const { container } = renderCard(true);
    fireEvent.click(lineRadios(row(container, 1))[1]);
    expect(useApp.getState().seriesStyles[1]?.line).toBe("dashed");
    expect(within(row(container, 1)).queryByText(/\(auto\)/)).toBeNull();
  });

  it("with the preference off the picker shows the stored value, unmarked", () => {
    const { container } = renderCard(false);
    expect(checkedLine(row(container, 1))).toBe(0);
    expect(within(row(container, 1)).queryByText(/\(auto\)/)).toBeNull();
  });

  it("the marker-shape picker shows the cycled glyph, and picking it stores it", () => {
    const { container } = renderCard(true, { 1: { marker: true } });
    const select = within(row(container, 1)).getByTitle("Marker shape") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toMatch(/square \(auto\)/);
    fireEvent.change(select, { target: { value: "square" } });
    expect(useApp.getState().seriesStyles[1]?.markerShape).toBe("square");
  });

  it("an explicit marker shape wins and is not marked auto", () => {
    const { container } = renderCard(true, { 1: { marker: true, markerShape: "star" } });
    const select = within(row(container, 1)).getByTitle("Marker shape") as HTMLSelectElement;
    expect(select.value).toBe("star");
    expect(screen.queryByText(/\(auto\)$/, { selector: "option" })).toBeNull();
  });
});
