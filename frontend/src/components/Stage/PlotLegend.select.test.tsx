// UX-A (M3): with the Pointer tool a legend row click SELECTS its curve and
// must not also hide it; visibility is the swatch's own toggle, or Alt+click
// on the row. Other tools keep the old click-to-toggle row.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlotSeriesSpec } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";
import PlotLegend from "./PlotLegend";

const series: PlotSeriesSpec[] = [
  { label: "Alpha", unit: "" },
  { label: "Beta", unit: "" },
];

beforeEach(() => {
  useApp.setState({ hiddenChannels: [], seriesLabels: {}, legendPos: "ne", legendStatic: false, plotTool: "pointer" });
});

const legend = () => render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
const row = (name: string) => screen.getByText(name).closest(".it") as HTMLElement;

describe("legend rows with the Pointer tool", () => {
  it("a row click leaves visibility alone and names its curve for selection", () => {
    legend();
    fireEvent.click(row("Alpha"));
    expect(useApp.getState().hiddenChannels).toEqual([]);
    expect(row("Beta").dataset.channel).toBe("1");
  });

  it("the swatch toggle hides the curve", () => {
    legend();
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(useApp.getState().hiddenChannels).toEqual([0]);
  });

  it("Alt+click on a row hides the curve", () => {
    legend();
    fireEvent.click(row("Beta"), { altKey: true });
    expect(useApp.getState().hiddenChannels).toEqual([1]);
  });

  it("another tool keeps the row's click-to-toggle", () => {
    useApp.setState({ plotTool: "zoom" });
    legend();
    fireEvent.click(row("Alpha"));
    expect(useApp.getState().hiddenChannels).toEqual([0]);
  });
});
