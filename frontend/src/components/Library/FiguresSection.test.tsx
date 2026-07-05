import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import FiguresSection from "./FiguresSection";

const d1: Dataset = {
  id: "d1",
  name: "XRD:Book1",
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: { origin_book: "Book1" } },
};

beforeEach(() => {
  useApp.setState({
    datasets: [d1],
    activeId: null,
    originFigures: [],
    xLim: null,
    yLim: null,
    xLog: false,
    yLog: false,
  });
});

describe("FiguresSection", () => {
  it("renders nothing without any imported figures", () => {
    const { container } = render(<FiguresSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a resolved figure and applies its plot-state snapshot on click", () => {
    useApp.setState({
      originFigures: [
        {
          id: "fig-XRD-0",
          stem: "XRD",
          datasetId: "d1",
          siblingIds: ["d1"],
          figure: {
            name: "Graph1",
            x_from: 18,
            x_to: 100,
            x_log: false,
            y_from: 1,
            y_to: 1e6,
            y_log: true,
            n_curves: 3,
            annotations: ["Si (004)"],
          },
        },
      ],
    });
    render(<FiguresSection />);
    const item = screen.getByRole("button", { name: /Si \(004\)/ });
    expect(item).not.toBeDisabled();

    fireEvent.click(item);
    const s = useApp.getState();
    expect(s.activeId).toBe("d1");
    expect(s.xLim).toEqual([18, 100]);
    expect(s.yLim).toEqual([1, 1e6]);
    expect(s.xLog).toBe(false);
    expect(s.yLog).toBe(true);
  });

  it("disables a figure whose source hint never resolved, with the hint in its tooltip", () => {
    useApp.setState({
      originFigures: [
        {
          id: "fig-XRD-1",
          stem: "XRD",
          datasetId: null,
          siblingIds: [],
          figure: {
            name: "Graph2",
            x_from: 0,
            x_to: 1,
            x_log: false,
            y_from: 0,
            y_to: 1,
            y_log: false,
            n_curves: 1,
            annotations: [],
            source_hint: "Sheet9",
          },
        },
      ],
    });
    render(<FiguresSection />);
    const item = screen.getByRole("button", { name: /Graph2/ });
    expect(item).toBeDisabled();
    expect(item.title).toContain("Sheet9");
  });

  it("collapses/expands via the section header", () => {
    useApp.setState({
      originFigures: [
        {
          id: "fig-XRD-0",
          stem: "XRD",
          datasetId: "d1",
          siblingIds: ["d1"],
          figure: {
            name: "Graph1",
            x_from: 0,
            x_to: 1,
            x_log: false,
            y_from: 0,
            y_to: 1,
            y_log: false,
            n_curves: 1,
            annotations: [],
          },
        },
      ],
    });
    render(<FiguresSection />);
    expect(screen.getByRole("button", { name: /Graph1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Figures"));
    expect(screen.queryByRole("button", { name: /Graph1/ })).not.toBeInTheDocument();
  });
});
