// Plot audit round 2: a new plot's legend is "auto" — inside the frame in the
// least-occupied corner (lib/legendAutoPlace), or, past the palette's eight
// shown series, a column outside the frame's right edge (the export's
// "outside right"). Hidden series do not count: the export does not draw them.
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { legendPosToLoc } from "../../lib/figureOverrides";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import { defaultPlotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import PlotLegend from "./PlotLegend";

const many = (n: number): PlotSeriesSpec[] => Array.from({ length: n }, (_, i) => ({ label: `s${i}`, unit: "" }));
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

beforeEach(() => {
  useApp.setState({
    hiddenChannels: [],
    seriesLabels: {},
    legendPos: defaultPlotView().legendPos,
    legendXY: null,
    legendSize: null,
    legendFrameXY: null,
    legendStatic: false,
    legendTitle: null,
  });
});

const box = (n: number, hidden: number[] = []) => {
  useApp.setState({ hiddenChannels: hidden });
  const { container } = render(
    <PlotLegend series={many(n)} plotted={range(n)} hidden={range(n).map((i) => hidden.includes(i))} />,
  );
  return container.querySelector(".qzk-legend")!;
};

describe("auto legend", () => {
  it("is the default for a new view, and exports as matplotlib's own auto rule", () => {
    expect(defaultPlotView().legendPos).toBe("auto");
    expect(legendPosToLoc("auto")).toBe("auto");
  });

  it("stays inside the frame for up to eight shown series", () => {
    expect(box(8).className).toMatch(/\bauto\b/);
  });

  it("moves outside the frame past eight shown series", () => {
    expect(box(9).className).toMatch(/\bout\b/);
  });

  it("does not count hidden series", () => {
    expect(box(10, [0, 1]).className).toMatch(/\bauto\b/);
  });

  it("leaves an explicit corner alone", () => {
    useApp.setState({ legendPos: "ne" });
    const { container } = render(<PlotLegend series={many(12)} plotted={range(12)} />);
    expect(container.querySelector(".qzk-legend")!.className).toMatch(/\bne\b/);
  });

  // Plot audit round 3: the corner is chosen after a DRAW, so switching to
  // auto with nothing redrawing kept whatever corner was current, possibly
  // over the data. The legend now asks the plot to place it on the switch.
  it("asks its plot to place it when the position changes, with no redraw", () => {
    useApp.setState({ legendPos: "sw" });
    const stage = document.body.appendChild(document.createElement("div"));
    Object.assign(stage, { qzPlace: () => (stage.dataset.lc = stage.querySelector(".auto") ? "nw" : "") });
    render(<PlotLegend series={many(2)} plotted={range(2)} />, { container: stage });
    act(() => useApp.getState().setLegendPos("auto"));
    expect(stage.dataset.lc).toBe("nw");
  });
});
