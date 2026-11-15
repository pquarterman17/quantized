// Origin-style multiple Y axes (gap audit 4 G11) through the REAL store:
// every gesture is one undo step, a committed zoom / Back / Forward carries
// the Y3+ ranges, and a Y2 assignment takes a series off its extra axis.

import type uPlot from "uplot";
import { beforeEach, describe, expect, it } from "vitest";

import { newExtraYAxis } from "../lib/multiY";
import { setExtraYAxis, setSeriesYAxis } from "../lib/multiYEdit";
import { viewBounds } from "../lib/uplotTools";
import { useApp } from "./useApp";

function reset(): void {
  useApp.setState({
    history: [], future: [], viewHistory: [], viewFuture: [], status: "",
    y2Keys: null, yAxes: [], yAxisOf: {}, xLim: null, yLim: null, y2Lim: null,
  });
}

beforeEach(reset);

describe("multiple Y axes in the store", () => {
  it("assigning a series to +Y3 makes the axis in one undo step, and undo takes it away", () => {
    setSeriesYAxis(useApp.getState, 2, 3);
    let s = useApp.getState();
    expect(s.yAxes).toEqual([newExtraYAxis()]);
    expect(s.yAxisOf).toEqual({ 2: 3 });
    expect(s.history.map((h) => h.label)).toEqual(["move series to Y3"]);
    s.undo();
    s = useApp.getState();
    expect(s.yAxes).toEqual([]);
    expect(s.yAxisOf).toEqual({});
  });

  it("a gap in the numbering is refused with a status, no undo entry", () => {
    setSeriesYAxis(useApp.getState, 2, 4);
    const s = useApp.getState();
    expect(s.yAxes).toEqual([]);
    expect(s.history).toEqual([]);
    expect(s.status).toMatch(/Y4/);
  });

  it("formatting and removing an axis are undoable", () => {
    setSeriesYAxis(useApp.getState, 2, 3);
    setExtraYAxis(useApp.getState, 0, { color: "#112233", lim: [0, 4] });
    expect(useApp.getState().yAxes[0]).toMatchObject({ color: "#112233", lim: [0, 4] });
    setExtraYAxis(useApp.getState, 0, null);
    expect(useApp.getState().yAxes).toEqual([]);
    expect(useApp.getState().yAxisOf).toEqual({});
    useApp.getState().undo();
    expect(useApp.getState().yAxes[0].color).toBe("#112233");
    expect(useApp.getState().yAxisOf).toEqual({ 2: 3 });
  });

  it("moving the last Y2 series off Y2 resets Y2 as the Y2 pill did, records a macro, one undo step", () => {
    useApp.setState({ y2Keys: [1], y2Lim: [0, 5], y2AxisLabel: "old Y2", y2Scale: "log", macroRecording: true, macroSteps: [] });
    setSeriesYAxis(useApp.getState, 1, 3);
    const s = useApp.getState();
    expect([s.y2Keys, s.y2Lim, s.y2AxisLabel, s.y2Scale]).toEqual([null, null, "", null]);
    expect(s.yAxisOf).toEqual({ 1: 3 });
    expect(s.macroSteps.map((m) => m.code)).toEqual(["qz.setY2Keys(null)"]);
    expect(s.history).toHaveLength(1);
    s.undo();
    expect(useApp.getState()).toMatchObject({ y2Keys: [1], y2Lim: [0, 5], yAxisOf: {}, yAxes: [] });
    setSeriesYAxis(useApp.getState, 2, 2);
    expect(useApp.getState().macroSteps.map((m) => m.code)).toContain("qz.setY2Keys([1, 2])");
    useApp.setState({ macroRecording: false, macroSteps: [] });
  });

  it("putting a Y3 series on Y2 takes it off Y3", () => {
    setSeriesYAxis(useApp.getState, 2, 3);
    useApp.getState().setY2Keys([2]);
    expect(useApp.getState().yAxisOf).toEqual({});
  });

  it("a committed zoom carries each Y3+ range; Back and Forward restore it", () => {
    setSeriesYAxis(useApp.getState, 2, 3);
    const before = { xLim: null, yLim: null, yN: { 3: null } };
    const after = { xLim: [0, 1] as [number, number], yLim: [0, 2] as [number, number], yN: { 3: [5, 6] as [number, number] } };
    useApp.getState().recordView(before, after);
    expect(useApp.getState().yAxes[0].lim).toEqual([5, 6]);
    useApp.getState().backView();
    expect(useApp.getState().yAxes[0].lim).toBeNull();
    useApp.getState().forwardView();
    expect(useApp.getState().yAxes[0].lim).toEqual([5, 6]);
  });

  it("a zoom that moves only a Y3+ range is still a view change", () => {
    setSeriesYAxis(useApp.getState, 2, 3);
    useApp.getState().recordView({ xLim: null, yLim: null, yN: { 3: null } }, { xLim: null, yLim: null, yN: { 3: [1, 2] } });
    expect(useApp.getState().viewHistory).toHaveLength(1);
  });

  it("the live view bounds name every drawn Y3+ scale by its axis number", () => {
    const scale = (min: number, max: number) => ({ min, max });
    const u = { scales: { x: scale(0, 1), y: scale(0, 2), y2: scale(3, 4), y3: scale(5, 6), y5: scale(7, 8) } } as unknown as uPlot;
    expect(viewBounds(u)).toEqual({ xLim: [0, 1], yLim: [0, 2], y2Lim: [3, 4], yN: { 3: [5, 6], 5: [7, 8] } });
    expect(viewBounds({ scales: { x: scale(0, 1), y: scale(0, 2) } } as unknown as uPlot)).toEqual({ xLim: [0, 1], yLim: [0, 2] });
  });
});
