// The half / split violin, paired, lollipop and stacked-histogram toolbar controls
// (plan item 20): what each shows and what each pick writes.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StatDist3Controls from "./StatDist3Controls";
import type { StatStageState } from "./useStatStageTypes";

function state(over: Partial<StatStageState>): StatStageState {
  return {
    mode: "paired",
    columns: [{ index: 0, label: "pre" }, { index: 1, label: "post" }, { index: 2, label: "T" }],
    valueCol: 0, setValueCol: vi.fn(), histCols: [], setHistCols: vi.fn(),
    dist2: { marginal: "histogram", ridgeOverlap: 1, ridgeBw: "scott", violinSide: "half", pairedCi: false, lollipopStat: "mean", lollipopSort: "none", histStack: false },
    setDist2: vi.fn(),
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
    fireEvent.change(screen.getByLabelText("bandwidth"), { target: { value: "0.3" } });
    expect(st.setDist2).toHaveBeenCalledWith({ ridgeBw: "0.3" });
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
    expect(render(<StatDist3Controls st={state({ mode: "histogram" })} />).container).toBeEmptyDOMElement();
    const st = state({ mode: "histogram", histCols: [1] });
    render(<StatDist3Controls st={st} />);
    fireEvent.click(screen.getByLabelText("stack"));
    expect(st.setDist2).toHaveBeenCalledWith({ histStack: true });
  });
});
