// In an x-break figure the marks are not drawn on screen or in the export (which
// warns): the Inspector says so, and the plot status does too when one is set.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let kind: string | null = "break";
vi.mock("../Stage/useEffectiveComposition", () => ({
  useEffectiveComposition: () => (kind ? { kind } : null),
}));

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SeriesMarkMapControls from "./SeriesMarkMapControls";

const dataset: Dataset = {
  id: "d",
  name: "s.xy",
  data: { time: [1, 2, 3], values: [[1, 0], [2, 1], [3, 2]], labels: ["M", "mass"], units: ["", ""], metadata: {} },
};

function Host() {
  const style = useApp((s) => s.seriesStyles[0]) ?? {};
  const set = useApp((s) => s.setSeriesStyle);
  return <SeriesMarkMapControls channel={0} style={style} setSeriesStyle={set} />;
}

beforeEach(() => {
  kind = "break";
  useApp.setState({ datasets: [dataset], activeId: "d", xKey: null, seriesStyles: {}, status: "" });
});

describe("marks in an x-break figure", () => {
  it("says they are not drawn there, in the card and in the plot status", () => {
    render(<Host />);
    expect(screen.queryByText(/x-break/)).toBeNull(); // nothing asked for yet: no notice
    fireEvent.change(screen.getByRole("combobox", { name: "Line connect" }), { target: { value: "spline" } });
    expect(screen.getByRole("status").textContent).toMatch(/x-break panels.*ordinary line/);
    expect(useApp.getState().status).toMatch(/x-break/);
  });

  it("says nothing in an ordinary plot", () => {
    kind = null;
    render(<Host />);
    fireEvent.change(screen.getByRole("combobox", { name: "Drop lines" }), { target: { value: "x" } });
    expect(screen.queryByRole("status")).toBeNull();
    expect(useApp.getState().status).toBe("");
  });

  it("facet grids draw none of the marks (card and status say so)", () => {
    kind = "facet";
    render(<Host />);
    fireEvent.change(screen.getByRole("combobox", { name: "Drop lines" }), { target: { value: "x" } });
    expect(screen.getByRole("status").textContent).toMatch(/facet grids/);
    expect(useApp.getState().status).toMatch(/facet grids/);
  });

  it("multi-panel cells draw spline and drop lines but not size-by", () => {
    kind = "spatial";
    render(<Host />);
    fireEvent.change(screen.getByRole("combobox", { name: "Drop lines" }), { target: { value: "x" } });
    expect(screen.queryByRole("status")).toBeNull(); // drop lines are drawn there
    fireEvent.click(screen.getByRole("checkbox", { name: /Size by/ }));
    expect(screen.getByRole("status").textContent).toMatch(/multi-panel cells/);
    expect(useApp.getState().status).toMatch(/multi-panel cells/);
  });
});
