// PRIMARY_SOFTWARE_AUDIT_PLAN P3.3 residual: with the opt-in auto dash/marker
// cycle on, the curve menu's "Line style" and "Marker" submenus must check the
// DRAWN value (resolved by the same `resolveSeriesStyle` the canvas uses) and
// mark it "(auto)" — not the stored value, which reads "solid"/"circle" for an
// unstyled series. Picking an entry still stores an explicit style.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotContextMenu from "./PlotContextMenu";
import type { PlotPayload } from "../../lib/plotdata";
import type { SeriesStyle } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { PlotStageActions } from "./usePlotStageActions";

// Plot rect [100,100]→[500,400], identity scales: a click at (300,250) probes
// x-index 2 at y=150, which is display-series 1 (channel 1) here.
function fakePlot(): uPlot {
  return {
    over: {
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }),
    },
    data: [
      [0, 100, 200, 300, 400],
      [10, 20, 300, 40, 50],
      [10, 20, 150, 40, 50],
    ],
    series: [{}, { scale: "y" }, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

const payload = { series: [{ label: "A", unit: "" }, { label: "B", unit: "" }] } as unknown as PlotPayload;
const actions: PlotStageActions = {
  resetView: vi.fn(),
  smartScale: vi.fn(),
  savePng: vi.fn(),
  copyData: vi.fn(),
  copyFigure: vi.fn(),
  snapshot: vi.fn(),
};

beforeEach(() => {
  useApp.setState({
    seriesLabels: {},
    hiddenChannels: [],
    y2Keys: null,
    xKey: null,
    yKeys: null,
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

function open(autoSeriesStyles: boolean, styles: Record<number, SeriesStyle> = {}) {
  useApp.setState({ autoSeriesStyles, seriesStyles: styles });
  render(
    <PlotContextMenu
      x={300}
      y={250}
      plotRef={{ current: fakePlot() }}
      payload={payload}
      plotted={[0, 1]}
      hidden={[false, false]}
      actions={actions}
      onClose={vi.fn()}
    />,
  );
}

function submenu(name: string) {
  fireEvent.mouseEnter(screen.getByText(name).closest(".qzk-ctx-subwrap")!);
}
const checkedNames = () =>
  screen
    .getAllByRole("menuitemcheckbox")
    .filter((el) => el.getAttribute("aria-checked") === "true")
    .map((el) => el.textContent);

describe("PlotContextMenu — drawn style under the auto cycle (P3.3)", () => {
  it("Line style checks the cycled dash and marks it (auto)", () => {
    open(true);
    expect(screen.getByText("B")).toBeInTheDocument();
    submenu("Line style");
    const dashed = screen.getByRole("menuitemcheckbox", { name: /Dashed.*\(auto\)/ });
    expect(dashed).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: /^Solid/ })).toHaveAttribute("aria-checked", "false");
  });

  it("picking the auto entry still stores an explicit line style", () => {
    open(true);
    submenu("Line style");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Dashed.*\(auto\)/ }));
    expect(useApp.getState().seriesStyles[1]?.line).toBe("dashed");
  });

  it("a stored line wins and is not marked auto", () => {
    open(true, { 1: { line: "dotted" } });
    submenu("Line style");
    expect(screen.queryByText(/\(auto\)/)).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: /^Dotted/ })).toHaveAttribute("aria-checked", "true");
  });

  it("with the preference off the menu reads the stored value as before", () => {
    open(false);
    submenu("Line style");
    expect(screen.queryByText(/\(auto\)/)).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: /^Solid/ })).toHaveAttribute("aria-checked", "true");
  });

  it("Marker checks the cycled glyph for a series that draws markers", () => {
    open(true, { 1: { marker: true } });
    submenu("Marker");
    expect(screen.getByRole("menuitemcheckbox", { name: /square.*\(auto\)/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: /circle/ })).toHaveAttribute("aria-checked", "false");
  });

  it("a stored marker shape wins and is not marked auto", () => {
    open(true, { 1: { marker: true, markerShape: "star" } });
    submenu("Marker");
    expect(checkedNames().filter((n) => !/grid|legend/i.test(n ?? ""))).toEqual([expect.stringMatching(/asterisk/)]);
    expect(screen.queryByText(/\(auto\)/)).toBeNull();
  });
});
