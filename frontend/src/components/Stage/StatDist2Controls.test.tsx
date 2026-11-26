// The marginal / ridgeline toolbar controls (plan item 20): what each shows and
// what each pick writes.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StatDist2Controls from "./StatDist2Controls";
import type { StatStageState } from "./useStatStageTypes";

function state(over: Partial<StatStageState>): StatStageState {
  return {
    mode: "marginal",
    columns: [{ index: 0, label: "field" }, { index: 1, label: "moment" }, { index: 2, label: "T" }],
    valueCol: 1, setValueCol: vi.fn(), histCols: [], setHistCols: vi.fn(), bins: "fd", setBins: vi.fn(),
    dist2: { marginal: "histogram", ridgeOverlap: 1, ridgeBw: "scott" }, setDist2: vi.fn(),
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
    render(<StatDist2Controls st={state({ dist2: { marginal: "rug", ridgeOverlap: 1, ridgeBw: "scott" } })} />);
    expect(screen.queryByLabelText("bins")).toBeNull();
  });

  it("ridgeline: overlap and bandwidth write their picks", () => {
    const st = state({ mode: "ridgeline" });
    render(<StatDist2Controls st={st} />);
    fireEvent.change(screen.getByLabelText("overlap"), { target: { value: "2" } });
    expect(st.setDist2).toHaveBeenCalledWith({ ridgeOverlap: 2 });
    fireEvent.change(screen.getByLabelText("bandwidth"), { target: { value: "0.3" } });
    expect(st.setDist2).toHaveBeenCalledWith({ ridgeBw: "0.3" });
  });
});
