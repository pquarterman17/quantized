// N5 / N6 Inspector controls: size-by, drop lines, spline connect + its notice.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SeriesMarkMapControls from "./SeriesMarkMapControls";

const mk = (time: number[]): Dataset => ({
  id: "d",
  name: "s.xy",
  data: {
    time,
    values: time.map((t, i) => [t * 2, i]),
    labels: ["M", "mass"],
    units: ["emu", "g"],
    metadata: {},
  },
});

function Host({ channel = 0 }: { channel?: number }) {
  const style = useApp((s) => s.seriesStyles[channel]) ?? {};
  const set = useApp((s) => s.setSeriesStyle);
  return <SeriesMarkMapControls channel={channel} style={style} setSeriesStyle={set} />;
}

beforeEach(() => {
  useApp.setState({ datasets: [mk([1, 2, 3, 4])], activeId: "d", xKey: null, seriesStyles: {} });
});

describe("SeriesMarkMapControls", () => {
  it("Size by picks a channel and a px range", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Size by/ }));
    expect(useApp.getState().seriesStyles[0]?.sizeBy).toBe(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Largest marker size" }), { target: { value: "20" } });
    expect(useApp.getState().seriesStyles[0]?.sizeRange).toEqual([3, 20]);
    fireEvent.change(screen.getByRole("textbox", { name: "Smallest marker size" }), { target: { value: "30" } });
    expect(useApp.getState().seriesStyles[0]?.sizeRange).toEqual([3, 20]); // min > max is refused
    fireEvent.click(screen.getByRole("checkbox", { name: /Size by/ }));
    expect(useApp.getState().seriesStyles[0]?.sizeBy).toBeUndefined();
  });

  it("sets and clears drop lines and the spline connect", () => {
    render(<Host />);
    fireEvent.change(screen.getByRole("combobox", { name: "Drop lines" }), { target: { value: "both" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Line connect" }), { target: { value: "spline" } });
    expect(useApp.getState().seriesStyles[0]).toMatchObject({ dropLines: "both", connect: "spline" });
    expect(screen.queryByRole("status")).toBeNull(); // ascending X: no notice
    fireEvent.change(screen.getByRole("combobox", { name: "Drop lines" }), { target: { value: "none" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Line connect" }), { target: { value: "straight" } });
    expect(useApp.getState().seriesStyles[0]?.dropLines).toBeUndefined();
    expect(useApp.getState().seriesStyles[0]?.connect).toBeUndefined();
  });

  it("says so when a spline falls back to straight segments (a hysteresis loop)", () => {
    useApp.setState({ datasets: [mk([0, 1, 2, 1, 0])] });
    render(<Host />);
    fireEvent.change(screen.getByRole("combobox", { name: "Line connect" }), { target: { value: "spline" } });
    expect(screen.getByRole("status").textContent).toMatch(/straight segments in row order/);
  });
});
