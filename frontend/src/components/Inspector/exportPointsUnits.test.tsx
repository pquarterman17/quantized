// Widths and sizes reach the export as points (owner decision OG14), so every
// style control that sends one is labelled "pt" and says so in a one-sentence
// tooltip. Mounted through the real components, not a copy of their labels.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { PT_EXPORT_HINT } from "../../lib/exportPoints";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { openFigureDialog, useFigureDialog } from "../../store/figureDialogs";
import { useApp } from "../../store/useApp";
import FigureDialogs from "../overlays/figuredialogs/FigureDialogs";
import SeriesStyleCard from "./SeriesStyleCard";

const DS: Dataset = {
  id: "d1",
  name: "ds",
  data: { time: [0, 1, 2], values: [[1, 5], [2, 6], [3, 7]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};

const unitOf = (el: HTMLElement) => el.nextElementSibling?.textContent;

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    ...defaultPlotView(), datasets: [DS], activeId: "d1", history: [], future: [],
    seriesStyles: { 0: { marker: true } },
  });
});

describe("export point units", () => {
  it("the one-sentence hint states the contract", () => {
    expect(PT_EXPORT_HINT).toMatch(/points/);
    expect(PT_EXPORT_HINT).toMatch(/screen scale/);
    expect(PT_EXPORT_HINT.replace(/\.$/, "")).not.toMatch(/\. /);
  });

  it("the Inspector's series line width and marker size are in pt", () => {
    render(<SeriesStyleCard active={DS} />);
    const width = screen.getAllByLabelText("Line width")[0];
    expect(unitOf(width)).toBe("pt");
    expect(width.title).toBe(PT_EXPORT_HINT);
    const size = screen.getAllByTitle(PT_EXPORT_HINT).find((e) => e !== width && (e as HTMLInputElement).placeholder === "5");
    expect(size).toBeDefined();
    expect(unitOf(size as HTMLElement)).toBe("pt");
  });

  it("Plot Details line width, symbol size and error-bar width and cap are in pt", () => {
    openFigureDialog({ kind: "plotDetails", channel: 1 });
    render(<FigureDialogs />);
    const tabs: Record<string, string> = { "Line width": "Line", "Symbol size": "Symbol", "Error bar cap size": "Error bars", "Error bar line width": "Error bars" };
    for (const [name, tab] of Object.entries(tabs)) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(unitOf(screen.getByLabelText(name))).toBe("pt");
      if (name === "Line width" || name === "Symbol size") expect(screen.getByLabelText(name).title).toBe(PT_EXPORT_HINT);
    }
    expect(screen.getByLabelText("Error bar line width").title).toMatch(/points in the export/);
  });
});
