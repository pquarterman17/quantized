import { beforeEach, describe, expect, it } from "vitest";

import { planSelectionPlot, selectionXDecision } from "./plotSelectionX";
import type { Dataset } from "./types";
import { useFigureDialog } from "../store/figureDialogs";

const labels = ["X1", "Y1", "X2", "Y2", "Y3"];
const ds = (columnDesignations?: Dataset["columnDesignations"]): Dataset => ({
  id: "d",
  name: "book",
  data: { time: [0, 1], values: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]], labels, units: labels.map(() => ""), metadata: {} },
  columnDesignations,
});
const one = ds({ 0: "X" });
const two = ds({ 0: "X", 2: "X" });
const none = { xKey: null, yKeys: null };

beforeEach(() => useFigureDialog.setState({ open: null }));

describe("selectionXDecision", () => {
  it("one designated X owns every selected Y", () => {
    expect(selectionXDecision(one, new Set([1, 3]), none)).toEqual({ kind: "x", xKey: 0 });
  });
  it("several Xs: Ys of one block use that block's X", () => {
    expect(selectionXDecision(two, new Set([3, 4]), none)).toEqual({ kind: "x", xKey: 2 });
    expect(selectionXDecision(two, new Set([1]), none)).toEqual({ kind: "x", xKey: 0 });
  });
  it("several Xs: Ys from different blocks are ambiguous", () => {
    expect(selectionXDecision(two, new Set([1, 3]), none)).toEqual({ kind: "ask" });
  });
  it("a Y before every X of a multi-X sheet is ambiguous", () => {
    expect(selectionXDecision(ds({ 2: "X", 3: "X" }), new Set([1]), none)).toEqual({ kind: "ask" });
  });
  it("no designated X, a selected X, the own X, or a hand-set X keeps the old behaviour", () => {
    expect(selectionXDecision(ds(), new Set([1]), none)).toEqual({ kind: "keep" });
    expect(selectionXDecision(two, new Set([0, 1]), none)).toEqual({ kind: "keep" });
    expect(selectionXDecision(two, new Set([-1, 1]), none)).toEqual({ kind: "keep" });
    expect(selectionXDecision(two, new Set([1, 3]), { xKey: 4, yKeys: null })).toEqual({ kind: "keep" });
  });
});

describe("planSelectionPlot", () => {
  it("plots directly against the one designated X, with no picker", () => {
    const r = planSelectionPlot(one, [1, 3], none, "replace");
    expect(r?.actions).toEqual([{ kind: "setXKey", xKey: 0 }, { kind: "setYKeys", yKeys: [1, 3] }]);
    expect(r?.summary).toContain("X: X1");
    expect(useFigureDialog.getState().open).toBeNull();
  });
  it("opens the role picker, seeded with the selection, when the X is ambiguous", () => {
    expect(planSelectionPlot(two, [1, 3], none, "add")).toBeNull();
    expect(useFigureDialog.getState().open).toEqual({ kind: "plotSetup", seed: { datasetId: "d", cols: [1, 3], mode: "add" } });
  });
  it("no designated X: the plot's X is untouched, as before", () => {
    expect(planSelectionPlot(ds(), [1, 3], { xKey: 2, yKeys: null }, "replace")?.actions).toEqual([{ kind: "setYKeys", yKeys: [1, 3] }]);
  });
  it("an X equal to the plot's own is not re-set", () => {
    expect(planSelectionPlot(one, [1], { xKey: 0, yKeys: null }, "replace")?.actions).toEqual([{ kind: "setYKeys", yKeys: [1] }]);
  });
});
