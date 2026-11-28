// The half / split violin, paired, lollipop and stacked-histogram toolbar controls
// (plan item 20): what each shows and what each pick writes.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import StatDist3Controls, { variantNotes } from "./StatDist3Controls";
import type { StatStageState } from "./useStatStageTypes";

function state(over: Partial<StatStageState>): StatStageState {
  return {
    mode: "paired",
    columns: [{ index: 0, label: "pre" }, { index: 1, label: "post" }, { index: 2, label: "T" }],
    valueCol: 0, setValueCol: vi.fn(), histCols: [], setHistCols: vi.fn(),
    dist2: { marginal: "histogram", ridgeOverlap: 1, ridgeBw: "scott", violinSide: "half", pairedCi: false, lollipopStat: "mean", lollipopSort: "none", histStack: false, violinMarks: "none", pairedDirection: false, lollipopHoriz: false, histSplit: false },
    setDist2: vi.fn(), categoricalCols: [], groupCol: null, setGroupCol: vi.fn(),
    ...over,
  } as unknown as StatStageState;
}

describe("StatDist3Controls", () => {
  it("draws nothing for the other modes", () => {
    expect(render(<StatDist3Controls st={state({ mode: "box" })} />).container).toBeEmptyDOMElement();
  });

  it("paired: the after column defaults to the first other column and never lists the before", () => {
    const st = state({});
    render(<StatDist3Controls st={st} />);
    const after = screen.getByLabelText("after") as HTMLSelectElement;
    expect(after.value).toBe("1");
    expect([...after.options].map((o) => o.text)).toEqual(["post", "T"]);
    fireEvent.change(after, { target: { value: "2" } });
    expect(st.setHistCols).toHaveBeenCalledWith([2]);
    fireEvent.click(screen.getByLabelText("mean ± CI"));
    expect(st.setDist2).toHaveBeenCalledWith({ pairedCi: true });
  });

  it("half / split: the side and bandwidth writes", () => {
    const st = state({ mode: "sideviolin" });
    render(<StatDist3Controls st={st} />);
    fireEvent.click(screen.getByText("split"));
    expect(st.setDist2).toHaveBeenCalledWith({ violinSide: "split" });
    fireEvent.change(screen.getByLabelText("bandwidth"), { target: { value: "silverman" } });
    expect(st.setDist2).toHaveBeenCalledWith({ ridgeBw: "silverman" });
  });

  it("lollipop: the statistic and the order", () => {
    const st = state({ mode: "lollipop" });
    render(<StatDist3Controls st={st} />);
    fireEvent.click(screen.getByText("median"));
    expect(st.setDist2).toHaveBeenCalledWith({ lollipopStat: "median" });
    fireEvent.change(screen.getByLabelText("order"), { target: { value: "desc" } });
    expect(st.setDist2).toHaveBeenCalledWith({ lollipopSort: "desc" });
  });

  it("histogram: the stack toggle only shows with extra columns", () => {
    expect(render(<StatDist3Controls st={state({ mode: "histogram" })} />).container).toBeEmptyDOMElement(); // no column to split by either
    const st = state({ mode: "histogram", histCols: [1] });
    render(<StatDist3Controls st={st} />);
    fireEvent.click(screen.getByLabelText("stack"));
    expect(st.setDist2).toHaveBeenCalledWith({ histStack: true });
  });

  it("violin: the side offers the left half and the inner marks write their pick", () => {
    const st = state({ mode: "sideviolin" });
    render(<StatDist3Controls st={st} />);
    fireEvent.click(screen.getByText("left half"));
    expect(st.setDist2).toHaveBeenCalledWith({ violinSide: "left" });
    fireEvent.change(screen.getByLabelText("inner marks"), { target: { value: "both" } });
    expect(st.setDist2).toHaveBeenCalledWith({ violinMarks: "both" });
  });

  it("paired: the direction and lollipop: the orientation toggles write their picks", () => {
    const p = state({});
    render(<StatDist3Controls st={p} />);
    fireEvent.click(screen.getByLabelText("by direction"));
    expect(p.setDist2).toHaveBeenCalledWith({ pairedDirection: true });
    const l = state({ mode: "lollipop" });
    render(<StatDist3Controls st={l} />);
    fireEvent.click(screen.getByLabelText("horizontal"));
    expect(l.setDist2).toHaveBeenCalledWith({ lollipopHoriz: true });
  });

  it("histogram: choosing a split column picks it, splits and stacks in one go; (none) clears the split", () => {
    const st = state({ mode: "histogram", categoricalCols: [{ index: 3, label: "lot" }] as never });
    render(<StatDist3Controls st={st} />);
    fireEvent.change(screen.getByLabelText("split by"), { target: { value: "3" } });
    expect(st.setGroupCol).toHaveBeenCalledWith(3);
    expect(st.setDist2).toHaveBeenCalledWith({ histSplit: true, histStack: true });
    fireEvent.change(screen.getByLabelText("split by"), { target: { value: "none" } });
    expect(st.setDist2).toHaveBeenLastCalledWith({ histSplit: false });
  });

  it("histogram: the stack toggle shows once the histogram is split, and no split picker without a categorical column", () => {
    const split = state({ mode: "histogram", groupCol: 3, categoricalCols: [{ index: 3, label: "lot" }] as never, dist2: { ...state({}).dist2, histSplit: true } });
    render(<StatDist3Controls st={split} />);
    expect((screen.getByLabelText("split by") as HTMLSelectElement).value).toBe("3");
    expect(screen.getByLabelText("stack")).toBeTruthy();
  });
});

describe("facet by on the variants (item 20)", () => {
  const withCols = (over: Partial<StatStageState>) =>
    state({ categoricalCols: [{ index: 2, label: "site" }, { index: 3, label: "lot" }], facetCol: null, setFacetCol: vi.fn(), group2Col: null, ...over } as Partial<StatStageState>);

  it("paired offers the facet picker and writes the pick", () => {
    const st = withCols({ mode: "paired" });
    render(<StatDist3Controls st={st} />);
    fireEvent.change(screen.getByLabelText("facet by"), { target: { value: "2" } });
    expect(st.setFacetCol).toHaveBeenCalledWith(2);
  });

  it("a split histogram offers it too, and so does a plain one (U-a)", () => {
    const split = withCols({ mode: "histogram", groupCol: 3 });
    split.dist2 = { ...split.dist2, histSplit: true };
    const { unmount } = render(<StatDist3Controls st={split} />);
    expect(screen.getByLabelText("facet by")).toBeTruthy();
    unmount();
    const plain = withCols({ mode: "histogram" });
    render(<StatDist3Controls st={plain} />);
    fireEvent.change(screen.getByLabelText("facet by"), { target: { value: "3" } });
    expect(plain.setFacetCol).toHaveBeenCalledWith(3);
  });

  it("a facet set elsewhere stays visible, and clearable, in plain histogram mode", () => {
    const st = withCols({ mode: "histogram", facetCol: 3, categoricalCols: [] });
    render(<StatDist3Controls st={st} />);
    expect(screen.getByLabelText("facet by")).toBeTruthy();
  });

  it("a facet column is no longer called ignored", () => {
    render(<StatDist3Controls st={withCols({ mode: "paired", facetCol: 2 })} />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("draws nothing for the other modes even with a facet column", () => {
    expect(render(<StatDist3Controls st={state({ mode: "box", facetCol: 1 } as Partial<StatStageState>)} />).container).toBeEmptyDOMElement();
  });
});

describe("what a variant cannot draw says so (item 20)", () => {
  const plain = { breaks: false, inset: false };
  it("axis breaks and an inset on the plot are named, for every variant", () => {
    for (const mode of ["sideviolin", "lollipop", "paired"] as const) {
      const notes = variantNotes(state({ mode, facetCol: null } as Partial<StatStageState>), { breaks: true, inset: true });
      expect(notes).toHaveLength(2);
      expect(notes[0]).toMatch(/axis breaks/);
      expect(notes[1]).toMatch(/inset/);
    }
    expect(variantNotes(state({ mode: "box" }), { breaks: true, inset: true })).toEqual([]);
  });

  it("the stage shows them from the focused plot's own breaks and inset mode", () => {
    useApp.setState({ insetMode: true });
    render(<StatDist3Controls st={state({ mode: "lollipop" })} />);
    expect(screen.getByRole("note")).toHaveTextContent(/inset/);
    useApp.setState({ insetMode: false });
  });

  it("axis breaks saved in the focused plot's document are named", () => {
    const { plotWindows, focusedWindowId } = useApp.getState();
    const win = plotWindows.find((w) => w.id === focusedWindowId)!;
    const doc = win.document!;
    const withBreak = { ...win, document: { ...doc, plot: { ...doc.plot, axisBreaks: { ...doc.plot.axisBreaks, x: [[1, 2] as [number, number]] } } } };
    useApp.setState({ plotWindows: plotWindows.map((w) => (w.id === win.id ? withBreak : w)) });
    render(<StatDist3Controls st={state({ mode: "paired" })} />);
    expect(screen.getByRole("note")).toHaveTextContent(/axis breaks/);
    useApp.setState({ plotWindows });
  });

  it("a rug on a faceted histogram is refused with its reason", () => {
    const st = state({ mode: "histogram", facetCol: 2, groupCol: 3, rug: { on: true } } as Partial<StatStageState>);
    st.dist2 = { ...st.dist2, histSplit: true };
    expect(variantNotes(st, plain)).toEqual(["The rug is not drawn on a faceted histogram."]);
    st.facetCol = null;
    expect(variantNotes(st, plain)).toEqual([]);
  });
});
