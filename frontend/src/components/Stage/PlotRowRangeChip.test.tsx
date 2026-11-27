// The plot's row-range chip and the worksheet's "Plot only these rows", through
// the real stores: the chip shows "rows 21-44 of 200" and clears it (one undo
// restores it); an unfit range says it is not applied; the worksheet button sets
// the window from a contiguous selection only.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { setPlotRowRange } from "../../store/plotRowRangeSet";
import { useApp } from "../../store/useApp";
import PlotRowRangeChip from "./PlotRowRangeChip";
import WorksheetPane from "./worksheet/WorksheetPane";

const n = 200;
const dataset: Dataset = {
  id: "d", name: "run.dat",
  data: { time: Array.from({ length: n }, (_v, i) => i), values: Array.from({ length: n }, (_v, i) => [i]), labels: ["A"], units: ["V"], metadata: {} },
};

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [dataset], activeId: "d", history: [], future: [], status: "", rowRange: undefined, stageTab: "worksheet", worksheetId: null, worksheetSelections: {} });
});

describe("plot row-range chip", () => {
  it("shows the window and clears it; one undo restores it", () => {
    setPlotRowRange({ from: 20, to: 43 });
    render(<PlotRowRangeChip />);
    expect(screen.getByRole("status").textContent).toContain("rows 21-44 of 200");
    fireEvent.click(screen.getByRole("button", { name: "Clear plot row range" }));
    expect(useApp.getState().rowRange).toBeUndefined();
    useApp.getState().undo();
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
  });

  it("says a range past the sheet is not applied, with the reason", () => {
    useApp.setState({ rowRange: { from: 20, to: 999 } });
    render(<PlotRowRangeChip />);
    const chip = screen.getByRole("status");
    expect(chip.textContent).toContain("rows 21-1000 not applied");
    expect(chip.getAttribute("title")).toMatch(/beyond the worksheet's 200 rows/);
  });
});

describe("plot row-range chip on a kind that cannot honour the window", () => {
  it("says the kind draws every row instead of claiming a row set, and sits in the stage's own corner", () => {
    useApp.setState({ rowRange: { from: 20, to: 43 } });
    const { container } = render(<PlotRowRangeChip drawsEvery />);
    const chip = screen.getByRole("status");
    expect(chip.textContent).toContain("rows 21-44 · this plot kind draws every row");
    expect(chip.textContent).not.toContain("of 200");
    expect(chip.getAttribute("title")).toMatch(/this plot kind draws every row: switch to the XY plot/);
    expect(container.querySelector(".qzk-rowchip-alt")).not.toBeNull();
  });

  it("says nothing extra on a kind that honours it (drawsEvery false)", () => {
    useApp.setState({ rowRange: { from: 20, to: 43 } });
    render(<PlotRowRangeChip drawsEvery={false} />);
    expect(screen.getByRole("status").textContent).toContain("rows 21-44 of 200");
  });
});

describe("worksheet Plot only these rows", () => {
  it("sets the plot window from a contiguous selection and shows the plot", () => {
    useApp.setState({ selection: { datasetId: "d", rows: Array.from({ length: 24 }, (_v, i) => 20 + i) } });
    render(<WorksheetPane datasetId="d" />);
    fireEvent.click(screen.getByRole("button", { name: "Plot only these rows" }));
    expect(useApp.getState().rowRange).toEqual({ from: 20, to: 43 });
    expect(useApp.getState().stageTab).toBe("plot");
    expect(useApp.getState().status).toMatch(/draws only rows 21-44/);
  });

  it("is disabled for a selection with gaps and leaves the plot alone", () => {
    useApp.setState({ selection: { datasetId: "d", rows: [2, 3, 4, 9] } });
    render(<WorksheetPane datasetId="d" />);
    const b = screen.getByRole("button", { name: "Plot only these rows" });
    expect(b).toBeDisabled();
    expect(b.getAttribute("title")).toMatch(/the selection has gaps/);
    expect(useApp.getState().rowRange).toBeUndefined();
  });
});
