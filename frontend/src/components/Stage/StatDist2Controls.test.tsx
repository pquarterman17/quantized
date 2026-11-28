// The marginal / ridgeline toolbar controls (plan item 20): what each shows and
// what each pick writes.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StatDist2Controls from "./StatDist2Controls";
import type { StatStageState } from "./useStatStageTypes";

function state(over: Partial<StatStageState>): StatStageState {
  return {
    mode: "marginal", categoricalCols: [], groupCol: null, setGroupCol: vi.fn(),
    columns: [{ index: 0, label: "field" }, { index: 1, label: "moment" }, { index: 2, label: "T" }],
    valueCol: 1, setValueCol: vi.fn(), histCols: [], setHistCols: vi.fn(), bins: "fd", setBins: vi.fn(),
    dist2: { marginal: "histogram", ridgeOverlap: 1, ridgeBw: "scott", violinSide: "half", pairedCi: false, lollipopStat: "mean", lollipopSort: "none", histStack: false, violinMarks: "none", pairedDirection: false, lollipopHoriz: false, histSplit: false, violinMean: false, violinRain: false, pairedTol: 0, histPercent: false, lollipopWhisker: "none" }, setDist2: vi.fn(),
    ...over,
  } as unknown as StatStageState;
}

describe("StatDist2Controls", () => {
  it("draws nothing for the other modes", () => {
    const { container } = render(<StatDist2Controls st={state({ mode: "box" })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marginal: X defaults to the dataset column and never lists the Y column", () => {
    render(<StatDist2Controls st={state({})} />);
    const x = screen.getByLabelText("x") as HTMLSelectElement;
    expect(x.value).toBe("-1");
    expect([...x.options].map((o) => o.text)).toEqual(["(x column)", "field", "T"]);
  });

  it("marginal: picks write X (as the first extra column), the strip kind and the bin rule", () => {
    const st = state({ histCols: [2] });
    render(<StatDist2Controls st={st} />);
    expect((screen.getByLabelText("x") as HTMLSelectElement).value).toBe("2");
    fireEvent.change(screen.getByLabelText("x"), { target: { value: "0" } });
    expect(st.setHistCols).toHaveBeenCalledWith([0]);
    fireEvent.change(screen.getByLabelText("x"), { target: { value: "-1" } });
    expect(st.setHistCols).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByText("box"));
    expect(st.setDist2).toHaveBeenCalledWith({ marginal: "box" });
    fireEvent.change(screen.getByLabelText("bins"), { target: { value: "sturges" } });
    expect(st.setBins).toHaveBeenCalledWith("sturges");
  });

  it("marginal: the bin rule only shows for histogram margins", () => {
    render(<StatDist2Controls st={state({ dist2: { marginal: "rug", ridgeOverlap: 1, ridgeBw: "scott", violinSide: "half", pairedCi: false, lollipopStat: "mean", lollipopSort: "none", histStack: false, violinMarks: "none", pairedDirection: false, lollipopHoriz: false, histSplit: false, violinMean: false, violinRain: false, pairedTol: 0, histPercent: false, lollipopWhisker: "none", ridgeEach: false } })} />);
    expect(screen.queryByLabelText("bins")).toBeNull();
  });

  it("ridgeline: a free overlap number, the bandwidth rule or a free factor, and the per-ridge scale write their picks", () => {
    const st = state({ mode: "ridgeline", categoricalCols: [], facetCol: null, groupCol: null, group2Col: null, setFacetCol: vi.fn() });
    render(<StatDist2Controls st={st} />);
    const overlap = screen.getByLabelText("overlap");
    fireEvent.change(overlap, { target: { value: "1.37" } });
    fireEvent.keyDown(overlap, { key: "Enter" });
    expect(st.setDist2).toHaveBeenCalledWith({ ridgeOverlap: 1.37 });
    fireEvent.change(overlap, { target: { value: "9" } }); // past the maximum: refused, reverts
    fireEvent.keyDown(overlap, { key: "Enter" });
    expect(st.setDist2).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("bandwidth"), { target: { value: "silverman" } });
    expect(st.setDist2).toHaveBeenLastCalledWith({ ridgeBw: "silverman" });
    fireEvent.change(screen.getByLabelText("bandwidth"), { target: { value: "factor" } });
    expect(st.setDist2).toHaveBeenLastCalledWith({ ridgeBw: "0.3" });
    fireEvent.click(screen.getByLabelText(/each to its peak/));
    expect(st.setDist2).toHaveBeenLastCalledWith({ ridgeEach: true });
    expect(screen.getByText("facet by")).toBeTruthy();
  });

  it("ridgeline: a numeric bandwidth shows its factor field, which commits a free number", () => {
    const st = state({
      mode: "ridgeline", categoricalCols: [], facetCol: null, groupCol: null, group2Col: null, setFacetCol: vi.fn(),
      dist2: { ...state({}).dist2, ridgeBw: "0.45" },
    });
    render(<StatDist2Controls st={st} />);
    expect((screen.getByLabelText("bandwidth") as HTMLSelectElement).value).toBe("factor");
    const factor = screen.getByLabelText("factor");
    expect((factor as HTMLInputElement).value).toBe("0.45");
    fireEvent.change(factor, { target: { value: "0.62" } });
    fireEvent.keyDown(factor, { key: "Enter" });
    expect(st.setDist2).toHaveBeenLastCalledWith({ ridgeBw: "0.62" });
  });

  it("marginal: split, colour and size picks write their options; (none) clears them", () => {
    const st = state({
      categoricalCols: [{ index: 2, label: "lot" }], groupCol: null, setGroupCol: vi.fn(),
      dist2: { ...state({}).dist2, marginalColor: 2 },
    });
    render(<StatDist2Controls st={st} />);
    fireEvent.change(screen.getByLabelText("split by"), { target: { value: "2" } });
    expect(st.setGroupCol).toHaveBeenCalledWith(2);
    expect(st.setDist2).toHaveBeenLastCalledWith({ histSplit: true });
    expect((screen.getByLabelText("color") as HTMLSelectElement).value).toBe("2");
    fireEvent.change(screen.getByLabelText("color"), { target: { value: "none" } });
    expect(st.setDist2).toHaveBeenLastCalledWith({ marginalColor: undefined });
    fireEvent.change(screen.getByLabelText("size"), { target: { value: "0" } });
    expect(st.setDist2).toHaveBeenLastCalledWith({ marginalSize: 0 });
  });
});
