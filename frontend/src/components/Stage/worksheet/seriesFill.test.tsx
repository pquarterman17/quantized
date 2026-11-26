// Fill series through the real store and the real cell menu (plan item 29):
// one undo step, a status line that says why a refusal wrote nothing.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseIsoDate } from "../../../lib/formulaCalendar";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { cellBlockItems } from "./cellMenu";
import { useWorksheetBlockOps } from "./useWorksheetBlockOps";

const setStatus = vi.fn();
const makeDs = (over: Partial<Dataset["data"]> = {}): Dataset => ({
  id: "d1",
  name: "sheet",
  data: { time: [0, 1, 2, 3, 4], values: [[10, 0], [12, 0], [0, 0], [0, 0], [0, 0]], labels: ["A", "B"], units: ["", ""], metadata: {}, ...over },
});
const datasetNow = () => useApp.getState().datasets[0].data;

function ops(rows: number[], cols: number[], levelsAt?: (c: number) => string[] | null) {
  const valueAt = (r: number, c: number) => (c < 0 ? datasetNow().time[r] : datasetNow().values[r]?.[c]);
  return renderHook(() =>
    useWorksheetBlockOps({ datasetId: "d1", rows, cols, order: [0, 1, 2, 3, 4], rowCount: 5, writableCols: 2, valueAt, levelsAt, setStatus }),
  ).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [makeDs()], activeId: "d1", history: [], future: [] });
});

describe("fill series through the store", () => {
  it("fills a number series down and Undo restores every cell in one step", () => {
    const before = datasetNow().values.map((r) => [...r]);
    ops([0, 1, 2, 3, 4], [0]).fillSeries!("down");
    expect(datasetNow().values.map((r) => r[0])).toEqual([10, 12, 14, 16, 18]);
    expect(useApp.getState().history).toHaveLength(1);
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringMatching(/filled 3 cells in 1 column with a number series/));
    useApp.getState().undo();
    expect(datasetNow().values).toEqual(before);
  });

  it("fills across a row, X included", () => {
    useApp.setState({ datasets: [makeDs({ time: [1, 0, 0, 0, 0], values: [[2, 0], [0, 0], [0, 0], [0, 0], [0, 0]] })] });
    ops([0], [-1, 0, 1]).fillSeries!("across");
    expect(datasetNow().values[0]).toEqual([2, 3]); // X=1, A=2, then 3 in B
  });

  it("a mixed selection (text column) refuses with a message and writes nothing", () => {
    const o = ops([0, 1, 2], [0, 1], (c) => (c === 1 ? ["x"] : null));
    const before = datasetNow();
    o.fillSeries!("down");
    expect(datasetNow()).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringMatching(/can't fill a series: "B" is a text column/));
  });

  it("a single selected row has nothing to fill down", () => {
    ops([1], [0]).fillSeries!("down");
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringMatching(/at least two cells in a column/));
  });

  it("fills dates by month on a date X column, month end clamped, one undo step", () => {
    const t0 = parseIsoDate("2026-01-31");
    useApp.setState({ datasets: [makeDs({ time: [t0, NaN, NaN, NaN, NaN], metadata: { time_is_datetime: true } })] });
    ops([0, 1, 2, 3], [-1]).fillSeries!("down", "month");
    const fmt = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
    expect(datasetNow().time.slice(0, 4).map(fmt)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(datasetNow().time[1]).toBeNaN();
  });

  it("a number fill on a date column refuses and says to pick a date series", () => {
    useApp.setState({ datasets: [makeDs({ time: [parseIsoDate("2026-01-01"), NaN, NaN, NaN, NaN], metadata: { time_is_datetime: true } })] });
    ops([0, 1, 2], [-1]).fillSeries!("down");
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringMatching(/holds dates/));
  });
});

describe("Fill series menu", () => {
  type Sub = { label: string; run: () => void }[];
  const sub = (items: ReturnType<typeof cellBlockItems>) => (items.find((i) => "label" in i && i.label === "Fill series") as unknown as { submenu: Sub }).submenu;

  it("offers numbers down / across, and date entries only with a date X", () => {
    expect(sub(cellBlockItems({ ops: ops([0, 1], [0]) }, false)).map((s) => s.label)).toEqual(["Numbers down", "Numbers across"]);
    useApp.setState({ datasets: [makeDs({ metadata: { time_is_datetime: true } })] });
    expect(sub(cellBlockItems({ ops: ops([0, 1], [-1]) }, false)).map((s) => s.label)).toEqual([
      "Numbers down", "Numbers across", "Dates down by days", "Dates down by weeks", "Dates down by months", "Dates down by years",
    ]);
  });

  it("disables with no selection, and the entries run the fill", () => {
    const fill = vi.fn();
    const none = cellBlockItems({ ops: { ...ops([0, 1], [0]), fillSeries: fill, hasBlock: false } }, false);
    expect(none.find((i) => "label" in i && i.label === "Fill series")).toMatchObject({ disabled: true, title: "select cells first" });
    sub(cellBlockItems({ ops: { ...ops([0, 1], [0]), fillSeries: fill } }, false))[1].run();
    expect(fill).toHaveBeenCalledWith("across");
  });
});
