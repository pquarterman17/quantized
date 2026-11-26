// The chip part of the curve-measurement gadget kinds: second-curve picker and readouts.

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntersectResult, StepTimeResult } from "../../lib/api/curveMeasure";
import { useApp } from "../../store/useApp";
import GadgetMeasureChip from "./GadgetMeasureChip";
import type { GadgetChipState } from "./useGadgetChip";

const inter = (n: number): IntersectResult => ({
  intersections: Array.from({ length: n }, (_, i) => ({ x: i + 0.5, y: 1, kind: "cross" as const, direction: "rising" as const, x_end: i + 0.5 })),
  x_min: 0, x_max: 9, n_grid: 10, dropped_a: 0, dropped_b: 0, merged_a: 0, merged_b: 0,
});
const STEP: StepTimeResult = {
  edge: "fall", time: 2, x_low: 1, x_high: 3, low_fraction: 0.1, high_fraction: 0.9, low_plateau: 0, high_plateau: 1,
  low_level: 0.1, high_level: 0.9, plateaus_estimated: [true, true], n_points: 8, dropped: 0, merged_duplicates: 0,
};
const chip = (over: Partial<GadgetChipState> = {}): GadgetChipState =>
  ({ mode: "intersect", busy: false, error: null, ...over }) as GadgetChipState;
const measured = (gadgetMeasure: NonNullable<ReturnType<typeof useApp.getState>["gadgetMeasure"]>) => useApp.setState({ gadgetMeasure });

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "a", name: "a", data: { time: [0, 1], values: [[0, 1, 2], [1, 2, 3]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} } }],
    activeId: "a", yKeys: null, xKey: null, hiddenChannels: [], seriesOrder: null,
    gadgetMeasure: null, gadgetCurveB: null,
  });
});

describe("GadgetMeasureChip", () => {
  it("renders nothing for the other modes", () => {
    const { container } = render(<GadgetMeasureChip gadget={chip({ mode: "fit" })} />);
    expect(container.textContent).toBe("");
  });

  it("intersect: lists the crossings, capped, with the second curve named; picker excludes curve A", () => {
    const setCurveB = vi.fn();
    useApp.setState({ setGadgetCurveB: setCurveB });
    measured({ mode: "intersect", r: inter(6), bKey: 1 });
    const { container, getByLabelText } = render(<GadgetMeasureChip gadget={chip()} />);
    expect(container.textContent).toContain("× B");
    expect(container.textContent).toContain("x=0.5");
    expect(container.textContent).toContain("+2 more");
    const select = getByLabelText("Second curve") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["next plotted curve", "B", "C"]);
    fireEvent.change(select, { target: { value: "2" } });
    expect(setCurveB).toHaveBeenCalledWith(2);
  });

  it("intersect: says when the curves do not meet, and hides a result while busy or failed", () => {
    measured({ mode: "intersect", r: inter(0), bKey: 1 });
    const none = chip();
    expect(render(<GadgetMeasureChip gadget={none} />).container.textContent).toContain("no intersection");
    expect(render(<GadgetMeasureChip gadget={{ ...none, busy: true }} />).container.textContent).not.toContain("no intersection");
    expect(render(<GadgetMeasureChip gadget={{ ...none, error: "x" }} />).container.textContent).not.toContain("no intersection");
  });

  it("rise time: names the edge and shows the time and the window it spans", () => {
    measured({ mode: "risetime", r: STEP });
    const { container } = render(<GadgetMeasureChip gadget={chip({ mode: "risetime" })} />);
    expect(container.textContent).toContain("fall time");
    expect(container.textContent).toContain("2");
    expect(container.querySelector("select")).toBeNull();
  });

  it("interpolate: one value per curve at each cursor, a dash outside the curve", () => {
    measured({ mode: "interpolate", at: [1, 9], rows: [{ yKey: 0, y: [1.5, null] }, { yKey: 2, y: [2, 3] }] });
    const { container } = render(<GadgetMeasureChip gadget={chip({ mode: "interpolate" })} />);
    expect(container.textContent).toContain("A: 1.5 | —");
    expect(container.textContent).toContain("C: 2 | 3");
  });
});
