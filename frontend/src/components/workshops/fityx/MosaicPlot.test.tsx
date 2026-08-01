import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MosaicPlot from "./MosaicPlot";

describe("MosaicPlot (JMP_GAP_PLAN J3 residual)", () => {
  it("renders an svg with one rect per (row, col) cell", () => {
    const { container } = render(
      <MosaicPlot rowLabels={["A", "B"]} colLabels={["yes", "no"]} table={[[3, 1], [2, 4]]} />,
    );
    expect(screen.getByLabelText("mosaic plot")).toBeInTheDocument();
    expect(container.querySelectorAll("rect")).toHaveLength(4);
  });

  it("column width is proportional to that X-level's share of N", () => {
    // Row A totals 4, row B totals 6 -- A's columns should be 40% as wide
    // as the plot's inner width, B's 60%.
    const { container } = render(
      <MosaicPlot rowLabels={["A", "B"]} colLabels={["yes", "no"]} table={[[3, 1], [2, 4]]} />,
    );
    const rects = Array.from(container.querySelectorAll("rect"));
    const aWidth = Number(rects[0].getAttribute("width"));
    const bWidth = Number(rects[2].getAttribute("width"));
    expect(aWidth).toBeGreaterThan(0);
    expect(bWidth).toBeGreaterThan(aWidth); // B has more N than A
    expect(bWidth / aWidth).toBeCloseTo(6 / 4, 1);
  });

  it("segment height within a column is proportional to the CONDITIONAL distribution of Y given X", () => {
    // Row A: yes=3, no=1 -- yes should be 3x the height of no within A's column.
    const { container } = render(
      <MosaicPlot rowLabels={["A", "B"]} colLabels={["yes", "no"]} table={[[3, 1], [2, 4]]} />,
    );
    const rects = Array.from(container.querySelectorAll("rect"));
    const aYesHeight = Number(rects[0].getAttribute("height"));
    const aNoHeight = Number(rects[1].getAttribute("height"));
    expect(aYesHeight / aNoHeight).toBeCloseTo(3, 0);
  });

  it("renders nothing for an all-zero table (grand total 0)", () => {
    const { container } = render(
      <MosaicPlot rowLabels={["A", "B"]} colLabels={["yes", "no"]} table={[[0, 0], [0, 0]]} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a legend swatch per Y level", () => {
    render(<MosaicPlot rowLabels={["A", "B"]} colLabels={["yes", "no", "maybe"]} table={[[1, 1, 1], [1, 1, 1]]} />);
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
    expect(screen.getByText("maybe")).toBeInTheDocument();
  });
});
