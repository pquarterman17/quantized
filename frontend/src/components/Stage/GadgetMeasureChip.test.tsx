// The chip part of the curve-measurement gadget kinds: second-curve picker and readouts.

import { fireEvent, render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { IntersectResult, StepTimeResult } from "../../lib/api/curveMeasure";
import { loadGadgetPlugins } from "../../lib/axisExtrasHook";
import { useGadgetMeasureOptions } from "../../store/gadgetMeasureOptions";
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
const SOURCE = { id: "a", computedOn: "fp", roi: [0, 9] as [number, number], a: { yKey: 0, xKey: null }, b: null, bSheet: null, rows: { first: 1, last: 2, n: 2 } };
type Measure = NonNullable<ReturnType<typeof useApp.getState>["gadgetMeasure"]>;
// The stamp every computed measurement carries (units and the source it was computed on).
const measured = (m: Record<string, unknown>, units = { x: "", y: "", yB: "" }) => useApp.setState({ gadgetMeasure: (m.mode === "interpolate" ? m : { units, source: SOURCE, ...m }) as Measure });

beforeAll(loadGadgetPlugins); // the chunk the plot loads, which knows why markers hide

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "a", name: "a", data: { time: [0, 1], values: [[0, 1, 2], [1, 2, 3]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} } }],
    activeId: "a", yKeys: null, xKey: null, hiddenChannels: [], seriesOrder: null, exchangeXY: false, seriesStyles: {}, waterfall: 0, waterfallDx: 0,
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

  it("says why the plot shows no rings when the view is turned or a waterfall lifts the curve", () => {
    measured({ mode: "risetime", r: STEP }); // curve A = channel 0, the first plotted
    const text = () => render(<GadgetMeasureChip gadget={chip({ mode: "risetime" })} />).container.textContent;
    expect(text()).not.toContain("markers hidden");
    useApp.setState({ exchangeXY: true });
    expect(text()).toContain("markers hidden: the plot is turned");
    useApp.setState({ exchangeXY: false, waterfall: 0.5, yKeys: [1, 0] });
    measured({ mode: "risetime", r: STEP }); // A = channel 0 is now the second drawn curve
    expect(text()).toContain("markers hidden: the waterfall lifts that curve");
  });

  it("rise time: names the edge and shows the time and the window it spans", () => {
    measured({ mode: "risetime", r: STEP });
    const { container } = render(<GadgetMeasureChip gadget={chip({ mode: "risetime" })} />);
    expect(container.textContent).toContain("fall time");
    expect(container.textContent).toContain("2");
    // Opt-in settings only: nothing is changed by merely showing them.
    expect((container.querySelector("select[aria-label='Rise time percentages']") as HTMLSelectElement).value).toBe("10-90");
  });

  it("shows the units of the columns measured, beside the numbers", () => {
    measured({ mode: "risetime", r: STEP }, { x: "ns", y: "V", yB: "" });
    const rise = render(<GadgetMeasureChip gadget={chip({ mode: "risetime" })} />).container.textContent;
    expect(rise).toContain("2 ns");
    expect(rise).toContain("0.1 V → 0.9 V");
    measured({ mode: "intersect", r: inter(1), bKey: 1 }, { x: "K", y: "emu", yB: "emu" });
    expect(render(<GadgetMeasureChip gadget={chip()} />).container.textContent).toContain("x=0.5 K y=1 emu");
  });

  it("level crossings: the level used (named when it is the mid-range), the crossings with their direction, and the settings", () => {
    const r = { level: 1.5, hysteresis: 0, crossings: [{ x: 1.25, direction: "rising" as const }, { x: 3.75, direction: "falling" as const }], n_points: 5, dropped: 0, merged_duplicates: 0 };
    measured({ mode: "levelcrossing", r, auto: true }, { x: "s", y: "V", yB: "" });
    const { container, getByLabelText } = render(<GadgetMeasureChip gadget={chip({ mode: "levelcrossing" })} />);
    expect(container.textContent).toContain("level (mid-range)1.5 V");
    expect(container.textContent).toContain("↑ x=1.25 s");
    expect(container.textContent).toContain("↓ x=3.75 s");
    expect((getByLabelText("Y level") as HTMLInputElement).placeholder).toMatch(/mid-range/);
  });

  it("Commit and Report are offered when something was found, and not while busy or when nothing was", () => {
    measured({ mode: "intersect", r: inter(2), bKey: 1 });
    const enabled = (g: GadgetChipState, name: RegExp) => {
      const { getByText, unmount } = render(<GadgetMeasureChip gadget={g} />);
      const disabled = (getByText(name) as HTMLButtonElement).disabled;
      unmount();
      return !disabled;
    };
    expect(enabled(chip(), /Commit/)).toBe(true);
    expect(enabled(chip(), /Report/)).toBe(true);
    expect(enabled(chip({ busy: true }), /Commit/)).toBe(false);
    measured({ mode: "intersect", r: inter(0), bKey: 1 });
    expect(enabled(chip(), /Commit/)).toBe(false);
    measured({ mode: "interpolate", at: [0, 1], rows: [] });
    expect(render(<GadgetMeasureChip gadget={chip({ mode: "interpolate" })} />).queryByText(/Commit/)).toBeNull();
  });

  it("changing a setting re-arms the region so the shown result is dropped and measured again", () => {
    const setRoi = vi.fn();
    useApp.setState({ qfitRoi: [0, 5], setQfitRoi: setRoi });
    const { getByLabelText } = render(<GadgetMeasureChip gadget={chip({ mode: "risetime" })} />);
    fireEvent.change(getByLabelText("Rise time percentages"), { target: { value: "20-80" } });
    expect(setRoi).toHaveBeenCalledWith([0, 5]);
  });

  it("interpolate: one value per curve at each cursor, a dash outside the curve", () => {
    measured({ mode: "interpolate", at: [1, 9], rows: [{ yKey: 0, y: [1.5, null] }, { yKey: 2, y: [2, 3] }] });
    const { container } = render(<GadgetMeasureChip gadget={chip({ mode: "interpolate" })} />);
    expect(container.textContent).toContain("A: y(1)=1.5 | y(9)=—");
    expect(container.textContent).toContain("C: y(1)=2 | y(9)=3");
  });

  describe("level crossings on a hysteresis loop", () => {
    const LEVEL = { level: 0, hysteresis: 0, crossings: [{ x: 1, direction: "rising" as const }], n_points: 8, dropped: 0, merged_duplicates: 0 };
    const POINTER = /Coercivity and remanence: Analyze › Spectroscopy & magnetometry › Hysteresis analysis/;
    /** Column A is the field swept 0 -> +5000 -> -5000 -> +5000; column B the moment on a tanh loop with Hc = 150. */
    const loopSheet = (hc: number) => {
      const field: number[] = [];
      for (let i = 0; i < 40; i++) field.push((5000 * i) / 39);
      for (let i = 0; i < 80; i++) field.push(5000 - (10000 * i) / 79);
      for (let i = 0; i < 80; i++) field.push(-5000 + (10000 * i) / 79);
      const rows = field.map((h, i) => [h, Math.tanh((h + (i >= 40 && i < 120 ? hc : -hc)) / 400)]);
      return { id: "a", name: "loop", data: { time: Array.from({ length: rows.length }, (_, i) => i), values: rows, labels: ["H", "M"], units: ["Oe", "emu"], metadata: {} } };
    };
    const showLevel = (sheet: ReturnType<typeof loopSheet>) => {
      useApp.setState({ datasets: [sheet], xKey: 0, yKeys: [1] });
      measured({ mode: "levelcrossing", r: LEVEL, auto: false, source: { ...SOURCE, a: { yKey: 1, xKey: 0 } } }, { x: "Oe", y: "emu", yB: "" });
      return render(<GadgetMeasureChip gadget={chip({ mode: "levelcrossing" })} />);
    };

    it("points at the Hysteresis tool, which the link opens", () => {
      useApp.setState({ hysteresisOpen: false });
      const { getByText } = showLevel(loopSheet(150));
      fireEvent.click(getByText(POINTER));
      expect(useApp.getState().hysteresisOpen).toBe(true);
    });

    it("sweep order is an opt-in setting that re-arms the region", () => {
      const setRoi = vi.fn();
      useApp.setState({ qfitRoi: [0, 5], setQfitRoi: setRoi });
      const { getByLabelText } = render(<GadgetMeasureChip gadget={chip({ mode: "levelcrossing" })} />);
      const box = getByLabelText(/sweep order/) as HTMLInputElement;
      expect(box.checked).toBe(false);
      fireEvent.click(box);
      expect(useGadgetMeasureOptions.getState().options.inOrder).toBe(true);
      expect(setRoi).toHaveBeenCalledWith([0, 5]);
      useGadgetMeasureOptions.getState().set({ inOrder: false });
    });

    it("stays quiet when the curve does not retrace a loop", () => {
      const { queryByText } = showLevel(loopSheet(0));
      expect(queryByText(POINTER)).toBeNull();
    });
  });
});
